#!/usr/bin/env node
/*
 * Server-side Canvas login + cookie extraction for VNC sessions.
 * Launches headful Chromium against DISPLAY :99, waits for manual login
 * (via noVNC), extracts cookies + username, and posts them back to the
 * backend callback URL.
 */

const { chromium } = require('playwright-core');
const path = require('path');
const fs = require('fs');

// Node 16 doesn't have fetch, use node-fetch
let fetch;
try {
  fetch = globalThis.fetch || require('node-fetch');
} catch (e) {
  // Try to use built-in fetch (Node 18+)
  fetch = globalThis.fetch;
}
if (!fetch) {
  console.error('❌ fetch is not available. Install node-fetch: npm install node-fetch');
  process.exit(1);
}

const SESSION_TOKEN = process.env.SESSION_TOKEN || process.argv[2];
const CALLBACK_URL = process.env.CALLBACK_URL || process.env.VNC_CALLBACK_URL || process.argv[3];
const DISPLAY = process.env.DISPLAY || ':99';
// Use /tmp for EC2 (writable) or local data/auth for development
const OUTPUT_DIR = process.env.OUTPUT_DIR || (fs.existsSync('/opt/app') ? '/tmp/vnc-auth' : path.join(__dirname, '..', '..', 'data', 'auth'));
const LOGIN_URL = process.env.LOGIN_URL || 'https://canvas.colorado.edu';
const LOGIN_TIMEOUT_MS = parseInt(process.env.LOGIN_TIMEOUT_MS || '300000', 10); // 5 minutes

if (!SESSION_TOKEN) {
  console.error('❌ SESSION_TOKEN is required (env or argv[2])');
  process.exit(1);
}

if (!CALLBACK_URL) {
  console.error('❌ CALLBACK_URL is required (env VNC_CALLBACK_URL or argv[3])');
  process.exit(1);
}

if (!fs.existsSync(OUTPUT_DIR)) {
  fs.mkdirSync(OUTPUT_DIR, { recursive: true });
}

async function postResults(payload) {
  const maxAttempts = 3;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      const res = await fetch(CALLBACK_URL, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(payload)
      });
      if (!res.ok) {
        throw new Error(`HTTP ${res.status}`);
      }
      console.log(`✅ Posted results to callback (attempt ${attempt})`);
      return true;
    } catch (err) {
      console.error(`⚠️  Callback post failed (attempt ${attempt}): ${err.message}`);
      if (attempt === maxAttempts) return false;
      await new Promise((resolve) => setTimeout(resolve, 2000 * attempt));
    }
  }
  return false;
}

async function runLogin() {
  console.log(`🌐 Starting Canvas login for session ${SESSION_TOKEN}`);

  let browser;
  let extracted = null;
  let capturedUsername = null;
  const usernameStart = Date.now();

  try {
    // Use a fresh, throwaway user data directory each run to avoid cached autofill or prior typed text
    const userDataDir = fs.mkdtempSync('/tmp/chrome-vnc-');
    
    console.log('\n=== VNC Login Debug Info ===');
    console.log(`[DEBUG] DISPLAY: ${DISPLAY}`);
    console.log(`[DEBUG] LOGIN_URL: ${LOGIN_URL}`);
    console.log(`[DEBUG] SESSION_TOKEN: ${SESSION_TOKEN}`);
    console.log(`[DEBUG] CHROME_PATH env: ${process.env.CHROME_PATH || 'not set'}`);
    console.log(`[DEBUG] User data dir: ${userDataDir}`);
    
    // Check if Xvfb is running
    const { execSync } = require('child_process');
    try {
      const xdpyinfo = execSync(`DISPLAY=${DISPLAY} xdpyinfo 2>&1`, { encoding: 'utf-8' });
      console.log(`[DEBUG] ✅ X11 display is available`);
      // Extract screen size
      const screenMatch = xdpyinfo.match(/dimensions:\s+(\d+x\d+)/);
      if (screenMatch) {
        console.log(`[DEBUG] Screen dimensions: ${screenMatch[1]}`);
      }
    } catch (xErr) {
      console.error(`[DEBUG] ❌ X11 display check failed: ${xErr.message}`);
      console.error(`[DEBUG] Make sure Xvfb is running with: Xvfb ${DISPLAY} -screen 0 1920x1080x24 &`);
    }
    
    // Check if chromium exists
    const chromePath = process.env.CHROME_PATH || '/usr/bin/chromium-browser';
    const chromeExists = fs.existsSync(chromePath);
    console.log(`[DEBUG] Chrome executable (${chromePath}): ${chromeExists ? '✅ exists' : '❌ NOT FOUND'}`);
    
    // Try alternative paths if default doesn't exist
    let actualChromePath = chromePath;
    if (!chromeExists) {
      const alternatives = [
        '/usr/bin/chromium',
        '/usr/bin/google-chrome',
        '/usr/bin/google-chrome-stable',
        '/snap/bin/chromium',
        '/opt/google/chrome/chrome'
      ];
      for (const alt of alternatives) {
        if (fs.existsSync(alt)) {
          actualChromePath = alt;
          console.log(`[DEBUG] ✅ Found alternative Chrome at: ${alt}`);
          break;
        }
      }
    }
    
    // Launch options optimized for Xvfb virtual display
    // Key: DON'T use --disable-software-rasterizer on Xvfb - it causes black screen!
    // Note: Don't use --user-data-dir in args - Playwright handles it differently
    const launchOptions = {
      headless: false,
      executablePath: actualChromePath,
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
        // For Xvfb: use software rendering, NOT hardware GPU
        '--disable-gpu',
        '--use-gl=swiftshader',  // Force software GL rendering
        // Window settings
        '--start-maximized',
        '--window-size=1920,1080',
        '--window-position=0,0',
        '--disable-features=TranslateUI',
        '--disable-ipc-flooding-protection',
        // Preferences
        '--no-first-run',
        '--no-default-browser-check',
        '--disable-sync',
        '--disable-background-networking',
        '--disable-extensions',
        // Force visible rendering
        '--force-device-scale-factor=1',
        '--disable-backgrounding-occluded-windows',
        '--disable-renderer-backgrounding'
      ],
      env: { 
        ...process.env,
        DISPLAY 
      }
    };
    
    console.log(`[DEBUG] Launch options:`, JSON.stringify({
      ...launchOptions,
      args: launchOptions.args.slice(0, 5).concat(['...']) // Truncate for readability
    }, null, 2));

    console.log('[DEBUG] Launching browser with persistent context (visible window)...');
    
    // Use launchPersistentContext instead of launch + newContext
    // This creates a visible browser window on the X display
    let context;
    try {
      context = await chromium.launchPersistentContext(userDataDir, {
        headless: false,
        executablePath: actualChromePath,
        args: launchOptions.args,
        viewport: { width: 1920, height: 1080 },
        deviceScaleFactor: 1,
        env: { ...process.env, DISPLAY }
      });
      browser = context.browser?.() || { 
        isConnected: () => true, 
        close: async () => context.close() 
      };
    } catch (launchError) {
      console.error(`[DEBUG] ❌ Browser launch failed: ${launchError.message}`);
      console.error(`[DEBUG] Full error:`, launchError);
      
      // Try with minimal flags as fallback
      console.log('[DEBUG] Trying minimal launch flags...');
      context = await chromium.launchPersistentContext(userDataDir, {
        headless: false,
        executablePath: actualChromePath,
        args: [
          '--no-sandbox',
          '--disable-dev-shm-usage',
          '--disable-gpu',
          '--window-size=1920,1080',
          '--no-first-run'
        ],
        viewport: { width: 1920, height: 1080 },
        env: { ...process.env, DISPLAY }
      });
      browser = context.browser?.() || { 
        isConnected: () => true, 
        close: async () => context.close() 
      };
    }
    
    console.log('[DEBUG] ✅ Browser launched successfully with visible window');
    console.log(`[DEBUG] Browser connected: ${browser.isConnected?.() || true}`);
    
    console.log('[DEBUG] Getting page from context...');
    // Get or create a page
    let page = context.pages()[0];
    if (!page) {
      page = await context.newPage();
    }
    console.log('[DEBUG] ✅ Page ready');
    
    // Add page event listeners for debugging
    page.on('console', msg => {
      if (msg.type() === 'error') {
        console.log(`[PAGE ERROR] ${msg.text()}`);
      }
    });
    
    page.on('pageerror', error => {
      console.error(`[PAGE CRASH] ${error.message}`);
    });
    
    page.on('crash', () => {
      console.error('[DEBUG] ❌ PAGE CRASHED!');
    });

    console.log(`[DEBUG] Navigating to ${LOGIN_URL} ...`);
    const navStartTime = Date.now();
    await page.goto(LOGIN_URL, { waitUntil: 'domcontentloaded', timeout: 30000 });
    console.log(`[DEBUG] ✅ Navigation completed in ${Date.now() - navStartTime}ms`);
    
    // Wait a moment for redirects to settle and window to get focus
    await page.waitForTimeout(2000);
    console.log(`[DEBUG] Waited for page to settle. Current URL: ${page.url()}`);
    
    // Try to bring the browser window to front and ensure it's interactive
    try {
      await page.bringToFront();
      console.log('[DEBUG] Browser window brought to front');
    } catch (e) {
      console.log(`[DEBUG] Could not bring window to front: ${e.message}`);
    }
    
    // Use xdotool to properly size, position, and focus the Chrome window
    try {
      const { execSync } = require('child_process');
      await page.waitForTimeout(2000); // Give Chrome time to fully render
      
      // Find the main Chrome window (largest one, not the tiny 10x10 one)
      // Size all Chrome windows to full screen and focus the main one
      const focusScript = `
        DISPLAY=${DISPLAY} xdotool search --class 'google-chrome' | while read winid; do
          # Get window geometry to find the largest window
          geom=\$(DISPLAY=${DISPLAY} xdotool getwindowgeometry \$winid 2>/dev/null | grep Geometry | awk '{print \$2}' | cut -dx -f1 | head -1)
          if [ -n "\$geom" ] && [ "\$geom" -gt 100 ]; then
            # This is a real window, not a tiny one
            DISPLAY=${DISPLAY} xdotool windowsize \$winid 1920 1080 2>/dev/null
            DISPLAY=${DISPLAY} xdotool windowmove \$winid 0 0 2>/dev/null
            DISPLAY=${DISPLAY} xdotool windowactivate \$winid 2>/dev/null
            DISPLAY=${DISPLAY} xdotool windowfocus \$winid 2>/dev/null
            echo "Focused window \$winid"
          fi
        done
      `;
      execSync(focusScript, { encoding: 'utf8', timeout: 5000 });
      console.log('[DEBUG] Chrome window resized and focused using xdotool');
    } catch (focusErr) {
      console.log(`[DEBUG] Could not focus window with xdotool (this is okay): ${focusErr.message}`);
    }
    
    
    // Check page state
    let pageState = { readyState: 'unknown', title: 'unknown', url: page.url() };
    try {
      pageState = await page.evaluate(() => ({
        readyState: document.readyState,
        title: document.title,
        url: window.location.href,
        bodyExists: !!document.body,
        bodyChildren: document.body ? document.body.children.length : 0,
        innerWidth: window.innerWidth,
        innerHeight: window.innerHeight
      }));
    } catch (evalErr) {
      console.log(`[DEBUG] ⚠️ page.evaluate failed (page may be navigating): ${evalErr.message}`);
    }
    console.log(`[DEBUG] Page state:`, JSON.stringify(pageState, null, 2));
    
    if (pageState.bodyChildren === 0) {
      console.error('[DEBUG] ❌ WARNING: Page body has no children - may be black screen!');
    }
    
    // Take a debug screenshot and check for black screen
    try {
      const screenshotPath = '/tmp/vnc-debug-screenshot.png';
      await page.screenshot({ path: screenshotPath });
      console.log(`[DEBUG] Screenshot saved to: ${screenshotPath}`);
      
      // Check if screenshot is all black (potential rendering issue)
      const screenshotBuffer = fs.readFileSync(screenshotPath);
      const isLikelyBlack = screenshotBuffer.length < 5000; // Very small = likely blank
      if (isLikelyBlack) {
        console.error('[DEBUG] ⚠️ WARNING: Screenshot is very small, page may not be rendering!');
        console.error('[DEBUG] This could indicate:');
        console.error('[DEBUG]   1. Xvfb display issue');
        console.error('[DEBUG]   2. Chromium rendering issue');
        console.error('[DEBUG]   3. GPU/software rendering conflict');
      }
    } catch (ssErr) {
      console.error(`[DEBUG] Screenshot failed: ${ssErr.message}`);
    }
    
    // Also save debug info to a file for inspection
    try {
      const debugInfo = {
        timestamp: new Date().toISOString(),
        display: DISPLAY,
        chromePath: actualChromePath,
        pageState,
        browserConnected: browser.isConnected(),
        pid: browser.process?.()?.pid || 'unknown'
      };
      fs.writeFileSync('/tmp/vnc-debug-info.json', JSON.stringify(debugInfo, null, 2));
      console.log('[DEBUG] Debug info saved to /tmp/vnc-debug-info.json');
    } catch (e) {
      // ignore
    }
    
    // Log initial navigation (login flow will naturally redirect through fedauth.colorado.edu)
    const initialUrl = page.url();
    console.log(`[DEBUG] Initial URL after navigation: ${initialUrl}`);
    
    // Allow the authentication flow to proceed naturally
    // The login process will:
    // 1. Start at canvas.colorado.edu
    // 2. Redirect to fedauth.colorado.edu (login page) - ALLOW THIS
    // 3. User enters credentials
    // 4. Redirect back to canvas.colorado.edu after login - ALLOW THIS
    // We only check for successful completion, not interfere with navigation

    // Real-time username monitoring inside the page
    await page.evaluate(() => {
      window.__capturedUsername = null;
      const selectors = [
        'input[name="username"]',
        'input[name="email"]',
        'input[name="pseudonym_session[unique_id]"]',
        'input[type="email"]',
        'input[type="text"][id*="username"]',
        'input[type="text"][id*="email"]',
        'input[type="text"][id*="login"]',
        '#pseudonym_session_unique_id',
        '#username',
        '#email'
      ];

      function capture(input) {
        if (input && input.value && input.value.trim()) {
          const value = input.value.trim();
          if (!window.__capturedUsername || value.length > window.__capturedUsername.length) {
            window.__capturedUsername = value;
            console.log('[Username Monitor] Captured:', value);
          }
        }
      }

      function setup() {
        selectors.forEach((selector) => {
          try {
            document.querySelectorAll(selector).forEach((input) => {
              capture(input);
              input.addEventListener('input', () => capture(input), true);
              input.addEventListener('change', () => capture(input), true);
              input.addEventListener('blur', () => capture(input), true);
              input.addEventListener('paste', () => setTimeout(() => capture(input), 10), true);
            });
          } catch (_) {
            // ignore
          }
        });
      }

      setup();
      const observer = new MutationObserver(setup);
      observer.observe(document.body, { childList: true, subtree: true });
    });

    // Monitor requests to capture username
    page.on('request', async (request) => {
      try {
        const postData = request.postData();
        if (!postData) return;
        if (!(postData.includes('username') || postData.includes('email') || postData.includes('unique_id'))) return;

        let username = null;
        try {
          const params = new URLSearchParams(postData);
          username =
            params.get('username') ||
            params.get('email') ||
            params.get('pseudonym_session[unique_id]') ||
            params.get('pseudonym_session%5Bunique_id%5D');
        } catch (_) {
          // ignore
        }

        if (!username) {
          const patterns = [
            /(?:^|&)(?:username|email|pseudonym_session\[unique_id\]|pseudonym_session%5Bunique_id%5D)=([^&]+)/i,
            /["']username["']\s*[:=]\s*["']([^"']+)["']/i,
            /["']email["']\s*[:=]\s*["']([^"']+)["']/i
          ];
          for (const pattern of patterns) {
            const match = postData.match(pattern);
            if (match && match[1]) {
              username = decodeURIComponent(match[1].replace(/\+/g, ' '));
              break;
            }
          }
        }

        if (username && username.trim()) {
          const trimmed = username.trim();
          if (!capturedUsername || trimmed.length > capturedUsername.length) {
            capturedUsername = trimmed;
            console.log(`👤 Username captured from submission: ${trimmed}`);
          }
        }
      } catch (_) {
        // ignore
      }
    });

    console.log('\n🔐 MANUAL LOGIN REQUIRED (via noVNC)');
    console.log('   1) Open the provided noVNC URL');
    console.log('   2) Complete Canvas login');
    console.log('   3) Reach the dashboard; cookies will be captured automatically');
    console.log(`   ⏰ Timeout: ${Math.round(LOGIN_TIMEOUT_MS / 1000)}s\n`);

    const startTime = Date.now();
    let attempts = 0;
    const maxAttempts = Math.ceil(LOGIN_TIMEOUT_MS / 1000);
    let loginDetected = false;

    while (!loginDetected && attempts < maxAttempts) {
      const elapsed = Date.now() - startTime;
      if (elapsed > LOGIN_TIMEOUT_MS) {
        break;
      }
      attempts++;
      await page.waitForTimeout(1000);

      // Pull username from monitor
      try {
        const fromMonitor = await page.evaluate(() => window.__capturedUsername || null);
        if (fromMonitor && (!capturedUsername || fromMonitor.length > capturedUsername.length)) {
          capturedUsername = fromMonitor.trim();
          console.log(`👤 Username captured from monitor: ${capturedUsername}`);
        }
      } catch (_) {}

      // Allow the authentication flow to proceed naturally
      // Don't redirect - the login process goes through:
      // 1. canvas.colorado.edu (initial)
      // 2. fedauth.colorado.edu (login page) - ALLOW THIS
      // 3. canvas.colorado.edu (after successful login) - this is what we check for

      // Check dashboard (only if page is stable, not navigating)
      let dashboardCheck = { isOnDashboard: false, foundSelectors: [], url: '', title: '' };
      try {
        // Check if page is currently navigating - if so, skip this check
        const isNavigating = await page.evaluate(() => {
          return document.readyState === 'loading' || document.hidden;
        }).catch(() => true);
        
        if (!isNavigating) {
          dashboardCheck = await page.evaluate(() => {
          const selectors = [
            '#global_nav_dashboard_link',
            '.ic-DashboardCard',
            '#DashboardCard_Container',
            '[data-testid="dashboard"]',
            '#global_nav_profile_link',
            '.dashboard-header',
            '.course-list'
          ];
          const found = selectors.filter((s) => document.querySelector(s) !== null);
          return {
            isOnDashboard: found.length > 0,
            foundSelectors: found,
            url: window.location.href,
            title: document.title
          };
          }).catch(() => ({ isOnDashboard: false, foundSelectors: [], url: '', title: '' }));
        }

        const currentUrl = page.url();
        const isCanvas = currentUrl.includes('canvas.colorado.edu');
        
        if (dashboardCheck.isOnDashboard && isCanvas) {
          loginDetected = true;
          console.log('✅ Dashboard detected - login complete');
          console.log(`   URL: ${currentUrl}`);
          console.log(`   Found selectors: ${dashboardCheck.foundSelectors.join(', ')}`);
        } else {
          const statusParts = [];
          if (!dashboardCheck.isOnDashboard) statusParts.push('not on dashboard');
          if (!isCanvas) statusParts.push('not on canvas.colorado.edu');
          console.log(`⏳ Waiting for login... ${Math.round(elapsed / 1000)}s elapsed - ${statusParts.join(', ')}`);
          console.log(`   Current URL: ${currentUrl}`);
          console.log(`   Page title: ${dashboardCheck.title}`);
        }
      } catch (err) {
        console.log(`⚠️  Error checking dashboard, retrying... ${err.message}`);
      }
    }

    if (!loginDetected) {
      throw new Error('Login timeout');
    }

    await page.waitForTimeout(2000);
    const finalUrl = page.url();
    console.log(`📍 Final URL: ${finalUrl}`);

    // Final username check
    try {
      const fromMonitor = await page.evaluate(() => window.__capturedUsername || null);
      if (fromMonitor && (!capturedUsername || fromMonitor.length > capturedUsername.length)) {
        capturedUsername = fromMonitor.trim();
        console.log(`👤 Username captured (final): ${capturedUsername}`);
      }
    } catch (_) {}

    // Fallback extraction from page UI
    if (!capturedUsername) {
      try {
        const fromPage = await page.evaluate(() => {
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
            const el = document.querySelector(selector);
            if (el) {
              const title = el.getAttribute('title');
              const text = el.textContent?.trim();
              if (title && (title.includes('@') || title.includes('.'))) return title;
              if (text && (text.includes('@') || text.includes('.'))) return text;
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
        if (fromPage) {
          capturedUsername = fromPage.trim();
          console.log(`👤 Username extracted from page: ${capturedUsername}`);
        }
      } catch (err) {
        console.log('⚠️  Could not extract username from page:', err.message);
      }
    }

    // Extract cookies - use same validation logic as original extract-cookies.js
    console.log('🍪 Extracting cookies...');
    const allCookies = await context.cookies();
    console.log(`🍪 Found ${allCookies.length} total cookies`);
    
    // Filter for Canvas-related cookies - same logic as extract-cookies.js
    const canvasCookies = allCookies.filter((c) =>
      c.domain.includes('canvas') ||
      c.domain.includes('colorado.edu') ||
      c.domain.includes('instructure.com') ||
      c.name.includes('canvas') ||
      c.name.includes('session') ||
      c.name.includes('_session') ||
      c.name.includes('csrf')
    );
    
    console.log(`🍪 Filtered to ${canvasCookies.length} Canvas cookies`);
    
    // Log cookie details for debugging
    if (canvasCookies.length > 0) {
      console.log('🍪 Cookie details:');
      canvasCookies.forEach((c, i) => {
        console.log(`   ${i + 1}. ${c.name} (domain: ${c.domain}, expires: ${c.expires || 'session'})`);
      });
    } else {
      console.log('⚠️  WARNING: No Canvas cookies found!');
      console.log('   All cookies:');
      allCookies.slice(0, 10).forEach((c, i) => {
        console.log(`   ${i + 1}. ${c.name} (domain: ${c.domain})`);
      });
      if (allCookies.length > 10) {
        console.log(`   ... and ${allCookies.length - 10} more`);
      }
    }
    
    // Validate cookies using same logic as canvas-crawler.js
    const hasSessionCookie = canvasCookies.some(c => 
      c.name.includes('session') || 
      c.name.includes('canvas') || 
      c.name.includes('_session')
    );
    
    const hasAuthCookie = canvasCookies.some(c => 
      c.domain.includes('canvas') || 
      c.domain.includes('colorado.edu') ||
      c.domain.includes('instructure.com')
    );
    
    if (!hasSessionCookie && !hasAuthCookie) {
      console.error('❌ WARNING: No valid Canvas authentication cookies found!');
      console.error('   - Has session cookie:', hasSessionCookie);
      console.error('   - Has auth cookie:', hasAuthCookie);
    } else {
      console.log('✅ Cookie validation passed:');
      console.log(`   - Has session cookie: ${hasSessionCookie}`);
      console.log(`   - Has auth cookie: ${hasAuthCookie}`);
    }

    // Final validation before creating payload
    if (canvasCookies.length === 0) {
      throw new Error('No Canvas cookies extracted - login may have failed');
    }
    
    if (!hasSessionCookie && !hasAuthCookie) {
      throw new Error('No valid Canvas authentication cookies found - login may have failed');
    }

    const payload = {
      sessionToken: SESSION_TOKEN,
      username: capturedUsername || null,
      cookies: canvasCookies,
      metadata: {
        extractedAt: new Date().toISOString(),
        finalUrl,
        userAgent: await page.evaluate(() => navigator.userAgent),
        source: 'vnc-login',
        usernameCapturedMs: capturedUsername ? Date.now() - usernameStart : null,
        cookieCount: canvasCookies.length,
        hasSessionCookie,
        hasAuthCookie
      }
    };

    const outputFile = path.join(OUTPUT_DIR, 'canvas-cookies.json');
    fs.writeFileSync(outputFile, JSON.stringify(payload, null, 2));
    console.log(`💾 Saved cookies to ${outputFile}`);

    // Post back to backend callback
    console.log('📤 Posting results to callback URL...');
    const posted = await postResults(payload);
    if (!posted) {
      console.error('❌ Failed to post results to callback');
      throw new Error('Failed to post results to callback URL');
    }
    console.log('✅ Results posted successfully');

    extracted = payload;
    console.log('✅ Completed login + extraction');
  } catch (err) {
    console.error('❌ Error during login:', err.message);
    if (CALLBACK_URL) {
      await postResults({ sessionToken: SESSION_TOKEN, error: err.message });
    }
    throw err;
  } finally {
    if (browser && browser.close) {
      await browser.close().catch(() => {});
    }
  }

  return extracted;
}

runLogin().catch((err) => {
  console.error('❌ Fatal:', err.message);
  process.exit(1);
});

