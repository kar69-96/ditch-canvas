#!/usr/bin/env node
/**
 * Generate a single summary JSON file from an extraction folder
 * This file contains all extracted items indexed by courseId and content type
 */

const path = require('path');
const fs = require('fs');

const STORAGE_DIR = path.join(__dirname, '..', 'storage', 'datasets');
const EXTRACTION_FOLDER = process.argv[2] || process.env.EXTRACTION_FOLDER;

if (!EXTRACTION_FOLDER) {
  console.error('Usage: node scripts/generate-extraction-summary.js <extraction-folder>');
  console.error('   or: EXTRACTION_FOLDER=<folder> node scripts/generate-extraction-summary.js');
  process.exit(1);
}

const extractionPath = path.join(STORAGE_DIR, EXTRACTION_FOLDER);
if (!fs.existsSync(extractionPath)) {
  console.error(`Error: Extraction folder not found: ${extractionPath}`);
  process.exit(1);
}

const coursesDir = path.join(extractionPath, 'datasets', 'courses');
if (!fs.existsSync(coursesDir)) {
  console.error(`Error: Courses directory not found: ${coursesDir}`);
  process.exit(1);
}

console.log(`📊 Generating extraction summary for: ${EXTRACTION_FOLDER}`);
console.log(`   Courses directory: ${coursesDir}\n`);

const summary = {
  extractionFolder: EXTRACTION_FOLDER,
  generatedAt: new Date().toISOString(),
  courses: {}
};

// Get all course folders
const courseDirs = fs.readdirSync(coursesDir, { withFileTypes: true })
  .filter(dirent => dirent.isDirectory())
  .map(dirent => dirent.name);

console.log(`Found ${courseDirs.length} course(s)\n`);

for (const courseDirName of courseDirs) {
  const coursePath = path.join(coursesDir, courseDirName);
  const courseData = {
    courseFolderName: courseDirName,
    courseId: null,
    assignments: {},
    announcements: {},
    files: {},
    modules: {},
    pages: {},
    quizzes: {}
  };
  
  // Load each content type
  ['assignments', 'announcements', 'files', 'modules', 'pages'].forEach(contentType => {
    const typeDir = path.join(coursePath, contentType);
    if (fs.existsSync(typeDir)) {
      const files = fs.readdirSync(typeDir).filter(f => f.endsWith('.json'));
      
      files.forEach(file => {
        try {
          const data = JSON.parse(fs.readFileSync(path.join(typeDir, file), 'utf8'));
          
          // Get courseId from first file
          if (!courseData.courseId && data.courseId) {
            courseData.courseId = String(data.courseId).trim();
          }
          
          // Index by ID
          let id = null;
          if (contentType === 'assignments') {
            id = String(data.assignmentId || '').trim();
          } else if (contentType === 'announcements') {
            id = String(data.announcementId || '').trim();
          } else if (contentType === 'modules') {
            // Modules can be stored in different formats:
            // 1. data.modules array (from module extractor)
            // 2. data.moduleFiles array (from module items extraction)
            const processedModuleIds = new Set();
            
            // Handle data.modules array
            if (data.modules && Array.isArray(data.modules)) {
              data.modules.forEach(module => {
                let moduleId = String(module.moduleId || module.id || '').trim();
                if (moduleId.startsWith('context_module_')) {
                  moduleId = moduleId.replace('context_module_', '');
                }
                if (moduleId && !processedModuleIds.has(moduleId)) {
                  processedModuleIds.add(moduleId);
                  courseData.modules[moduleId] = {
                    id: moduleId,
                    moduleId: moduleId,
                    title: module.title || module.name || '',
                    url: module.url || '',
                    courseId: data.courseId || courseData.courseId,
                    itemCount: module.items ? module.items.length : (module.itemCount || null),
                    unlockDate: module.unlockDate || module.unlockAt || null
                  };
                }
              });
            }
            
            // Handle data.moduleFiles array (extract unique moduleIds)
            if (data.moduleFiles && Array.isArray(data.moduleFiles)) {
              data.moduleFiles.forEach(moduleFile => {
                if (moduleFile.moduleId) {
                  const moduleId = String(moduleFile.moduleId).trim();
                  if (moduleId && !processedModuleIds.has(moduleId)) {
                    processedModuleIds.add(moduleId);
                    courseData.modules[moduleId] = {
                      id: moduleId,
                      moduleId: moduleId,
                      title: moduleFile.moduleName || `Module ${moduleId}`,
                      url: data.url || '',
                      courseId: data.courseId || courseData.courseId,
                      itemCount: null, // Not available from moduleFiles
                      unlockDate: null // Not available from moduleFiles
                    };
                  }
                }
              });
            }
            
            // Fallback: single moduleId in data
            if (processedModuleIds.size === 0) {
              let moduleId = String(data.moduleId || data.id || '').trim();
              if (moduleId.startsWith('context_module_')) {
                moduleId = moduleId.replace('context_module_', '');
              }
              if (moduleId) {
                courseData.modules[moduleId] = {
                  id: moduleId,
                  moduleId: moduleId,
                  title: data.title || data.name || `Module ${moduleId}`,
                  url: data.url || '',
                  courseId: data.courseId || courseData.courseId,
                  itemCount: data.items ? data.items.length : (data.itemCount || null),
                  unlockDate: data.unlockDate || data.unlockAt || null
                };
              }
            }
          } else if (contentType === 'pages') {
            id = String(data.pageSlug || '').trim().toLowerCase();
          } else if (contentType === 'files') {
            id = String(data.fileId || '').trim();
          }
          
          if (id && contentType !== 'modules') {
            // Store comprehensive data for comparison (all fields used in createItemHash)
            const itemData = {
              id: id,
              title: data.title || data.name || '',
              url: data.url || '',
              courseId: data.courseId || courseData.courseId
            };
            
            // Add content-type specific fields for change detection
            if (contentType === 'assignments') {
              itemData.dueDate = data.dueDate || null;
              itemData.modifiedDate = data.modifiedDate || data.updatedAt || null;
              itemData.postDate = data.postedAt || data.createdAt || null;
              itemData.points = data.points || data.pointsPossible || null;
            } else if (contentType === 'announcements') {
              itemData.postDate = data.postedAt || data.createdAt || data.postDate || null;
              itemData.modifiedDate = data.modifiedAt || data.updatedAt || data.modifiedDate || null;
            } else if (contentType === 'files') {
              itemData.name = data.name || data.displayName || '';
              itemData.modifiedDate = data.modifiedDate || data.updatedAt || data.lastModified || null;
              itemData.size = data.size || null;
            } else if (contentType === 'pages') {
              itemData.slug = data.pageSlug || id;
              // Pages don't typically have dates in the extracted data
            }
            
            courseData[contentType][id] = itemData;
          }
        } catch (e) {
          console.warn(`  ⚠️  Error reading ${contentType}/${file}: ${e.message}`);
        }
      });
    }
  });
  
  if (courseData.courseId) {
    summary.courses[courseData.courseId] = courseData;
    const counts = {
      assignments: Object.keys(courseData.assignments).length,
      announcements: Object.keys(courseData.announcements).length,
      files: Object.keys(courseData.files).length,
      modules: Object.keys(courseData.modules).length,
      pages: Object.keys(courseData.pages).length
    };
    console.log(`  ✅ ${courseData.courseFolderName} (${courseData.courseId}):`, counts);
  } else {
    console.warn(`  ⚠️  Skipping ${courseDirName} - no courseId found`);
  }

  // Include quizzes (they may hold assignments that were categorized as quizzes)
  const quizzesDir = path.join(coursePath, 'quizzes');
  if (fs.existsSync(quizzesDir)) {
    const quizFiles = fs.readdirSync(quizzesDir).filter(f => f.endsWith('.json'));
    quizFiles.forEach(file => {
      try {
        const data = JSON.parse(fs.readFileSync(path.join(quizzesDir, file), 'utf8'));
        const quizId = String(data.quizId || '').trim();
        if (!quizId) return;

        if (!courseData.courseId && data.courseId) {
          courseData.courseId = String(data.courseId).trim();
        }

        courseData.quizzes[quizId] = {
          id: quizId,
          quizId,
          title: data.title || data.name || '',
          url: data.url || '',
          courseId: data.courseId || courseData.courseId,
          dueDate: data.metadata?.dueDate || null,
          modifiedDate: null,
          points: data.metadata?.points || null
        };
      } catch (error) {
        console.error(`   ⚠️  Failed to read quiz file ${file} for ${courseDirName}: ${error.message}`);
      }
    });
  }
}

// Scan request queues for failed requests
console.log(`\n🔍 Scanning request queues for failed requests...`);
const failedRequests = {};
const requestQueuesDir = path.join(extractionPath, 'request_queues');

if (fs.existsSync(requestQueuesDir)) {
  const queueDirs = fs.readdirSync(requestQueuesDir, { withFileTypes: true })
    .filter(dirent => dirent.isDirectory() && dirent.name.startsWith('extraction-'))
    .map(dirent => dirent.name);

  for (const queueDir of queueDirs) {
    const queuePath = path.join(requestQueuesDir, queueDir);
    const queueFiles = fs.readdirSync(queuePath).filter(f => f.endsWith('.json'));

    for (const queueFile of queueFiles) {
      try {
        const queueData = JSON.parse(fs.readFileSync(path.join(queuePath, queueFile), 'utf8'));
        const jsonData = typeof queueData.json === 'string' ? JSON.parse(queueData.json) : queueData.json;
        
        // Check if request failed (has errorMessages)
        if (jsonData.errorMessages && Array.isArray(jsonData.errorMessages) && jsonData.errorMessages.length > 0) {
          const url = jsonData.url || jsonData.loadedUrl;
          if (!url) continue;

          // Extract course ID and content type from URL
          const courseMatch = url.match(/\/courses\/(\d+)/);
          if (!courseMatch) continue;
          
          const courseId = courseMatch[1];
          const contentType = extractContentTypeFromUrl(url);
          const itemId = extractItemIdFromUrl(url, contentType);

          if (!failedRequests[courseId]) {
            failedRequests[courseId] = {
              assignments: {},
              announcements: {},
              files: {},
              modules: {},
              pages: {},
              quizzes: {}
            };
          }

          if (itemId && contentType && failedRequests[courseId][contentType]) {
            failedRequests[courseId][contentType][itemId] = {
              id: itemId,
              url: url,
              errorMessages: jsonData.errorMessages,
              failedAt: jsonData.handledAt || new Date().toISOString()
            };
          }
        }
      } catch (e) {
        // Ignore errors reading individual queue files
      }
    }
  }
}

// Also check mapping data for items that were discovered but never extracted
// These are items that were in mapping but not in the extraction summary
console.log(`🔍 Checking mapping data for items discovered but not extracted...`);
const mappingDir = path.join(extractionPath, 'datasets', 'mapping');
if (fs.existsSync(mappingDir)) {
  const mappingFiles = fs.readdirSync(mappingDir).filter(f => f.endsWith('.json'));
  
  for (const mappingFile of mappingFiles) {
    try {
      const mappingData = JSON.parse(fs.readFileSync(path.join(mappingDir, mappingFile), 'utf8'));
      const url = mappingData.url;
      if (!url) continue;
      
      const courseMatch = url.match(/\/courses\/(\d+)/);
      if (!courseMatch) continue;
      
      const courseId = courseMatch[1];
      const contentType = extractContentTypeFromUrl(url);
      const itemId = extractItemIdFromUrl(url, contentType);
      
      if (!itemId || !contentType) continue;
      
      // Check if this item is in the extraction summary
      const courseSummary = summary.courses[courseId];
      if (!courseSummary) continue;
      
      const isExtracted = courseSummary[contentType] && courseSummary[contentType][itemId];
      
      // If item was in mapping but not extracted, add it to failed requests
      if (!isExtracted) {
        if (!failedRequests[courseId]) {
          failedRequests[courseId] = {
            assignments: {},
            announcements: {},
            files: {},
            modules: {},
            pages: {},
            quizzes: {}
          };
        }
        
        // Only add if not already in failed requests (from request queues)
        if (failedRequests[courseId][contentType] && !failedRequests[courseId][contentType][itemId]) {
          failedRequests[courseId][contentType][itemId] = {
            id: itemId,
            url: url,
            errorMessages: ['Item was discovered during mapping but never successfully extracted'],
            failedAt: mappingData.discoveredAt || new Date().toISOString(),
            source: 'mapping'
          };
        }
      }
    } catch (e) {
      // Ignore errors reading individual mapping files
    }
  }
}

// Helper function to extract content type from URL
function extractContentTypeFromUrl(url) {
  if (!url) return null;
  if (url.includes('/assignments/')) return 'assignments';
  if (url.includes('/discussion_topics/')) return 'announcements';
  if (url.includes('/files/')) return 'files';
  if (url.includes('/modules/')) return 'modules';
  if (url.includes('/pages/')) return 'pages';
  if (url.includes('/quizzes/')) return 'quizzes';
  return null;
}

// Helper function to extract item ID from URL
function extractItemIdFromUrl(url, contentType) {
  if (!url || !contentType) return null;
  
  try {
    if (contentType === 'assignments') {
      const match = url.match(/\/assignments\/(\d+)/);
      return match ? match[1] : null;
    } else if (contentType === 'announcements') {
      const match = url.match(/\/discussion_topics\/(\d+)/);
      return match ? match[1] : null;
    } else if (contentType === 'files') {
      const match = url.match(/\/files\/(\d+)/);
      return match ? match[1] : null;
    } else if (contentType === 'modules') {
      const match = url.match(/\/modules\/(\d+)/);
      return match ? match[1] : null;
    } else if (contentType === 'pages') {
      const match = url.match(/\/pages\/([^\/\?]+)/);
      return match ? match[1].toLowerCase() : null;
    } else if (contentType === 'quizzes') {
      const match = url.match(/\/quizzes\/(\d+)/);
      return match ? match[1] : null;
    }
  } catch (e) {
    return null;
  }
  return null;
}

// Add failed requests to summary
summary.failedRequests = failedRequests;

const failedCounts = Object.keys(failedRequests).reduce((acc, courseId) => {
  const courseFailed = failedRequests[courseId];
  Object.keys(courseFailed).forEach(type => {
    acc[type] = (acc[type] || 0) + Object.keys(courseFailed[type]).length;
  });
  return acc;
}, {});

if (Object.keys(failedRequests).length > 0) {
  console.log(`   ⚠️  Found failed requests:`);
  Object.keys(failedCounts).forEach(type => {
    if (failedCounts[type] > 0) {
      console.log(`      - ${type}: ${failedCounts[type]}`);
    }
  });
} else {
  console.log(`   ✅ No failed requests found`);
}

// Save summary file
const summaryPath = path.join(extractionPath, 'extraction-summary.json');
fs.writeFileSync(summaryPath, JSON.stringify(summary, null, 2));

console.log(`\n✅ Summary saved to: ${summaryPath}`);
console.log(`   Total courses: ${Object.keys(summary.courses).length}`);

