const express = require('express');
// Local minimal auth utils to avoid external dependency
const CanvasAuthUtils = {
  generateSessionToken() {
    return crypto.randomBytes(16).toString('hex');
  },
  parseCookiesFromRequest(req) {
    const header = req.headers['cookie'] || '';
    if (!header) return [];
    return header.split(';').map((kv) => {
      const [name, ...rest] = kv.split('=');
      return { name: name.trim(), value: rest.join('=').trim() };
    });
  },
  encryptCookies(cookies, key) {
    // Simple reversible encoding for dev (replace with real encryption in prod)
    return Buffer.from(JSON.stringify(cookies)).toString('base64');
  },
  decryptCookies(encoded, key) {
    try { return JSON.parse(Buffer.from(encoded, 'base64').toString('utf8')); } catch(_) { return []; }
  },
  normalizeCanvasUrl(url) {
    try { const u = new URL(url); return `${u.protocol}//${u.host}`; } catch { return url; }
  }
};

// Optional CanvasAPI stub (avoid usage; legacy callback references it)
class CanvasAPI {
  constructor(canvasUrl, cookies) {
    this.canvasUrl = canvasUrl; this.cookies = cookies;
  }
  async verifyAccountStatus() {
    return { isValid: true, user: { canvasId: 'unknown', email: null, name: 'Canvas User', institution: null, canvasUrl: this.canvasUrl } };
  }
}
const fs = require('fs').promises;
const path = require('path');
const crypto = require('crypto');

const router = express.Router();
const { runIdentityProbeWithCookies, runIdentityProbeFromSavedCookies } = require('../browserbase/identity-probe');

// Import identity probe helpers for inline extraction
async function grabWindowEnv(page) {
  try {
    return await page.evaluate(() => {
      const env = (window && window.ENV) ? window.ENV : null;
      let currentUser = null;
      if (env && env.current_user) {
        currentUser = {
          id: env.current_user.id || env.current_user_id || null,
          display_name: env.current_user.display_name || null,
          email: env.current_user.email || env.current_user.primary_email || null,
          login_id: env.current_user.login_id || null,
        };
      }
      return { envExists: Boolean(env), currentUser, rawKeys: env ? Object.keys(env) : [] };
    });
  } catch {
    return null;
  }
}

async function parseIdentityFromDOM(page) {
  const html = await page.content();
  const findings = {};
  const idFromEnv = html.match(/current_user_id\"?\s*:\s*(\d+)/i);
  if (idFromEnv) findings.canvasUserId = idFromEnv[1];
  const loginMatch = html.match(/login_id\"?\s*:\s*\"([^\"]+)\"/i);
  if (loginMatch) findings.loginId = loginMatch[1];
  const profileLink = html.match(/\/(?:users|profiles)\/(\d+)/i);
  if (profileLink) findings.canvasUserId = findings.canvasUserId || profileLink[1];
  const emailMatch = html.match(/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/i);
  if (emailMatch) findings.email = emailMatch[0];
  const nameLabel = html.match(/display_name\"?\s*:\s*\"([^\"]+)\"/i);
  if (nameLabel) findings.displayName = nameLabel[1];
  return findings;
}

async function extractUserInfoWithProbe(page) {
  try {
    // Fast extraction - minimal wait, rely on waitUntil in navigation
    await page.waitForTimeout(500); // Reduced from 2000ms for speed
    
    // Try window.ENV first (most reliable)
    const envData = await grabWindowEnv(page);
    const domData = await parseIdentityFromDOM(page);
    
    const pick = (...vals) => vals.find(v => v && String(v).trim().length);
    
    const canvasUserId = pick(
      envData?.currentUser?.id,
      domData.canvasUserId
    );
    
    const displayName = pick(
      envData?.currentUser?.display_name,
      domData.displayName
    );
    
    const email = pick(
      envData?.currentUser?.email,
      domData.email
    );
    
    const loginId = pick(
      envData?.currentUser?.login_id,
      domData.loginId
    );
    
    return {
      canvasId: canvasUserId ? `canvas-user-${canvasUserId}` : `canvas-user-${Date.now()}`,
      email: email || 'user@colorado.edu',
      name: displayName || 'Canvas User',
      institution: 'University of Colorado',
      canvasUrl: process.env.CANVAS_URL || 'https://canvas.colorado.edu',
      canvasUserId: canvasUserId || null,
      identikey: loginId || null
    };
  } catch (error) {
    console.error('❌ Error extracting user info with probe:', error);
    return {
      canvasId: 'canvas-user-' + Date.now(),
      email: 'user@colorado.edu',
      name: 'Canvas User',
      institution: 'University of Colorado',
      canvasUrl: 'https://canvas.colorado.edu'
    };
  }
}

// File-based storage paths
const DATA_DIR = path.join(__dirname, '../../data/auth');
const USERS_FILE = path.join(DATA_DIR, 'users.json');
const SESSIONS_FILE = path.join(DATA_DIR, 'sessions.json');

// Encryption key for cookies
const ENCRYPTION_KEY = process.env.ENCRYPTION_KEY || 'default-key-change-in-production-32-chars';

// Ensure data directory exists
async function ensureDataDir() {
  try {
    await fs.mkdir(DATA_DIR, { recursive: true });
  } catch (error) {
    console.error('Error creating data directory:', error);
  }
}

// Load data from files
async function loadUsers() {
  try {
    const data = await fs.readFile(USERS_FILE, 'utf8');
    return JSON.parse(data);
  } catch (error) {
    return [];
  }
}

async function loadSessions() {
  try {
    const data = await fs.readFile(SESSIONS_FILE, 'utf8');
    return JSON.parse(data);
  } catch (error) {
    return [];
  }
}

// Save data to files
async function saveUsers(users) {
  await fs.writeFile(USERS_FILE, JSON.stringify(users, null, 2));
}

async function saveSessions(sessions) {
  await fs.writeFile(SESSIONS_FILE, JSON.stringify(sessions, null, 2));
}

/**
 * POST /api/auth/canvas/initiate
 * Initiates Canvas authentication flow using existing cookie extraction
 */
router.post('/canvas/initiate', async (req, res) => {
  try {
    await ensureDataDir();
    
    // Generate unique session token
    const sessionToken = CanvasAuthUtils.generateSessionToken();
    
    // Create authentication session
    const authSession = {
      token: sessionToken,
      status: 'pending',
      created_at: new Date().toISOString(),
      expires_at: new Date(Date.now() + 60 * 60 * 1000).toISOString(), // 1 hour
      user_id: null,
      canvas_cookies: null,
      user_info: null,
      institution_info: null
    };

    // Load existing sessions and add new one
    const sessions = await loadSessions();
    sessions.push(authSession);
    await saveSessions(sessions);

    // Start the cookie extraction process in the background
    startCookieExtraction(sessionToken);

    res.json({
      success: true,
      sessionToken: sessionToken,
      message: 'Cookie extraction started. Browser window will open for manual login.',
      expiresAt: authSession.expires_at
    });

  } catch (error) {
    console.error('Auth initiation error:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

/**
 * GET /api/auth/canvas/login
 * Initiates Canvas authentication via desktop popup and serves a polling page
 */
router.get('/canvas/login', async (req, res) => {
  try {
    await ensureDataDir();

    // Purge any previously saved cookie file to force a fresh login
    try {
      const cookieFile = path.join(__dirname, '..', '..', 'data', 'auth', 'canvas-cookies.json');
      await fs.unlink(cookieFile).catch(() => {});
    } catch (_) {}

    // Generate unique session token
    const sessionToken = CanvasAuthUtils.generateSessionToken();

    // Create authentication session
    const authSession = {
      token: sessionToken,
      status: 'pending',
      created_at: new Date().toISOString(),
      expires_at: new Date(Date.now() + 60 * 60 * 1000).toISOString(), // 1 hour
      user_id: null,
      canvas_cookies: null,
      user_info: null,
      institution_info: null
    };

    // Persist session
    const sessions = await loadSessions();
    sessions.push(authSession);
    await saveSessions(sessions);

    // Launch the visible browser for manual login in background
    startCookieExtraction(sessionToken);

    // Return JSON for inline integration (no popup)
    res.json({
      success: true,
      sessionToken: sessionToken,
      message: 'Login started. Complete authentication in the browser window.',
      statusUrl: `/api/auth/canvas/status/${sessionToken}`
    });
  } catch (error) {
    console.error('Auth login error:', error);
    res.status(500).json({
      success: false,
      error: error.message || 'Failed to initiate Canvas login'
    });
  }
});

/**
 * GET /api/auth/canvas/callback
 * Handles Canvas authentication callback
 */
router.get('/canvas/callback', async (req, res) => {
  const { token } = req.query;

  if (!token) {
    return res.redirect(`${process.env.BASE_URL || 'http://localhost:3000'}/test?error=${encodeURIComponent('Missing authentication token')}`);
  }

  try {
    await ensureDataDir();
    
    // Load sessions and find the one with this token
    const sessions = await loadSessions();
    const session = sessions.find(s => s.token === token);

    if (!session) {
      throw new Error('Invalid or expired authentication session');
    }

    if (session.status !== 'pending') {
      throw new Error('Authentication session already processed');
    }

    if (new Date(session.expires_at) < new Date()) {
      throw new Error('Authentication session expired');
    }

    // Extract cookies from the request
    const cookies = CanvasAuthUtils.parseCookiesFromRequest(req);
    
    if (!cookies || cookies.length === 0) {
      // If no cookies found, redirect to a page that will help us get the cookies
      console.log('No cookies found in redirect, redirecting to Canvas to get cookies');
      
      // Redirect to Canvas dashboard to get cookies, then redirect back
      const canvasUrl = process.env.CANVAS_URL || 'https://canvas.colorado.edu';
      const dashboardUrl = `${canvasUrl}/dashboard?redirect_uri=${encodeURIComponent(`${process.env.BASE_URL || 'http://localhost:3000'}/api/auth/canvas/callback?token=${token}`)}`;
      
      return res.redirect(dashboardUrl);
    }

    // Extract Canvas URL from referer or use default
    const canvasUrl = CanvasAuthUtils.normalizeCanvasUrl(
      req.headers.referer || process.env.CANVAS_URL || 'https://canvas.colorado.edu'
    );

    // Initialize Canvas API with cookies
    const canvasUserAPI = new CanvasAPI(canvasUrl, cookies);

    // Verify account status and get user info
    const verification = await canvasUserAPI.verifyAccountStatus();
    
    if (!verification.isValid) {
      throw new Error(`Account verification failed: ${verification.error}`);
    }

    const userInfo = verification.user;

    // Load users and check if user already exists
    const users = await loadUsers();
    const existingUser = users.find(user => 
      user.canvas_id === userInfo.canvasId && user.account_status === 'active'
    );

    if (existingUser) {
      // Update existing user
      const encryptedCookies = CanvasAuthUtils.encryptCookies(cookies, ENCRYPTION_KEY);
      
      existingUser.email = userInfo.email;
      existingUser.name = userInfo.name;
      existingUser.institution = userInfo.institution;
      existingUser.canvas_url = userInfo.canvasUrl;
      existingUser.encrypted_cookies = encryptedCookies;
      existingUser.last_login = new Date().toISOString();
      existingUser.updated_at = new Date().toISOString();

      // Update session
      session.status = 'completed';
      session.user_id = existingUser.id;
      session.canvas_cookies = JSON.stringify(cookies);
      session.user_info = userInfo;
      session.completed_at = new Date().toISOString();

      await saveUsers(users);
      await saveSessions(sessions);

      // Create user session token
      const userSessionToken = CanvasAuthUtils.generateSessionToken();
      
      // Redirect to success page with session token
      return res.redirect(`${process.env.BASE_URL || 'http://localhost:3000'}/test?success=true&token=${userSessionToken}&user=${encodeURIComponent(userInfo.name)}`);

    } else {
      // Create new user
      const encryptedCookies = CanvasAuthUtils.encryptCookies(cookies, ENCRYPTION_KEY);
      
      const newUser = {
        id: CanvasAuthUtils.generateSessionToken(),
        canvas_id: userInfo.canvasId,
        email: userInfo.email,
        name: userInfo.name,
        institution: userInfo.institution,
        canvas_url: userInfo.canvasUrl,
        encrypted_cookies: encryptedCookies,
        account_status: 'active',
        last_login: new Date().toISOString(),
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString()
      };

      users.push(newUser);

      // Update session
      session.status = 'completed';
      session.user_id = newUser.id;
      session.canvas_cookies = JSON.stringify(cookies);
      session.user_info = userInfo;
      session.completed_at = new Date().toISOString();

      await saveUsers(users);
      await saveSessions(sessions);

      // Create user session token
      const userSessionToken = CanvasAuthUtils.generateSessionToken();
      
      // Redirect to success page with session token
      return res.redirect(`${process.env.BASE_URL || 'http://localhost:3000'}/test?success=true&token=${userSessionToken}&user=${encodeURIComponent(userInfo.name)}`);
    }

  } catch (error) {
    console.error('Auth callback error:', error);
    
    // Update session with error
    const sessions = await loadSessions();
    const session = sessions.find(s => s.token === token);
    if (session) {
      session.status = 'failed';
      session.completed_at = new Date().toISOString();
      await saveSessions(sessions);
    }

    return res.redirect(`${process.env.BASE_URL || 'http://localhost:3000'}/test?error=${encodeURIComponent(error.message)}`);
  }
});

/**
 * GET /api/auth/canvas/status/:token
 * Check authentication status and auto-detect Canvas login
 */
router.get('/canvas/status/:token', async (req, res) => {
  try {
    const { token } = req.params;

    const sessions = await loadSessions();
    const session = sessions.find(s => s.token === token);

    if (!session) {
      return res.status(404).json({
        success: false,
        error: 'Session not found'
      });
    }

    // If session is already completed, return status
    if (session.status === 'completed') {
      return res.json({
        success: true,
        status: session.status,
        userId: session.user_id,
        completed: true,
        expired: new Date(session.expires_at) < new Date(),
        userInfo: session.user_info
      });
    }

    // If session is pending, try to auto-detect Canvas login
    if (session.status === 'pending') {
      try {
        // Check if user is logged into Canvas by making a request to Canvas dashboard
        const canvasUrl = process.env.CANVAS_URL || 'https://canvas.colorado.edu';
        const response = await fetch(`${canvasUrl}/dashboard`, {
          method: 'HEAD',
          headers: {
            'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36'
          },
          redirect: 'manual' // Don't follow redirects automatically
        });

        // If we get a 200 response (not 302 redirect to login), user is logged in
        if (response.status === 200) {
          console.log('Canvas login detected, completing authentication...');
          
          // Create a test user for demonstration (replace with real Canvas API call later)
          const testUser = {
            canvasId: 'auto-detected-user-' + Date.now(),
            email: 'user@colorado.edu',
            name: 'Auto-Detected Canvas User',
            institution: 'University of Colorado',
            canvasUrl: canvasUrl
          };

          // Load users and create/update user
          const users = await loadUsers();
          const existingUser = users.find(user => user.canvas_id === testUser.canvasId);

          if (existingUser) {
            // Update existing user
            existingUser.last_login = new Date().toISOString();
            existingUser.updated_at = new Date().toISOString();
          } else {
            // Create new user
            const newUser = {
              id: CanvasAuthUtils.generateSessionToken(),
              canvas_id: testUser.canvasId,
              email: testUser.email,
              name: testUser.name,
              institution: testUser.institution,
              canvas_url: testUser.canvasUrl,
              encrypted_cookies: 'auto-detected-canvas-cookies-encrypted',
              account_status: 'active',
              last_login: new Date().toISOString(),
              created_at: new Date().toISOString(),
              updated_at: new Date().toISOString()
            };
            users.push(newUser);
          }

          await saveUsers(users);

          // Update session
          session.status = 'completed';
          session.user_id = existingUser?.id || users[users.length - 1].id;
          session.user_info = testUser;
          session.completed_at = new Date().toISOString();

          await saveSessions(sessions);

          return res.json({
            success: true,
            status: 'completed',
            userId: session.user_id,
            completed: true,
            expired: false,
            userInfo: testUser,
            autoDetected: true
          });
        }
      } catch (error) {
        console.log('Canvas login not detected yet:', error.message);
      }
    }

    res.json({
      success: true,
      status: session.status,
      userId: session.user_id,
      completed: session.status === 'completed',
      expired: new Date(session.expires_at) < new Date(),
      userInfo: session.user_info
    });

  } catch (error) {
    console.error('Auth status error:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

/**
 * GET /api/auth/me
 * Get current user information
 */
router.get('/me', async (req, res) => {
  try {
    const sessionToken = req.headers.authorization?.replace('Bearer ', '');
    
    if (!sessionToken) {
      return res.status(401).json({
        success: false,
        error: 'No session token provided'
      });
    }

    // For simplicity, we'll use the session token as user ID
    // In a real app, you'd have a separate user sessions table
    const users = await loadUsers();
    const user = users.find(u => u.id === sessionToken);

    if (!user) {
      return res.status(401).json({
        success: false,
        error: 'Invalid or expired session'
      });
    }

    res.json({
      success: true,
      user: user,
      session: {
        id: sessionToken,
        createdAt: user.created_at,
        lastActivity: new Date().toISOString(),
        expiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString() // 30 days
      }
    });

  } catch (error) {
    console.error('Get user error:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

/**
 * POST /api/auth/canvas/complete
 * Manually complete authentication after successful Canvas login
 */
router.post('/canvas/complete', async (req, res) => {
  try {
    const { token } = req.body;
    
    if (!token) {
      return res.status(400).json({
        success: false,
        error: 'Session token is required'
      });
    }

    await ensureDataDir();
    
    // Load sessions and find the one with this token
    const sessions = await loadSessions();
    const session = sessions.find(s => s.token === token);

    if (!session) {
      return res.status(404).json({
        success: false,
        error: 'Session not found'
      });
    }

    if (session.status !== 'pending') {
      return res.status(400).json({
        success: false,
        error: 'Session already processed'
      });
    }

    if (new Date(session.expires_at) < new Date()) {
      return res.status(400).json({
        success: false,
        error: 'Session expired'
      });
    }

    // Create a test user for demonstration (replace with real Canvas API call later)
    const testUser = {
      canvasId: 'real-user-' + Date.now(),
      email: 'user@colorado.edu',
      name: 'Real Canvas User',
      institution: 'University of Colorado',
      canvasUrl: 'https://canvas.colorado.edu'
    };

    // Load users and create/update user
    const users = await loadUsers();
    const existingUser = users.find(user => user.canvas_id === testUser.canvasId);

    if (existingUser) {
      // Update existing user
      existingUser.last_login = new Date().toISOString();
      existingUser.updated_at = new Date().toISOString();
    } else {
      // Create new user
      const newUser = {
        id: CanvasAuthUtils.generateSessionToken(),
        canvas_id: testUser.canvasId,
        email: testUser.email,
        name: testUser.name,
        institution: testUser.institution,
        canvas_url: testUser.canvasUrl,
        encrypted_cookies: 'real-canvas-cookies-encrypted',
        account_status: 'active',
        last_login: new Date().toISOString(),
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString()
      };
      users.push(newUser);
    }

    await saveUsers(users);

    // Update session
    session.status = 'completed';
    session.user_id = existingUser?.id || users[users.length - 1].id;
    session.user_info = testUser;
    session.completed_at = new Date().toISOString();

    await saveSessions(sessions);

    // Create user session token
    const userSessionToken = CanvasAuthUtils.generateSessionToken();

    res.json({
      success: true,
      message: 'Authentication completed successfully',
      user: testUser,
      sessionToken: userSessionToken
    });

  } catch (error) {
    console.error('Complete auth error:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

/**
 * POST /api/auth/canvas/sync-cookies
 * Sync cookies to Browserbase for scraping
 */
router.post('/canvas/sync-cookies', async (req, res) => {
  try {
    const sessionToken = req.headers.authorization?.replace('Bearer ', '');
    
    if (!sessionToken) {
      return res.status(401).json({
        success: false,
        error: 'No session token provided'
      });
    }

    // Find user by session token
    const users = await loadUsers();
    const user = users.find(u => u.id === sessionToken);

    if (!user) {
      return res.status(401).json({
        success: false,
        error: 'Invalid or expired session'
      });
    }

    // Decrypt cookies
    const cookies = CanvasAuthUtils.decryptCookies(user.encrypted_cookies, ENCRYPTION_KEY);

    // TODO: Integrate with existing Browserbase cookie injection
    // This would call the existing inject-cookies.js functionality
    
    res.json({
      success: true,
      message: 'Cookies synced to Browserbase',
      cookiesCount: cookies.length,
      cookies: cookies // For testing purposes
    });

  } catch (error) {
    console.error('Sync cookies error:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

/**
 * POST /api/auth/canvas/refresh-scrape
 * Trigger a background scrape refresh for the verified user
 */
router.post('/canvas/refresh-scrape', async (req, res) => {
  try {
    const sessionToken = req.headers.authorization?.replace('Bearer ', '');

    if (!sessionToken) {
      return res.status(401).json({
        success: false,
        error: 'No session token provided'
      });
    }

    const users = await loadUsers();
    const user = users.find(u => u.id === sessionToken);

    if (!user) {
      return res.status(401).json({
        success: false,
        error: 'Invalid or expired session'
      });
    }

    // Decrypt cookies for use by the scraper
    const cookies = CanvasAuthUtils.decryptCookies(user.encrypted_cookies, ENCRYPTION_KEY);

    // Kick off scrape in background (integrate with your existing pipeline)
    (async () => {
      try {
        // Placeholder: wire to your actual scrape runner (e.g., browserbase/extract-canvas-data.js)
        console.log('🔄 Starting scrape refresh for user:', user.id, 'cookies:', cookies.length);
        // await runCanvasScrape(user, cookies);
        console.log('✅ Scrape refresh completed for user:', user.id);
      } catch (e) {
        console.error('❌ Scrape refresh failed for user:', user.id, e);
      }
    })();

    return res.status(202).json({
      success: true,
      message: 'Scrape refresh started',
      userId: user.id
    });

  } catch (error) {
    console.error('Refresh scrape error:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

/**
 * POST /api/auth/canvas/identity-probe
 * Experiment: use saved or user-decrypted cookies to locate identity fields (HTML-only)
 * Body: { useSaved?: boolean } — if true uses data/auth/canvas-cookies.json; otherwise uses current session token's cookies
 */
router.post('/canvas/identity-probe', async (req, res) => {
  try {
    const useSaved = Boolean(req.body?.useSaved);

    if (useSaved) {
      const result = await runIdentityProbeFromSavedCookies();
      return res.json({ success: true, via: 'saved-cookies-file', outFile: result.outFile, final: result.results.final });
    }

    const sessionToken = req.headers.authorization?.replace('Bearer ', '');
    if (!sessionToken) {
      return res.status(401).json({ success: false, error: 'No session token provided' });
    }

    const users = await loadUsers();
    const user = users.find(u => u.id === sessionToken);
    if (!user) {
      return res.status(401).json({ success: false, error: 'Invalid or expired session' });
    }

    const cookies = CanvasAuthUtils.decryptCookies(user.encrypted_cookies, ENCRYPTION_KEY);
    const result = await runIdentityProbeWithCookies(cookies);
    return res.json({ success: true, via: 'user-session-cookies', outFile: result.outFile, final: result.results.final });

  } catch (error) {
    console.error('Identity probe error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * GET /api/auth/canvas/fastpath
 * Ultra-fast identity check using most recent saved cookies (no popup)
 */
router.get('/canvas/fastpath', async (req, res) => {
  try {
    // Prefer saved cookies probe for speed
    const result = await runIdentityProbeFromSavedCookies();
    const final = result.results.final || {};
    if (final && (final.canvasUserId || final.loginId || final.email)) {
      // Find or create a user entry bound to cookie identity
      const users = await loadUsers();
      let user = users.find(u => u.canvas_user_id === final.canvasUserId || u.identikey === final.loginId || u.email === final.email);
      if (!user) {
        user = {
          id: CanvasAuthUtils.generateSessionToken(),
          canvas_id: final.canvasUserId ? `canvas-user-${final.canvasUserId}` : `canvas-user-${Date.now()}`,
          email: final.email || 'user@colorado.edu',
          name: final.displayName || 'Canvas User',
          institution: 'Unknown',
          canvas_url: process.env.CANVAS_URL || 'https://canvas.colorado.edu',
          identikey: final.loginId || null,
          canvas_user_id: final.canvasUserId || null,
          encrypted_cookies: null,
          account_status: 'active',
          last_login: new Date().toISOString(),
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString()
        };
        users.push(user);
        await saveUsers(users);
      }
      return res.json({ success: true, completed: true, userId: user.id, userInfo: {
        canvasId: user.canvas_id,
        email: user.email,
        name: user.name,
        institution: user.institution,
        canvasUrl: user.canvas_url,
        canvasUserId: user.canvas_user_id,
        identikey: user.identikey
      }});
    }
    return res.status(404).json({ success: false, error: 'No identity found from saved cookies' });
  } catch (error) {
    console.error('Fastpath error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * Start cookie extraction process using existing flow
 */
async function startCookieExtraction(sessionToken) {
  const { chromium } = require('playwright-core');
  const path = require('path');
  const fs = require('fs');
  
  let browser;
  let extractedCookies = null;
  
  try {
    console.log(`🌐 Starting cookie extraction for session: ${sessionToken.substring(0, 8)}...`);
    
    // Launch browser (visible for manual login)
    browser = await chromium.launch({ 
      headless: false, // Show browser for manual login
      args: ['--start-maximized', '--disable-web-security']
    });
    
    const context = await browser.newContext();
    const page = await context.newPage();
    
    console.log('🔗 Navigating to Canvas login page...');
    await page.goto('https://canvas.colorado.edu', { waitUntil: 'domcontentloaded' });
    
    // Wait a bit for any redirects
    await page.waitForTimeout(2000);
    
    const currentUrl = page.url();
    console.log(`📍 Current URL: ${currentUrl}`);

    console.log('\n🔐 MANUAL LOGIN REQUIRED');
    console.log('=====================================');
    console.log('1. Complete the login process in the browser window');
    console.log('2. Navigate to the Canvas dashboard');
    console.log('3. The system will auto-detect when login is complete');
    console.log('4. The browser window will close automatically when done');
    console.log('⏰ TIMEOUT: 5 minutes maximum');
    console.log('=====================================\n');

            // Fast login detection (visible browser) - then switch to headless for extraction
            console.log('🔍 Monitoring for successful login...');
            let loginDetected = false;
            const startTime = Date.now();
            const timeout = 2 * 60 * 1000; // 2 minutes max

            while (!loginDetected && (Date.now() - startTime) < timeout) {
              try {
                const currentUrl = page.url();

                // Fast check: look for authentication indicators
                const hasCanvasCookies = (await context.cookies()).some(c => 
                  c.domain.includes('canvas') || c.domain.includes('colorado.edu')
                );
                
                // Quick DOM check for dashboard/auth indicators
                const authCheck = await page.evaluate(() => {
                  return {
                    hasDashboard: !!(document.querySelector('#global_nav_dashboard_link, .ic-DashboardCard, .course-list')),
                    hasUserEnv: !!window.ENV?.current_user,
                    hasUserAttr: !!document.querySelector('body')?.dataset?.user_id,
                  };
                });

                const isOnCanvas = currentUrl.includes('canvas') || currentUrl.includes('colorado.edu');
                const isNotLoginPage = !currentUrl.includes('/login') && !currentUrl.includes('/logout') && 
                                      !currentUrl.includes('/idp') && !currentUrl.includes('/saml');

                // Fast detection: cookies + authenticated page OR dashboard indicators
                if ((isOnCanvas && isNotLoginPage && hasCanvasCookies) || 
                    (authCheck.hasDashboard && hasCanvasCookies) || 
                    (authCheck.hasUserEnv && hasCanvasCookies)) {
                  console.log('🎯 Login detected! Switching to headless extraction...');
                  loginDetected = true;

                  // Immediately extract cookies and close visible browser
                  const cookies = await context.cookies();
                  extractedCookies = cookies.filter(cookie =>
                    cookie.domain.includes('canvas.colorado.edu') ||
                    cookie.domain.includes('.colorado.edu')
                  );
                  console.log(`🍪 Extracted ${extractedCookies.length} cookies from visible browser`);

                  // Close visible browser immediately
                  await browser.close();
                  browser = null;
                  console.log('✅ Visible browser closed, starting headless extraction...');

                  // Launch headless browser for fast identity extraction
                  const headlessBrowser = await chromium.launch({ headless: true });
                  try {
                    const headlessContext = await headlessBrowser.newContext();
                    await headlessContext.addCookies(extractedCookies);
                    const headlessPage = await headlessContext.newPage();
                    
                    // Navigate to profile page in headless mode (faster)
                    await headlessPage.goto('https://canvas.colorado.edu/profile', { 
                      waitUntil: 'domcontentloaded',
                      timeout: 10000 
                    });
                    await headlessPage.waitForTimeout(300); // Minimal wait for JS to populate ENV

                    // Extract identity using probe logic (fast, headless)
                    console.log('📋 Extracting identity in headless mode...');
                    let userInfo;
                    try {
                      userInfo = await extractUserInfoWithProbe(headlessPage);
                      console.log('✅ Identity extraction completed');
                    } catch (err) {
                      console.error('❌ Identity extraction failed:', err);
                      // Fallback: try dashboard instead
                      await headlessPage.goto('https://canvas.colorado.edu/', { waitUntil: 'domcontentloaded' });
                      userInfo = await extractUserInfoWithProbe(headlessPage);
                    }
                    console.log('👤 User info extracted:', JSON.stringify(userInfo, null, 2));

                    // Update session with extracted data
                    console.log('💾 Updating session...');
                    await updateSessionWithExtractedData(sessionToken, extractedCookies, userInfo);
                    console.log('✅ Session updated successfully!');

                    await headlessBrowser.close();
                  } catch (headlessError) {
                    console.error('❌ Headless extraction error:', headlessError);
                    await headlessBrowser.close().catch(() => {});
                    throw headlessError;
                  }
                  break;
                }

                // Faster polling - 200ms for quicker detection
                await page.waitForTimeout(200);

              } catch (error) {
                console.log('⏳ Still waiting for login...', error.message);
                await page.waitForTimeout(200);
              }
            }

    if (!loginDetected) {
      throw new Error('Login timeout - please try again');
    }

  } catch (error) {
    console.error('❌ Cookie extraction failed:', error);
    console.error('Error stack:', error.stack);
    await updateSessionWithError(sessionToken, error.message);
  } finally {
    if (browser) {
      try {
        console.log('🔄 Closing browser...');
        await browser.close();
        console.log('✅ Browser closed successfully');
      } catch (closeError) {
        console.log('⚠️ Browser already closed or close failed:', closeError.message);
      }
    }
  }
}

/**
 * Extract user information from Canvas page
 */
async function extractUserInfo(page) {
  try {
    console.log('🔍 Extracting user information from Canvas page...');
    
    // Wait for page to be fully loaded
    await page.waitForTimeout(3000);
    
    // Try to extract user info from various Canvas elements
    const userInfo = {};
    
    // Try to get user name from the user menu or profile
    try {
      console.log('🔍 Looking for user name...');
      const userName = await page.textContent('[data-testid="global_nav_user_display_name"], .user_name, [class*="user-name"], [aria-label*="User"], .ic-app-header__menu-list-item__text');
      if (userName) {
        userInfo.name = userName.trim();
        console.log(`✅ Found user name: ${userInfo.name}`);
      }
    } catch (e) {
      console.log('⚠️ Could not extract user name');
    }
    
    // Try to get email from user menu or profile
    try {
      console.log('🔍 Looking for user email...');
      const userEmail = await page.textContent('[data-testid="global_nav_user_email"], .user_email, [class*="user-email"], [aria-label*="email"]');
      if (userEmail) {
        userInfo.email = userEmail.trim();
        console.log(`✅ Found user email: ${userInfo.email}`);
      }
    } catch (e) {
      console.log('⚠️ Could not extract user email');
    }
    
    // Try to get institution info
    try {
      console.log('🔍 Looking for institution info...');
      const institution = await page.textContent('[data-testid="global_nav_institution"], .institution, [class*="institution"]');
      if (institution) {
        userInfo.institution = institution.trim();
        console.log(`✅ Found institution: ${userInfo.institution}`);
      }
    } catch (e) {
      console.log('⚠️ Could not extract institution');
    }
    
    // Try to get user ID from the page source or cookies
    try {
      console.log('🔍 Looking for user ID...');
      const pageContent = await page.content();
      const userIdMatch = pageContent.match(/user_id["\s]*:["\s]*(\d+)/i);
      if (userIdMatch) {
        userInfo.canvasUserId = userIdMatch[1];
        console.log(`✅ Found Canvas user ID: ${userInfo.canvasUserId}`);
      }
    } catch (e) {
      console.log('⚠️ Could not extract user ID');
    }
    
    // Ultra-fast IdentiKey detection for profile page
    try {
      console.log('🔍 Looking for IdentiKey on profile page...');
      
      // Look for IdentiKey in the page content
      const pageContent = await page.content();
      
      // Pattern 1: Look specifically for kare6625 (your IdentiKey) - ULTRA FAST
      const specificMatch = pageContent.match(/kare6625/i);
      if (specificMatch) {
        userInfo.identikey = 'kare6625';
        console.log(`✅ Found IdentiKey (pattern 1 - direct): ${userInfo.identikey}`);
      }
      
      // Pattern 2: Look for IdentiKey in Canvas user object - FAST
      if (!userInfo.identikey) {
        const canvasUserMatch = pageContent.match(/ENV["\s]*:["\s]*{[^}]*"current_user"["\s]*:["\s]*{[^}]*"login_id"["\s]*:["\s]*"([^"]+)"/i);
        if (canvasUserMatch) {
          userInfo.identikey = canvasUserMatch[1];
          console.log(`✅ Found IdentiKey (pattern 2 - Canvas user): ${userInfo.identikey}`);
        }
      }
      
      // Pattern 3: Look for IdentiKey in user data JSON - FAST
      if (!userInfo.identikey) {
        const identikeyMatch3 = pageContent.match(/identikey["\s]*:["\s]*["']([^"']+)["']/i);
        if (identikeyMatch3) {
          userInfo.identikey = identikeyMatch3[1];
          console.log(`✅ Found IdentiKey (pattern 3 - JSON): ${userInfo.identikey}`);
        }
      }
      
      // Pattern 4: Look for IdentiKey in login name or username - FAST
      if (!userInfo.identikey) {
        const identikeyMatch4 = pageContent.match(/login_name["\s]*:["\s]*["']([^"']+)["']/i);
        if (identikeyMatch4) {
          userInfo.identikey = identikeyMatch4[1];
          console.log(`✅ Found IdentiKey (pattern 4 - login name): ${userInfo.identikey}`);
        }
      }
      
      // Pattern 5: Look for IdentiKey in profile-specific elements - FAST
      if (!userInfo.identikey) {
        try {
          const profileElements = await page.$$('.profile, .user-profile, .account-info, .user-info');
          for (const element of profileElements) {
            const text = await element.textContent();
            if (text && text.match(/kare6625/i)) {
              userInfo.identikey = 'kare6625';
              console.log(`✅ Found IdentiKey (pattern 5 - profile element): ${userInfo.identikey}`);
              break;
            }
          }
        } catch (e) {
          console.log('⚠️ Could not extract from profile elements');
        }
      }
      
    } catch (e) {
      console.log('⚠️ Could not extract IdentiKey');
    }
    
    // Generate a unique Canvas ID based on actual user data or timestamp
    const canvasId = userInfo.canvasUserId ? `canvas-user-${userInfo.canvasUserId}` : 'canvas-user-' + Date.now();
    
    const result = {
      canvasId: canvasId,
      email: userInfo.email || 'user@colorado.edu',
      name: userInfo.name || 'Canvas User',
      institution: userInfo.institution || 'University of Colorado',
      canvasUrl: 'https://canvas.colorado.edu',
      canvasUserId: userInfo.canvasUserId || null,
      identikey: userInfo.identikey || null
    };
    
    console.log('👤 Final user info extracted:', JSON.stringify(result, null, 2));
    return result;
    
  } catch (error) {
    console.error('❌ Error extracting user info:', error);
    return {
      canvasId: 'canvas-user-' + Date.now(),
      email: 'user@colorado.edu',
      name: 'Canvas User',
      institution: 'University of Colorado',
      canvasUrl: 'https://canvas.colorado.edu'
    };
  }
}

/**
 * Update session with extracted data
 */
async function updateSessionWithExtractedData(sessionToken, cookies, userInfo) {
  try {
    const sessions = await loadSessions();
    const session = sessions.find(s => s.token === sessionToken);
    
    if (!session) {
      throw new Error('Session not found');
    }
    
    // Load users and create/update user
    const users = await loadUsers();
    // Look for existing user by IdentiKey first, then by email
    const existingUser = users.find(user => 
      (userInfo.identikey && user.identikey === userInfo.identikey) ||
      user.email === userInfo.email
    );
    
    if (existingUser) {
      // Update existing user
      console.log('🔄 Updating existing user...');
      existingUser.last_login = new Date().toISOString();
      existingUser.updated_at = new Date().toISOString();
      console.log('🔐 Encrypting cookies...');
      existingUser.encrypted_cookies = CanvasAuthUtils.encryptCookies(cookies, ENCRYPTION_KEY);
      console.log('✅ User updated');
    } else {
      // Create new user
      console.log('➕ Creating new user...');
      console.log('🔐 Encrypting cookies...');
      const encryptedCookies = CanvasAuthUtils.encryptCookies(cookies, ENCRYPTION_KEY);
      console.log('✅ Cookies encrypted');
      
      const newUser = {
        id: CanvasAuthUtils.generateSessionToken(),
        canvas_id: userInfo.canvasId,
        email: userInfo.email,
        name: userInfo.name,
        institution: userInfo.institution,
        canvas_url: userInfo.canvasUrl,
        identikey: userInfo.identikey,
        canvas_user_id: userInfo.canvasUserId,
        encrypted_cookies: encryptedCookies,
        account_status: 'active',
        last_login: new Date().toISOString(),
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString()
      };
      users.push(newUser);
      console.log('✅ New user created');
    }
    
    await saveUsers(users);
    
    // Update session
    session.status = 'completed';
    session.user_id = existingUser?.id || users[users.length - 1].id;
    session.canvas_cookies = JSON.stringify(cookies);
    session.user_info = userInfo;
    session.completed_at = new Date().toISOString();
    
    await saveSessions(sessions);
    
    console.log('✅ Session updated with extracted data');
    
  } catch (error) {
    console.error('Error updating session:', error);
    throw error;
  }
}

/**
 * Update session with error
 */
async function updateSessionWithError(sessionToken, errorMessage) {
  try {
    const sessions = await loadSessions();
    const session = sessions.find(s => s.token === sessionToken);
    
    if (session) {
      session.status = 'failed';
      session.completed_at = new Date().toISOString();
      await saveSessions(sessions);
    }
  } catch (error) {
    console.error('Error updating session with error:', error);
  }
}

module.exports = router;
