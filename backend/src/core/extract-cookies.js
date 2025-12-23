#!/usr/bin/env node
// Load .env from backend directory (where script is located) or project root
const path = require('path');
const fs = require('fs');
const dotenv = require('dotenv');

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

const { chromium } = require('playwright-core');

const OUTPUT_DIR = path.join(__dirname, '..', '..', 'data', 'auth');

// Optional explicit Chromium path (useful when system Chrome isn't available)
const CHROMIUM_PATH =
  process.env.CHROMIUM_PATH ||
  process.env.CHROME_PATH ||
  process.env.PLAYWRIGHT_CHROMIUM_PATH ||
  null;

// Ensure output directory exists
if (!fs.existsSync(OUTPUT_DIR)) {
  fs.mkdirSync(OUTPUT_DIR, { recursive: true });
}

async function extractCanvasCookies() {
  console.log('🌐 Starting Canvas cookie extraction...');
  console.log('🖥️  A browser window will open for manual login\n');
  
  let browser;
  let extractedCookies = null;
  
  try {
    // Launch browser (visible for manual login)
    // Uses system Chrome only - no downloads required
    const launchOptions = {
      headless: false,
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage'
      ]
    };
    
    // If custom path is provided, use it
    if (CHROMIUM_PATH) {
      // Check if the file exists
      if (!fs.existsSync(CHROMIUM_PATH)) {
        console.error('\n❌ CHROME BINARY NOT FOUND');
        console.error('═══════════════════════════════════════════════════════════');
        console.error(`The specified Chrome path does not exist: ${CHROMIUM_PATH}`);
        console.error('');
        console.error('🔧 Please check your CHROMIUM_PATH environment variable');
        console.error('   Or install Google Chrome and remove CHROMIUM_PATH to use system Chrome');
        console.error('═══════════════════════════════════════════════════════════\n');
        throw new Error(`Chrome binary not found at: ${CHROMIUM_PATH}`);
      }
      launchOptions.executablePath = CHROMIUM_PATH;
      console.log(`📍 Using custom browser binary at: ${CHROMIUM_PATH}`);
      try {
        browser = await chromium.launch(launchOptions);
      } catch (launchError) {
        console.error('\n❌ FAILED TO LAUNCH CHROME');
        console.error('═══════════════════════════════════════════════════════════');
        console.error(`Error launching Chrome from: ${CHROMIUM_PATH}`);
        console.error(`Error: ${launchError.message}`);
        console.error('');
        console.error('🔧 Please verify the Chrome binary is valid and executable');
        console.error('═══════════════════════════════════════════════════════════\n');
        throw new Error(`Failed to launch Chrome from ${CHROMIUM_PATH}: ${launchError.message}`);
      }
    } else {
      // Try to use system Chrome (no download required)
      try {
        browser = await chromium.launch({ 
          ...launchOptions,
          channel: 'chrome' // Uses system Chrome installation
        });
        console.log('✅ Using system Chrome');
      } catch (chromeError) {
        console.error('\n❌ CHROME NOT FOUND');
        console.error('═══════════════════════════════════════════════════════════');
        console.error('This script requires Google Chrome to be installed.');
        console.error('');
        console.error('📥 To install Chrome:');
        console.error('   • macOS: Download from https://www.google.com/chrome/');
        console.error('   • Linux: sudo apt install google-chrome-stable (or use your package manager)');
        console.error('   • Windows: Download from https://www.google.com/chrome/');
        console.error('');
        console.error('🔧 Alternative: Set CHROMIUM_PATH environment variable to point to your Chrome/Chromium binary');
        console.error('   Example: export CHROMIUM_PATH="/path/to/chrome"');
        console.error('═══════════════════════════════════════════════════════════\n');
        throw new Error(
          'Chrome is required but not found. Please install Google Chrome or set CHROMIUM_PATH environment variable.'
        );
      }
    }
    
    const context = await browser.newContext();
    const page = await context.newPage();
    
    console.log('🔗 Navigating to Canvas login page...');
    await page.goto('https://canvas.colorado.edu', { waitUntil: 'domcontentloaded' });
    
    // Wait a bit for any redirects
    await page.waitForTimeout(2000);
    
    const currentUrl = page.url();
    console.log(`📍 Current URL: ${currentUrl}`);

    // Set up username capture from login form
    let capturedUsername = null;
    let usernameUpdateTime = 0;
    
    // Inject JavaScript to monitor input events in real-time
    await page.evaluate(() => {
      // Store username in window object so we can access it
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
      
      function captureUsernameFromInput(input) {
        if (input && input.value && input.value.trim()) {
          const value = input.value.trim();
          // Always update if we find a longer/more complete username
          if (!window.__capturedUsername || value.length > window.__capturedUsername.length) {
            window.__capturedUsername = value;
            console.log('[Username Monitor] Captured:', value);
          }
        }
      }
      
      function setupInputMonitoring() {
        selectors.forEach(selector => {
          try {
            const inputs = document.querySelectorAll(selector);
            inputs.forEach(input => {
              // Capture current value
              captureUsernameFromInput(input);
              
              // Monitor input events (as user types)
              input.addEventListener('input', () => captureUsernameFromInput(input), true);
              input.addEventListener('change', () => captureUsernameFromInput(input), true);
              input.addEventListener('blur', () => captureUsernameFromInput(input), true);
              
              // Also monitor paste events
              input.addEventListener('paste', () => {
                setTimeout(() => captureUsernameFromInput(input), 10);
              }, true);
            });
          } catch (e) {
            // Ignore errors
          }
        });
      }
      
      // Set up monitoring immediately
      setupInputMonitoring();
      
      // Also monitor for dynamically added inputs
      const observer = new MutationObserver(() => {
        setupInputMonitoring();
      });
      
      observer.observe(document.body, {
        childList: true,
        subtree: true
      });
    });

    // Monitor form submissions to capture username
    page.on('request', async (request) => {
      try {
        const postData = request.postData();
        if (postData && (postData.includes('username') || postData.includes('email') || postData.includes('pseudonym_session') || postData.includes('unique_id'))) {
          let username = null;
          
          // Try URL-encoded format first
          try {
            const params = new URLSearchParams(postData);
            username = params.get('username') || 
                      params.get('email') || 
                      params.get('pseudonym_session[unique_id]') ||
                      params.get('pseudonym_session%5Bunique_id%5D');
          } catch (e) {
            // If URLSearchParams fails, try manual parsing
          }
          
          // If not found, try manual parsing for different formats
          if (!username) {
            // Try to find username=value or email=value patterns
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
            const trimmedUsername = username.trim();
            // Always update if we find a longer/more complete username
            if (!capturedUsername || trimmedUsername.length > capturedUsername.length) {
              capturedUsername = trimmedUsername;
              usernameUpdateTime = Date.now();
              console.log(`👤 Username captured from form submission: ${trimmedUsername}`);
            }
          }
        }
      } catch (error) {
        // Ignore errors in request monitoring
      }
    });

    console.log('\n🔐 MANUAL LOGIN REQUIRED');
    console.log('=====================================');
    console.log('1. A browser window should have opened automatically');
    console.log('2. Complete the login process in the browser window');
    console.log('3. Navigate to the Canvas dashboard');
    console.log('4. The system will auto-detect when login is complete');
    console.log('5. The browser window will close automatically when done');
    console.log('⏰ TIMEOUT: 5 minutes maximum');
    console.log('=====================================\n');

    // Auto-detect successful login
    console.log('🔍 Monitoring for successful login...');
    let loginDetected = false;
    let attempts = 0;
    const maxAttempts = 300; // 5 minutes max wait (300 * 1 second)
    const startTime = Date.now();
    const maxTimeMs = 300000; // 5 minutes hard limit

    while (!loginDetected && attempts < maxAttempts) {
      // Check hard time limit first
      if (Date.now() - startTime > maxTimeMs) {
        console.log('⏰ Hard timeout reached (5 minutes)');
        break;
      }
      
      await page.waitForTimeout(1000); // Check every 1 second for faster capture
      attempts++;

      try {
        // Check for username from injected JavaScript monitor
        try {
          const usernameFromMonitor = await page.evaluate(() => {
            return window.__capturedUsername || null;
          });
          
          if (usernameFromMonitor && usernameFromMonitor.trim()) {
            const trimmedUsername = usernameFromMonitor.trim();
            // Always update if we find a longer/more complete username
            if (!capturedUsername || trimmedUsername.length > capturedUsername.length) {
              capturedUsername = trimmedUsername;
              usernameUpdateTime = Date.now();
              console.log(`👤 Username captured from monitor: ${trimmedUsername}`);
            }
          }
        } catch (error) {
          // Ignore errors
        }
        
        // Also check form fields directly as backup
        try {
          const usernameFromForm = await page.evaluate(() => {
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
            
            let bestUsername = null;
            for (const selector of selectors) {
              const input = document.querySelector(selector);
              if (input && input.value && input.value.trim()) {
                const value = input.value.trim();
                // Keep the longest username found
                if (!bestUsername || value.length > bestUsername.length) {
                  bestUsername = value;
                }
              }
            }
            return bestUsername;
          });
          
          if (usernameFromForm && usernameFromForm.trim()) {
            const trimmedUsername = usernameFromForm.trim();
            // Always update if we find a longer/more complete username
            if (!capturedUsername || trimmedUsername.length > capturedUsername.length) {
              capturedUsername = trimmedUsername;
              usernameUpdateTime = Date.now();
              console.log(`👤 Username captured from form field: ${trimmedUsername}`);
            }
          }
        } catch (error) {
          // Ignore errors
        }

        // Check if we're on Canvas dashboard
        const isOnDashboard = await page.evaluate(() => {
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

        const currentUrl = page.url();
        const isCanvasUrl = currentUrl.includes('canvas') || currentUrl.includes('colorado.edu');
        
        if (isOnDashboard && isCanvasUrl) {
          loginDetected = true;
          console.log('✅ Canvas dashboard detected! Login successful.');
        } else {
          const elapsed = Math.round((Date.now() - startTime) / 1000);
          console.log(`⏳ Waiting for login... (${attempts}/${maxAttempts}) - ${elapsed}s elapsed - Current: ${currentUrl}`);
        }
      } catch (error) {
        const elapsed = Math.round((Date.now() - startTime) / 1000);
        console.log(`⏳ Checking login status... (${attempts}/${maxAttempts}) - ${elapsed}s elapsed`);
      }
    }

    if (!loginDetected) {
      const elapsed = Math.round((Date.now() - startTime) / 1000);
      console.log(`⏰ Login timeout after ${elapsed} seconds - please try again`);
      throw new Error(`Login timeout after ${elapsed} seconds - please try again`);
    }

    // Wait a bit more for any final redirects
    await page.waitForTimeout(3000);

    const finalUrl = page.url();
    console.log(`📍 Final URL: ${finalUrl}`);

    // Final check for username from monitor (in case login was very quick)
    try {
      const usernameFromMonitor = await page.evaluate(() => {
        return window.__capturedUsername || null;
      });
      
      if (usernameFromMonitor && usernameFromMonitor.trim()) {
        const trimmedUsername = usernameFromMonitor.trim();
        if (!capturedUsername || trimmedUsername.length > capturedUsername.length) {
          capturedUsername = trimmedUsername;
          console.log(`👤 Username captured from monitor (final check): ${trimmedUsername}`);
        }
      }
    } catch (error) {
      // Ignore errors
    }

    // Try to extract username from the page after login
    if (!capturedUsername) {
      try {
        console.log('🔍 Attempting to extract username from page...');
        const usernameFromPage = await page.evaluate(() => {
          // Try to find username in various places on Canvas dashboard
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
          
          // Check title attributes and text content
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
          
          // Try to extract from profile link href
          const profileLink = document.querySelector('a[href*="/profile"]');
          if (profileLink) {
            const href = profileLink.getAttribute('href');
            const match = href?.match(/\/users\/([^\/]+)/);
            if (match) return match[1];
          }
          
          return null;
        });
        
        if (usernameFromPage) {
          capturedUsername = usernameFromPage;
          console.log(`👤 Username extracted from page: ${usernameFromPage}`);
        }
      } catch (error) {
        console.log('⚠️  Could not extract username from page:', error.message);
      }
    }

    // Extract cookies
    console.log('🍪 Extracting cookies...');
    const cookies = await context.cookies();
    
    // Filter for Canvas-related cookies
    const canvasCookies = cookies.filter(cookie => 
      cookie.domain.includes('canvas') || 
      cookie.domain.includes('colorado.edu') ||
      cookie.name.includes('canvas') ||
      cookie.name.includes('session') ||
      cookie.name.includes('csrf')
    );
    
    console.log(`🍪 Found ${canvasCookies.length} Canvas cookies`);

    // Save cookies and username
    const cookieData = {
      version: '1.0',
      cookies: canvasCookies,
      username: capturedUsername || null,
      metadata: {
        extractedAt: new Date().toISOString(),
        source: 'playwright-extraction',
        userAgent: await page.evaluate(() => navigator.userAgent),
        finalUrl: finalUrl,
        username: capturedUsername || null
      }
    };

    const outputFile = path.join(OUTPUT_DIR, 'canvas-cookies.json');
    fs.writeFileSync(outputFile, JSON.stringify(cookieData, null, 2));
    
    extractedCookies = cookieData;
    
    console.log(`💾 Cookies saved to: ${path.relative(process.cwd(), outputFile)}`);

    console.log('✅ Cookie extraction completed successfully!');
    console.log(`📊 Extracted ${canvasCookies.length} cookies`);
    if (capturedUsername) {
      console.log(`👤 Username: ${capturedUsername}`);
    } else {
      console.log('⚠️  Username could not be extracted');
    }

  } catch (error) {
    console.error('❌ Error during cookie extraction:', error.message);
    throw error;
  } finally {
    // Close browser
    if (browser) {
      console.log('🔒 Closing browser window...');
      await browser.close().catch(() => {});
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
      console.log(`   - Saved to: data/auth/canvas-cookies.json`);
      console.log(`   - Method: Local headful Chromium`);
      console.log(`\n🔄 Next steps:`);
      console.log(`   1. Run: npm run browserbase:inject-cookies`);
      console.log(`   2. Run: npm run extract:canvas-data`);
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
  console.log('🔄 You can restart with: npm run auth:extract-cookies');
  process.exit(0);
});

main().catch((error) => {
  console.error('❌ Cookie extraction failed:', error.message);
  process.exit(1);
});
