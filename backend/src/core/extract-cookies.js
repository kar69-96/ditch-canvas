#!/usr/bin/env node
const { chromium } = require('playwright-core');
const path = require('path');
const fs = require('fs');

const OUTPUT_DIR = path.join(__dirname, '..', '..', 'data', 'auth');

// Ensure output directory exists
if (!fs.existsSync(OUTPUT_DIR)) {
  fs.mkdirSync(OUTPUT_DIR, { recursive: true });
}

async function extractCanvasCookies() {
  console.log('🌐 Starting Canvas cookie extraction...');
  
  let browser;
  let extractedCookies = null;
  
  try {
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
    const maxAttempts = 60; // 5 minutes max wait (60 * 5 seconds)
    const startTime = Date.now();
    const maxTimeMs = 300000; // 5 minutes hard limit

    while (!loginDetected && attempts < maxAttempts) {
      // Check hard time limit first
      if (Date.now() - startTime > maxTimeMs) {
        console.log('⏰ Hard timeout reached (5 minutes)');
        break;
      }
      
      await page.waitForTimeout(5000); // Check every 5 seconds
      attempts++;

      try {
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

    // Save cookies
    const cookieData = {
      version: '1.0',
      cookies: canvasCookies,
      metadata: {
        extractedAt: new Date().toISOString(),
        source: 'playwright-extraction',
        userAgent: await page.evaluate(() => navigator.userAgent),
        finalUrl: finalUrl
      }
    };

    const outputFile = path.join(OUTPUT_DIR, 'canvas-cookies.json');
    fs.writeFileSync(outputFile, JSON.stringify(cookieData, null, 2));
    
    extractedCookies = cookieData;
    
    console.log(`💾 Cookies saved to: ${path.relative(process.cwd(), outputFile)}`);

    console.log('✅ Cookie extraction completed successfully!');
    console.log(`📊 Extracted ${canvasCookies.length} cookies`);

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
      console.log(`   - Saved to: data/auth/canvas-cookies.json`);
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
