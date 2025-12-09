const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const dotenv = require('dotenv');
const { chromium } = require('playwright-core');
const { getBrowserlessConfig } = require('./config');
const storage = require('./supabase-storage');

// Simple WebSocket connectivity test
async function testWebSocketConnectivity(url, timeoutMs = 5000) {
  return new Promise((resolve) => {
    try {
      // Try to use ws package if available
      let WebSocket;
      try {
        WebSocket = require('ws');
      } catch {
        // ws not installed, skip test
        resolve({ success: null, error: 'ws package not installed, skipping test' });
        return;
      }
      
      const ws = new WebSocket(url, { handshakeTimeout: timeoutMs });
      const timer = setTimeout(() => {
        ws.terminate();
        resolve({ success: false, error: 'Timeout' });
      }, timeoutMs);
      
      ws.on('open', () => {
        clearTimeout(timer);
        ws.close();
        resolve({ success: true });
      });
      
      ws.on('error', (err) => {
        clearTimeout(timer);
        resolve({ success: false, error: err.message });
      });
    } catch (err) {
      resolve({ success: false, error: err.message });
    }
  });
}

// Ensure env is loaded when run from repo root or backend
dotenv.config({ path: path.resolve(__dirname, '..', '..', '..', '.env') }); // repo root
dotenv.config({ path: path.resolve(__dirname, '..', '..', '.env') });       // backend/.env
dotenv.config({ path: path.resolve(process.cwd(), '.env') });               // current cwd

const DATA_DIR = path.join(__dirname, '..', '..', 'data', 'auth');
const SESSIONS_FILE = path.join(DATA_DIR, 'canvas-auth-sessions.json');
// Use CANVAS_URL (not CANVAS_LOGIN_URL) to avoid /login suffix issues
const DEFAULT_CANVAS_URL = (process.env.CANVAS_URL || process.env.CANVAS_LOGIN_URL || 'https://canvas.colorado.edu').replace(/\/login.*$/i, '');

function ensureDataDir() {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
  if (!fs.existsSync(SESSIONS_FILE)) fs.writeFileSync(SESSIONS_FILE, '[]', 'utf8');
}

function loadSessions() {
  ensureDataDir();
  try {
    const raw = fs.readFileSync(SESSIONS_FILE, 'utf8');
    return JSON.parse(raw);
  } catch {
    return [];
  }
}

function saveSessions(sessions) {
  ensureDataDir();
  fs.writeFileSync(SESSIONS_FILE, JSON.stringify(sessions, null, 2));
}

function generateToken() {
  return crypto.randomBytes(16).toString('hex');
}

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
    await page.waitForTimeout(500);

    const envData = await grabWindowEnv(page);
    const domData = await parseIdentityFromDOM(page);
    const pick = (...vals) => vals.find((v) => v && String(v).trim().length);

    const canvasUserId = pick(envData?.currentUser?.id, domData.canvasUserId);
    const displayName = pick(envData?.currentUser?.display_name, domData.displayName);
    const email = pick(envData?.currentUser?.email, domData.email);
    const loginId = pick(envData?.currentUser?.login_id, domData.loginId);

    return {
      canvasId: canvasUserId ? `canvas-user-${canvasUserId}` : `canvas-user-${Date.now()}`,
      email: email || 'user@colorado.edu',
      name: displayName || 'Canvas User',
      institution: 'University of Colorado',
      canvasUrl: process.env.CANVAS_URL || DEFAULT_CANVAS_URL,
      canvasUserId: canvasUserId || null,
      identikey: loginId || null,
    };
  } catch (error) {
    console.error('Error extracting user info with probe:', error);
    return {
      canvasId: 'canvas-user-' + Date.now(),
      email: 'user@colorado.edu',
      name: 'Canvas User',
      institution: 'University of Colorado',
      canvasUrl: DEFAULT_CANVAS_URL,
    };
  }
}

function filterCanvasCookies(cookies) {
  return (cookies || []).filter((cookie) =>
    (cookie.domain || '').includes('canvas') ||
    (cookie.domain || '').includes('colorado.edu') ||
    (cookie.name || '').includes('canvas') ||
    (cookie.name || '').includes('session') ||
    (cookie.name || '').includes('csrf')
  );
}

async function monitorSession(sessionToken) {
  const sessions = loadSessions();
  const session = sessions.find((s) => s.token === sessionToken);
  if (!session) throw new Error('Session not found');
  
  // Skip if already completed or failed
  if (session.status === 'completed' || session.status === 'failed') {
    console.log(`ℹ️ Session ${sessionToken.substring(0, 8)} already ${session.status}, skipping monitor`);
    return session;
  }

  const { connectUrl } = session.browserlessSession || {};
  if (!connectUrl) throw new Error('Missing browserless connectUrl');

  // Try to reuse existing browser connection from createAuthSession
  let browser, page, context;
  
  if (global._browserlessConnection) {
    // Check if the connection is still valid
    try {
      const testPages = global._browserlessConnection.browser.contexts();
      console.log('🔄 Reusing existing browserless connection...');
      browser = global._browserlessConnection.browser;
      page = global._browserlessConnection.page;
      context = global._browserlessConnection.context;
    } catch (e) {
      console.log('⚠️ Existing connection is stale, reconnecting...');
      global._browserlessConnection = null;
    }
  }
  
  if (!browser) {
    // Fallback: create new connection
    console.log('🔌 Reconnecting to Browserless session...');
    try {
      browser = await chromium.connect(connectUrl, { timeout: 60000 });
      const contexts = browser.contexts();
      context = contexts.length > 0 ? contexts[0] : await browser.newContext();
      const pages = context.pages();
      page = pages.length > 0 ? pages[0] : await context.newPage();
      
      // Save connection for future use
      global._browserlessConnection = { browser, page, context };
      
      // Navigate to Canvas if not already there
      const currentUrl = page.url();
      if (!currentUrl.includes('canvas') && !currentUrl.includes('fedauth')) {
        await page.goto(DEFAULT_CANVAS_URL, { waitUntil: 'domcontentloaded', timeout: 60000 });
      }
    } catch (connErr) {
      console.error('❌ Failed to reconnect:', connErr.message);
      // Mark session as failed if we can't connect
      const allSessions = loadSessions();
      const sess = allSessions.find((s) => s.token === sessionToken);
      if (sess) {
        sess.status = 'failed';
        sess.error = 'Lost connection to browser session. Please try again.';
        saveSessions(allSessions);
      }
      throw connErr;
    }
  }
  
  try {
    const currentUrl = page.url();
    console.log(`📍 Current URL: ${currentUrl}`);

    const start = Date.now();
    const timeoutMs = 5 * 60 * 1000;
    let loginDetected = false;

    console.log('🔍 Monitoring for successful login...');
    while (!loginDetected && Date.now() - start < timeoutMs) {
      await page.waitForTimeout(2000);

      try {
        const currentUrl = page.url();
        
        // Check for stale request and recover
        const pageContent = await page.content().catch(() => '');
        if (pageContent.includes('Stale Request') || currentUrl.includes('Stale')) {
          console.log('⚠️ Stale request detected, refreshing login flow...');
          await context.clearCookies();
          await page.goto(DEFAULT_CANVAS_URL, { 
            waitUntil: 'domcontentloaded', 
            timeout: 30000 
          });
          continue; // restart monitoring loop
        }
        
        const cookies = await context.cookies();
        
        // Check for canvas_session cookie specifically (main auth indicator)
        const hasCanvasSessionCookie = cookies.some((c) => 
          c.name === 'canvas_session' || c.name === '_legacy_normandy_session'
        );
        
        const hasCanvasCookie = cookies.some((c) => 
          ((c.domain || '').includes('canvas') || (c.domain || '').includes('colorado.edu')) && 
          ((c.name || '').includes('session') || (c.name || '').includes('canvas'))
        );
        
        const isOnCanvas = currentUrl.includes('canvas.colorado.edu');
        const isOnSSO = currentUrl.includes('fedauth') || currentUrl.includes('idp') || currentUrl.includes('sso');
        const isOnLogin = currentUrl.includes('/login');
        const isOnDashboard = currentUrl.includes('/dashboard') || (isOnCanvas && currentUrl.endsWith('.edu') || currentUrl.endsWith('.edu/'));
        
        let envData = null;
        let hasDashboardIndicator = false;
        
        // Only check for dashboard indicators if we're on Canvas (not SSO)
        if (isOnCanvas && !isOnLogin && !isOnSSO) {
          envData = await grabWindowEnv(page).catch(() => null);
          hasDashboardIndicator = await page.evaluate(() => {
            const dashboardIndicators = [
              '#global_nav_dashboard_link',
              '.ic-DashboardCard',
              '#DashboardCard_Container',
              '[data-testid="dashboard"]',
              '#global_nav_profile_link',
              '.dashboard-header',
              '.course-list',
              '#application', // Canvas main app container
              '.ic-app-header', // Canvas header
              '.ic-Layout-contentMain', // Canvas main content area
              '#wrapper', // Canvas wrapper
            ];
            return dashboardIndicators.some((selector) => document.querySelector(selector) !== null);
          }).catch(() => false);
        }

        const elapsed = Math.round((Date.now() - start) / 1000);
        
        // Check for successful login - multiple indicators
        const hasUser = envData?.currentUser;
        const isLoggedIn = isOnCanvas && !isOnLogin && !isOnSSO && (hasCanvasSessionCookie || hasDashboardIndicator);
        
        if (hasUser || isLoggedIn) {
          loginDetected = true;
          console.log(`✅ Login detected after ${elapsed}s! [user: ${!!hasUser}, sessionCookie: ${hasCanvasSessionCookie}, dashboard: ${hasDashboardIndicator}]`);
          break;
        }
        
        // Show status
        if (isOnSSO) {
          console.log(`⏳ SSO login in progress... (${elapsed}s)`);
        } else if (isOnLogin) {
          console.log(`⏳ On login page... (${elapsed}s)`);
        } else if (isOnCanvas) {
          console.log(`⏳ On Canvas, checking auth... (${elapsed}s) [cookies: ${hasCanvasCookie}, dashboard: ${hasDashboardIndicator}]`);
        } else {
          console.log(`⏳ Waiting... URL: ${currentUrl.substring(0, 50)}... (${elapsed}s)`);
        }
      } catch (evalError) {
        const elapsed = Math.round((Date.now() - start) / 1000);
        console.log(`⏳ Page loading... (${elapsed}s)`);
      }
    }

    if (!loginDetected) throw new Error('Login timeout - please try again');

    await page.waitForTimeout(1000);
    const cookies = await context.cookies();
    const filteredCookies = filterCanvasCookies(cookies);
    const userAgent = await page.evaluate(() => navigator.userAgent);
    const userInfo = await extractUserInfoWithProbe(page);
    const identikey = userInfo.identikey || (userInfo.email ? userInfo.email.split('@')[0] : null) || 'unknown-user';

    console.log(`👤 Extracted identikey: ${identikey}`);
    console.log(`🍪 Extracted ${filteredCookies.length} cookies`);

    const cookieData = {
      version: '1.0',
      cookies: filteredCookies,
      metadata: {
        extractedAt: new Date().toISOString(),
        source: 'browserless-extraction',
        userAgent,
        finalUrl: page.url(),
        browserbaseSessionId,
        liveViewUrl,
      },
    };

    // Save cookies locally (data/auth/canvas-cookies.json)
    const localCookieFile = path.join(DATA_DIR, 'canvas-cookies.json');
    fs.writeFileSync(localCookieFile, JSON.stringify(cookieData, null, 2));
    console.log(`💾 Saved cookies locally: ${localCookieFile}`);
    
    // Also upload to Supabase Storage if configured
    try {
      await storage.uploadCookies(identikey, cookieData);
      await storage.uploadUserMetadata(identikey, userInfo);
      console.log('✅ Uploaded to Supabase Storage');
    } catch (err) {
      console.warn('Supabase upload skipped:', err.message);
    }

    session.status = 'completed';
    session.identikey = identikey;
    session.cookies = cookieData;
    session.userInfo = userInfo;
    session.completedAt = new Date().toISOString();
    saveSessions(sessions);

    // Clear global connection reference
    global._browserlessConnection = null;
    
    // Close browser after successful extraction
    try {
      await browser.close();
      console.log('🔒 Browser connection closed');
    } catch (_) {}
    
    return { cookieData, userInfo };
  } catch (error) {
    session.status = 'failed';
    session.error = error.message || 'Unknown error';
    session.completedAt = new Date().toISOString();
    saveSessions(sessions);
    
    // Clear global connection reference
    global._browserlessConnection = null;
    
    // Close browser on error
    try {
      await browser.close();
    } catch (_) {}
    
    throw error;
  }
}

function persistSession(base) {
  const sessions = loadSessions();
  sessions.push(base);
  saveSessions(sessions);
}

function updateSessionStatus(token, updater) {
  const sessions = loadSessions();
  const session = sessions.find((s) => s.token === token);
  if (!session) return null;
  updater(session);
  saveSessions(sessions);
  return session;
}

async function cleanupExistingSessions() {
  // For browserless, there is no remote session list; just ensure local browser is closed.
  if (global._browserlessConnection) {
    try {
      await global._browserlessConnection.browser.close();
    } catch (_) {}
    global._browserlessConnection = null;
  }
}

async function createAuthSession({ email = null } = {}) {
  const sessionToken = generateToken();
  const { wsUrl, httpUrl, token: blToken, useCloud } = getBrowserlessConfig();
  await cleanupExistingSessions();

  const connectUrl = blToken ? `${wsUrl}?token=${blToken}` : wsUrl;
  const viewerBase = httpUrl.replace(/\/$/, '');
  
  // Fallback URL for self-hosted Browserless
  const fallbackViewUrl = blToken
    ? `${viewerBase}?token=${blToken}#/sessions`
    : `${viewerBase}#/sessions`;

  console.log(`🔌 Connecting to Browserless ${useCloud ? 'Cloud' : 'self-hosted'}...`);
  let browser;
  let retries = 0;
  const maxRetries = 3;
  
  while (retries <= maxRetries) {
    try {
      browser = await chromium.connect(connectUrl, { timeout: 60000 });
      break; // Success, exit retry loop
    } catch (error) {
      const isRateLimit = error.message.includes('429') || error.message.includes('Too Many Requests');
      const isTimeout = error.message.includes('Timeout') || error.message.includes('timeout');
      
      if (isRateLimit && retries < maxRetries) {
        const waitTime = Math.pow(2, retries) * 2000; // Exponential backoff: 2s, 4s, 8s
        console.log(`⚠️  Rate limited (429). Waiting ${waitTime/1000}s before retry ${retries + 1}/${maxRetries}...`);
        await new Promise(resolve => setTimeout(resolve, waitTime));
        retries++;
        continue;
      }
      
      if (isTimeout && retries < maxRetries) {
        const waitTime = 3000;
        console.log(`⚠️  Connection timeout. Retrying in ${waitTime/1000}s... (${retries + 1}/${maxRetries})`);
        await new Promise(resolve => setTimeout(resolve, waitTime));
        retries++;
        continue;
      }
      
      // Final failure or non-retryable error
      console.error(`❌ Failed to connect to browserless: ${error.message}`);
      console.error(`   URL: ${connectUrl}`);
      if (isRateLimit) {
        console.error(`   ⚠️  Rate limit exceeded. Free tier has strict limits.`);
        console.error(`   Consider: 1) Wait a few minutes, 2) Use self-hosted, or 3) Upgrade to paid plan`);
      }
      throw error;
    }
  }

  // Get the default page
  const contexts = browser.contexts();
  const defaultContext = contexts.length > 0 ? contexts[0] : await browser.newContext();
  const pages = defaultContext.pages();
  const page = pages.length > 0 ? pages[0] : await defaultContext.newPage();

  // Clear all cookies to ensure fresh SSO state (prevents "Stale Request" errors)
  console.log('🧹 Clearing cookies for fresh SSO state...');
  try {
    await defaultContext.clearCookies();
  } catch (e) {
    console.log('   ⚠️ Could not clear cookies:', e.message);
  }

  // Navigate to Canvas root (will redirect to SSO if not logged in)
  console.log(`🔗 Navigating to ${DEFAULT_CANVAS_URL}...`);
  await page.goto(DEFAULT_CANVAS_URL, {
    waitUntil: 'domcontentloaded',
    timeout: 30000,
  });

  // Check if we landed on a stale request page and handle it
  const currentUrl = page.url();
  const pageContent = await page.content().catch(() => '');
  if (currentUrl.includes('Stale') || pageContent.includes('Stale Request')) {
    console.log('⚠️ Detected stale request, clearing cookies and retrying...');
    await defaultContext.clearCookies();
    await page.waitForTimeout(1000);
    await page.goto(DEFAULT_CANVAS_URL, { waitUntil: 'domcontentloaded', timeout: 30000 });
  }

  console.log('✅ Navigated to Canvas');

  // Wait a moment for page to be registered
  await new Promise(resolve => setTimeout(resolve, 1000));

  // Generate LiveURL for Browserless Cloud, or use fallback for self-hosted
  let actualLiveViewUrl = fallbackViewUrl;
  let cdpSession = null;
  
  if (useCloud) {
    try {
      console.log('🔗 Generating LiveURL for direct browser view...');
      cdpSession = await defaultContext.newCDPSession(page);
      const { liveURL } = await cdpSession.send('Browserless.liveURL', {
        timeout: 60000, // 60 seconds (free tier limit)
      });
      if (liveURL) {
        actualLiveViewUrl = liveURL;
        console.log('✅ LiveURL ready - browser view will open directly!');
      }
    } catch (liveUrlError) {
      console.log('⚠️ Could not generate LiveURL:', liveUrlError.message);
      console.log('   Using fallback viewer');
    }
  } else {
    console.log('✅ Session ready - opening Browserless viewer');
  }
  
  // Store references for monitoring
  global._browserlessConnection = { browser, page, context: defaultContext, cdpSession, useCloud };

  // Store browser reference for monitoring to reuse
  global._browserlessConnection = { browser, page, context: defaultContext };

  const browserlessSession = {
    connectUrl,
    liveViewUrl: actualLiveViewUrl,
  };

  const session = {
    token: sessionToken,
    status: 'pending',
    email,
    createdAt: new Date().toISOString(),
    expiresAt: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
    identikey: null,
    cookies: null,
    userInfo: null,
    error: null,
    browserlessSession,
  };

  persistSession(session);

  // Kick off monitoring in background (reuses the same browser connection)
  setImmediate(() => {
    monitorSession(sessionToken).catch((err) => {
      console.error('Monitor session error:', err.message);
    });
  });

  return {
    sessionToken,
    liveViewUrl: actualLiveViewUrl,
    statusUrl: `/api/auth/canvas/status/${sessionToken}`,
    manualMode: false, // Browserless always provides direct connection
  };
}

async function getStatus(sessionToken) {
  const sessions = loadSessions();
  const session = sessions.find((s) => s.token === sessionToken);
  if (!session) return null;
  
  // If session is still pending, try to actively check/monitor
  if (session.status === 'pending' && session.browserlessSession?.connectUrl) {
    // If no active monitoring, restart it
    if (!global._activeMonitors) global._activeMonitors = new Set();
    
    if (!global._activeMonitors.has(sessionToken)) {
      global._activeMonitors.add(sessionToken);
      console.log(`📡 Restarting monitor for session ${sessionToken.substring(0, 8)}...`);
      
      // Restart monitoring in background
      setImmediate(() => {
        monitorSession(sessionToken)
          .catch((err) => console.error('Monitor error:', err.message))
          .finally(() => global._activeMonitors?.delete(sessionToken));
      });
    }
  }
  
  // Return fresh status from file (might have been updated by monitor)
  const freshSessions = loadSessions();
  const freshSession = freshSessions.find((s) => s.token === sessionToken);
  return freshSession || session;
}

async function loginWithCanvas(email) {
  return createAuthSession({ email });
}

async function releaseSession(sessionToken) {
  const sessions = loadSessions();
  const session = sessions.find((s) => s.token === sessionToken);
  if (!session) return false;

  // Close any active browser connection
  if (global._browserlessConnection) {
    try {
      await global._browserlessConnection.browser.close();
    } catch (_) {}
    global._browserlessConnection = null;
  }

  // Mark session as released/closed
  session.status = session.status === 'completed' ? 'completed' : 'failed';
  session.completedAt = new Date().toISOString();
  saveSessions(sessions);
  console.log(`✅ Session ${sessionToken.substring(0, 8)} closed`);
  return true;
}

module.exports = {
  createAuthSession,
  getStatus,
  loginWithCanvas,
  monitorSession,
  extractUserInfoWithProbe,
  releaseSession,
};

