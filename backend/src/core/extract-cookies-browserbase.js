'use strict';

// Browserbase-backed cookie extractor with live view.
// Flow:
// 1) Create a Browserbase session with live view enabled.
// 2) Connect via Playwright over CDP.
// 3) Let the user log in through the live view.
// 4) Save Canvas cookies locally and immediately terminate the session.

const fs = require('fs');
const path = require('path');
const https = require('https');
const dotenv = require('dotenv');
const { chromium } = require('playwright-core');
const { Browserbase } = require('@browserbasehq/sdk');

// Use node-fetch (CJS import shim) so we can set an HTTPS agent.
const fetch = (...args) => import('node-fetch').then(({ default: fetchFn }) => fetchFn(...args));

// Load env from repo root first, then backend/.env (so root wins)
const rootEnvPath = path.join(__dirname, '..', '..', '..', '.env');
const backendEnvPath = path.join(__dirname, '..', '..', '.env');

if (fs.existsSync(rootEnvPath)) {
  dotenv.config({ path: rootEnvPath, override: true });
}
if (fs.existsSync(backendEnvPath)) {
  dotenv.config({ path: backendEnvPath, override: false }); // allow root to win
}
// Final fallback to default locations
dotenv.config();

const BROWSERBASE_API_KEY = process.env.BROWSERBASE_API_KEY;
const BROWSERBASE_PROJECT_ID = process.env.BROWSERBASE_PROJECT_ID;
const BROWSERBASE_API_HOST = process.env.BROWSERBASE_API_HOST || 'https://api.browserbase.com';
const CANVAS_URL =
  (process.env.CANVAS_URL || process.env.CANVAS_LOGIN_URL || 'https://canvas.colorado.edu').replace(
    /\/login.*$/i,
    ''
  );

const OUTPUT_DIR = path.join(__dirname, '..', '..', 'data', 'auth');
const OUTPUT_FILE = path.join(OUTPUT_DIR, 'canvas-cookies.json');

function assertEnv() {
  if (!BROWSERBASE_API_KEY) throw new Error('Missing BROWSERBASE_API_KEY in environment (check root .env)');
  if (!BROWSERBASE_PROJECT_ID) throw new Error('Missing BROWSERBASE_PROJECT_ID in environment (check root .env)');
}

function ensureOutputDir() {
  if (!fs.existsSync(OUTPUT_DIR)) {
    fs.mkdirSync(OUTPUT_DIR, { recursive: true });
  }
}

function filterCanvasCookies(cookies) {
  return (cookies || []).filter(
    (cookie) =>
      (cookie.domain || '').includes('canvas') ||
      (cookie.domain || '').includes('colorado.edu') ||
      (cookie.name || '').toLowerCase().includes('canvas') ||
      (cookie.name || '').toLowerCase().includes('session') ||
      (cookie.name || '').toLowerCase().includes('csrf')
  );
}

function openInDefaultBrowser(url) {
  if (!url) return;
  const { spawn } = require('child_process');
  const platform = process.platform;
  const cmd =
    platform === 'darwin'
      ? 'open'
      : platform === 'win32'
        ? 'cmd'
        : 'xdg-open';
  const args = platform === 'win32' ? ['/c', 'start', '', url] : [url];
  try {
    spawn(cmd, args, { detached: true, stdio: 'ignore' }).unref();
    console.log(`🌐 Opened live view: ${url}`);
  } catch (err) {
    console.log(`⚠️  Could not auto-open live view: ${err.message}`);
    console.log(`👉 Open manually: ${url}`);
  }
}

async function getSessionDebugInfo(sessionId, client) {
  console.log(`🔍 Fetching debug info for session ${sessionId}...`);
  
  // Try SDK first
  if (client && typeof client.sessions?.getDebugInfo === 'function') {
    try {
      const debugInfo = await client.sessions.getDebugInfo(sessionId);
      return debugInfo;
    } catch (sdkErr) {
      console.warn(`⚠️ SDK getDebugInfo failed: ${sdkErr.message}, trying retrieve method...`);
      // Try retrieve method as fallback
      try {
        const sessionDetails = await client.sessions.retrieve(sessionId);
        if (sessionDetails.debuggerFullscreenUrl || sessionDetails.wsUrl) {
          return sessionDetails;
        }
      } catch (retrieveErr) {
        console.warn(`⚠️ SDK retrieve also failed: ${retrieveErr.message}`);
      }
    }
  }
  
  // Fallback: direct API call with proper auth
  const url = `${BROWSERBASE_API_HOST.replace(/\/$/, '')}/v1/sessions/${sessionId}/debug`;
  const agent = new https.Agent({ keepAlive: true, rejectUnauthorized: true });
  
  const res = await fetch(url, {
    method: 'GET',
    headers: {
      'X-BB-API-Key': BROWSERBASE_API_KEY,
      Authorization: `Bearer ${BROWSERBASE_API_KEY}`,
      'Content-Type': 'application/json',
    },
    agent,
  });

  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`Failed to get debug info: ${res.status} ${text}`);
  }

  return await res.json();
}

async function createBrowserbaseSession() {
  console.log('🟦 Creating Browserbase session with live view...');
  const agent = new https.Agent({ keepAlive: true, rejectUnauthorized: true });

  const payload = {
    projectId: BROWSERBASE_PROJECT_ID,
    browserSettings: {
      headless: false,
      enableLiveView: true,
      viewport: { width: 1280, height: 720 },
    },
  };

  const keyMask = `${BROWSERBASE_API_KEY.slice(0, 6)}…${BROWSERBASE_API_KEY.slice(-4)}`;

  // Try via official SDK (preferred)
  try {
    const client = new Browserbase({
      apiKey: BROWSERBASE_API_KEY,
      baseUrl: BROWSERBASE_API_HOST.replace(/\/$/, ''),
      httpAgent: agent,
    });
    const session = await client.sessions.create(payload);
    console.log(`✅ Session created via SDK: ${session.id}`);
    
    // Fetch debug info to get live view URLs and wsUrl
    const debugInfo = await getSessionDebugInfo(session.id, client);
    
    const liveViewUrl = debugInfo.debuggerFullscreenUrl || 
      debugInfo.debuggerUrl ||
      (debugInfo.pages && debugInfo.pages[0]?.debuggerFullscreenUrl) ||
      (debugInfo.pages && debugInfo.pages[0]?.debuggerUrl) ||
      null;
    
    const wsUrl = debugInfo.wsUrl || null;
    
    if (!liveViewUrl) {
      throw new Error('No live view URL found in debug info');
    }
    
    if (!wsUrl) {
      throw new Error('No wsUrl found in debug info');
    }
    
    console.log('👉 Opening Browserbase live view for login...');
    console.log(`🔗 Live view URL: ${liveViewUrl}`);
    openInDefaultBrowser(liveViewUrl);
    console.log('💡 If it did not open, visit:', liveViewUrl);
    return { ...session, liveViewUrl, wsUrl };
  } catch (err) {
    const status = err?.response?.status || err?.status || err?.statusCode;
    const data = err?.response?.data || err?.data || err?.message;
    const errorMsg = typeof data === 'object' ? JSON.stringify(data) : String(data);
    
    // Don't fall back for clear quota/limit errors
    if (status === 402 || status === 403 || errorMsg.includes('limit') || errorMsg.includes('quota') || errorMsg.includes('upgrade')) {
      throw new Error(`Browserbase ${status} error: ${errorMsg}`);
    }
    
    console.error(
      `⚠️ SDK create failed (status ${status ?? 'n/a'}):`,
      errorMsg
    );
    // Only fall back for network/unknown errors, not auth/quota errors
    if (status && (status === 401 || status === 402 || status === 403)) {
      throw new Error(`Browserbase authentication/quota error (${status}): ${errorMsg}`);
    }
  }

  // Fallback: direct HTTP call (same payload structure)
  let res;
  try {
    const url = `${BROWSERBASE_API_HOST.replace(/\/$/, '')}/v1/sessions`;
    res = await fetch(url, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${BROWSERBASE_API_KEY}`,
        'x-api-key': BROWSERBASE_API_KEY,
        'Content-Type': 'application/json',
        'User-Agent': 'canvas-wrapper/1.0 cookie-extractor',
      },
      body: JSON.stringify(payload),
      agent,
    });
  } catch (err) {
    const hint = err?.cause?.code ? ` (${err.cause.code})` : '';
    throw new Error(`Failed to reach Browserbase API${hint}: ${err.message}`);
  }

  if (!res.ok) {
    const text = await res.text().catch(() => '');
    const www = res.headers?.get ? res.headers.get('www-authenticate') : null;
    const msg = `Failed to create Browserbase session: ${res.status} ${text || res.statusText} (host ${BROWSERBASE_API_HOST}, project ${BROWSERBASE_PROJECT_ID}, key ${keyMask}${www ? `, www-authenticate: ${www}` : ''})`;
    throw new Error(msg);
  }

  const data = await res.json();
  console.log(`✅ Session created: ${data.id}`);
  
  // Fetch debug info to get live view URLs and wsUrl
  const debugInfo = await getSessionDebugInfo(data.id);
  
  const liveViewUrl = debugInfo.debuggerFullscreenUrl || 
    debugInfo.debuggerUrl ||
    (debugInfo.pages && debugInfo.pages[0]?.debuggerFullscreenUrl) ||
    (debugInfo.pages && debugInfo.pages[0]?.debuggerUrl) ||
    null;
  
  const wsUrl = debugInfo.wsUrl || null;
  
  if (!liveViewUrl) {
    throw new Error('No live view URL found in debug info');
  }
  
  if (!wsUrl) {
    throw new Error('No wsUrl found in debug info');
  }
  
  console.log('👉 Opening Browserbase live view for login...');
  console.log(`🔗 Live view URL: ${liveViewUrl}`);
  openInDefaultBrowser(liveViewUrl);
  console.log('💡 If it did not open, visit:', liveViewUrl);
  return { ...data, liveViewUrl, wsUrl };
}

async function terminateSession(sessionId) {
  if (!sessionId) return;
  try {
    await fetch(`https://api.browserbase.com/v1/sessions/${sessionId}/terminate`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${BROWSERBASE_API_KEY}`,
      },
    });
    console.log(`🛑 Session ${sessionId} terminated.`);
  } catch (err) {
    console.log(`⚠️  Failed to terminate session ${sessionId}: ${err.message}`);
  }
}

async function waitForLogin(page, timeoutMs = 5 * 60 * 1000) {
  console.log('🔍 Waiting for Canvas dashboard (up to 5 minutes)...');
  const start = Date.now();
  const selectors = [
    '#global_nav_dashboard_link',
    '.ic-DashboardCard',
    '#DashboardCard_Container',
    '[data-testid="dashboard"]',
    '#global_nav_profile_link',
    '.dashboard-header',
    '.course-list',
  ];

  while (Date.now() - start < timeoutMs) {
    await page.waitForTimeout(1000);
    try {
      const isOnDashboard = await page.evaluate((sels) => {
        return sels.some((selector) => document.querySelector(selector));
      }, selectors);
      const currentUrl = page.url();
      if (isOnDashboard && currentUrl.includes('canvas')) {
        console.log('✅ Canvas dashboard detected, login complete.');
        return true;
      }
      const elapsed = Math.round((Date.now() - start) / 1000);
      console.log(`⏳ Waiting... (${elapsed}s) Current URL: ${currentUrl}`);
    } catch {
      // Ignore transient errors and keep waiting
    }
  }
  throw new Error('Login timeout: dashboard not detected within 5 minutes');
}

async function main() {
  assertEnv();
  ensureOutputDir();
  console.log(`🔑 Using Browserbase project ${BROWSERBASE_PROJECT_ID} with key ${BROWSERBASE_API_KEY.slice(0, 6)}…${BROWSERBASE_API_KEY.slice(-4)}`);

  let session = null;
  let browser = null;

  try {
    session = await createBrowserbaseSession();
    const { wsUrl, id } = session;

    if (!wsUrl) {
      throw new Error('Browserbase session did not return wsUrl. Check API credentials/plan.');
    }

    console.log('🔌 Connecting to Browserbase via CDP...');
    browser = await chromium.connectOverCDP(wsUrl, { timeout: 60000 });
    const context = browser.contexts()[0] || (await browser.newContext());
    let page = context.pages()[0];
    
    // If no page exists, create one
    if (!page) {
      page = await context.newPage();
    }

    // Navigate to Canvas immediately (session starts at about:blank)
    console.log(`🌐 Navigating to Canvas: ${CANVAS_URL}`);
    try {
      await page.goto(CANVAS_URL, { waitUntil: 'networkidle', timeout: 60000 });
      console.log(`✅ Loaded Canvas: ${page.url()}`);
      // Small delay to ensure live view updates
      await page.waitForTimeout(1000);
    } catch (navErr) {
      console.warn(`⚠️ Navigation warning: ${navErr.message}`);
      // Try with domcontentloaded as fallback
      await page.goto(CANVAS_URL, { waitUntil: 'domcontentloaded', timeout: 60000 });
    }

    await waitForLogin(page);
    await page.waitForTimeout(3000); // settle any redirects

    console.log('🍪 Extracting cookies...');
    const cookies = await context.cookies();
    const canvasCookies = filterCanvasCookies(cookies);

    const payload = {
      version: '1.0',
      cookies: canvasCookies,
      metadata: {
        extractedAt: new Date().toISOString(),
        source: 'browserbase-live',
        finalUrl: page.url(),
        userAgent: await page.evaluate(() => navigator.userAgent),
      },
    };

    fs.writeFileSync(OUTPUT_FILE, JSON.stringify(payload, null, 2));
    console.log(`💾 Cookies saved to ${path.relative(process.cwd(), OUTPUT_FILE)}`);
    console.log(`📊 Cookies extracted: ${canvasCookies.length}`);
  } finally {
    if (browser) {
      console.log('🔒 Closing browser connection...');
      await browser.close().catch(() => {});
    }
    if (session?.id) {
      await terminateSession(session.id);
    }
  }
}

main().catch((err) => {
  console.error('❌ Cookie extraction failed:', err.message);
  if (err?.stack) console.error(err.stack);
  process.exit(1);
});
