const express = require('express');
const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');
const httpProxy = require('http-proxy');
const { createClient } = require('@supabase/supabase-js');
const { getSupabaseConfig } = require('../core/config');

const router = express.Router();

// Create proxy instance for streaming server
const streamingProxy = httpProxy.createProxyServer({
  target: `http://localhost:${process.env.STREAMING_PORT || 3002}`,
  ws: true, // Enable WebSocket proxying
  changeOrigin: true,
  ignorePath: true // Ignore the incoming path and use target path
});

// Store active streaming processes
const activeStreamingProcesses = new Map();
// Store extraction results by email
const extractionResults = new Map();
// Store session start times by email
const sessionStartTimes = new Map();

// Default streaming port (internal)
const STREAMING_PORT = process.env.STREAMING_PORT || 3002;

// Initialize Supabase client
const supabaseConfig = getSupabaseConfig();
const supabase = createClient(supabaseConfig.url, supabaseConfig.serviceKey);

// Output directory for cookie files
const OUTPUT_DIR = process.env.OUTPUT_DIR || 
  (process.env.HOME 
    ? path.join(process.env.HOME, 'canvas-wrapper-data', 'auth')
    : path.join(__dirname, '..', '..', 'data', 'auth'));

// Helper function to get email-specific cookie filename
function getCookieFilename(email) {
  const sanitizedEmail = email.toLowerCase().replace(/[^a-z0-9]/g, '-');
  return path.join(OUTPUT_DIR, `canvas-cookies-${sanitizedEmail}.json`);
}

/**
 * POST /api/streaming-auth/start
 * Starts the streaming server and returns a proxied URL on port 3000
 */
router.post('/start', async (req, res) => {
  try {
    const { email, forceReauth } = req.body;
    
    if (!email) {
      return res.status(400).json({ 
        success: false,
        error: 'Email is required' 
      });
    }

    const normalizedEmail = email.toLowerCase().trim();

    // Clear any old extraction results and session data for this email
    extractionResults.delete(normalizedEmail);
    sessionStartTimes.set(normalizedEmail, Date.now());
    
    // Delete old cookie file for this email
    const cookieFile = getCookieFilename(normalizedEmail);
    if (fs.existsSync(cookieFile)) {
      fs.unlinkSync(cookieFile);
      console.log(`[streaming-auth] Cleared old cookie file for ${normalizedEmail}`);
    }

    // Check if streaming server is already running
    if (activeStreamingProcesses.size > 0) {
      // Reuse existing streaming server
      const baseUrl = process.env.BACKEND_URL || `http://localhost:${process.env.PORT || 3000}`;
        return res.json({
          success: true,
        url: `${baseUrl}/api/streaming-auth/viewer`,
          message: 'Streaming server already running'
        });
    }

    // Path to the streaming script
    const streamingScriptPath = path.join(__dirname, '..', 'core', 'extract-cookies-streaming.js');
    
    if (!fs.existsSync(streamingScriptPath)) {
      return res.status(500).json({
        success: false,
        error: 'Streaming script not found'
      });
    }

    console.log('[streaming-auth] Starting streaming server on port', STREAMING_PORT);

    // Spawn the streaming script
    const childProcess = spawn('node', [streamingScriptPath], {
      cwd: path.join(__dirname, '..', '..'),
      stdio: ['ignore', 'pipe', 'pipe'],
      detached: false,
      env: {
        ...process.env,
        STREAMING_PORT: String(STREAMING_PORT),
        EXTRACTION_EMAIL: normalizedEmail,
        COOKIE_OUTPUT_FILE: cookieFile, // Email-specific cookie file
        FORCE_REAUTH: forceReauth ? 'true' : 'false'
      }
    });

    // Store the process
    activeStreamingProcesses.set(normalizedEmail, childProcess);

    // Handle process output
    childProcess.stdout.on('data', (data) => {
      const output = data.toString();
      console.log(`[streaming] ${output.trim()}`);
      
      // Check for extraction completion
      if (output.includes('Cookie extraction completed') || output.includes('Login complete')) {
        setTimeout(() => {
          checkAndStoreExtractionResults(normalizedEmail);
        }, 2000);
      }
    });

    childProcess.stderr.on('data', (data) => {
      console.error(`[streaming] Error: ${data.toString().trim()}`);
    });

    // Handle process exit
    childProcess.on('exit', (code) => {
      console.log(`[streaming] Process exited with code ${code}`);
      activeStreamingProcesses.delete(normalizedEmail);
    });

    childProcess.on('error', (error) => {
      console.error(`[streaming] Failed to start process:`, error);
      activeStreamingProcesses.delete(normalizedEmail);
    });

    // Wait for server to start
    await new Promise(resolve => setTimeout(resolve, 3000));

    // Return proxied URL on port 3000
    const baseUrl = process.env.BACKEND_URL || `http://localhost:${process.env.PORT || 3000}`;
    res.json({
      success: true,
      url: `${baseUrl}/api/streaming-auth/viewer`,
      message: 'Streaming server started'
    });

  } catch (error) {
    console.error('[streaming-auth] Error:', error);
    res.status(500).json({ 
      success: false,
      error: error.message || 'Failed to start streaming server' 
    });
  }
});

/**
 * GET /api/streaming-auth/viewer
 * Proxies HTTP requests to the internal streaming server
 */
router.get('/viewer', (req, res) => {
  // Rewrite the path to root for the streaming server
  req.url = '/';
  streamingProxy.web(req, res, (error) => {
    console.error('[streaming-auth] Proxy error:', error);
    if (!res.headersSent) {
      res.status(500).send(`
<!DOCTYPE html>
<html>
<head>
  <title>Streaming Server Starting</title>
  <style>
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
      display: flex;
      align-items: center;
      justify-content: center;
      min-height: 100vh;
      margin: 0;
      background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
    }
    .container {
      background: white;
      padding: 40px;
      border-radius: 16px;
      text-align: center;
      box-shadow: 0 20px 60px rgba(0,0,0,0.3);
      max-width: 500px;
    }
    h1 { color: #333; margin-bottom: 20px; }
    p { color: #666; line-height: 1.6; }
    .spinner {
      border: 4px solid #f3f3f3;
      border-top: 4px solid #667eea;
      border-radius: 50%;
      width: 40px;
      height: 40px;
      animation: spin 1s linear infinite;
      margin: 20px auto;
    }
    @keyframes spin {
      0% { transform: rotate(0deg); }
      100% { transform: rotate(360deg); }
    }
  </style>
  <script>
    setTimeout(() => {
      window.location.reload();
    }, 2000);
  </script>
</head>
<body>
  <div class="container">
    <div class="spinner"></div>
    <h1>🚀 Starting Streaming Server</h1>
    <p>The authentication server is starting up. This page will automatically refresh in a moment...</p>
    <p style="margin-top: 20px;"><small>If this persists, please close this window and try again.</small></p>
  </div>
</body>
</html>
      `);
    }
  });
});

// WebSocket upgrades are handled at the server level in server.js

/**
 * POST /api/streaming-auth/stop
 * Stops the streaming process for an email
 */
router.post('/stop', async (req, res) => {
  try {
    const { email } = req.body;
    
    if (!email) {
      return res.status(400).json({ 
        success: false,
        error: 'Email is required' 
      });
    }

    const normalizedEmail = email.toLowerCase().trim();
    const process = activeStreamingProcesses.get(normalizedEmail);
    
    if (process && !process.killed) {
      process.kill();
      activeStreamingProcesses.delete(normalizedEmail);
      res.json({
        success: true,
        message: 'Streaming server stopped'
      });
    } else {
      res.json({
        success: true,
        message: 'No active streaming server found'
      });
    }
  } catch (error) {
    console.error('Stop streaming error:', error);
    res.status(500).json({ 
      success: false,
      error: error.message || 'Failed to stop streaming server' 
    });
  }
});

/**
 * DELETE /api/streaming-auth/cookies/:email
 * Deletes cookies for a specific email (used on logout)
 */
router.delete('/cookies/:email', async (req, res) => {
  try {
    const { email } = req.params;
    
    if (!email) {
      return res.status(400).json({ 
        success: false,
        error: 'Email is required' 
      });
    }

    const normalizedEmail = email.toLowerCase().trim();
    
    // Delete email-specific cookie file
    const cookieFile = getCookieFilename(normalizedEmail);
    let deleted = false;
    
    if (fs.existsSync(cookieFile)) {
      try {
        fs.unlinkSync(cookieFile);
        deleted = true;
        console.log(`[streaming-auth] Deleted cookie file for ${normalizedEmail}`);
      } catch (deleteError) {
        console.error(`[streaming-auth] Error deleting cookie file:`, deleteError);
      }
    }
    
    // Clear from memory
    extractionResults.delete(normalizedEmail);
    sessionStartTimes.delete(normalizedEmail);
    
    // Stop any active streaming process for this email
    const process = activeStreamingProcesses.get(normalizedEmail);
    if (process && !process.killed) {
      process.kill();
      activeStreamingProcesses.delete(normalizedEmail);
    }
    
    res.json({
      success: true,
      message: deleted ? 'Cookies deleted successfully' : 'No cookies found to delete',
      deleted
    });
  } catch (error) {
    console.error('Delete cookies error:', error);
    res.status(500).json({ 
      success: false,
      error: error.message || 'Failed to delete cookies' 
    });
  }
});

/**
 * GET /api/streaming-auth/status
 * Check if streaming server is running
 */
router.get('/status', (req, res) => {
  res.json({
    success: true,
    activeProcesses: activeStreamingProcesses.size,
    port: STREAMING_PORT
  });
});

/**
 * POST /api/streaming-auth/check-email
 * Check if email exists in Supabase
 */
router.post('/check-email', async (req, res) => {
  try {
    const { email } = req.body;
    
    if (!email) {
      return res.status(400).json({ 
        success: false,
        error: 'Email is required' 
      });
    }

    const normalizedEmail = email.toLowerCase().trim();
    
    // Check if user exists in Supabase
    const { data, error } = await supabase
      .from('users')
      .select('*')
      .eq('email', normalizedEmail)
      .single();

    if (error && error.code !== 'PGRST116') {
      console.error('Error checking email:', error);
      return res.status(500).json({
        success: false,
        error: 'Failed to check email'
      });
    }

    const userExists = !!data;
    
    res.json({
      success: true,
      exists: userExists,
      user: userExists ? data : null
    });

  } catch (error) {
    console.error('Check email error:', error);
    res.status(500).json({ 
      success: false,
      error: error.message || 'Failed to check email' 
    });
  }
});

/**
 * Validate cookies using the same logic as canvas-crawler.js
 * Also checks if cookies were extracted within the last 24 hours
 */
function validateCookies(cookies, extractedAt = null) {
  if (!cookies || !Array.isArray(cookies) || cookies.length === 0) {
    return { valid: false, reason: 'No cookies found' };
  }

  // Check for essential Canvas cookies
  const hasSessionCookie = cookies.some(c => 
    c.name && (c.name.includes('session') || 
    c.name.includes('canvas') || 
    c.name.includes('_session'))
  );
  
  const hasAuthCookie = cookies.some(c => 
    c.domain && (c.domain.includes('canvas') || 
    c.domain.includes('colorado.edu') ||
    c.domain.includes('instructure.com'))
  );

  if (!hasSessionCookie && !hasAuthCookie) {
    return { valid: false, reason: 'No valid Canvas authentication cookies found' };
  }

  // Check if cookies are expired (if expiration is set)
  const now = Date.now();
  const expiredCookies = cookies.filter(c => {
    if (c.expires && c.expires !== -1) {
      const expiryTime = typeof c.expires === 'number' ? c.expires * 1000 : new Date(c.expires).getTime();
      return expiryTime < now;
    }
    return false;
  });

  if (expiredCookies.length === cookies.length) {
    return { valid: false, reason: 'All cookies are expired' };
  }

  // Check if cookies are older than 24 hours
  if (extractedAt) {
    const extractionTime = new Date(extractedAt).getTime();
    const hoursSinceExtraction = (now - extractionTime) / (1000 * 60 * 60);
    
    if (hoursSinceExtraction > 24) {
      return { valid: false, reason: 'Cookies are older than 24 hours and need to be refreshed' };
    }
  }

  return { valid: true, reason: null };
}

/**
 * GET /api/streaming-auth/extraction-result/:email
 * Get extraction results for an email
 * Only returns data if cookies are valid
 */
router.get('/extraction-result/:email', async (req, res) => {
  try {
    const { email } = req.params;
    const normalizedEmail = email.toLowerCase().trim();
    
    // Check if there's an active session for this email
    const hasActiveSession = sessionStartTimes.has(normalizedEmail);
    
    // Check in-memory results first
    if (extractionResults.has(normalizedEmail)) {
      const result = extractionResults.get(normalizedEmail);
      
      // Validate cookies before returning (includes 24-hour check)
      if (result.cookies && Array.isArray(result.cookies)) {
        const cookieValidation = validateCookies(result.cookies, result.extractedAt);
        if (!cookieValidation.valid) {
          // Clear the invalid result
          extractionResults.delete(normalizedEmail);
          return res.json({
            success: false,
            error: 'Cookies are invalid',
            reason: cookieValidation.reason,
            requiresReauth: true
          });
        }
      }
      
      return res.json({
        success: true,
        ...result
      });
    }

    // Check file system for results (email-specific file)
    const outputFile = getCookieFilename(normalizedEmail);
    
    if (fs.existsSync(outputFile)) {
      try {
        const cookieData = JSON.parse(fs.readFileSync(outputFile, 'utf8'));
        const extractedAt = cookieData.metadata?.extractedAt || null;
        
        // Validate cookies before returning (includes 24-hour check)
        if (cookieData.cookies && Array.isArray(cookieData.cookies)) {
          const cookieValidation = validateCookies(cookieData.cookies, extractedAt);
          if (!cookieValidation.valid) {
            // Delete the invalid cookie file
            fs.unlinkSync(outputFile);
            console.log(`[streaming-auth] Deleted invalid cookie file for ${normalizedEmail}: ${cookieValidation.reason}`);
            
            return res.json({
              success: false,
              error: 'Cookies are invalid',
              reason: cookieValidation.reason,
              requiresReauth: true
            });
          }
        }
        
        // Store in memory for future requests
        const result = {
          username: cookieData.username || cookieData.metadata?.username || null,
          cookies: cookieData.cookies || [],
          extractedAt: extractedAt
        };
        extractionResults.set(normalizedEmail, result);
        
        return res.json({
          success: true,
          ...result
        });
      } catch (parseError) {
        console.error('Error parsing cookie file:', parseError);
      }
    }

    // No results found - check if there's an active session
    if (!hasActiveSession) {
      return res.json({
        success: false,
        error: 'No authentication session found',
        requiresReauth: true
      });
    }

    // Active session exists but extraction not complete yet
    // Return pending status instead of error
    res.json({
      success: false,
      pending: true,
      message: 'Authentication in progress. Please complete login in the popup window.'
    });

  } catch (error) {
    console.error('Get extraction result error:', error);
    res.status(500).json({ 
      success: false,
      error: error.message || 'Failed to get extraction result' 
    });
  }
});

/**
 * POST /api/streaming-auth/verify-login
 * Verify that extracted username matches email (at least 30%)
 */
router.post('/verify-login', async (req, res) => {
  try {
    const { email, username } = req.body;
    
    if (!email || !username) {
      return res.status(400).json({ 
        success: false,
        error: 'Email and username are required' 
      });
    }

    // Extract identikey from email (e.g., xxxx1235@colorado.edu -> xxxx1235)
    const emailMatch = email.match(/^([^@]+)@colorado\.edu$/i);
    const identikey = emailMatch ? emailMatch[1].toLowerCase() : null;
    
    if (!identikey) {
      return res.json({
        success: false,
        error: 'Invalid email format. Expected identikey@colorado.edu'
      });
    }

    // Normalize username for comparison
    const normalizedUsername = username.toLowerCase().trim();
    
    // Calculate similarity (simple character-based matching)
    // Check if identikey appears in username or vice versa
    const usernameContainsIdentikey = normalizedUsername.includes(identikey);
    const identikeyContainsUsername = identikey.includes(normalizedUsername);
    
    // Calculate character overlap percentage
    let matchPercentage = 0;
    if (usernameContainsIdentikey || identikeyContainsUsername) {
      // If one contains the other, it's at least a partial match
      const shorter = identikey.length < normalizedUsername.length ? identikey : normalizedUsername;
      const longer = identikey.length >= normalizedUsername.length ? identikey : normalizedUsername;
      
      // Count matching characters
      let matchingChars = 0;
      for (let i = 0; i < shorter.length; i++) {
        if (longer.includes(shorter[i])) {
          matchingChars++;
        }
      }
      
      matchPercentage = (matchingChars / shorter.length) * 100;
    } else {
      // Calculate Levenshtein-like similarity
      const commonChars = new Set();
      for (const char of identikey) {
        if (normalizedUsername.includes(char)) {
          commonChars.add(char);
        }
      }
      matchPercentage = (commonChars.size / Math.max(identikey.length, normalizedUsername.length)) * 100;
    }

    const isValid = matchPercentage >= 30;

    res.json({
      success: true,
      isValid,
      matchPercentage: Math.round(matchPercentage * 100) / 100,
      identikey,
      username: normalizedUsername
    });

  } catch (error) {
    console.error('Verify login error:', error);
    res.status(500).json({ 
      success: false,
      error: error.message || 'Failed to verify login' 
    });
  }
});

// Function to check and store extraction results
function checkAndStoreExtractionResults(email) {
  const normalizedEmail = email.toLowerCase().trim();
  const outputFile = getCookieFilename(normalizedEmail);
  
  if (fs.existsSync(outputFile)) {
    try {
      const cookieData = JSON.parse(fs.readFileSync(outputFile, 'utf8'));
      const username = cookieData.username || cookieData.metadata?.username;
      const extractedAt = cookieData.metadata?.extractedAt || new Date().toISOString();
      
      if (username) {
        extractionResults.set(normalizedEmail, {
          username,
          cookies: cookieData.cookies || [],
          extractedAt
        });
        console.log(`[streaming-auth] Stored extraction results for ${normalizedEmail}`);
      }
    } catch (error) {
      console.error('[streaming-auth] Error parsing extraction results:', error);
    }
  }
}

// Monitor extraction results periodically (fallback)
setInterval(() => {
  // Only check if we have active processes
  if (activeStreamingProcesses.size > 0) {
    for (const [email] of activeStreamingProcesses) {
      if (!extractionResults.has(email.toLowerCase().trim())) {
        checkAndStoreExtractionResults(email);
      }
    }
  }
}, 3000); // Check every 3 seconds

module.exports = router;

