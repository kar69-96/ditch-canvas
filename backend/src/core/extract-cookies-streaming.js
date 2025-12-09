#!/usr/bin/env node
// Load .env from backend directory (where script is located) or project root
const path = require('path');
const fs = require('fs');
const dotenv = require('dotenv');
const http = require('http');
const express = require('express');
const { Server } = require('socket.io');
const { chromium } = require('playwright-core');

// Try to load .env from backend directory first, then project root
const backendEnvPath = path.join(__dirname, '..', '..', '.env');
const rootEnvPath = path.join(__dirname, '..', '..', '..', '.env');

if (fs.existsSync(backendEnvPath)) {
  dotenv.config({ path: backendEnvPath });
} else if (fs.existsSync(rootEnvPath)) {
  dotenv.config({ path: rootEnvPath });
} else {
  dotenv.config(); // Try default locations
}

// Use home directory for output on EC2, or relative path for local
const OUTPUT_DIR = process.env.OUTPUT_DIR || 
  (process.env.HOME 
    ? path.join(process.env.HOME, 'canvas-wrapper-data', 'auth')
    : path.join(__dirname, '..', '..', 'data', 'auth'));
const STREAMING_PORT = process.env.STREAMING_PORT || 3002;

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
    // Serve the HTML5 client
    this.app.get('/', (req, res) => {
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

      // Handle mouse events from client
      socket.on('mouse-move', async (data) => {
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

      socket.on('mouse-click', async (data) => {
        if (this.page && !this.page.isClosed()) {
          try {
            // Use mouse click method which is more reliable for interactive elements
            await this.page.mouse.move(data.x, data.y, { steps: 1 });
            await this.page.mouse.click(data.x, data.y, { 
              button: data.button || 'left',
              clickCount: 1,
              delay: 10
            });
            // Small delay to ensure the click is processed and focus is set
            await new Promise(resolve => setTimeout(resolve, 100));
          } catch (error) {
            // Silently ignore if page is closed
            if (!error.message.includes('closed')) {
              console.error('Error clicking:', error);
            }
          }
        }
      });

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
    console.log('🚀 Starting headful Chromium with CDP...');
    
    // Check if running in headless environment (EC2 with Xvfb)
    const isHeadlessEnv = !process.env.DISPLAY || process.env.DISPLAY.includes(':99');
    
    const launchOptions = {
      headless: false, // Always headful for streaming, but will use Xvfb display if available
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
    if (isHeadlessEnv && process.env.DISPLAY) {
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
      this.context = await this.browser.newContext({
        viewport: { width: 1920, height: 1080 },
        // Block all downloads - fully web-based
        acceptDownloads: false
      });
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
      this.page.on('framenavigated', () => {
        if (this.page.isClosed()) {
          console.log('⚠️  Page closed after navigation - this should not happen');
        }
      });

      // Connect to CDP session for advanced control
      const client = await this.context.newCDPSession(this.page);
      this.cdpSession = client;

      // Enable Page domain for frame capture
      await client.send('Page.enable');
      await client.send('Runtime.enable');

      // Start frame capture
      this.startFrameCapture(client);

      return { browser: this.browser, page: this.page, cdpSession: client };
    } catch (error) {
      console.error('❌ Failed to launch browser:', error);
      throw error;
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

    // Start screencast with better settings
    cdpSession.send('Page.startScreencast', {
      format: 'jpeg',
      quality: 80,
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
      // Only use fallback if no screencast frames in last 500ms
      if (this.page && !this.page.isClosed() && this.clients.size > 0 && 
          (Date.now() - lastScreencastFrame > 500)) {
        try {
          // Take a screenshot as fallback if screencast isn't working
          const screenshot = await this.page.screenshot({ 
            type: 'jpeg', 
            quality: 80,
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
    }, 200); // Check every 200ms for fallback
  }

  async navigateToCanvas() {
    if (!this.page) {
      throw new Error('Browser not started');
    }

    console.log('🔗 Navigating to Canvas login page...');
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
      console.log(`📍 Current URL: ${currentUrl}`);
      
      return currentUrl;
    } catch (error) {
      console.error('❌ Error navigating to Canvas:', error.message);
      if (this.page.isClosed()) {
        throw new Error('Page closed unexpectedly during navigation');
      }
      throw error;
    }
  }

  async waitForLogin() {
    if (!this.page) {
      throw new Error('Browser not started');
    }

    console.log('\n🔐 MANUAL LOGIN REQUIRED');
    console.log('=====================================');
    console.log(`1. Open your browser and go to: http://localhost:${this.port}`);
    console.log('2. Complete the login process in the streaming interface');
    console.log('3. Navigate to the Canvas dashboard');
    console.log('4. The system will auto-detect when login is complete');
    console.log('⏰ TIMEOUT: extended to allow remote access (2 hours)');
    console.log('=====================================\n');

    console.log('🔍 Monitoring for successful login...');
    let loginDetected = false;
    let attempts = 0;
    // Extend timeout so the server stays up for remote login
    const maxAttempts = 7200; // 2 hours (7200 * 1 second)
    const startTime = Date.now();
    const maxTimeMs = 7200000; // 2 hours

    let capturedUsername = null;

    // Set up username capture (same as original script)
    await this.setupUsernameCapture();

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

        if (isOnDashboard && isCanvasUrl) {
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
            console.log(`⏳ Waiting for login... (${attempts}/${maxAttempts}) - ${elapsed}s elapsed - Current: ${currentUrl}`);
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
        }
        #browser-frame {
            width: 100%;
            height: 100%;
            object-fit: contain;
            cursor: crosshair;
            display: block;
            border: none;
            background: #000;
            min-width: 100%;
            min-height: 100%;
        }
    </style>
</head>
<body>
    <img id="browser-frame" alt="Browser stream">

    <script>
        const socket = io();
        const frameImg = document.getElementById('browser-frame');
        
        let scaleX = 1;
        let scaleY = 1;
        
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
                    
                    // Calculate scale for coordinate mapping
                    frameImg.onload = () => {
                        scaleX = frameImg.naturalWidth / frameImg.clientWidth;
                        scaleY = frameImg.naturalHeight / frameImg.clientHeight;
                    };
                    
                    frameImg.onerror = (e) => {
                        console.error('❌ Error loading frame image:', e);
                    };
                } catch (error) {
                    console.error('❌ Error setting frame:', error);
                }
            } else {
                console.warn('⚠️  Received frame without data');
            }
        });
        
        // Mouse events
        frameImg.addEventListener('mousemove', (e) => {
            const rect = frameImg.getBoundingClientRect();
            const x = (e.clientX - rect.left) * scaleX;
            const y = (e.clientY - rect.top) * scaleY;
            socket.emit('mouse-move', { x, y });
        });
        
        frameImg.addEventListener('click', (e) => {
            const rect = frameImg.getBoundingClientRect();
            const x = (e.clientX - rect.left) * scaleX;
            const y = (e.clientY - rect.top) * scaleY;
            socket.emit('mouse-click', { x, y, button: e.button === 2 ? 'right' : 'left' });
        });
        
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
        
        // Focus the frame for keyboard input
        frameImg.addEventListener('click', () => {
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

    const outputFile = path.join(OUTPUT_DIR, 'canvas-cookies.json');
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
      console.log(`   - Saved to: ${path.relative(process.cwd(), path.join(OUTPUT_DIR, 'canvas-cookies.json'))}`);
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
