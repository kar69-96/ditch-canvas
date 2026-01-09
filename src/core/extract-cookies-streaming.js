#!/usr/bin/env node

/**
 * Canvas Cookie Extraction - Streaming Mode
 *
 * Launches a browser session and streams the screen to connected clients via WebSocket.
 * Allows users to interact with the browser remotely while cookies are extracted.
 */

const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const { chromium } = require('playwright-core');
const fs = require('fs');
const path = require('path');
const { createClient } = require('@supabase/supabase-js');
require('dotenv').config();

// Configuration
const PORT = parseInt(process.env.STREAMING_PORT || '3002');
const CANVAS_URL = process.env.CANVAS_URL || 'https://canvas.colorado.edu';
const COOKIE_OUTPUT_FILE = process.env.COOKIE_OUTPUT_FILE || path.join(__dirname, '../../data/auth/canvas-cookies.json');
const EXTRACTION_EMAIL = process.env.EXTRACTION_EMAIL;

// Initialize Express app
const app = express();

// Add CORS middleware for all routes
app.use((req, res, next) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  next();
});

const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: '*',
    methods: ['GET', 'POST']
  },
  // Optimize for low latency
  pingInterval: 10000,
  pingTimeout: 5000,
  transports: ['websocket', 'polling'],
  allowUpgrades: true,
  perMessageDeflate: false // Disable compression for lower latency
});

// Ensure output directory exists
const outputDir = path.dirname(COOKIE_OUTPUT_FILE);
if (!fs.existsSync(outputDir)) {
  fs.mkdirSync(outputDir, { recursive: true });
}

// Store browser context
let browserContext = null;
let page = null;
let extractionComplete = false;

/**
 * Serve the streaming viewer HTML page (minimal UI, fullscreen)
 */
app.get('/', (req, res) => {
  res.send(`
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Canvas Login</title>
  <script src="/socket.io/socket.io.js"></script>
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
      background: #fff;
    }
    #canvas {
      display: block;
      width: 100%;
      height: 100%;
      cursor: pointer;
      object-fit: contain;
    }
    .loading {
      position: absolute;
      top: 50%;
      left: 50%;
      transform: translate(-50%, -50%);
      text-align: center;
      color: #666;
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
    }
    .spinner {
      border: 4px solid #f3f3f3;
      border-top: 4px solid #667eea;
      border-radius: 50%;
      width: 50px;
      height: 50px;
      animation: spin 1s linear infinite;
      margin: 0 auto 15px;
    }
    @keyframes spin {
      0% { transform: rotate(0deg); }
      100% { transform: rotate(360deg); }
    }
    .hidden { display: none; }
  </style>
</head>
<body>
  <div class="loading" id="loading">
    <div class="spinner"></div>
    <p>Loading Canvas...</p>
  </div>
  <canvas id="canvas" class="hidden"></canvas>

  <script>
    const socket = io();
    const canvas = document.getElementById('canvas');
    const ctx = canvas.getContext('2d', { alpha: false });
    const loading = document.getElementById('loading');
    let isConnected = false;
    let canvasReady = false;

    socket.on('connect', () => {
      console.log('Connected to streaming server');
      isConnected = true;
    });

    socket.on('frame', (data) => {
      const img = new Image();
      img.onload = () => {
        canvas.width = img.width;
        canvas.height = img.height;
        ctx.drawImage(img, 0, 0);

        // Show canvas on first frame
        if (!canvasReady) {
          loading.classList.add('hidden');
          canvas.classList.remove('hidden');
          canvasReady = true;
        }
      };
      img.src = 'data:image/jpeg;base64,' + data;
    });

    socket.on('extraction-complete', () => {
      setTimeout(() => window.close(), 1500);
    });

    socket.on('error', (message) => {
      loading.innerHTML = '<p style="color: #c33;">Error: ' + message + '</p>';
    });

    // Mouse events with proper coordinate mapping
    canvas.addEventListener('mousemove', (e) => {
      if (!isConnected || !canvasReady) return;

      const rect = canvas.getBoundingClientRect();
      const scaleX = canvas.width / rect.width;
      const scaleY = canvas.height / rect.height;
      const x = Math.round((e.clientX - rect.left) * scaleX);
      const y = Math.round((e.clientY - rect.top) * scaleY);

      socket.emit('mouse-move', { x, y });
    });

    canvas.addEventListener('mousedown', (e) => {
      if (!isConnected || !canvasReady) return;
      e.preventDefault();

      const rect = canvas.getBoundingClientRect();
      const scaleX = canvas.width / rect.width;
      const scaleY = canvas.height / rect.height;
      const x = Math.round((e.clientX - rect.left) * scaleX);
      const y = Math.round((e.clientY - rect.top) * scaleY);

      socket.emit('mouse-down', { x, y, button: e.button === 2 ? 'right' : 'left' });
    });

    canvas.addEventListener('mouseup', (e) => {
      if (!isConnected || !canvasReady) return;
      e.preventDefault();

      const rect = canvas.getBoundingClientRect();
      const scaleX = canvas.width / rect.width;
      const scaleY = canvas.height / rect.height;
      const x = Math.round((e.clientX - rect.left) * scaleX);
      const y = Math.round((e.clientY - rect.top) * scaleY);

      socket.emit('mouse-up', { x, y, button: e.button === 2 ? 'right' : 'left' });
    });

    canvas.addEventListener('click', (e) => {
      if (!isConnected || !canvasReady) return;
      e.preventDefault();

      const rect = canvas.getBoundingClientRect();
      const scaleX = canvas.width / rect.width;
      const scaleY = canvas.height / rect.height;
      const x = Math.round((e.clientX - rect.left) * scaleX);
      const y = Math.round((e.clientY - rect.top) * scaleY);

      socket.emit('mouse-click', { x, y, button: 'left' });
    });

    canvas.addEventListener('contextmenu', (e) => {
      e.preventDefault();
    });

    // Keyboard events
    document.addEventListener('keydown', (e) => {
      if (!isConnected || !canvasReady) return;
      socket.emit('key-down', { key: e.key, code: e.code });

      // Prevent default for most keys to avoid browser shortcuts
      if (e.key !== 'F5' && e.key !== 'F12') {
        e.preventDefault();
      }
    });

    document.addEventListener('keyup', (e) => {
      if (!isConnected || !canvasReady) return;
      socket.emit('key-up', { key: e.key, code: e.code });
    });

    // Handle input events for text fields
    document.addEventListener('input', (e) => {
      if (!isConnected || !canvasReady) return;
      const text = e.data || e.target.value;
      if (text) {
        socket.emit('type-text', { text });
      }
    });
  </script>
</body>
</html>
  `);
});

/**
 * Health check endpoint
 */
app.get('/health', (req, res) => {
  res.json({
    status: 'ok',
    port: PORT,
    extractionComplete,
    email: EXTRACTION_EMAIL
  });
});

/**
 * Extraction result endpoint
 */
app.get('/extraction-result/:email', (req, res) => {
  const { email } = req.params;

  // Check if extraction is complete
  if (extractionComplete) {
    // Check if cookie file exists
    const outputFile = COOKIE_OUTPUT_FILE;

    if (fs.existsSync(outputFile)) {
      try {
        const cookieData = JSON.parse(fs.readFileSync(outputFile, 'utf8'));

        return res.json({
          success: true,
          username: cookieData.username || cookieData.metadata?.username || null,
          cookies: cookieData.cookies || [],
          extractedAt: cookieData.metadata?.extractedAt || new Date().toISOString()
        });
      } catch (err) {
        console.error('[streaming] Error reading cookie file:', err);
      }
    }
  }

  // If browser is active, return pending status
  if (page && !extractionComplete) {
    return res.json({
      success: false,
      pending: true,
      message: 'Authentication in progress. Please complete login in the popup window.'
    });
  }

  // No active session
  return res.json({
    success: false,
    error: 'No authentication session found',
    requiresReauth: true
  });
});

/**
 * Restart browser to ensure fresh session (fixes "Stale Request" errors)
 */
async function restartBrowser() {
  console.log('[streaming] Restarting browser for fresh session...');

  // Close existing browser if any
  if (browserContext) {
    try {
      await browserContext.close();
      console.log('[streaming] Previous browser closed');
    } catch (err) {
      console.error('[streaming] Error closing browser:', err.message);
    }
  }

  browserContext = null;
  page = null;
  extractionComplete = false;

  // Restart streaming
  await startStreaming();
}

/**
 * Socket.IO connection handler
 */
io.on('connection', (socket) => {
  console.log('[streaming] Client connected:', socket.id);

  // Restart browser on new connection to ensure fresh session
  if (page && !extractionComplete) {
    console.log('[streaming] Browser already in use, restarting for fresh session...');
    restartBrowser().catch(err => {
      console.error('[streaming] Failed to restart browser:', err);
      socket.emit('error', 'Failed to initialize browser');
    });
  }

  socket.on('mouse-move', async (data) => {
    if (page) {
      await page.mouse.move(data.x, data.y).catch(err => {
        console.error('[streaming] Mouse move error:', err.message);
      });
    }
  });

  socket.on('mouse-down', async (data) => {
    if (page) {
      await page.mouse.down({
        button: data.button === 'right' ? 'right' : 'left'
      }).catch(err => {
        console.error('[streaming] Mouse down error:', err.message);
      });
    }
  });

  socket.on('mouse-up', async (data) => {
    if (page) {
      await page.mouse.up({
        button: data.button === 'right' ? 'right' : 'left'
      }).catch(err => {
        console.error('[streaming] Mouse up error:', err.message);
      });
    }
  });

  socket.on('mouse-click', async (data) => {
    if (page) {
      await page.mouse.click(data.x, data.y, {
        button: data.button === 'right' ? 'right' : 'left'
      }).catch(err => {
        console.error('[streaming] Mouse click error:', err.message);
      });
    }
  });

  socket.on('key-down', async (data) => {
    if (page) {
      await page.keyboard.down(data.key).catch(err => {
        console.error('[streaming] Key down error:', err.message);
      });
    }
  });

  socket.on('key-up', async (data) => {
    if (page) {
      await page.keyboard.up(data.key).catch(err => {
        console.error('[streaming] Key up error:', err.message);
      });
    }
  });

  socket.on('type-text', async (data) => {
    if (page && data.text) {
      await page.keyboard.type(data.text).catch(err => {
        console.error('[streaming] Type text error:', err.message);
      });
    }
  });

  socket.on('disconnect', () => {
    console.log('[streaming] Client disconnected:', socket.id);
  });
});

/**
 * Extract cookies from browser context
 */
async function extractCookies() {
  if (!browserContext) {
    throw new Error('Browser context not initialized');
  }

  const cookies = await browserContext.cookies();

  // Get username from page if possible
  let username = null;
  try {
    if (page) {
      // Wait a moment for the page to fully render
      await page.waitForTimeout(2000);

      console.log('[streaming] Attempting to extract username from Canvas page...');

      // Method 1: Try to extract from user settings/profile page
      try {
        // Navigate to profile/settings to get the actual username
        const currentUrl = page.url();
        console.log('[streaming] Current URL before navigation:', currentUrl);

        // Try to get user ID from any Canvas page and construct settings URL
        const userId = await page.evaluate(() => {
          // Check for ENV.current_user_id in Canvas
          return window.ENV?.current_user_id || null;
        });

        if (userId) {
          console.log('[streaming] Found user ID:', userId);
          await page.goto(`https://canvas.colorado.edu/profile/settings`, { waitUntil: 'networkidle', timeout: 10000 });
          await page.waitForTimeout(1000);

          // Try to find login/username field
          const loginInput = await page.$('input[name="user[short_name]"], input[name="user[name]"], #user_short_name');
          if (loginInput) {
            username = await loginInput.evaluate(el => el.value);
            console.log('[streaming] Extracted username from profile settings:', username);
          }
        }
      } catch (navErr) {
        console.log('[streaming] Could not navigate to settings:', navErr.message);
      }

      // Method 2: Try to extract from page content/title
      if (!username) {
        try {
          const pageTitle = await page.title();
          console.log('[streaming] Page title:', pageTitle);

          // Sometimes Canvas includes username in title
          const titleMatch = pageTitle.match(/([a-z]{4}\d{4})/i);
          if (titleMatch) {
            username = titleMatch[1];
            console.log('[streaming] Extracted username from page title:', username);
          }
        } catch (titleErr) {
          console.log('[streaming] Could not extract from title');
        }
      }

      // Method 3: Extract from URL if user navigated to their profile
      if (!username) {
        try {
          const url = page.url();
          const urlMatch = url.match(/\/users\/\d+/);
          if (urlMatch) {
            // Try to get username from profile page
            await page.waitForSelector('body', { timeout: 2000 });
            const profileText = await page.textContent('body');
            const usernameMatch = profileText.match(/([a-z]{4}\d{4})/i);
            if (usernameMatch) {
              username = usernameMatch[1];
              console.log('[streaming] Extracted username from profile:', username);
            }
          }
        } catch (urlErr) {
          console.log('[streaming] Could not extract from URL');
        }
      }

      if (!username) {
        console.log('[streaming] Could not extract username - will need manual verification');
      }
    }
  } catch (err) {
    console.warn('[streaming] Error extracting username:', err.message);
  }

  // Save cookies to file
  const cookieData = {
    username,
    cookies,
    metadata: {
      extractedAt: new Date().toISOString(),
      url: CANVAS_URL,
      email: EXTRACTION_EMAIL
    }
  };

  fs.writeFileSync(COOKIE_OUTPUT_FILE, JSON.stringify(cookieData, null, 2));
  console.log('[streaming] ✅ Cookies saved to:', COOKIE_OUTPUT_FILE);
  console.log('[streaming]    Username:', username || 'not extracted');
  console.log('[streaming]    Cookie count:', cookies.length);

  return cookieData;
}

/**
 * Monitor page for login completion
 */
async function monitorLoginCompletion() {
  if (!page) return;

  console.log('[streaming] Monitoring for login completion...');

  // Listen for URL changes
  page.on('framenavigated', async (frame) => {
    if (frame !== page.mainFrame()) return;

    const url = page.url();
    console.log('[streaming] Page navigated to:', url);

    // Check if we're on Canvas (not fedauth)
    // Accept root URL or any Canvas page
    if (url.includes('canvas.colorado.edu') && !url.includes('fedauth')) {
      console.log('[streaming] ✅ Login complete! User reached Canvas');
      console.log('[streaming]    Current URL:', url);

      // Wait for page to fully load and cookies to settle
      await page.waitForTimeout(3000);

      // Extract cookies
      try {
        console.log('[streaming] Extracting cookies and username...');
        const cookieData = await extractCookies();

        console.log('[streaming] ✅ Cookie extraction completed');
        console.log('[streaming]    Username:', cookieData.username || 'not extracted');
        console.log('[streaming]    Cookies:', cookieData.cookies.length);

        // Notify clients
        io.emit('extraction-complete', {
          success: true,
          username: cookieData.username,
          cookieCount: cookieData.cookies.length
        });

        console.log('[streaming] ✅ Notified clients of extraction completion');
        extractionComplete = true;

        // Close browser after a delay
        setTimeout(async () => {
          console.log('[streaming] Closing browser...');
          if (browserContext) {
            await browserContext.close();
          }
          process.exit(0);
        }, 3000);
      } catch (err) {
        console.error('[streaming] Error extracting cookies:', err);
        // Still notify clients even if there was an error
        io.emit('error', err.message);
      }
    }
  });
}

/**
 * Start streaming session
 */
async function startStreaming() {
  try {
    console.log('[streaming] Starting browser...');
    console.log('[streaming]    Port:', PORT);
    console.log('[streaming]    Canvas URL:', CANVAS_URL);
    console.log('[streaming]    Extraction email:', EXTRACTION_EMAIL);
    console.log('[streaming]    Output file:', COOKIE_OUTPUT_FILE);

    // Launch browser with Chrome
    // Use headless mode for server environments (CDP screencast works in headless)
    const browser = await chromium.launch({
      headless: true,
      executablePath: process.env.CHROME_PATH || '/usr/bin/google-chrome',
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
        '--disable-blink-features=AutomationControlled',
        '--disable-features=IsolateOrigins,site-per-process' // Fix for stale request issues
      ]
    });

    // Create a fresh browser context with cleared state to avoid "Stale Request" errors
    browserContext = await browser.newContext({
      viewport: { width: 1280, height: 720 },
      userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      // Clear all storage to ensure fresh session
      storageState: undefined,
      // Disable cache to avoid stale data
      bypassCSP: false,
      ignoreHTTPSErrors: false
    });

    page = await browserContext.newPage();

    // Enable CDP session for screencast
    const cdpSession = await page.context().newCDPSession(page);

    // Start screencast with optimized settings for lower latency
    await cdpSession.send('Page.startScreencast', {
      format: 'jpeg',
      quality: 50, // Lower quality for faster encoding/transmission
      maxWidth: 1280,
      maxHeight: 720,
      everyNthFrame: 1 // Capture every frame for smoother experience
    });

    console.log('[streaming] ✅ Screencast started (optimized for low latency)');

    // Listen for screencast frames
    cdpSession.on('Page.screencastFrame', async (frame) => {
      // Broadcast frame to all connected clients
      io.emit('frame', frame.data);

      // Acknowledge the frame immediately to request next frame
      await cdpSession.send('Page.screencastFrameAck', { sessionId: frame.sessionId });
    });

    // Navigate to Canvas login
    console.log('[streaming] Navigating to Canvas...');
    await page.goto(CANVAS_URL, { waitUntil: 'domcontentloaded', timeout: 60000 });

    // Start monitoring for login completion
    monitorLoginCompletion();

  } catch (err) {
    console.error('[streaming] Error starting browser:', err);
    io.emit('error', err.message);
    process.exit(1);
  }
}

// Start the server
server.listen(PORT, '0.0.0.0', () => {
  console.log(`[streaming] 🚀 Streaming server started on port ${PORT}`);
  console.log(`[streaming]    View at: http://localhost:${PORT}`);

  // Start browser after server is ready
  setTimeout(() => {
    startStreaming().catch(err => {
      console.error('[streaming] Failed to start streaming:', err);
      process.exit(1);
    });
  }, 1000);
});

// Cleanup on exit
process.on('SIGINT', async () => {
  console.log('\n[streaming] Shutting down...');
  if (browserContext) {
    await browserContext.close();
  }
  process.exit(0);
});

process.on('SIGTERM', async () => {
  console.log('\n[streaming] Shutting down...');
  if (browserContext) {
    await browserContext.close();
  }
  process.exit(0);
});
