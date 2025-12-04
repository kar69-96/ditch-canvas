#!/usr/bin/env node
/**
 * Canvas Course Crawler using Crawlee
 * Implements phased extraction: mapping -> content extraction -> downloads
 */

// Set Crawlee storage directory before importing Crawlee
// This ensures Crawlee uses our custom storage location
// NOTE: The actual extraction folder will be set in main() before any crawler operations
// For now, set a default that will be overridden
const path = require('path');
const fs = require('fs');
const { FILES_PIPELINE_MODE } = require('../config/files-pipeline.js');
if (!process.env.CRAWLEE_STORAGE_DIR) {
  process.env.CRAWLEE_STORAGE_DIR = path.join(__dirname, '..', '..', 'storage', 'datasets');
}

const { PlaywrightCrawler, Dataset, Configuration, RequestQueue } = require('crawlee');
const { chromium } = require('playwright-core');
const { 
  classifyCanvasUrl, 
  extractCourseId, 
  groupUrlsByType, 
  generateStatistics 
} = require('./utils/url-classifier.js');
const { extractAssignment } = require('./extractors/assignment-extractor.js');
const { extractModules } = require('./extractors/module-extractor.js');
const { extractFiles, extractFileMetadata } = require('./extractors/file-extractor.js');
const { extractPage } = require('./extractors/page-extractor.js');
const { extractAnnouncement } = require('./extractors/announcement-extractor.js');
const { extractAnnouncementsFromList } = require('./extractors/announcements-list-extractor.js');
const { extractDiscussion } = require('./extractors/discussion-extractor.js');
const { extractQuiz } = require('./extractors/quiz-extractor.js');
const { extractSyllabus } = require('./extractors/syllabus-extractor.js');
const { downloadFile, organizeDownloadPath, sanitizeFilename } = require('./downloaders/file-downloader.js');
const {
  fetchCourseFolders
} = require('./utils/files-api.js');
const pLimitModule = require('p-limit');
const pLimit = pLimitModule.default || pLimitModule;

// Configuration
const CANVAS_URL = process.env.CANVAS_URL || 'https://canvas.colorado.edu';
const COURSE_ID = process.env.COURSE_ID || null;
const EXTRACT_COURSES_ENV = process.env.EXTRACT_COURSES || null; // 'all' or comma-separated course IDs
const EXTRACT_COURSES = EXTRACT_COURSES_ENV; // Keep for backward compatibility in other parts of code
const HEADLESS = process.env.HEADLESS !== 'false';
const FAST_MAP = process.env.FAST_MAP !== 'false'; // Default to FAST_MAP mode (set FAST_MAP=false to disable)
const ENABLE_HEAD_CHECKS = process.env.ENABLE_HEAD_CHECKS !== 'false'; // Lightweight HEAD checks enabled unless explicitly disabled
const HEAD_CHECK_TIMEOUT_MS = parseInt(process.env.HEAD_CHECK_TIMEOUT_MS || '4000', 10);
// Maximum concurrency for optimal performance
// Optimized for AWS r7i.2xlarge: 8 vCPUs, 64GB RAM
// Can handle high concurrency with proper resource management
const isMultiCourse = EXTRACT_COURSES_ENV && EXTRACT_COURSES_ENV !== 'false';
const AWS_INSTANCE_TYPE = process.env.AWS_INSTANCE_TYPE || '';
const isAWS = AWS_INSTANCE_TYPE.includes('r7i') || process.env.AWS_INSTANCE_ID;
// Maximum concurrency: AWS instances can handle much higher concurrency
// r7i.2xlarge: 8 vCPUs can handle 100+ concurrent requests with proper optimization
const MAX_CONCURRENCY = parseInt(process.env.MAX_CONCURRENCY) || (
  isAWS 
    ? (isMultiCourse ? 100 : 80)  // Increased for maximum speed
    : (isMultiCourse ? 50 : 40)   // Increased for local
);
const MAX_REQUESTS_PER_CRAWL = parseInt(process.env.MAX_REQUESTS_PER_CRAWL) || (FAST_MAP ? 200 : 1000);
const MAX_REQUEST_RETRIES = parseInt(process.env.MAX_REQUEST_RETRIES) || 3;
const MAX_DEPTH = parseInt(process.env.MAX_DEPTH) || (FAST_MAP ? 3 : Infinity); // Limit depth for fast mode (increased to 3 for better coverage)
const ACCESS_DENIED_SELECTORS = [
  '#unauthorized_message.ic-Error-page',
  '#unauthorized_message',
  '.ic-Error-page',
  '.ic-Error-img',
  '.ic-Error-page--access-denied',
  '.ic-Error-page__headline'
];
const CONTENT_READY_SELECTORS = [
  '#content',
  '.ic-app-main-content',
  '.ic-app-nav-toggle-and-crumbs',
  'main[role="main"]',
  'div.ic-Layout-wrapper',
  '#application'
];
const MAX_AUTH_RETRIES = parseInt(process.env.MAX_AUTH_RETRIES) || 3;
const AUTH_STATUS_CODES = [401, 403];
const BLOCKED_STATUS_CODES = [429, 503];

// FERPA safeguards: never crawl student-specific grade or submission views
const STUDENT_DATA_PATH_PATTERNS = [
  /\/courses\/\d+\/grades(?:\/|$)/i,
  /\/courses\/\d+\/gradebook(?:\/|$)/i,
  /\/courses\/\d+\/gradebook2?(?:\/|$)/i,
  /\/courses\/\d+\/assignments\/\d+\/submissions/i,
  /\/submissions\/\d+/i,
  /\/speed_grader/i
];

function isStudentDataUrl(targetUrl) {
  if (!targetUrl) return false;
  try {
    const parsed = new URL(targetUrl, CANVAS_URL);
    const pathname = parsed.pathname.toLowerCase();
    return STUDENT_DATA_PATH_PATTERNS.some((pattern) => pattern.test(pathname));
  } catch {
    const normalized = String(targetUrl).split('?')[0].toLowerCase();
    return STUDENT_DATA_PATH_PATTERNS.some((pattern) => pattern.test(normalized));
  }
}

function filterStudentSafeUrls(urls = []) {
  return (urls || []).filter((link) => link && !isStudentDataUrl(link));
}

const EXTRACTION_TIMEZONE = process.env.EXTRACTION_TIMEZONE || 'America/Denver'; // MST/MDT

// Cookie file path
const COOKIE_FILE = path.join(__dirname, '..', '..', 'data', 'auth', 'canvas-cookies.json');

// Global extraction folder - set at start of main()
let EXTRACTION_FOLDER = null;

/**
 * Format a timestamp string for the configured timezone (defaults to MST/MDT).
 * Output: YYYY-MM-DDTHH-MM-SS
 */
function formatTimestampForTimezone(date, timeZone) {
  const dtf = new Intl.DateTimeFormat('en-US', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false
  });
  const parts = dtf.formatToParts(date).reduce((acc, part) => {
    if (part.type !== 'literal') {
      acc[part.type] = part.value;
    }
    return acc;
  }, {});
  return `${parts.year}-${parts.month}-${parts.day}T${parts.hour}-${parts.minute}-${parts.second}`;
}

/**
 * Extracts course name and code from a Canvas course page
 * @param {Object} page - Playwright page object
 * @returns {Promise<Object>} - Object with courseName and courseCode
 */
async function extractCourseInfo(page) {
  try {
    const courseInfo = await page.evaluate(() => {
      const info = {
        courseName: null,
        courseCode: null
      };

      // Strategy 1: Try window.ENV first (most reliable source)
      // Canvas stores course data in window.ENV.COURSE or window.ENV.course
      if (window && window.ENV) {
        const env = window.ENV;
        
        // Check for course name in various ENV locations
        if (env.COURSE && env.COURSE.name) {
          info.courseName = env.COURSE.name.trim();
        } else if (env.course && env.course.name) {
          info.courseName = env.course.name.trim();
        } else if (env.COURSE_NAME) {
          info.courseName = env.COURSE_NAME.trim();
        } else if (env.course_name) {
          info.courseName = env.course_name.trim();
        }
        
        // Check for course code
        if (env.COURSE && env.COURSE.course_code) {
          info.courseCode = env.COURSE.course_code.trim();
        } else if (env.course && env.course.course_code) {
          info.courseCode = env.course.course_code.trim();
        } else if (env.COURSE_CODE) {
          info.courseCode = env.COURSE_CODE.trim();
        } else if (env.course_code) {
          info.courseCode = env.course_code.trim();
        }
        
        // If we got the full course name but no code, try to extract code from name
        // Canvas often stores full name like "ACCT 3220-004: Corp 1 (Jeremiah)"
        // Format is typically: "Course Code: Course Name" or "Course Name: Course Code"
        // We need to determine which is which - usually the code comes first and looks like "XXX 1234-001"
        if (info.courseName && !info.courseCode && info.courseName.includes(':')) {
          const parts = info.courseName.split(':').map(s => s.trim());
          if (parts.length >= 2) {
            // Check if first part looks like a course code (e.g., "ACCT 3220-004", "PSCI 2223-100")
            // Pattern: letters, space, numbers, optional dash and numbers
            const codePattern = /^[A-Z]{2,}\s+\d{4}(?:-\d{3})?$/;
            if (codePattern.test(parts[0])) {
              // First part is the course code
              info.courseCode = parts[0];
              info.courseName = parts.slice(1).join(': ').trim();
            } else {
              // First part might be the name, second might be code
              // Or it's already correctly formatted
              // Keep the full name as courseName and try to extract code from second part
              if (codePattern.test(parts[1])) {
                info.courseCode = parts[1];
                info.courseName = parts[0];
              } else {
                // Can't determine, keep full name
                info.courseName = info.courseName;
              }
            }
          }
        }
      }

      // Strategy 2: Try to find course name from breadcrumbs (often more reliable than title)
      if (!info.courseName) {
        const breadcrumb = document.querySelector('.breadcrumbs a:last-child, nav[aria-label="breadcrumbs"] a:last-child, [data-testid="breadcrumb"]:last-child');
        if (breadcrumb) {
          const text = breadcrumb.textContent.trim();
          if (text && !text.includes('Home') && !text.includes('Courses') && !text.includes('Dashboard')) {
            // Canvas breadcrumbs often have format: "Course Name: Course Code" or just "Course Name"
            if (text.includes(':')) {
              const parts = text.split(':').map(s => s.trim());
              // If we don't have courseName yet, use the full text
              if (!info.courseName) {
                info.courseName = text;
              }
              // If we have parts, first might be code, rest is name
              if (parts.length >= 2 && !info.courseCode) {
                info.courseCode = parts[0];
                info.courseName = parts.slice(1).join(': ').trim() || parts[0];
              }
            } else {
              info.courseName = text;
            }
          }
        }
      }

      // Strategy 3: Try to find course name from page title (less reliable)
      if (!info.courseName) {
        const pageTitle = document.title;
        if (pageTitle && !pageTitle.includes('Canvas')) {
          // Canvas page titles often have format: "Course Name: Course Code - Canvas"
          // or "Course Name - Course Code - Canvas"
          const titleMatch = pageTitle.match(/^(.+?)(?:\s*-\s*Canvas|\s*:\s*([^:]+?)(?:\s*-\s*Canvas)?)$/);
          if (titleMatch) {
            info.courseName = titleMatch[1].trim();
            if (titleMatch[2]) {
              info.courseCode = titleMatch[2].trim();
            }
          }
        }
      }

      // Strategy 4: Try to find course name from h1 or h2 (fallback)
      if (!info.courseName) {
        const headingSelectors = ['h1', 'h2', '.course-name', '.course-title', '[data-testid="course-name"]'];
        for (const selector of headingSelectors) {
          const el = document.querySelector(selector);
          if (el) {
            const text = el.textContent.trim();
            if (text && !text.includes('Canvas') && !text.includes('Loading')) {
              // Check if it contains a colon (Course Name: Course Code)
              if (text.includes(':')) {
                const parts = text.split(':').map(s => s.trim());
                info.courseName = parts[0];
                if (parts.length > 1 && !info.courseCode) {
                  info.courseCode = parts.slice(1).join(':').trim();
                }
              } else {
                info.courseName = text;
              }
              break;
            }
          }
        }
      }

      // Strategy 5: Try to find course code separately if not found
      if (!info.courseCode) {
        const codeSelectors = ['.course-code', '.course-number', '[data-testid="course-code"]'];
        for (const selector of codeSelectors) {
          const el = document.querySelector(selector);
          if (el) {
            info.courseCode = el.textContent.trim();
            break;
          }
        }
      }

      return info;
    });

    return courseInfo;
  } catch (error) {
    console.warn(`⚠️  Could not extract course info: ${error.message}`);
    return { courseName: null, courseCode: null };
  }
}

/**
 * Formats course name for folder naming: "Course Name:  COURSE_CODE"
 * @param {string} courseName - The course name
 * @param {string} courseCode - The course code
 * @param {string} courseId - Fallback to courseId if name/code not available
 * @returns {string} - Formatted course name safe for filesystem
 */
function formatCourseFolderName(courseName, courseCode, courseId) {
  // Sanitize for filesystem (remove invalid characters)
  const sanitize = (str) => {
    if (!str) return '';
    return str
      .replace(/[<>:"/\\|?*]/g, '') // Remove invalid filesystem characters
      .replace(/\s+/g, ' ') // Normalize whitespace
      .trim();
  };

  let folderName = '';
  
  if (courseName && courseCode) {
    folderName = `${sanitize(courseName)}:  ${sanitize(courseCode)}`;
  } else if (courseName) {
    folderName = sanitize(courseName);
  } else if (courseCode) {
    folderName = sanitize(courseCode);
  } else {
    // Fallback to courseId if no name/code available
    folderName = `course-${courseId}`;
  }

  // Ensure it's not too long (filesystem limit)
  if (folderName.length > 200) {
    folderName = folderName.substring(0, 197) + '...';
  }

  return folderName;
}

/**
 * Get or create the extraction folder name and set CRAWLEE_STORAGE_DIR
 * Format: extraction-{timestamp} (with optional -NN suffix if collisions occur)
 * Creates a unique folder for each extraction run while keeping names predictable
 * IMPORTANT: This also sets CRAWLEE_STORAGE_DIR to point to the extraction folder
 * so that Crawlee stores all datasets within the timestamped folder
 * @returns {string} - Extraction folder name
 */
function getExtractionFolder() {
  // If already set, return it (for consistency within a single run)
  if (EXTRACTION_FOLDER) {
    return EXTRACTION_FOLDER;
  }
  
  // Create folder name with timestamp only (no random suffix)
  const dateStr = formatTimestampForTimezone(new Date(), EXTRACTION_TIMEZONE);
  let folderName = `extraction-${dateStr}`;
  let extractionPath = path.join(__dirname, '..', '..', 'storage', 'datasets', folderName);
  let counter = 1;
  while (fs.existsSync(extractionPath)) {
    folderName = `extraction-${dateStr}-${String(counter).padStart(2, '0')}`;
    extractionPath = path.join(__dirname, '..', '..', 'storage', 'datasets', folderName);
    counter += 1;
  }
  
  // Ensure the folder exists
  if (!fs.existsSync(extractionPath)) {
    fs.mkdirSync(extractionPath, { recursive: true });
    // Create subdirectories expected by Crawlee/runtime
    fs.mkdirSync(path.join(extractionPath, 'mapping'), { recursive: true });
    fs.mkdirSync(path.join(extractionPath, 'courses'), { recursive: true });
    fs.mkdirSync(path.join(extractionPath, 'request_queues'), { recursive: true });
    fs.mkdirSync(path.join(extractionPath, 'key_value_stores'), { recursive: true });
  }
  
  // CRITICAL: Set CRAWLEE_STORAGE_DIR to the extraction folder
  // This ensures Crawlee stores all datasets within the timestamped folder
  process.env.CRAWLEE_STORAGE_DIR = extractionPath;

  try {
    const trackerFile = path.join(__dirname, '..', '..', 'storage', 'latest-extraction-folder.json');
    fs.writeFileSync(trackerFile, JSON.stringify({
      folder: folderName,
      path: `storage/datasets/${folderName}`,
      updatedAt: new Date().toISOString()
    }, null, 2));
  } catch (trackerError) {
    console.warn('⚠️  Could not write latest extraction folder tracker file:', trackerError.message);
  }
  
  // Cache it for this run
  EXTRACTION_FOLDER = folderName;
  
  return folderName;
}

// No cookie caching - always load fresh

// Context cookie tracking - track which contexts have cookies injected
const contextCookieMap = new WeakMap();

const AUTH_FAILURE_THRESHOLD = parseInt(process.env.AUTH_FAILURE_THRESHOLD) || 10;
const MAX_AUTH_RECOVERY_ATTEMPTS = parseInt(process.env.MAX_AUTH_RECOVERY_ATTEMPTS) || 3;

class AuthenticationLostError extends Error {
  constructor(message, metadata = {}) {
    super(message);
    this.name = 'AuthenticationLostError';
    this.metadata = metadata;
  }
}

const authStates = new Map();
let cookieRefreshPromise = null;

function getAuthState(courseId) {
  if (!courseId) {
    return {
      recordSuccess: () => {},
      recordFailure: () => {}
    };
  }
  if (!authStates.has(courseId)) {
    authStates.set(courseId, createAuthState(courseId));
  }
  return authStates.get(courseId);
}

function createAuthState(courseId) {
  return {
    courseId,
    attemptId: 0,
    consecutiveFailures: 0,
    failureThreshold: AUTH_FAILURE_THRESHOLD,
    hadSuccessThisAttempt: false,
    lastFailureReason: null,
    startAttempt(attemptNumber) {
      this.attemptId = attemptNumber;
      this.consecutiveFailures = 0;
      this.hadSuccessThisAttempt = false;
      this.lastFailureReason = null;
    },
    recordSuccess(context = 'unknown') {
      this.consecutiveFailures = 0;
      this.hadSuccessThisAttempt = true;
      this.lastFailureReason = null;
      if (process.env.DEBUG_AUTH === 'true') {
        console.log(`   🔐 Auth success recorded (${context}) for course ${this.courseId}`);
      }
    },
    recordFailure(reason, meta = {}) {
      this.consecutiveFailures += 1;
      this.lastFailureReason = reason;
      const details = {
        courseId: this.courseId,
        attemptId: this.attemptId,
        consecutiveFailures: this.consecutiveFailures,
        reason,
        ...meta
      };
      console.warn(`   ⚠️  Authentication warning (${this.consecutiveFailures}/${this.failureThreshold}) for course ${this.courseId}: ${reason}`);
      if (this.consecutiveFailures >= this.failureThreshold) {
        throw new AuthenticationLostError(`Authentication lost: ${reason}`, details);
      }
    },
    resetAfterRefresh() {
      this.consecutiveFailures = 0;
      this.lastFailureReason = null;
      this.hadSuccessThisAttempt = false;
    }
  };
}

function isAuthenticationLostError(error) {
  return error instanceof AuthenticationLostError;
}

async function promptForCookieRefresh(reason, courseId) {
  if (!cookieRefreshPromise) {
    cookieRefreshPromise = (async () => {
      console.log('\n=====================================');
      console.log('🔄 Authentication refresh required');
      if (courseId) {
        console.log(`   Course: ${courseId}`);
      }
      if (reason) {
        console.log(`   Reason: ${reason}`);
      }
      console.log('   Opening browser for fresh login...');
      console.log('=====================================\n');
      const extracted = await runCookieExtraction();
      if (!extracted) {
        throw new Error('Cookie refresh failed. Could not recover authentication.');
      }
      await loadCookies(false);
      console.log('\n✅ Cookies refreshed successfully. Resuming extraction...\n');
    })().finally(() => {
      cookieRefreshPromise = null;
    });
  }
  return cookieRefreshPromise;
}

/**
 * Fast detection of Canvas "Access Denied" page
 * Checks for the specific DOM structure that Canvas uses for 401/403 errors
 * @param {Object} page - Playwright page object
 * @returns {Promise<boolean>} - True if Access Denied page is detected
 */
async function detectAccessDeniedPage(page) {
  try {
    // Check for the specific Canvas "Access Denied" page structure
    // Canvas uses: div#unauthorized_message.ic-Error-page
    const hasUnauthorizedMessage = await page.evaluate(() => {
      // Check for the specific element
      const unauthorizedDiv = document.querySelector('#unauthorized_message.ic-Error-page');
      if (unauthorizedDiv) return true;
      
      // Also check for the error page class
      const errorPage = document.querySelector('.ic-Error-page');
      if (errorPage) {
        // Verify it contains "Access Denied" text
        const text = errorPage.textContent || '';
        if (text.includes('Access Denied') || text.includes("You don't have access")) {
          return true;
        }
      }
      
      // Check page title
      const pageTitle = document.title || '';
      if (pageTitle.includes('Access Denied') || pageTitle.includes('Unauthorized')) {
        return true;
      }
      
      // Check body text for access denied messages
      const bodyText = document.body?.textContent || '';
      if (bodyText.includes('Access Denied') && bodyText.includes("You don't have access to view this resource")) {
        return true;
      }
      
      return false;
    }).catch(() => false);
    
    return hasUnauthorizedMessage;
  } catch (error) {
    return false;
  }
}

/**
 * Waits for either an access denied indicator or normal Canvas content to appear.
 * Uses a single page.waitForFunction call so we don't spin up multiple waiters.
 * @param {import('playwright-core').Page} page
 * @param {number} timeout
 * @returns {Promise<{type: 'accessDenied' | 'content' | 'timeout', selector?: string} | null>}
 */
async function waitForAccessDeniedOrContent(page, timeout = 4000) {
  try {
    const handle = await page.waitForFunction(
      ({ accessDeniedSelectors, contentSelectors }) => {
        const accessSelector = accessDeniedSelectors.find(sel => document.querySelector(sel));
        if (accessSelector) {
          return { type: 'accessDenied', selector: accessSelector };
        }
        const contentSelector = contentSelectors.find(sel => document.querySelector(sel));
        if (contentSelector) {
          return { type: 'content', selector: contentSelector };
        }
        return null;
      },
      { timeout, polling: 200 },
      { accessDeniedSelectors: ACCESS_DENIED_SELECTORS, contentSelectors: CONTENT_READY_SELECTORS }
    );
    const value = await handle.jsonValue();
    return value;
  } catch (error) {
    if (error.message && error.message.includes('Timeout')) {
      return { type: 'timeout' };
    }
    return null;
  }
}

function buildCookieHeaderFromArray(cookies = []) {
  if (!cookies || cookies.length === 0) return '';
  return cookies.map(cookie => `${cookie.name}=${cookie.value}`).join('; ');
}

/**
 * Performs a lightweight HEAD request using Playwright's request context to quickly check auth.
 * @param {import('playwright-core').Page} page
 * @param {string} url
 * @returns {Promise<{status?: number, unauthorized?: boolean, ok?: boolean, error?: Error}>}
 */
async function quickHeadAuthorizationCheck(page, url) {
  try {
    const context = page.context();
    const cookies = await context.cookies();
    const cookieHeader = buildCookieHeaderFromArray(cookies);
    const headers = {
      'User-Agent': 'Canvas-Wrapper-HeadCheck'
    };
    if (cookieHeader) {
      headers.Cookie = cookieHeader;
    }
    const response = await page.request.fetch(url, {
      method: 'HEAD',
      headers,
      timeout: HEAD_CHECK_TIMEOUT_MS
    });
    const status = response.status();
    return {
      status,
      unauthorized: AUTH_STATUS_CODES.includes(status),
      ok: status >= 200 && status < 400
    };
  } catch (error) {
    return { error };
  }
}

function shouldDropAfterHeadCheck(link, classification, headProbe, dropOnUnauthorized) {
  if (!headProbe || typeof headProbe.status !== 'number') {
    return { shouldDrop: false };
  }

  const status = headProbe.status;
  const isUnauthorized = AUTH_STATUS_CODES.includes(status);
  const isCanvasCourseLink = classification && link.includes('/courses/');

  if (isUnauthorized) {
    const isAuthEndpoint = /fedauth|sso|login|logout|\/profile\/SAML2\//i.test(link);
    if (dropOnUnauthorized && (isAuthEndpoint || !isCanvasCourseLink)) {
      return { shouldDrop: true, reason: 'unauthorized' };
    }
    return { shouldDrop: false };
  }

  if ((status === 404 || status === 410) && !classification) {
    return { shouldDrop: true, reason: 'not-found' };
  }

  if (status >= 500) {
    return { shouldDrop: false };
  }

  // For other 4xx statuses keep the link unless it is clearly non-course.
  if (status >= 400 && !classification) {
    return { shouldDrop: true, reason: `http-${status}` };
  }

  return { shouldDrop: false };
}

/**
 * Marks a Crawlee request as unauthorized so the crawler stops retrying it.
 * @param {import('crawlee').Request} request
 * @param {string} reason
 */
function markRequestAsUnauthorized(request, reason = 'Access Denied') {
  if (!request) {
    return;
  }

  const currentRetryCount = request.retryCount || 0;
  const attemptsSoFar = currentRetryCount + 1;
  const reachedAuthRetryLimit = attemptsSoFar >= MAX_AUTH_RETRIES;

  if (reachedAuthRetryLimit) {
    request.noRetry = true;
  }

  request.userData = {
    ...request.userData,
    authError: true,
    authAttempts: attemptsSoFar,
    authErrorReason: reason,
    noRetry: reachedAuthRetryLimit
  };
}

/**
 * Validates that cookies exist and are valid
 * @param {Array} cookies - Array of cookie objects
 * @returns {Object} - { valid: boolean, reason: string }
 */
function validateCookies(cookies) {
  if (!cookies || !Array.isArray(cookies) || cookies.length === 0) {
    return { valid: false, reason: 'No cookies found in file' };
  }

  // Check for essential Canvas cookies
  const hasSessionCookie = cookies.some(c => 
    c.name.includes('session') || 
    c.name.includes('canvas') || 
    c.name.includes('_session')
  );
  
  const hasAuthCookie = cookies.some(c => 
    c.domain.includes('canvas') || 
    c.domain.includes('colorado.edu') ||
    c.domain.includes('instructure.com')
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

  return { valid: true, reason: null };
}

/**
 * Runs the cookie extraction script
 * @returns {Promise<boolean>} - True if extraction succeeded
 */
async function runCookieExtraction() {
  const { spawn } = require('child_process');
  
  console.log('\n🔐 No valid cookies detected. Running cookie extraction...');
  console.log('=====================================');
  console.log('📋 This will:');
  console.log('   1. Open a browser window');
  console.log('   2. Navigate to Canvas login');
  console.log('   3. Wait for you to complete login');
  console.log('   4. Extract and save cookies');
  console.log('=====================================\n');

  return new Promise((resolve) => {
    const extractScript = path.join(__dirname, '..', 'core', 'extract-cookies.js');
    const child = spawn('node', [extractScript], {
      stdio: 'inherit',
      cwd: path.join(__dirname, '..', '..')
    });

    child.on('close', (code) => {
      if (code === 0) {
        console.log('\n✅ Cookie extraction completed successfully');
        resolve(true);
      } else {
        console.log(`\n❌ Cookie extraction failed with exit code ${code}`);
        resolve(false);
      }
    });

    child.on('error', (error) => {
      console.error(`\n❌ Failed to run cookie extraction: ${error.message}`);
      resolve(false);
    });
  });
}

/**
 * Loads cookies from the cookie file (always fresh, no caching)
 * @param {boolean} allowRetry - If true, will attempt to extract cookies if invalid
 * @returns {Array} - Array of cookie objects
 */
async function loadCookies(allowRetry = false) {
  // Check if file exists
  if (!fs.existsSync(COOKIE_FILE)) {
    console.error(`\n❌ Cookie file not found: ${COOKIE_FILE}`);
    console.error(`\n🔐 No valid cookies detected.`);
    
    if (allowRetry) {
      const extracted = await runCookieExtraction();
      if (extracted) {
        // Retry loading after extraction
        return await loadCookies(false); // Don't retry again to avoid infinite loop
      }
    }
    
    console.error(`\n💡 Please run: npm run auth:extract-cookies`);
    throw new Error(`Cookie file not found: ${COOKIE_FILE}\nPlease run: npm run auth:extract-cookies`);
  }

  let cookieData;
  try {
    cookieData = JSON.parse(fs.readFileSync(COOKIE_FILE, 'utf8'));
  } catch (error) {
    console.error(`\n❌ Failed to parse cookie file: ${error.message}`);
    throw new Error(`Invalid cookie file format: ${error.message}`);
  }
  
  if (!cookieData.cookies || !Array.isArray(cookieData.cookies)) {
    console.error(`\n❌ Invalid cookie file format: cookies array not found`);
    throw new Error('Invalid cookie file format: cookies array not found');
  }

  // Validate cookies
  const validation = validateCookies(cookieData.cookies);
  
  if (!validation.valid) {
    console.error(`\n❌ Cookie validation failed: ${validation.reason}`);
    console.error(`\n🔐 No valid cookies detected.`);
    
    // Check if validation metadata says invalid
    if (cookieData.validation && !cookieData.validation.isValid) {
      console.error(`   Cookies in file are marked as invalid`);
    }
    
    if (allowRetry) {
      const extracted = await runCookieExtraction();
      if (extracted) {
        // Retry loading after extraction
        return await loadCookies(false); // Don't retry again to avoid infinite loop
      }
    }
    
    console.error(`\n💡 Please run: npm run auth:extract-cookies`);
    throw new Error(`No valid cookies detected: ${validation.reason}\nPlease run: npm run auth:extract-cookies`);
  }

  console.log(`✅ Loaded ${cookieData.cookies.length} valid cookies from ${COOKIE_FILE}`);
  
  return cookieData.cookies;
}

/**
 * Checks if cookies are already injected in a context
 * @param {Object} context - Playwright browser context
 * @returns {boolean} - True if cookies are already injected
 */
async function hasCookiesInContext(context) {
  if (contextCookieMap.has(context)) {
    return true;
  }
  
  // Check if context has cookies
  const existingCookies = await context.cookies();
  const hasCanvasCookies = existingCookies.some(c => 
    c.domain.includes('canvas') || c.domain.includes('colorado.edu') || c.domain.includes('canvaslms.com')
  );
  
  if (hasCanvasCookies && existingCookies.length > 0) {
    contextCookieMap.set(context, true);
    return true;
  }
  
  return false;
}

/**
 * Injects cookies into context only if needed
 * @param {Object} context - Playwright browser context
 * @param {Object} log - Logger instance
 * @returns {Promise<boolean>} - True if cookies were injected, false if already present
 */
async function injectCookiesIfNeeded(context, log) {
  // Check if cookies are already in this context
  if (await hasCookiesInContext(context)) {
    return false; // Cookies already present
  }

  try {
    const cookies = await loadCookies(false); // Don't retry here, already validated at startup
    
    // Set domain for cookies if not already set
    const cookiesWithDomain = cookies.map(cookie => ({
      ...cookie,
      domain: cookie.domain || new URL(CANVAS_URL).hostname
    }));
    
    // Inject cookies
    await context.addCookies(cookiesWithDomain);
    contextCookieMap.set(context, true);
    
    if (log) {
      log.debug(`✅ Injected ${cookiesWithDomain.length} cookies to browser context`);
    }
    
    return true; // Cookies were injected
  } catch (cookieError) {
    if (log) {
      log.warn(`Failed to inject cookies: ${cookieError.message}`);
    }
    return false;
  }
}

/**
 * Phase 7: Discover all enrolled courses
 * Scrapes Canvas dashboard/courses page to get list of all course IDs
 */
async function discoverAllCourses() {
  console.log('\n🔍 Phase 7: Discovering favorited courses...');
  console.log(`   Canvas URL: ${CANVAS_URL}`);
  console.log(`   Filter: Only favorited courses (⭐)`);
  console.log(`   Started at: ${new Date().toISOString()}`);
  
  const cookies = await loadCookies(false); // Don't retry here, already validated at startup
  const courseIds = new Set();
  
  // Only check the main courses page (where favorited courses are clearly displayed)
  const courseListUrls = [
    `${CANVAS_URL}/courses` // Main courses page
  ];
  
  const crawler = new PlaywrightCrawler({
    async requestHandler({ request, page, log }) {
      const url = request.loadedUrl || request.url;
      log.info(`Discovering courses from: ${url}`);
      
      try {
        // Wait for page to load and course table to appear
        await page.waitForLoadState('domcontentloaded', { timeout: 10000 }).catch(() => {});
        // Wait for course list table to appear (if it exists)
        await page.waitForSelector('#my_courses_table, table.course-list-table, table[class*="course-list-table"]', { timeout: 5000 }).catch(() => {});
        await page.waitForTimeout(1500); // Give time for dynamic content and star states to render
        
        // Extract course IDs from favorited courses only
        const foundCourseIds = await page.evaluate(({ baseUrl }) => {
          const courses = new Set();
          
          // Method 1: Find favorited courses from the course list table
          // Look for the course list table: id="my_courses_table" or class containing "course-list-table"
          const courseTable = document.querySelector('#my_courses_table, table.course-list-table, table[class*="course-list-table"]');
          
          if (courseTable) {
            // Find all course rows
            const courseRows = courseTable.querySelectorAll('tr.course-list-table-row, tr[class*="course-list-table-row"]');
            
            courseRows.forEach(row => {
              // Check if the course is favorited by looking at the star column
              const starColumn = row.querySelector('td.course-list-star-column, td[class*="course-list-star-column"]');
              
              if (starColumn) {
                // Look for the favorite icon
                // Favorited: <i class="course-list-favorite-icon icon-star"></i>
                // Unfavorited: <i class="course-list-favorite-icon icon-star-light"></i>
                // Both have course-list-favorite-icon, but favorited has icon-star (not icon-star-light)
                const favoriteIcon = starColumn.querySelector('i.course-list-favorite-icon, i[class*="course-list-favorite-icon"]');
                
                let isFavorited = false;
                
                if (favoriteIcon) {
                  const iconClasses = favoriteIcon.className || '';
                  
                  // Check if it has the course-list-favorite-icon class
                  if (iconClasses.includes('course-list-favorite-icon')) {
                    // Verify it's visible (not hidden by CSS)
                    const style = window.getComputedStyle(favoriteIcon);
                    const isVisible = style.display !== 'none' && 
                                     style.visibility !== 'hidden' && 
                                     style.opacity !== '0';
                    
                    if (isVisible) {
                      // Favorited has "icon-star", unfavorited has "icon-star-light"
                      // Check for icon-star and NOT icon-star-light
                      if (iconClasses.includes('icon-star') && !iconClasses.includes('icon-star-light')) {
                        isFavorited = true;
                      }
                      // Also check aria-pressed on parent button as backup
                      const parentButton = favoriteIcon.closest('button');
                      if (parentButton && parentButton.getAttribute('aria-pressed') === 'true') {
                        isFavorited = true;
                      }
                    }
                  }
                }
                
                // Only extract course ID if favorited
                if (isFavorited) {
                  // Find course link in the same row
                  const courseLink = row.querySelector('a[href*="/courses/"]');
                  if (courseLink) {
                    const href = courseLink.getAttribute('href');
                    if (href) {
                      const match = href.match(/\/courses\/(\d+)(?:\/|$|\?)/);
                      if (match && match[1]) {
                        courses.add(match[1]);
                      }
                    }
                  }
                  
                  // Also check for data-course-id attribute on the row
                  const courseId = row.getAttribute('data-course-id') || 
                                 row.querySelector('[data-course-id]')?.getAttribute('data-course-id');
                  if (courseId && /^\d+$/.test(courseId)) {
                    courses.add(courseId);
                  }
                }
              }
            });
          }
          
          // Method 2: Fallback - look for favorited course cards/items (if table method didn't work)
          if (courses.size === 0) {
            // Look for course cards with favorited state
            const courseCards = document.querySelectorAll('[data-course-id], [class*="course-card"], [class*="course"]');
            courseCards.forEach(card => {
              // Check if this card has a favorited star
              const starElement = card.querySelector('[class*="icon-star-fill"], [aria-pressed="true"], [class*="star-fill"]');
              if (starElement) {
                const courseId = card.getAttribute('data-course-id') || 
                               card.getAttribute('data-id') ||
                               card.id.match(/course[_-]?(\d+)/)?.[1];
                if (courseId && /^\d+$/.test(courseId)) {
                  courses.add(courseId);
                }
              }
            });
          }
          
          return Array.from(courses);
        }, { baseUrl: CANVAS_URL });
        
        foundCourseIds.forEach(id => courseIds.add(id));
        log.info(`Found ${foundCourseIds.length} courses from ${url} (total: ${courseIds.size})`);
        
      } catch (error) {
        console.error(`Error discovering courses from ${url}: ${error.message}`);
      }
    },
    maxConcurrency: 1, // Process one page at a time for discovery
    maxRequestsPerCrawl: courseListUrls.length,
    maxRequestRetries: 2,
    headless: HEADLESS,
    retryOnBlocked: false,
    sessionPoolOptions: {
      blockedStatusCodes: BLOCKED_STATUS_CODES
    },
    launchContext: {
      launcher: chromium,
      launchOptions: {
        headless: HEADLESS,
        args: [
          '--disable-images',
          '--disable-plugins',
          '--disable-extensions',
        ],
      },
    },
    preNavigationHooks: [
      async ({ request, page, log }) => {
        // Only inject cookies if context doesn't already have them
        // This reduces overhead and avoids race conditions
        const context = page.context();
        await injectCookiesIfNeeded(context, log);
      }
    ],
  });
  
  await crawler.run(courseListUrls);
  
  const uniqueCourseIds = Array.from(courseIds).sort((a, b) => parseInt(a) - parseInt(b));
  
  console.log(`\n✅ Course Discovery Complete!`);
  console.log(`   Found ${uniqueCourseIds.length} favorited courses`);
  if (uniqueCourseIds.length > 0) {
    console.log(`   Course IDs: ${uniqueCourseIds.slice(0, 10).join(', ')}${uniqueCourseIds.length > 10 ? '...' : ''}`);
  } else {
    console.log(`   ⚠️  No favorited courses found. Make sure courses are favorited (starred) in Canvas.`);
  }
  
  return uniqueCourseIds;
}

/**
 * Phase 1: Mapping Mode - Discover and classify all URLs in a course
 */
async function runMappingPhase(courseId, options = {}) {
  const { authState = getAuthState(courseId) } = options;
  const startTime = Date.now();
  console.log('\n🗺️  Phase 1: Starting URL Mapping...');
  console.log(`   Course ID: ${courseId}`);
  console.log(`   Canvas URL: ${CANVAS_URL}`);
  console.log(`   Mode: ${FAST_MAP ? '⚡ FAST_MAP (preferred)' : '📊 FULL'}`);
  console.log(`   Files pipeline mode: ${FILES_PIPELINE_MODE}`);
  if (FAST_MAP) {
    console.log(`   Max Depth: ${MAX_DEPTH}, Max Requests: ${MAX_REQUESTS_PER_CRAWL}, Concurrency: ${MAX_CONCURRENCY}`);
  }
  console.log(`   Started at: ${new Date().toISOString()}`);

  const cookies = await loadCookies(false); // Don't retry here, already validated at startup
  const courseUrl = `${CANVAS_URL}/courses/${courseId}`;

  // Track discovered URLs and depth
  const discoveredUrls = new Set();
  const urlClassifications = {};
  const urlDepth = new Map(); // Track depth for each URL
  const depthStats = {
    maxDepth: 0,
    depthCounts: {}
  };
  const seededFilesFolders = new Set();
  const classificationTelemetry = { total: 0 };
  const unknownClassificationSamples = [];

  // Track course info for folder naming
  let courseInfo = { courseName: null, courseCode: null };
  let courseFolderName = null;

  // Create a named dataset for mapping
  // Dataset name is just 'mapping' since CRAWLEE_STORAGE_DIR is already set to the extraction folder
  const mappingDatasetName = 'mapping';
  const mappingDataset = await Dataset.open(mappingDatasetName);
  const filesDiscoveryDataset = await Dataset.open('files-discovery');
  const headCheckCache = new Map();

  const isFilesListUrl = (targetUrl) => {
    if (!targetUrl) return false;
    try {
      const normalized = new URL(targetUrl, CANVAS_URL).pathname.replace(/\/$/, '');
      return new RegExp(`/courses/${courseId}/files(?:/folder/[^/]+)?$`).test(normalized);
    } catch {
      const normalized = targetUrl.split('?')[0].replace(/\/$/, '');
      return normalized.includes(`/courses/${courseId}/files`) && !normalized.match(/\/files\/\d+/);
    }
  };

  const recordAccessDeniedLink = (linkUrl, depth, status, detection = 'head-check') => {
    if (!linkUrl || discoveredUrls.has(linkUrl) || isStudentDataUrl(linkUrl)) {
      return;
    }
    discoveredUrls.add(linkUrl);
    urlClassifications[linkUrl] = 'access-denied';
    mappingDataset.pushData({
      url: linkUrl,
      classification: 'access-denied',
      courseId,
      depth,
      discoveredAt: new Date().toISOString(),
      metadata: {
        detection,
        httpStatus: status || null
      }
    }).catch(() => {});
  };

  // Create a fresh RequestQueue for this course to avoid state issues
  const requestQueue = await RequestQueue.open(`mapping-${courseId}-${Date.now()}`);
  console.log(`   📋 Created fresh RequestQueue for course ${courseId}`);

  const crawler = new PlaywrightCrawler({
    requestQueue,
    async requestHandler({ request, page, enqueueLinks, log }) {
      const url = request.loadedUrl || request.url;
      if (isStudentDataUrl(url)) {
        log.info(`   🚫 Skipping student-specific page: ${url}`);
        return;
      }
      const performHeadCheckForLink = async (targetUrl) => {
        if (!ENABLE_HEAD_CHECKS) return null;
        if (!targetUrl || !targetUrl.startsWith(CANVAS_URL)) return null;
        if (!headCheckCache.has(targetUrl)) {
          headCheckCache.set(targetUrl, quickHeadAuthorizationCheck(page, targetUrl));
        }
        return headCheckCache.get(targetUrl);
      };
      const filterLinksWithHeadCheck = async (links, depth, detectionLabel = 'head-check', options = {}) => {
        const { dropOnUnauthorized = true } = options;
        const candidateLinks = filterStudentSafeUrls(Array.isArray(links) ? links : []);
        if (!ENABLE_HEAD_CHECKS || candidateLinks.length === 0) {
          return candidateLinks;
        }
        const safeLinks = [];
        for (const link of candidateLinks) {
          if (!link) {
            continue;
          }

          const classification = classifyCanvasUrl(link, courseId);
          const isCanvasHost = link.startsWith(CANVAS_URL);
          const shouldProbe = !classification || !isCanvasHost;

          if (!shouldProbe) {
            safeLinks.push(link);
            continue;
          }

          try {
            const headProbe = await quickHeadAuthorizationCheck(page, link);
            if (headProbe) {
              const drop = shouldDropAfterHeadCheck(link, classification, headProbe, dropOnUnauthorized);
              if (drop.shouldDrop) {
                if (drop.reason === 'unauthorized') {
                  recordAccessDeniedLink(link, depth, headProbe.status, detectionLabel);
                }
                log.debug(`   ⚠️  Skipping ${link} after HEAD check (${drop.reason || 'status ' + headProbe.status})`);
                continue;
              }
            }
          } catch (headErr) {
            log.debug(`   ⚠️  HEAD check error for ${link}: ${headErr.message}`);
          }

          safeLinks.push(link);
        }
        return safeLinks;
      };
      const trackAuthSuccess = () => {
        if (authState) {
          authState.recordSuccess(`mapping:${url}`);
        }
      };
      const trackAuthFailure = (reason) => {
        if (authState) {
          authState.recordFailure(reason, { url, phase: 'mapping' });
        }
      };
      
      // Calculate depth (number of redirects/hops from start)
      const currentDepth = request.userData?.depth || 0;
      urlDepth.set(url, currentDepth);
      depthStats.maxDepth = Math.max(depthStats.maxDepth, currentDepth);
      depthStats.depthCounts[currentDepth] = (depthStats.depthCounts[currentDepth] || 0) + 1;
      
      console.log(`   🔍 [Depth ${currentDepth}] Processing: ${url}`);
      log.info(`[Depth ${currentDepth}] Processing: ${url}`);

      // Extract course info on first visit to course home page (depth 0)
      if (currentDepth === 0 && url === courseUrl && !courseFolderName) {
        try {
          await page.waitForLoadState('domcontentloaded', { timeout: 5000 }).catch(() => {});
          await page.waitForTimeout(1000); // Wait for content to load
          const extractedInfo = await extractCourseInfo(page);
          if (extractedInfo.courseName || extractedInfo.courseCode) {
            courseInfo = extractedInfo;
            courseFolderName = formatCourseFolderName(extractedInfo.courseName, extractedInfo.courseCode, courseId);
            console.log(`   📚 Course info extracted: ${courseFolderName}`);
          }
        } catch (error) {
          console.warn(`   ⚠️  Could not extract course info: ${error.message}`);
        }
      }

      // Ensure Files tab is always visited at least once per course
      if (currentDepth === 0 && url === courseUrl && !seededFilesFolders.has(courseId)) {
        const filesRootUrl = `${courseUrl}/files`;
        try {
          const safeLinks = await filterLinksWithHeadCheck([filesRootUrl], currentDepth + 1, 'seed-files');
          if (safeLinks && safeLinks.length > 0) {
            await requestQueue.addRequest({
              url: safeLinks[0],
              userData: { depth: currentDepth + 1, isFilesFolder: true }
            });
            console.log(`   ➕ Queued Files tab for discovery: ${safeLinks[0]}`);
          }
        } catch (seedError) {
          log.debug(`Failed to enqueue Files tab for course ${courseId}: ${seedError.message}`);
        }
        seededFilesFolders.add(courseId);
      }

      // Fast 401 detection: check response status immediately after navigation
      let authErrorDetected = false;
      const responseHandler = (response) => {
        const status = response.status();
        const responseUrl = response.url();
        if (AUTH_STATUS_CODES.includes(status) && responseUrl === url) {
          authErrorDetected = true;
          markRequestAsUnauthorized(request, `HTTP ${status}`);
          console.log(`   ❌ Fast 401/403 detection for ${url} - failing immediately`);
          log.warn(`Authentication failed (HTTP ${status}) for ${url}`);
          trackAuthFailure(`HTTP ${status} for ${url}`);
        } else if (status === 200 && responseUrl === url) {
          trackAuthSuccess();
        }
      };
      page.on('response', responseHandler);

      // Ensure cookies are set before navigation (only if needed)
      const context = page.context();
      const cookiesInjected = await injectCookiesIfNeeded(context, log);
      if (cookiesInjected) {
        console.log(`   ✅ Cookies injected for ${url}`);
      }

      // Skip if we've exceeded max depth in fast mode
      if (FAST_MAP && currentDepth > MAX_DEPTH) {
        page.off('response', responseHandler);
        return;
      }
      
      // Check for auth error after initial load
      try {
        await page.waitForLoadState('domcontentloaded', { timeout: 3000 }).catch(() => {});
        
        // Fast detection: wait for either access denied indicators or normal Canvas content
        const earlySignal = await waitForAccessDeniedOrContent(page, 3500);
        if (earlySignal?.type === 'accessDenied') {
          page.off('response', responseHandler);
          markRequestAsUnauthorized(request, 'Access Denied (mapping fast check)');
          console.log(`   ❌ Access Denied page detected for ${url} - failing immediately`);
          log.warn(`Access Denied page detected for ${url} - skipping`);
          trackAuthFailure('Access Denied page (mapping fast check)');
          return; // Fail fast - don't process this URL
        }
        
        if (authErrorDetected) {
          page.off('response', responseHandler);
          trackAuthFailure('Authentication error detected before mapping content');
          console.log(`   ⚠️  Skipping ${url} due to authentication error`);
          return; // Fail fast - don't process this URL
        }
      } catch (error) {
        if (error.message && error.message.includes('Authentication failed')) {
          page.off('response', responseHandler);
          return; // Fail fast on auth error
        }
      }

      // Full extraction mode: use faster approach with domcontentloaded
      try {
        // Check for auth error before proceeding
        if (authErrorDetected) {
          page.off('response', responseHandler);
          return;
        }
        
        await page.waitForLoadState('domcontentloaded', { timeout: 2000 }).catch(() => {});
        
        // Fast detection: Check for Canvas "Access Denied" page
        const contentSignal = await waitForAccessDeniedOrContent(page, 3500);
        if (contentSignal?.type === 'accessDenied') {
          page.off('response', responseHandler);
          markRequestAsUnauthorized(request, 'Access Denied (mapping content)');
          console.log(`   ❌ Access Denied page detected for ${url} - failing immediately`);
          log.warn(`Access Denied page detected for ${url} - skipping`);
          trackAuthFailure('Access Denied page (mapping content)');
          return; // Fail fast
        } else if (!contentSignal) {
          const isAccessDenied = await detectAccessDeniedPage(page);
          if (isAccessDenied) {
            page.off('response', responseHandler);
            markRequestAsUnauthorized(request, 'Access Denied (mapping content)');
            console.log(`   ❌ Access Denied page detected for ${url} - failing immediately`);
            log.warn(`Access Denied page detected for ${url} - skipping`);
            trackAuthFailure('Access Denied page (mapping content)');
            return; // Fail fast
          }
        }
        
        // Check again after load
        if (authErrorDetected) {
          page.off('response', responseHandler);
          trackAuthFailure('Authentication error detected after mapping load');
          return;
        }
        
        await page.evaluate(() => {
          const expandButtons = document.querySelectorAll('[aria-expanded="false"], .ui-accordion-header, .collapsed, [class*="expand"], [class*="toggle"]');
          expandButtons.forEach(btn => {
            try {
              if (btn.offsetParent !== null) {
                btn.click();
              }
            } catch (e) {}
          });
        });
        await page.waitForTimeout(200);
      } catch (error) {
        if (error.message && error.message.includes('Authentication failed')) {
          page.off('response', responseHandler);
          return; // Fail fast
        }
        log.debug(`Could not expand sections on ${url}: ${error.message}`);
      } finally {
        // Clean up response handler
        try {
          page.off('response', responseHandler);
        } catch (e) {}
      }

      // Classify the current URL
      let classification = classifyCanvasUrl(url, courseId);
      
      // If this was marked as an announcement during link discovery, override classification
      if (request.userData?.isAnnouncement) {
        classification = 'announcement';
      }
      
      // Special handling: if we're on announcements page, classify it
      if (url.includes('/announcements') && !url.match(/\/announcements\/\d+/)) {
        classification = 'announcements-list';
      }

      if (isFilesListUrl(url)) {
        classification = 'files-list';
      }
      
      if (classification) {
        classificationTelemetry.total++;
        classificationTelemetry[classification] = (classificationTelemetry[classification] || 0) + 1;
        discoveredUrls.add(url);
        urlClassifications[url] = classification;
        
        // Batch writes for better performance (non-blocking)
        // Use Promise.resolve() to avoid blocking the main flow
        mappingDataset.pushData({
          url,
          classification,
          courseId,
          depth: currentDepth,
          discoveredAt: new Date().toISOString()
        }).catch(err => {
          log.debug(`Failed to write mapping data for ${url}: ${err.message}`);
        });
      } else {
        classificationTelemetry.total++;
        classificationTelemetry.unknown = (classificationTelemetry.unknown || 0) + 1;
        if (unknownClassificationSamples.length < 5) {
          unknownClassificationSamples.push(url);
        }
        log.debug(`   ⚠️  Unknown classification for ${url}`);
      }

      // Discover subfolders on files pages during mapping
      if (classification === 'files-list' || (url.includes('/files') && url.match(/\/courses\/\d+\/files/))) {
        await handleFilesListDiscovery(url, currentDepth, log);
      }

      async function handleFilesListDiscovery(currentUrl, depth, logger) {
        try {
          await page.waitForSelector('.ef-directory .ef-item-row .ef-name-col__link, .ef-folder-list [role="treeitem"] a', {
            timeout: 12000
          }).catch(() => {});
          await page.waitForFunction(() => {
            return document.querySelectorAll('.ef-directory .ef-item-row .ef-name-col__link').length > 0 ||
                   document.querySelectorAll('.ef-folder-list [role="treeitem"] a').length > 0;
          }, { timeout: 15000 }).catch(() => {});

          let rowsReady = false;
          for (let attempt = 0; attempt < 6; attempt++) {
            const rowCount = await page.evaluate(() => document.querySelectorAll('.ef-directory .ef-item-row').length);
            if (rowCount > 0) {
              rowsReady = true;
              break;
            }
            await page.waitForTimeout(1000);
          }
          if (!rowsReady) {
            logger.debug(`Files list rows did not render for ${currentUrl} after waiting.`);
          }
          const filePageData = await page.evaluate(() => {
            const toAbsolute = (href) => {
              if (!href) return null;
              try {
                const url = new URL(href, window.location.origin);
                return url.href;
              } catch {
                return null;
              }
            };

            const breadcrumbEls = Array.from(document.querySelectorAll('.ef-breadcrumb a, .breadcrumb a')).filter(Boolean);
            const breadcrumbLabels = breadcrumbEls
              .map((el) => (el.textContent || '').trim())
              .filter((text) => text && text !== 'Files');

            const folderLinks = [
              ...Array.from(document.querySelectorAll('.ef-directory .ef-item-row .ef-name-col__link[href]')),
              ...Array.from(document.querySelectorAll('.ef-folder-list [role="treeitem"] a[href]')),
            ]
              .map((el) => toAbsolute(el.getAttribute('href') || el.href))
              .filter((href) => !!href && /\/files(\/folder\/|$)/.test(href));

            const fileLinks = Array.from(document.querySelectorAll('.ef-directory .ef-item-row .ef-name-col__link[href]'))
              .map((el) => toAbsolute(el.getAttribute('href') || el.href))
              .filter((href) => !!href && /\/files\/\d+/.test(href));

            return {
              breadcrumbs: breadcrumbLabels,
              folderLinks,
              fileLinks,
              pageTitle: document.title,
            };
          });

          const normalizeCourseLink = (link) => {
            if (!link) return null;
            try {
              const parsed = new URL(link, CANVAS_URL);
              return `${parsed.origin}${parsed.pathname}`;
            } catch {
              return null;
            }
          };

          const normalizedFolderLinks = filterStudentSafeUrls((filePageData.folderLinks || [])
            .map(normalizeCourseLink)
            .filter((link) => !!link && link.includes(`/courses/${courseId}/files`)));

          const normalizedFileLinks = filterStudentSafeUrls((filePageData.fileLinks || [])
            .map(normalizeCourseLink)
            .filter((link) => !!link && link.includes(`/courses/${courseId}/files/`)));

          if (normalizedFileLinks.length > 0) {
            const fileDepth = depth + 1;
            normalizedFileLinks.forEach((fileLink) => {
              if (!discoveredUrls.has(fileLink)) {
                discoveredUrls.add(fileLink);
                urlClassifications[fileLink] = 'file';
                mappingDataset.pushData({
                  url: fileLink,
                  classification: 'file',
                  courseId,
                  depth: fileDepth,
                  discoveredAt: new Date().toISOString()
                }).catch(() => {});
              }
            });

          }

          let apiChildLinks = [];
          const apiFolders = await getCourseFoldersForMapping(page, logger);
          if (apiFolders?.folders?.length) {
            const normalizedCurrent = normalizeCourseLink(currentUrl);
            const currentFolderEntry = apiFolders.folders.find((folder) => normalizeCourseLink(folder.html_url) === normalizedCurrent);
            const parentId = currentFolderEntry ? currentFolderEntry.id : null;
            apiChildLinks = apiFolders.folders
              .filter((folder) => {
                if (parentId) {
                  return folder.parent_folder_id === parentId;
                }
                return folder.parent_folder_id === null;
              })
              .map((folder) => normalizeCourseLink(folder.html_url))
              .filter((link) => !!link && link.includes(`/courses/${courseId}/files`));
          }

          const uniqueFolders = Array.from(new Set(normalizedFolderLinks.concat(apiChildLinks)))
            .filter((link) => !discoveredUrls.has(link));

          if (filesDiscoveryDataset) {
            filesDiscoveryDataset.pushData({
              type: 'files-list-discovery',
              courseId,
              url: currentUrl,
              depth,
              discoveredAt: new Date().toISOString(),
              breadcrumbs: filePageData.breadcrumbs || [],
              subfoldersDiscovered: uniqueFolders,
              totalFoldersOnPage: normalizedFolderLinks.length,
              totalFilesVisible: (filePageData.fileLinks || []).length,
              pageTitle: filePageData.pageTitle,
              apiFolderSample: apiChildLinks.slice(0, 10),
              apiFolderTotal: apiFolders?.folders?.length || 0
            }).catch(() => {});
          }

          if (uniqueFolders.length === 0) {
            return;
          }

          const headSafeFolders = await filterLinksWithHeadCheck(uniqueFolders, depth + 1, 'head-check:files-folders');
          if (!headSafeFolders || headSafeFolders.length === 0) {
            return;
          }

          const enqueuePayload = headSafeFolders.map((link) => ({
            url: link,
            userData: { depth: depth + 1, type: 'files-list', isFilesFolder: true },
          }));

          enqueuePayload.forEach((payload) => {
            if (!discoveredUrls.has(payload.url)) {
              discoveredUrls.add(payload.url);
              urlClassifications[payload.url] = 'files-list';
            }
          });

          await Promise.all(
            enqueuePayload.map((payload) => requestQueue.addRequest({
              url: payload.url,
              userData: payload.userData,
              label: 'files-folder-link'
            }))
          );

          logger.info(`   [Depth ${depth}] Queued ${headSafeFolders.length} file folder(s) from ${currentUrl}`);
        } catch (err) {
          console.log(`   ⚠️  Could not extract folders from files page ${currentUrl}: ${err.message}`);
          logger.debug(`Files list discovery failed on ${currentUrl}: ${err.message}`);
        }
      }

      // Additional helper also fetches folder data via Canvas API.
      async function getCourseFoldersForMapping(pageInstance, logger) {
        try {
          return await fetchCourseFolders(pageInstance, courseId, {
            logger,
            canvasUrl: CANVAS_URL
          });
        } catch (err) {
          logger.debug(`Files API fetch error for course ${courseId}: ${err.message}`);
          return { folders: [], error: err.message };
        }
      }

      // Discover links on the page - use multiple selectors for better coverage
      const discoveredCourseLinks = await page.$$eval('a[href*="/courses/"]', (anchors) => {
        const hrefs = anchors.map(anchor => anchor.href).filter(Boolean);
        return Array.from(new Set(hrefs));
      });
      const filteredCourseLinks = [];
      for (const link of discoveredCourseLinks) {
        if (!link.startsWith(CANVAS_URL)) {
          continue;
        }
        if (isStudentDataUrl(link)) {
          log.debug(`Skipping student-specific link ${link}`);
          continue;
        }
        const urlCourseId = extractCourseId(link);
        if (urlCourseId !== courseId) {
          continue;
        }
        if (link.match(/\/quizzes\/\d+\/(questions\/\d+|history(?:\/|\?|$))/)) {
          log.debug(`Skipping restricted quiz view ${link}`);
          continue;
        }
        if (
          link.includes('/download') ||
          link.includes('download_frd=1') ||
          link.includes('comment_id=') ||
          link.includes('/submissions')
        ) {
          continue;
        }
        if (FAST_MAP && currentDepth + 1 > MAX_DEPTH) {
          continue;
        }
        filteredCourseLinks.push(link);
      }
      const headSafeCourseLinks = await filterLinksWithHeadCheck(
        filteredCourseLinks,
        currentDepth + 1,
        'head-check:course-links',
        { dropOnUnauthorized: false }
      );
      const courseQueueEntries = headSafeCourseLinks || [];
      if (courseQueueEntries.length > 0) {
        await enqueueLinks({
          urls: courseQueueEntries,
          label: 'course-link',
          userData: { depth: currentDepth + 1 }
        });
      }

      // Ensure essential course sections are always queued at depth 0
      if (classification === 'course' && currentDepth === 0) {
        const corePaths = [
          'assignments',
          'modules',
          'files',
          'pages',
          'announcements',
          'discussion_topics',
          'quizzes',
          'syllabus'
        ];
        const coreLinks = corePaths
          .map((segment) => `${courseUrl.replace(/\/$/, '')}/${segment}`)
          .filter((link) => !discoveredUrls.has(link));
        if (coreLinks.length > 0) {
          const headSafeCoreLinks = await filterLinksWithHeadCheck(
            coreLinks,
            currentDepth + 1,
            'head-check:core-nav',
            { dropOnUnauthorized: false }
          );
          if (headSafeCoreLinks?.length) {
            await enqueueLinks({
              urls: headSafeCoreLinks,
              label: 'core-nav-link',
              userData: { depth: currentDepth + 1 }
            });
          }
        }
      }

      // Also explicitly look for and enqueue common Canvas navigation links
      // Only do this on course home page or if we haven't found modules/announcements yet
      if (currentDepth === 0 || currentDepth === 1) {
        try {
          const additionalLinks = await page.evaluate(() => {
            const links = [];
            // Quick check for modules and announcements - only on navigation
            const navLinks = document.querySelectorAll('nav a[href*="/modules"], nav a[href*="/announcements"]');
            navLinks.forEach(link => {
              if (link.href && !link.href.includes('/download')) links.push(link.href);
            });
            return [...new Set(links)];
          });

          if (additionalLinks.length > 0) {
            const filteredLinks = additionalLinks.filter(link => 
              link && link.includes(`/courses/${courseId}/`) && !discoveredUrls.has(link)
            );
            
            if (filteredLinks.length > 0) {
              const headSafeLinks = await filterLinksWithHeadCheck(
                filteredLinks,
                currentDepth + 1,
                'head-check:navigation',
                { dropOnUnauthorized: false }
              );
              if (headSafeLinks.length > 0) {
                await enqueueLinks({
                  urls: headSafeLinks.map(link => ({
                    url: link,
                    userData: { depth: currentDepth + 1 }
                  })),
                  label: 'navigation-link'
                });
              }
            }
          }
        } catch (error) {
          // Ignore in fast mode
        }
      }
      
      // On announcements page, extract all announcement links
      if (url.includes('/announcements') && !url.match(/\/announcements\/\d+/)) {
        try {
          const announcementLinks = await page.evaluate(() => {
            const links = [];
            // Find all announcement/discussion topic links on the announcements page
            const topicLinks = document.querySelectorAll('a[href*="/discussion_topics/"]');
            topicLinks.forEach(link => {
              if (link.href && !link.href.includes('/download') && !link.href.includes('comment_id=')) {
                links.push(link.href);
              }
            });
            return [...new Set(links)];
          });

          if (announcementLinks.length > 0) {
            const filteredLinks = announcementLinks.filter(link => 
              link && link.includes(`/courses/${courseId}/`) && !discoveredUrls.has(link)
            );
            
            if (filteredLinks.length > 0) {
              console.log(`   [Depth ${currentDepth}] Found ${filteredLinks.length} announcements from announcements page`);
              const headSafeAnnouncements = await filterLinksWithHeadCheck(
                filteredLinks,
                currentDepth + 1,
                'head-check:announcements',
                { dropOnUnauthorized: false }
              );
              if (headSafeAnnouncements.length > 0) {
                await enqueueLinks({
                  urls: headSafeAnnouncements.map(link => ({
                    url: link,
                    userData: { depth: currentDepth + 1, isAnnouncement: true }
                  })),
                  label: 'announcement-link'
                });
              }
            }
          }
        } catch (error) {
          // Ignore errors
        }
      }

      // On assignments page, extract all assignment links (similar to update checker logic)
      if (url.includes('/assignments') && !url.match(/\/assignments\/\d+$/)) {
        try {
          // Wait for assignments list to render (using same selectors as update checker)
          const assignmentSelectors = ['.assignment', '.assignment-list-item', '.ig-list-item', '.element_toggler', '[data-testid="assignments-list"]'];
          let listRendered = false;
          for (const selector of assignmentSelectors) {
            try {
              await page.waitForSelector(selector, { timeout: 2000 });
              listRendered = true;
              break;
            } catch (error) {
              // Try next selector
            }
          }
          // Fallback: wait a bit if no selector matched
          if (!listRendered) {
            await page.waitForTimeout(1200);
          }

          const assignmentLinks = await page.evaluate(() => {
            const links = [];
            const assignmentIds = new Set();
            // Find all assignment links on the assignments page
            const allLinks = document.querySelectorAll('a[href*="/assignments/"]');
            allLinks.forEach(link => {
              const href = link.getAttribute('href');
              if (href && !href.includes('/submissions') && !href.includes('/grade')) {
                const match = href.match(/\/assignments\/(\d+)/);
                if (match) {
                  const id = match[1];
                  if (!assignmentIds.has(id)) {
                    assignmentIds.add(id);
                    const fullUrl = href.startsWith('http') ? href : new URL(href, window.location.href).href;
                    links.push(fullUrl);
                  }
                }
              }
            });
            return [...new Set(links)];
          });

          if (assignmentLinks.length > 0) {
            const filteredLinks = assignmentLinks.filter(link => 
              link && link.includes(`/courses/${courseId}/`) && !discoveredUrls.has(link)
            );
            
            if (filteredLinks.length > 0) {
              console.log(`   [Depth ${currentDepth}] Found ${filteredLinks.length} assignments from assignments page`);
              const headSafeAssignments = await filterLinksWithHeadCheck(
                filteredLinks,
                currentDepth + 1,
                'head-check:assignments',
                { dropOnUnauthorized: false }
              );
              if (headSafeAssignments.length > 0) {
                await enqueueLinks({
                  urls: headSafeAssignments.map(link => ({
                    url: link,
                    userData: { depth: currentDepth + 1 }
                  })),
                  label: 'assignment-link'
                });
              }
            }
          }
        } catch (error) {
          log.debug(`Could not extract assignments from assignments page: ${error.message}`);
        }
      }
      
      // Full mode: do thorough link extraction
      try {
          const additionalLinks = await page.evaluate(() => {
            const links = [];
            const modulesLinks = document.querySelectorAll('a[href*="/modules"]');
            modulesLinks.forEach(link => {
              if (link.href && !link.href.includes('/download')) links.push(link.href);
            });
            const announcementsLinks = document.querySelectorAll('a[href*="/announcements"]');
            announcementsLinks.forEach(link => {
              if (link.href && !link.href.includes('/download')) links.push(link.href);
            });
            return [...new Set(links)];
          });

          if (additionalLinks.length > 0) {
            const filteredLinks = additionalLinks.filter(link => 
              link && link.includes(`/courses/${courseId}/`) && !discoveredUrls.has(link)
            );
            
            if (filteredLinks.length > 0) {
              console.log(`   🔗 Found ${filteredLinks.length} additional navigation links from ${url}`);
              const headSafeExtras = await filterLinksWithHeadCheck(
                filteredLinks,
                currentDepth + 1,
                'head-check:nav-full',
                { dropOnUnauthorized: false }
              );
              if (headSafeExtras.length > 0) {
                await enqueueLinks({
                  urls: headSafeExtras,
                  label: 'navigation-link',
                  transformRequestFunction: (req) => {
                    req.userData = { ...req.userData, depth: currentDepth + 1 };
                    return req;
                  }
                });
              }
            }
          }
      } catch (error) {
        console.log(`   ⚠️  Could not extract additional links from ${url}: ${error.message}`);
        log.debug(`Could not extract additional links: ${error.message}`);
      }
      
      // Final check for Access Denied page before logging (only if not already detected auth error)
      if (!authErrorDetected) {
        const isAccessDenied = await detectAccessDeniedPage(page);
        if (isAccessDenied) {
          markRequestAsUnauthorized(request, 'Access Denied (mapping final check)');
          console.log(`   ❌ Access Denied page detected for ${url} - failing immediately`);
          log.warn(`Access Denied page detected for ${url} - skipping`);
          trackAuthFailure('Access Denied page (mapping final check)');
          return; // Fail fast
        }
        
        try {
          const pageTitle = await page.title();
          console.log(`   📄 Page title: ${pageTitle.substring(0, 60)}...`);
          
          // Check if we got an error page
          if (pageTitle.includes('Unauthorized') || pageTitle.includes('Access Denied') || pageTitle.includes('401')) {
            console.log(`   ⚠️  WARNING: Possible authentication issue - page title suggests unauthorized access`);
            authErrorDetected = true;
            trackAuthFailure(`Unauthorized page title detected for ${url}`);
            return; // Fail fast
          }
        } catch (titleError) {
          console.log(`   ⚠️  Could not get page title: ${titleError.message}`);
        }
      }
    },
    maxConcurrency: MAX_CONCURRENCY,
    maxRequestsPerCrawl: MAX_REQUESTS_PER_CRAWL,
    maxRequestRetries: MAX_REQUEST_RETRIES,
    headless: HEADLESS,
    // Prevent single requests from blocking the queue - fail fast on long requests
    requestHandlerTimeoutSecs: 20, // Timeout for full extraction mode
    retryOnBlocked: false,
    sessionPoolOptions: {
      blockedStatusCodes: BLOCKED_STATUS_CODES
    },
    launchContext: {
      launcher: chromium,
      launchOptions: {
        headless: HEADLESS,
        // Performance optimizations for mapping and extraction
        args: [
          '--disable-images', // Don't load images (saves bandwidth)
          '--disable-plugins',
          '--disable-extensions',
          '--disable-dev-shm-usage',
          '--disable-gpu',
          '--disable-software-rasterizer',
          '--disable-background-networking',
          '--disable-background-timer-throttling',
          '--disable-renderer-backgrounding',
          '--disable-backgrounding-occluded-windows',
          '--disable-ipc-flooding-protection',
        ],
      },
    },
    preNavigationHooks: [
      async ({ request, page, log }) => {
        // Only inject cookies if context doesn't already have them
        // This reduces overhead and avoids race conditions
        const context = page.context();
        await injectCookiesIfNeeded(context, log);
      }
    ],
  });

  // Start crawling from the course home page with depth 0
  // Add the initial request to the queue explicitly
  console.log(`   📤 Adding initial course URL to queue: ${courseUrl}`);
  const requestInfo = await requestQueue.addRequest({
    url: courseUrl,
    userData: { depth: 0 }
  });
  console.log(`   ✅ Request added to queue: ${requestInfo.requestId}`);
  console.log(`   🚀 Starting crawler with maxRequestsPerCrawl: ${MAX_REQUESTS_PER_CRAWL}, maxConcurrency: ${MAX_CONCURRENCY}`);
  
  // Run the crawler - it will process requests from the queue
  try {
    await crawler.run();
    console.log(`   ✅ Crawler finished for course ${courseId}`);
  } catch (crawlerError) {
    console.error(`   ❌ Crawler error for course ${courseId}: ${crawlerError.message}`);
    console.error(`   Stack: ${crawlerError.stack}`);
    throw crawlerError;
  }

  const endTime = Date.now();
  const duration = ((endTime - startTime) / 1000).toFixed(2);
  const durationMinutes = (duration / 60).toFixed(2);

  // Generate final mapping summary
  const uniqueUrls = Array.from(discoveredUrls);
  const groupedUrls = groupUrlsByType(uniqueUrls, courseId);
  const statistics = generateStatistics(groupedUrls);

  // Use formatted folder name or fallback to courseId
  const finalFolderName = courseFolderName || `course-${courseId}`;

  const mappingSummary = {
    courseId,
    courseInfo,
    courseFolderName: finalFolderName,
    mappedAt: new Date().toISOString(),
    canvasUrl: CANVAS_URL,
    urls: groupedUrls,
    statistics,
    totalUniqueUrls: uniqueUrls.length,
    depthAnalysis: {
      maxDepth: depthStats.maxDepth,
      depthDistribution: depthStats.depthCounts,
      averageDepth: Object.entries(depthStats.depthCounts).reduce((sum, [depth, count]) => 
        sum + (parseInt(depth) * count), 0) / uniqueUrls.length || 0
    },
    crawlDuration: {
      seconds: parseFloat(duration),
      minutes: parseFloat(durationMinutes),
      formatted: `${durationMinutes} minutes (${duration} seconds)`
    }
  };

  // Store summary in dataset
  await mappingDataset.pushData({
    type: 'mapping_summary',
    ...mappingSummary
  });

  // Ensure mapping data is persisted to disk
  // Crawlee Dataset automatically saves data, but we verify it's there
  const extractionFolder = getExtractionFolder();
  const mappingDir = path.join(process.env.CRAWLEE_STORAGE_DIR || path.join(__dirname, '..', '..', 'storage', 'datasets', extractionFolder), 'datasets', 'mapping');
  
  // Get count of items in dataset to verify persistence
  let mappingItemCount = 0;
  try {
    const mappingData = await mappingDataset.getData();
    mappingItemCount = mappingData.items ? mappingData.items.length : 0;
  } catch (err) {
    console.warn(`   ⚠️  Could not verify mapping dataset count: ${err.message}`);
  }

  console.log('\n✅ Mapping Complete!');
  console.log(`\n📊 Summary:`);
  console.log(`   Total URLs discovered: ${statistics.totalUrls}`);
  console.log(`   - Assignments: ${statistics.assignments}`);
  console.log(`   - Modules: ${statistics.modules}`);
  console.log(`   - Files: ${statistics.files}`);
  console.log(`   - Pages: ${statistics.pages}`);
  console.log(`   - Announcements: ${statistics.announcements}`);
  console.log(`   - Discussions: ${statistics.discussions}`);
  console.log(`   - Quizzes: ${statistics.quizzes}`);
  console.log(`   - Grades: ${statistics.grades}`);
  console.log(`   - Syllabus: ${statistics.syllabus}`);
  console.log(`\n📏 Depth Analysis:`);
  console.log(`   Maximum depth reached: ${depthStats.maxDepth}`);
  console.log(`   Average depth: ${mappingSummary.depthAnalysis.averageDepth.toFixed(2)}`);
  console.log(`   Depth distribution:`, depthStats.depthCounts);
  console.log(`\n🧪 Classification telemetry:`, classificationTelemetry);
  if (unknownClassificationSamples.length > 0) {
    console.log(`   Unknown classification samples:`, unknownClassificationSamples);
  }
  console.log(`\n⏱️  Performance:`);
  console.log(`   Duration: ${mappingSummary.crawlDuration.formatted}`);
  console.log(`   Started: ${new Date(startTime).toISOString()}`);
  console.log(`   Finished: ${new Date(endTime).toISOString()}`);
  console.log(`\n💾 Output:`);
  console.log(`   Extraction folder: ./storage/datasets/${extractionFolder}/`);
  console.log(`   Mapping dataset: ./storage/datasets/${extractionFolder}/datasets/mapping/`);
  console.log(`   Mapping items saved: ${mappingItemCount} (including summary)`);
  
  // Verify mapping directory exists and has files
  if (fs.existsSync(mappingDir)) {
    const mappingFiles = fs.readdirSync(mappingDir).filter(f => f.endsWith('.json'));
    console.log(`   ✅ Mapping directory verified: ${mappingFiles.length} JSON file(s) found`);
  } else {
    console.warn(`   ⚠️  Mapping directory not found at: ${mappingDir}`);
    console.warn(`   💡 Mapping data may not be persisted correctly`);
  }

  return mappingSummary;
}

/**
 * Phase 2: Content Extraction - Extract assignments, modules, and files
 * @param {string} courseId - Course ID to extract
 * @param {object} mappingData - Mapping data from Phase 1 (in memory, not from file)
 */
async function runExtractionPhase(courseId, mappingData, options = {}) {
  const { authState = getAuthState(courseId) } = options;
  const startTime = Date.now();
  console.log('\n📥 Phase 2: Starting Content Extraction...');
  console.log(`   Course ID: ${courseId}`);
  console.log(`   Canvas URL: ${CANVAS_URL}`);

  // Get course folder name from mapping data or fallback to courseId
  const courseFolderName = mappingData?.courseFolderName || `course-${courseId}`;
  console.log(`   Course folder: ${courseFolderName}`);

  // Helper function to get course folder path
  const getCourseFolderPath = () => `courses/${courseFolderName}`;

  console.log(`   Started at: ${new Date().toISOString()}`);

  // Use mapping data passed directly from Phase 1 (in memory)
  // No file dependencies - ensures fresh extraction every time
  if (!mappingData || !mappingData.urls) {
    throw new Error(`No mapping data provided. Mapping phase must run first and pass data directly.`);
  }

  const cookies = await loadCookies(false); // Don't retry here, already validated at startup

  // Create course-specific datasets
  // Dataset names are relative to CRAWLEE_STORAGE_DIR which is set to the extraction folder
  // Structure: courses/{courseFolderName}/assignments, etc.
  const datasetPrefix = getCourseFolderPath();
  
  // Clear existing datasets to ensure fresh extraction
  // Clear both the courseId folder (if it exists from previous runs) and the courseFolderName folder
  // This prevents duplicate folders from being created
  const datasetDirByCourseId = path.join(process.env.CRAWLEE_STORAGE_DIR, 'courses', courseId);
  const datasetDirByFolderName = path.join(process.env.CRAWLEE_STORAGE_DIR, 'courses', courseFolderName);
  
  // Clear old courseId folder if it exists and is different from courseFolderName
  if (fs.existsSync(datasetDirByCourseId) && courseFolderName !== courseId) {
    console.log(`   🗑️  Clearing old course folder: ${courseId}`);
    fs.rmSync(datasetDirByCourseId, { recursive: true, force: true });
  }
  
  // Clear the target folder (courseFolderName) to ensure fresh extraction
  if (fs.existsSync(datasetDirByFolderName)) {
    console.log(`   🗑️  Clearing existing data for course folder: ${courseFolderName}`);
    fs.rmSync(datasetDirByFolderName, { recursive: true, force: true });
  }
  
  // Track pushed items to prevent duplicates within a single run
  const pushedItems = {
    assignments: new Set(),
    modules: new Set(),
    files: new Set(),
    pages: new Set(),
    announcements: new Set(),
    discussions: new Set(),
    quizzes: new Set(),
    syllabus: new Set()
  };
  
  // No caching - fresh extraction every time
  // LTI detection will be done fresh for each assignment
  
  const assignmentsDataset = await Dataset.open(`${datasetPrefix}/assignments`);
  const modulesDataset = await Dataset.open(`${datasetPrefix}/modules`);
  const filesDataset = await Dataset.open(`${datasetPrefix}/files`);
  const pagesDataset = await Dataset.open(`${datasetPrefix}/pages`);
  const announcementsDataset = await Dataset.open(`${datasetPrefix}/announcements`);
  const discussionsDataset = await Dataset.open(`${datasetPrefix}/discussions`);
  const quizzesDataset = await Dataset.open(`${datasetPrefix}/quizzes`);
  const syllabusDataset = await Dataset.open(`${datasetPrefix}/syllabus`);

  // Get URLs to extract
  const assignmentUrls = filterStudentSafeUrls(mappingData.urls.assignments || []);
  const moduleUrls = filterStudentSafeUrls(mappingData.urls.modules || []);
  const fileUrls = filterStudentSafeUrls(mappingData.urls.files || []);
  const pageUrls = filterStudentSafeUrls(mappingData.urls.pages || []);
  const announcementUrls = filterStudentSafeUrls(mappingData.urls.announcements || []);
  const discussionUrls = filterStudentSafeUrls(mappingData.urls.discussions || []);
  const quizUrls = filterStudentSafeUrls(mappingData.urls.quizzes || []);
  const syllabusUrls = filterStudentSafeUrls(mappingData.urls.syllabus || []);

  // Filter to only individual items (not list pages)
  let individualAssignments = assignmentUrls.filter(url => url.match(/\/assignments\/\d+$/));
  const fileListUrls = fileUrls.filter(url => url.match(/\/courses\/\d+\/files/) && !url.match(/\/files\/\d+/));
  const individualPages = pageUrls.filter(url => url.match(/\/pages\/[^\/]+$/));
  const individualDiscussions = discussionUrls.filter(url => url.match(/\/discussion_topics\/\d+$/));
  const individualQuizzes = quizUrls.filter(url => url.match(/\/quizzes\/\d+$/));
  
  // For announcements: check both announcement URLs and discussion URLs
  // Canvas announcements are discussion topics, so we need to check discussions too
  let individualAnnouncements = announcementUrls.filter(url => url.match(/\/discussion_topics\/\d+/));
  
  // If we only have the announcements list page, we need to visit it to get individual announcements
  const announcementsListPageUrl = announcementUrls.find(url => url.includes('/announcements') && !url.match(/\/announcements\/\d+/));
  
  // Also check discussions - some might be announcements
  // We'll let the extractor determine if a discussion is actually an announcement
  if (individualAnnouncements.length === 0 && announcementsListPageUrl) {
    // We'll visit the announcements page during extraction to discover individual announcements
    individualAnnouncements = [announcementsListPageUrl];
  }

  // ENHANCEMENT: Discover items from list pages (similar to update script)
  // This ensures we find all items even if they weren't linked from the course homepage
  console.log('\n   🔍 Discovering items from list pages...');
  const discoveredItems = {
    announcements: new Set(individualAnnouncements.map(url => {
      const match = url.match(/\/discussion_topics\/(\d+)/);
      return match ? match[1] : null;
    }).filter(Boolean)),
    assignments: new Set(individualAssignments.map(url => {
      const match = url.match(/\/assignments\/(\d+)/);
      return match ? match[1] : null;
    }).filter(Boolean)),
    modules: new Set(moduleUrls.map(url => {
      const match = url.match(/\/modules\/(\d+)/);
      return match ? match[1] : null;
    }).filter(Boolean))
  };

  // Create a temporary browser context for discovery
  const browser = await chromium.launch({ headless: HEADLESS });
  const discoveryContext = await browser.newContext();
  const discoveryPage = await discoveryContext.newPage();
  
  // Inject cookies for discovery
  const discoveryCookies = await loadCookies(false);
  const cookiesWithDomain = discoveryCookies.map(cookie => ({
    ...cookie,
    domain: cookie.domain || new URL(CANVAS_URL).hostname
  }));
  await discoveryContext.addCookies(cookiesWithDomain);

  // Map to store submission status extracted from assignments list page
  // This will be populated during discovery and used during extraction
  const assignmentStatusMap = new Map(); // Map assignment ID to submission status
  
  try {
    // Discover announcements from list page
    try {
      const announcementsUrl = `${CANVAS_URL}/courses/${courseId}/announcements`;
      console.log(`      📢 Checking announcements list: ${announcementsUrl}`);
      await discoveryPage.goto(announcementsUrl, { waitUntil: 'domcontentloaded', timeout: 10000 });
      await discoveryPage.waitForTimeout(1200);
      
      const announcementsData = await discoveryPage.evaluate(() => {
        const links = document.querySelectorAll('a[href*="/discussion_topics/"]');
        const announcementIds = new Set();
        const announcements = [];
        
        links.forEach(link => {
          const href = link.getAttribute('href');
          if (href && !href.includes('/download') && !href.includes('comment_id=')) {
            const match = href.match(/\/discussion_topics\/(\d+)/);
            if (match) {
              const id = match[1];
              if (!announcementIds.has(id)) {
                announcementIds.add(id);
                const fullUrl = href.startsWith('http') ? href : new URL(href, window.location.href).href;
                announcements.push({ id, url: fullUrl, title: link.textContent.trim() });
              }
            }
          }
        });
        
        return announcements;
      });
      
      for (const announcement of announcementsData) {
        if (!discoveredItems.announcements.has(announcement.id)) {
          discoveredItems.announcements.add(announcement.id);
          individualAnnouncements.push(announcement.url);
          console.log(`         ✅ Discovered announcement: ${announcement.title || announcement.id}`);
        }
      }
    } catch (error) {
      console.log(`      ⚠️  Could not discover announcements: ${error.message}`);
    }

    // PRIMARY: Check dashboard page for submission status (pill_text structure)
    // Dashboard shows all assignments across courses with submission status
    try {
      const dashboardUrl = `${CANVAS_URL}/dashboard`;
      console.log(`      🏠 Checking dashboard for assignment status: ${dashboardUrl}`);
      await discoveryPage.goto(dashboardUrl, { waitUntil: 'domcontentloaded', timeout: 15000 });
      await discoveryPage.waitForTimeout(3000); // Wait for dashboard to fully load, especially for dynamic content
      
      const dashboardStatusData = await discoveryPage.evaluate((targetCourseId) => {
        const statusMap = new Map();
        
        // Find "Past Assignments" section by looking for the toggle button
        // <button class="element_toggler accessible-toggler" aria-controls="assignment_group_past_assignments">
        const pastAssignmentsToggle = document.querySelector('.element_toggler[aria-controls*="past_assignments"], button[aria-controls*="past_assignments"]');
        let pastAssignmentsContainer = null;
        const pastAssignmentIds = new Set();
        
        if (pastAssignmentsToggle) {
          const pastAssignmentsId = pastAssignmentsToggle.getAttribute('aria-controls');
          if (pastAssignmentsId) {
            // Try to find the container by ID
            pastAssignmentsContainer = document.getElementById(pastAssignmentsId);
            
            // If not found, try alternative methods
            if (!pastAssignmentsContainer) {
              // Look for element with matching ID pattern
              pastAssignmentsContainer = document.querySelector(`[id*="${pastAssignmentsId}"]`);
            }
            
            // If still not found, look for the container that follows the toggle
            if (!pastAssignmentsContainer) {
              let current = pastAssignmentsToggle.parentElement;
              while (current && !pastAssignmentsContainer) {
                // Check siblings
                let sibling = current.nextElementSibling;
                while (sibling) {
                  if (sibling.id && (sibling.id.includes('past') || sibling.id === pastAssignmentsId)) {
                    pastAssignmentsContainer = sibling;
                    break;
                  }
                  sibling = sibling.nextElementSibling;
                }
                // Check children
                const childWithId = current.querySelector(`[id*="past"], [id="${pastAssignmentsId}"]`);
                if (childWithId) {
                  pastAssignmentsContainer = childWithId;
                  break;
                }
                current = current.parentElement;
              }
            }
            
            // If container found, collect all assignment IDs within it
            if (pastAssignmentsContainer) {
              const pastLinks = pastAssignmentsContainer.querySelectorAll('a[href*="/assignments/"]');
              pastLinks.forEach(link => {
                const href = link.getAttribute('href');
                if (href) {
                  const match = href.match(/\/courses\/(\d+)\/assignments\/(\d+)/);
                  if (match && match[1] === targetCourseId) {
                    pastAssignmentIds.add(match[2]);
                  }
                }
              });
            }
          }
        }
        
        // Find all assignment links on dashboard
        const assignmentLinks = document.querySelectorAll('a[href*="/assignments/"]');
        
        assignmentLinks.forEach(link => {
          const href = link.getAttribute('href');
          if (href && !href.includes('/submissions') && !href.includes('/grade')) {
            const match = href.match(/\/courses\/(\d+)\/assignments\/(\d+)/);
            if (match) {
              const linkCourseId = match[1];
              const assignmentId = match[2];
              
              // Only process assignments from the target course
              if (linkCourseId === targetCourseId) {
                // Check if this assignment is in "Past Assignments" section
                const isPastAssignment = pastAssignmentIds.has(assignmentId) ||
                                        (pastAssignmentsContainer && pastAssignmentsContainer.contains(link)) ||
                                        link.closest('[id*="past_assignments"]') !== null;
                
                // If in Past Assignments, mark as submitted
                if (isPastAssignment) {
                  statusMap.set(assignmentId, {
                    submissionStatus: 'yes',
                    submissionStatusText: 'Past Assignment'
                  });
                } else {
                  // Look for pill_text element with submission status
                  // Find the closest container that might hold the status
                  const listItem = link.closest('li, tr, [class*="assignment"], [class*="item"], div, article');
                  
                  if (listItem) {
                    // Look for pill_text structure: <div class="css-*-pill__text">Submitted</div>
                    // Canvas uses CSS modules, so class names vary but contain "pill__text"
                    const pillElements = listItem.querySelectorAll('[class*="pill__text"], [class*="pill-text"], [class*="pill"]');
                    
                    for (const pill of pillElements) {
                      const pillText = pill.textContent.trim();
                      const normalized = pillText.toLowerCase();
                      
                      // Check for submitted status (including "Graded")
                      if (normalized === 'submitted' || normalized === 'graded' || 
                          normalized === 'turned in' || normalized === 'resubmitted') {
                        statusMap.set(assignmentId, {
                          submissionStatus: 'yes',
                          submissionStatusText: pillText
                        });
                        break;
                      }
                      // Check for not submitted status
                      else if (normalized === 'missing' || normalized === 'not submitted' || 
                               normalized === 'unsubmitted' || normalized === 'no submission') {
                        statusMap.set(assignmentId, {
                          submissionStatus: 'no',
                          submissionStatusText: pillText
                        });
                        break;
                      }
                    }
                    
                    // If no pill found, check for status text in the right column area
                    if (!statusMap.has(assignmentId)) {
                      // Look for status text in elements near the link (right column)
                      const rightColumnSelectors = [
                        '[class*="status"]',
                        '[class*="submission"]',
                        '.badge',
                        '.label'
                      ];
                      
                      for (const selector of rightColumnSelectors) {
                        const statusEl = listItem.querySelector(selector);
                        if (statusEl) {
                          const statusText = statusEl.textContent.trim();
                          const normalized = statusText.toLowerCase();
                          
                          if (normalized === 'submitted' || normalized === 'graded') {
                            statusMap.set(assignmentId, {
                              submissionStatus: 'yes',
                              submissionStatusText: statusText
                            });
                            break;
                          } else if (normalized === 'missing' || normalized === 'not submitted') {
                            statusMap.set(assignmentId, {
                              submissionStatus: 'no',
                              submissionStatusText: statusText
                            });
                            break;
                          }
                        }
                      }
                    }
                  }
                }
              }
            }
          }
        });
        
        return Array.from(statusMap.entries()).map(([id, status]) => ({ id, ...status }));
      }, courseId);
      
      // Store dashboard status in the map
      console.log(`         📊 Dashboard found ${dashboardStatusData.length} assignments with status`);
      for (const item of dashboardStatusData) {
        assignmentStatusMap.set(item.id, {
          submissionStatus: item.submissionStatus,
          submissionStatusText: item.submissionStatusText
        });
        console.log(`         📊 Dashboard: Assignment ${item.id} → ${item.submissionStatus === 'yes' ? 'Submitted' : 'Not Submitted'}${item.submissionStatusText ? ` (${item.submissionStatusText})` : ''}`);
      }
    } catch (error) {
      console.log(`      ⚠️  Could not check dashboard: ${error.message}`);
    }

    // FALLBACK: Discover assignments from assignments list page
    // Also extract submission status from the right column of the assignments list page
    try {
      const assignmentsUrl = `${CANVAS_URL}/courses/${courseId}/assignments`;
      console.log(`      📝 Checking assignments list: ${assignmentsUrl}`);
      await discoveryPage.goto(assignmentsUrl, { waitUntil: 'domcontentloaded', timeout: 10000 });
      await discoveryPage.waitForTimeout(2000); // Wait for assignments to load
      
      // Ensure "Past Assignments" section is expanded before extracting
      try {
        const pastToggleButton = await discoveryPage.$('.element_toggler[aria-controls*="past_assignments"], button[aria-controls*="past_assignments"]');
        if (pastToggleButton) {
          const isExpanded = await pastToggleButton.evaluate(btn => btn.getAttribute('aria-expanded') === 'true');
          if (!isExpanded) {
            console.log(`         🔽 Expanding Past Assignments section...`);
            await pastToggleButton.click();
            await discoveryPage.waitForTimeout(1000); // Wait for section to expand
          }
        }
      } catch (error) {
        // If toggle button not found or click fails, continue anyway
        console.log(`         ⚠️  Could not expand Past Assignments: ${error.message}`);
      }
      
      const assignmentsData = await discoveryPage.evaluate(() => {
        // FIRST: Find "Past Assignments" container and collect all assignment IDs in it
        // Structure: <div id="assignment_group_past" class="assignment_group">
        //   <div id="assignment_group_past_assignments" class="assignment-list">
        const pastAssignmentsContainer = document.getElementById('assignment_group_past_assignments');
        const pastAssignmentsGroup = document.getElementById('assignment_group_past');
        const pastAssignmentIds = new Set();
        
        // Collect all assignment IDs from Past Assignments section
        // Try multiple methods to find the container
        
        // Method 1: Direct ID lookup
        if (pastAssignmentsContainer) {
          const pastLinks = pastAssignmentsContainer.querySelectorAll('a[href*="/assignments/"]');
          pastLinks.forEach(link => {
            const href = link.getAttribute('href');
            if (href) {
              const match = href.match(/\/assignments\/(\d+)/);
              if (match) {
                pastAssignmentIds.add(match[1]);
              }
            }
          });
        }
        
        // Method 2: Check the group container
        if (pastAssignmentsGroup) {
          const pastLinks = pastAssignmentsGroup.querySelectorAll('a[href*="/assignments/"]');
          pastLinks.forEach(link => {
            const href = link.getAttribute('href');
            if (href) {
              const match = href.match(/\/assignments\/(\d+)/);
              if (match) {
                pastAssignmentIds.add(match[1]);
              }
            }
          });
        }
        
        // Method 3: Find by toggle button's aria-controls
        if (pastAssignmentIds.size === 0) {
          const toggleButton = document.querySelector('.element_toggler[aria-controls*="past_assignments"], button[aria-controls*="past_assignments"]');
          if (toggleButton) {
            const ariaControls = toggleButton.getAttribute('aria-controls');
            if (ariaControls) {
              const targetContainer = document.getElementById(ariaControls);
              if (targetContainer) {
                const pastLinks = targetContainer.querySelectorAll('a[href*="/assignments/"]');
                pastLinks.forEach(link => {
                  const href = link.getAttribute('href');
                  if (href) {
                    const match = href.match(/\/assignments\/(\d+)/);
                    if (match) {
                      pastAssignmentIds.add(match[1]);
                    }
                  }
                });
              }
            }
          }
        }
        
        // Method 4: Find all elements with "past" in ID and collect assignments
        if (pastAssignmentIds.size === 0) {
          const pastContainers = document.querySelectorAll('[id*="past"], [id*="assignment_group_past"]');
          pastContainers.forEach(container => {
            // Look for assignment links
            const pastLinks = container.querySelectorAll('a[href*="/assignments/"]');
            pastLinks.forEach(link => {
              const href = link.getAttribute('href');
              if (href) {
                const match = href.match(/\/assignments\/(\d+)/);
                if (match) {
                  pastAssignmentIds.add(match[1]);
                }
              }
            });
            // Also look for <li class="assignment"> elements (from user's HTML structure)
            const assignmentListItems = container.querySelectorAll('li.assignment, li[class*="assignment"]');
            assignmentListItems.forEach(li => {
              const link = li.querySelector('a[href*="/assignments/"]');
              if (link) {
                const href = link.getAttribute('href');
                if (href) {
                  const match = href.match(/\/assignments\/(\d+)/);
                  if (match) {
                    pastAssignmentIds.add(match[1]);
                  }
                }
              }
            });
          });
        }
        
        const pastIdsArray = Array.from(pastAssignmentIds);
        
        // Debug: log what we found
        if (pastIdsArray.length > 0) {
          console.log(`[DEBUG] Found ${pastIdsArray.length} past assignment IDs: ${pastIdsArray.slice(0, 5).join(', ')}`);
        } else {
          console.log(`[DEBUG] No past assignments found. Container exists: ${!!pastAssignmentsContainer}, Group exists: ${!!pastAssignmentsGroup}`);
        }
        
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
                
                // Find the list item containing this assignment link
                // Canvas shows assignments in list items with status in the right column
                const listItem = link.closest('.assignment, .assignment-list-item, li, tr, .ig-list-item, [class*="assignment"]');
                let submissionStatus = null;
                let statusText = null;
                
                // Only extract submission status for assignments, not announcements
                // Check if this is an announcement by looking at the link or list item context
                const linkText = link.textContent?.toLowerCase() || '';
                const isAnnouncementLink = linkText.includes('announcement') || 
                                          link.closest('[class*="announcement"]') !== null ||
                                          link.closest('[data-testid*="announcement"]') !== null;
                
                if (listItem && !isAnnouncementLink) {
                  // Check if this assignment is in "Past Assignments" section FIRST
                  // Multiple checks to ensure we catch it:
                  // 1. Check if ID is in the pre-collected past assignment IDs
                  // 2. Check if listItem is contained within the past assignments container
                  // 3. Check if listItem is within any element with "past" in the ID
                  const isPastAssignment = pastIdsArray.includes(id) ||
                                          (pastAssignmentsContainer && (pastAssignmentsContainer.contains(listItem) || pastAssignmentsContainer.contains(link))) ||
                                          (pastAssignmentsGroup && (pastAssignmentsGroup.contains(listItem) || pastAssignmentsGroup.contains(link))) ||
                                          listItem.closest('[id*="past_assignments"], [id*="assignment_group_past"]') !== null ||
                                          link.closest('[id*="past_assignments"], [id*="assignment_group_past"]') !== null;
                  
                  // If in Past Assignments, ALWAYS mark as submitted (override any other status)
                  if (isPastAssignment) {
                    submissionStatus = 'yes';
                    statusText = 'Past Assignment';
                  } else {
                    // Canvas shows submission status in a pill element with class like "css-xbajoi-pill__text"
                    // Look for pill elements containing status text
                    // Pattern: <div class="css-*-pill__text">Submitted</div> or similar
                    const pillSelectors = [
                      '[class*="pill__text"]',
                      '[class*="pill-text"]',
                      '.pill',
                      '[class*="status"]',
                      '[class*="badge"]'
                    ];
                    
                    // First, try to find the pill element directly
                    for (const selector of pillSelectors) {
                      const pillElements = listItem.querySelectorAll(selector);
                      for (const pill of pillElements) {
                        const pillText = pill.textContent.trim();
                        const normalized = pillText.toLowerCase();
                        
                        // Check for submitted status (including "Graded")
                        if (normalized === 'submitted' || normalized === 'graded' || 
                            normalized === 'turned in' || normalized === 'resubmitted') {
                          submissionStatus = 'yes';
                          statusText = pillText;
                          break;
                        }
                        // Check for not submitted status
                        else if (normalized === 'missing' || normalized === 'not submitted' || 
                                 normalized === 'unsubmitted' || normalized === 'no submission') {
                          submissionStatus = 'no';
                          statusText = pillText;
                          break;
                        }
                      }
                      if (submissionStatus !== null) break;
                    }
                    
                    // Fallback: Search for status text in the list item if pill not found
                    if (submissionStatus === null) {
                      const itemText = listItem.textContent || '';
                      const normalizedText = itemText.toLowerCase();
                      
                      // Look for exact status text matches in the right column
                      // Canvas often shows status as standalone text in the right column
                      const statusPatterns = [
                        { pattern: /\b(submitted|graded|turned in|resubmitted)\b/i, status: 'yes' },
                        { pattern: /\b(missing|not submitted|unsubmitted|no submission)\b/i, status: 'no' }
                      ];
                      
                      for (const { pattern, status } of statusPatterns) {
                        const match = itemText.match(pattern);
                        if (match) {
                          // Verify it's not part of assignment description or other content
                          // Look for the element containing this text
                          const allElements = listItem.querySelectorAll('*');
                          for (const el of allElements) {
                            const elText = el.textContent.trim();
                            const normalized = elText.toLowerCase();
                            
                            // Look for concise status text (exact matches preferred)
                            if ((normalized === 'submitted' || normalized === 'graded' || 
                                 normalized === 'missing' || normalized === 'not submitted') &&
                                elText.length < 50) {
                              submissionStatus = status;
                              statusText = elText;
                              break;
                            }
                          }
                          
                          // If no specific element found but pattern matched, use it
                          if (submissionStatus === null) {
                            submissionStatus = status;
                            statusText = match[1];
                          }
                          break;
                        }
                      }
                    }
                  }
                }
                
                assignments.push({ 
                  id, 
                  url: fullUrl, 
                  title: link.textContent.trim(),
                  submissionStatus,
                  submissionStatusText: statusText
                });
              }
            }
          }
        });
        
        return { assignments, pastAssignmentCount: pastIdsArray.length, pastAssignmentIds: pastIdsArray };
      });
      
      const assignments = assignmentsData.assignments || [];
      console.log(`         🔍 Found ${assignmentsData.pastAssignmentCount || 0} assignments in Past Assignments section`);
      if (assignmentsData.pastAssignmentIds && assignmentsData.pastAssignmentIds.length > 0) {
        console.log(`         📋 Past Assignment IDs: ${assignmentsData.pastAssignmentIds.slice(0, 10).join(', ')}${assignmentsData.pastAssignmentIds.length > 10 ? '...' : ''}`);
      }
      
      let pastAssignmentsMarked = 0;
      for (const assignment of assignments) {
        // Always store submission status if available, even if assignment was already discovered
        if (assignment.submissionStatus !== null) {
          assignmentStatusMap.set(assignment.id, {
            submissionStatus: assignment.submissionStatus,
            submissionStatusText: assignment.submissionStatusText
          });
          if (assignment.submissionStatus === 'yes' && assignment.submissionStatusText === 'Past Assignment') {
            pastAssignmentsMarked++;
          }
        }
        
        // Only add to discovered items and individual assignments if not already there
        if (!discoveredItems.assignments.has(assignment.id)) {
          discoveredItems.assignments.add(assignment.id);
          individualAssignments.push(assignment.url);
          const statusDisplay = assignment.submissionStatus 
            ? ` (${assignment.submissionStatus === 'yes' ? 'Submitted' : 'Not Submitted'}${assignment.submissionStatusText ? `: ${assignment.submissionStatusText}` : ''})`
            : '';
          console.log(`         ✅ Discovered assignment: ${assignment.title || assignment.id}${statusDisplay}`);
        } else if (assignment.submissionStatus !== null) {
          // Assignment already discovered, but we found status for it
          const statusDisplay = assignment.submissionStatus 
            ? ` (${assignment.submissionStatus === 'yes' ? 'Submitted' : 'Not Submitted'}${assignment.submissionStatusText ? `: ${assignment.submissionStatusText}` : ''})`
            : '';
          console.log(`         📊 Updated status for assignment: ${assignment.title || assignment.id}${statusDisplay}`);
        }
      }
      if (pastAssignmentsMarked > 0) {
        console.log(`         ✅ Marked ${pastAssignmentsMarked} assignments as Past Assignments (submitted)`);
      }
    } catch (error) {
      console.log(`      ⚠️  Could not discover assignments: ${error.message}`);
    }

    // Discover modules from list page
    try {
      const modulesListUrl = `${CANVAS_URL}/courses/${courseId}/modules`;
      console.log(`      📦 Checking modules list: ${modulesListUrl}`);
      await discoveryPage.goto(modulesListUrl, { waitUntil: 'domcontentloaded', timeout: 10000 });
      await discoveryPage.waitForTimeout(1500);
      
      const modulesData = await discoveryPage.evaluate((baseUrl) => {
        const modules = [];
        const moduleElements = document.querySelectorAll('.context_module, [data-testid="module"], .module');
        
        moduleElements.forEach(moduleEl => {
          let moduleId = null;
          const moduleIdAttr = moduleEl.getAttribute('data-module-id') || 
                              moduleEl.getAttribute('id')?.match(/context_module_(\d+)/)?.[1];
          
          if (moduleIdAttr) {
            moduleId = moduleIdAttr;
          } else {
            const link = moduleEl.querySelector('a[href*="/modules/"]');
            if (link) {
              const href = link.getAttribute('href');
              const match = href.match(/\/modules\/(\d+)/);
              if (match) {
                moduleId = match[1];
              }
            }
          }
          
          if (moduleId) {
            const nameEl = moduleEl.querySelector('.ig-header-title, .module-name, h3, h2');
            const name = nameEl ? nameEl.textContent.trim() : null;
            
            modules.push({ id: moduleId, title: name || `Module ${moduleId}` });
          }
        });
        
        return modules;
      }, modulesListUrl);
      
      // Add discovered modules - ensure the modules list page URL is in moduleUrls
      if (modulesData.length > 0) {
        if (!moduleUrls.includes(modulesListUrl)) {
          moduleUrls.push(modulesListUrl);
        }
        for (const module of modulesData) {
          if (!discoveredItems.modules.has(module.id)) {
            discoveredItems.modules.add(module.id);
            console.log(`         ✅ Discovered module: ${module.title || module.id}`);
          }
        }
      }
    } catch (error) {
      console.log(`      ⚠️  Could not discover modules: ${error.message}`);
    }

  } finally {
    await discoveryContext.close();
    await browser.close();
  }

  console.log(`   ✅ Discovery complete. Found ${individualAnnouncements.length} announcements, ${individualAssignments.length} assignments`);
  
  // Track extraction progress and statistics (initialized after variables are declared)
  const extractionStats = {
    assignments: { total: individualAssignments.length, extracted: 0, failed: 0, skipped: 0 },
    modules: { total: moduleUrls.length, extracted: 0, failed: 0, skipped: 0 },
    files: { total: fileListUrls.length, extracted: 0, failed: 0, skipped: 0 },
    pages: { total: individualPages.length, extracted: 0, failed: 0, skipped: 0 },
    announcements: { total: individualAnnouncements.length, extracted: 0, failed: 0, skipped: 0 },
    discussions: { total: individualDiscussions.length, extracted: 0, failed: 0, skipped: 0 },
    quizzes: { total: individualQuizzes.length, extracted: 0, failed: 0, skipped: 0 },
    syllabus: { total: syllabusUrls.length, extracted: 0, failed: 0, skipped: 0 }
  };
  let filesDiscoveredFromLists = 0;
  let filesDownloadedFromLists = 0;
  let filesDownloadFailures = 0;
  
  // Progress tracking (will be updated after requests array is built)
  let totalProcessed = 0;
  let totalToProcess = 0; // Will be set after requests array is built

  // Helper function to normalize URLs for matching (remove query params, trailing slashes, etc.)
  const normalizeUrlForMatching = (url) => {
    if (!url) return null;
    try {
      const urlObj = new URL(url);
      // Remove query parameters and hash for matching
      return `${urlObj.origin}${urlObj.pathname}`.replace(/\/$/, '');
    } catch {
      // If URL parsing fails, just remove query params manually
      return url.split('?')[0].split('#')[0].replace(/\/$/, '');
    }
  };

  const normalizeDownloadUrl = (rawUrl) => {
    if (!rawUrl) return null;
    let normalized = rawUrl;
    if (normalized.startsWith('/')) {
      normalized = `${CANVAS_URL}${normalized}`;
    }
    if (normalized.includes('/files/') && !normalized.includes('/download')) {
      normalized = `${normalized.replace(/\?.*$/, '')}/download?download_frd=1`;
    }
    return normalized;
  };

  // Map to track page URLs to module information for location metadata
  const pageToModuleMap = new Map();

  console.log(`   Found ${individualAssignments.length} assignments to extract`);
  console.log(`   Found ${moduleUrls.length} module pages to extract`);
  console.log(`   Found ${fileListUrls.length} file folders to extract`);
  console.log(`   Found ${individualPages.length} pages to extract`);
  console.log(`   Found ${individualAnnouncements.length} announcements to extract`);
  console.log(`   Found ${individualDiscussions.length} discussions to extract`);
  console.log(`   Found ${individualQuizzes.length} quizzes to extract`);
  console.log(`   Found ${syllabusUrls.length} syllabus pages to extract`);

  // Create a fresh RequestQueue for extraction to avoid state issues
  const extractionQueue = await RequestQueue.open(`extraction-${courseId}-${Date.now()}`);
  console.log(`   📋 Created fresh RequestQueue for extraction: extraction-${courseId}-${Date.now()}`);
  
  // Note: maxRequestsPerCrawl will be set dynamically after requests array is built
  // Use a high default value that will be updated after requests are built
  const crawler = new PlaywrightCrawler({
    requestQueue: extractionQueue,
    maxRequestsPerCrawl: 1000, // Default high value, will be updated after requests are built
    async requestHandler({ request, page, log, enqueueLinks }) {
      const url = request.loadedUrl || request.url;
      if (isStudentDataUrl(url)) {
        log.info(`   🚫 Skipping student-specific page during extraction: ${url}`);
        return;
      }
      const classification = classifyCanvasUrl(url, courseId) || request.userData?.type;
      const trackAuthSuccess = () => {
        if (authState) {
          authState.recordSuccess(`extraction:${url}`);
        }
      };
      const trackAuthFailure = (reason) => {
        if (authState) {
          authState.recordFailure(reason, { url, phase: 'extraction' });
        }
      };
      
      console.log(`   🔍 Extracting: ${url} [${classification}]`);
      log.info(`Extracting: ${url} [${classification}]`);
      
      // Verify cookies are set
      try {
        const context = page.context();
        const contextCookies = await context.cookies();
        console.log(`   🍪 Context has ${contextCookies.length} cookies before navigation`);
        
        // Always inject fresh cookies
        const cookies = await loadCookies(false); // Don't retry here, already validated at startup
        const cookiesWithDomain = cookies.map(cookie => ({
          ...cookie,
          domain: cookie.domain || new URL(CANVAS_URL).hostname
        }));
        await context.addCookies(cookiesWithDomain);
        console.log(`   ✅ Injected ${cookiesWithDomain.length} cookies for extraction`);
      } catch (cookieError) {
        console.error(`   ❌ Cookie injection failed: ${cookieError.message}`);
      }

      try {
        // Check if this is already a retry - if so, we should fail fast on 401/403
        const retryCount = request.retryCount || 0;
        const isRetry = retryCount > 0;
        
        console.log(`   ⏳ Navigating to ${url}...${isRetry ? ` (retry #${retryCount})` : ''}`);
        
        // Fast 401 detection: intercept responses immediately
        let responseStatus = null;
        let authErrorDetected = false;
        let authErrorUrl = null;
        let mainResponseReceived = false;
        let mainResponsePromise = null;
        let mainResponseResolver = null;
        
        // Create a promise that resolves when we get the main page response
        mainResponsePromise = new Promise((resolve) => {
          mainResponseResolver = resolve;
        });
        
        const responseHandler = (response) => {
          const status = response.status();
          const responseUrl = response.url();
          
          // Only mark as auth error if it's the main page response (not sub-resources)
          // Sub-resources (images, CSS, etc.) can have 401/403 without being an auth issue
          if (responseUrl === url) {
            // This is the main page response
            responseStatus = status;
            mainResponseReceived = true;
            
            if (AUTH_STATUS_CODES.includes(status)) {
              authErrorDetected = true;
              authErrorUrl = responseUrl;
              markRequestAsUnauthorized(request, `HTTP ${status} for ${responseUrl}`);
              console.log(`   ⚠️  HTTP ${status} for main page ${responseUrl}`);
              log.warn(`HTTP ${status} for main page ${responseUrl}`);
              trackAuthFailure(`HTTP ${status} for ${responseUrl}`);
            } else if (status === 200) {
              console.log(`   ✅ Successfully loaded ${url}`);
              trackAuthSuccess();
            } else if (status >= 400) {
              console.log(`   ⚠️  HTTP ${status} for ${responseUrl}`);
            }
            
            // Resolve the promise when we get the main response
            if (mainResponseResolver) {
              mainResponseResolver();
              mainResponseResolver = null;
            }
          } else if (status >= 400 && status !== 401 && status !== 403) {
            console.log(`   ⚠️  HTTP ${status} for ${responseUrl}`);
          }
        };
        
        page.on('response', responseHandler);
        
        // Wait for the main response to be received (with timeout)
        await Promise.race([
          mainResponsePromise,
          page.waitForTimeout(5000).then(() => {
            if (!mainResponseReceived) {
              console.log(`   ⏳ Main response not received yet, continuing...`);
            }
          })
        ]).catch(() => {});
        
        // If this is a retry and we detected 401/403, fail immediately
        if (isRetry && authErrorDetected && (responseStatus === 401 || responseStatus === 403)) {
          page.off('response', responseHandler);
          console.log(`   ❌ HTTP ${responseStatus} on retry for ${url} - failing immediately`);
          markRequestAsUnauthorized(request, `HTTP ${responseStatus} on retry`);
          throw new Error(`HTTP ${responseStatus} detected on retry - unauthorized access for ${url}`);
        }
        
        // Wait for page to load and content to be ready
        // For assignments, use domcontentloaded (faster than networkidle) and conditionally wait for LTI iframes
        if (classification === 'assignment' || request.userData?.type === 'assignment') {
          // Use domcontentloaded instead of networkidle for faster loading
          await page.waitForLoadState('domcontentloaded', { timeout: 5000 }).catch(() => {});
          
          // Fast detection: Check for Canvas "Access Denied" page immediately
          const isAccessDenied = await detectAccessDeniedPage(page);
          if (isAccessDenied) {
            page.off('response', responseHandler);
            console.log(`   ❌ Access Denied page detected for ${url} - failing immediately`);
            log.warn(`Access Denied page detected for ${url} - skipping`);
            markRequestAsUnauthorized(request, 'Access Denied (assignment)');
            trackAuthFailure('Access Denied page (assignment)');
            throw new Error(`Access Denied page detected for ${url}`);
          }
          
          // Check again after load - but don't fail immediately, let retry happen
          // We'll check for Access Denied page below which is a clearer indicator
          
          await page.waitForSelector('h1, h2, .assignment-title, .user_content, main', { timeout: 3000 }).catch(() => {});
          // LTI iframe wait is now handled in postNavigationHooks with conditional check
        } else if (classification === 'file' || request.userData?.type === 'file') {
          await page.waitForLoadState('domcontentloaded', { timeout: 3000 }).catch(() => {});
          const isAccessDenied = await detectAccessDeniedPage(page);
          if (isAccessDenied) {
            page.off('response', responseHandler);
            console.log(`   ❌ Access Denied page detected for ${url} - failing immediately`);
            markRequestAsUnauthorized(request, 'Access Denied (file)');
            trackAuthFailure('Access Denied page (file)');
            throw new Error(`Access Denied page detected for ${url}`);
          }
          await page.waitForSelector('h2, h1, a[href*="/download"]', { timeout: 3000 }).catch(() => {});
        } else if (classification === 'files-list' || request.userData?.type === 'files-list') {
          await page.waitForLoadState('domcontentloaded', { timeout: 5000 }).catch(() => {});
          const isAccessDenied = await detectAccessDeniedPage(page);
          if (isAccessDenied) {
            page.off('response', responseHandler);
            console.log(`   ❌ Access Denied page detected for ${url} - failing immediately`);
            markRequestAsUnauthorized(request, 'Access Denied (files-list)');
            trackAuthFailure('Access Denied page (files-list)');
            throw new Error(`Access Denied page detected for ${url}`);
          }
          await page.waitForSelector('.ef-file-list .ef-item-row, [data-testid="file"], .ef-folder-list', { timeout: 3000 }).catch(() => {});
        } else if (classification === 'page' || request.userData?.type === 'page') {
          await page.waitForLoadState('domcontentloaded', { timeout: 3000 }).catch(() => {});
          const isAccessDenied = await detectAccessDeniedPage(page);
          if (isAccessDenied) {
            page.off('response', responseHandler);
            console.log(`   ❌ Access Denied page detected for ${url} - failing immediately`);
            markRequestAsUnauthorized(request, 'Access Denied (page)');
            trackAuthFailure('Access Denied page (page)');
            throw new Error(`Access Denied page detected for ${url}`);
          }
          await page.waitForSelector('h1, h2, .page-content, .user_content, main', { timeout: 3000 }).catch(() => {});
        } else if (classification === 'announcement' || request.userData?.type === 'announcement' || request.userData?.isAnnouncement) {
          await page.waitForLoadState('domcontentloaded', { timeout: 3000 }).catch(() => {});
          const isAccessDenied = await detectAccessDeniedPage(page);
          if (isAccessDenied) {
            page.off('response', responseHandler);
            console.log(`   ❌ Access Denied page detected for ${url} - failing immediately`);
            markRequestAsUnauthorized(request, 'Access Denied (announcement)');
            trackAuthFailure('Access Denied page (announcement)');
            throw new Error(`Access Denied page detected for ${url}`);
          }
          await page.waitForSelector('h1, h2, .discussion-topic, .announcement, main', { timeout: 3000 }).catch(() => {});
        } else if (classification === 'announcements-list' || request.userData?.type === 'announcements-list') {
          await page.waitForLoadState('domcontentloaded', { timeout: 3000 }).catch(() => {});
          const isAccessDenied = await detectAccessDeniedPage(page);
          if (isAccessDenied) {
            page.off('response', responseHandler);
            console.log(`   ❌ Access Denied page detected for ${url} - failing immediately`);
            markRequestAsUnauthorized(request, 'Access Denied (announcements list)');
            trackAuthFailure('Access Denied page (announcements list)');
            throw new Error(`Access Denied page detected for ${url}`);
          }
          await page.waitForSelector('.discussion-list, .announcements-list, a[href*="/discussion_topics/"]', { timeout: 3000 }).catch(() => {});
        } else if (classification === 'discussion' || request.userData?.type === 'discussion') {
          await page.waitForLoadState('domcontentloaded', { timeout: 3000 }).catch(() => {});
          const isAccessDenied = await detectAccessDeniedPage(page);
          if (isAccessDenied) {
            page.off('response', responseHandler);
            console.log(`   ❌ Access Denied page detected for ${url} - failing immediately`);
            markRequestAsUnauthorized(request, 'Access Denied (discussion)');
            trackAuthFailure('Access Denied page (discussion)');
            throw new Error(`Access Denied page detected for ${url}`);
          }
          await page.waitForSelector('h1, h2, .discussion-topic, .discussion, main', { timeout: 3000 }).catch(() => {});
        } else if (classification === 'quiz' || request.userData?.type === 'quiz') {
          await page.waitForLoadState('domcontentloaded', { timeout: 3000 }).catch(() => {});
          const isAccessDenied = await detectAccessDeniedPage(page);
          if (isAccessDenied) {
            page.off('response', responseHandler);
            console.log(`   ❌ Access Denied page detected for ${url} - failing immediately`);
            markRequestAsUnauthorized(request, 'Access Denied (quiz)');
            trackAuthFailure('Access Denied page (quiz)');
            throw new Error(`Access Denied page detected for ${url}`);
          }
          await page.waitForSelector('h1, h2, .quiz-title, .quiz, main', { timeout: 3000 }).catch(() => {});
        } else if (classification === 'syllabus' || request.userData?.type === 'syllabus') {
          await page.waitForLoadState('domcontentloaded', { timeout: 3000 }).catch(() => {});
          const isAccessDenied = await detectAccessDeniedPage(page);
          if (isAccessDenied) {
            page.off('response', responseHandler);
            console.log(`   ❌ Access Denied page detected for ${url} - failing immediately`);
            markRequestAsUnauthorized(request, 'Access Denied (syllabus)');
            trackAuthFailure('Access Denied page (syllabus)');
            throw new Error(`Access Denied page detected for ${url}`);
          }
          await page.waitForSelector('h1, h2, .syllabus, .syllabus-content, main', { timeout: 3000 }).catch(() => {});
        }
        
        // Final check for Access Denied page and auth errors before processing
        const isAccessDenied = await detectAccessDeniedPage(page);
        if (isAccessDenied) {
          page.off('response', responseHandler);
          console.log(`   ❌ Access Denied page detected for ${url} - failing immediately`);
          markRequestAsUnauthorized(request, 'Access Denied (final pre-processing)');
          trackAuthFailure('Access Denied page (final pre-processing)');
          throw new Error(`Access Denied page detected for ${url}`);
        }
        
        // Only fail fast if Access Denied page is detected (clear auth failure) or on retry with 401/403
        // Otherwise, let the retry mechanism handle 401/403 responses
        // The failedRequestHandler will check if we've retried and still getting 401/403
        
        // Clean up response handler
        page.off('response', responseHandler);

        let extractedData = null;

        // Extract based on content type
        if ((classification === 'assignment' || request.userData?.type === 'assignment') && url.match(/\/assignments\/\d+$/)) {
          // Check if this is a myBusinessCourse assignment (needs longer timeout for OIDC flow)
          const isMyBusinessCourse = await page.evaluate(() => {
            // Check for myBusinessCourse forms or content
            const forms = document.querySelectorAll('form[action*="mybusinesscourse"], form[data-tool-id*="mybusinesscourse"]');
            if (forms.length > 0) return true;
            const toolWrappers = document.querySelectorAll('.tool_content_wrapper');
            for (const wrapper of toolWrappers) {
              const form = wrapper.querySelector('form');
              if (form && (form.action.includes('mybusinesscourse') || form.getAttribute('data-tool-id')?.includes('mybusinesscourse'))) {
                return true;
              }
            }
            return false;
          }).catch(() => false);
          
          if (isMyBusinessCourse) {
            console.log(`   ⏱️  Detected myBusinessCourse assignment - using extended timeout`);
            // Give extra time for OIDC flow
            await page.waitForTimeout(3000).catch(() => {});
          }
          
          // Phase 1.6: Pass skipLTI flag and submission status from list page to assignment extractor
          const assignmentId = url.match(/\/assignments\/(\d+)/)?.[1];
          const listPageStatus = assignmentStatusMap.get(assignmentId);
          extractedData = await extractAssignment(page, url, { 
            skipLTI: request.userData?.skipLTI === true,
            listPageStatus: listPageStatus || null
          });
          if (extractedData && !extractedData.error) {
            const itemKey = extractedData.assignmentId || url;
            if (!pushedItems.assignments.has(itemKey)) {
              pushedItems.assignments.add(itemKey);
              // Non-blocking write for better performance
              assignmentsDataset.pushData(extractedData).catch(err => {
                log.debug(`Failed to write assignment data: ${err.message}`);
              });
              extractionStats.assignments.extracted++;
              totalProcessed++;
              if (totalProcessed % 10 === 0 || totalProcessed === totalToProcess) {
                console.log(`   📊 Progress: ${totalProcessed}/${totalToProcess} (${((totalProcessed/totalToProcess)*100).toFixed(1)}%)`);
              }
            } else {
              extractionStats.assignments.skipped++;
              log.debug(`Skipping duplicate assignment: ${url}`);
            }
          } else if (extractedData && extractedData.error) {
            extractionStats.assignments.failed++;
          }
        } else if (classification === 'module' || request.userData?.type === 'module') {
          extractedData = await extractModules(page, url);
          if (extractedData && !extractedData.error) {
            const itemKey = extractedData.moduleId || url;
            if (!pushedItems.modules.has(itemKey)) {
              pushedItems.modules.add(itemKey);
              
              // Build mapping of page URLs to module information for location metadata
              if (extractedData.modules && Array.isArray(extractedData.modules)) {
                extractedData.modules.forEach(module => {
                  if (module.items && Array.isArray(module.items)) {
                    module.items.forEach(item => {
                      // Track pages found in modules (normalize URL for matching)
                      if (item.type === 'page' && item.url) {
                        const normalizedUrl = normalizeUrlForMatching(item.url);
                        if (normalizedUrl) {
                          pageToModuleMap.set(normalizedUrl, {
                            moduleName: module.name,
                            moduleId: module.id,
                            moduleIndex: module.index
                          });
                        }
                      }
                    });
                  }
                });
              }
              
              // Non-blocking write for better performance
              modulesDataset.pushData(extractedData).catch(err => {
                log.debug(`Failed to write module data: ${err.message}`);
              });
              extractionStats.modules.extracted++;
              totalProcessed++;
              if (totalProcessed % 10 === 0 || totalProcessed === totalToProcess) {
                console.log(`   📊 Progress: ${totalProcessed}/${totalToProcess} (${((totalProcessed/totalToProcess)*100).toFixed(1)}%)`);
              }
            } else {
              extractionStats.modules.skipped++;
              log.debug(`Skipping duplicate module: ${url}`);
            }

            if (Array.isArray(extractedData.moduleFiles) && extractedData.moduleFiles.length > 0) {
              extractedData.moduleFiles.forEach((moduleFile, moduleFileIndex) => {
                if (!moduleFile) return;
                const moduleFileKey = moduleFile.moduleItemId
                  ? `module-item:${moduleFile.moduleItemId}`
                  : moduleFile.fileId || moduleFile.fileUrl || `${moduleFileIndex}-${moduleFile.moduleName || ''}`;
                if (pushedItems.files.has(moduleFileKey)) {
                  extractionStats.files.skipped++;
                  return;
                }
                pushedItems.files.add(moduleFileKey);
                const folderSegments = ['Modules'];
                if (moduleFile.moduleName) {
                  folderSegments.push(moduleFile.moduleName);
                }
                const downloadUrl = normalizeDownloadUrl(moduleFile.downloadUrl || moduleFile.fileUrl);
                const fileRecord = {
                  source: 'module',
                  courseId,
                  fileId: moduleFile.fileId || null,
                  name: moduleFile.fileName || moduleFile.moduleItemTitle || `module_file_${moduleFileIndex + 1}`,
                  moduleId: moduleFile.moduleId || null,
                  moduleName: moduleFile.moduleName || null,
                  modulePosition: moduleFile.modulePosition || null,
                  moduleItemId: moduleFile.moduleItemId || null,
                  moduleItemTitle: moduleFile.moduleItemTitle || null,
                  moduleItemType: moduleFile.moduleItemType || null,
                  moduleItemPosition: moduleFile.moduleItemPosition || null,
                  moduleItemUrl: moduleFile.moduleItemUrl || url,
                  downloadUrl,
                  sourcePageUrl: moduleFile.moduleItemUrl || url,
                  folderPath: folderSegments,
                  folderPathString: folderSegments.join('/'),
                  published: moduleFile.published,
                  indent: moduleFile.indent || 0,
                  completionRequirement: moduleFile.completionRequirement || null,
                  extractedAt: new Date().toISOString()
                };
                filesDataset.pushData(fileRecord).catch(err => {
                  log.debug(`Failed to write module-derived file data: ${err.message}`);
                });
                filesDiscoveredFromLists++;
                extractionStats.files.extracted++;
              });
            }
          } else if (extractedData && extractedData.error) {
            extractionStats.modules.failed++;
          }
        } else if ((classification === 'files-list' || request.userData?.type === 'files-list') && url.match(/\/courses\/\d+\/files/)) {
          let filesListData = null;
          try {
            filesListData = await extractFiles(page, url);
          } catch (extractError) {
            console.log(`   ❌ Failed to extract files from ${url}: ${extractError.message}`);
            log.error(`Failed to extract files list: ${extractError.stack || extractError.message}`);
          }

          if (filesListData && !filesListData.error) {
            const folderPath = filesListData.currentPath || [];
            const folderPathString = folderPath.length > 0 ? folderPath.join('/') : 'root';
            const filesInFolder = filesListData.files || [];
            console.log(`   📁 Processing folder: ${folderPathString} (${filesInFolder.length} files)`);

            const storageRoot = process.env.CRAWLEE_STORAGE_DIR
              || path.join(__dirname, '..', '..', 'storage', 'datasets', getExtractionFolder());
            const courseDownloadsRoot = path.join(storageRoot, getCourseFolderPath(), 'downloads');
            const downloadsBaseDir = path.join(courseDownloadsRoot, 'files');
            if (!fs.existsSync(downloadsBaseDir)) {
              fs.mkdirSync(downloadsBaseDir, { recursive: true });
            }

            const sanitizedFolderSegments = folderPath
              .map(segment => {
                const sanitized = sanitizeFilename(segment || '');
                return sanitized || null;
              })
              .filter(Boolean);

            let folderSucceeded = filesInFolder.length === 0;
            if (filesInFolder.length === 0) {
              try {
                const debugHtmlPath = path.join(storageRoot, `debug-files-${courseId}-${Date.now()}.html`);
                fs.writeFileSync(debugHtmlPath, await page.content());
                console.log(`   🐛 Saved files page HTML for debugging: ${debugHtmlPath}`);
              } catch (debugErr) {
                log.debug(`Unable to persist files page HTML: ${debugErr.message}`);
              }
            }

            for (const file of filesInFolder) {
              filesDiscoveredFromLists++;
              if (!file.name) {
                console.log('   ⚠️  Skipping file without name');
                continue;
              }

              if (!file.downloadUrl && file.fileId) {
                try {
                  const baseUrl = new URL(url);
                  file.downloadUrl = `${baseUrl.origin}/files/${file.fileId}/download?download_frd=1`;
                } catch {
                  // ignore
                }
              }

              if (!file.downloadUrl && file.url) {
                try {
                  const fileUrlObj = new URL(file.url);
                  const idMatch = fileUrlObj.pathname.match(/\/files\/(\d+)/);
                  if (idMatch) {
                    file.fileId = file.fileId || idMatch[1];
                    file.downloadUrl = `${fileUrlObj.origin}/files/${file.fileId}/download?download_frd=1`;
                  }
                } catch {
                  // ignore
                }
              }

              if (!file.downloadUrl) {
                console.log(`   ⚠️  Skipping ${file.name} - missing download URL`);
                filesDownloadFailures++;
                continue;
              }

              const itemKey = file.fileId || file.url || `${folderPathString}/${file.name}`;
              if (pushedItems.files.has(itemKey)) {
                extractionStats.files.skipped++;
                log.debug(`Skipping duplicate file from files list: ${file.name}`);
                continue;
              }

              const filenameSafe = sanitizeFilename(file.name) || `file_${file.fileId || Date.now()}`;
              const folderDir = sanitizedFolderSegments.length > 0
                ? path.join(downloadsBaseDir, ...sanitizedFolderSegments)
                : downloadsBaseDir;
              if (!fs.existsSync(folderDir)) {
                fs.mkdirSync(folderDir, { recursive: true });
              }
              const downloadPath = path.join(folderDir, filenameSafe);

              const downloadResult = await downloadFile(page, file.downloadUrl, downloadPath, { timeout: 60000 });
              if (!downloadResult.success) {
                console.log(`   ❌ Failed to download ${file.name}: ${downloadResult.error}`);
                filesDownloadFailures++;
                continue;
              }

              const relativePath = path.relative(storageRoot, downloadResult.filePath);
              const fileData = {
                courseId: filesListData.courseId || courseId,
                fileId: file.fileId || null,
                name: file.name,
                folderPath,
                folderPathString,
                downloadUrl: file.downloadUrl,
                sourcePageUrl: url,
                storagePath: relativePath,
                size: file.size || `${(downloadResult.size / 1024).toFixed(2)} KB`,
                sizeBytes: downloadResult.size,
                type: file.type || (file.name.match(/\.(\w+)$/)?.[1]?.toLowerCase() || null),
                modifiedDate: file.modifiedDate || null,
                uploader: file.uploader || null,
                extractedAt: new Date().toISOString()
              };

              pushedItems.files.add(itemKey);
              filesDataset.pushData(fileData).catch(err => {
                log.debug(`Failed to write file list data: ${err.message}`);
              });
              filesDownloadedFromLists++;
              folderSucceeded = true;
            }

            if (folderSucceeded) {
              extractionStats.files.extracted++;
            } else {
              extractionStats.files.failed++;
            }
            totalProcessed++;
            trackAuthSuccess();
            if (totalProcessed % 10 === 0 || totalProcessed === totalToProcess) {
              console.log(`   📊 Progress: ${totalProcessed}/${totalToProcess} (${((totalProcessed/totalToProcess)*100).toFixed(1)}%)`);
            }
          } else if (filesListData && filesListData.error) {
            extractionStats.files.failed++;
            console.log(`   ❌ Failed to extract files from ${url}: ${filesListData.error}`);
          }
        } else if ((classification === 'file' || request.userData?.type === 'file') && url.match(/\/files\/\d+/) && !url.includes('/download')) {
          extractedData = await extractFileMetadata(page, url);
          if (extractedData && !extractedData.error) {
            const itemKey = extractedData.fileId || url;
            if (!pushedItems.files.has(itemKey)) {
              pushedItems.files.add(itemKey);
              // Non-blocking write for better performance
              filesDataset.pushData(extractedData).catch(err => {
                log.debug(`Failed to write file data: ${err.message}`);
              });
              extractionStats.files.extracted++;
              totalProcessed++;
              if (totalProcessed % 10 === 0 || totalProcessed === totalToProcess) {
                console.log(`   📊 Progress: ${totalProcessed}/${totalToProcess} (${((totalProcessed/totalToProcess)*100).toFixed(1)}%)`);
              }
            } else {
              extractionStats.files.skipped++;
              log.debug(`Skipping duplicate file: ${url}`);
            }
          } else if (extractedData && extractedData.error) {
            extractionStats.files.failed++;
          }
        } else if ((classification === 'page' || request.userData?.type === 'page') && url.match(/\/pages\/[^\/]+$/)) {
          // Pass location context if available (e.g., from module extraction)
          // First check request.userData, then check the pageToModuleMap (with normalized URL)
          let locationContext = request.userData?.locationContext || null;
          if (!locationContext) {
            const normalizedUrl = normalizeUrlForMatching(url);
            if (normalizedUrl && pageToModuleMap.has(normalizedUrl)) {
              locationContext = pageToModuleMap.get(normalizedUrl);
            }
          }
          extractedData = await extractPage(page, url, { locationContext });
          if (extractedData && !extractedData.error) {
            const itemKey = extractedData.pageSlug || url;
            if (!pushedItems.pages.has(itemKey)) {
              pushedItems.pages.add(itemKey);
              // Non-blocking write for better performance
              pagesDataset.pushData(extractedData).catch(err => {
                log.debug(`Failed to write page data: ${err.message}`);
              });
              extractionStats.pages.extracted++;
              totalProcessed++;
              if (totalProcessed % 10 === 0 || totalProcessed === totalToProcess) {
                console.log(`   📊 Progress: ${totalProcessed}/${totalToProcess} (${((totalProcessed/totalToProcess)*100).toFixed(1)}%)`);
              }
            } else {
              extractionStats.pages.skipped++;
              log.debug(`Skipping duplicate page: ${url}`);
            }
          } else if (extractedData && extractedData.error) {
            extractionStats.pages.failed++;
          }
        } else if ((classification === 'announcement' || request.userData?.type === 'announcement' || request.userData?.isAnnouncement) && url.match(/\/discussion_topics\/\d+/)) {
          extractedData = await extractAnnouncement(page, url);
          if (extractedData && !extractedData.error) {
            const itemKey = extractedData.announcementId || url;
            if (!pushedItems.announcements.has(itemKey)) {
              pushedItems.announcements.add(itemKey);
              // Non-blocking write for better performance
              announcementsDataset.pushData(extractedData).catch(err => {
                log.debug(`Failed to write announcement data: ${err.message}`);
              });
              extractionStats.announcements.extracted++;
              totalProcessed++;
              if (totalProcessed % 10 === 0 || totalProcessed === totalToProcess) {
                console.log(`   📊 Progress: ${totalProcessed}/${totalToProcess} (${((totalProcessed/totalToProcess)*100).toFixed(1)}%)`);
              }
            } else {
              extractionStats.announcements.skipped++;
              log.debug(`Skipping duplicate announcement: ${url}`);
            }
          } else if (extractedData && extractedData.error) {
            extractionStats.announcements.failed++;
          }
        } else if ((classification === 'discussion' || request.userData?.type === 'discussion') && url.match(/\/discussion_topics\/\d+/)) {
          // Fix: Check if this discussion is actually an announcement
          // Try extracting as announcement first, then fall back to discussion if it's not
          let extractedAsAnnouncement = false;
          try {
            const announcementData = await extractAnnouncement(page, url);
            if (announcementData && !announcementData.error && announcementData.isAnnouncement) {
              // This is actually an announcement
              const itemKey = announcementData.announcementId || url;
              if (!pushedItems.announcements.has(itemKey)) {
                pushedItems.announcements.add(itemKey);
                // Non-blocking write for better performance
                announcementsDataset.pushData(announcementData).catch(err => {
                  log.debug(`Failed to write announcement data: ${err.message}`);
                });
                extractionStats.announcements.extracted++;
                totalProcessed++;
                if (totalProcessed % 10 === 0 || totalProcessed === totalToProcess) {
                  console.log(`   📊 Progress: ${totalProcessed}/${totalToProcess} (${((totalProcessed/totalToProcess)*100).toFixed(1)}%)`);
                }
                extractedAsAnnouncement = true;
                log.info(`Found announcement in discussions: ${url}`);
              } else {
                extractionStats.announcements.skipped++;
                extractedAsAnnouncement = true; // Already extracted as announcement
              }
            }
          } catch (announcementError) {
            // Not an announcement, continue to extract as discussion
            log.debug(`Not an announcement, extracting as discussion: ${url}`);
          }
          
          // If not extracted as announcement, extract as discussion
          if (!extractedAsAnnouncement) {
            extractedData = await extractDiscussion(page, url);
            if (extractedData && !extractedData.error) {
              const itemKey = extractedData.discussionId || url;
              if (!pushedItems.discussions.has(itemKey)) {
                pushedItems.discussions.add(itemKey);
                // Non-blocking write for better performance
                discussionsDataset.pushData(extractedData).catch(err => {
                  log.debug(`Failed to write discussion data: ${err.message}`);
                });
                extractionStats.discussions.extracted++;
                totalProcessed++;
                if (totalProcessed % 10 === 0 || totalProcessed === totalToProcess) {
                  console.log(`   📊 Progress: ${totalProcessed}/${totalToProcess} (${((totalProcessed/totalToProcess)*100).toFixed(1)}%)`);
                }
              } else {
                extractionStats.discussions.skipped++;
                log.debug(`Skipping duplicate discussion: ${url}`);
              }
            } else if (extractedData && extractedData.error) {
              extractionStats.discussions.failed++;
            }
          }
        } else if ((classification === 'quiz' || request.userData?.type === 'quiz') && url.match(/\/quizzes\/\d+$/)) {
          extractedData = await extractQuiz(page, url);
          if (extractedData && !extractedData.error) {
            const itemKey = extractedData.quizId || url;
            if (!pushedItems.quizzes.has(itemKey)) {
              pushedItems.quizzes.add(itemKey);
              // Non-blocking write for better performance
              quizzesDataset.pushData(extractedData).catch(err => {
                log.debug(`Failed to write quiz data: ${err.message}`);
              });
              extractionStats.quizzes.extracted++;
              totalProcessed++;
              if (totalProcessed % 10 === 0 || totalProcessed === totalToProcess) {
                console.log(`   📊 Progress: ${totalProcessed}/${totalToProcess} (${((totalProcessed/totalToProcess)*100).toFixed(1)}%)`);
              }
            } else {
              extractionStats.quizzes.skipped++;
              log.debug(`Skipping duplicate quiz: ${url}`);
            }
          } else if (extractedData && extractedData.error) {
            extractionStats.quizzes.failed++;
          }
        } else if ((classification === 'syllabus' || request.userData?.type === 'syllabus') && url.match(/\/courses\/\d+\/syllabus/)) {
          extractedData = await extractSyllabus(page, url);
          if (extractedData && !extractedData.error) {
            const itemKey = url; // Syllabus is typically one per course
            if (!pushedItems.syllabus.has(itemKey)) {
              pushedItems.syllabus.add(itemKey);
              // Non-blocking write for better performance
              syllabusDataset.pushData(extractedData).catch(err => {
                log.debug(`Failed to write syllabus data: ${err.message}`);
              });
              extractionStats.syllabus.extracted++;
              totalProcessed++;
              if (totalProcessed % 10 === 0 || totalProcessed === totalToProcess) {
                console.log(`   📊 Progress: ${totalProcessed}/${totalToProcess} (${((totalProcessed/totalToProcess)*100).toFixed(1)}%)`);
              }
            } else {
              extractionStats.syllabus.skipped++;
              log.debug(`Skipping duplicate syllabus: ${url}`);
            }
          } else if (extractedData && extractedData.error) {
            extractionStats.syllabus.failed++;
          }
        } else if (classification === 'announcements-list' || request.userData?.type === 'announcements-list' || (url.includes('/announcements') && !url.match(/\/announcements\/\d+/))) {
          // Extract announcements from the announcements list page
          const announcementsFromPage = await extractAnnouncementsFromList(page, url, courseId);
          if (announcementsFromPage && announcementsFromPage.length > 0) {
            // Don't store list data - only enqueue for full extraction to avoid duplicates
            log.info(`Found ${announcementsFromPage.length} announcements from list page`);
            
            // Enqueue individual announcement pages for full extraction
            const announcementUrls = announcementsFromPage
              .filter(a => a.url && a.url.match(/\/discussion_topics\/\d+/))
              .map(a => a.url);
            
            if (announcementUrls.length > 0 && enqueueLinks) {
              log.info(`Enqueueing ${announcementUrls.length} announcement pages for full extraction`);
              // enqueueLinks expects an array of URL strings or Request objects
              await enqueueLinks({
                urls: announcementUrls,
                transformRequestFunction: (request) => {
                  request.userData = { type: 'announcement', isAnnouncement: true };
                  return request;
                },
                label: 'announcement-full-extraction'
              });
            }
          }
        }

        if (extractedData && extractedData.error) {
          console.warn(`Failed to extract ${url}: ${extractedData.error}`);
        }
      } catch (error) {
        if (isAuthenticationLostError(error)) {
          throw error;
        }
        console.error(`Error extracting ${url}: ${error.message}`);
      }
    },
    maxConcurrency: MAX_CONCURRENCY,
    // maxRequestsPerCrawl will be set dynamically in runExtractionPhase after requests are added
    maxRequestRetries: 1, // Retry once before failing
    requestHandlerTimeoutSecs: 30, // 30 seconds max per request (unchanged)
    retryOnBlocked: false, // Disable automatic retry on blocked requests - we handle 401/403 manually
    sessionPoolOptions: {
      blockedStatusCodes: BLOCKED_STATUS_CODES
    },
    failedRequestHandler: async ({ request, error, log }) => {
      // Only fail fast on 401/403 when it's clearly an authentication/unauthorized issue
      const errorMessage = error?.message || '';
      
      // Check if request is already marked to not retry
      if (request.userData?.noRetry === true) {
        log.warn(`Skipping retry for ${request.url} - marked as noRetry`);
        request.noRetry = true;
        return; // Don't retry
      }
      
      // Only fail fast if:
      // 1. We detect 401/403 or explicit Access Denied markers, OR
      // 2. The error message explicitly mentions authentication/unauthorized issues
      const isUnauthorizedAuthError = 
        errorMessage.includes('401') ||
        errorMessage.includes('403') ||
        errorMessage.includes('unauthorized access') ||
        error?.statusCode === 401 ||
        error?.statusCode === 403 ||
        errorMessage.includes('Access Denied') ||
        errorMessage.includes('Authentication failed') ||
        errorMessage.includes('Unauthorized') ||
        request.userData?.authError === true; // Set when Access Denied page is detected
      
      // Don't fail fast on quiz questions - they're often legitimately protected
      const isQuizQuestion = request.url && request.url.includes('/quizzes/') && request.url.includes('/questions/');
      
      if (isUnauthorizedAuthError && !isQuizQuestion) {
        log.warn(`Failing fast for ${request.url} - confirmed unauthorized (401/403 after retry or Access Denied detected)`);
        markRequestAsUnauthorized(request, 'Unauthorized detected in failedRequestHandler');
        if (authState) {
          authState.recordFailure('Unauthorized detected during failed request handler', { url: request.url, phase: 'extraction' });
        }
        return; // Don't retry - mark as failed immediately
      }
      
      // For quiz questions that fail, skip retries (they're often protected)
      if (isQuizQuestion) {
        log.warn(`Skipping retries for quiz question ${request.url} - likely protected`);
        request.noRetry = true;
        request.userData = { ...request.userData, noRetry: true };
        return; // Don't retry quiz questions
      }
      
      // For other errors, allow retry (maxRequestRetries: 1 means one retry)
    },
    headless: HEADLESS,
    launchContext: {
      launcher: chromium,
      launchOptions: {
        headless: HEADLESS,
        // Performance optimizations for extraction
        args: [
          '--disable-images',
          '--disable-plugins',
          '--disable-extensions',
          '--disable-dev-shm-usage',
          '--disable-gpu',
          '--disable-software-rasterizer',
          '--disable-background-networking',
          '--disable-background-timer-throttling',
          '--disable-renderer-backgrounding',
          '--disable-backgrounding-occluded-windows',
          '--disable-ipc-flooding-protection',
        ],
      },
    },
    preNavigationHooks: [
      async ({ request, page, log }) => {
        // Only inject cookies if context doesn't already have them
        // This reduces overhead and avoids race conditions
        const context = page.context();
        await injectCookiesIfNeeded(context, log);
      }
    ],
    postNavigationHooks: [
      async ({ request, page, log }) => {
        // Optimized LTI Detection - Only wait for iframe if it actually exists
        if (request.userData?.type === 'assignment') {
          // Extract assignment ID for caching
          const assignmentIdMatch = (request.loadedUrl || request.url).match(/\/assignments\/(\d+)/);
          const assignmentId = assignmentIdMatch ? assignmentIdMatch[1] : null;
          
          // First, quickly check if iframe exists (non-blocking check)
          const iframeExists = await page.evaluate(() => {
            return document.querySelector('iframe[src*="tool_launch"]') !== null;
          }).catch(() => false);
          
          if (iframeExists) {
            // Iframe exists, wait for it to load (with timeout to prevent blocking)
            try {
              await page.waitForSelector('iframe[src*="tool_launch"]', { timeout: 8000 }).catch(() => {});
              // Wait for iframe content to load (conditional wait, not fixed)
              // Check if iframe has loaded content
              await page.evaluate(() => {
                const iframe = document.querySelector('iframe[src*="tool_launch"]');
                if (iframe) {
                  // Wait for iframe to have src attribute set (indicates it's loading)
                  return iframe.src && iframe.src.length > 0;
                }
                return false;
              }).catch(() => false);
              
              // Give iframe a short time to render (only if it exists)
              // Use a short conditional wait instead of fixed 3 seconds
              let iframeLoaded = false;
              for (let i = 0; i < 6; i++) { // Check 6 times over ~1 second
                iframeLoaded = await page.evaluate(() => {
                  const iframe = document.querySelector('iframe[src*="tool_launch"]');
                  if (iframe && iframe.contentDocument) {
                    // Iframe has loaded and has content
                    return iframe.contentDocument.body && iframe.contentDocument.body.children.length > 0;
                  }
                  return false;
                }).catch(() => false);
                
                if (iframeLoaded) break;
                await page.waitForTimeout(200); // Short wait between checks
              }
          } catch (e) {
              // Iframe loading failed, continue anyway
              log.debug(`LTI iframe wait failed for ${request.url}: ${e.message}`);
            }
          } else {
            // No iframe found - skip waiting entirely
            log.debug(`No LTI iframe detected for assignment ${assignmentId || request.url}, skipping wait`);
          }
          
          // No caching - fresh detection every time
        }
      }
    ],
  });

  // Build request list from mapping
  const requests = [];
  
  // Add assignment URLs
  individualAssignments.forEach(url => {
    requests.push({ url, userData: { type: 'assignment' } });
  });

  // Add module URLs
  if (moduleUrls.length > 0) {
    moduleUrls.forEach(url => {
      requests.push({ url, userData: { type: 'module' } });
    });
  } else {
    // Try to find modules page
    const modulesUrl = `${CANVAS_URL}/courses/${courseId}/modules`;
    requests.push({ url: modulesUrl, userData: { type: 'module' } });
  }

  // Add file folder URLs
  fileListUrls.forEach(url => {
    requests.push({ url, userData: { type: 'files-list' } });
  });

  // Add page URLs
  individualPages.forEach(url => {
    requests.push({ url, userData: { type: 'page' } });
  });

  // Add announcement URLs - handle both list page and individual announcements
  const announcementsListPageForRequests = individualAnnouncements.find(url => url.includes('/announcements') && !url.match(/\/announcements\/\d+/));
  const individualAnnouncementUrls = individualAnnouncements.filter(url => url.match(/\/discussion_topics\/\d+/));
  
  if (announcementsListPageForRequests) {
    requests.push({ url: announcementsListPageForRequests, userData: { type: 'announcements-list' } });
  }
  
  // Add individual announcement URLs
  individualAnnouncementUrls.forEach(url => {
    requests.push({ url, userData: { type: 'announcement', isAnnouncement: true } });
  });

  // Add discussion URLs
  individualDiscussions.forEach(url => {
    requests.push({ url, userData: { type: 'discussion' } });
  });

  // Add quiz URLs
  individualQuizzes.forEach(url => {
    requests.push({ url, userData: { type: 'quiz' } });
  });

  // Add syllabus URLs
  syllabusUrls.forEach(url => {
    requests.push({ url, userData: { type: 'syllabus' } });
  });

  // If no syllabus URL found in mapping, try to construct it
  if (syllabusUrls.length === 0) {
    const syllabusUrl = `${CANVAS_URL}/courses/${courseId}/syllabus`;
    requests.push({ url: syllabusUrl, userData: { type: 'syllabus' } });
  }

  if (requests.length === 0) {
    console.log('⚠️  No URLs found to extract. Make sure Phase 1 mapping completed successfully.');
    console.log(`   📊 Mapping data summary:`);
    console.log(`      - Assignments: ${individualAssignments.length}`);
    console.log(`      - File folders: ${fileListUrls.length}`);
    console.log(`      - Pages: ${individualPages.length}`);
    console.log(`      - Announcements: ${individualAnnouncements.length}`);
    console.log(`      - Discussions: ${individualDiscussions.length}`);
    console.log(`      - Quizzes: ${individualQuizzes.length}`);
    console.log(`      - Syllabus: ${syllabusUrls.length}`);
    return;
  }

  console.log(`   📤 Processing ${requests.length} URLs...`);
  
  // Update totalToProcess for progress tracking
  totalToProcess = requests.length;
  
  // Calculate maxRequestsPerCrawl: requests.length + buffer for enqueueLinks
  const extractionMaxRequests = Math.max(requests.length * 2, MAX_REQUESTS_PER_CRAWL);
  console.log(`   🚀 Starting extraction crawler with maxRequestsPerCrawl: ${extractionMaxRequests} (default: 1000), maxConcurrency: ${MAX_CONCURRENCY}`);
  // Note: maxRequestsPerCrawl is set to 1000 in crawler constructor (high enough for most cases)
  
  // Add all requests to the queue
  console.log(`   📥 Adding ${requests.length} requests to extraction queue...`);
  for (const req of requests) {
    await extractionQueue.addRequest(req);
  }
  console.log(`   ✅ All requests added to queue`);
  
  try {
    await crawler.run();
    console.log(`   ✅ Extraction crawler finished for course ${courseId}`);
  } catch (extractionError) {
    console.error(`   ❌ Extraction error for course ${courseId}: ${extractionError.message}`);
    console.error(`   Stack: ${extractionError.stack}`);
    throw extractionError;
  }

  const endTime = Date.now();
  const duration = ((endTime - startTime) / 1000).toFixed(2);
  const durationMinutes = (duration / 60).toFixed(2);

  console.log('\n✅ Phase 2 Extraction Complete!');
  
  // Print extraction statistics
  console.log(`\n📊 Extraction Statistics:`);
  const contentTypes = ['assignments', 'modules', 'files', 'pages', 'announcements', 'discussions', 'quizzes', 'syllabus'];
  for (const type of contentTypes) {
    const stats = extractionStats[type];
    const successRate = stats.total > 0 ? ((stats.extracted / stats.total) * 100).toFixed(1) : 0;
    console.log(`   ${type}: ${stats.extracted}/${stats.total} extracted (${successRate}%)${stats.failed > 0 ? `, ${stats.failed} failed` : ''}${stats.skipped > 0 ? `, ${stats.skipped} skipped` : ''}`);
  }
  
  const totalExtracted = contentTypes.reduce((sum, type) => sum + extractionStats[type].extracted, 0);
  const totalFailed = contentTypes.reduce((sum, type) => sum + extractionStats[type].failed, 0);
  const totalSkipped = contentTypes.reduce((sum, type) => sum + extractionStats[type].skipped, 0);
  const totalExpected = contentTypes.reduce((sum, type) => sum + extractionStats[type].total, 0);
  console.log(`   Total: ${totalExtracted}/${totalExpected} extracted (${totalExpected > 0 ? ((totalExtracted / totalExpected) * 100).toFixed(1) : 0}%)${totalFailed > 0 ? `, ${totalFailed} failed` : ''}${totalSkipped > 0 ? `, ${totalSkipped} skipped` : ''}`);
  if (fileListUrls.length > 0) {
    console.log(`   Files tab downloads: ${filesDownloadedFromLists}/${filesDiscoveredFromLists} files downloaded (${filesDownloadFailures} download errors)`);
  }
  
  console.log(`\n⏱️  Performance:`);
  console.log(`   Duration: ${durationMinutes} minutes (${duration} seconds)`);
  console.log(`   Started: ${new Date(startTime).toISOString()}`);
  console.log(`   Finished: ${new Date(endTime).toISOString()}`);
  
  // Output paths use extraction folder structure
  const extractionFolderPath = getExtractionFolder();
  const courseFolderNameForOutput = mappingData?.courseFolderName || `course-${courseId}`;
  const outputPath = `courses/${courseFolderNameForOutput}`;
  console.log(`\n💾 Output:`);
  console.log(`   Extraction folder: ./storage/datasets/${extractionFolderPath}/`);
  console.log(`   All datasets: ./storage/datasets/${extractionFolderPath}/${outputPath}/`);
  console.log(`   Assignments: ./storage/datasets/${extractionFolderPath}/${outputPath}/assignments/`);
  console.log(`   Modules: ./storage/datasets/${extractionFolderPath}/${outputPath}/modules/`);
  console.log(`   Files: ./storage/datasets/${extractionFolderPath}/${outputPath}/files/`);
  console.log(`   Pages: ./storage/datasets/${extractionFolderPath}/${outputPath}/pages/`);
  console.log(`   Announcements: ./storage/datasets/${extractionFolderPath}/${outputPath}/announcements/`);
  console.log(`   Discussions: ./storage/datasets/${extractionFolderPath}/${outputPath}/discussions/`);
  console.log(`   Quizzes: ./storage/datasets/${extractionFolderPath}/${outputPath}/quizzes/`);
  console.log(`   Syllabus: ./storage/datasets/${extractionFolderPath}/${outputPath}/syllabus/`);
}

/**
 * Phase 6: File Downloads
 * Downloads all files and attachments from extracted content
 */
/**
 * Safely get data from a dataset, handling JSON5 parsing errors
 */
async function safeGetDatasetData(dataset, datasetName) {
  try {
    return await dataset.getData();
  } catch (error) {
    if (error.message && error.message.includes('JSON5')) {
      console.error(`   ⚠️  WARNING: Failed to parse dataset "${datasetName}" due to corrupted JSON file`);
      console.error(`   Error: ${error.message}`);
      console.error(`   Continuing with empty dataset...`);
      return { items: [] };
    }
    throw error; // Re-throw non-JSON5 errors
  }
}

async function runDownloadPhase(courseId, options = {}) {
  const { authState = getAuthState(courseId), mappingData = null } = options;
  const startTime = Date.now();
  console.log('\n📥 Phase 6: Starting File Downloads...');
  console.log(`   Course ID: ${courseId}`);
  console.log(`   Canvas URL: ${CANVAS_URL}`);
  console.log(`   Started at: ${new Date().toISOString()}`);

  // Get course folder name from mapping data or fallback to courseId
  const courseFolderName = mappingData?.courseFolderName || `course-${courseId}`;
  console.log(`   Course folder: ${courseFolderName}`);

  const cookies = await loadCookies(false); // Don't retry here, already validated at startup
  const storageDir = process.env.CRAWLEE_STORAGE_DIR || path.join(__dirname, '..', '..', 'storage', 'datasets');
  const downloadStats = {
    total: 0,
    successful: 0,
    failed: 0,
    skipped: 0,
    byType: {}
  };

  // Collect all file URLs from datasets
  const fileDownloads = [];

  // 1. Files from file extractor (use course-specific dataset)
  // Dataset names are relative to CRAWLEE_STORAGE_DIR which is set to the extraction folder
  const datasetPrefix = `courses/${courseFolderName}`;
  const filesDataset = await Dataset.open(`${datasetPrefix}/files`);
  const files = await safeGetDatasetData(filesDataset, `${datasetPrefix}/files`);
  for (const file of files.items || []) {
    if (file.downloadUrl && file.name) {
      // Make URL absolute if it's relative
      let downloadUrl = file.downloadUrl;
      if (downloadUrl.startsWith('/')) {
        downloadUrl = `${CANVAS_URL}${downloadUrl}`;
      }
      if (file.storagePath) {
        const absoluteStoredPath = path.isAbsolute(file.storagePath)
          ? file.storagePath
          : path.join(storageDir, file.storagePath);
        if (fs.existsSync(absoluteStoredPath)) {
          const stats = fs.statSync(absoluteStoredPath);
          console.log(`Skipping (already downloaded via Files tab): ${file.name} (${(stats.size / 1024).toFixed(2)} KB)`);
          continue;
        }
      }
      const downloadType = file.source === 'module' ? 'modules' : 'files';
      fileDownloads.push({
        url: downloadUrl,
        filename: file.name,
        type: downloadType,
        itemId: file.fileId || null,
        metadata: file
      });
    }
  }

  // 2. Files from assignments (attachments) - only actual file attachments (use course-specific dataset, or phase-specific in test mode)
  const assignmentsDataset = await Dataset.open(`${datasetPrefix}/assignments`);
  const assignments = await safeGetDatasetData(assignmentsDataset, `${datasetPrefix}/assignments`);
  for (const assignment of assignments.items || []) {
    if (assignment.attachments && Array.isArray(assignment.attachments) && assignment.attachments.length > 0) {
      assignment.attachments.forEach((attachment, index) => {
        // Only download if it has a valid download URL and name
        if ((attachment.url || attachment.downloadUrl) && attachment.name) {
          let downloadUrl = attachment.downloadUrl || attachment.url;
          // Ensure it's a download URL for Canvas files
          if (downloadUrl.includes('/files/') && !downloadUrl.includes('/download')) {
            downloadUrl = `${downloadUrl.replace(/\?.*$/, '')}/download?download_frd=1`;
          }
          // Make absolute if relative
          if (downloadUrl.startsWith('/')) {
            downloadUrl = `${CANVAS_URL}${downloadUrl}`;
          }
          // Only add if it's actually a file download URL
          if (downloadUrl.includes('/download') || downloadUrl.includes('/files/')) {
            fileDownloads.push({
              url: downloadUrl,
              filename: attachment.name,
              type: 'assignments',
              itemId: assignment.assignmentId || null,
              metadata: attachment
            });
          }
        }
      });
    }
  }

  // 3. Files from pages (embedded files) - only actual file downloads (use course-specific dataset, or phase-specific in test mode)
  const pagesDataset = await Dataset.open(`${datasetPrefix}/pages`);
  const pages = await safeGetDatasetData(pagesDataset, `${datasetPrefix}/pages`);
  for (const page of pages.items || []) {
    if (page.embeddedContent && page.embeddedContent.files) {
      page.embeddedContent.files.forEach((file, index) => {
        // Only download if it's a Canvas file URL (not external links or page links)
        if (file.url && file.url.includes('/files/') && !file.url.includes('?wrap=1') && !file.url.includes('/pages/')) {
          // Ensure it's a download URL
          let downloadUrl = file.url.includes('/download') ? file.url : `${file.url.replace(/\?.*$/, '')}/download?download_frd=1`;
          // Make absolute if relative
          if (downloadUrl.startsWith('/')) {
            downloadUrl = `${CANVAS_URL}${downloadUrl}`;
          }
          fileDownloads.push({
            url: downloadUrl,
            filename: file.name || `page_file_${index}`,
            type: 'pages',
            itemId: page.pageSlug || null,
            metadata: file
          });
        }
      });
    }
  }

  // 4. Files from announcements (attachments) - only actual file attachments (use course-specific dataset, or phase-specific in test mode)
  const announcementsDataset = await Dataset.open(`${datasetPrefix}/announcements`);
  const announcements = await safeGetDatasetData(announcementsDataset, `${datasetPrefix}/announcements`);
  for (const announcement of announcements.items || []) {
    if (announcement.attachments && Array.isArray(announcement.attachments) && announcement.attachments.length > 0) {
      announcement.attachments.forEach((attachment, index) => {
        // Only download if it has a valid download URL and name
        if ((attachment.url || attachment.downloadUrl) && attachment.name) {
          let downloadUrl = attachment.downloadUrl || attachment.url;
          // Ensure it's a download URL for Canvas files
          if (downloadUrl.includes('/files/') && !downloadUrl.includes('/download')) {
            downloadUrl = `${downloadUrl.replace(/\?.*$/, '')}/download?download_frd=1`;
          }
          // Make absolute if relative
          if (downloadUrl.startsWith('/')) {
            downloadUrl = `${CANVAS_URL}${downloadUrl}`;
          }
          // Only add if it's actually a file download URL
          if (downloadUrl.includes('/download') || downloadUrl.includes('/files/')) {
            fileDownloads.push({
              url: downloadUrl,
              filename: attachment.name,
              type: 'announcements',
              itemId: announcement.announcementId || null,
              metadata: attachment
            });
          }
        }
      });
    }
  }

  // 5. Files from discussions (attachments) - only actual file attachments (use course-specific dataset, or phase-specific in test mode)
  const discussionsDataset = await Dataset.open(`${datasetPrefix}/discussions`);
  const discussions = await safeGetDatasetData(discussionsDataset, `${datasetPrefix}/discussions`);
  for (const discussion of discussions.items || []) {
    if (discussion.attachments && Array.isArray(discussion.attachments) && discussion.attachments.length > 0) {
      discussion.attachments.forEach((attachment, index) => {
        // Only download if it has a valid download URL and name
        if ((attachment.url || attachment.downloadUrl) && attachment.name) {
          let downloadUrl = attachment.downloadUrl || attachment.url;
          // Ensure it's a download URL for Canvas files
          if (downloadUrl.includes('/files/') && !downloadUrl.includes('/download')) {
            downloadUrl = `${downloadUrl.replace(/\?.*$/, '')}/download?download_frd=1`;
          }
          // Make absolute if relative
          if (downloadUrl.startsWith('/')) {
            downloadUrl = `${CANVAS_URL}${downloadUrl}`;
          }
          // Only add if it's actually a file download URL
          if (downloadUrl.includes('/download') || downloadUrl.includes('/files/')) {
            fileDownloads.push({
              url: downloadUrl,
              filename: attachment.name,
              type: 'discussions',
              itemId: discussion.discussionId || null,
              metadata: attachment
            });
          }
        }
      });
    }
  }

  // 6. Files from quizzes (attachments) - only actual file attachments (use course-specific dataset, or phase-specific in test mode)
  const quizzesDataset = await Dataset.open(`${datasetPrefix}/quizzes`);
  const quizzes = await safeGetDatasetData(quizzesDataset, `${datasetPrefix}/quizzes`);
  for (const quiz of quizzes.items || []) {
    if (quiz.attachments && Array.isArray(quiz.attachments) && quiz.attachments.length > 0) {
      quiz.attachments.forEach((attachment, index) => {
        // Only download if it has a valid download URL and name
        if ((attachment.url || attachment.downloadUrl) && attachment.name) {
          let downloadUrl = attachment.downloadUrl || attachment.url;
          // Ensure it's a download URL for Canvas files
          if (downloadUrl.includes('/files/') && !downloadUrl.includes('/download')) {
            downloadUrl = `${downloadUrl.replace(/\?.*$/, '')}/download?download_frd=1`;
          }
          // Make absolute if relative
          if (downloadUrl.startsWith('/')) {
            downloadUrl = `${CANVAS_URL}${downloadUrl}`;
          }
          // Only add if it's actually a file download URL
          if (downloadUrl.includes('/download') || downloadUrl.includes('/files/')) {
            fileDownloads.push({
              url: downloadUrl,
              filename: attachment.name,
              type: 'quizzes',
              itemId: quiz.quizId || null,
              metadata: attachment
            });
          }
        }
      });
    }
  }

  // Remove duplicates based on URL
  const uniqueDownloads = [];
  const seenUrls = new Set();
  for (const download of fileDownloads) {
    const normalizedUrl = download.url.split('?')[0]; // Remove query params for comparison
    if (!seenUrls.has(normalizedUrl)) {
      seenUrls.add(normalizedUrl);
      uniqueDownloads.push(download);
    }
  }

  downloadStats.total = uniqueDownloads.length;
  console.log(`   Found ${uniqueDownloads.length} unique files to download`);

  if (uniqueDownloads.length === 0) {
    console.log('⚠️  No files found to download.');
    return;
  }

  // Use fetch-based downloads directly (no Playwright navigation needed)
  // This avoids the "Download is starting" error from page.goto()
  const { downloadFileWithFetch } = require('./downloaders/file-downloader.js');
  
  // Process downloads in parallel with concurrency limit
  const DOWNLOAD_CONCURRENCY = parseInt(process.env.DOWNLOAD_CONCURRENCY) || 12;
  const limit = pLimit(DOWNLOAD_CONCURRENCY);
  
  console.log(`   Processing ${uniqueDownloads.length} file downloads with ${DOWNLOAD_CONCURRENCY} concurrent downloads...`);
  
  const downloadPromises = uniqueDownloads.map((download, index) => 
    limit(async () => {
      const { url } = download;
      let { filename } = download;
      const type = download.type || 'files';
      const itemId = download.itemId ? String(download.itemId) : null;
      const metadata = download.metadata || {};
      let folderSegments = [];
      if (Array.isArray(download.folderSegments) && download.folderSegments.length > 0) {
        folderSegments = download.folderSegments;
      } else if (Array.isArray(metadata.folderPath) && metadata.folderPath.length > 0) {
        folderSegments = metadata.folderPath;
      }
      if (type === 'modules' && folderSegments.length > 0) {
        const firstSegment = String(folderSegments[0] || '').toLowerCase();
        if (firstSegment === 'modules') {
          folderSegments = folderSegments.slice(1);
        }
      }
      if (!filename || typeof filename !== 'string') {
        filename = `downloaded_file_${index}`;
      }
      filename = sanitizeFilename(filename);
      
      console.log(`Downloading: ${filename} [${type}]`);
      
      try {
        // Check if file already exists
        // organizeDownloadPath expects a path relative to storage/datasets, but we need to use the full path
        // since CRAWLEE_STORAGE_DIR is now the extraction folder, we need to construct the path relative to that
        const downloadPathPrefix = `courses/${courseFolderName}`;
        const downloadPath = organizeDownloadPath(
          downloadPathPrefix,
          type,
          itemId,
          filename,
          { folderSegments }
        );
        if (fs.existsSync(downloadPath)) {
          const stats = fs.statSync(downloadPath);
          console.log(`Skipping (already exists): ${filename} (${(stats.size / 1024).toFixed(2)} KB)`);
          downloadStats.skipped++;
          if (!downloadStats.byType[type]) downloadStats.byType[type] = { total: 0, successful: 0, skipped: 0, failed: 0 };
          downloadStats.byType[type].skipped++;
          downloadStats.byType[type].total++;
          return;
        }

        // Download the file using fetch
        const result = await downloadFileWithFetch(url, downloadPath, cookies, { timeout: 60000 });

        if (result.success) {
          console.log(`✅ Downloaded: ${filename} (${(result.size / 1024).toFixed(2)} KB)`);
          downloadStats.successful++;
          if (authState) {
            authState.recordSuccess(`download:${url}`);
          }
          if (!downloadStats.byType[type]) downloadStats.byType[type] = { total: 0, successful: 0, skipped: 0, failed: 0 };
          downloadStats.byType[type].successful++;
        } else {
          console.error(`❌ Failed: ${filename} - ${result.error}`);
          downloadStats.failed++;
          if (authState && typeof result.error === 'string' && (result.error.includes('401') || result.error.includes('403') || result.error.toLowerCase().includes('unauthorized'))) {
            authState.recordFailure('Unauthorized download response', { url, phase: 'download' });
          }
          if (!downloadStats.byType[type]) downloadStats.byType[type] = { total: 0, successful: 0, skipped: 0, failed: 0 };
          downloadStats.byType[type].failed++;
        }
        if (!downloadStats.byType[type]) downloadStats.byType[type] = { total: 0, successful: 0, skipped: 0, failed: 0 };
        downloadStats.byType[type].total++;
      } catch (error) {
        console.error(`❌ Error downloading ${filename}: ${error.message}`);
        console.error(`   URL: ${url}`);
        downloadStats.failed++;
        if (authState && (error.message.includes('401') || error.message.includes('403') || error.message.toLowerCase().includes('unauthorized'))) {
          authState.recordFailure('Unauthorized download error', { url, phase: 'download' });
        }
        if (!downloadStats.byType[type]) downloadStats.byType[type] = { total: 0, successful: 0, skipped: 0, failed: 0 };
        downloadStats.byType[type].failed++;
        downloadStats.byType[type].total++;
      }
    })
  );

  await Promise.all(downloadPromises);

  const endTime = Date.now();
  const duration = ((endTime - startTime) / 1000).toFixed(2);
  const durationMinutes = (duration / 60).toFixed(2);

  console.log('\n✅ Phase 6 Downloads Complete!');
  console.log(`\n⏱️  Performance:`);
  console.log(`   Duration: ${durationMinutes} minutes (${duration} seconds)`);
  console.log(`   Started: ${new Date(startTime).toISOString()}`);
  console.log(`   Finished: ${new Date(endTime).toISOString()}`);
  console.log(`\n📊 Download Statistics:`);
  console.log(`   Total files: ${downloadStats.total}`);
  console.log(`   Successful: ${downloadStats.successful}`);
  console.log(`   Failed: ${downloadStats.failed}`);
  console.log(`   Skipped (already exists): ${downloadStats.skipped}`);
  console.log(`\n📁 Downloads by type:`);
  for (const [type, stats] of Object.entries(downloadStats.byType)) {
    console.log(`   ${type}: ${stats.successful}/${stats.total} (${stats.skipped} skipped, ${stats.failed} failed)`);
  }
  // Downloads are stored in the extraction folder
  const extractionFolder = getExtractionFolder();
  const downloadPrefix = `courses/${courseFolderName}`;
  console.log(`\n💾 Output:`);
  console.log(`   Extraction folder: ./storage/datasets/${extractionFolder}/`);
  console.log(`   Downloads: ./storage/datasets/${extractionFolder}/${downloadPrefix}/downloads/`);
}

/**
 * Phase 7: Process a single course (all phases)
 */
async function processCourse(courseId, courseIndex, totalCourses) {
  const startTime = Date.now();
  console.log(`\n${'='.repeat(60)}`);
  console.log(`📚 Processing Course ${courseIndex + 1}/${totalCourses}: ${courseId}`);
  console.log(`${'='.repeat(60)}`);
  const SKIP_DOWNLOADS = process.env.SKIP_DOWNLOADS === 'true';
  const authState = getAuthState(courseId);
  const maxAuthAttempts = Math.max(1, MAX_AUTH_RECOVERY_ATTEMPTS);
  let attempt = 0;
  let lastError = null;

  while (attempt < maxAuthAttempts) {
    attempt += 1;
    authState.startAttempt(attempt);
    lastError = null;

    try {
      console.log(`\n🔁 Course ${courseId}: Attempt ${attempt}/${maxAuthAttempts}`);
      // Always run mapping first, then extraction (from scratch every time)
      console.log('📋 Running Phase 1 mapping first (fresh, no cache)...');
      const mappingResult = await runMappingPhase(courseId, { authState });
      console.log(`   📊 Mapping result: ${mappingResult.totalUrls} URLs discovered`);
      
      if (mappingResult.totalUrls === 0) {
        console.log(`   ⚠️  WARNING: No URLs discovered for course ${courseId}!`);
        console.log(`   🔍 This could indicate:`);
        console.log(`      - Authentication failure (401 errors)`);
        console.log(`      - Course has no content`);
        console.log(`      - Course access restrictions`);
        console.log(`      - Initial request not processed`);
      }
      
      console.log('\n📥 Proceeding to Phase 2 extraction (using in-memory mapping data)...');
      await runExtractionPhase(courseId, mappingResult, { authState });

      if (!SKIP_DOWNLOADS) {
        console.log('\n📥 Proceeding to Phase 6 downloads...');
        await runDownloadPhase(courseId, { authState, mappingData: mappingResult });
      }
      
      const endTime = Date.now();
      const duration = ((endTime - startTime) / 1000 / 60).toFixed(2);
      console.log(`\n✅ Course ${courseId} completed in ${duration} minutes`);
      
      return {
        courseId,
        success: true,
        duration: (endTime - startTime) / 1000,
        error: null
      };
    } catch (error) {
      lastError = error;
      if (isAuthenticationLostError(error)) {
        console.warn(`\n⚠️  Course ${courseId}: Authentication lost (attempt ${attempt}/${maxAuthAttempts}).`);
        if (attempt >= maxAuthAttempts) {
          console.error('   ❌ Reached maximum authentication recovery attempts.');
          break;
        }
        try {
          await promptForCookieRefresh(error.message, courseId);
          authState.resetAfterRefresh();
        } catch (refreshError) {
          lastError = refreshError;
          console.error(`   ❌ Cookie refresh failed: ${refreshError.message}`);
          break;
        }
        console.log('   🔄 Restarting course extraction after cookie refresh...');
        continue;
      }
      
      const endTime = Date.now();
      console.error(`\n❌ Course ${courseId} failed: ${error.message}`);
      return {
        courseId,
        success: false,
        duration: (endTime - startTime) / 1000,
        error: error.message
      };
    }
  }

  const endTime = Date.now();
  const failureMessage = lastError ? lastError.message : 'Authentication failed repeatedly';
  console.error(`\n❌ Course ${courseId} failed after authentication recovery attempts: ${failureMessage}`);
  return {
    courseId,
    success: false,
    duration: (endTime - startTime) / 1000,
    error: failureMessage
  };
}

/**
 * Phase 7: Generate summary across all courses
 */
async function generateMultiCourseSummary(results, overallStartTime) {
  // Calculate actual wall-clock time (not sum of parallel durations)
  const overallEndTime = Date.now();
  const wallClockDuration = (overallEndTime - overallStartTime) / 1000; // in seconds
  
  // Sum of individual course durations (for reference, but not the real total time)
  const sumOfDurations = results.reduce((sum, r) => sum + r.duration, 0);
  
  const summary = {
    totalCourses: results.length,
    successful: results.filter(r => r.success).length,
    failed: results.filter(r => !r.success).length,
    wallClockDuration: wallClockDuration, // Actual elapsed time
    wallClockDurationMinutes: (wallClockDuration / 60).toFixed(2),
    sumOfDurations: sumOfDurations, // Sum of individual course times (for reference)
    sumOfDurationsMinutes: (sumOfDurations / 60).toFixed(2),
    averageDuration: 0,
    courses: results.map(r => ({
      courseId: r.courseId,
      success: r.success,
      duration: (r.duration / 60).toFixed(2) + ' min',
      error: r.error || null
    }))
  };
  
  if (summary.successful > 0) {
    summary.averageDuration = sumOfDurations / summary.successful / 60;
  }
  
  // Save summary to file
  const summaryFile = path.join(__dirname, '..', '..', 'storage', 'multi-course-summary.json');
  fs.writeFileSync(summaryFile, JSON.stringify(summary, null, 2));
  
  console.log(`\n${'='.repeat(60)}`);
  console.log('📊 Multi-Course Extraction Summary');
  console.log(`${'='.repeat(60)}`);
  console.log(`   Total Courses: ${summary.totalCourses}`);
  console.log(`   Successful: ${summary.successful}`);
  console.log(`   Failed: ${summary.failed}`);
  console.log(`   Wall-Clock Duration: ${summary.wallClockDurationMinutes} minutes (actual elapsed time)`);
  console.log(`   Sum of Course Durations: ${summary.sumOfDurationsMinutes} minutes (individual times, may overlap)`);
  console.log(`   Average Duration per Course: ${summary.averageDuration.toFixed(2)} minutes`);
  console.log(`\n   Summary saved to: ${summaryFile}`);
  
  if (summary.failed > 0) {
    console.log(`\n   Failed Courses:`);
    results.filter(r => !r.success).forEach(r => {
      console.log(`     - ${r.courseId}: ${r.error}`);
    });
  }
  
  return summary;
}

/**
 * Main execution function
 */
async function main() {
  try {
    // Initialize extraction folder
    // Crawlee storage directory is already configured at module load time
    const extractionFolder = getExtractionFolder();
    console.log(`📁 Extraction folder: storage/datasets/${extractionFolder}/`);
    console.log(`   Mapping: storage/datasets/${extractionFolder}/mapping/`);
    console.log(`   Courses: storage/datasets/${extractionFolder}/courses/`);
    console.log(`   Files pipeline mode: ${FILES_PIPELINE_MODE} (always on)`);
    
    // Validate cookies at startup (with retry if invalid)
    console.log('🔐 Validating authentication cookies...');
    try {
      await loadCookies(true); // Allow retry if invalid
      console.log('✅ Cookies validated successfully\n');
    } catch (cookieError) {
      console.error(`\n❌ Cookie validation failed: ${cookieError.message}`);
      console.error(`\n💡 Please ensure cookies are valid before running extraction.`);
      process.exit(1);
    }
    
    const SKIP_DOWNLOADS = process.env.SKIP_DOWNLOADS === 'true';
    
    // Phase 7: Multi-course support
    let courseIds = [];
    const shouldAutoDiscoverCourses = !EXTRACT_COURSES_ENV && !COURSE_ID;
    
    if (EXTRACT_COURSES_ENV === 'all' || shouldAutoDiscoverCourses) {
      // Discover favorited courses (Canvas ⭐)
      if (shouldAutoDiscoverCourses) {
        console.log('⚙️  No COURSE_ID/EXTRACT_COURSES provided – auto-detecting favorited courses...');
      }
      courseIds = await discoverAllCourses();
      
      if (courseIds.length === 0) {
        console.error('❌ Error: No favorited courses found. Please star courses in Canvas or provide COURSE_ID/EXTRACT_COURSES.');
        process.exit(1);
      }
    } else if (EXTRACT_COURSES_ENV) {
      // Parse comma-separated course IDs
      courseIds = EXTRACT_COURSES_ENV.split(',').map(id => id.trim()).filter(id => id);
    } else {
      // Single course mode (backward compatible)
      courseIds = [COURSE_ID];
    }
    
    // Process courses sequentially or in parallel based on OUTPUT_DIR
    // If OUTPUT_DIR is 'local_extraction', process courses one at a time (sequential)
    const OUTPUT_DIR = process.env.OUTPUT_DIR || null;
    const isSequential = OUTPUT_DIR === 'local_extraction';
    
    const pLimitModule = require('p-limit');
    const pLimit = pLimitModule.default || pLimitModule;
    
    // For sequential local extraction: process one course at a time
    // For parallel extraction: process multiple courses in parallel (max 20)
    const parallelLimit = isSequential
      ? 1 // Sequential: one course at a time
      : Math.min(courseIds.length, 20); // Max 20 courses in parallel (optimized for AWS)
    const limit = pLimit(parallelLimit);
    
    console.log(`\n🚀 Processing ${courseIds.length} courses (${parallelLimit} in parallel for optimal performance)...`);
    console.log(`   Instance: ${isAWS ? 'AWS r7i.2xlarge (8 vCPUs, 64GB RAM)' : 'Local'}`);
    console.log(`   Each course uses ${MAX_CONCURRENCY} concurrent requests internally`);
    console.log(`   Total concurrent capacity: ~${parallelLimit * MAX_CONCURRENCY} requests`);
    
    // Track actual wall-clock time for the entire extraction
    const extractionStartTime = Date.now();
    
    const results = await Promise.all(
      courseIds.map((courseId, i) => 
        limit(() => processCourse(courseId, i, courseIds.length))
      )
    );
    
    // Generate summary if multiple courses
    if (courseIds.length > 1) {
      await generateMultiCourseSummary(results, extractionStartTime);
    }


    // Explicitly exit to ensure clean shutdown and allow AWS hibernation
    console.log('\n✅ All extraction tasks completed successfully');
    process.exit(0);

  } catch (error) {
    console.error('❌ Crawler failed:', error.message);
    if (error.stack) {
      console.error(error.stack);
    }
    process.exit(1);
  }
}

// Handle graceful shutdown
process.on('SIGINT', () => {
  console.log('\n\n⚠️  Process interrupted by user');
  process.exit(0);
});

if (require.main === module) {
  main().catch((error) => {
    console.error('❌ Fatal error:', error.message);
    process.exit(1);
  });
}

module.exports = {
  runMappingPhase,
  runExtractionPhase,
  runDownloadPhase,
  discoverAllCourses,
  processCourse,
  loadCookies
};
