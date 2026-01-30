#!/usr/bin/env node

/**
 * Canvas Cookie Extraction - Streaming Mode
 *
 * Launches a browser session and streams the screen to connected clients via WebSocket.
 * Allows users to interact with the browser remotely while cookies are extracted.
 */

const express = require("express");
const http = require("http");
const { Server } = require("socket.io");
const { chromium } = require("playwright-core");
const fs = require("fs");
const path = require("path");
const { createClient } = require("@supabase/supabase-js");

// Load environment-specific config
const isDev = process.env.NODE_ENV === "development";
const envFile = isDev ? ".env.development" : ".env";
require("dotenv").config({ path: path.join(__dirname, "../..", envFile) });

console.log(`[streaming] Environment: ${isDev ? "DEVELOPMENT" : "PRODUCTION"}`);

// Configuration
const PORT = parseInt(process.env.STREAMING_PORT || "3002");
const CANVAS_URL = process.env.CANVAS_URL || "https://canvas.colorado.edu";
const COOKIE_OUTPUT_FILE =
  process.env.COOKIE_OUTPUT_FILE ||
  path.join(__dirname, "../../data/auth/canvas-cookies.json");
const EXTRACTION_EMAIL = process.env.EXTRACTION_EMAIL;

// Initialize Express app
const app = express();

// Add CORS middleware for all routes
app.use((req, res, next) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") {
    return res.status(200).end();
  }

  next();
});

const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"],
  },
  // Optimize for low latency
  pingInterval: 10000,
  pingTimeout: 5000,
  transports: ["websocket", "polling"],
  allowUpgrades: true,
  perMessageDeflate: false, // Disable compression for lower latency
});

// Ensure output directory exists
const outputDir = path.dirname(COOKIE_OUTPUT_FILE);
if (!fs.existsSync(outputDir)) {
  fs.mkdirSync(outputDir, { recursive: true });
}

// ============================================================================
// SECURITY HELPERS
// ============================================================================

// Maximum concurrent sessions to prevent resource exhaustion
const MAX_CONCURRENT_SESSIONS = 50;

// Email validation regex (basic format check)
const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * Validate email format
 * @param {string} email - Email to validate
 * @returns {boolean} True if valid email format
 */
function isValidEmail(email) {
  return email && typeof email === "string" && EMAIL_REGEX.test(email);
}

/**
 * Sanitize email for use in file paths (prevent path traversal)
 * @param {string} email - Email to sanitize
 * @returns {string} Sanitized email safe for file paths
 */
function sanitizeEmailForPath(email) {
  return email.toLowerCase().replace(/[^a-z0-9@.-]/g, "-");
}

/**
 * Generate a secure session token for Socket.IO authentication
 * @returns {string} Random session token
 */
function generateSessionToken() {
  return require("crypto").randomBytes(32).toString("hex");
}

// ============================================================================
// PER-USER SESSION MANAGEMENT
// ============================================================================

/**
 * Per-user session state - replaces global variables
 * Each user gets their own isolated browser session
 */
const userSessions = new Map(); // email -> SessionState
const socketToEmail = new Map(); // socketId -> email
const sessionTokens = new Map(); // token -> email (for Socket.IO auth)

/**
 * Create a new session state object for a user
 * @param {string} email - User email
 * @param {boolean} isMobile - Whether client is mobile
 * @returns {Object} Session state object
 */
function createSession(email, isMobile = false) {
  const token = generateSessionToken();
  sessionTokens.set(token, email);

  return {
    email,
    token, // Session token for Socket.IO authentication
    socketIds: new Set(), // All socket IDs for this user
    browserContext: null,
    page: null,
    cdpSession: null,
    extractionComplete: false,
    browserStarting: false,
    browserStarted: false,
    isMobileClient: isMobile,
    currentStage: STATUS_STAGES.CONNECTING,
    exitTimeout: null,
    createdAt: Date.now(),
    lastActivity: Date.now(),
  };
}

/**
 * Get or create a session for a user
 * @param {string} email - User email
 * @param {boolean} isMobile - Whether client is mobile
 * @returns {Object|null} Session state object, or null if max sessions reached
 */
function getOrCreateSession(email, isMobile = false) {
  if (!userSessions.has(email)) {
    // Check max concurrent sessions limit
    if (userSessions.size >= MAX_CONCURRENT_SESSIONS) {
      console.warn(
        `[streaming] Max sessions (${MAX_CONCURRENT_SESSIONS}) reached, rejecting new session for ${email}`,
      );
      return null;
    }
    userSessions.set(email, createSession(email, isMobile));
    console.log(
      `[streaming] Created new session for ${email} (active: ${userSessions.size}/${MAX_CONCURRENT_SESSIONS})`,
    );
  }
  const session = userSessions.get(email);
  session.lastActivity = Date.now();
  return session;
}

// Status stages for frontend feedback
const STATUS_STAGES = {
  CONNECTING: "connecting",
  BROWSER_LAUNCHING: "browser_launching",
  BROWSER_READY: "browser_ready",
  SCREENCAST_STARTING: "screencast_starting",
  NAVIGATING: "navigating",
  READY_FOR_LOGIN: "ready_for_login",
  LOGIN_DETECTED: "login_detected",
  EXTRACTING_COOKIES: "extracting_cookies",
  COMPLETE: "complete",
  ERROR: "error",
};

/**
 * Emit event to a specific user's room only
 * @param {string} email - User email
 * @param {string} event - Event name
 * @param {*} data - Event data
 */
function emitToUser(email, event, data) {
  io.to(`user:${email}`).emit(event, data);
}

/**
 * Emit status to a specific user
 * @param {string} email - User email
 * @param {string} stage - Status stage
 * @param {string} message - Status message
 * @param {Object} details - Additional details
 */
function emitUserStatus(email, stage, message, details = {}) {
  const session = userSessions.get(email);
  if (session) {
    session.currentStage = stage;
  }
  emitToUser(email, "status", {
    stage,
    message,
    timestamp: Date.now(),
    ...details,
  });
  console.log(`[streaming] [${email}] Status: ${stage} - ${message}`);
}

// Timeout constants
const TIMEOUTS = {
  BROWSER_LAUNCH: 15000, // 15 seconds
  SCREENCAST: 5000, // 5 seconds
  NAVIGATION: 30000, // 30 seconds
};

/**
 * Check if a key is a special/modifier key (not simple text input)
 * @param {string} key - The key to check
 * @returns {boolean} True if the key is a special key
 */
function isSpecialKey(key) {
  return (
    [
      "Control",
      "Alt",
      "Meta",
      "Shift",
      "Enter",
      "Tab",
      "Escape",
      "Backspace",
      "Delete",
      "ArrowUp",
      "ArrowDown",
      "ArrowLeft",
      "ArrowRight",
      "Home",
      "End",
      "PageUp",
      "PageDown",
    ].includes(key) || key.startsWith("F")
  );
}

/**
 * Serve the streaming viewer HTML page (minimal UI, fullscreen)
 * Requires email query parameter for session isolation
 */
app.get("/", (req, res) => {
  const email = req.query.email;

  // Email is required for session isolation
  if (!email) {
    console.log("[streaming] Request missing email parameter");
    return res.status(400).send(`
<!DOCTYPE html>
<html><head><title>Error</title></head>
<body style="font-family: sans-serif; padding: 40px; text-align: center;">
  <h1>Session Error</h1>
  <p>Email parameter is required. Please return to the application and try again.</p>
</body></html>
    `);
  }

  // Validate email format to prevent injection attacks
  if (!isValidEmail(email)) {
    console.warn(`[streaming] Invalid email format rejected: ${email}`);
    return res.status(400).send(`
<!DOCTYPE html>
<html><head><title>Error</title></head>
<body style="font-family: sans-serif; padding: 40px; text-align: center;">
  <h1>Invalid Email</h1>
  <p>Please provide a valid email address.</p>
</body></html>
    `);
  }

  const normalizedEmail = email.toLowerCase().trim();
  const isMobile = req.query.mobile === "1";
  const forceReauth = req.query.forceReauth === "1";

  console.log(
    `[streaming] [${normalizedEmail}] Viewer page requested (mobile: ${isMobile}, forceReauth: ${forceReauth})`,
  );

  // If forceReauth requested and session exists, restart browser for fresh state
  const existingSession = userSessions.get(normalizedEmail);
  if (existingSession && forceReauth) {
    console.log(
      `[streaming] [${normalizedEmail}] Force re-auth requested, restarting browser...`,
    );
    // Don't await - let it restart in the background while we serve the page
    restartUserBrowser(normalizedEmail).catch((err) => {
      console.error(
        `[streaming] [${normalizedEmail}] Error during forceReauth restart:`,
        err.message,
      );
    });
  }

  // Get or create session for this user
  const session = getOrCreateSession(normalizedEmail, isMobile);

  // Check if session creation failed (max sessions reached)
  if (!session) {
    console.warn(
      `[streaming] [${normalizedEmail}] Session creation failed - server at capacity`,
    );
    return res.status(503).send(`
<!DOCTYPE html>
<html><head><title>High Demand</title>
<style>
  body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; padding: 40px; text-align: center; background: #f8f9fa; }
  .container { max-width: 400px; margin: 0 auto; background: white; padding: 40px; border-radius: 12px; box-shadow: 0 4px 12px rgba(0,0,0,0.1); }
  h1 { color: #333; margin-bottom: 16px; }
  p { color: #666; margin-bottom: 12px; line-height: 1.5; }
  .capacity { font-size: 14px; color: #888; margin-bottom: 20px; }
  .retry-btn { display: inline-block; padding: 12px 24px; background: #667eea; color: white; border: none; border-radius: 8px; font-size: 14px; cursor: pointer; text-decoration: none; }
  .retry-btn:hover { background: #5a67d8; }
  .countdown { font-size: 14px; color: #888; margin-top: 10px; }
</style>
</head>
<body>
  <div class="container">
    <h1>High Demand</h1>
    <p>The authentication server is at capacity.</p>
    <p class="capacity">(${userSessions.size}/${MAX_CONCURRENT_SESSIONS} users currently active)</p>
    <button class="retry-btn" onclick="retryWithCountdown(this)">Retry in 3 seconds</button>
    <p class="countdown" id="countdown"></p>
  </div>
  <script>
    function retryWithCountdown(btn) {
      btn.disabled = true;
      btn.textContent = 'Retrying...';
      let seconds = 3;
      const countdownEl = document.getElementById('countdown');
      const interval = setInterval(() => {
        seconds--;
        countdownEl.textContent = seconds > 0 ? 'Retrying in ' + seconds + '...' : '';
        if (seconds <= 0) {
          clearInterval(interval);
          location.reload();
        }
      }, 1000);
    }
  </script>
</body></html>
    `);
  }

  // Start browser on first page request for this user (if not already started)
  if (!session.browserStarted && !session.browserStarting) {
    session.browserStarted = true;
    console.log(
      `[streaming] [${normalizedEmail}] Starting browser on first client request...`,
    );
    startUserSession(normalizedEmail).catch((err) => {
      console.error(
        `[streaming] [${normalizedEmail}] Failed to start streaming:`,
        err,
      );
    });
  }

  // Prevent browser caching to ensure fresh session token on each request
  res.setHeader("Cache-Control", "no-cache, no-store, must-revalidate");
  res.setHeader("Pragma", "no-cache");
  res.setHeader("Expires", "0");

  // Generate viewer HTML with email embedded for Socket.IO handshake
  res.send(`
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Canvas Login</title>
  <script src="/socket.io/socket.io.js"></script>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    html, body {
      width: 100%;
      height: 100%;
      overflow: hidden;
      background: #fff;
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
    }
    #canvas {
      display: block;
      width: 100%;
      height: 100%;
      cursor: pointer;
      object-fit: contain;
    }
    .status-container {
      position: absolute;
      top: 50%;
      left: 50%;
      transform: translate(-50%, -50%);
      text-align: center;
      color: #666;
      max-width: 400px;
      padding: 40px;
    }
    .spinner {
      border: 4px solid #f3f3f3;
      border-top: 4px solid #667eea;
      border-radius: 50%;
      width: 50px;
      height: 50px;
      animation: spin 1s linear infinite;
      margin: 0 auto 20px;
    }
    @keyframes spin {
      0% { transform: rotate(0deg); }
      100% { transform: rotate(360deg); }
    }
    .status-text {
      font-size: 16px;
      margin-bottom: 25px;
      color: #333;
    }
    .progress-steps {
      display: flex;
      justify-content: center;
      gap: 15px;
      margin-bottom: 20px;
    }
    .step {
      display: flex;
      flex-direction: column;
      align-items: center;
      opacity: 0.3;
      transition: opacity 0.3s, transform 0.3s;
    }
    .step.active { opacity: 1; transform: scale(1.1); }
    .step.complete { opacity: 1; }
    .step.complete .step-icon { background: #22c55e; }
    .step.error .step-icon { background: #dc2626; }
    .step-icon {
      width: 36px;
      height: 36px;
      border-radius: 50%;
      background: #667eea;
      color: white;
      display: flex;
      align-items: center;
      justify-content: center;
      font-weight: bold;
      font-size: 14px;
    }
    .step-label { font-size: 11px; margin-top: 6px; color: #666; }
    .error-container {
      background: #fef2f2;
      border: 1px solid #fca5a5;
      border-radius: 12px;
      padding: 25px;
      text-align: center;
    }
    .error-icon { font-size: 40px; margin-bottom: 15px; }
    .error-title { color: #dc2626; font-weight: 600; font-size: 18px; margin-bottom: 10px; }
    .error-message { color: #991b1b; font-size: 14px; margin-bottom: 8px; }
    .error-suggestion { color: #666; font-size: 13px; margin-bottom: 20px; }
    .retry-button {
      padding: 12px 24px;
      background: #667eea;
      color: white;
      border: none;
      border-radius: 8px;
      cursor: pointer;
      font-size: 14px;
      font-weight: 500;
      transition: background 0.2s;
    }
    .retry-button:hover { background: #5a67d8; }
    .hidden { display: none !important; }
  </style>
</head>
<body>
  <div class="status-container" id="status-container">
    <div class="spinner" id="spinner"></div>
    <p class="status-text" id="status-text">Connecting...</p>
    <div class="progress-steps" id="progress-steps">
      <div class="step" id="step-connect" data-step="connect">
        <span class="step-icon">1</span>
        <span class="step-label">Connect</span>
      </div>
      <div class="step" id="step-browser" data-step="browser">
        <span class="step-icon">2</span>
        <span class="step-label">Browser</span>
      </div>
      <div class="step" id="step-canvas" data-step="canvas">
        <span class="step-icon">3</span>
        <span class="step-label">Canvas</span>
      </div>
      <div class="step" id="step-login" data-step="login">
        <span class="step-icon">4</span>
        <span class="step-label">Login</span>
      </div>
    </div>
    <div class="error-container hidden" id="error-container">
      <div class="error-icon">⚠️</div>
      <p class="error-title" id="error-title">Something went wrong</p>
      <p class="error-message" id="error-message"></p>
      <p class="error-suggestion" id="error-suggestion"></p>
      <button class="retry-button" onclick="window.location.reload()">Try Again</button>
    </div>
  </div>
  <canvas id="canvas" class="hidden"></canvas>

  <script>
    // Session token injected by server for Socket.IO authentication
    const sessionToken = '${session.token}';
    const userEmail = '${normalizedEmail}';

    // Connect to Socket.IO with email AND token for secure session binding
    const socket = io({
      query: { email: userEmail, token: sessionToken },
      reconnection: true,
      reconnectionAttempts: 5,
      reconnectionDelay: 1000,
      reconnectionDelayMax: 10000,
      timeout: 25000
    });
    const canvas = document.getElementById('canvas');
    const ctx = canvas.getContext('2d', { alpha: false });
    const statusContainer = document.getElementById('status-container');
    const statusText = document.getElementById('status-text');
    const spinner = document.getElementById('spinner');
    const progressSteps = document.getElementById('progress-steps');
    const errorContainer = document.getElementById('error-container');
    const errorTitle = document.getElementById('error-title');
    const errorMessage = document.getElementById('error-message');
    const errorSuggestion = document.getElementById('error-suggestion');

    let isConnected = false;
    let canvasReady = false;
    let connectionTimeout = null;
    let loginDetected = false; // Flag to stop processing frames after login

    // Connection timeout - 25 seconds (extended for browser launch time)
    connectionTimeout = setTimeout(() => {
      if (!isConnected) {
        showError('Connection Timeout', 'The server is taking longer than expected.', 'Please close this window and try again.');
      }
    }, 25000);

    // Intermediate status update at 5 seconds
    setTimeout(() => {
      if (!isConnected) {
        statusText.textContent = 'Starting browser... (this may take a moment)';
      }
    }, 5000);

    socket.on('connect', () => {
      console.log('Connected to streaming server');
      isConnected = true;
      clearTimeout(connectionTimeout);
      updateStep('connect', 'complete');
      statusText.textContent = 'Connected, starting browser...';
    });

    // Retry logic with exponential backoff
    let connectionAttempts = 0;
    const MAX_ATTEMPTS = 3;
    const RETRY_DELAYS = [2000, 5000, 10000];

    socket.on('connect_error', (err) => {
      console.error('Socket.IO connection error:', err.message);
      clearTimeout(connectionTimeout);
      isConnected = false;

      if (connectionAttempts < MAX_ATTEMPTS) {
        const delay = RETRY_DELAYS[connectionAttempts] || 10000;
        connectionAttempts++;
        statusText.textContent = 'Reconnecting... (attempt ' + connectionAttempts + '/' + MAX_ATTEMPTS + ')';
        console.log('Retrying connection in ' + delay + 'ms (attempt ' + connectionAttempts + ')');
        setTimeout(() => {
          if (!isConnected && !loginDetected) {
            socket.connect();
          }
        }, delay);
      } else {
        showError('Connection Failed', 'Unable to connect after multiple attempts.', 'Please close this window and try again.');
      }
    });

    socket.on('disconnect', (reason) => {
      console.log('Disconnected from server:', reason);
      isConnected = false;
      // Only show error if we haven't completed login and haven't already shown an error
      if (!canvasReady && !loginDetected) {
        if (reason === 'io server disconnect' || reason === 'transport close') {
          showError('Session Error', 'Your session was disconnected.', 'Please close this window and try again.');
        }
      }
    });

    socket.on('status', (data) => {
      console.log('Status:', data);
      statusText.textContent = data.message;

      switch(data.stage) {
        case 'browser_launching':
          updateStep('connect', 'complete');
          updateStep('browser', 'active');
          break;
        case 'browser_ready':
          updateStep('browser', 'complete');
          break;
        case 'screencast_starting':
        case 'navigating':
          updateStep('browser', 'complete');
          updateStep('canvas', 'active');
          break;
        case 'ready_for_login':
          updateStep('canvas', 'complete');
          updateStep('login', 'active');
          break;
        case 'login_detected':
        case 'extracting_cookies':
          // Close popup immediately - don't show any Canvas content
          loginDetected = true;
          window.close();
          break;
        case 'complete':
          statusText.textContent = 'Complete! This window will close...';
          break;
        case 'error':
          showError('Error', data.message, data.suggestion || 'Please close this window and try again.');
          break;
      }
    });

    socket.on('frame', (data) => {
      // Stop processing frames after login is detected
      if (loginDetected) return;

      const img = new Image();
      img.onload = () => {
        // Double-check loginDetected in case it changed during image load
        if (loginDetected) return;

        canvas.width = img.width;
        canvas.height = img.height;
        ctx.drawImage(img, 0, 0);

        if (!canvasReady) {
          statusContainer.classList.add('hidden');
          canvas.classList.remove('hidden');
          canvasReady = true;
        }
      };
      img.src = 'data:image/jpeg;base64,' + data;
    });

    // Close popup immediately when server signals login detected
    socket.on('close-popup', () => {
      console.log('Received close-popup signal - closing immediately');
      loginDetected = true;
      window.close();
    });

    socket.on('extraction-complete', () => {
      // Close immediately (fallback in case status event was missed)
      loginDetected = true;
      window.close();
    });

    socket.on('error', (data) => {
      // Handle both string and structured error objects
      const message = typeof data === 'string' ? data : (data.message || 'An error occurred');
      const suggestion = typeof data === 'object' && data.suggestion ? data.suggestion : 'Please close this window and try again.';
      showError('Error', message, suggestion);
    });

    function updateStep(stepName, state) {
      const stepEl = document.getElementById('step-' + stepName);
      if (!stepEl) return;
      stepEl.classList.remove('active', 'complete', 'error');
      if (state) stepEl.classList.add(state);
    }

    function showError(title, message, suggestion) {
      spinner.classList.add('hidden');
      statusText.classList.add('hidden');
      progressSteps.classList.add('hidden');
      errorContainer.classList.remove('hidden');
      errorTitle.textContent = title;
      errorMessage.textContent = message;
      errorSuggestion.textContent = suggestion || '';
    }

    // Mouse events
    canvas.addEventListener('mousemove', (e) => {
      if (!isConnected || !canvasReady) return;
      const rect = canvas.getBoundingClientRect();
      const scaleX = canvas.width / rect.width;
      const scaleY = canvas.height / rect.height;
      socket.emit('mouse-move', {
        x: Math.round((e.clientX - rect.left) * scaleX),
        y: Math.round((e.clientY - rect.top) * scaleY)
      });
    });

    canvas.addEventListener('mousedown', (e) => {
      if (!isConnected || !canvasReady) return;
      e.preventDefault();
      const rect = canvas.getBoundingClientRect();
      const scaleX = canvas.width / rect.width;
      const scaleY = canvas.height / rect.height;
      socket.emit('mouse-down', {
        x: Math.round((e.clientX - rect.left) * scaleX),
        y: Math.round((e.clientY - rect.top) * scaleY),
        button: e.button === 2 ? 'right' : 'left'
      });
    });

    canvas.addEventListener('mouseup', (e) => {
      if (!isConnected || !canvasReady) return;
      e.preventDefault();
      const rect = canvas.getBoundingClientRect();
      const scaleX = canvas.width / rect.width;
      const scaleY = canvas.height / rect.height;
      socket.emit('mouse-up', {
        x: Math.round((e.clientX - rect.left) * scaleX),
        y: Math.round((e.clientY - rect.top) * scaleY),
        button: e.button === 2 ? 'right' : 'left'
      });
    });

    canvas.addEventListener('click', (e) => {
      if (!isConnected || !canvasReady) return;
      e.preventDefault();
      const rect = canvas.getBoundingClientRect();
      const scaleX = canvas.width / rect.width;
      const scaleY = canvas.height / rect.height;
      socket.emit('mouse-click', {
        x: Math.round((e.clientX - rect.left) * scaleX),
        y: Math.round((e.clientY - rect.top) * scaleY),
        button: 'left'
      });
    });

    canvas.addEventListener('contextmenu', (e) => e.preventDefault());

    // Keyboard input batching for reduced latency
    const BATCH_INTERVAL_MS = 16; // One frame at 60fps
    const MAX_BATCH_SIZE = 10;
    const IMMEDIATE_FLUSH_KEYS = new Set(['Enter', 'Tab', 'Escape', 'Backspace', 'Delete']);

    let keyEventQueue = [];
    let batchTimer = null;

    function queueKeyEvent(type, key, code) {
      keyEventQueue.push({ type, key, code, ts: performance.now() });

      // Flush immediately for action keys or when queue is full
      if (IMMEDIATE_FLUSH_KEYS.has(key) || keyEventQueue.length >= MAX_BATCH_SIZE) {
        flushKeyQueue();
      } else if (!batchTimer) {
        batchTimer = setTimeout(flushKeyQueue, BATCH_INTERVAL_MS);
      }
    }

    function flushKeyQueue() {
      if (batchTimer) {
        clearTimeout(batchTimer);
        batchTimer = null;
      }
      if (keyEventQueue.length === 0) return;

      socket.emit('key-batch', { events: keyEventQueue });
      keyEventQueue = [];
    }

    document.addEventListener('keydown', (e) => {
      if (!isConnected || !canvasReady) return;
      queueKeyEvent('down', e.key, e.code);
      if (e.key !== 'F5' && e.key !== 'F12') e.preventDefault();
    });

    document.addEventListener('keyup', (e) => {
      if (!isConnected || !canvasReady) return;
      queueKeyEvent('up', e.key, e.code);
    });

    document.addEventListener('input', (e) => {
      if (!isConnected || !canvasReady) return;
      const text = e.data || e.target.value;
      if (text) socket.emit('type-text', { text });
    });
  </script>
</body>
</html>
  `);
});

/**
 * Health check endpoint
 */
app.get("/health", (req, res) => {
  res.json({
    status: "ok",
    port: PORT,
    activeSessions: userSessions.size,
    sessions: Array.from(userSessions.keys()).map((email) => ({
      email,
      extractionComplete: userSessions.get(email)?.extractionComplete || false,
      socketCount: userSessions.get(email)?.socketIds.size || 0,
    })),
  });
});

/**
 * Extraction result endpoint - per-user session aware
 */
app.get("/extraction-result/:email", (req, res) => {
  const { email } = req.params;

  // Validate email format
  if (!isValidEmail(email)) {
    console.warn(`[streaming] Invalid email in extraction-result: ${email}`);
    return res.status(400).json({ success: false, error: "Invalid email" });
  }

  const normalizedEmail = email.toLowerCase().trim();
  const sanitizedEmail = sanitizeEmailForPath(normalizedEmail);
  const session = userSessions.get(normalizedEmail);

  console.log(`[streaming] [${normalizedEmail}] Extraction result requested`);

  // Check if extraction is complete for this user
  if (session?.extractionComplete) {
    // Check if cookie file exists (use sanitized email for path safety)
    const outputFile =
      COOKIE_OUTPUT_FILE ||
      path.join(outputDir, `canvas-cookies-${sanitizedEmail}.json`);

    if (fs.existsSync(outputFile)) {
      try {
        const cookieData = JSON.parse(fs.readFileSync(outputFile, "utf8"));

        console.log(
          `[streaming] [${normalizedEmail}] Extraction result fetched by frontend`,
        );

        // Result was fetched - schedule faster cleanup (2 seconds)
        scheduleSessionCleanup(normalizedEmail, 2000);

        return res.json({
          success: true,
          username:
            cookieData.username || cookieData.metadata?.username || null,
          cookies: cookieData.cookies || [],
          extractedAt:
            cookieData.metadata?.extractedAt || new Date().toISOString(),
        });
      } catch (err) {
        console.error(
          `[streaming] [${normalizedEmail}] Error reading cookie file:`,
          err,
        );
      }
    }
  }

  // If browser is starting, active, or has started for this user, return pending status
  if (
    session &&
    (session.browserStarting ||
      session.browserStarted ||
      (session.page && !session.extractionComplete))
  ) {
    return res.json({
      success: false,
      pending: true,
      message:
        "Authentication in progress. Please complete login in the popup window.",
    });
  }

  // No active session for this user
  return res.json({
    success: false,
    error: "No authentication session found",
    requiresReauth: true,
  });
});

/**
 * Restart browser for a specific user's session (fixes "Stale Request" errors)
 * @param {string} email - User email
 */
async function restartUserBrowser(email) {
  const session = userSessions.get(email);
  if (!session) return;

  // Prevent rapid consecutive restarts (10 second cooldown)
  if (session.lastRestartTime && Date.now() - session.lastRestartTime < 10000) {
    console.log(
      `[streaming] [${email}] Browser restart cooldown active, skipping`,
    );
    return;
  }
  session.lastRestartTime = Date.now();

  console.log(`[streaming] [${email}] Restarting browser for fresh session...`);

  // Close existing browser if any
  if (session.browserContext) {
    try {
      await session.browserContext.close();
      console.log(`[streaming] [${email}] Previous browser closed`);
    } catch (err) {
      console.error(
        `[streaming] [${email}] Error closing browser:`,
        err.message,
      );
    }
  }

  session.browserContext = null;
  session.page = null;
  session.cdpSession = null;
  session.extractionComplete = false;
  session.browserStarting = false;
  session.browserStarted = true;

  // Restart streaming for this user
  await startUserSession(email);
}

/**
 * Schedule session cleanup after user disconnects or extraction completes
 * @param {string} email - User email
 * @param {number} delayMs - Delay before cleanup (default: 5 seconds)
 */
function scheduleSessionCleanup(email, delayMs = 5000) {
  const session = userSessions.get(email);
  if (!session) return;

  // Clear any existing timeout
  if (session.exitTimeout) {
    clearTimeout(session.exitTimeout);
  }

  session.exitTimeout = setTimeout(() => {
    cleanupUserSession(email);
  }, delayMs);

  console.log(
    `[streaming] [${email}] Scheduled session cleanup in ${delayMs}ms`,
  );
}

/**
 * Clean up a user's session and release resources
 * @param {string} email - User email
 */
async function cleanupUserSession(email) {
  const session = userSessions.get(email);
  if (!session) return;

  console.log(`[streaming] [${email}] Cleaning up session...`);

  // Close browser context
  if (session.browserContext) {
    try {
      await session.browserContext.close();
      console.log(`[streaming] [${email}] Browser closed`);
    } catch (err) {
      console.error(
        `[streaming] [${email}] Error closing browser:`,
        err.message,
      );
    }
  }

  // Clean up socket mappings
  for (const socketId of session.socketIds) {
    socketToEmail.delete(socketId);
  }

  // Clean up session token
  if (session.token) {
    sessionTokens.delete(session.token);
  }

  // Remove session
  userSessions.delete(email);
  console.log(
    `[streaming] [${email}] Session cleaned up. Active sessions: ${userSessions.size}`,
  );
}

/**
 * Socket.IO connection handler - per-user session isolation with token verification
 */
io.on("connection", (socket) => {
  const email = socket.handshake.query.email;
  const token = socket.handshake.query.token;

  // Email is required for session isolation
  if (!email) {
    console.log(
      `[streaming] Socket ${socket.id} connected without email - disconnecting`,
    );
    socket.emit("error", "Email parameter required for session");
    socket.disconnect(true);
    return;
  }

  // Token is required for session authentication
  if (!token) {
    console.log(
      `[streaming] Socket ${socket.id} connected without token - disconnecting`,
    );
    socket.emit("error", "Session token required");
    socket.disconnect(true);
    return;
  }

  const normalizedEmail = email.toLowerCase().trim();

  // Verify token belongs to this email (prevents session hijacking)
  const tokenEmail = sessionTokens.get(token);
  if (tokenEmail !== normalizedEmail) {
    console.warn(
      `[streaming] Socket ${socket.id} token mismatch: expected ${tokenEmail}, got ${normalizedEmail}`,
    );
    socket.emit("error", {
      type: "token_invalid",
      message:
        "Session expired or invalid. Please refresh or restart authentication.",
      suggestion:
        "Close this window and click 'Continue' again to start a new session.",
    });
    socket.disconnect(true);
    return;
  }
  console.log(
    `[streaming] [${normalizedEmail}] Client connected: ${socket.id}`,
  );

  // Join user-specific room for isolated event emission
  socket.join(`user:${normalizedEmail}`);
  socketToEmail.set(socket.id, normalizedEmail);

  // Get or create session for this user
  let session = userSessions.get(normalizedEmail);
  if (!session) {
    session = getOrCreateSession(normalizedEmail);
  }
  session.socketIds.add(socket.id);
  session.lastActivity = Date.now();

  // Cancel any pending cleanup since user reconnected
  if (session.exitTimeout) {
    clearTimeout(session.exitTimeout);
    session.exitTimeout = null;
    console.log(
      `[streaming] [${normalizedEmail}] Cancelled pending cleanup - user reconnected`,
    );
  }

  // Start browser for THIS user if not started and not in progress
  if (!session.browserStarted && !session.browserStarting) {
    session.browserStarted = true;
    console.log(
      `[streaming] [${normalizedEmail}] Starting browser for new socket connection...`,
    );
    startUserSession(normalizedEmail).catch((err) => {
      console.error(
        `[streaming] [${normalizedEmail}] Failed to start streaming:`,
        err,
      );
      emitToUser(normalizedEmail, "error", "Failed to initialize browser");
    });
  } else if (session.browserStarting) {
    console.log(
      `[streaming] [${normalizedEmail}] Browser is starting up, socket will receive frames when ready`,
    );
  }

  // Input handlers scoped to user's session
  socket.on("mouse-move", async (data) => {
    const s = userSessions.get(normalizedEmail);
    if (s?.page) {
      s.lastActivity = Date.now();
      await s.page.mouse.move(data.x, data.y).catch((err) => {
        console.error(
          `[streaming] [${normalizedEmail}] Mouse move error:`,
          err.message,
        );
      });
    }
  });

  socket.on("mouse-down", async (data) => {
    const s = userSessions.get(normalizedEmail);
    if (s?.page) {
      s.lastActivity = Date.now();
      await s.page.mouse
        .down({
          button: data.button === "right" ? "right" : "left",
        })
        .catch((err) => {
          console.error(
            `[streaming] [${normalizedEmail}] Mouse down error:`,
            err.message,
          );
        });
    }
  });

  socket.on("mouse-up", async (data) => {
    const s = userSessions.get(normalizedEmail);
    if (s?.page) {
      s.lastActivity = Date.now();
      await s.page.mouse
        .up({
          button: data.button === "right" ? "right" : "left",
        })
        .catch((err) => {
          console.error(
            `[streaming] [${normalizedEmail}] Mouse up error:`,
            err.message,
          );
        });
    }
  });

  socket.on("mouse-click", async (data) => {
    const s = userSessions.get(normalizedEmail);
    if (s?.page) {
      s.lastActivity = Date.now();
      await s.page.mouse
        .click(data.x, data.y, {
          button: data.button === "right" ? "right" : "left",
        })
        .catch((err) => {
          console.error(
            `[streaming] [${normalizedEmail}] Mouse click error:`,
            err.message,
          );
        });
    }
  });

  socket.on("key-down", async (data) => {
    const s = userSessions.get(normalizedEmail);
    if (s?.page) {
      s.lastActivity = Date.now();
      await s.page.keyboard.down(data.key).catch((err) => {
        console.error(
          `[streaming] [${normalizedEmail}] Key down error:`,
          err.message,
        );
      });
    }
  });

  socket.on("key-up", async (data) => {
    const s = userSessions.get(normalizedEmail);
    if (s?.page) {
      s.lastActivity = Date.now();
      await s.page.keyboard.up(data.key).catch((err) => {
        console.error(
          `[streaming] [${normalizedEmail}] Key up error:`,
          err.message,
        );
      });
    }
  });

  socket.on("type-text", async (data) => {
    const s = userSessions.get(normalizedEmail);
    if (s?.page && data.text) {
      s.lastActivity = Date.now();
      await s.page.keyboard.type(data.text).catch((err) => {
        console.error(
          `[streaming] [${normalizedEmail}] Type text error:`,
          err.message,
        );
      });
    }
  });

  // Batched keyboard input handler for reduced latency
  socket.on("key-batch", async (data) => {
    const s = userSessions.get(normalizedEmail);
    if (!s?.page || !data.events?.length) return;

    s.lastActivity = Date.now();

    try {
      // Sort by timestamp for correct ordering
      const events = data.events.sort((a, b) => a.ts - b.ts);

      // Check if all events are simple text (optimization path)
      const isTextOnly = events.every(
        (e) => e.key.length === 1 && !isSpecialKey(e.key),
      );

      if (isTextOnly) {
        // Extract text from down events and type all at once
        const text = events
          .filter((e) => e.type === "down")
          .map((e) => e.key)
          .join("");
        if (text) await s.page.keyboard.type(text, { delay: 0 });
      } else {
        // Process events individually
        for (const event of events) {
          if (event.type === "down") {
            await s.page.keyboard.down(event.key);
          } else {
            await s.page.keyboard.up(event.key);
          }
        }
      }
    } catch (err) {
      console.error(
        `[streaming] [${normalizedEmail}] Key batch error:`,
        err.message,
      );
    }
  });

  socket.on("disconnect", () => {
    console.log(
      `[streaming] [${normalizedEmail}] Client disconnected: ${socket.id}`,
    );

    // Remove socket from session
    const s = userSessions.get(normalizedEmail);
    if (s) {
      s.socketIds.delete(socket.id);

      // If no more sockets for this user, schedule cleanup
      if (s.socketIds.size === 0) {
        console.log(
          `[streaming] [${normalizedEmail}] No more active sockets, scheduling cleanup`,
        );
        // Give more time if extraction is in progress
        const cleanupDelay = s.extractionComplete ? 5000 : 30000;
        scheduleSessionCleanup(normalizedEmail, cleanupDelay);
      }
    }

    socketToEmail.delete(socket.id);
  });
});

/**
 * Extract cookies from a user's browser context
 * @param {string} email - User email
 * @returns {Object} Cookie data with username and cookies
 */
async function extractUserCookies(email) {
  const session = userSessions.get(email);
  if (!session?.browserContext) {
    throw new Error("Browser context not initialized for user: " + email);
  }

  const cookies = await session.browserContext.cookies();

  // Get username from page if possible
  let username = null;
  try {
    if (session.page) {
      // Wait briefly for the page to fully render (reduced from 2000ms)
      await session.page.waitForTimeout(500);

      console.log(
        `[streaming] [${email}] Attempting to extract username from Canvas page...`,
      );

      // Method 1: Try to extract from user settings/profile page
      try {
        // Navigate to profile/settings to get the actual username
        const currentUrl = session.page.url();
        console.log(
          `[streaming] [${email}] Current URL before navigation:`,
          currentUrl,
        );

        // Try to get user ID from any Canvas page and construct settings URL
        const userId = await session.page.evaluate(() => {
          // Check for ENV.current_user_id in Canvas
          return window.ENV?.current_user_id || null;
        });

        if (userId) {
          console.log(`[streaming] [${email}] Found user ID:`, userId);
          await session.page.goto(
            `https://canvas.colorado.edu/profile/settings`,
            {
              waitUntil: "networkidle",
              timeout: 10000,
            },
          );
          await session.page.waitForTimeout(1000);

          // Try to find login/username field
          const loginInput = await session.page.$(
            'input[name="user[short_name]"], input[name="user[name]"], #user_short_name',
          );
          if (loginInput) {
            username = await loginInput.evaluate((el) => el.value);
            console.log(
              `[streaming] [${email}] Extracted username from profile settings:`,
              username,
            );
          }
        }
      } catch (navErr) {
        console.log(
          `[streaming] [${email}] Could not navigate to settings:`,
          navErr.message,
        );
      }

      // Method 2: Try to extract from page content/title
      if (!username) {
        try {
          const pageTitle = await session.page.title();
          console.log(`[streaming] [${email}] Page title:`, pageTitle);

          // Sometimes Canvas includes username in title
          const titleMatch = pageTitle.match(/([a-z]{4}\d{4})/i);
          if (titleMatch) {
            username = titleMatch[1];
            console.log(
              `[streaming] [${email}] Extracted username from page title:`,
              username,
            );
          }
        } catch (titleErr) {
          console.log(`[streaming] [${email}] Could not extract from title`);
        }
      }

      // Method 3: Extract from URL if user navigated to their profile
      if (!username) {
        try {
          const url = session.page.url();
          const urlMatch = url.match(/\/users\/\d+/);
          if (urlMatch) {
            // Try to get username from profile page
            await session.page.waitForSelector("body", { timeout: 2000 });
            const profileText = await session.page.textContent("body");
            const usernameMatch = profileText.match(/([a-z]{4}\d{4})/i);
            if (usernameMatch) {
              username = usernameMatch[1];
              console.log(
                `[streaming] [${email}] Extracted username from profile:`,
                username,
              );
            }
          }
        } catch (urlErr) {
          console.log(`[streaming] [${email}] Could not extract from URL`);
        }
      }

      if (!username) {
        console.log(
          `[streaming] [${email}] Could not extract username - will need manual verification`,
        );
      }
    }
  } catch (err) {
    console.warn(
      `[streaming] [${email}] Error extracting username:`,
      err.message,
    );
  }

  // Determine output file for this user (sanitize email for path safety)
  const sanitizedEmail = sanitizeEmailForPath(email);
  const outputFile =
    COOKIE_OUTPUT_FILE ||
    path.join(outputDir, `canvas-cookies-${sanitizedEmail}.json`);

  // Save cookies to file
  const cookieData = {
    username,
    cookies,
    metadata: {
      extractedAt: new Date().toISOString(),
      url: CANVAS_URL,
      email: email,
    },
  };

  fs.writeFileSync(outputFile, JSON.stringify(cookieData, null, 2));
  console.log(`[streaming] [${email}] ✅ Cookies saved to:`, outputFile);
  console.log(
    `[streaming] [${email}]    Username:`,
    username || "not extracted",
  );
  console.log(`[streaming] [${email}]    Cookie count:`, cookies.length);

  return cookieData;
}

/**
 * Monitor page for login completion for a specific user
 * @param {string} email - User email
 */
async function monitorUserLoginCompletion(email) {
  const session = userSessions.get(email);
  if (!session?.page) return;

  console.log(`[streaming] [${email}] Monitoring for login completion...`);

  // Flag to prevent multiple extraction attempts
  let extractionStarted = false;

  // Listen for URL changes
  session.page.on("framenavigated", async (frame) => {
    const s = userSessions.get(email);
    if (!s?.page || frame !== s.page.mainFrame()) return;

    const url = s.page.url();
    console.log(`[streaming] [${email}] Page navigated to:`, url);

    // Check if we're on Canvas (not fedauth) and extraction hasn't started
    if (
      url.includes("canvas.colorado.edu") &&
      !url.includes("fedauth") &&
      !extractionStarted
    ) {
      // Set flag immediately to prevent re-entry
      extractionStarted = true;
      console.log(
        `[streaming] [${email}] ✅ Login complete! User reached Canvas`,
      );
      console.log(`[streaming] [${email}]    Current URL:`, url);

      // Emit login detected status to THIS USER ONLY
      emitUserStatus(email, STATUS_STAGES.LOGIN_DETECTED, "Login successful!");

      // FIRST: Stop screencast to prevent any more frames being sent to THIS USER
      console.log(`[streaming] [${email}] Stopping screencast...`);
      try {
        if (s.cdpSession) {
          await s.cdpSession.send("Page.stopScreencast");
          console.log(`[streaming] [${email}] Screencast stopped`);
        }
      } catch (err) {
        console.log(
          `[streaming] [${email}] Could not stop screencast:`,
          err.message,
        );
      }

      // THEN: Tell THIS USER's frontend to close popup (after screencast is stopped)
      console.log(`[streaming] [${email}] Sending close-popup signal...`);
      emitToUser(email, "close-popup");

      // Wait for popup to close before navigating to profile page
      await s.page.waitForTimeout(300);

      // Extract cookies HEADLESSLY (user won't see profile page navigation)
      try {
        console.log(
          `[streaming] [${email}] Extracting cookies and username headlessly...`,
        );
        const cookieData = await extractUserCookies(email);

        console.log(`[streaming] [${email}] ✅ Cookie extraction completed`);
        console.log(
          `[streaming] [${email}]    Username:`,
          cookieData.username || "not extracted",
        );
        console.log(
          `[streaming] [${email}]    Cookies:`,
          cookieData.cookies.length,
        );

        // Emit completion status to THIS USER ONLY
        emitUserStatus(
          email,
          STATUS_STAGES.COMPLETE,
          "Authentication complete!",
        );

        // Notify THIS USER's clients
        emitToUser(email, "extraction-complete", {
          success: true,
          username: cookieData.username,
          cookieCount: cookieData.cookies.length,
        });

        console.log(
          `[streaming] [${email}] ✅ Notified client of extraction completion`,
        );
        s.extractionComplete = true;

        // Close browser to free resources (but keep session for HTTP polling)
        console.log(`[streaming] [${email}] Closing browser...`);
        if (s.browserContext) {
          await s.browserContext.close();
          s.browserContext = null;
          s.page = null;
          s.cdpSession = null;
        }

        // Schedule session cleanup after 30 seconds to allow frontend to fetch extraction result via HTTP
        console.log(
          `[streaming] [${email}] Session will be cleaned up in 30 seconds (waiting for result fetch)...`,
        );
        scheduleSessionCleanup(email, 30000);
      } catch (err) {
        console.error(`[streaming] [${email}] Error extracting cookies:`, err);
        emitUserStatus(
          email,
          STATUS_STAGES.ERROR,
          "Failed to save credentials",
          {
            suggestion: "Please try logging in again.",
          },
        );
        emitToUser(email, "error", err.message);
      }
    }
  });
}

/**
 * Monitor for "Stale Request" error and auto-recover by restarting browser
 * This fixes Canvas federated authentication errors caused by expired sessions
 * @param {string} email - User email
 */
async function monitorForStaleRequestError(email) {
  const session = userSessions.get(email);
  if (!session?.page) return;

  const checkForStaleRequest = async () => {
    const s = userSessions.get(email);
    if (!s?.page || s.extractionComplete) return;

    try {
      const pageContent = await s.page.textContent("body").catch(() => "");
      if (pageContent.toLowerCase().includes("stale request")) {
        console.log(
          `[streaming] [${email}] Detected "Stale Request" error, restarting browser...`,
        );
        emitUserStatus(
          email,
          STATUS_STAGES.BROWSER_LAUNCHING,
          "Session expired, restarting...",
        );
        await restartUserBrowser(email);
        return;
      }
    } catch (err) {
      // Ignore errors - page might be navigating
    }

    // Continue checking if extraction not complete
    if (!s?.extractionComplete) {
      setTimeout(checkForStaleRequest, 2000);
    }
  };

  // Start checking after initial page load (3 seconds)
  setTimeout(checkForStaleRequest, 3000);
}

/**
 * Start streaming session for a specific user
 * @param {string} email - User email
 */
async function startUserSession(email) {
  const session = userSessions.get(email);
  if (!session) {
    console.error(
      `[streaming] [${email}] No session found, cannot start browser`,
    );
    return;
  }

  try {
    // Set flag to prevent restart during startup
    session.browserStarting = true;

    console.log(`[streaming] [${email}] Starting browser...`);
    console.log(`[streaming] [${email}]    Port:`, PORT);
    console.log(`[streaming] [${email}]    Canvas URL:`, CANVAS_URL);
    console.log(
      `[streaming] [${email}]    Mobile client:`,
      session.isMobileClient,
    );

    // Emit browser launching status to THIS USER ONLY
    emitUserStatus(
      email,
      STATUS_STAGES.BROWSER_LAUNCHING,
      "Starting secure browser...",
    );

    // Launch browser with Playwright's bundled Chromium
    const launchOptions = {
      headless: true,
      args: [
        "--no-sandbox",
        "--disable-setuid-sandbox",
        "--disable-dev-shm-usage",
        "--disable-blink-features=AutomationControlled",
        "--disable-features=IsolateOrigins,site-per-process",
      ],
    };

    if (process.env.CHROME_PATH) {
      launchOptions.executablePath = process.env.CHROME_PATH;
    }

    // Browser launch with timeout
    let browser;
    try {
      const launchPromise = chromium.launch(launchOptions);
      const timeoutPromise = new Promise((_, reject) =>
        setTimeout(
          () => reject(new Error("Browser launch timeout")),
          TIMEOUTS.BROWSER_LAUNCH,
        ),
      );
      browser = await Promise.race([launchPromise, timeoutPromise]);
    } catch (launchErr) {
      emitUserStatus(email, STATUS_STAGES.ERROR, "Failed to start browser", {
        suggestion:
          "The browser may not be installed. Try running: npx playwright install chromium",
      });
      throw launchErr;
    }

    emitUserStatus(
      email,
      STATUS_STAGES.BROWSER_READY,
      "Browser started successfully",
    );

    // Create browser context - use mobile viewport if mobile client
    const viewport = session.isMobileClient
      ? { width: 390, height: 844 } // iPhone 14 Pro dimensions
      : { width: 1280, height: 720 };

    const userAgent = session.isMobileClient
      ? "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1"
      : "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";

    console.log(
      `[streaming] [${email}] Using ${session.isMobileClient ? "mobile" : "desktop"} viewport: ${viewport.width}x${viewport.height}`,
    );

    session.browserContext = await browser.newContext({
      viewport,
      userAgent,
      storageState: undefined,
      bypassCSP: false,
      ignoreHTTPSErrors: false,
      isMobile: session.isMobileClient,
      hasTouch: session.isMobileClient,
    });

    session.page = await session.browserContext.newPage();

    // Enable CDP session for screencast
    emitUserStatus(
      email,
      STATUS_STAGES.SCREENCAST_STARTING,
      "Preparing screen capture...",
    );

    session.cdpSession = await session.page
      .context()
      .newCDPSession(session.page);

    // Start screencast with timeout - use mobile dimensions if mobile client
    try {
      const screencastPromise = session.cdpSession.send(
        "Page.startScreencast",
        {
          format: "jpeg",
          quality: session.isMobileClient ? 70 : 50, // Higher quality for mobile (smaller images)
          maxWidth: viewport.width,
          maxHeight: viewport.height,
          everyNthFrame: 1,
        },
      );
      const timeoutPromise = new Promise((_, reject) =>
        setTimeout(
          () => reject(new Error("Screencast start timeout")),
          TIMEOUTS.SCREENCAST,
        ),
      );
      await Promise.race([screencastPromise, timeoutPromise]);
    } catch (screencastErr) {
      emitUserStatus(
        email,
        STATUS_STAGES.ERROR,
        "Failed to start screen capture",
        {
          suggestion:
            "Please try again. If the problem persists, contact support.",
        },
      );
      await session.browserContext?.close();
      throw screencastErr;
    }

    console.log(`[streaming] [${email}] ✅ Screencast started`);

    // Listen for screencast frames - emit to THIS USER ONLY
    session.cdpSession.on("Page.screencastFrame", async (frame) => {
      // Only emit if session still exists and is not complete
      const s = userSessions.get(email);
      if (s && !s.extractionComplete) {
        emitToUser(email, "frame", frame.data);
      }
      // Always ack the frame
      try {
        await session.cdpSession.send("Page.screencastFrameAck", {
          sessionId: frame.sessionId,
        });
      } catch (ackErr) {
        // Ignore ack errors (session might be closed)
      }
    });

    // Navigate to Canvas login with timeout
    emitUserStatus(
      email,
      STATUS_STAGES.NAVIGATING,
      "Loading Canvas login page...",
    );

    try {
      await session.page.goto(CANVAS_URL, {
        waitUntil: "domcontentloaded",
        timeout: TIMEOUTS.NAVIGATION,
      });
    } catch (navErr) {
      session.browserStarting = false; // Clear flag on error
      emitUserStatus(email, STATUS_STAGES.ERROR, "Failed to load Canvas", {
        suggestion: "Please check your network connection and try again.",
      });
      await session.browserContext?.close();
      throw navErr;
    }

    // Browser is ready - clear the startup flag
    session.browserStarting = false;
    emitUserStatus(
      email,
      STATUS_STAGES.READY_FOR_LOGIN,
      "Ready - please log in to Canvas",
    );

    // Start monitoring for login completion for THIS USER
    monitorUserLoginCompletion(email);

    // Start monitoring for "Stale Request" errors (fedauth session expiry)
    monitorForStaleRequestError(email);
  } catch (err) {
    session.browserStarting = false; // Clear flag on error
    console.error(`[streaming] [${email}] Error starting browser:`, err);
    // Only emit error if not already emitted
    if (session.currentStage !== STATUS_STAGES.ERROR) {
      emitUserStatus(
        email,
        STATUS_STAGES.ERROR,
        err.message || "An unexpected error occurred",
        {
          suggestion: "Please close this window and try again.",
        },
      );
    }
    // Don't exit process - other users might be using the server
    // Just clean up this session
    scheduleSessionCleanup(email, 5000);
  }
}

// Start the server
server.listen(PORT, "0.0.0.0", () => {
  console.log(`[streaming] 🚀 Streaming server started on port ${PORT}`);
  console.log(
    `[streaming]    View at: http://localhost:${PORT}?email=user@example.com`,
  );
  console.log(`[streaming]    Multi-user session isolation ENABLED`);
  console.log(`[streaming]    Browser will start when first client connects`);
});

// Periodic stale session cleanup (every 60 seconds)
const STALE_SESSION_MAX_AGE = 10 * 60 * 1000; // 10 minutes
setInterval(() => {
  const now = Date.now();
  for (const [email, session] of userSessions) {
    const sessionAge = now - session.lastActivity;
    if (sessionAge > STALE_SESSION_MAX_AGE) {
      console.log(
        `[streaming] [${email}] Session stale (${Math.round(sessionAge / 60000)}min inactive), cleaning up`,
      );
      cleanupUserSession(email);
    }
  }
}, 60000);

// Cleanup all sessions on exit
async function cleanupAllSessions() {
  console.log(
    `[streaming] Cleaning up ${userSessions.size} active sessions...`,
  );
  const cleanupPromises = [];
  for (const [email, session] of userSessions) {
    if (session.browserContext) {
      cleanupPromises.push(
        session.browserContext.close().catch((err) => {
          console.error(
            `[streaming] [${email}] Error closing browser:`,
            err.message,
          );
        }),
      );
    }
  }
  await Promise.all(cleanupPromises);
  userSessions.clear();
  socketToEmail.clear();
  sessionTokens.clear();
}

process.on("SIGINT", async () => {
  console.log("\n[streaming] Shutting down (SIGINT)...");
  await cleanupAllSessions();
  process.exit(0);
});

process.on("SIGTERM", async () => {
  console.log("\n[streaming] Shutting down (SIGTERM)...");
  await cleanupAllSessions();
  process.exit(0);
});
