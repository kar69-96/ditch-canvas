#!/usr/bin/env node
/**
 * Canvas Update Checker
 * Quickly checks for updates in Canvas courses by comparing stored mapping data
 * at initial depth (depth 0-1) with current Canvas state.
 * When changes are detected, performs deep extraction of new/changed items.
 */

const path = require('path');
const fs = require('fs');
const { chromium } = require('playwright-core');
const { Dataset } = require('crawlee');

// Configuration
const CANVAS_URL = process.env.CANVAS_URL || 'https://canvas.colorado.edu';
const COOKIE_FILE = path.join(__dirname, '..', 'data', 'auth', 'canvas-cookies.json');
const STORAGE_DIR = path.join(__dirname, '..', 'storage', 'datasets');
const LATEST_EXTRACTION_FILE = path.join(__dirname, '..', 'storage', 'latest-extraction-folder.json');

// Timeout per page check (keep it fast)
const PAGE_CHECK_TIMEOUT = Number(process.env.UPDATE_PAGE_TIMEOUT_MS) || 15000;
const MAX_CONCURRENT_CHECKS = Number(process.env.UPDATE_MAX_CONCURRENT_CHECKS) || 8;
const INITIAL_DEPTH_MAX = 1; // Check depth 0-1 only
const TEST_RESULTS_DIR = path.join(__dirname, '..', 'storage', 'test-results');
const UPDATE_RESULTS_DIR = process.env.UPDATE_RESULTS_DIR ? path.resolve(process.env.UPDATE_RESULTS_DIR) : TEST_RESULTS_DIR;
const UPDATE_RUN_ID = new Date().toISOString().replace(/[:.]/g, '-');
const SURFACE_SUMMARY_FILENAME = `update-summary-${UPDATE_RUN_ID}.json`;
const DIFF_REPORT_FILENAME = `update-diff-${UPDATE_RUN_ID}.json`;
const UPDATE_DRY_RUN = (process.env.UPDATE_DRY_RUN || 'false').toLowerCase() !== 'false';
const UPDATE_COURSE_IDS = process.env.UPDATE_COURSE_IDS
  ? process.env.UPDATE_COURSE_IDS.split(',').map(id => id.trim()).filter(Boolean)
  : null;
const UPDATE_MAX_COURSES = Number(process.env.UPDATE_MAX_COURSES) || null;
const UPDATE_TEST_DATASET_DIR = path.normalize(path.join(STORAGE_DIR, 'update test'));
const DATE_TOLERANCE_HOURS = Number(process.env.UPDATE_DATE_TOLERANCE_HOURS) || 24;
const TITLE_SIMILARITY_THRESHOLD = Number(process.env.UPDATE_TITLE_SIMILARITY_THRESHOLD) || 0.8;
const AUTO_UPLOAD_TO_SUPABASE = (process.env.AUTO_UPLOAD_TO_SUPABASE || 'true').toLowerCase() !== 'false';

// Import extractors
const { extractAssignment } = require('../src/crawler/extractors/assignment-extractor.js');
const { extractAnnouncement } = require('../src/crawler/extractors/announcement-extractor.js');
const { extractFiles } = require('../src/crawler/extractors/file-extractor.js');
const { extractModules } = require('../src/crawler/extractors/module-extractor.js');
const { extractPage } = require('../src/crawler/extractors/page-extractor.js');
const { classifyCanvasUrl } = require('../src/crawler/utils/url-classifier.js');

const CONTENT_TYPE_FIELDS = {
  assignments: ['title', 'dueDate', 'modifiedDate', 'points'],
  quizzes: ['title', 'dueDate', 'modifiedDate', 'points'],
  announcements: ['title', 'postDate', 'modifiedDate', 'lastReplyDate', 'author'],
  files: ['title', 'name', 'modifiedDate', 'size'],
  modules: ['title', 'itemCount', 'unlockDate', 'completionStatus'],
  pages: ['title']
};

function ensureDirectoryExists(dirPath) {
  if (!fs.existsSync(dirPath)) {
    fs.mkdirSync(dirPath, { recursive: true });
  }
}

function ensureNotWritingToUpdateTest(targetPath) {
  if (!targetPath) return;
  const normalizedTarget = path.normalize(targetPath);
  if (normalizedTarget.startsWith(UPDATE_TEST_DATASET_DIR)) {
    throw new Error(`Protected dataset folder "${UPDATE_TEST_DATASET_DIR}" cannot be modified by the update checker.`);
  }
}

function normalizeContentId(contentType, id) {
  if (!id && id !== 0) return null;
  const normalized = String(id).trim();
  return contentType === 'pages' ? normalized.toLowerCase() : normalized;
}

function extractContentIdFromUrl(url, contentType) {
  if (!url) return null;
  try {
    const urlObj = new URL(url);
    const pathParts = urlObj.pathname.split('/').filter(Boolean);
    
    // Canvas URL structure: /courses/{courseId}/{contentType}/{contentId}
    const contentTypeIndex = pathParts.findIndex(part => 
      ['assignments', 'quizzes', 'discussion_topics', 'pages', 'files', 'modules'].includes(part)
    );
    
    if (contentTypeIndex !== -1 && contentTypeIndex < pathParts.length - 1) {
      return pathParts[contentTypeIndex + 1];
    }
    
    return null;
  } catch (e) {
    return null;
  }
}

function normalizeComparableValue(value) {
  if (value === null || value === undefined) {
    return null;
  }
  if (typeof value === 'string') {
    return value.trim();
  }
  return value;
}

function normalizeTitle(value) {
  if (!value) return null;
  return String(value).trim().toLowerCase();
}

function titlesAreSimilar(title1, title2, threshold = 0.8) {
  if (!title1 || !title2) return false;
  const norm1 = normalizeTitle(title1);
  const norm2 = normalizeTitle(title2);
  
  // Exact match
  if (norm1 === norm2) return true;
  
  // One title contains the other (for cases like "PRE QUIZ Case 10" vs "PRE QUIZ Case 10 Strava")
  if (norm1.includes(norm2) || norm2.includes(norm1)) {
    // Ensure the shorter one is at least 80% of the longer one
    const shorter = norm1.length < norm2.length ? norm1 : norm2;
    const longer = norm1.length >= norm2.length ? norm1 : norm2;
    if (shorter.length / longer.length >= threshold) {
      return true;
    }
  }
  
  // Calculate similarity using simple word overlap
  const words1 = new Set(norm1.split(/\s+/).filter(w => w.length > 2)); // Ignore short words
  const words2 = new Set(norm2.split(/\s+/).filter(w => w.length > 2));
  
  if (words1.size === 0 || words2.size === 0) return false;
  
  const intersection = new Set([...words1].filter(w => words2.has(w)));
  const union = new Set([...words1, ...words2]);
  
  const similarity = intersection.size / union.size;
  return similarity >= threshold;
}

function normalizeDueDateString(value) {
  if (!value) return null;
  const raw = String(value).trim();
  if (raw === '') return null;
  if (raw.toLowerCase() === 'closed' || raw.toLowerCase().includes('closed')) {
    return null; // Don't normalize "Closed" status
  }

  // Already in ISO format
  const isoPattern = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/;
  if (isoPattern.test(raw)) {
    return raw;
  }

  // Handle Canvas text formats like "Dec 3 at 12pm", "Aug 26 at 11:59pm", "Oct 1 at 8:40pm"
  // Pattern: Month Day [at] Hour:Minute[am/pm]
  const textDatePattern = /([A-Z][a-z]{2,3})\s+(\d{1,2})(?:\s+at\s+(\d{1,2}):(\d{2})(am|pm))?/i;
  const match = raw.match(textDatePattern);
  if (match) {
    const monthNames = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];
    const monthName = match[1].toLowerCase().substring(0, 3);
    const day = parseInt(match[2]);
    const monthIndex = monthNames.indexOf(monthName);
    
    if (monthIndex !== -1) {
      const currentYear = new Date().getFullYear();
      let hour = 23;
      let minute = 59;
      
      if (match[3] && match[4] && match[5]) {
        hour = parseInt(match[3]);
        minute = parseInt(match[4]);
        const ampm = match[5].toLowerCase();
        if (ampm === 'pm' && hour < 12) hour += 12;
        if (ampm === 'am' && hour === 12) hour = 0;
      }
      
      try {
        const dateObj = new Date(currentYear, monthIndex, day, hour, minute);
        if (!isNaN(dateObj.getTime())) {
          return dateObj.toISOString();
        }
      } catch (e) {
        // Fall through to Date.parse
      }
    }
  }

  // Try Date.parse as fallback
  let candidate = raw;
  if (!/\d{4}/.test(raw)) {
    candidate = `${raw} ${new Date().getFullYear()}`;
  }

  const parsed = Date.parse(candidate);
  if (!isNaN(parsed)) {
    return new Date(parsed).toISOString();
  }

  return raw;
}

function normalizeDateForComparison(value) {
  if (!value) return null;
  const normalized = normalizeDueDateString(value);
  if (!normalized) return null;
  
  // If already ISO format, return as-is
  const isoPattern = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/;
  if (isoPattern.test(normalized)) {
    return normalized;
  }
  
  return normalized;
}

function datesAreEquivalent(date1, date2) {
  if (!date1 || !date2) return date1 === date2;
  
  const d1 = normalizeDateForComparison(date1);
  const d2 = normalizeDateForComparison(date2);
  
  if (!d1 || !d2) return d1 === d2;
  
  const time1 = new Date(d1).getTime();
  const time2 = new Date(d2).getTime();
  const diff = Math.abs(time1 - time2);
  const toleranceMs = DATE_TOLERANCE_HOURS * 60 * 60 * 1000;
  
  if (diff <= toleranceMs) {
    return true;
  }
  
  // Otherwise, use 2 hour tolerance for exact time matches
  return diff < 2 * 60 * 60 * 1000;
}

function collectFieldChanges(baselineItem, surfaceItem, contentType) {
  const fields = CONTENT_TYPE_FIELDS[contentType] || ['title'];
  const fieldChanges = {};
  fields.forEach(field => {
    let baselineValue = normalizeComparableValue(baselineItem?.[field] ?? baselineItem?.[field === 'title' ? 'name' : field]);
    let surfaceValue = normalizeComparableValue(surfaceItem?.[field] ?? surfaceItem?.[field === 'title' ? 'name' : field]);
    
    // Normalize dates before comparison
    if (field === 'dueDate' || field === 'modifiedDate' || field === 'postDate') {
      baselineValue = normalizeDateForComparison(baselineValue);
      surfaceValue = normalizeDateForComparison(surfaceValue);
      
      // Use date equivalence check for dates
      if (datesAreEquivalent(baselineValue, surfaceValue)) {
        return; // Dates are equivalent, no change
      }
    }
    
    // Don't flag changes if:
    // 1. Baseline has a value but current extraction returned null (might not be visible on list page)
    // 2. Both are null (no change)
    // Only flag if both have values and they differ, or if baseline is null but current has a value (new value added)
    if (baselineValue !== surfaceValue) {
      // Skip if baseline has value but current is null - this likely means we couldn't extract it from list page
      // Don't create false positives for fields we can't reliably extract
      if (baselineValue !== null && baselineValue !== '' && (surfaceValue === null || surfaceValue === '')) {
        // For date fields especially, null from list page doesn't mean it's actually missing
        if (field === 'dueDate' || field === 'modifiedDate' || field === 'postDate') {
          return; // Skip - can't reliably compare if we couldn't extract current value
        }
      }
      // Skip due date changes when baseline was empty/missing and surface now has a value (baseline extraction was incomplete)
      if (field === 'dueDate' && (baselineValue === null || baselineValue === '') && surfaceValue) {
        return;
      }

      if (field === 'title' && baselineValue && (surfaceValue === null || surfaceValue === '')) {
        return;
      }
      
      // For pages, ignore title changes that are just adding parenthetical info (formatting changes)
      if (contentType === 'pages' && field === 'title') {
        const baseTitle1 = String(baselineValue || '').replace(/\s*\([^)]*\)\s*$/, '').trim();
        const baseTitle2 = String(surfaceValue || '').replace(/\s*\([^)]*\)\s*$/, '').trim();
        if (baseTitle1 === baseTitle2 && baseTitle1.length > 0) {
          return; // Just formatting difference, ignore
        }
      }
      
      fieldChanges[field] = {
        from: baselineValue,
        to: surfaceValue
      };
    }
  });
  return fieldChanges;
}

function buildSurfaceCourseSummary(courseId, courseName, quickData) {
  const normalizedCourseId = String(courseId).trim();
  const result = {
    courseFolderName: courseName || `course-${normalizedCourseId}`,
    courseId: normalizedCourseId,
    assignments: {},
    announcements: {},
    files: {},
    modules: {},
    pages: {}
    , quizzes: {}
  };

  (quickData.assignments?.items || []).forEach(item => {
    const id = normalizeContentId('assignments', item.id);
    if (!id) return;
    result.assignments[id] = {
      id,
      title: item.title || '',
      url: item.url,
      dueDate: normalizeDueDateString(item.dueDate) || null,
      modifiedDate: item.modifiedDate || null,
      points: item.points || null,
      status: item.status || null
    };
  });

  (quickData.announcements?.items || []).forEach(item => {
    const id = normalizeContentId('announcements', item.id);
    if (!id) return;
    result.announcements[id] = {
      id,
      title: item.title || '',
      url: item.url,
      postDate: item.postDate || null,
      modifiedDate: item.modifiedDate || null,
      lastReplyDate: item.lastReplyDate || null,
      author: item.author || null
    };
  });

  (quickData.files?.files || []).forEach(item => {
    const id = normalizeContentId('files', item.id);
    if (!id) return;
    result.files[id] = {
      id,
      title: item.name || '',
      name: item.name || '',
      url: item.url,
      size: item.size || null,
      modifiedDate: item.modifiedDate || null,
      fileType: item.fileType || null
    };
  });

  (quickData.modules?.items || []).forEach(item => {
    const id = normalizeContentId('modules', item.id);
    if (!id) return;
    result.modules[id] = {
      id,
      title: item.title || '',
      url: item.url,
      itemCount: item.itemCount || null,
      unlockDate: item.unlockDate || null,
      completionStatus: item.completionStatus || null
    };
  });

  (quickData.pages?.items || []).forEach(item => {
    const id = normalizeContentId('pages', item.slug);
    if (!id) return;
    result.pages[id] = {
      id,
      pageSlug: id,
      title: item.title || '',
      url: item.url
    };
  });

  return result;
}

function buildBaselineCourseData(courseId, courseName, summaryCourseData = {}, mappingCourseData = null) {
  const normalizedCourseId = String(courseId).trim();
  const baseline = {
    courseFolderName: summaryCourseData?.courseFolderName || courseName || `course-${normalizedCourseId}`,
    courseId: normalizedCourseId
  };

  // Use extraction summary as the sole source of truth
  // This is more accurate than mapping data because it contains only successfully extracted items
  Object.keys(CONTENT_TYPE_FIELDS).forEach(type => {
    const summaryItems = summaryCourseData?.[type] || {};
    baseline[type] = { ...summaryItems };
  });

  // Note: We no longer add __mappingOnly items because:
  // 1. Mapping data may be incomplete or missing
  // 2. Items that were discovered but not extracted shouldn't be in the baseline
  // 3. We only want to compare against items that were actually extracted

  return baseline;
}

function createEmptyQuickData() {
  return {
    announcements: { items: [] },
    assignments: { items: [] },
    files: { files: [], folders: [] },
    modules: { items: [] },
    pages: { items: [] }
  };
}

function createEmptyCourseUpdate(courseId, courseName = null) {
  const section = () => ({
    hasUpdates: false,
    newItems: [],
    changedItems: [],
    removedItems: []
  });

  const result = {
    courseId,
    courseName: courseName || `course-${courseId}`
  };
  
  // Dynamically create sections for all content types
  Object.keys(CONTENT_TYPE_FIELDS).forEach(type => {
    result[type] = section();
  });
  
  return result;
}

function courseHasUpdates(update) {
  if (!update) return false;
  return Object.keys(CONTENT_TYPE_FIELDS).some(type => update[type]?.hasUpdates);
}

function getDirectoryTimestamp(dirPath) {
  try {
    return fs.statSync(dirPath).mtimeMs;
  } catch (error) {
    return null;
  }
}

function diffContentType(baselineItems = {}, surfaceItems = {}, contentType, allBaselineData = {}) {
  const newItems = [];
  const removedItems = []; // Will be ignored - set to empty array at end
  const changedItems = [];
  
  // Get failed requests for this course/content type to ignore them
  const courseId = allBaselineData.courseId;
  const failedRequests = allBaselineData.failedRequests || {};
  const courseFailedRequests = courseId ? (failedRequests[courseId] || {}) : {};
  const typeFailedRequests = courseFailedRequests[contentType] || {};
  
  // Helper to check if an item ID is in failed requests
  const isFailedRequest = (itemId) => {
    if (!itemId) return false;
    const normalizedId = contentType === 'pages' ? String(itemId).trim().toLowerCase() : String(itemId).trim();
    return normalizedId in typeFailedRequests;
  };

  const baselineMap = new Map();
  Object.entries(baselineItems).forEach(([id, data]) => {
    const normalized = normalizeContentId(contentType, id);
    if (normalized) {
      baselineMap.set(normalized, { id: normalized, data, sourceType: contentType });
    }
  });

  const surfaceMap = new Map();
  Object.entries(surfaceItems).forEach(([id, data]) => {
    const normalized = normalizeContentId(contentType, id);
    if (normalized) {
      surfaceMap.set(normalized, { id: normalized, data });
    }
  });

  // Special handling for modules: if we have discovered module items, consider modules as known
  const discoveredModuleItems = allBaselineData._discoveredModuleItems || [];
  const hasDiscoveredModuleItems = discoveredModuleItems.length > 0;

  surfaceMap.forEach(({ id, data }) => {
    // First check in the same content type by ID
    let baselineEntry = baselineMap.get(id);
    
    // If not found by ID, try title matching within the same content type
    // This catches duplicates where the same item has different IDs
    if (!baselineEntry) {
      const surfaceTitle = data.title || data.name;
      if (surfaceTitle) {
        // Try exact title match first
        const exactMatch = Array.from(baselineMap.values()).find(entry => {
          const entryTitle = entry.data.title || entry.data.name;
          const normSurface = normalizeTitle(surfaceTitle);
          const normEntry = normalizeTitle(entryTitle);
          return normSurface === normEntry && normSurface.length > 0;
        });
        if (exactMatch) {
          baselineEntry = exactMatch;
        } else {
          // Try fuzzy title match
          const fuzzyMatch = Array.from(baselineMap.values()).find(entry => {
            const entryTitle = entry.data.title || entry.data.name;
            return titlesAreSimilar(surfaceTitle, entryTitle, TITLE_SIMILARITY_THRESHOLD);
          });
          if (fuzzyMatch) {
            baselineEntry = fuzzyMatch;
          }
        }
      }
      
      // If still not found, try URL-based matching within same type
      if (!baselineEntry && data.url) {
        const surfaceUrlId = extractContentIdFromUrl(data.url, contentType);
        if (surfaceUrlId) {
          const urlMatch = Array.from(baselineMap.values()).find(entry => {
            const entryUrl = entry.data.url || '';
            const entryUrlId = extractContentIdFromUrl(entryUrl, contentType);
            return entryUrlId && surfaceUrlId === entryUrlId;
          });
          if (urlMatch) {
            baselineEntry = urlMatch;
          }
        }
      }
    }
    
    // Special case for modules: if module not in baseline but we have discovered module items,
    // check if this module's URL contains any discovered module item IDs
    if (!baselineEntry && contentType === 'modules' && hasDiscoveredModuleItems && data.url) {
      const moduleItemMatch = data.url.match(/\/modules\/items\/(\d+)/);
      if (moduleItemMatch) {
        const moduleItemId = moduleItemMatch[1];
        // Extract course ID from URL
        const courseMatch = data.url.match(/\/courses\/(\d+)/);
        const courseId = courseMatch ? courseMatch[1] : null;
        // Check if this module item was discovered
        if (courseId) {
          const wasDiscovered = discoveredModuleItems.some(item => 
            item.itemId === moduleItemId && String(item.courseId) === String(courseId)
          );
          if (wasDiscovered) {
            // Consider this module as known (discovered via its items)
            return; // Skip adding as new
          }
        }
      }
    }
    
    // If not found, check across all other content types (for cross-type matches like quiz vs assignment)
    // Prioritize title matching over ID matching for cross-type lookups
    if (!baselineEntry && allBaselineData) {
      // Get content types dynamically from CONTENT_TYPE_FIELDS
      const otherTypes = Object.keys(CONTENT_TYPE_FIELDS).filter(type => type !== contentType);
      const surfaceTitle = data.title || data.name;
      
      // First try exact title matching (most reliable)
      if (surfaceTitle) {
        for (const otherType of otherTypes) {
          const otherBaselineItems = allBaselineData[otherType] || {};
          const otherEntry = Object.entries(otherBaselineItems).find(([otherId, otherData]) => {
            const otherTitle = otherData.title || otherData.name;
            const normSurface = normalizeTitle(surfaceTitle);
            const normOther = normalizeTitle(otherTitle);
            return normSurface === normOther && normSurface.length > 0;
          });
          if (otherEntry) {
            baselineEntry = { id, data: otherEntry[1], sourceType: otherType };
            break;
          }
        }
      }
      
      // If exact match didn't work, try fuzzy title matching (for variations like "Case 10" vs "Case 10 Strava")
      if (!baselineEntry && surfaceTitle) {
        for (const otherType of otherTypes) {
          const otherBaselineItems = allBaselineData[otherType] || {};
          const otherEntry = Object.entries(otherBaselineItems).find(([otherId, otherData]) => {
            const otherTitle = otherData.title || otherData.name;
            return titlesAreSimilar(surfaceTitle, otherTitle, TITLE_SIMILARITY_THRESHOLD);
          });
          if (otherEntry) {
            baselineEntry = { id, data: otherEntry[1], sourceType: otherType };
            break;
          }
        }
      }
      
      // If title matching didn't work, try URL-based matching (for cases where same content has different IDs)
      if (!baselineEntry && data.url) {
        const surfaceUrlId = extractContentIdFromUrl(data.url, contentType);
        if (surfaceUrlId) {
          for (const otherType of otherTypes) {
            const otherBaselineItems = allBaselineData[otherType] || {};
            const otherEntry = Object.entries(otherBaselineItems).find(([otherId, otherData]) => {
              const otherUrl = otherData.url || '';
              const otherUrlId = extractContentIdFromUrl(otherUrl, otherType);
              // Match if URLs point to same content (same ID in URL path)
              if (otherUrlId && surfaceUrlId === otherUrlId) {
                return true;
              }
              // Also check if URLs are similar (same path structure)
              if (otherUrl && data.url) {
                try {
                  const url1 = new URL(data.url);
                  const url2 = new URL(otherUrl);
                  // Same domain and similar path (ignoring content type in path)
                  if (url1.hostname === url2.hostname) {
                    const path1 = url1.pathname.replace(/\/assignments\/|\/quizzes\//, '/content/');
                    const path2 = url2.pathname.replace(/\/assignments\/|\/quizzes\//, '/content/');
                    if (path1 === path2) {
                      return true;
                    }
                  }
                } catch (e) {
                  // Ignore URL parsing errors
                }
              }
              return false;
            });
            if (otherEntry) {
              baselineEntry = { id, data: otherEntry[1], sourceType: otherType };
              break;
            }
          }
        }
      }
      
      // If URL matching didn't work, try ID matching across types
      if (!baselineEntry) {
        for (const otherType of otherTypes) {
          const otherBaselineItems = allBaselineData[otherType] || {};
          const otherEntry = Object.entries(otherBaselineItems).find(([otherId, otherData]) => {
            const normalizedOtherId = normalizeContentId(otherType, otherId);
            return normalizedOtherId === id;
          });
          if (otherEntry) {
            baselineEntry = { id, data: otherEntry[1], sourceType: otherType };
            break;
          }
        }
      }
    }
    
    if (!baselineEntry) {
      // Check if this item was a failed request during extraction
      // If so, ignore it to avoid false positives
      if (isFailedRequest(id)) {
        if (process.env.DEBUG_UPDATE === 'true') {
          console.log(`    ⏭️  Skipping ${contentType} ${id} - was a failed request during extraction`);
        }
        return; // Skip failed requests
      }
      newItems.push(data);
      return;
    }

    if (baselineEntry?.data?.__mappingOnly) {
      return;
    }
    // Handle "Closed" status for assignments - if baseline has a past due date and Canvas shows "Closed", treat as equivalent
    let normalizedDueDate = data.dueDate;
    if (contentType === 'assignments' && baselineEntry.data.dueDate) {
      const surfaceDueDateStr = String(data.dueDate || '').toLowerCase().trim();
      if (surfaceDueDateStr === 'closed' || surfaceDueDateStr.includes('closed')) {
        // Check if baseline due date is in the past (with 1 day buffer for timezone differences)
        try {
          const baselineDate = new Date(baselineEntry.data.dueDate);
          const now = new Date();
          const oneDayAgo = new Date(now.getTime() - 24 * 60 * 60 * 1000);
          if (!isNaN(baselineDate.getTime()) && baselineDate < oneDayAgo) {
            // Assignment is past due - "Closed" is expected, use baseline date for comparison
            normalizedDueDate = baselineEntry.data.dueDate;
          }
        } catch (e) {
          // If date parsing fails, use original value
        }
      }
    }
    
    // Normalize dates for comparison
    const baselineDueDate = normalizeDateForComparison(baselineEntry.data.dueDate);
    const surfaceDueDate = normalizeDateForComparison(normalizedDueDate || data.dueDate);
    
    const baselineComparable = {
      id: baselineEntry.data.id || id,
      title: baselineEntry.data.title || baselineEntry.data.name || '',
      dueDate: baselineDueDate,
      modifiedDate: normalizeDateForComparison(baselineEntry.data.modifiedDate),
      points: baselineEntry.data.points || null,
      postDate: normalizeDateForComparison(baselineEntry.data.postDate),
      slug: baselineEntry.data.pageSlug || baselineEntry.data.slug || null
    };
    const surfaceComparable = {
      id: data.id || id,
      title: data.title || data.name || '',
      dueDate: surfaceDueDate,
      modifiedDate: normalizeDateForComparison(data.modifiedDate),
      points: data.points || null,
      postDate: normalizeDateForComparison(data.postDate),
      slug: data.pageSlug || data.slug || null
    };
    const baselineHash = createItemHash(baselineComparable, contentType);
    const surfaceHash = createItemHash(surfaceComparable, contentType);
    if (baselineHash !== surfaceHash) {
      // Use normalized dates for field change detection
      const baselineForComparison = {
        ...baselineEntry.data,
        dueDate: baselineDueDate,
        modifiedDate: normalizeDateForComparison(baselineEntry.data.modifiedDate),
        postDate: normalizeDateForComparison(baselineEntry.data.postDate)
      };
      const surfaceForComparison = {
        ...data,
        dueDate: surfaceDueDate,
        modifiedDate: normalizeDateForComparison(data.modifiedDate),
        postDate: normalizeDateForComparison(data.postDate)
      };
      const fieldChanges = collectFieldChanges(baselineForComparison, surfaceForComparison, contentType);
      // Only report change if there are actual field changes (not just status changes)
      if (Object.keys(fieldChanges).length > 0) {
        changedItems.push({
          id,
          title: data.title || data.name || baselineEntry.data.title || baselineEntry.data.name || '',
          url: data.url || baselineEntry.data.url || null,
          fieldChanges
        });
      }
    }
  });

  // Ignore removals - items might still exist but not be immediately visible
  // Set removedItems to empty array to avoid false positives
  // baselineMap.forEach(({ id, data }) => {
  //   if (!surfaceMap.has(id)) {
  //     removedItems.push(data);
  //   }
  // });

  return {
    newItems,
    changedItems,
    removedItems: [], // Ignore removals to avoid false positives
    hasUpdates: newItems.length > 0 || changedItems.length > 0
  };
}

function diffCourseData(baselineCourseData, surfaceCourseSummary, failedRequests = {}) {
  // Get content types dynamically from CONTENT_TYPE_FIELDS
  const contentTypes = Object.keys(CONTENT_TYPE_FIELDS);
  const result = {};
  // Pass all baseline data plus failed requests to enable cross-type lookups and failed request filtering
  const allBaselineData = {
    ...baselineCourseData,
    failedRequests: failedRequests,
    courseId: baselineCourseData.courseId
  };
  contentTypes.forEach(type => {
    const baselineItems = baselineCourseData?.[type] || {};
    const surfaceItems = surfaceCourseSummary?.[type] || {};
    result[type] = diffContentType(baselineItems, surfaceItems, type, allBaselineData);
  });
  return result;
}

async function waitForListRender(page, selectors = [], fallbackDelay = 1200) {
  if (!selectors || selectors.length === 0) {
    await page.waitForTimeout(fallbackDelay);
    return;
  }

  for (const selector of selectors) {
    try {
      await page.waitForSelector(selector, { timeout: 2000 });
      return;
    } catch (error) {
      // Ignore and try next selector
    }
  }

  await page.waitForTimeout(fallbackDelay);
}

async function handleDeepExtractionForCourse(page, courseId, extractionFolder, diff) {
  const contentTypes = ['announcements', 'assignments', 'files', 'modules', 'pages'];

  for (const contentType of contentTypes) {
    const section = diff[contentType];
    if (!section) continue;

    const actionableItems = [
      ...(section.newItems || []),
      ...(section.changedItems || [])
    ];

    if (actionableItems.length === 0) continue;

    const label = contentType === 'files' ? 'file' :
                  contentType === 'pages' ? 'page' :
                  contentType === 'announcements' ? 'announcement' :
                  contentType === 'assignments' ? 'assignment' :
                  contentType === 'modules' ? 'module' : contentType;

    console.log(`    📥 Extracting ${actionableItems.length} ${label}${actionableItems.length > 1 ? 's' : ''}...`);

    for (let i = 0; i < actionableItems.length; i++) {
      const item = actionableItems[i];
      const identifier = item.id || item.slug || item.pageSlug || item.title || item.name || `item-${i + 1}`;

      if (!item.url) {
        console.log(`      ⚠️  Skipping ${label} ${identifier} — missing URL`);
        continue;
      }

      try {
        const result = await Promise.race([
          deepExtractItem(page, item.url, contentType, courseId, extractionFolder, item.id || item.slug || item.pageSlug || null),
          new Promise((_, reject) => setTimeout(() => reject(new Error('Extraction timeout (30s)')), 30000))
        ]);
        const action = result?._updated ? 'Updated' : 'Extracted';
        console.log(`      ✅ ${action} ${label}: ${item.title || item.name || identifier}`);
      } catch (error) {
        console.error(`      ❌ Failed to extract ${label} ${identifier}: ${error.message}`);
      }
    }
  }
}

/**
 * Load cookies from file (reused from canvas-crawler.js)
 */
function loadCookies() {
  if (!fs.existsSync(COOKIE_FILE)) {
    throw new Error(`Cookie file not found: ${COOKIE_FILE}\nPlease run: npm run auth:extract-cookies`);
  }

  let cookieData;
  try {
    cookieData = JSON.parse(fs.readFileSync(COOKIE_FILE, 'utf8'));
  } catch (error) {
    throw new Error(`Invalid cookie file format: ${error.message}`);
  }
  
  if (!cookieData.cookies || !Array.isArray(cookieData.cookies)) {
    throw new Error('Invalid cookie file format: cookies array not found');
  }

  return cookieData.cookies;
}

/**
 * Get latest extraction folder
 * Automatically finds the most recent extraction folder by scanning storage/datasets
 */
function getLatestExtractionFolder() {
  // Check for environment variable override
  const overrideFolder = process.env.UPDATE_EXTRACTION_FOLDER;
  if (overrideFolder) {
    const overridePath = path.join(STORAGE_DIR, overrideFolder);
    if (fs.existsSync(overridePath)) {
      const mappingDir = path.join(overridePath, 'datasets', 'mapping');
      if (fs.existsSync(mappingDir)) {
        console.log(`   📂 Using override extraction folder: ${overrideFolder}`);
        return overrideFolder;
      }
    }
  }

  // Always find the most recent extraction folder by scanning storage/datasets
  // This ensures we always use the latest extraction as the baseline
  if (!fs.existsSync(STORAGE_DIR)) {
    throw new Error('No storage/datasets directory found. Run a full extraction first.');
  }
  
  const folders = fs.readdirSync(STORAGE_DIR, { withFileTypes: true })
    .filter(dirent => dirent.isDirectory())
    .map(dirent => {
      const folderPath = path.join(STORAGE_DIR, dirent.name);
      const mappingDir = path.join(folderPath, 'datasets', 'mapping');
      // Only consider folders that have mapping data (indicating a complete extraction)
      if (fs.existsSync(mappingDir)) {
        const stats = fs.statSync(folderPath);
        return {
          name: dirent.name,
          path: folderPath,
          mtime: stats.mtime.getTime()
        };
      }
      return null;
    })
    .filter(Boolean);
  
  if (folders.length === 0) {
    throw new Error('No extraction folders found in storage/datasets. Run a full extraction first.');
  }
  
  // Sort by modification time (most recent first) and prefer folders matching extraction-* pattern
  folders.sort((a, b) => {
    const aIsExtraction = a.name.startsWith('extraction-');
    const bIsExtraction = b.name.startsWith('extraction-');
    
    // Prefer extraction-* folders over others
    if (aIsExtraction && !bIsExtraction) return -1;
    if (!aIsExtraction && bIsExtraction) return 1;
    
    // If both are same type, sort by modification time (most recent first)
    return b.mtime - a.mtime;
  });
  
  const latestFolder = folders[0].name;
  console.log(`   📂 Using most recent extraction folder as baseline: ${latestFolder}`);
  return latestFolder;
}

/**
 * Build a map of module item IDs to module IDs from extracted module files
 * @param {string} extractionFolder - The extraction folder name
 * @returns {Object} - Map of courseId -> moduleItemId -> moduleId
 */
function buildModuleItemToModuleMap(extractionFolder) {
  const map = {};
  const coursesDir = path.join(STORAGE_DIR, extractionFolder, 'datasets', 'courses');
  
  if (!fs.existsSync(coursesDir)) {
    return map;
  }

  const courseDirs = fs.readdirSync(coursesDir, { withFileTypes: true })
    .filter(dirent => dirent.isDirectory())
    .map(dirent => dirent.name);

  for (const courseDir of courseDirs) {
    const modulesDir = path.join(coursesDir, courseDir, 'modules');
    if (!fs.existsSync(modulesDir)) continue;

    const moduleFiles = fs.readdirSync(modulesDir)
      .filter(f => f.endsWith('.json'))
      .sort();

    for (const moduleFile of moduleFiles) {
      try {
        const moduleData = JSON.parse(fs.readFileSync(path.join(modulesDir, moduleFile), 'utf8'));
        const courseId = String(moduleData.courseId || '').trim();
        if (!courseId) continue;

        if (!map[courseId]) {
          map[courseId] = {};
        }

        // Extract module ID from moduleFiles array
        if (moduleData.moduleFiles && Array.isArray(moduleData.moduleFiles)) {
          moduleData.moduleFiles.forEach(moduleFileItem => {
            if (moduleFileItem.moduleItemId && moduleFileItem.moduleId) {
              const moduleItemId = String(moduleFileItem.moduleItemId);
              const moduleId = String(moduleFileItem.moduleId);
              map[courseId][moduleItemId] = moduleId;
            }
          });
        }
      } catch (error) {
        // Ignore errors reading individual module files
      }
    }
  }

  return map;
}

/**
 * Load request queue data to get loadedUrl information for redirect detection
 * @param {string} extractionFolder - The extraction folder name
 * @returns {Object} - { redirectMap: Map of courseId -> url -> loadedUrl, assignmentRedirects: Array of assignments that redirect to quizzes }
 */
function loadRequestQueueRedirects(extractionFolder) {
  const redirectMap = {};
  const assignmentRedirects = {}; // courseId -> assignmentId -> { assignmentId, url, quizId }
  const requestQueuesDir = path.join(STORAGE_DIR, extractionFolder, 'request_queues');
  
  if (!fs.existsSync(requestQueuesDir)) {
    return { redirectMap, assignmentRedirects };
  }

  // Find all mapping request queue directories
  const queueDirs = fs.readdirSync(requestQueuesDir, { withFileTypes: true })
    .filter(dirent => dirent.isDirectory() && dirent.name.startsWith('mapping-'))
    .map(dirent => dirent.name);

  for (const queueDir of queueDirs) {
    const queuePath = path.join(requestQueuesDir, queueDir);
    const queueFiles = fs.readdirSync(queuePath)
      .filter(f => f.endsWith('.json'))
      .sort();

    for (const queueFile of queueFiles) {
      try {
        const queueData = JSON.parse(fs.readFileSync(path.join(queuePath, queueFile), 'utf8'));
        const jsonData = typeof queueData.json === 'string' ? JSON.parse(queueData.json) : queueData.json;
        
        if (jsonData.url && jsonData.loadedUrl && jsonData.url !== jsonData.loadedUrl) {
          // Extract course ID from URL
          const courseMatch = jsonData.url.match(/\/courses\/(\d+)/);
          if (courseMatch) {
            const courseId = courseMatch[1];
            if (!redirectMap[courseId]) {
              redirectMap[courseId] = {};
            }
            redirectMap[courseId][jsonData.url] = jsonData.loadedUrl;
            
            // Check if this is an assignment redirecting to a quiz
            const assignmentMatch = jsonData.url.match(/\/assignments\/(\d+)/);
            const quizMatch = jsonData.loadedUrl.match(/\/quizzes\/(\d+)/);
            if (assignmentMatch && quizMatch) {
              const assignmentId = assignmentMatch[1];
              const quizId = quizMatch[1];
              if (!assignmentRedirects[courseId]) {
                assignmentRedirects[courseId] = {};
              }
              assignmentRedirects[courseId][assignmentId] = {
                assignmentId,
                url: jsonData.url,
                quizId
              };
            }
          }
        }
      } catch (error) {
        // Ignore errors reading individual queue files
      }
    }
  }

  return { redirectMap, assignmentRedirects };
}

/**
 * Load mapping data from latest extraction folder (depth 0-1 only)
 * @param {string} extractionFolder - The extraction folder name
 * @returns {Object} - Mapping data grouped by courseId and classification
 */
function loadLatestMappingData(extractionFolder) {
  const mappingDir = path.join(STORAGE_DIR, extractionFolder, 'datasets', 'mapping');
  
  if (!fs.existsSync(mappingDir)) {
    console.warn(`  ⚠️  Mapping directory not found: ${mappingDir}`);
    return { _assignmentRedirects: {} };
  }

  // Build module item to module ID map
  const moduleItemMap = buildModuleItemToModuleMap(extractionFolder);
  
  // Load request queue redirects
  const { redirectMap, assignmentRedirects } = loadRequestQueueRedirects(extractionFolder);

  const mappingData = { _assignmentRedirects: assignmentRedirects };
  const files = fs.readdirSync(mappingDir)
    .filter(f => f.endsWith('.json'))
    .sort(); // Sort for consistent processing
  
  // If no mapping files found, return empty structure
  if (files.length === 0) {
    return mappingData;
  }

  for (const file of files) {
    try {
      const filePath = path.join(mappingDir, file);
      const data = JSON.parse(fs.readFileSync(filePath, 'utf8'));
      
      // Only include relevant content types
      const relevantTypes = ['assignment', 'announcement', 'announcements-list', 'files-list', 'module', 'page', 'discussion', 'quiz'];
      if (!data.classification || !relevantTypes.includes(data.classification)) {
        continue;
      }

      const courseId = data.courseId;
      if (!courseId) continue;

      if (!mappingData[courseId]) {
        mappingData[courseId] = {
          assignments: [],
          announcements: [],
          files: [],
          modules: [],
          pages: [],
          quizzes: []
        };
      }

      // Normalize classification names
      let type = data.classification;
      if (type === 'announcements-list') type = 'announcements';
      if (type === 'files-list') type = 'files';
      if (type === 'discussion') type = 'announcements';
      if (type === 'quiz') type = 'quizzes';

      const typeKey = type === 'assignment' ? 'assignments' :
                     type === 'announcement' || type === 'announcements' ? 'announcements' :
                     type === 'file' || type === 'files' ? 'files' :
                     type === 'module' ? 'modules' :
                     type === 'page' ? 'pages' :
                     type === 'quiz' || type === 'quizzes' ? 'quizzes' : null;

      if (typeKey && mappingData[courseId][typeKey]) {
        // Extract ID from URL
        let itemId = null;
        if (data.url) {
          if (typeKey === 'assignments') {
            const match = data.url.match(/\/assignments\/(\d+)/);
            itemId = match ? match[1] : null;
          } else if (typeKey === 'announcements') {
            const match = data.url.match(/\/discussion_topics\/(\d+)/);
            itemId = match ? match[1] : null;
          } else if (typeKey === 'modules') {
            // Handle both /modules/{moduleId} and /modules/items/{itemId} URLs
            const moduleMatch = data.url.match(/\/modules\/(\d+)/);
            if (moduleMatch) {
              itemId = moduleMatch[1];
            } else {
              // Try to extract module ID from module item URL
              const itemMatch = data.url.match(/\/modules\/items\/(\d+)/);
              if (itemMatch) {
                const moduleItemId = itemMatch[1];
                const normalizedCourseId = String(courseId).trim();
                // Look up module ID from extracted module files
                if (moduleItemMap[normalizedCourseId] && moduleItemMap[normalizedCourseId][moduleItemId]) {
                  itemId = moduleItemMap[normalizedCourseId][moduleItemId];
                } else {
                  // If we can't find the module ID, store the item ID with a special marker
                  // We'll handle this later in buildBaselineCourseData
                  itemId = `item_${moduleItemId}`;
                }
              }
            }
          } else if (typeKey === 'pages') {
            const match = data.url.match(/\/pages\/([^\/\?]+)/);
            itemId = match ? match[1] : null;
          } else if (typeKey === 'quizzes') {
            const match = data.url?.match(/\/quizzes\/(\d+)/);
            itemId = match ? match[1] : null;
          } else if (typeKey === 'files') {
            // For files, use URL as ID since structure is more complex
            itemId = data.url;
          }
        }

        // Get loadedUrl from redirect map if available
        const normalizedCourseId = String(courseId).trim();
        const loadedUrl = redirectMap[normalizedCourseId] && redirectMap[normalizedCourseId][data.url]
          ? redirectMap[normalizedCourseId][data.url]
          : (data.loadedUrl || null);

        mappingData[courseId][typeKey].push({
          url: data.url,
          loadedUrl: loadedUrl,
          id: itemId,
          depth: data.depth || 0,
          discoveredAt: data.discoveredAt
        });
      }
    } catch (error) {
      console.warn(`Warning: Could not parse mapping file ${file}: ${error.message}`);
    }
  }

  return mappingData;
}

/**
 * Get course name from existing course folders by matching courseId
 * Falls back to Canvas if not found in stored data
 */
function getCourseNameFromStoredData(courseId, extractionFolder) {
  const coursesDir = path.join(STORAGE_DIR, extractionFolder, 'datasets', 'courses');
  if (!fs.existsSync(coursesDir)) return null;
  
  const courseDirs = fs.readdirSync(coursesDir, { withFileTypes: true })
    .filter(dirent => dirent.isDirectory())
    .map(dirent => dirent.name);
  
  // Try to find course folder by checking courseId in files
  for (const dir of courseDirs) {
    const assignmentsDir = path.join(coursesDir, dir, 'assignments');
    if (fs.existsSync(assignmentsDir)) {
      const files = fs.readdirSync(assignmentsDir).filter(f => f.endsWith('.json'));
      if (files.length > 0) {
        try {
          const firstFile = JSON.parse(fs.readFileSync(path.join(assignmentsDir, files[0]), 'utf8'));
          if (String(firstFile.courseId || '').trim() === String(courseId).trim()) {
            return dir; // Return the folder name as the course name
          }
        } catch (e) {
          continue;
        }
      }
    }
    // Also check announcements if assignments not found
    const announcementsDir = path.join(coursesDir, dir, 'announcements');
    if (fs.existsSync(announcementsDir)) {
      const files = fs.readdirSync(announcementsDir).filter(f => f.endsWith('.json'));
      if (files.length > 0) {
        try {
          const firstFile = JSON.parse(fs.readFileSync(path.join(announcementsDir, files[0]), 'utf8'));
          if (String(firstFile.courseId || '').trim() === String(courseId).trim()) {
            return dir;
          }
        } catch (e) {
          continue;
        }
      }
    }
  }
  
  return null;
}

/**
 * Get course name from Canvas course page (fallback)
 */
async function getCourseNameFromCanvas(page, courseId) {
  try {
    const url = `${CANVAS_URL}/courses/${courseId}`;
    
    // Use a shorter timeout for course name extraction
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 5000 });
    await page.waitForTimeout(500);
    
    const courseName = await page.evaluate(() => {
      // Try multiple selectors for course name
      const selectors = [
        'h1.course-name',
        '.course-header h1',
        '.course-title',
        'h1',
        '[data-testid="course-name"]',
        '.ig-header-title'
      ];
      
      for (const selector of selectors) {
        const el = document.querySelector(selector);
        if (el) {
          const text = el.textContent.trim();
          if (text && text.length > 0 && !text.includes('Loading')) {
            return text;
          }
        }
      }
      return null;
    });
    
    return courseName;
  } catch (error) {
    console.warn(`  ⚠️  Could not get course name from Canvas for ${courseId}: ${error.message}`);
    return null;
  }
}

/**
 * Quick check of announcements list page with surface-level DOM examination
 */
async function quickCheckAnnouncements(page, courseId) {
  try {
    const url = `${CANVAS_URL}/courses/${courseId}/announcements`;
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: PAGE_CHECK_TIMEOUT });
    await waitForListRender(page, ['.discussion', '.announcement', '.discussion-list-item', '.ig-list-item', '[data-testid="discussion-list"]']);
    
    const data = await page.evaluate(() => {
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
              
              // Surface-level examination: get title, date, author from list item
              const listItem = link.closest('.discussion, .announcement, .discussion-list-item, .discussion-topic, li, tr, .ig-list-item');
              let postDate = null;
              let author = null;
              let lastReplyDate = null;
              let modifiedDate = null;
              
              if (listItem) {
                // Try to find date/time elements
                const dateSelectors = [
                  'time[datetime]',
                  '.posted-at',
                  '.date',
                  '.discussion-date',
                  '.entry-date',
                  '[data-testid="post-date"]',
                  '.ig-list-item__content time',
                  '.ig-list-item__content .date'
                ];
                
                for (const selector of dateSelectors) {
                  const dateEl = listItem.querySelector(selector);
                  if (dateEl) {
                    postDate = dateEl.getAttribute('datetime') || 
                              dateEl.getAttribute('title') ||
                              dateEl.textContent.trim();
                    break;
                  }
                }
                
                // Try to find author
                const authorSelectors = [
                  '.author',
                  '.posted-by',
                  '.user-name',
                  '.discussion-author',
                  '.entry-author',
                  '[data-testid="author"]',
                  '.ig-list-item__content .author'
                ];
                
                for (const selector of authorSelectors) {
                  const authorEl = listItem.querySelector(selector);
                  if (authorEl) {
                    author = authorEl.textContent.trim();
                    break;
                  }
                }
                
                // Try to find last reply date
                const lastReplyEl = listItem.querySelector('.last-reply, .last-reply-date, [data-testid="last-reply"]');
                if (lastReplyEl) {
                  lastReplyDate = lastReplyEl.getAttribute('datetime') || 
                                 lastReplyEl.getAttribute('title') ||
                                 lastReplyEl.textContent.trim();
                }

                const modifiedSelectors = [
                  '.updated-at',
                  '.modified-date',
                  '[data-testid="updated-date"]'
                ];

                for (const selector of modifiedSelectors) {
                  const modifiedEl = listItem.querySelector(selector);
                  if (modifiedEl) {
                    modifiedDate = modifiedEl.getAttribute('datetime') ||
                                  modifiedEl.getAttribute('title') ||
                                  modifiedEl.textContent.trim();
                    break;
                  }
                }
              }
              
              announcements.push({
                id,
                url: fullUrl,
                title: link.textContent.trim(),
                postDate,
                author,
                lastReplyDate,
                modifiedDate
              });
            }
          }
        }
      });
      
      return {
        count: announcements.length,
        items: announcements
      };
    });
    
    return data;
  } catch (error) {
    console.error(`  ⚠️  Error checking announcements for course ${courseId}: ${error.message}`);
    return { count: 0, items: [] };
  }
}

/**
 * Quick check of assignments list page with surface-level DOM examination
 */
async function quickCheckAssignments(page, courseId) {
  try {
    const url = `${CANVAS_URL}/courses/${courseId}/assignments`;
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: PAGE_CHECK_TIMEOUT });
    await waitForListRender(page, ['.assignment', '.assignment-list-item', '.ig-list-item', '.element_toggler', '[data-testid="assignments-list"]']);
    
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
              
              // Surface-level examination: get due date, points, status from list item
              const listItem = link.closest('.assignment, .assignment-list-item, li, tr, .ig-list-item');
              let dueDate = null;
              let points = null;
              let status = null;
              let modifiedDate = null;
              
              if (listItem) {
                // Enhanced due date extraction from assignments list page
                // CRITICAL: Only extract "Due" dates, NOT "Available until" dates
                // Strategy 1: Find all time elements and identify ONLY the due date one (exclude availability dates)
                const timeElements = listItem.querySelectorAll('time[datetime]');
                const timeElementsWithContext = [];
                
                for (const timeEl of timeElements) {
                  const datetime = timeEl.getAttribute('datetime');
                  if (datetime) {
                    // Get context around this time element to determine if it's a due date
                    const parentEl = timeEl.parentElement;
                    const parentText = (parentEl?.textContent || '').toLowerCase();
                    const grandparentText = (parentEl?.parentElement?.textContent || '').toLowerCase();
                    const title = timeEl.getAttribute('title')?.toLowerCase() || '';
                    const ariaLabel = timeEl.getAttribute('aria-label')?.toLowerCase() || '';
                    const contextText = (parentText + ' ' + grandparentText + ' ' + title + ' ' + ariaLabel).toLowerCase();
                    
                    // Check for explicit availability indicators
                    const isAvailability = contextText.includes('available until') || 
                                          contextText.includes('available from') ||
                                          (contextText.includes('available') && contextText.includes('until'));
                    
                    // Check for explicit due date indicators
                    const isDueDate = contextText.includes('due') && !contextText.includes('available');
                    
                    // Check for Canvas-specific class names that indicate due dates
                    const hasDueClass = timeEl.closest('.due-date, .assignment-due-date, .due-date-display, [data-testid="due-date"]');
                    
                    timeElementsWithContext.push({
                      element: timeEl,
                      datetime: datetime,
                      isAvailability: isAvailability,
                      isDueDate: isDueDate,
                      hasDueClass: !!hasDueClass,
                      contextText: contextText
                    });
                  }
                }
                
                // Prioritize: explicit due dates > elements with due classes > first non-availability date
                for (const item of timeElementsWithContext) {
                  if (item.isAvailability) {
                    continue; // Skip availability dates
                  }
                  if (item.isDueDate || item.hasDueClass) {
                    dueDate = item.datetime;
                    break;
                  }
                  // If no explicit due date found yet, use the first non-availability date as fallback
                  // (Canvas often shows due date without explicit "due" label)
                  if (!dueDate) {
                    dueDate = item.datetime;
                  }
                }
                
                // Strategy 2: Look for due date in table cells (if assignments are in a table)
                // Canvas often displays assignments in tables with due dates in specific columns
                if (!dueDate && listItem.tagName === 'TR') {
                  const cells = listItem.querySelectorAll('td, th');
                  
                  // First pass: look for cells with explicit "due" text
                  for (const cell of cells) {
                    const cellText = cell.textContent?.toLowerCase() || '';
                    // Process cells that mention "due" and exclude "available"
                    if (cellText.includes('due') && !cellText.includes('available')) {
                      const timeEl = cell.querySelector('time[datetime]');
                      if (timeEl) {
                        // Double-check the context doesn't say "available"
                        const timeContext = (timeEl.parentElement?.textContent || '').toLowerCase();
                        if (!timeContext.includes('available')) {
                          dueDate = timeEl.getAttribute('datetime');
                          if (dueDate) break;
                        }
                      }
                      // Try to extract date from text, but only if it's clearly a due date
                      if (!dueDate && cellText.includes('due:')) {
                        const dateMatch = cellText.match(/due:\s*([^\n]+)/i);
                        if (dateMatch) {
                          dueDate = dateMatch[1].trim();
                          break;
                        }
                      }
                    }
                  }
                  
                  // Second pass: if no explicit "due" found, look for time elements in cells
                  // that don't have "available" context (Canvas often shows due dates without labels)
                  if (!dueDate) {
                    for (const cell of cells) {
                      const cellText = cell.textContent?.toLowerCase() || '';
                      // Skip cells that explicitly mention availability
                      if (cellText.includes('available until') || cellText.includes('available from')) {
                        continue;
                      }
                      
                      const timeEl = cell.querySelector('time[datetime]');
                      if (timeEl) {
                        const datetime = timeEl.getAttribute('datetime');
                        if (datetime) {
                          // Use this date if it's not in an availability context
                          const timeContext = (timeEl.parentElement?.textContent || '').toLowerCase();
                          if (!timeContext.includes('available until') && !timeContext.includes('available from')) {
                            dueDate = datetime;
                            break;
                          }
                        }
                      }
                    }
                  }
                }
                
                // Strategy 3: Look for the dedicated “Due” fields created by Canvas
                if (!dueDate) {
                  const dueContainer = listItem.querySelector('.assignment-date-due, .ig-details__item.assignment-date-due, .assignment-date');
                  if (dueContainer) {
                    const dueSpan = dueContainer.querySelector('span[data-html-tooltip-title], span[title], time[datetime]');
                    if (dueSpan) {
                      const tooltipDate = dueSpan.getAttribute('data-html-tooltip-title') || dueSpan.getAttribute('title');
                      if (tooltipDate && !tooltipDate.toLowerCase().includes('available')) {
                        dueDate = tooltipDate;
                      } else {
                        const datetime = dueSpan.getAttribute('datetime') || dueSpan.getAttribute('data-date') || dueSpan.textContent.trim();
                        if (datetime && !datetime.toLowerCase().includes('available')) {
                          dueDate = datetime;
                        }
                      }
                    } else {
                      const strongLabel = dueContainer.querySelector('strong');
                      if (strongLabel && strongLabel.textContent.toLowerCase().includes('due')) {
                        const sibling = strongLabel.nextElementSibling;
                        if (sibling) {
                          const possibleDate = sibling.textContent.trim();
                          if (possibleDate && !possibleDate.toLowerCase().includes('available')) {
                            dueDate = possibleDate;
                          }
                        }
                      }
                    }
                  }
                }
                
                // Strategy 4: Look for "Due:" patterns in the entire row text (exclude "Available")
                if (!dueDate) {
                  const rowText = listItem.textContent || '';
                  // Only look for patterns that explicitly say "Due:" and exclude "Available until"
                  // Split by lines/sections to avoid matching availability dates
                  const lines = rowText.split(/\n|•|·|,|;/);
                  for (const line of lines) {
                    const lowerLine = line.toLowerCase().trim();
                    // Skip lines that mention "available" or are too short
                    if (lowerLine.includes('available') || lowerLine.length < 5) {
                      continue;
                    }
                    // Look for "Due:" pattern with various formats
                    const duePatterns = [
                      /Due:\s*([A-Z][a-z]{2,3}\s+\d{1,2},?\s+\d{4}(?:\s+at\s+\d{1,2}:\d{2}(?:am|pm))?)/i,
                      /Due\s+([A-Z][a-z]{2,3}\s+\d{1,2},?\s+\d{4}(?:\s+at\s+\d{1,2}:\d{2}(?:am|pm))?)/i,
                      /Due\s+(\d{1,2}\/\d{1,2}\/\d{4}(?:\s+at\s+\d{1,2}:\d{2}(?:am|pm))?)/i,
                      /Due:\s*(\d{1,2}\/\d{1,2}\/\d{4}(?:\s+at\s+\d{1,2}:\d{2}(?:am|pm))?)/i
                    ];
                    
                    for (const pattern of duePatterns) {
                      const dueMatch = line.match(pattern);
                      if (dueMatch && dueMatch[1]) {
                        dueDate = dueMatch[1].trim();
                        break;
                      }
                    }
                    if (dueDate) break;
                  }
                }
                
                // Strategy 5: Look for Canvas-specific data attributes and structures
                // Canvas often uses data attributes for dates
                if (!dueDate) {
                  // Look for elements with data-date or data-due-date attributes
                  const dataDateEls = listItem.querySelectorAll('[data-date], [data-due-date], [data-due-at]');
                  for (const el of dataDateEls) {
                    const dataDate = el.getAttribute('data-date') || 
                                   el.getAttribute('data-due-date') || 
                                   el.getAttribute('data-due-at');
                    if (dataDate) {
                      const context = (el.textContent || el.getAttribute('title') || '').toLowerCase();
                      if (!context.includes('available until') && !context.includes('available from')) {
                        try {
                          const parsed = new Date(dataDate);
                          if (!isNaN(parsed.getTime())) {
                            dueDate = parsed.toISOString();
                            break;
                          }
                        } catch (e) {
                          dueDate = dataDate;
                          break;
                        }
                      }
                    }
                  }
                }
                
                // Strategy 6: Fallback - look for any time element that's NOT in an availability context
                // This is a last resort for assignments where due date isn't explicitly labeled
                // Be more permissive - if we can't find "available until", assume it's a due date
                if (!dueDate) {
                  const allTimeElements = listItem.querySelectorAll('time[datetime]');
                  const candidateDates = [];
                  
                  for (const timeEl of allTimeElements) {
                    const datetime = timeEl.getAttribute('datetime');
                    if (datetime) {
                      // Get broader context
                      const listItemText = listItem.textContent?.toLowerCase() || '';
                      const timeContext = (timeEl.parentElement?.textContent || '').toLowerCase();
                      const timeTitle = (timeEl.getAttribute('title') || '').toLowerCase();
                      const timeAriaLabel = (timeEl.getAttribute('aria-label') || '').toLowerCase();
                      const fullContext = listItemText + ' ' + timeContext + ' ' + timeTitle + ' ' + timeAriaLabel;
                      
                      // EXCLUDE if it's clearly an availability date
                      const isAvailability = fullContext.includes('available until') || 
                                            fullContext.includes('available from') ||
                                            (fullContext.includes('available') && fullContext.includes('until'));
                      
                      if (!isAvailability) {
                        // Check if it's explicitly a due date (higher priority)
                        const isExplicitDue = fullContext.includes('due') && !fullContext.includes('available');
                        
                        candidateDates.push({
                          datetime: datetime,
                          isExplicitDue: isExplicitDue,
                          element: timeEl
                        });
                      }
                    }
                  }
                  
                  // Prioritize explicit due dates, then use any non-availability date
                  candidateDates.sort((a, b) => {
                    if (a.isExplicitDue && !b.isExplicitDue) return -1;
                    if (!a.isExplicitDue && b.isExplicitDue) return 1;
                    return 0;
                  });
                  
                  if (candidateDates.length > 0) {
                    dueDate = candidateDates[0].datetime;
                  }
                }
                
                // Strategy 7: Last resort - look for any date-like text that mentions "due"
                // This handles cases where Canvas displays dates as plain text
                if (!dueDate) {
                  const listItemText = listItem.textContent || '';
                  // Look for patterns like "Due Dec 3" or "Due: 12/3/2025"
                  const dueTextPatterns = [
                    /due\s*:?\s*([A-Z][a-z]{2,3}\s+\d{1,2},?\s+\d{4})/i,
                    /due\s*:?\s*(\d{1,2}\/\d{1,2}\/\d{4})/i,
                    /due\s*:?\s*(\d{4}-\d{2}-\d{2})/i
                  ];
                  
                  for (const pattern of dueTextPatterns) {
                    const match = listItemText.match(pattern);
                    if (match && match[1]) {
                      const dateText = match[1].trim();
                      // Try to parse it
                      try {
                        const parsed = new Date(dateText);
                        if (!isNaN(parsed.getTime())) {
                          dueDate = parsed.toISOString();
                          break;
                        }
                      } catch (e) {
                        // If parsing fails, use text as-is
                        dueDate = dateText;
                        break;
                      }
                    }
                  }
                }
                
                // Try to find points
                const pointsEl = listItem.querySelector('.points, .assignment-points, [data-testid="points"]');
                if (pointsEl) {
                  points = pointsEl.textContent.trim();
                }
                
                // Try to find status
                const statusEl = listItem.querySelector('.assignment-status, .status, [data-testid="status"]');
                if (statusEl) {
                  status = statusEl.textContent.trim();
                }
                
                // Try to find modified date
                const modifiedEl = listItem.querySelector('.modified-date, .updated-date, [data-testid="modified"]');
                if (modifiedEl) {
                  modifiedDate = modifiedEl.getAttribute('datetime') || 
                                  modifiedEl.getAttribute('title') ||
                                  modifiedEl.textContent.trim();
                }
              }
              
              assignments.push({
                id,
                url: fullUrl,
                title: link.textContent.trim(),
                dueDate,
                points,
                status,
                modifiedDate
              });
            }
          }
        }
      });
      
      return {
        count: assignments.length,
        items: assignments
      };
    });
    
    data.items = (data.items || []).map(item => ({
      ...item,
      dueDate: normalizeDueDateString(item.dueDate) || null
    }));
    
    return data;
  } catch (error) {
    console.error(`  ⚠️  Error checking assignments for course ${courseId}: ${error.message}`);
    return { count: 0, items: [] };
  }
}

/**
 * Quick check of files list page with surface-level DOM examination
 */
async function quickCheckFiles(page, courseId) {
  try {
    const url = `${CANVAS_URL}/courses/${courseId}/files`;
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: PAGE_CHECK_TIMEOUT });
    await waitForListRender(page, ['.ef-directory', '.ef-item-row', '.ef-folder-list', '[data-testid="files-list"]'], 1800);
    
    const data = await page.evaluate(() => {
      const files = [];
      const folders = [];
      
      // Check for file/folder rows
      const rows = document.querySelectorAll('.ef-directory .ef-item-row, .ef-folder-list [role="treeitem"]');
      
      rows.forEach(row => {
        const link = row.querySelector('a');
        if (link) {
          const href = link.getAttribute('href');
          const name = link.textContent.trim();
          
          if (href) {
            const fullUrl = href.startsWith('http') ? href : new URL(href, window.location.href).href;
            
            // Surface-level examination: get size, modified date, etc.
            let size = null;
            let modifiedDate = null;
            let fileType = null;
            
            // Try to find size
            const sizeEl = row.querySelector('.ef-size-col, .file-size, [data-testid="file-size"]');
            if (sizeEl) {
              size = sizeEl.textContent.trim();
            }
            
            // Try to find modified date
            const modifiedEl = row.querySelector('.ef-date-col, .modified-date, .file-modified, [data-testid="modified-date"]');
            if (modifiedEl) {
              modifiedDate = modifiedEl.getAttribute('datetime') || 
                            modifiedEl.getAttribute('title') ||
                            modifiedEl.textContent.trim();
            }
            
            // Try to determine file type from extension
            if (name) {
              const extMatch = name.match(/\.(\w+)$/);
              if (extMatch) {
                fileType = extMatch[1].toLowerCase();
              }
            }
            
            // Check if it's a folder or file
            if (href.includes('/files/folder/') || row.classList.contains('ef-folder')) {
              folders.push({
                url: fullUrl,
                name: name,
                modifiedDate
              });
            } else if (href.includes('/files/')) {
              const fileIdMatch = href.match(/\/files\/(\d+)/);
              files.push({
                id: fileIdMatch ? fileIdMatch[1] : null,
                url: fullUrl,
                name: name,
                size,
                modifiedDate,
                fileType
              });
            }
          }
        }
      });
      
      return {
        count: files.length + folders.length,
        files: files,
        folders: folders
      };
    });
    
    return data;
  } catch (error) {
    console.error(`  ⚠️  Error checking files for course ${courseId}: ${error.message}`);
    return { count: 0, files: [], folders: [] };
  }
}

/**
 * Quick check of modules list page with surface-level DOM examination
 */
async function quickCheckModules(page, courseId) {
  try {
    const url = `${CANVAS_URL}/courses/${courseId}/modules`;
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: PAGE_CHECK_TIMEOUT });
    await waitForListRender(page, ['.context_module', '[data-testid="module"]', '.module'], 1500);
    
    const data = await page.evaluate(() => {
      const modules = [];
      const moduleElements = document.querySelectorAll('.context_module, [data-testid="module"], .module');
      
      moduleElements.forEach(moduleEl => {
        // Try to find module ID from data attributes or URL
        let moduleId = null;
        const moduleIdAttr = moduleEl.getAttribute('data-module-id') || 
                            moduleEl.getAttribute('id')?.match(/context_module_(\d+)/)?.[1];
        
        if (moduleIdAttr) {
          moduleId = moduleIdAttr;
        } else {
          // Try to find link to module
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
          // Surface-level examination: get name, item count, unlock date, etc.
          const nameEl = moduleEl.querySelector('.ig-header-title, .module-name, h3, h2');
          const name = nameEl ? nameEl.textContent.trim() : null;
          
          // Count items in module
          const itemCount = moduleEl.querySelectorAll('.ig-list-item, .module-item').length;
          
          // Try to find unlock date
          let unlockDate = null;
          const unlockEl = moduleEl.querySelector('.unlock-date, .module-unlock, [data-testid="unlock-date"]');
          if (unlockEl) {
            unlockDate = unlockEl.getAttribute('datetime') || 
                        unlockEl.getAttribute('title') ||
                        unlockEl.textContent.trim();
          }
          
          // Try to find completion status
          let completionStatus = null;
          const completionEl = moduleEl.querySelector('.module-completion, .completion-status');
          if (completionEl) {
            completionStatus = completionEl.textContent.trim();
          }
          
          // Get module URL
          const link = moduleEl.querySelector('a[href*="/modules/"]');
          const href = link ? link.getAttribute('href') : null;
          const fullUrl = href ? (href.startsWith('http') ? href : new URL(href, window.location.href).href) : null;
          
          if (fullUrl) {
            modules.push({
              id: moduleId,
              url: fullUrl,
              title: name || `Module ${moduleId}`,
              itemCount,
              unlockDate,
              completionStatus
            });
          }
        }
      });
      
      return {
        count: modules.length,
        items: modules
      };
    });
    
    return data;
  } catch (error) {
    console.error(`  ⚠️  Error checking modules for course ${courseId}: ${error.message}`);
    return { count: 0, items: [] };
  }
}

/**
 * Quick check of pages list page
 */
async function quickCheckPages(page, courseId) {
  try {
    const url = `${CANVAS_URL}/courses/${courseId}/pages`;
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: PAGE_CHECK_TIMEOUT });
    await waitForListRender(page, ['.pages', '.ig-list', '.collectionViewItems', '[data-testid="pages-list"]'], 1000);
    
    const data = await page.evaluate(() => {
      const links = document.querySelectorAll('a[href*="/pages/"]');
      const pageSlugs = new Set();
      const pages = [];
      
      links.forEach(link => {
        const href = link.getAttribute('href');
        if (href && href.includes('/pages/')) {
          const match = href.match(/\/pages\/([^\/\?]+)/);
          if (match) {
            const slug = match[1];
            if (!pageSlugs.has(slug)) {
              pageSlugs.add(slug);
              const fullUrl = href.startsWith('http') ? href : new URL(href, window.location.href).href;
              let title = (link.textContent || '').trim();
              if (!title) {
                title = (link.getAttribute('aria-label') || link.getAttribute('title') || '').trim();
              }
              if (!title) {
                const fallbackEl = link.querySelector('[data-testid="page-title"], .ellipsible, span, strong');
                if (fallbackEl) {
                  title = fallbackEl.textContent?.trim() || '';
                }
              }
              pages.push({
                slug,
                url: fullUrl,
                title
              });
            }
          }
        }
      });
      
      return {
        count: pages.length,
        items: pages
      };
    });
    
    return data;
  } catch (error) {
    console.error(`  ⚠️  Error checking pages for course ${courseId}: ${error.message}`);
    return { count: 0, items: [] };
  }
}

/**
 * Create a simple hash from item data for change detection
 * Normalizes data to avoid false positives from formatting differences
 */
function createItemHash(item, contentType) {
  const crypto = require('crypto');
  
  // Normalize and extract only comparable fields
  const normalizeString = (str) => (str || '').toString().trim().toLowerCase();
  const normalizeDate = (date) => {
    if (!date) return null;
    const dateStr = date.toString().trim();
    if (!dateStr) return null;
    
    // Try ISO format first (YYYY-MM-DD or YYYY-MM-DDTHH:mm:ss)
    const isoMatch = dateStr.match(/(\d{4}-\d{2}-\d{2})(?:T|\s|$)/);
    if (isoMatch) {
      return isoMatch[1]; // Return YYYY-MM-DD
    }
    
    // Try Canvas text formats like "Dec 3 at 12pm", "Dec 3, 2025 at 12pm", "Available until Dec 3 at 12pm"
    // Pattern: Month Day, Year (optional) at time (optional)
    const canvasTextMatch = dateStr.match(/(?:available until|due|until)?\s*([A-Z][a-z]{2,3})\s+(\d{1,2}),?\s*(\d{4})?/i);
    if (canvasTextMatch) {
      const monthNames = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];
      const monthName = canvasTextMatch[1].toLowerCase().substring(0, 3);
      const day = canvasTextMatch[2].padStart(2, '0');
      const year = canvasTextMatch[3] || new Date().getFullYear(); // Use current year if not specified
      const monthIndex = monthNames.indexOf(monthName);
      if (monthIndex !== -1) {
        const month = String(monthIndex + 1).padStart(2, '0');
        return `${year}-${month}-${day}`;
      }
    }
    
    // Try other common formats
    // MM/DD/YYYY or DD/MM/YYYY
    const slashMatch = dateStr.match(/(\d{1,2})\/(\d{1,2})\/(\d{4})/);
    if (slashMatch) {
      const [, month, day, year] = slashMatch;
      // Assume MM/DD/YYYY format (US standard)
      return `${year}-${month.padStart(2, '0')}-${day.padStart(2, '0')}`;
    }
    
    // Try to parse as Date and extract YYYY-MM-DD
    try {
      const parsed = new Date(dateStr);
      if (!isNaN(parsed.getTime())) {
        const year = parsed.getFullYear();
        const month = String(parsed.getMonth() + 1).padStart(2, '0');
        const day = String(parsed.getDate()).padStart(2, '0');
        return `${year}-${month}-${day}`;
      }
    } catch (e) {
      // Ignore parse errors
    }
    
    // Fallback: normalize string (for text dates like "Due tomorrow", "Closed", etc.)
    // For non-date strings, return null to avoid false positives
    const lowerStr = dateStr.toLowerCase();
    if (lowerStr.includes('closed') || lowerStr.includes('no due date') || lowerStr.includes('tomorrow') || lowerStr.includes('yesterday')) {
      return null; // These are status indicators, not dates
    }
    return normalizeString(dateStr);
  };
  
  const hashData = {
    id: String(contentType === 'pages' ? item.slug : item.id || ''),
    title: normalizeString(item.title || item.name),
    // Only include dates if they exist, and normalize them
    dueDate: item.dueDate ? normalizeDate(item.dueDate) : null,
    modifiedDate: item.modifiedDate ? normalizeDate(item.modifiedDate) : null,
    postDate: item.postDate ? normalizeDate(item.postDate) : null,
    // Normalize points (remove units, just number)
    points: item.points ? normalizeString(item.points).replace(/[^\d.]/g, '') : null
  };
  
  // Remove null values to avoid hash differences from missing fields
  Object.keys(hashData).forEach(key => {
    if (hashData[key] === null || hashData[key] === '') {
      delete hashData[key];
    }
  });
  
  const hashString = JSON.stringify(hashData);
  return crypto.createHash('md5').update(hashString).digest('hex');
}

/**
 * Compare stored mapping data with current data and detect new/changed items
 */
function compareMappingData(storedMapping, currentData, contentType, storedExtractedData = {}) {
  const storedItems = storedMapping[contentType] || [];
  const currentItems = currentData[contentType] || { items: [], count: 0 };
  // storedExtractedData is now an object with IDs as keys, not an array
  const storedExtracted = storedExtractedData[contentType] || {};
  
  // Create maps of stored items by ID for quick lookup
  const storedById = new Map();
  const storedExtractedById = new Map();
  
  storedItems.forEach(item => {
    const id = contentType === 'pages' ? item.slug : item.id;
    if (id) {
      // Normalize ID for comparison (string, trimmed, lowercase for pages)
      const normalizedId = contentType === 'pages' ? String(id).trim().toLowerCase() : String(id).trim();
      storedById.set(normalizedId, item);
    }
  });
  
  // storedExtractedData is now an object with IDs as keys, not an array
  if (storedExtracted && typeof storedExtracted === 'object' && !Array.isArray(storedExtracted)) {
    Object.keys(storedExtracted).forEach(id => {
      const normalizedId = contentType === 'pages' ? String(id).trim().toLowerCase() : String(id).trim();
      storedExtractedById.set(normalizedId, storedExtracted[id]);
    });
  } else if (Array.isArray(storedExtracted)) {
    // Fallback for array format (legacy)
    storedExtracted.forEach(item => {
      const id = contentType === 'assignments' ? item.assignmentId :
                  contentType === 'announcements' ? item.announcementId :
                  contentType === 'modules' ? item.moduleId :
                  contentType === 'pages' ? item.pageSlug :
                  contentType === 'files' ? item.fileId : null;
      if (id) {
        const normalizedId = contentType === 'pages' ? String(id).trim().toLowerCase() : String(id).trim();
        storedExtractedById.set(normalizedId, item);
      }
    });
  }
  
  // Debug logging
  if (process.env.DEBUG_UPDATE === 'true' && storedExtractedById.size > 0) {
    const sampleIds = Array.from(storedExtractedById.keys()).slice(0, 5);
    console.log(`    🔍 Stored ${contentType} IDs (sample): ${sampleIds.join(', ')}`);
  }
  
  const newItems = [];
  const changedItems = [];
  
  if (contentType === 'files') {
    // For files, compare URLs since structure is more complex
    const storedUrls = new Set(storedItems.map(item => item.url).filter(Boolean));
    
    currentData.files.files.forEach(file => {
      if (file.url && !storedUrls.has(file.url)) {
        // Not in mapping at all - definitely new
        newItems.push(file);
      } else if (file.url && storedUrls.has(file.url)) {
        // In mapping - check if it was extracted
        const storedFile = storedItems.find(item => item.url === file.url);
        const storedExtractedFile = storedExtractedById.get(String(file.id));
        
        // If in mapping but never extracted, treat as new
        if (!storedExtractedFile) {
          newItems.push(file);
        } else {
          // Both in mapping and extracted - assume it's current
          // Skip change detection to avoid false positives
        }
      }
    });
    
    currentData.files.folders.forEach(folder => {
      if (folder.url && !storedUrls.has(folder.url)) {
        newItems.push(folder);
      }
    });
    
    // Only report changes if there are actually new items to extract
    return {
      hasChanges: newItems.length > 0,
      newItems: newItems,
      changedItems: changedItems,
      countDiff: currentData.files.count - storedItems.length
    };
  } else {
    // For other content types, compare by ID
    currentItems.items.forEach(item => {
      // For modules, use 'id' field (from quickCheckModules)
      // For pages, use 'slug' field
      // For others, use 'id' field
      const id = contentType === 'pages' ? item.slug : 
                 contentType === 'modules' ? item.id : 
                 item.id;
      if (!id) return;
      
      // Normalize ID for comparison (string, trimmed, lowercase for pages)
      const normalizedId = contentType === 'pages' ? String(id).trim().toLowerCase() : String(id).trim();
      
      const storedItem = storedById.get(normalizedId);
      const storedExtractedItem = storedExtractedById.get(normalizedId);
      
      // Debug logging for first few items
      if (process.env.DEBUG_UPDATE === 'true' && newItems.length < 3) {
        console.log(`    🔍 Checking ${contentType} ID: ${normalizedId}`);
        console.log(`      - In mapping: ${!!storedItem}`);
        console.log(`      - In extracted: ${!!storedExtractedItem}`);
      }
      
      // If item exists in extracted data, check if it has changed
      if (storedExtractedItem) {
        // Compare current item with stored extracted item to detect changes
        // Only compare fields that were actually extracted from quick check
        // If a field is null in quick check, it means it wasn't available, so don't compare it
        
        // Build current item hash with only fields that were extracted (non-null)
        const currentItemForHash = {
          id: item.id,
          title: item.title || item.name,
          // Only include fields that were actually extracted (not null)
          ...(item.dueDate !== null && item.dueDate !== undefined && { dueDate: item.dueDate }),
          ...(item.modifiedDate !== null && item.modifiedDate !== undefined && { modifiedDate: item.modifiedDate }),
          ...(item.postDate !== null && item.postDate !== undefined && { postDate: item.postDate }),
          ...(item.points !== null && item.points !== undefined && { points: item.points }),
          ...(item.slug !== null && item.slug !== undefined && { slug: item.slug })
        };
        
        const currentHash = createItemHash(currentItemForHash, contentType);
        
        // Create hash from stored extracted item, but only include fields that were in currentItemForHash
        // The extraction summary uses 'id' for all content types, not type-specific fields
        const storedItemForHash = {
          id: storedExtractedItem.id || 
              (contentType === 'assignments' ? storedExtractedItem.assignmentId :
               contentType === 'announcements' ? storedExtractedItem.announcementId :
               contentType === 'modules' ? storedExtractedItem.moduleId :
               contentType === 'pages' ? storedExtractedItem.pageSlug :
               contentType === 'files' ? storedExtractedItem.fileId : normalizedId),
          title: storedExtractedItem.title || storedExtractedItem.name,
          // Only include fields that were in the current item (if current had dueDate, compare it)
          ...(currentItemForHash.dueDate !== undefined && { dueDate: storedExtractedItem.dueDate }),
          ...(currentItemForHash.modifiedDate !== undefined && { modifiedDate: storedExtractedItem.modifiedDate || storedExtractedItem.updatedAt }),
          ...(currentItemForHash.postDate !== undefined && { postDate: storedExtractedItem.postDate || storedExtractedItem.postedAt || storedExtractedItem.createdAt }),
          ...(currentItemForHash.points !== undefined && { points: storedExtractedItem.points || storedExtractedItem.pointsPossible }),
          ...(currentItemForHash.slug !== undefined && { slug: storedExtractedItem.pageSlug || storedExtractedItem.slug })
        };
        
        const storedHash = createItemHash(storedItemForHash, contentType);
        
        if (currentHash !== storedHash) {
          // Item has changed - add to changedItems for re-extraction
          changedItems.push(item);
          if (process.env.DEBUG_UPDATE === 'true') {
            console.log(`    🔄 Item ${normalizedId} has changed (hash differs)`);
            console.log(`      Current: ${currentHash.substring(0, 8)}...`);
            console.log(`      Stored:  ${storedHash.substring(0, 8)}...`);
            console.log(`      Current fields:`, Object.keys(currentItemForHash));
            console.log(`      Stored fields:`, Object.keys(storedItemForHash));
          }
        }
        // If hash matches, item hasn't changed - skip it
        return;
      }
      
      // If not in extracted data, check mapping:
      // - If in mapping but never extracted, treat as new (needs initial extraction)
      // - If not in mapping at all, treat as new (truly new item)
      if (!storedExtractedItem) {
        newItems.push(item);
        if (process.env.DEBUG_UPDATE === 'true') {
          console.log(`    ➕ Item ${normalizedId} not in extracted data - treating as new`);
        }
      }
    });
    
    // Report changes if there are new items OR changed items
    // Count differences alone don't indicate changes (items might have been removed or reorganized)
    return {
      hasChanges: newItems.length > 0 || changedItems.length > 0,
      newItems: newItems,
      changedItems: changedItems,
      countDiff: currentItems.count - storedItems.length
    };
  }
}

/**
 * Find existing item file by ID
 */
function findExistingItemFile(courseFolderName, contentType, itemId, extractionFolder) {
  const datasetDir = path.join(STORAGE_DIR, extractionFolder, 'datasets', 'courses', courseFolderName, contentType);
  if (!fs.existsSync(datasetDir)) return null;
  
  const files = fs.readdirSync(datasetDir).filter(f => f.endsWith('.json'));
  for (const file of files) {
    try {
      const filePath = path.join(datasetDir, file);
      const data = JSON.parse(fs.readFileSync(filePath, 'utf8'));
      
      // Check ID based on content type
      const existingId = contentType === 'assignments' ? String(data.assignmentId) :
                        contentType === 'announcements' ? String(data.announcementId) :
                        contentType === 'modules' ? String(data.moduleId) :
                        contentType === 'pages' ? data.pageSlug :
                        contentType === 'files' ? String(data.fileId) : null;
      
      if (existingId && String(itemId) === String(existingId)) {
        return filePath;
      }
    } catch (e) {
      continue;
    }
  }
  return null;
}

/**
 * Deep extract a single item using appropriate extractor
 * Updates existing files in place, only creates new files for new items
 */
async function deepExtractItem(page, url, contentType, courseId, extractionFolder, itemId = null) {
  try {
    // Set CRAWLEE_STORAGE_DIR to the extraction folder
    process.env.CRAWLEE_STORAGE_DIR = path.join(STORAGE_DIR, extractionFolder);
    
    // Get course folder name from existing data
    // Crawlee stores datasets in {CRAWLEE_STORAGE_DIR}/datasets/courses/
    const coursesDir = path.join(STORAGE_DIR, extractionFolder, 'datasets', 'courses');
    let courseFolderName = courseId;
    
    if (fs.existsSync(coursesDir)) {
      const courseDirs = fs.readdirSync(coursesDir, { withFileTypes: true })
        .filter(dirent => dirent.isDirectory())
        .map(dirent => dirent.name);
      
      // Try to find course folder by checking courseId in files
      for (const dir of courseDirs) {
        // Check assignments first
        const assignmentsDir = path.join(coursesDir, dir, 'assignments');
        if (fs.existsSync(assignmentsDir)) {
          const files = fs.readdirSync(assignmentsDir).filter(f => f.endsWith('.json'));
          if (files.length > 0) {
            try {
              const firstFile = JSON.parse(fs.readFileSync(path.join(assignmentsDir, files[0]), 'utf8'));
              if (firstFile.courseId === courseId) {
                courseFolderName = dir;
                break;
              }
            } catch (e) {
              // Continue searching
            }
          }
        }
        // Also check announcements if assignments not found
        if (courseFolderName === courseId) {
          const announcementsDir = path.join(coursesDir, dir, 'announcements');
          if (fs.existsSync(announcementsDir)) {
            const files = fs.readdirSync(announcementsDir).filter(f => f.endsWith('.json'));
            if (files.length > 0) {
              try {
                const firstFile = JSON.parse(fs.readFileSync(path.join(announcementsDir, files[0]), 'utf8'));
                if (firstFile.courseId === courseId) {
                  courseFolderName = dir;
                  break;
                }
              } catch (e) {
                // Continue searching
              }
            }
          }
        }
      }
    }
    
    const datasetPrefix = `courses/${courseFolderName}`;
    const datasetBasePath = path.join(STORAGE_DIR, extractionFolder, 'datasets', datasetPrefix);
    ensureNotWritingToUpdateTest(datasetBasePath);
    let extractorResult = null;
    
    // Navigate to the page with timeout
    try {
      await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 10000 });
    } catch (error) {
      if (error.message.includes('timeout') || error.message.includes('Navigation')) {
        throw new Error(`Navigation timeout for ${url}: ${error.message}`);
      }
      throw error;
    }
    
    // Use appropriate extractor
    if (contentType === 'assignments') {
      extractorResult = await extractAssignment(page, url);
      itemId = itemId || extractorResult.assignmentId;
    } else if (contentType === 'announcements') {
      extractorResult = await extractAnnouncement(page, url);
      itemId = itemId || extractorResult.announcementId;
    } else if (contentType === 'files') {
      extractorResult = await extractFiles(page, url);
      // For files, we need to handle the structure differently
      // Files extractor returns an object with files array
      if (extractorResult && extractorResult.files && extractorResult.files.length > 0) {
        // Use the first file's ID if available
        itemId = itemId || extractorResult.files[0]?.fileId;
      }
    } else if (contentType === 'modules') {
      extractorResult = await extractModules(page, url);
      // Modules extractor returns an object with modules array
      // Extract module ID from URL or from first module in result
      if (!itemId) {
        const match = url.match(/\/modules\/(\d+)/);
        if (match) {
          itemId = match[1];
        } else if (extractorResult && extractorResult.modules && extractorResult.modules.length > 0) {
          itemId = extractorResult.modules[0]?.moduleId;
        }
      }
      // Note: Modules are stored as a single file per course, not per module
      // So we'll always update the existing modules file if it exists
    } else if (contentType === 'pages') {
      extractorResult = await extractPage(page, url);
      itemId = itemId || extractorResult.pageSlug;
    }
    
    if (!extractorResult) {
      throw new Error('Extraction returned no result');
    }
    
    // For modules, check if any modules file exists (modules are stored as one file per course)
    if (contentType === 'modules') {
      const modulesDir = path.join(STORAGE_DIR, extractionFolder, 'datasets', 'courses', courseFolderName, 'modules');
      // Open dataset to ensure it's properly initialized
      const dataset = await Dataset.open(`${datasetPrefix}/modules`);
      ensureDirectoryExists(modulesDir);
      
      if (fs.existsSync(modulesDir)) {
        const files = fs.readdirSync(modulesDir).filter(f => f.endsWith('.json'));
        if (files.length > 0) {
          // Update the first modules file (there should only be one)
          const existingFile = path.join(modulesDir, files[0]);
          ensureNotWritingToUpdateTest(existingFile);
          fs.writeFileSync(existingFile, JSON.stringify(extractorResult, null, '\t'));
          return { ...extractorResult, _updated: true, _filePath: existingFile };
        }
      }
      // If no existing file, create new one
      await dataset.pushData(extractorResult);
      // Rewrite with tab formatting to match original extraction format
      const allFiles = fs.readdirSync(modulesDir).filter(f => f.endsWith('.json')).sort();
      if (allFiles.length > 0) {
        const filePath = path.join(modulesDir, allFiles[allFiles.length - 1]);
        if (fs.existsSync(filePath)) {
          ensureNotWritingToUpdateTest(filePath);
          fs.writeFileSync(filePath, JSON.stringify(extractorResult, null, '\t'));
        }
      }
      return { ...extractorResult, _created: true };
    }
    
    // Check if item already exists for other content types
    const existingFile = itemId ? findExistingItemFile(courseFolderName, contentType, itemId, extractionFolder) : null;
    
    if (existingFile) {
      // Update existing file in place
      // First, open the dataset to ensure it's properly initialized
      let dataset;
      if (contentType === 'assignments') {
        dataset = await Dataset.open(`${datasetPrefix}/assignments`);
      } else if (contentType === 'announcements') {
        dataset = await Dataset.open(`${datasetPrefix}/announcements`);
      } else if (contentType === 'files') {
        dataset = await Dataset.open(`${datasetPrefix}/files`);
      } else if (contentType === 'pages') {
        dataset = await Dataset.open(`${datasetPrefix}/pages`);
      }
      
      // Ensure the dataset directory structure exists
      if (dataset) {
        // Opening the dataset ensures the directory structure exists
        // Ensure the directory exists before writing
        const fileDir = path.dirname(existingFile);
        ensureDirectoryExists(fileDir);
        // Now write the updated data to the existing file
        ensureNotWritingToUpdateTest(existingFile);
        fs.writeFileSync(existingFile, JSON.stringify(extractorResult, null, '\t'));
        return { ...extractorResult, _updated: true, _filePath: existingFile };
      } else {
        // Fallback: write directly if dataset couldn't be opened
        // Ensure the directory exists
        const fileDir = path.dirname(existingFile);
        ensureDirectoryExists(fileDir);
        ensureNotWritingToUpdateTest(existingFile);
        fs.writeFileSync(existingFile, JSON.stringify(extractorResult, null, '\t'));
        return { ...extractorResult, _updated: true, _filePath: existingFile };
      }
    } else {
      // Create new file using Dataset.pushData for proper numbering
      // Then manually rewrite with tab formatting to match original extraction format
      let dataset;
      let filePath;
      
      if (contentType === 'assignments') {
        dataset = await Dataset.open(`${datasetPrefix}/assignments`);
        await dataset.pushData(extractorResult);
        // Get the file path that was just created by reading the directory
        const assignmentsDir = path.join(STORAGE_DIR, extractionFolder, 'datasets', 'courses', courseFolderName, 'assignments');
        const allFiles = fs.readdirSync(assignmentsDir).filter(f => f.endsWith('.json')).sort();
        if (allFiles.length > 0) {
          filePath = path.join(assignmentsDir, allFiles[allFiles.length - 1]);
        }
      } else if (contentType === 'announcements') {
        dataset = await Dataset.open(`${datasetPrefix}/announcements`);
        await dataset.pushData(extractorResult);
        const announcementsDir = path.join(STORAGE_DIR, extractionFolder, 'datasets', 'courses', courseFolderName, 'announcements');
        const allFiles = fs.readdirSync(announcementsDir).filter(f => f.endsWith('.json')).sort();
        if (allFiles.length > 0) {
          filePath = path.join(announcementsDir, allFiles[allFiles.length - 1]);
        }
      } else if (contentType === 'files') {
        dataset = await Dataset.open(`${datasetPrefix}/files`);
        await dataset.pushData(extractorResult);
        const filesDir = path.join(STORAGE_DIR, extractionFolder, 'datasets', 'courses', courseFolderName, 'files');
        const allFiles = fs.readdirSync(filesDir).filter(f => f.endsWith('.json')).sort();
        if (allFiles.length > 0) {
          filePath = path.join(filesDir, allFiles[allFiles.length - 1]);
        }
      } else if (contentType === 'pages') {
        dataset = await Dataset.open(`${datasetPrefix}/pages`);
        await dataset.pushData(extractorResult);
        const pagesDir = path.join(STORAGE_DIR, extractionFolder, 'datasets', 'courses', courseFolderName, 'pages');
        const allFiles = fs.readdirSync(pagesDir).filter(f => f.endsWith('.json')).sort();
        if (allFiles.length > 0) {
          filePath = path.join(pagesDir, allFiles[allFiles.length - 1]);
        }
      }
      
      // Rewrite the file with tab formatting to match original extraction format
      if (filePath && fs.existsSync(filePath)) {
        // Ensure the directory exists before writing
        const fileDir = path.dirname(filePath);
        ensureDirectoryExists(fileDir);
        ensureNotWritingToUpdateTest(filePath);
        fs.writeFileSync(filePath, JSON.stringify(extractorResult, null, '\t'));
      }
      
      return { ...extractorResult, _created: true };
    }
  } catch (error) {
    console.error(`  ❌ Error extracting ${contentType} from ${url}: ${error.message}`);
    throw error;
  }
}

/**
 * Load extraction summary file
 */
function loadExtractionSummary(extractionFolder) {
  const summaryPath = path.join(STORAGE_DIR, extractionFolder, 'extraction-summary.json');
  
  if (!fs.existsSync(summaryPath)) {
    console.warn(`  ⚠️  Extraction summary not found: ${summaryPath}`);
    console.warn(`  💡 Run: node scripts/generate-extraction-summary.js "${extractionFolder}"`);
    return null;
  }
  
  try {
    const summary = JSON.parse(fs.readFileSync(summaryPath, 'utf8'));
    return summary;
  } catch (error) {
    console.error(`  ❌ Failed to load extraction summary: ${error.message}`);
    return null;
  }
}

/**
 * Upload extraction data to Supabase
 */
async function uploadToSupabase(extractionFolder, summary) {
  if (!AUTO_UPLOAD_TO_SUPABASE) {
    console.log('💤 Auto-upload to Supabase is disabled (set AUTO_UPLOAD_TO_SUPABASE=true to enable)\n');
    return { success: false, skipped: true };
  }

  const userEmail = summary?.user?.email;
  if (!userEmail) {
    console.warn('⚠️  Cannot auto-upload to Supabase: No user email found in extraction summary\n');
    return { success: false, error: 'No user email' };
  }

  console.log('☁️  Uploading updated data to Supabase...\n');
  
  try {
    const { exec } = require('child_process');
    const { promisify } = require('util');
    const execAsync = promisify(exec);
    
    // Get the full path to the extraction folder
    const extractionDataPath = path.join(STORAGE_DIR, extractionFolder);
    
    // Try multiple possible paths for the upload script
    // 1. Frontend directory (local development - backend/../frontend)
    // 2. Frontend directory (AWS - backend is in ~/Canvas-Wrapper, frontend is in ~/Canvas-Wrapper/../frontend)
    // 3. From workspace root
    const possiblePaths = [
      path.join(__dirname, '..', '..', 'frontend', 'supabase', 'upload-extraction-data.js'),
      path.join(__dirname, '..', '..', '..', 'frontend', 'supabase', 'upload-extraction-data.js'),
      path.join(process.cwd(), 'frontend', 'supabase', 'upload-extraction-data.js'),
      path.join(process.env.HOME || process.env.USERPROFILE || '', 'Canvas-Wrapper', '..', 'frontend', 'supabase', 'upload-extraction-data.js'),
    ];
    
    let uploadScriptPath = null;
    let frontendDir = null;
    
    for (const possiblePath of possiblePaths) {
      if (fs.existsSync(possiblePath)) {
        uploadScriptPath = possiblePath;
        frontendDir = path.dirname(path.dirname(possiblePath)); // Go up from supabase/ to frontend/
        break;
      }
    }
    
    // If still not found, check if we're on AWS and try to find it
    if (!uploadScriptPath) {
      const isAWS = process.env.AWS_INSTANCE_ID || process.env.HEADLESS === 'true';
      
      if (isAWS) {
        // On AWS, frontend is synced to ~/frontend
        const homeDir = process.env.HOME || '/home/ec2-user';
        const awsPaths = [
          path.join(homeDir, 'frontend', 'supabase', 'upload-extraction-data.js'),
          path.join(homeDir, 'Canvas-Wrapper', '..', 'frontend', 'supabase', 'upload-extraction-data.js'),
        ];
        
        for (const awsPath of awsPaths) {
          if (fs.existsSync(awsPath)) {
            uploadScriptPath = awsPath;
            frontendDir = path.dirname(path.dirname(awsPath));
            break;
          }
        }
      }
    }
    
    // Use npm run supabase:upload-data instead of running the script directly
    // This ensures proper environment setup and uses the npm script
    // Find the frontend directory (where package.json with the script is located)
    if (!frontendDir) {
      // Try to find frontend directory from upload script path or other locations
      const possibleFrontendDirs = [
        path.join(__dirname, '..', '..', 'frontend'),
        path.join(process.cwd(), 'frontend'),
        path.join(process.env.HOME || process.env.USERPROFILE || '', 'frontend'),
      ];
      
      for (const dir of possibleFrontendDirs) {
        const packageJsonPath = path.join(dir, 'package.json');
        if (fs.existsSync(packageJsonPath)) {
          frontendDir = dir;
          break;
        }
      }
    }
    
    if (!frontendDir || !fs.existsSync(path.join(frontendDir, 'package.json'))) {
      const isAWS = process.env.AWS_INSTANCE_ID || process.env.HEADLESS === 'true';
      
      if (isAWS) {
        console.warn('⚠️  Running on AWS instance - frontend directory not found');
        console.warn('   Make sure frontend directory was synced to AWS');
        console.warn('   Data has been updated on AWS. To upload to Supabase:');
        console.warn(`   1. Ensure frontend directory is synced to AWS`);
        console.warn(`   2. Ensure .env with Supabase credentials is on AWS`);
        console.warn(`   Or download data and run locally: npm run supabase:upload-data ${userEmail} "${extractionDataPath}"\n`);
        return { success: false, error: 'Frontend directory not found on AWS', needsLocalUpload: true };
      }
      
      console.warn(`⚠️  Frontend directory not found (needed for npm run supabase:upload-data)`);
      console.warn('   Skipping auto-upload to Supabase\n');
      return { success: false, error: 'Frontend directory not found' };
    }
    
    // Run the upload using npm run supabase:upload-data
    // This ensures proper environment setup and script execution
    const command = `npm run supabase:upload-data "${userEmail}" "${extractionDataPath}"`;
    console.log(`   Running: ${command}\n`);
    console.log(`   Working directory: ${frontendDir}\n`);
    
    try {
      const { stdout, stderr } = await execAsync(command, {
        cwd: frontendDir,
        maxBuffer: 10 * 1024 * 1024, // 10MB buffer
        env: { ...process.env }
      });
      
      if (stdout) {
        console.log(stdout);
      }
      if (stderr) {
        // stderr might contain warnings, check if it's actually an error
        const stderrLower = stderr.toLowerCase();
        if (stderrLower.includes('error') && !stderrLower.includes('warning')) {
          console.error('⚠️  Upload script stderr:', stderr);
        } else if (stderr.trim()) {
          console.log('ℹ️  Upload script info:', stderr);
        }
      }
      
      console.log('✅ Successfully uploaded data to Supabase\n');
      return { success: true };
    } catch (execError) {
      // execAsync throws an error if the command fails
      console.error(`❌ Upload script failed: ${execError.message}\n`);
      if (execError.stdout) {
        console.log('stdout:', execError.stdout);
      }
      if (execError.stderr) {
        console.error('stderr:', execError.stderr);
      }
      if (execError.code !== undefined) {
        console.error(`Exit code: ${execError.code}`);
      }
      return { success: false, error: execError.message };
    }
  } catch (error) {
    console.error(`❌ Failed to upload to Supabase: ${error.message}\n`);
    if (error.stdout) {
      console.log('stdout:', error.stdout);
    }
    if (error.stderr) {
      console.error('stderr:', error.stderr);
    }
    if (error.code !== undefined) {
      console.error(`Exit code: ${error.code}`);
    }
    return { success: false, error: error.message };
  }
}

/**
 * Get stored extracted data for a course from summary file
 */
function getStoredExtractedDataFromSummary(summary, courseId) {
  if (!summary || !summary.courses) {
    if (process.env.DEBUG_UPDATE === 'true') {
      console.log(`    ⚠️  Summary or courses not found`);
    }
    return {
      assignments: {},
      announcements: {},
      files: {},
      modules: {},
      pages: {},
      quizzes: {}
    };
  }
  
  const normalizedCourseId = String(courseId).trim();
  const courseData = summary.courses[normalizedCourseId];
  
  if (!courseData) {
    if (process.env.DEBUG_UPDATE === 'true') {
      console.log(`    ⚠️  Course ${normalizedCourseId} not found in summary. Available courses: ${Object.keys(summary.courses).join(', ')}`);
    }
    return {
      assignments: {},
      announcements: {},
      files: {},
      modules: {},
      pages: {},
      quizzes: {}
    };
  }
  
  const result = {
    assignments: courseData.assignments || {},
    announcements: courseData.announcements || {},
    files: courseData.files || {},
    modules: courseData.modules || {},
    pages: courseData.pages || {},
    quizzes: courseData.quizzes || {} // Include quizzes for cross-type lookups
  };
  
  // If quizzes aren't in summary, try to load them directly from the extraction folder
  if (!courseData.quizzes) {
    const extractionFolder = summary.extractionFolder;
    if (extractionFolder) {
      const courseFolderName = courseData.courseFolderName;
      const quizzesDir = path.join(STORAGE_DIR, extractionFolder, 'datasets', 'courses', courseFolderName, 'quizzes');
      if (fs.existsSync(quizzesDir)) {
        const quizFiles = fs.readdirSync(quizzesDir).filter(f => f.endsWith('.json'));
        quizFiles.forEach(file => {
          try {
            const quizData = JSON.parse(fs.readFileSync(path.join(quizzesDir, file), 'utf8'));
            const quizId = String(quizData.quizId || '').trim();
            if (quizId) {
              result.quizzes[quizId] = {
                id: quizId,
                quizId: quizId,
                title: quizData.title || '',
                url: quizData.url || '',
                courseId: normalizedCourseId,
                dueDate: quizData.metadata?.dueDate || null,
                modifiedDate: null,
                points: quizData.metadata?.points || null
              };
            }
          } catch (e) {
            // Ignore errors loading individual quiz files
          }
        });
      }
    }
  }
  
  if (process.env.DEBUG_UPDATE === 'true') {
    console.log(`    ✓ Found course ${normalizedCourseId} in summary`);
    console.log(`    📊 Summary data counts:`, {
      assignments: Object.keys(result.assignments).length,
      announcements: Object.keys(result.announcements).length,
      files: Object.keys(result.files).length,
      modules: Object.keys(result.modules).length,
      pages: Object.keys(result.pages).length,
      quizzes: Object.keys(result.quizzes).length
    });
  }
  
  return result;
}

/**
 * Check a single course for updates (surface-level) and optionally trigger deep extraction.
 */
async function checkCourseForUpdates(browser, courseId, extractionFolder, summary, mappingData) {
  const context = await browser.newContext();
  const page = await context.newPage();

  try {
    const cookies = loadCookies();
    const cookiesWithDomain = cookies.map(cookie => ({
      ...cookie,
      domain: cookie.domain || new URL(CANVAS_URL).hostname
    }));
    await context.addCookies(cookiesWithDomain);

    const normalizedCourseId = String(courseId).trim();
    let courseName = getCourseNameFromStoredData(courseId, extractionFolder);

    const summaryCourseData = summary?.courses?.[normalizedCourseId];
    // No longer using mapping data - rely solely on extraction summary
    const mappingCourseData = null;
    if (!courseName && summaryCourseData?.courseFolderName) {
      courseName = summaryCourseData.courseFolderName;
    }

    if (!courseName) {
      console.log(`  📖 Course name not found in stored data, fetching from Canvas...`);
      courseName = await getCourseNameFromCanvas(page, courseId);
    }

    const fallbackCourseName = courseName || `course-${courseId}`;
    console.log(`  📚 Course: "${fallbackCourseName}" (${courseId})`);

    const storedExtractedData = summary
      ? getStoredExtractedDataFromSummary(summary, courseId)
      : {
          assignments: {},
          announcements: {},
          files: {},
          modules: {},
          pages: {}
        };

    const quickData = {
      announcements: await quickCheckAnnouncements(page, courseId),
      assignments: await quickCheckAssignments(page, courseId),
      files: await quickCheckFiles(page, courseId),
      modules: await quickCheckModules(page, courseId),
      pages: await quickCheckPages(page, courseId)
    };

    const surfaceCourseSummary = buildSurfaceCourseSummary(courseId, fallbackCourseName, quickData);
    const baseCourseData = summaryCourseData || {
      courseFolderName: fallbackCourseName,
      courseId: normalizedCourseId,
      assignments: storedExtractedData.assignments,
      announcements: storedExtractedData.announcements,
      files: storedExtractedData.files,
      modules: storedExtractedData.modules,
      pages: storedExtractedData.pages,
      quizzes: storedExtractedData.quizzes
    };
    const baselineCourseData = buildBaselineCourseData(courseId, fallbackCourseName, baseCourseData, mappingCourseData);
    
    // Get failed requests for this course to filter them out
    const failedRequests = summary?.failedRequests || {};
    const courseFailedRequests = failedRequests[normalizedCourseId] || {};

    const diff = diffCourseData(baselineCourseData, surfaceCourseSummary, { [normalizedCourseId]: courseFailedRequests });

    const updates = {
      courseId,
      courseName: surfaceCourseSummary.courseFolderName,
      announcements: diff.announcements,
      assignments: diff.assignments,
      files: diff.files,
      modules: diff.modules,
      pages: diff.pages
    };

    const hasActionableChanges = Object.values(diff).some(section => section.hasUpdates);

    if (hasActionableChanges) {
      console.log(`  ⚠️  Discrepancies detected for course ${courseId}`);
      // Skip deep extraction here - it will be done in applyChangesToExtractionFolder
      // to ensure all changes (including deletions) are applied together
      console.log('  📋 Changes will be applied after all courses are checked.');
    } else {
      console.log('  ✅ No discrepancies detected.');
    }

    return { updates, surfaceCourseSummary };
  } finally {
    await context.close();
  }
}

/**
 * Delete removed items from extraction folder
 */
function deleteRemovedItems(courseFolderName, contentType, removedItems, extractionFolder) {
  if (!removedItems || removedItems.length === 0) return 0;
  
  let deletedCount = 0;
  for (const item of removedItems) {
    const itemId = item.id || item.slug || item.pageSlug || item.fileId;
    if (!itemId) continue;
    
    const filePath = findExistingItemFile(courseFolderName, contentType, itemId, extractionFolder);
    if (filePath && fs.existsSync(filePath)) {
      try {
        fs.unlinkSync(filePath);
        deletedCount++;
        if (process.env.DEBUG_UPDATE === 'true') {
          console.log(`      🗑️  Deleted ${contentType}: ${item.title || item.name || itemId}`);
        }
      } catch (error) {
        console.error(`      ⚠️  Failed to delete ${contentType} ${itemId}: ${error.message}`);
      }
    }
  }
  return deletedCount;
}

/**
 * Save update log to updates folder
 */
function saveUpdateLog(diffReport, extractionFolder, changesApplied) {
  const updatesDir = path.join(STORAGE_DIR, extractionFolder, 'updates');
  ensureDirectoryExists(updatesDir);
  
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const updateLogFile = path.join(updatesDir, `update-${timestamp}.json`);
  
  const updateLog = {
    timestamp: new Date().toISOString(),
    extractionFolder: extractionFolder,
    runId: diffReport.runId,
    totalCoursesScanned: diffReport.totalCoursesScanned,
    coursesWithUpdates: diffReport.coursesWithUpdates,
    changesApplied: changesApplied,
    dryRun: diffReport.dryRun,
    courses: diffReport.courses.map(course => ({
      courseId: course.courseId,
      courseName: course.courseName,
      changes: {
        announcements: {
          new: course.announcements.newItems?.length || 0,
          changed: course.announcements.changedItems?.length || 0,
          removed: course.announcements.removedItems?.length || 0,
          items: {
            new: course.announcements.newItems?.map(item => ({
              id: item.id,
              title: item.title,
              url: item.url
            })) || [],
            changed: course.announcements.changedItems?.map(item => ({
              id: item.id,
              title: item.title,
              url: item.url,
              fieldChanges: item.fieldChanges
            })) || [],
            removed: course.announcements.removedItems?.map(item => ({
              id: item.id,
              title: item.title,
              url: item.url
            })) || []
          }
        },
        assignments: {
          new: course.assignments.newItems?.length || 0,
          changed: course.assignments.changedItems?.length || 0,
          removed: course.assignments.removedItems?.length || 0,
          items: {
            new: course.assignments.newItems?.map(item => ({
              id: item.id,
              title: item.title,
              url: item.url,
              dueDate: item.dueDate
            })) || [],
            changed: course.assignments.changedItems?.map(item => ({
              id: item.id,
              title: item.title,
              url: item.url,
              fieldChanges: item.fieldChanges
            })) || [],
            removed: course.assignments.removedItems?.map(item => ({
              id: item.id,
              title: item.title,
              url: item.url
            })) || []
          }
        },
        files: {
          new: course.files.newItems?.length || 0,
          changed: course.files.changedItems?.length || 0,
          removed: course.files.removedItems?.length || 0,
          items: {
            new: course.files.newItems?.map(item => ({
              id: item.id,
              name: item.name || item.title,
              url: item.url
            })) || [],
            changed: course.files.changedItems?.map(item => ({
              id: item.id,
              name: item.name || item.title,
              url: item.url,
              fieldChanges: item.fieldChanges
            })) || [],
            removed: course.files.removedItems?.map(item => ({
              id: item.id,
              name: item.name || item.title,
              url: item.url
            })) || []
          }
        },
        modules: {
          new: course.modules.newItems?.length || 0,
          changed: course.modules.changedItems?.length || 0,
          removed: course.modules.removedItems?.length || 0,
          items: {
            new: course.modules.newItems?.map(item => ({
              id: item.id,
              title: item.title,
              url: item.url
            })) || [],
            changed: course.modules.changedItems?.map(item => ({
              id: item.id,
              title: item.title,
              url: item.url,
              fieldChanges: item.fieldChanges
            })) || [],
            removed: course.modules.removedItems?.map(item => ({
              id: item.id,
              title: item.title,
              url: item.url
            })) || []
          }
        },
        pages: {
          new: course.pages.newItems?.length || 0,
          changed: course.pages.changedItems?.length || 0,
          removed: course.pages.removedItems?.length || 0,
          items: {
            new: course.pages.newItems?.map(item => ({
              id: item.slug || item.id,
              title: item.title,
              url: item.url
            })) || [],
            changed: course.pages.changedItems?.map(item => ({
              id: item.slug || item.id,
              title: item.title,
              url: item.url,
              fieldChanges: item.fieldChanges
            })) || [],
            removed: course.pages.removedItems?.map(item => ({
              id: item.slug || item.id,
              title: item.title,
              url: item.url
            })) || []
          }
        }
      }
    }))
  };
  
  fs.writeFileSync(updateLogFile, JSON.stringify(updateLog, null, 2));
  console.log(`📝 Update log saved to: ${updateLogFile}\n`);
  
  return updateLogFile;
}

/**
 * Apply changes from diff report to extraction folder
 * This function processes the diff report and applies all changes:
 * - Deletes removed items
 * - Updates changed items (via deep extraction)
 * - Adds new items (via deep extraction)
 * - Regenerates extraction-summary.json
 */
async function applyChangesToExtractionFolder(diffReport, browser, extractionFolder) {
  if (!diffReport || !diffReport.courses || diffReport.courses.length === 0) {
    console.log('📝 No changes to apply to extraction folder.\n');
    return { success: true, changesApplied: 0 };
  }

  console.log('\n📝 Applying changes to extraction folder...');
  console.log(`   Extraction folder: ${extractionFolder}\n`);
  
  ensureNotWritingToUpdateTest(path.join(STORAGE_DIR, extractionFolder));
  
  let totalChangesApplied = 0;
  const contentTypes = ['announcements', 'assignments', 'files', 'modules', 'pages'];
  
  // Create a page for deep extraction
  const context = await browser.newContext();
  const page = await context.newPage();
  
  try {
    // Load cookies
    const cookies = loadCookies();
    await context.addCookies(cookies.map(c => ({
      ...c,
      domain: c.domain || new URL(CANVAS_URL).hostname
    })));
    
    for (const courseUpdate of diffReport.courses) {
      const { courseId, courseName } = courseUpdate;
      console.log(`  📚 Course ${courseId}: ${courseName || courseId}`);
      
      // Get course folder name
      const coursesDir = path.join(STORAGE_DIR, extractionFolder, 'datasets', 'courses');
      let courseFolderName = courseId;
      
      if (fs.existsSync(coursesDir)) {
        const courseDirs = fs.readdirSync(coursesDir, { withFileTypes: true })
          .filter(dirent => dirent.isDirectory())
          .map(dirent => dirent.name);
        
        // Try to find course folder by checking courseId in files
        for (const dir of courseDirs) {
          const assignmentsDir = path.join(coursesDir, dir, 'assignments');
          if (fs.existsSync(assignmentsDir)) {
            const files = fs.readdirSync(assignmentsDir).filter(f => f.endsWith('.json'));
            if (files.length > 0) {
              try {
                const firstFile = JSON.parse(fs.readFileSync(path.join(assignmentsDir, files[0]), 'utf8'));
                if (firstFile.courseId === courseId) {
                  courseFolderName = dir;
                  break;
                }
              } catch (e) {
                // Continue searching
              }
            }
          }
        }
      }
      
      let courseChangesApplied = 0;
      
      // Process each content type
      for (const contentType of contentTypes) {
        const section = courseUpdate[contentType];
        if (!section || !section.hasUpdates) continue;
        
        // Delete removed items
        if (section.removedItems && section.removedItems.length > 0) {
          const deletedCount = deleteRemovedItems(courseFolderName, contentType, section.removedItems, extractionFolder);
          courseChangesApplied += deletedCount;
          if (deletedCount > 0) {
            console.log(`    🗑️  Deleted ${deletedCount} ${contentType}`);
          }
        }
        
        // Extract new and changed items
        const itemsToExtract = [
          ...(section.newItems || []),
          ...(section.changedItems || [])
        ];
        
        if (itemsToExtract.length > 0) {
          const label = contentType === 'files' ? 'file' :
                       contentType === 'pages' ? 'page' :
                       contentType === 'announcements' ? 'announcement' :
                       contentType === 'assignments' ? 'assignment' :
                       contentType === 'modules' ? 'module' : contentType;
          
          console.log(`    📥 Extracting ${itemsToExtract.length} ${label}${itemsToExtract.length > 1 ? 's' : ''}...`);
          
          for (const item of itemsToExtract) {
            const identifier = item.id || item.slug || item.pageSlug || item.title || item.name || 'unknown';
            
            if (!item.url) {
              console.log(`      ⚠️  Skipping ${label} ${identifier} — missing URL`);
              continue;
            }
            
            try {
              const result = await Promise.race([
                deepExtractItem(page, item.url, contentType, courseId, extractionFolder, item.id || item.slug || item.pageSlug || null),
                new Promise((_, reject) => setTimeout(() => reject(new Error('Extraction timeout (30s)')), 30000))
              ]);
              
              if (result) {
                const action = result._updated ? 'Updated' : 'Extracted';
                console.log(`      ✅ ${action} ${label}: ${item.title || item.name || identifier}`);
                courseChangesApplied++;
              }
            } catch (error) {
              console.error(`      ❌ Failed to extract ${label} ${identifier}: ${error.message}`);
            }
          }
        }
      }
      
      totalChangesApplied += courseChangesApplied;
      if (courseChangesApplied > 0) {
        console.log(`    ✅ Applied ${courseChangesApplied} change(s) to course ${courseId}\n`);
      } else {
        console.log(`    ℹ️  No changes to apply for course ${courseId}\n`);
      }
    }
    
    // Regenerate extraction-summary.json after all changes
    console.log('📊 Regenerating extraction-summary.json...');
    try {
      const { spawn } = require('child_process');
      const summaryScript = path.join(__dirname, 'generate-extraction-summary.js');
      
      await new Promise((resolve, reject) => {
        const child = spawn('node', [summaryScript, extractionFolder], {
          cwd: path.join(__dirname, '..'),
          stdio: 'inherit'
        });
        
        child.on('close', (code) => {
          if (code === 0) {
            console.log('   ✅ Extraction summary regenerated successfully\n');
            resolve();
          } else {
            console.error(`   ⚠️  Extraction summary regeneration exited with code ${code}`);
            reject(new Error(`Summary generation failed with code ${code}`));
          }
        });
        
        child.on('error', (error) => {
          console.error(`   ❌ Failed to regenerate extraction summary: ${error.message}`);
          reject(error);
        });
      });
    } catch (error) {
      console.error(`   ⚠️  Could not regenerate extraction summary: ${error.message}`);
      console.error(`   💡 You can manually run: node scripts/generate-extraction-summary.js "${extractionFolder}"`);
    }
    
    console.log(`✅ Applied ${totalChangesApplied} total change(s) to extraction folder\n`);
    
    // Save update log
    const updateLogPath = saveUpdateLog(diffReport, extractionFolder, totalChangesApplied);
    
    return { success: true, changesApplied: totalChangesApplied, updateLogPath };
    
  } finally {
    await context.close();
  }
}

/**
 * Main function
 */
async function main() {
  const startTime = Date.now();
  let browser = null;
  
  console.log('🔍 Canvas Update Checker');
  console.log('========================\n');
  
  try {
    // Load latest extraction folder
    console.log('📂 Loading latest extraction folder...');
    const extractionFolder = getLatestExtractionFolder();
    console.log(`   ✅ Found: ${extractionFolder}\n`);
    
    // Load extraction summary (single file with all extracted items)
    console.log('📊 Loading extraction summary...');
    const summary = loadExtractionSummary(extractionFolder);
    if (!summary) {
      console.error(`❌ Extraction summary not found. Please run: node scripts/generate-extraction-summary.js "${extractionFolder}"`);
      return;
    }
    console.log(`   ✅ Loaded summary with ${Object.keys(summary.courses || {}).length} courses\n`);
    const updateTestTimestampBefore = getDirectoryTimestamp(UPDATE_TEST_DATASET_DIR);
    
    // Use extraction summary as primary source (more accurate than mapping data)
    // Mapping data may be incomplete or missing, but extraction summary contains
    // all successfully extracted items which is what we want to compare against
    console.log('📚 Using extraction summary as baseline (more accurate than mapping data)...');
    let courseIds = Object.keys(summary.courses || {});
    
    // Initialize empty mapping structure for each course (for compatibility)
    // We'll rely on extraction summary data instead of mapping data
    const mappingData = {};
    courseIds.forEach(courseId => {
      mappingData[courseId] = {
        assignments: [],
        announcements: [],
        files: [],
        modules: [],
        pages: [],
        quizzes: []
      };
    });
    
    console.log(`   ✅ Found ${courseIds.length} courses from extraction summary\n`);

    if (UPDATE_COURSE_IDS && UPDATE_COURSE_IDS.length > 0) {
      courseIds = courseIds.filter(id => UPDATE_COURSE_IDS.includes(id));
      console.log(`   🎯 Filtered to ${courseIds.length} course(s) via UPDATE_COURSE_IDS\n`);
    }

    if (UPDATE_MAX_COURSES && UPDATE_MAX_COURSES > 0 && courseIds.length > UPDATE_MAX_COURSES) {
      courseIds = courseIds.slice(0, UPDATE_MAX_COURSES);
      console.log(`   ⏱️ Limiting scan to ${courseIds.length} course(s) (UPDATE_MAX_COURSES)\n`);
    }
    
    if (courseIds.length === 0) {
      console.log('⚠️  No courses found. Run a full extraction first.');
      return;
    }
    
    // Load cookies
    console.log('🍪 Loading cookies...');
    loadCookies(); // Validate cookies exist
    console.log('   ✅ Cookies loaded\n');
    
    // Launch browser
    console.log('🌐 Launching browser...');
    browser = await chromium.launch({ headless: true });
    console.log('   ✅ Browser launched\n');
    
    try {
      // Check courses in parallel batches
    console.log(`🔍 Checking ${courseIds.length} courses for updates...\n`);
    const surfaceSummary = {
      extractionFolder: `update-run-${UPDATE_RUN_ID}`,
      baselineExtractionFolder: extractionFolder,
      generatedAt: new Date().toISOString(),
      dryRun: UPDATE_DRY_RUN,
      courses: {}
    };
    const allUpdates = [];
    ensureDirectoryExists(UPDATE_RESULTS_DIR);
    
    for (let i = 0; i < courseIds.length; i += MAX_CONCURRENT_CHECKS) {
      const batch = courseIds.slice(i, i + MAX_CONCURRENT_CHECKS);
      const batchPromises = batch.map(courseId => 
        Promise.race([
          checkCourseForUpdates(browser, courseId, extractionFolder, summary, mappingData),
          new Promise((_, reject) => 
            setTimeout(() => reject(new Error(`Course ${courseId} check timeout (2 minutes)`)), 120000)
          )
        ]).catch(error => {
          console.error(`  ❌ Error checking course ${courseId}: ${error.message}`);
          return {
            updates: createEmptyCourseUpdate(courseId),
            surfaceCourseSummary: buildSurfaceCourseSummary(courseId, `course-${courseId}`, createEmptyQuickData())
          };
        })
      );
      const batchResults = await Promise.all(batchPromises);
      batchResults.forEach(result => {
        allUpdates.push(result.updates);
        surfaceSummary.courses[result.updates.courseId] = result.surfaceCourseSummary;
      });
      
      // Progress indicator
      const processed = Math.min(i + MAX_CONCURRENT_CHECKS, courseIds.length);
      console.log(`   ✅ Checked ${processed}/${courseIds.length} courses...\n`);
    }
    
    const summaryPath = path.join(UPDATE_RESULTS_DIR, SURFACE_SUMMARY_FILENAME);
    fs.writeFileSync(summaryPath, JSON.stringify(surfaceSummary, null, 2));
    console.log(`\n📝 Surface summary saved to: ${summaryPath}\n`);

    const coursesWithUpdates = allUpdates.filter(courseHasUpdates);
    const diffReport = {
      runId: UPDATE_RUN_ID,
      generatedAt: new Date().toISOString(),
      dryRun: UPDATE_DRY_RUN,
      baselineExtractionFolder: extractionFolder,
      surfaceSummaryFile: summaryPath,
      totalCoursesScanned: courseIds.length,
      coursesWithUpdates: coursesWithUpdates.length,
      courses: coursesWithUpdates
    };
    const diffPath = path.join(UPDATE_RESULTS_DIR, DIFF_REPORT_FILENAME);
    fs.writeFileSync(diffPath, JSON.stringify(diffReport, null, 2));
    console.log(`📄 Discrepancy report saved to: ${diffPath}\n`);
    
    // Apply changes to extraction folder if not in dry-run mode
    if (!UPDATE_DRY_RUN && coursesWithUpdates.length > 0) {
      console.log('🔄 Applying changes to extraction folder...\n');
      try {
        const applyResult = await applyChangesToExtractionFolder(diffReport, browser, extractionFolder);
        
        if (applyResult.success) {
          console.log(`✅ Successfully applied ${applyResult.changesApplied} change(s) to extraction folder\n`);
          if (applyResult.updateLogPath) {
            console.log(`📝 Update log saved to: ${applyResult.updateLogPath}\n`);
          }
          
          // Reload summary to get updated data
          const updatedSummary = loadExtractionSummary(extractionFolder);
          
          // Auto-upload to Supabase if enabled
          if (updatedSummary) {
            await uploadToSupabase(extractionFolder, updatedSummary);
          }
        } else {
          console.error('⚠️  Some changes may not have been applied. Check the logs above.\n');
        }
      } catch (error) {
        console.error(`❌ Failed to apply changes: ${error.message}\n`);
        if (error.stack) {
          console.error(error.stack);
        }
      }
    } else if (UPDATE_DRY_RUN && coursesWithUpdates.length > 0) {
      console.log('💤 Dry-run mode: Changes detected but not applied to extraction folder.\n');
      console.log(`   To apply changes, run with: UPDATE_DRY_RUN=false node scripts/update.js\n`);
      // Save update log even in dry-run mode (for reference)
      saveUpdateLog(diffReport, extractionFolder, 0);
    } else if (coursesWithUpdates.length > 0) {
      // Save update log even if no changes were applied
      saveUpdateLog(diffReport, extractionFolder, 0);
    } else if (!UPDATE_DRY_RUN && coursesWithUpdates.length === 0) {
      // Even if no updates were found, ensure Supabase is synced with latest data
      // This handles cases where the extraction folder was updated manually
      console.log('📊 No updates found, but ensuring Supabase is synced with latest data...\n');
      const summary = loadExtractionSummary(extractionFolder);
      if (summary) {
        await uploadToSupabase(extractionFolder, summary);
      }
    }
    
    // Report results
    console.log('\n📊 Update Summary');
    console.log('=================\n');
    
    if (coursesWithUpdates.length === 0) {
      console.log('✅ No updates found. All courses are up to date!\n');
    } else {
      console.log(`⚠️  Found updates in ${coursesWithUpdates.length} course(s):\n`);
      
      for (const update of coursesWithUpdates) {
        console.log(`📖 Course ${update.courseId}`);
        
        if (update.announcements.hasUpdates) {
          const newCount = update.announcements.newItems.length;
          const changedCount = update.announcements.changedItems.length;
          const removedCount = update.announcements.removedItems.length;
          console.log(`   📢 Announcements: +${newCount} new, ~${changedCount} changed, -${removedCount} removed`);
          if (update.announcements.newItems.length > 0) {
            console.log(`      New:`);
            update.announcements.newItems.slice(0, 3).forEach(item => {
              console.log(`        • ${item.title || item.id}`);
            });
            if (update.announcements.newItems.length > 3) {
              console.log(`        ... and ${update.announcements.newItems.length - 3} more`);
            }
          }
          if (update.announcements.changedItems.length > 0) {
            console.log(`      Changed:`);
            update.announcements.changedItems.slice(0, 3).forEach(item => {
              console.log(`        • ${item.title || item.id}`);
            });
            if (update.announcements.changedItems.length > 3) {
              console.log(`        ... and ${update.announcements.changedItems.length - 3} more`);
            }
          }
        }
        
        if (update.assignments.hasUpdates) {
          const newCount = update.assignments.newItems.length;
          const changedCount = update.assignments.changedItems.length;
          const removedCount = update.assignments.removedItems.length;
          console.log(`   📝 Assignments: +${newCount} new, ~${changedCount} changed, -${removedCount} removed`);
          if (update.assignments.newItems.length > 0) {
            console.log(`      New:`);
            update.assignments.newItems.slice(0, 3).forEach(item => {
              console.log(`        • ${item.title || item.id}`);
            });
            if (update.assignments.newItems.length > 3) {
              console.log(`        ... and ${update.assignments.newItems.length - 3} more`);
            }
          }
          if (update.assignments.changedItems.length > 0) {
            console.log(`      Changed:`);
            update.assignments.changedItems.slice(0, 3).forEach(item => {
              console.log(`        • ${item.title || item.id}`);
            });
            if (update.assignments.changedItems.length > 3) {
              console.log(`        ... and ${update.assignments.changedItems.length - 3} more`);
            }
          }
        }
        
        if (update.files.hasUpdates) {
          const newCount = update.files.newItems.length;
          const changedCount = update.files.changedItems.length;
          const removedCount = update.files.removedItems.length;
          console.log(`   📁 Files: +${newCount} new, ~${changedCount} changed, -${removedCount} removed`);
          if (update.files.newItems.length > 0) {
            console.log(`      New:`);
            update.files.newItems.slice(0, 3).forEach(item => {
              console.log(`        • ${item.name || item.url}`);
            });
            if (update.files.newItems.length > 3) {
              console.log(`        ... and ${update.files.newItems.length - 3} more`);
            }
          }
          if (update.files.changedItems.length > 0) {
            console.log(`      Changed:`);
            update.files.changedItems.slice(0, 3).forEach(item => {
              console.log(`        • ${item.name || item.url}`);
            });
            if (update.files.changedItems.length > 3) {
              console.log(`        ... and ${update.files.changedItems.length - 3} more`);
            }
          }
        }
        
        if (update.modules.hasUpdates) {
          const newCount = update.modules.newItems.length;
          const changedCount = update.modules.changedItems.length;
          const removedCount = update.modules.removedItems.length;
          console.log(`   📦 Modules: +${newCount} new, ~${changedCount} changed, -${removedCount} removed`);
          if (update.modules.newItems.length > 0) {
            console.log(`      New:`);
            update.modules.newItems.slice(0, 3).forEach(item => {
              console.log(`        • ${item.title || item.id}`);
            });
            if (update.modules.newItems.length > 3) {
              console.log(`        ... and ${update.modules.newItems.length - 3} more`);
            }
          }
          if (update.modules.changedItems.length > 0) {
            console.log(`      Changed:`);
            update.modules.changedItems.slice(0, 3).forEach(item => {
              console.log(`        • ${item.title || item.id}`);
            });
            if (update.modules.changedItems.length > 3) {
              console.log(`        ... and ${update.modules.changedItems.length - 3} more`);
            }
          }
        }
        
        if (update.pages.hasUpdates) {
          const newCount = update.pages.newItems.length;
          const changedCount = update.pages.changedItems.length;
          const removedCount = update.pages.removedItems.length;
          console.log(`   📄 Pages: +${newCount} new, ~${changedCount} changed, -${removedCount} removed`);
          if (update.pages.newItems.length > 0) {
            console.log(`      New:`);
            update.pages.newItems.slice(0, 3).forEach(item => {
              console.log(`        • ${item.title || item.slug}`);
            });
            if (update.pages.newItems.length > 3) {
              console.log(`        ... and ${update.pages.newItems.length - 3} more`);
            }
          }
          if (update.pages.changedItems.length > 0) {
            console.log(`      Changed:`);
            update.pages.changedItems.slice(0, 3).forEach(item => {
              console.log(`        • ${item.title || item.slug}`);
            });
            if (update.pages.changedItems.length > 3) {
              console.log(`        ... and ${update.pages.changedItems.length - 3} more`);
            }
          }
        }
        
        console.log('');
      }
    }
    
    const updateTestTimestampAfter = getDirectoryTimestamp(UPDATE_TEST_DATASET_DIR);
    if (updateTestTimestampBefore !== null && updateTestTimestampAfter !== null) {
      if (updateTestTimestampAfter !== updateTestTimestampBefore) {
        console.warn('⚠️  storage/datasets/update test timestamp changed during the run. Verify no writes occurred.');
      } else {
        console.log('🛡️  storage/datasets/update test remained untouched.');
      }
    }

    const duration = ((Date.now() - startTime) / 1000).toFixed(2);
    console.log(`\n⏱️  Completed in ${duration} seconds\n`);
    
    } finally {
      // Ensure browser is always closed
      if (browser) {
        await browser.close().catch(err => {
          console.error(`⚠️  Error closing browser: ${err.message}`);
        });
      }
    }
    
    // Exit successfully
    process.exit(0);
    
  } catch (error) {
    console.error(`\n❌ Error: ${error.message}`);
    if (error.stack) {
      console.error(error.stack);
    }
    // Ensure browser is closed even on error
    if (browser) {
      await browser.close().catch(err => {
        console.error(`⚠️  Error closing browser: ${err.message}`);
      });
    }
    process.exit(1);
  }
}

// Run if called directly
if (require.main === module) {
  main().catch(error => {
    console.error('Fatal error:', error);
    process.exit(1);
  });
}

module.exports = { main };

