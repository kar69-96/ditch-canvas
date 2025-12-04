#!/usr/bin/env node
const express = require('express');
const path = require('path');
const fs = require('fs');
const { chromium } = require('playwright-core');

const app = express();
const PORT = 3001;
const OUTPUT_DIR = path.join(__dirname, '..', '..', 'data', 'auth');

// Ensure output directory exists
if (!fs.existsSync(OUTPUT_DIR)) {
  fs.mkdirSync(OUTPUT_DIR, { recursive: true });
}

// Serve static files
app.use(express.static(path.join(__dirname)));

// Serve the auth page
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'canvas-auth.html'));
});

// API endpoint to extract cookies using Playwright
app.post('/api/extract-cookies', async (req, res) => {
  console.log('🍪 Starting cookie extraction...');
  
  let browser;
  let extractedCookies = null;
  
  try {
    // Launch browser
    browser = await chromium.launch({ 
      headless: false, // Show browser for manual login
      args: ['--start-maximized']
    });
    
    const context = await browser.newContext();
    const page = await context.newPage();
    
    console.log('🌐 Navigating to Canvas...');
    await page.goto('https://canvas.colorado.edu', { waitUntil: 'domcontentloaded' });
    
    // Wait for manual login
    console.log('🔐 Waiting for manual login...');
    console.log('📱 Please complete the login process in the browser window');
    
    let loginDetected = false;
    let attempts = 0;
    const maxAttempts = 60; // 5 minutes max wait
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
      throw new Error(`Login timeout after ${elapsed} seconds - please try again`);
    }
    
    // Extract cookies
    console.log('🍪 Extracting cookies...');
    const cookies = await context.cookies();
    
    // Filter for Canvas-related cookies
    const canvasCookies = cookies.filter(cookie => 
      cookie.domain.includes('canvas') || 
      cookie.domain.includes('colorado.edu') ||
      cookie.name.includes('canvas') ||
      cookie.name.includes('session')
    );
    
    console.log(`✅ Found ${canvasCookies.length} Canvas cookies`);
    
    // Save cookies
    const cookieData = {
      version: '1.0',
      cookies: canvasCookies,
      metadata: {
        extractedAt: new Date().toISOString(),
        source: 'auth-server-playwright',
        userAgent: await page.evaluate(() => navigator.userAgent),
        finalUrl: page.url()
      }
    };
    
    const outputFile = path.join(OUTPUT_DIR, 'canvas-cookies.json');
    fs.writeFileSync(outputFile, JSON.stringify(cookieData, null, 2));
    
    extractedCookies = cookieData;
    
    console.log(`💾 Cookies saved to: ${outputFile}`);
    
  } catch (error) {
    console.error('❌ Error during cookie extraction:', error.message);
    res.status(500).json({ error: error.message });
    return;
  } finally {
    if (browser) {
      await browser.close();
    }
  }
  
  res.json({
    success: true,
    cookies: extractedCookies,
    message: 'Cookies extracted successfully!'
  });
});

// Start server
app.listen(PORT, () => {
  console.log(`🚀 Canvas Auth Server running at http://localhost:${PORT}`);
  console.log('📱 Open this URL in your browser to start authentication');
  console.log('🔐 Complete login, then the server will extract cookies automatically');
});

// Handle graceful shutdown
process.on('SIGINT', () => {
  console.log('\n⚠️ Auth server shutting down...');
  process.exit(0);
});
