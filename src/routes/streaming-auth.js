const express = require('express');
const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');
const httpProxy = require('http-proxy');
const { createClient } = require('@supabase/supabase-js');
const { getSupabaseConfig } = require('../core/config');
const { 
  getCookieFilename, 
  getMainCookieFile, 
  copyCookiesToMainFile,
  OUTPUT_DIR 
} = require('../utils/cookie-helpers');

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
// Store active AWS update processes to prevent multiple simultaneous runs
const activeAwsUpdateProcesses = new Set();

// Default streaming port (internal)
const STREAMING_PORT = process.env.STREAMING_PORT || 3002;

// Initialize Supabase client
const supabaseConfig = getSupabaseConfig();
const supabase = createClient(supabaseConfig.url, supabaseConfig.serviceKey);

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
      
      // Check for extraction completion - multiple patterns to catch it
      if (output.includes('Cookie extraction completed') || 
          output.includes('Login complete') ||
          output.includes('✅ Cookie extraction completed') ||
          output.includes('Cookies saved to:')) {
        console.log('[streaming-auth] Detected cookie extraction completion, checking results...');
        setTimeout(() => {
          checkAndStoreExtractionResults(normalizedEmail);
        }, 2000);
      }
    });

    childProcess.stderr.on('data', (data) => {
      console.error(`[streaming] Error: ${data.toString().trim()}`);
    });

    // Handle process exit - also check for extraction results on exit
    childProcess.on('exit', (code) => {
      console.log(`[streaming] Process exited with code ${code}`);
      
      // Check for extraction results on exit (in case stdout messages were missed)
      if (code === 0) {
        console.log('[streaming-auth] Streaming process completed successfully, checking for extraction results...');
        setTimeout(() => {
          checkAndStoreExtractionResults(normalizedEmail);
        }, 1000);
      }
      
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


/**
 * Run AWS update script in the background
 * This runs asynchronously and doesn't block the login flow
 * Prevents multiple simultaneous runs
 */
function runAwsUpdateInBackground() {
  // Check if AWS update is already running
  if (activeAwsUpdateProcesses.size > 0) {
    console.log('[streaming-auth] AWS update script already running, skipping duplicate run');
    return;
  }
  
  const awsUpdateScript = path.join(__dirname, '..', '..', 'scripts', 'aws', 'run-aws-update.js');
  
  if (!fs.existsSync(awsUpdateScript)) {
    console.warn('[streaming-auth] AWS update script not found at:', awsUpdateScript);
    console.warn('[streaming-auth] Skipping background update');
    return;
  }
  
  // Check if AWS_INSTANCE_ID is configured
  if (!process.env.AWS_INSTANCE_ID) {
    console.warn('[streaming-auth] AWS_INSTANCE_ID not configured, skipping AWS update');
    console.warn('[streaming-auth] Set AWS_INSTANCE_ID environment variable to enable automatic updates');
    return;
  }
  
  console.log('[streaming-auth] ✅ Starting AWS update script in background...');
  console.log('[streaming-auth]    AWS Instance ID:', process.env.AWS_INSTANCE_ID);
  console.log('[streaming-auth]    Script path:', awsUpdateScript);
  
  // Spawn the AWS update script as a detached process
  const childProcess = spawn('node', [awsUpdateScript], {
    cwd: path.join(__dirname, '..', '..', '..'),
    stdio: ['ignore', 'pipe', 'pipe'],
    detached: true, // Detach so it runs independently
    env: {
      ...process.env,
      // Ensure the AWS update script has access to all necessary env vars
    }
  });
  
  // Track this process
  activeAwsUpdateProcesses.add(childProcess.pid);
  console.log('[streaming-auth]    AWS update process started with PID:', childProcess.pid);
  
  // Unref to allow the parent process to exit independently
  childProcess.unref();
  
  // Log output for debugging (but don't block)
  childProcess.stdout.on('data', (data) => {
    const output = data.toString().trim();
    console.log(`[aws-update] ${output}`);
  });
  
  childProcess.stderr.on('data', (data) => {
    const output = data.toString().trim();
    console.error(`[aws-update] ${output}`);
  });
  
  childProcess.on('exit', (code) => {
    activeAwsUpdateProcesses.delete(childProcess.pid);
    if (code === 0) {
      console.log('[streaming-auth] ✅ AWS update script completed successfully');
    } else {
      console.warn(`[streaming-auth] ⚠️  AWS update script exited with code ${code}`);
    }
  });
  
  childProcess.on('error', (error) => {
    activeAwsUpdateProcesses.delete(childProcess.pid);
    console.error('[streaming-auth] ❌ Failed to start AWS update script:', error);
  });
}

// Function to check and store extraction results
function checkAndStoreExtractionResults(email) {
  const normalizedEmail = email.toLowerCase().trim();
  const outputFile = getCookieFilename(normalizedEmail);
  
  console.log('[streaming-auth] Checking extraction results for:', normalizedEmail);
  console.log('[streaming-auth]    Looking for file:', outputFile);
  console.log('[streaming-auth]    File exists:', fs.existsSync(outputFile));
  
  if (fs.existsSync(outputFile)) {
    try {
      const cookieData = JSON.parse(fs.readFileSync(outputFile, 'utf8'));
      const username = cookieData.username || cookieData.metadata?.username;
      const extractedAt = cookieData.metadata?.extractedAt || new Date().toISOString();
      
      console.log('[streaming-auth]    Cookie data parsed successfully');
      console.log('[streaming-auth]    Username:', username || 'not found');
      console.log('[streaming-auth]    Cookies count:', cookieData.cookies?.length || 0);
      
      // Store extraction results even if username is missing (cookies are what matter for auth)
      extractionResults.set(normalizedEmail, {
        username: username || null,
        cookies: cookieData.cookies || [],
        extractedAt
      });
      
      if (username) {
        console.log(`[streaming-auth] ✅ Stored extraction results for ${normalizedEmail} (with username)`);
      } else {
        console.log(`[streaming-auth] ✅ Stored extraction results for ${normalizedEmail} (username not extracted, but cookies are valid)`);
      }
      
      // Copy cookies to main file for AWS update script compatibility
      console.log('[streaming-auth] Starting cookie copy process...');
      const copied = copyCookiesToMainFile(normalizedEmail);
      
      if (copied) {
        console.log('[streaming-auth] ✅ Cookies copied successfully, triggering AWS update...');
        // Trigger AWS update script in background after successful cookie extraction
        // Only if username exists (AWS update might need it)
        if (username) {
          runAwsUpdateInBackground();
        } else {
          console.warn('[streaming-auth] ⚠️  Username not found, skipping AWS update (but cookies are saved)');
        }
      } else {
        console.error('[streaming-auth] ❌ Failed to copy cookies, AWS update will not run');
      }
    } catch (error) {
      console.error('[streaming-auth] ❌ Error parsing extraction results:', error);
    }
  } else {
    console.warn('[streaming-auth] ⚠️  Cookie file not found, cannot process extraction results');
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

/**
 * GET /api/streaming-auth/update-status
 * Check AWS update status and configuration
 */
router.get('/update-status', async (req, res) => {
  try {
    const mainCookieFile = getMainCookieFile();
    const awsUpdateScript = path.join(__dirname, '..', '..', 'scripts', 'aws', 'run-aws-update.js');
    
    const status = {
      awsConfigured: !!process.env.AWS_INSTANCE_ID,
      awsInstanceId: process.env.AWS_INSTANCE_ID || null,
      scriptExists: fs.existsSync(awsUpdateScript),
      scriptPath: awsUpdateScript,
      cookiesExist: fs.existsSync(mainCookieFile),
      cookieFile: mainCookieFile,
      activeUpdates: activeAwsUpdateProcesses.size,
      ready: !!process.env.AWS_INSTANCE_ID && fs.existsSync(awsUpdateScript) && fs.existsSync(mainCookieFile)
    };
    
    res.json({
      success: true,
      ...status
    });
  } catch (error) {
    console.error('[streaming-auth] Error checking update status:', error);
    res.status(500).json({
      success: false,
      error: error.message || 'Failed to check update status'
    });
  }
});

/**
 * POST /api/streaming-auth/trigger-update
 * Manually trigger AWS update script (for testing/debugging)
 */
router.post('/trigger-update', async (req, res) => {
  try {
    console.log('[streaming-auth] Manual AWS update trigger requested');
    
    // Check if AWS_INSTANCE_ID is configured
    if (!process.env.AWS_INSTANCE_ID) {
      return res.status(400).json({
        success: false,
        error: 'AWS_INSTANCE_ID not configured'
      });
    }
    
    // Check if main cookie file exists
    const mainCookieFile = getMainCookieFile();
    if (!fs.existsSync(mainCookieFile)) {
      return res.status(400).json({
        success: false,
        error: 'No cookies found. Please login first.',
        cookieFile: mainCookieFile
      });
    }
    
    // Trigger AWS update
    runAwsUpdateInBackground();
    
    res.json({
      success: true,
      message: 'AWS update script triggered in background',
      awsInstanceId: process.env.AWS_INSTANCE_ID
    });
  } catch (error) {
    console.error('[streaming-auth] Error triggering update:', error);
    res.status(500).json({
      success: false,
      error: error.message || 'Failed to trigger update'
    });
  }
});

module.exports = router;

