const { chromium } = require('playwright-core');
const fs = require('fs');
const path = require('path');

// Standard cookie file path - matches extract-cookies.js
const COOKIE_FILE = path.join(__dirname, '..', '..', 'data', 'auth', 'canvas-cookies.json');

/**
 * Load cookies from the standard cookie file
 */
function loadCookiesFromFile() {
  try {
    if (!fs.existsSync(COOKIE_FILE)) {
      throw new Error(`Cookie file not found: ${COOKIE_FILE}`);
    }
    
    const cookieData = JSON.parse(fs.readFileSync(COOKIE_FILE, 'utf8'));
    
    if (!cookieData.cookies || !Array.isArray(cookieData.cookies)) {
      throw new Error('Invalid cookie file format: cookies array not found');
    }
    
    return cookieData.cookies;
  } catch (error) {
    console.error(`❌ Error loading cookies from file: ${error.message}`);
    throw error;
  }
}

/**
 * Run identity probe using cookies from the saved cookie file
 */
async function runIdentityProbeFromSavedCookies() {
  const cookies = loadCookiesFromFile();
  return await runIdentityProbeWithCookies(cookies);
}

/**
 * Run identity probe with provided cookies
 */
async function runIdentityProbeWithCookies(cookies) {
  let browser;
  const outputDir = path.join(__dirname, '..', '..', 'data', 'extracted');
  
  // Ensure output directory exists
  if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir, { recursive: true });
  }
  
  try {
    browser = await chromium.launch({ headless: true });
    const context = await browser.newContext();
    
    // Apply cookies to context
    await context.addCookies(cookies);
    
    const page = await context.newPage();
    
    // Navigate to Canvas dashboard to extract identity
    console.log('🔍 Navigating to Canvas dashboard for identity probe...');
    await page.goto('https://canvas.colorado.edu', {
      waitUntil: 'domcontentloaded',
      timeout: 30000
    });
    
    // Wait a bit for JavaScript to populate window.ENV
    await page.waitForTimeout(2000);
    
    // Extract identity information
    const identityData = await page.evaluate(() => {
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
      
      return {
        envExists: Boolean(env),
        currentUser,
        rawKeys: env ? Object.keys(env) : []
      };
    });
    
    // Try to extract from DOM as fallback
    let domData = {};
    try {
      const html = await page.content();
      const nameMatch = html.match(/<span[^>]*class="[^"]*user_name[^"]*"[^>]*>([^<]+)<\/span>/i);
      const emailMatch = html.match(/<a[^>]*href="mailto:([^"]+)"[^>]*>/i);
      
      if (nameMatch) domData.displayName = nameMatch[1].trim();
      if (emailMatch) domData.email = emailMatch[1].trim();
    } catch (e) {
      // Ignore DOM parsing errors
    }
    
    // Combine results
    const pick = (...vals) => vals.find(v => v && String(v).trim().length);
    
    const final = {
      canvasUserId: pick(
        identityData?.currentUser?.id,
        domData.canvasUserId
      ),
      displayName: pick(
        identityData?.currentUser?.display_name,
        domData.displayName
      ),
      email: pick(
        identityData?.currentUser?.email,
        domData.email
      ),
      loginId: pick(
        identityData?.currentUser?.login_id,
        domData.loginId
      ),
    };
    
    // Save results
    const results = {
      identity: identityData,
      dom: domData,
      final: final
    };
    
    const outputFile = path.join(outputDir, 'identity-probe.json');
    fs.writeFileSync(outputFile, JSON.stringify(results, null, 2));
    
    console.log(`✅ Identity probe completed. Results saved to: ${outputFile}`);
    
    return {
      success: true,
      outFile: outputFile,
      results: results
    };
    
  } catch (error) {
    console.error('❌ Identity probe error:', error.message);
    throw error;
  } finally {
    if (browser) {
      await browser.close();
    }
  }
}

module.exports = {
  runIdentityProbeFromSavedCookies,
  runIdentityProbeWithCookies,
  loadCookiesFromFile
};


