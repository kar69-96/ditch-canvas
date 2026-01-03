#!/usr/bin/env node
// Load .env from backend directory (where script is located) or project root
const path = require('path');
const fs = require('fs');
const dotenv = require('dotenv');
const http = require('http');
const express = require('express');
const cors = require('cors');
const { Server } = require('socket.io');
const { chromium } = require('playwright-core');

// Load .env from project root (two levels up from src/core/)
const envPath = path.join(__dirname, '..', '..', '.env');

if (fs.existsSync(envPath)) {
  dotenv.config({ path: envPath });
} else {
  dotenv.config(); // Try default locations
}

// Use home directory for output on EC2, or relative path for local
const OUTPUT_DIR = process.env.OUTPUT_DIR || 
  (process.env.HOME 
    ? path.join(process.env.HOME, 'canvas-wrapper-data', 'auth')
    : path.join(__dirname, '..', '..', 'data', 'auth'));
const STREAMING_PORT = process.env.STREAMING_PORT || 3002;

// Email-specific cookie output file (if provided)
const COOKIE_OUTPUT_FILE = process.env.COOKIE_OUTPUT_FILE;

// Optional explicit Chromium path
const CHROMIUM_PATH =
  process.env.CHROMIUM_PATH ||
  process.env.CHROME_PATH ||
  process.env.PLAYWRIGHT_CHROMIUM_PATH ||
  null;

// Ensure output directory exists
if (!fs.existsSync(OUTPUT_DIR)) {
  fs.mkdirSync(OUTPUT_DIR, { recursive: true });
}

// WebRTC streaming infrastructure
class BrowserStreamingServer {
  constructor(port = STREAMING_PORT) {
    this.port = port;
    this.app = express();
    
    // Add CORS middleware for HTTP requests
    this.app.use(cors({
      origin: '*',
      methods: ['GET', 'POST', 'OPTIONS'],
      credentials: false
    }));
    
    this.server = http.createServer(this.app);
    this.io = new Server(this.server, {
      cors: {
        origin: '*',
        methods: ['GET', 'POST']
      }
    });
    
    this.browser = null;
    this.context = null;
    this.page = null;
    this.cdpSession = null;
    this.clients = new Map();
    this.frameCaptureInterval = null;
    
    this.setupRoutes();
    this.setupWebSocket();
  }

  setupRoutes() {
    // Add security headers to allow the page to load
    this.app.use((req, res, next) => {
      res.setHeader('X-Frame-Options', 'ALLOWALL');
      res.setHeader('Content-Security-Policy', "default-src 'self' 'unsafe-inline' 'unsafe-eval' https://cdn.socket.io data: blob:; connect-src 'self' ws://localhost:* wss://localhost:* http://localhost:* https://localhost:*;");
      next();
    });
    
    // Serve the HTML5 client
    this.app.get('/', (req, res) => {
      res.setHeader('Content-Type', 'text/html');
      res.send(this.getClientHTML());
    });

    // Health check
    this.app.get('/health', (req, res) => {
      res.json({ status: 'ok', browser: !!this.browser });
    });
  }

  setupWebSocket() {
    this.io.on('connection', (socket) => {
      console.log(`📱 Client connected: ${socket.id}`);
      this.clients.set(socket.id, socket);

      // Send an immediate frame when client connects
      // Check page status and retry if needed
      const sendFrameWithRetry = async (retries = 3) => {
        for (let i = 0; i < retries; i++) {
          if (this.page && !this.page.isClosed()) {
            try {
              await this.sendCurrentFrame(socket);
              return; // Success
            } catch (error) {
              console.log(`⚠️  Attempt ${i + 1} to send frame failed: ${error.message}`);
              if (i < retries - 1) {
                await new Promise(resolve => setTimeout(resolve, 1000));
              }
            }
          } else {
            console.log(`⚠️  Page is closed (attempt ${i + 1}/${retries}) - waiting...`);
            if (i < retries - 1) {
              await new Promise(resolve => setTimeout(resolve, 1000));
            }
          }
        }
        console.log(`⚠️  Could not send initial frame to ${socket.id} after ${retries} attempts`);
        console.log(`   Screencast frames will still be sent when available`);
      };
      
      // Wait a moment for page to be ready, then try
      setTimeout(() => {
        sendFrameWithRetry().catch(() => {
          // Screencast will handle ongoing frames
        });
      }, 500);

      // Handle WebRTC signaling
      socket.on('offer', async (offer) => {
        try {
          // Create answer for WebRTC connection
          // In a real implementation, you'd use a proper WebRTC library
          // For now, we'll use a simplified approach with frame streaming
          socket.emit('answer', { type: 'answer', sdp: 'simplified' });
        } catch (error) {
          console.error('Error handling offer:', error);
          socket.emit('error', { message: error.message });
        }
      });

      // Handle ICE candidates
      socket.on('ice-candidate', (candidate) => {
        // Forward to other peer if needed
        socket.broadcast.emit('ice-candidate', candidate);
      });

      // Handle mouse events from client with throttling
      let lastMouseMoveTime = 0;
      socket.on('mouse-move', async (data) => {
        // Throttle mouse move events to prevent overload
        const now = Date.now();
        if (now - lastMouseMoveTime < 16) return; // Max 60fps
        lastMouseMoveTime = now;
        
        if (this.page && !this.page.isClosed()) {
          try {
            await this.page.mouse.move(data.x, data.y);
          } catch (error) {
            // Silently ignore if page is closed
            if (!error.message.includes('closed')) {
              console.error('Error moving mouse:', error);
            }
          }
        }
      });

      socket.on('mouse-down', async (data) => {
        if (this.page && !this.page.isClosed()) {
          try {
            await this.page.mouse.move(data.x, data.y, { steps: 1 });
            await this.page.mouse.down({ button: data.button || 'left' });
          } catch (error) {
            if (!error.message.includes('closed')) {
              console.error('Error on mouse down:', error);
            }
          }
        }
      });

      socket.on('mouse-up', async (data) => {
        if (this.page && !this.page.isClosed()) {
          try {
            await this.page.mouse.up({ button: data.button || 'left' });
            // REMOVED: Manual focus logic that caused viewport jumps
            // Playwright's mouse.click() and mouse.down()/mouse.up() already handle
            // element focusing automatically. Manual focus() calls can cause Chrome
            // to scroll or adjust the visual viewport if the caret is offscreen,
            // making the CSS/DEVICE pixel mismatch visible and causing page "jumps".
          } catch (error) {
            if (!error.message.includes('closed')) {
              console.error('Error on mouse up:', error);
            }
          }
        }
      });

      // Removed mouse-click handler to prevent double-clicking
      // Using only mouse-down/mouse-up for cleaner interaction

      // Optimize keyboard input with immediate processing (no queue for responsiveness)
      socket.on('keyboard-input', (data) => {
        // Process immediately without await to reduce lag
        if (this.page && !this.page.isClosed()) {
          // Don't await - fire and forget for better responsiveness
          (async () => {
            try {
              // Handle special keys that need key press
              const specialKeys = ['Enter', 'Backspace', 'Delete', 'Tab', 'Escape', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'];
              
              // Only process keypress for printable characters, keydown for special keys
              if (data.type === 'keypress') {
                // keypress only fires for printable characters
                if (data.key && data.key.length === 1) {
                  // Use type for regular characters - it handles focus automatically
                  await this.page.keyboard.type(data.key, { delay: 0 });
                }
              } else if (data.type === 'keydown') {
                // keydown for special keys only
                if (specialKeys.includes(data.key)) {
                  await this.page.keyboard.press(data.key);
                }
                // Ignore keydown for printable characters to avoid double typing
              } else if (data.type === 'type' && data.text) {
                await this.page.keyboard.type(data.text, { delay: 0 });
              }
            } catch (error) {
              // Silently ignore if page is closed
              if (!error.message.includes('closed')) {
                console.error('Error with keyboard:', error);
              }
            }
          })();
        }
      });

      socket.on('scroll', async (data) => {
        if (this.page) {
          try {
            await this.page.mouse.wheel(data.deltaX || 0, data.deltaY || 0);
          } catch (error) {
            console.error('Error scrolling:', error);
          }
        }
      });

      socket.on('disconnect', () => {
        console.log(`📱 Client disconnected: ${socket.id}`);
        this.clients.delete(socket.id);
      });
    });
  }

  async startBrowser() {
    console.log('🚀 Starting Chromium with CDP...');
    
    // Check if running in Xvfb environment (EC2 with virtual display :99)
    const isXvfbEnv = process.env.DISPLAY && process.env.DISPLAY.includes(':99');
    
    // For local development (macOS/Windows), always run headless to avoid opening visible browser window
    // The web interface in the pop-up is what users should see
    // Only run headful if explicitly on EC2/Xvfb environment
    // Force headless for local development - no visible Chrome window should open
    let shouldRunHeadless = !isXvfbEnv;
    
    if (process.env.FORCE_HEADLESS === 'true') {
      shouldRunHeadless = true;
    }
    
    console.log(`   Running in ${shouldRunHeadless ? 'headless' : 'headful'} mode (DISPLAY: ${process.env.DISPLAY || 'not set'})`);
    
    const launchOptions = {
      headless: shouldRunHeadless, // Headless for local dev, headful for EC2/Xvfb
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
        '--enable-features=UseChromeOSDirectVideoDecoder',
        '--use-fake-ui-for-media-stream',
        '--autoplay-policy=no-user-gesture-required',
        // Additional args for headless/Xvfb environments
        '--disable-gpu-sandbox',
        '--disable-software-rasterizer',
        // Disable downloads - fully web-based
        '--disable-downloads',
        '--disable-pdf-viewer',
        '--disable-print-preview',
        // Xvfb-specific args
        '--disable-gpu', // Disable GPU in Xvfb environment
      ],
      env: {
        ...process.env,
        DISPLAY: process.env.DISPLAY || ':99'
      }
    };
    
    // If running in Xvfb, ensure we use the correct display
    if (isXvfbEnv && process.env.DISPLAY) {
      console.log(`   Using display: ${process.env.DISPLAY}`);
    }

    if (CHROMIUM_PATH) {
      if (!fs.existsSync(CHROMIUM_PATH)) {
        throw new Error(`Chrome binary not found at: ${CHROMIUM_PATH}`);
      }
      launchOptions.executablePath = CHROMIUM_PATH;
      console.log(`📍 Using custom browser binary at: ${CHROMIUM_PATH}`);
    }

    try {
      // Since we control the EC2 instance and install Chrome during setup,
      // we know exactly where it is. Use known paths directly.
      let browserLaunched = false;
      
      // First, check for explicit CHROMIUM_PATH override
      if (CHROMIUM_PATH && fs.existsSync(CHROMIUM_PATH)) {
        launchOptions.executablePath = CHROMIUM_PATH;
        this.browser = await chromium.launch(launchOptions);
        console.log(`✅ Browser launched using: ${CHROMIUM_PATH}`);
        browserLaunched = true;
      } else {
        // Known Chrome installation paths on our EC2 instance
        // These are the paths where Chrome gets installed during setup
        const knownChromePaths = [
          '/opt/google/chrome/google-chrome',      // Direct binary (Amazon Linux 2023/2) - highest priority
          '/usr/bin/google-chrome-stable',         // Symlink to /opt/google/chrome/google-chrome
          '/usr/bin/google-chrome'                 // Symlink via alternatives
        ];
        
        // Try known paths first (we control the instance, so these should work)
        for (const chromePath of knownChromePaths) {
          if (fs.existsSync(chromePath)) {
            try {
              // Resolve symlinks to actual binary for better reliability
              let pathToUse = chromePath;
              try {
                const stats = fs.lstatSync(chromePath);
                if (stats.isSymbolicLink()) {
                  const { execSync } = require('child_process');
                  const resolved = execSync(`readlink -f "${chromePath}" 2>/dev/null || realpath "${chromePath}" 2>/dev/null`, { encoding: 'utf8', timeout: 2000 }).trim();
                  if (resolved && fs.existsSync(resolved)) {
                    pathToUse = resolved;
                    console.log(`🔗 Resolved symlink ${chromePath} -> ${pathToUse}`);
                  }
                }
              } catch (e) {
                // Use original path if symlink resolution fails
                console.log(`⚠️  Could not resolve symlink for ${chromePath}, using original path`);
              }
              
              console.log(`🚀 Attempting to launch Chrome from: ${pathToUse}`);
              launchOptions.executablePath = pathToUse;
              this.browser = await chromium.launch(launchOptions);
              console.log(`✅ Browser launched using: ${pathToUse}`);
              browserLaunched = true;
              break;
            } catch (launchError) {
              // Log the full error for debugging
              console.log(`⚠️  Failed to launch from ${chromePath}: ${launchError.message}`);
              if (launchError.stack) {
                console.log(`   Stack: ${launchError.stack.split('\n').slice(0, 3).join('\n')}`);
              }
              continue;
            }
          } else {
            console.log(`⚠️  Path does not exist: ${chromePath}`);
          }
        }
        
        // Fallback: Try Playwright's channel detection (only if known paths fail)
        if (!browserLaunched) {
          try {
            this.browser = await chromium.launch({
              ...launchOptions,
              channel: 'chrome'
            });
            console.log('✅ Browser launched using Playwright Chrome channel');
            browserLaunched = true;
          } catch (chromeError) {
            // Last resort: try chromium-browser (shouldn't be needed, but just in case)
            const chromiumPaths = ['/usr/bin/chromium-browser', '/usr/bin/chromium'];
            for (const chromiumPath of chromiumPaths) {
              if (fs.existsSync(chromiumPath)) {
                try {
                  launchOptions.executablePath = chromiumPath;
                  this.browser = await chromium.launch(launchOptions);
                  console.log(`✅ Browser launched using: ${chromiumPath}`);
                  browserLaunched = true;
                  break;
                } catch (e) {
                  continue;
                }
              }
            }
          }
        }
        
        if (!browserLaunched) {
          // Check if X server is accessible
          const display = process.env.DISPLAY || ':99';
          const { execSync } = require('child_process');
          let xServerAccessible = false;
          try {
            execSync(`xdpyinfo -display ${display} > /dev/null 2>&1`, { timeout: 2000 });
            xServerAccessible = true;
          } catch (e) {
            xServerAccessible = false;
          }
          
          if (!xServerAccessible) {
            throw new Error(`X server not accessible on display ${display}. Ensure Xvfb is running: Xvfb ${display} -screen 0 1920x1080x24 -ac +extension GLX +render -noreset &`);
          } else {
            throw new Error('Chrome not found. Chrome should be installed at /opt/google/chrome/google-chrome or /usr/bin/google-chrome-stable');
          }
        }
      }

      // Create browser context with download blocking
      // CRITICAL: Set deviceScaleFactor to 1 to prevent CSS/DEVICE pixel mismatch
      // Without this, mouse coordinates (CSS pixels) don't match screencast frames (DEVICE pixels)
      // This causes page "jumps" after interactions when Chrome re-renders
      this.context = await this.browser.newContext({
        viewport: { width: 1920, height: 1080 },
        deviceScaleFactor: 1, // Force 1:1 CSS to device pixel ratio
        // Block all downloads - fully web-based
        acceptDownloads: false
      });
      
      // Clear cookies immediately after context creation if force re-auth is requested
      const forceReauth = process.env.FORCE_REAUTH === 'true';
      if (forceReauth) {
        console.log('🧹 Force re-auth requested - clearing all cookies in fresh context...');
        try {
          await this.context.clearCookies();
          console.log('✅ Cookies cleared in browser context - fresh authentication will be required');
        } catch (error) {
          console.warn('⚠️  Could not clear cookies:', error.message);
        }
      }
      
      this.page = await this.context.newPage();
      
      // Block all download events - fully web-based, no downloads
      this.page.on('download', async (download) => {
        console.log('🚫 Download blocked:', download.url());
        try {
          await download.cancel();
        } catch (e) {
          // Ignore cancel errors
        }
      });
      
      // Intercept and block download requests before they happen
      // Set up route handler before any navigation
      this.page.route('**/*', (route) => {
        const request = route.request();
        const url = request.url().toLowerCase();
        const headers = request.headers();
        
        // Block common download patterns
        const downloadPatterns = [
          '/download',
          '.pdf',
          '.zip',
          '.doc',
          '.docx',
          '.xls',
          '.xlsx',
          'attachment',
          'content-disposition: attachment'
        ];
        
        // Check URL and headers for download indicators
        const isDownload = downloadPatterns.some(pattern => 
          url.includes(pattern) || 
          (headers['content-disposition'] && headers['content-disposition'].toLowerCase().includes('attachment'))
        );
        
        if (isDownload) {
          console.log('🚫 Download request blocked:', url);
          route.abort();
        } else {
          route.continue();
        }
      });

      // Prevent page from closing unexpectedly
      this.page.on('close', () => {
        console.log('⚠️  Page closed unexpectedly');
        console.log('   This may cause black screen - page will be recreated if needed');
      });

      this.context.on('close', () => {
        console.log('⚠️  Context closed unexpectedly');
      });

      this.browser.on('disconnected', () => {
        console.log('⚠️  Browser disconnected');
      });
      
      // Ensure page stays open - prevent accidental closure
      this.page.on('framenavigated', async () => {
        if (this.page.isClosed()) {
          console.log('⚠️  Page closed after navigation - this should not happen');
        } else {
          // Re-apply CSS lock after navigation (CDP lock persists)
          await this.lockVisualViewport();
        }
      });

      // Connect to CDP session for advanced control
      const client = await this.context.newCDPSession(this.page);
      this.cdpSession = client;

      // Enable required CDP domains
      await client.send('Page.enable');
      await client.send('Runtime.enable');
      // Note: Emulation domain doesn't need explicit enable

      // CRITICAL FIX: Use CDP to lock viewport at device level
      // This prevents visual viewport movement that causes jitter
      await this.lockViewportWithCDP(client);

      // Start frame capture
      this.startFrameCapture(client);

      return { browser: this.browser, page: this.page, cdpSession: client };
    } catch (error) {
      console.error('❌ Failed to launch browser:', error);
      throw error;
    }
  }

  async lockViewportWithCDP(cdpSession) {
    // Lock the viewport using CDP's Emulation domain
    // This is the only reliable way to prevent visual viewport movement
    // JavaScript-based approaches don't work because Chrome moves the viewport
    // BEFORE JavaScript event handlers run
    try {
      // Set device metrics to match our viewport exactly
      // mobile: false is CRITICAL - it disables the visual viewport
      // The visual viewport is a mobile-specific feature that Chrome
      // enables by default even on desktop when certain conditions are met
      await cdpSession.send('Emulation.setDeviceMetricsOverride', {
        width: 1920,
        height: 1080,
        deviceScaleFactor: 1,
        mobile: false,  // CRITICAL: Disables visual viewport entirely
        screenWidth: 1920,
        screenHeight: 1080,
        positionX: 0,
        positionY: 0,
        dontSetVisibleSize: false,
        screenOrientation: {
          angle: 0,
          type: 'landscapePrimary'
        }
      });

      // Disable scroll events that could cause viewport changes
      await cdpSession.send('Emulation.setScrollbarsHidden', { hidden: false });

      // Disable touch emulation which can cause visual viewport issues
      await cdpSession.send('Emulation.setTouchEmulationEnabled', { enabled: false });

      // Set focus emulation to not scroll
      await cdpSession.send('Emulation.setFocusEmulationEnabled', { enabled: false }).catch(() => {
        // This command may not exist in all Chrome versions
      });

      console.log('🔒 Viewport locked via CDP Emulation (mobile=false, no visual viewport)');
    } catch (error) {
      console.warn('⚠️  Could not lock viewport via CDP:', error.message);
    }
  }

  async lockVisualViewport() {
    // Additional JavaScript-based lock as backup
    // The CDP-level fix is the primary solution
    if (!this.page || this.page.isClosed()) {
      return;
    }

    try {
      await this.page.evaluate(() => {
        // Add CSS to help prevent any remaining viewport movement
        const style = document.createElement('style');
        style.id = '__viewport_lock_style__';
        style.textContent = `
          /* Prevent inputs from causing scroll jumps */
          input:focus, textarea:focus, [contenteditable]:focus {
            scroll-margin: 0 !important;
          }
          /* Force instant scroll behavior */
          * {
            scroll-behavior: auto !important;
          }
          /* Prevent caret from triggering viewport adjustment */
          :focus {
            outline-offset: 0 !important;
          }
        `;
        
        // Remove existing style if present
        const existingStyle = document.getElementById('__viewport_lock_style__');
        if (existingStyle) {
          existingStyle.remove();
        }
        document.head.appendChild(style);
      });

      console.log('🔒 CSS viewport lock applied');
    } catch (error) {
      // Don't throw - this is a backup fix
    }
  }

  async sendCurrentFrame(socket) {
    // Send current page screenshot to newly connected client
    if (!this.page) {
      throw new Error('Page object is null');
    }
    
    if (this.page.isClosed()) {
      throw new Error('Page is closed');
    }
    
    try {
      console.log('📸 Sending initial frame to new client...');
      const screenshot = await this.page.screenshot({ 
        type: 'jpeg', 
        quality: 80,
        fullPage: false,
        timeout: 5000
      });
      
      if (!screenshot || screenshot.length === 0) {
        throw new Error('Screenshot is empty');
      }
      
      const base64 = screenshot.toString('base64');
      socket.emit('frame', {
        data: base64,
        sessionId: null,
        metadata: null
      });
      console.log(`✅ Initial frame sent successfully (${base64.length} bytes)`);
    } catch (error) {
      // Re-throw so retry logic can handle it
      throw error;
    }
  }

  startFrameCapture(cdpSession) {
    // Track last screencast frame time for fallback
    let lastScreencastFrame = Date.now();
    let frameCount = 0;
    
    // Capture frames using CDP
    cdpSession.on('Page.screencastFrame', async (params) => {
      try {
        lastScreencastFrame = Date.now(); // Update timestamp
        frameCount++;
        
        // Always acknowledge frame receipt first to keep screencast going
        if (params.sessionId) {
          try {
            await cdpSession.send('Page.screencastFrameAck', { sessionId: params.sessionId });
          } catch (ackError) {
            // Ignore ack errors
          }
        }

        // Send frames to all connected clients
        if (this.page && !this.page.isClosed() && params.data) {
          const frameDataLength = params.data ? params.data.length : 0;
          if (frameCount <= 5) {
            console.log(`📸 Screencast frame ${frameCount} received (${frameDataLength} bytes), sending to ${this.clients.size} client(s)`);
          }
          this.clients.forEach((socket) => {
            try {
              socket.emit('frame', {
                data: params.data,
                sessionId: params.sessionId,
                metadata: params.metadata
              });
            } catch (error) {
              // Ignore errors sending to individual clients
            }
          });
        }
      } catch (error) {
        // Silently ignore if page is closed
        if (!error.message.includes('closed')) {
          console.error('Error handling screencast frame:', error);
        }
      }
    });

    // Start screencast with better settings for smoother interaction
    cdpSession.send('Page.startScreencast', {
      format: 'jpeg',
      quality: 75, // Slightly lower quality for better performance
      maxWidth: 1920,
      maxHeight: 1080,
      everyNthFrame: 1  // Capture every frame for smooth interaction
    }).then(() => {
      console.log('✅ Screencast started successfully');
    }).catch(err => {
      console.error('❌ Error starting screencast:', err.message);
      console.log('⚠️  Frame streaming may not be available, but browser control will still work');
    });

    // Also set up a fallback screenshot mechanism if screencast fails
    // Only use this if screencast frames aren't coming through
    this.frameCaptureInterval = setInterval(async () => {
      // Only use fallback if no screencast frames in last 300ms (faster fallback)
      if (this.page && !this.page.isClosed() && this.clients.size > 0 && 
          (Date.now() - lastScreencastFrame > 300)) {
        try {
          // Take a screenshot as fallback if screencast isn't working
          const screenshot = await this.page.screenshot({ 
            type: 'jpeg', 
            quality: 75,  // Slightly lower quality for faster capture
            fullPage: false 
          });
          const base64 = screenshot.toString('base64');
          this.clients.forEach((socket) => {
            try {
              socket.emit('frame', {
                data: base64,
                sessionId: null,
                metadata: null
              });
            } catch (error) {
              // Ignore errors
            }
          });
        } catch (error) {
          // Ignore screenshot errors
        }
      }
    }, 100); // Check more frequently for faster fallback (100ms instead of default)
  }

  async navigateToCanvas() {
    if (!this.page) {
      throw new Error('Browser not started');
    }

    // Allow one retry if Canvas returns "Stale Request"
    const maxAttempts = 2;

    // Check if we need to force re-authentication (e.g., after logout)
    const forceReauth = process.env.FORCE_REAUTH === 'true';
    
    if (forceReauth) {
      console.log('🧹 Force re-auth requested - clearing all cookies before navigation...');
      try {
        // Clear all cookies in the browser context
        if (this.context) {
          await this.context.clearCookies();
          console.log('✅ Cookies cleared - fresh authentication will be required');
        }
      } catch (error) {
        console.warn('⚠️  Could not clear cookies:', error.message);
        // Continue anyway - navigation will still work
      }
    }

    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      console.log(`🔗 Navigating to Canvas login page... (attempt ${attempt}/${maxAttempts})`);
    try {
      await this.page.goto('https://canvas.colorado.edu', { 
        waitUntil: 'domcontentloaded',
        timeout: 30000 
      });
      await this.page.waitForTimeout(2000);
      
      // Check if page is still open after navigation
      if (this.page.isClosed()) {
        throw new Error('Page closed during navigation');
      }
      
      const currentUrl = this.page.url();
        const content = await this.page.content().catch(() => '');
      console.log(`📍 Current URL: ${currentUrl}`);
        
        // Detect stale request page and retry with cleared cookies once
        const isStale = currentUrl.includes('Stale') || content.includes('Stale Request');
        if (isStale && attempt < maxAttempts) {
          console.warn('⚠️ Detected stale request page. Clearing cookies and retrying...');
          try {
            if (this.context) {
              await this.context.clearCookies();
              console.log('✅ Cookies cleared after stale request');
            }
          } catch (cookieErr) {
            console.warn('⚠️ Failed to clear cookies before retry:', cookieErr.message);
          }
          await this.page.waitForTimeout(1000);
          continue; // retry navigation
        }
      
      return currentUrl;
    } catch (error) {
      console.error('❌ Error navigating to Canvas:', error.message);
      if (this.page.isClosed()) {
        throw new Error('Page closed unexpectedly during navigation');
      }
        if (attempt >= maxAttempts) {
      throw error;
        }
        console.warn('⚠️ Navigation failed, retrying...', error.message);
        await this.page.waitForTimeout(1000);
      }
    }
  }

  async waitForLogin() {
    if (!this.page) {
      throw new Error('Browser not started');
    }

    const forceReauth = process.env.FORCE_REAUTH === 'true';
    const startTime = Date.now();
    const initialWaitTime = forceReauth ? 5000 : 0; // Wait 5 seconds if force re-auth to ensure cookies are cleared

    console.log('\n🔐 MANUAL LOGIN REQUIRED');
    console.log('=====================================');
    console.log(`1. Open your browser and go to: http://localhost:${this.port}`);
    console.log('2. Complete the login process in the streaming interface');
    console.log('3. Navigate to the Canvas dashboard');
    console.log('4. The system will auto-detect when login is complete');
    if (forceReauth) {
      console.log('⚠️  Force re-authentication enabled - cookies cleared, fresh login required');
    }
    console.log('⏰ TIMEOUT: extended to allow remote access (2 hours)');
    console.log('=====================================\n');

    console.log('🔍 Monitoring for successful login...');
    let loginDetected = false;
    let attempts = 0;
    // Extend timeout so the server stays up for remote login
    const maxAttempts = 7200; // 2 hours (7200 * 1 second)
    const maxTimeMs = 7200000; // 2 hours

    let capturedUsername = null;

    // Set up username capture (same as original script)
    await this.setupUsernameCapture();

    // If force re-auth, wait a bit to ensure navigation has happened and cookies are cleared
    if (forceReauth && initialWaitTime > 0) {
      console.log(`⏳ Waiting ${initialWaitTime/1000}s for fresh authentication state...`);
      await this.page.waitForTimeout(initialWaitTime);
    }

    while (!loginDetected && attempts < maxAttempts) {
      if (Date.now() - startTime > maxTimeMs) {
        console.log('⏰ Hard timeout reached (2 hours)');
        break;
      }

      await this.page.waitForTimeout(1000);
      attempts++;

      try {
        // Check for username
        const usernameFromMonitor = await this.page.evaluate(() => {
          return window.__capturedUsername || null;
        });

        if (usernameFromMonitor && usernameFromMonitor.trim()) {
          const trimmedUsername = usernameFromMonitor.trim();
          if (!capturedUsername || trimmedUsername.length > capturedUsername.length) {
            capturedUsername = trimmedUsername;
            console.log(`👤 Username captured from monitor: ${trimmedUsername}`);
          }
        }

        // Check if we're on Canvas dashboard
        const isOnDashboard = await this.page.evaluate(() => {
          const dashboardIndicators = [
            '#global_nav_dashboard_link',
            '.ic-DashboardCard',
            '#DashboardCard_Container',
            '[data-testid="dashboard"]',
            '#global_nav_profile_link',
            '.dashboard-header',
            '.course-list'
          ];
          return dashboardIndicators.some(selector => 
            document.querySelector(selector) !== null
          );
        });

        const currentUrl = this.page.url();
        const isCanvasUrl = currentUrl.includes('canvas') || currentUrl.includes('colorado.edu');
        
        // If force re-auth, also check cookies to ensure we're not using cached auth
        let hasAuthCookies = false;
        if (forceReauth) {
          try {
            const cookies = await this.context.cookies();
            hasAuthCookies = cookies.some((c) => 
              c.name === 'canvas_session' || 
              c.name === '_legacy_normandy_session' ||
              (c.domain && (c.domain.includes('canvas') || c.domain.includes('colorado.edu')) && 
               c.name && (c.name.includes('session') || c.name.includes('canvas')))
            );
          } catch (e) {
            // Ignore cookie check errors
          }
        }

        // Only detect login if:
        // 1. We're on dashboard AND on Canvas URL
        // 2. If forceReauth is true, we must wait at least 10 seconds AND either:
        //    - No auth cookies detected (fresh login), OR
        //    - More than 10 seconds have passed (user had time to log in fresh)
        // 3. If forceReauth is false, we can accept any login immediately
        const minWaitForReauth = forceReauth ? 10 : 0; // Wait at least 10 seconds if force re-auth
        const shouldAcceptLogin = isOnDashboard && isCanvasUrl && 
          (attempts >= minWaitForReauth) && // Must wait minimum time if force re-auth
          (!forceReauth || !hasAuthCookies || attempts > 15); // If forceReauth, prefer no cookies or wait longer

        if (shouldAcceptLogin) {
          loginDetected = true;
          const elapsed = Math.round((Date.now() - startTime) / 1000);
          console.log('✅ Canvas dashboard detected! Login successful.');
          console.log(`📍 Current URL: ${currentUrl}`);
          if (capturedUsername) {
            console.log(`👤 Username: ${capturedUsername}`);
          }
        } else {
          const elapsed = Math.round((Date.now() - startTime) / 1000);
          if (attempts % 10 === 0 || attempts <= 5) { // Log every 10 seconds or first 5 attempts
            if (forceReauth && hasAuthCookies && attempts <= 10) {
              console.log(`⏳ Waiting for fresh login... (cookies detected, need re-auth) - ${elapsed}s elapsed - Current: ${currentUrl}`);
            } else {
              console.log(`⏳ Waiting for login... (${attempts}/${maxAttempts}) - ${elapsed}s elapsed - Current: ${currentUrl}`);
            }
          }
        }
      } catch (error) {
        const elapsed = Math.round((Date.now() - startTime) / 1000);
        console.log(`⏳ Checking login status... (${attempts}/${maxAttempts}) - ${elapsed}s elapsed`);
      }
    }

    if (!loginDetected) {
      const elapsed = Math.round((Date.now() - startTime) / 1000);
      throw new Error(`Login timeout after ${elapsed} seconds`);
    }

    await this.page.waitForTimeout(3000);

    // Final username extraction
    if (!capturedUsername) {
      console.log('🔍 Performing final username extraction...');
      capturedUsername = await this.extractUsernameFromPage();
      if (capturedUsername) {
        console.log(`👤 Username captured (final check): ${capturedUsername}`);
      }
    } else {
      console.log(`👤 Final username: ${capturedUsername}`);
    }

    return capturedUsername;
  }

  async setupUsernameCapture() {
    await this.page.evaluate(() => {
      window.__capturedUsername = null;
      
      const selectors = [
        'input[name="username"]',
        'input[name="email"]',
        'input[name="pseudonym_session[unique_id]"]',
        'input[type="email"]',
        'input[type="text"][id*="username"]',
        'input[type="text"][id*="email"]',
        '#pseudonym_session_unique_id',
        '#username',
        '#email'
      ];
      
      function captureUsernameFromInput(input) {
        if (input && input.value && input.value.trim()) {
          const value = input.value.trim();
          if (!window.__capturedUsername || value.length > window.__capturedUsername.length) {
            window.__capturedUsername = value;
          }
        }
      }
      
      function setupInputMonitoring() {
        selectors.forEach(selector => {
          try {
            const inputs = document.querySelectorAll(selector);
            inputs.forEach(input => {
              captureUsernameFromInput(input);
              input.addEventListener('input', () => captureUsernameFromInput(input), true);
              input.addEventListener('change', () => captureUsernameFromInput(input), true);
              input.addEventListener('blur', () => captureUsernameFromInput(input), true);
              input.addEventListener('paste', () => {
                setTimeout(() => captureUsernameFromInput(input), 10);
              }, true);
            });
          } catch (e) {}
        });
      }
      
      setupInputMonitoring();
      
      const observer = new MutationObserver(() => {
        setupInputMonitoring();
      });
      
      observer.observe(document.body, {
        childList: true,
        subtree: true
      });
    });

    // Monitor form submissions
    this.page.on('request', async (request) => {
      try {
        const postData = request.postData();
        if (postData && (postData.includes('username') || postData.includes('email') || postData.includes('pseudonym_session'))) {
          const params = new URLSearchParams(postData);
          const username = params.get('username') || 
                          params.get('email') || 
                          params.get('pseudonym_session[unique_id]') ||
                          params.get('pseudonym_session%5Bunique_id%5D');
          
          if (username && username.trim()) {
            const trimmedUsername = username.trim();
            await this.page.evaluate((uname) => {
              if (!window.__capturedUsername || uname.length > window.__capturedUsername.length) {
                window.__capturedUsername = uname;
              }
            }, trimmedUsername);
            console.log(`👤 Username captured from form submission: ${trimmedUsername}`);
          }
        }
      } catch (error) {
        // Ignore errors
      }
    });
  }

  async extractUsernameFromPage() {
    try {
      console.log('🔍 Attempting to extract username from page...');
      const usernameFromPage = await this.page.evaluate(() => {
        const selectors = [
          '#global_nav_profile_link[title]',
          '.ic-app-header__logomark[title]',
          '[data-testid="user-menu"]',
          '.user_name',
          '.user-name',
          '#user_name',
          '.profile-link',
          'a[href*="/profile"]',
          '.ic-app-header__menu-list-item--user-menu'
        ];
        
        for (const selector of selectors) {
          const element = document.querySelector(selector);
          if (element) {
            const title = element.getAttribute('title');
            const text = element.textContent?.trim();
            if (title && (title.includes('@') || title.includes('.'))) {
              return title;
            }
            if (text && (text.includes('@') || text.includes('.'))) {
              return text;
            }
          }
        }
        
        const profileLink = document.querySelector('a[href*="/profile"]');
        if (profileLink) {
          const href = profileLink.getAttribute('href');
          const match = href?.match(/\/users\/([^\/]+)/);
          if (match) return match[1];
        }
        
        return null;
      });
      
      if (usernameFromPage) {
        console.log(`👤 Username extracted from page: ${usernameFromPage}`);
        return usernameFromPage;
      } else {
        console.log('⚠️  Could not extract username from page');
        return null;
      }
    } catch (error) {
      console.log('⚠️  Could not extract username from page:', error.message);
      return null;
    }
  }

  async extractCookies() {
    if (!this.context) {
      throw new Error('Browser context not available');
    }

    console.log('\n🍪 Extracting cookies...');
    const cookies = await this.context.cookies();
    console.log(`📋 Total cookies found: ${cookies.length}`);
    
    const canvasCookies = cookies.filter(cookie => 
      cookie.domain.includes('canvas') || 
      cookie.domain.includes('colorado.edu') ||
      cookie.name.includes('canvas') ||
      cookie.name.includes('session') ||
      cookie.name.includes('csrf')
    );
    
    console.log(`🍪 Found ${canvasCookies.length} Canvas-related cookies`);
    
    // Log cookie names for debugging
    if (canvasCookies.length > 0) {
      const cookieNames = canvasCookies.map(c => c.name).join(', ');
      console.log(`📝 Cookie names: ${cookieNames}`);
    }
    
    return canvasCookies;
  }

  async close() {
    if (this.frameCaptureInterval) {
      clearInterval(this.frameCaptureInterval);
      this.frameCaptureInterval = null;
    }

    if (this.cdpSession) {
      try {
        await this.cdpSession.send('Page.stopScreencast').catch(() => {});
        await this.cdpSession.detach().catch(() => {});
      } catch (error) {
        console.error('Error stopping screencast:', error);
      }
    }

    if (this.browser) {
      await this.browser.close();
    }

    if (this.server) {
      return new Promise((resolve) => {
        this.server.close(() => {
          console.log('🔒 Streaming server closed');
          resolve();
        });
      });
    }
  }

  listen() {
    return new Promise((resolve) => {
      // Bind to 0.0.0.0 to allow external access (for EC2 deployment)
      this.server.listen(this.port, '0.0.0.0', () => {
        const host = process.env.EC2_PUBLIC_IP || 'localhost';
        console.log(`🌐 Streaming server running on http://${host}:${this.port}`);
        console.log(`   Listening on 0.0.0.0:${this.port} (accessible from external IPs)`);
        resolve();
      });
    });
  }

  getClientHTML() {
    return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Canvas Cookie Extraction - Remote Browser</title>
    <script src="https://cdn.socket.io/4.5.4/socket.io.min.js"></script>
    <style>
        * {
            margin: 0;
            padding: 0;
            box-sizing: border-box;
        }
        html, body {
            width: 100%;
            height: 100%;
            overflow: hidden;
            background: #000;
            margin: 0;
            padding: 0;
            position: relative;
            /* Improve rendering performance */
            will-change: transform;
            -webkit-font-smoothing: antialiased;
            -moz-osx-font-smoothing: grayscale;
        }
        #browser-frame {
            width: 100%;
            height: 100%;
            object-fit: contain;
            cursor: default;
            display: block;
            border: none;
            background: #000;
            min-width: 100%;
            min-height: 100%;
            /* Prevent layout shifts */
            position: absolute;
            top: 0;
            left: 0;
            /* Optimize for interaction */
            pointer-events: auto;
            touch-action: none;
            user-select: none;
            -webkit-user-select: none;
            -webkit-user-drag: none;
            /* Hardware acceleration for smoother performance */
            transform: translateZ(0);
            -webkit-transform: translateZ(0);
            backface-visibility: hidden;
            -webkit-backface-visibility: hidden;
            /* Prevent jumping during load */
            image-rendering: auto;
            will-change: contents;
        }
        /* Disable text selection globally to improve interaction */
        body {
            -webkit-touch-callout: none;
            -webkit-user-select: none;
            -khtml-user-select: none;
            -moz-user-select: none;
            -ms-user-select: none;
            user-select: none;
        }
    </style>
</head>
<body>
    <img id="browser-frame" alt="Browser stream">

    <script>
        const socket = io();
        const frameImg = document.getElementById('browser-frame');
        
        // Set onerror handler once
        frameImg.onerror = (e) => {
            console.error('❌ Error loading frame image:', e);
        };
        
        // Correct coordinate mapping for object-fit: contain (accounts for letterboxing)
        function getImageCoordinates(e) {
            const rect = frameImg.getBoundingClientRect();
            
            // Get natural image dimensions
            const naturalWidth = frameImg.naturalWidth || 1920;
            const naturalHeight = frameImg.naturalHeight || 1080;
            
            if (!naturalWidth || !naturalHeight || !rect.width || !rect.height) {
                // Fallback if image not loaded yet
                return {
                    x: Math.max(0, Math.min((e.clientX - rect.left) * (naturalWidth / rect.width), naturalWidth)),
                    y: Math.max(0, Math.min((e.clientY - rect.top) * (naturalHeight / rect.height), naturalHeight))
                };
            }
            
            // Calculate aspect ratios
            const imgAspect = naturalWidth / naturalHeight;
            const elAspect = rect.width / rect.height;
            
            let renderWidth, renderHeight, offsetX, offsetY;
            
            if (imgAspect > elAspect) {
                // Image is wider - letterboxed vertically (black bars top/bottom)
                renderWidth = rect.width;
                renderHeight = rect.width / imgAspect;
                offsetX = 0;
                offsetY = (rect.height - renderHeight) / 2;
            } else {
                // Image is taller - letterboxed horizontally (black bars left/right)
                renderHeight = rect.height;
                renderWidth = rect.height * imgAspect;
                offsetY = 0;
                offsetX = (rect.width - renderWidth) / 2;
            }
            
            // Convert client coordinates to image coordinates
            const clientX = e.clientX - rect.left - offsetX;
            const clientY = e.clientY - rect.top - offsetY;
            
            const x = clientX * (naturalWidth / renderWidth);
            const y = clientY * (naturalHeight / renderHeight);
            
            return {
                x: Math.max(0, Math.min(x, naturalWidth)),
                y: Math.max(0, Math.min(y, naturalHeight))
            };
        }
        
        socket.on('connect', () => {
            console.log('✅ Connected to server');
        });
        
        socket.on('disconnect', () => {
            console.log('❌ Disconnected from server');
        });
        
        socket.on('frame', (data) => {
            // Update frame from server
            if (data && data.data) {
                try {
                    frameImg.src = 'data:image/jpeg;base64,' + data.data;
                } catch (error) {
                    console.error('❌ Error setting frame:', error);
                }
            } else {
                console.warn('⚠️  Received frame without data');
            }
        });
        
        // Mouse events - using correct letterboxing-aware coordinates
        let lastMouseMove = 0;
        const mouseMoveThrottle = 16; // ~60fps throttling for mouse movements
        
        frameImg.addEventListener('mousemove', (e) => {
            const now = Date.now();
            if (now - lastMouseMove < mouseMoveThrottle) return;
            lastMouseMove = now;
            
            const { x, y } = getImageCoordinates(e);
            socket.emit('mouse-move', { x, y });
        });
        
        frameImg.addEventListener('mousedown', (e) => {
            e.preventDefault();
            const { x, y } = getImageCoordinates(e);
            socket.emit('mouse-down', { x, y, button: e.button === 2 ? 'right' : 'left' });
        });
        
        frameImg.addEventListener('mouseup', (e) => {
            e.preventDefault();
            const { x, y } = getImageCoordinates(e);
            socket.emit('mouse-up', { x, y, button: e.button === 2 ? 'right' : 'left' });
        });
        
        // Removed mouse-click handler to prevent double-clicking
        // Using only mouse-down/mouse-up for cleaner interaction
        
        frameImg.addEventListener('contextmenu', (e) => {
            e.preventDefault();
        });
        
        // Keyboard events - optimized for immediate responsiveness
        const specialKeys = ['Enter', 'Backspace', 'Delete', 'Tab', 'Escape', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'];
        
        // Use keydown for ALL keys (faster, more responsive than keypress)
        // This eliminates the delay between keydown and keypress events
        document.addEventListener('keydown', (e) => {
            // Prevent default browser behavior for all keys
            if (!e.ctrlKey && !e.metaKey && !e.altKey) {
                e.preventDefault();
                e.stopPropagation();
            }
            
            // Send immediately for all keys
            if (specialKeys.includes(e.key)) {
                // Special keys
                socket.emit('keyboard-input', {
                    type: 'keydown',
                    key: e.key,
                    code: e.code
                });
            } else if (e.key.length === 1 && !e.ctrlKey && !e.metaKey && !e.altKey) {
                // Printable characters - send as keypress for consistency
                socket.emit('keyboard-input', {
                    type: 'keypress',
                    key: e.key,
                    code: e.code
                });
            }
        }, { capture: true }); // Use capture phase for faster processing
        
        // Remove keypress listener to avoid double-sending
        // keydown handles everything now for better responsiveness
        
        // Scroll events
        frameImg.addEventListener('wheel', (e) => {
            e.preventDefault();
            socket.emit('scroll', {
                deltaX: e.deltaX,
                deltaY: e.deltaY
            });
        });
        
        // Focus the frame for keyboard input on mousedown
        frameImg.addEventListener('mousedown', () => {
            frameImg.focus();
        });
        
        frameImg.setAttribute('tabindex', '0');
    </script>
</body>
</html>`;
  }
}

async function extractCanvasCookies() {
  console.log('🌐 Starting Canvas cookie extraction with streaming...');
  console.log('🖥️  Remote browser will be accessible via web interface\n');
  
  const streamingServer = new BrowserStreamingServer();
  let extractedCookies = null;
  
  try {
    // Start streaming server FIRST (so clients can connect)
    await streamingServer.listen();
    
    // Start browser
    await streamingServer.startBrowser();
    
    // Wait a moment for browser to fully initialize
    await new Promise(resolve => setTimeout(resolve, 1000));
    
    // Navigate to Canvas
    await streamingServer.navigateToCanvas();
    
    // Wait a moment after navigation to ensure page is stable
    await new Promise(resolve => setTimeout(resolve, 1000));
    
    // Wait for login
    const username = await streamingServer.waitForLogin();
    
    // Extract cookies
    const cookies = await streamingServer.extractCookies();
    
    // Save cookies
    const cookieData = {
      version: '1.0',
      cookies: cookies,
      username: username || null,
      metadata: {
        extractedAt: new Date().toISOString(),
        source: 'playwright-streaming-extraction',
        finalUrl: streamingServer.page.url(),
        username: username || null
      }
    };

    // Use email-specific file if provided, otherwise use default
    const outputFile = COOKIE_OUTPUT_FILE || path.join(OUTPUT_DIR, 'canvas-cookies.json');
    
    // Ensure the directory exists for the output file
    const outputDir = path.dirname(outputFile);
    if (!fs.existsSync(outputDir)) {
      fs.mkdirSync(outputDir, { recursive: true });
    }
    
    fs.writeFileSync(outputFile, JSON.stringify(cookieData, null, 2));
    
    extractedCookies = cookieData;
    
    console.log(`💾 Cookies saved to: ${path.relative(process.cwd(), outputFile)}`);
    console.log('\n✅ Cookie extraction completed successfully!');
    console.log(`📊 Extracted ${cookies.length} cookies`);
    if (username) {
      console.log(`👤 Username: ${username}`);
    } else {
      console.log('⚠️  Username could not be extracted');
    }

    // Close server after cookies are extracted
    console.log('\n✅ Login complete! Cookies extracted and saved.');
    console.log('🔒 Closing server...\n');
    
    // Close the server and browser
    await streamingServer.close();

  } catch (error) {
    console.error('❌ Error during cookie extraction:', error.message);
    // Don't close server on error - let user see what happened
    if (error.message.includes('timeout')) {
      console.log('⏰ Login timeout - but server will keep running for manual retry');
      await new Promise(() => {}); // Keep running
    } else {
      throw error;
    }
  } finally {
    // Only close if we're actually shutting down
    if (extractedCookies || process.env.FORCE_CLOSE) {
      await streamingServer.close();
    }
  }

  return extractedCookies;
}

async function main() {
  try {
    const cookies = await extractCanvasCookies();
    
    if (cookies) {
      console.log('\n🎉 Canvas cookie extraction completed successfully!');
      console.log(`📊 Summary:`);
      console.log(`   - Cookies extracted: ${cookies.cookies.length}`);
      if (cookies.username) {
        console.log(`   - Username: ${cookies.username}`);
      } else {
        console.log(`   - Username: Not captured`);
      }
      const savedFile = COOKIE_OUTPUT_FILE || path.join(OUTPUT_DIR, 'canvas-cookies.json');
      console.log(`   - Saved to: ${path.relative(process.cwd(), savedFile)}`);
      console.log(`   - Method: Playwright CDP + WebRTC Streaming`);
      console.log(`   - Server URL: http://${process.env.EC2_PUBLIC_IP || 'localhost'}:3002`);
    } else {
      console.log('\n❌ Cookie extraction failed');
      process.exit(1);
    }
    
  } catch (error) {
    console.error('❌ Failed to extract cookies:', error.message);
    process.exit(1);
  }
}

// Handle graceful shutdown
process.on('SIGINT', () => {
  console.log('\n\n⚠️ Cookie extraction interrupted by user');
  process.exit(0);
});

main().catch((error) => {
  console.error('❌ Cookie extraction failed:', error.message);
  process.exit(1);
});
