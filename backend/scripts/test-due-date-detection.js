#!/usr/bin/env node
/**
 * Quick test script to verify due date change detection
 * Tests only course 121531 and assignment 2416042
 */

const path = require('path');
const fs = require('fs');
const { chromium } = require('playwright-core');

const CANVAS_URL = process.env.CANVAS_URL || 'https://canvas.colorado.edu';
const COOKIE_FILE = path.join(__dirname, '..', 'data', 'auth', 'canvas-cookies.json');
const STORAGE_DIR = path.join(__dirname, '..', 'storage', 'datasets');
const EXTRACTION_FOLDER = 'update test';

// Load cookies
function loadCookies() {
  if (!fs.existsSync(COOKIE_FILE)) {
    throw new Error(`Cookie file not found: ${COOKIE_FILE}`);
  }
  const cookieData = JSON.parse(fs.readFileSync(COOKIE_FILE, 'utf8'));
  return cookieData.cookies || cookieData;
}

// Load extraction summary
function loadExtractionSummary() {
  const summaryPath = path.join(STORAGE_DIR, EXTRACTION_FOLDER, 'extraction-summary.json');
  if (!fs.existsSync(summaryPath)) {
    throw new Error(`Summary not found: ${summaryPath}`);
  }
  return JSON.parse(fs.readFileSync(summaryPath, 'utf8'));
}

// Quick check assignments
async function quickCheckAssignments(page, courseId) {
  const url = `${CANVAS_URL}/courses/${courseId}/assignments`;
  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 10000 });
  await page.waitForTimeout(1500);
  
  const data = await page.evaluate(() => {
    const links = document.querySelectorAll('a[href*="/assignments/"]');
    const assignmentIds = new Set();
    const assignments = [];
    
    links.forEach(link => {
      const href = link.getAttribute('href');
      if (href && !href.includes('/submissions') && !href.includes('/grade')) {
        const match = href.match(/\/assignments\/(\d+)/);
        if (match) {
          const id = match[1];
          if (!assignmentIds.has(id)) {
            assignmentIds.add(id);
            const fullUrl = href.startsWith('http') ? href : new URL(href, window.location.href).href;
            
            const listItem = link.closest('.assignment, .assignment-list-item, li, tr, .ig-list-item');
            let dueDate = null;
            
            if (listItem) {
              const dueSelectors = [
                '.due-date',
                '.assignment-due-date',
                'time[datetime]',
                '[data-testid="due-date"]',
                '.ig-list-item__content .due-date'
              ];
              
              for (const selector of dueSelectors) {
                const dueEl = listItem.querySelector(selector);
                if (dueEl) {
                  dueDate = dueEl.getAttribute('datetime') || 
                           dueEl.getAttribute('title') ||
                           dueEl.textContent.trim();
                  break;
                }
              }
            }
            
            assignments.push({
              id,
              url: fullUrl,
              title: link.textContent.trim(),
              dueDate
            });
          }
        }
      }
    });
    
    return { count: assignments.length, items: assignments };
  });
  
  return data;
}

// Create hash
function createItemHash(item, contentType) {
  const crypto = require('crypto');
  
  const normalizeString = (str) => (str || '').toString().trim().toLowerCase();
  const normalizeDate = (date) => {
    if (!date) return null;
    const dateStr = date.toString().trim();
    if (!dateStr) return null;
    
    const isoMatch = dateStr.match(/(\d{4}-\d{2}-\d{2})(?:T|\s|$)/);
    if (isoMatch) {
      return isoMatch[1];
    }
    
    try {
      const parsed = new Date(dateStr);
      if (!isNaN(parsed.getTime())) {
        const year = parsed.getFullYear();
        const month = String(parsed.getMonth() + 1).padStart(2, '0');
        const day = String(parsed.getDate()).padStart(2, '0');
        return `${year}-${month}-${day}`;
      }
    } catch (e) {
      // Ignore
    }
    
    return normalizeString(dateStr);
  };
  
  const hashData = {
    id: String(item.id || ''),
    title: normalizeString(item.title || item.name),
    dueDate: item.dueDate ? normalizeDate(item.dueDate) : null
  };
  
  Object.keys(hashData).forEach(key => {
    if (hashData[key] === null || hashData[key] === '') {
      delete hashData[key];
    }
  });
  
  const hashString = JSON.stringify(hashData);
  return crypto.createHash('md5').update(hashString).digest('hex');
}

async function main() {
  console.log('🧪 Testing Due Date Change Detection\n');
  
  const courseId = '121531';
  const assignmentId = '2416042';
  
  // Load summary
  console.log('📊 Loading extraction summary...');
  const summary = loadExtractionSummary();
  const courseData = summary.courses[courseId];
  if (!courseData) {
    throw new Error(`Course ${courseId} not found in summary`);
  }
  
  const storedAssignment = courseData.assignments[assignmentId];
  if (!storedAssignment) {
    throw new Error(`Assignment ${assignmentId} not found in summary`);
  }
  
  console.log(`✅ Found assignment: "${storedAssignment.title}"`);
  console.log(`   Stored due date: ${storedAssignment.dueDate || 'null'}\n`);
  
  // Launch browser and check current state
  console.log('🌐 Launching browser...');
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext();
  const page = await context.newPage();
  
  // Inject cookies
  const cookies = loadCookies();
  const cookiesWithDomain = cookies.map(cookie => ({
    ...cookie,
    domain: cookie.domain || new URL(CANVAS_URL).hostname
  }));
  await context.addCookies(cookiesWithDomain);
  
  console.log('🔍 Checking current assignments on Canvas...');
  const currentAssignments = await quickCheckAssignments(page, courseId);
  const currentAssignment = currentAssignments.items.find(a => a.id === assignmentId);
  
  if (!currentAssignment) {
    console.log(`❌ Assignment ${assignmentId} not found on Canvas`);
    await browser.close();
    return;
  }
  
  console.log(`✅ Found assignment on Canvas: "${currentAssignment.title}"`);
  console.log(`   Current due date: ${currentAssignment.dueDate || 'null'}\n`);
  
  // Compare hashes
  console.log('🔍 Comparing hashes...');
  const currentHash = createItemHash(currentAssignment, 'assignments');
  
  const storedItemForHash = {
    id: storedAssignment.assignmentId || storedAssignment.id,
    title: storedAssignment.title,
    dueDate: storedAssignment.dueDate
  };
  const storedHash = createItemHash(storedItemForHash, 'assignments');
  
  console.log(`   Current hash: ${currentHash.substring(0, 16)}...`);
  console.log(`   Stored hash:  ${storedHash.substring(0, 16)}...`);
  
  if (currentHash !== storedHash) {
    console.log('\n✅ CHANGE DETECTED! Due date or other field has changed.');
    console.log(`   The update script should detect this and re-extract the assignment.`);
  } else {
    console.log('\n❌ NO CHANGE DETECTED. Hashes match.');
    console.log(`   This means the due dates are the same (or both null).`);
  }
  
  await browser.close();
}

main().catch(error => {
  console.error(`\n❌ Error: ${error.message}`);
  if (error.stack) {
    console.error(error.stack);
  }
  process.exit(1);
});

