#!/usr/bin/env node

/**
 * Upload extraction data to Supabase (Flexible Schema-Less Storage)
 * Reads from mock-data/extraction-data and uploads to flexible JSONB storage
 * Also uploads actual files from downloads/ folders to Supabase Storage
 * 
 * Usage: node supabase/upload-extraction-data.js [user_email] [data_path]
 * Example: node supabase/upload-extraction-data.js kare6625@colorado.edu sample_data
 */

import { createClient } from '@supabase/supabase-js';
import { readFileSync, readdirSync, statSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { generateOrganizedStoragePath, organizeFileByMetadata } from './file-organizer.mjs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Load environment variables
// Try multiple .env file locations (prioritize root .env for service key)
const rootEnvPath = join(dirname(dirname(__dirname)), '.env'); // root .env
const frontendEnvPath = join(dirname(__dirname), '.env'); // frontend/.env

// Load root .env first (has service key)
try {
  if (statSync(rootEnvPath).isFile()) {
    const { config } = await import('dotenv');
    config({ path: rootEnvPath });
    console.log(`📝 Loaded root .env from: ${rootEnvPath}`);
  }
} catch (e) {
  // Continue
}

// Also load frontend .env to merge (may have VITE_ prefixed vars)
try {
  if (statSync(frontendEnvPath).isFile()) {
    const { config } = await import('dotenv');
    config({ path: frontendEnvPath, override: false }); // Don't override root .env values
    console.log(`📝 Also loaded frontend .env from: ${frontendEnvPath}`);
  }
} catch (e) {
  // Continue
}

// Fallback: manual parsing if dotenv didn't work
if (!process.env.SUPABASE_SERVICE_KEY && !process.env.SUPABASE_SERVICE_ROLE_KEY) {
  for (const envPath of [rootEnvPath, frontendEnvPath]) {
    try {
      const envContent = readFileSync(envPath, 'utf-8');
      const envVars = {};
      envContent.split('\n').forEach(line => {
        const trimmed = line.trim();
        if (trimmed && !trimmed.startsWith('#')) {
          const [key, ...valueParts] = trimmed.split('=');
          if (key && valueParts.length > 0) {
            // Remove quotes if present
            let value = valueParts.join('=').trim();
            if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
              value = value.slice(1, -1);
            }
            // Only set if not already in process.env (root .env takes priority)
            if (!process.env[key.trim()]) {
              envVars[key.trim()] = value;
            }
          }
        }
      });
      Object.assign(process.env, envVars);
      if (Object.keys(envVars).length > 0) {
        console.log(`📝 Loaded ${Object.keys(envVars).length} additional variables from ${envPath}`);
      }
    } catch (err) {
      // Try next path
    }
  }
}

const supabaseUrl = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL;
const supabaseAnonKey = process.env.VITE_SUPABASE_ANON_KEY;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_KEY || supabaseAnonKey;

if (!supabaseUrl || !supabaseAnonKey) {
  console.error('❌ Error: Missing Supabase environment variables');
  console.error('   Please set VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY in .env');
  process.exit(1);
}

// Debug: Check if service key was loaded
if (process.env.SUPABASE_SERVICE_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY) {
  console.log('✅ Service key found in environment');
} else {
  console.warn('⚠️  Service key not found - checking available env vars...');
  const serviceKeyVars = Object.keys(process.env).filter(k => k.includes('SERVICE') || k.includes('SERVICE'));
  if (serviceKeyVars.length > 0) {
    console.log(`   Found related vars: ${serviceKeyVars.join(', ')}`);
  }
}

// Create client with service role key for admin operations (table creation, file uploads)
// Service role key bypasses RLS and allows table creation
const supabase = createClient(supabaseUrl, supabaseServiceKey);

if (supabaseServiceKey === supabaseAnonKey) {
  console.warn('⚠️  Warning: Using anon key instead of service role key. Some operations may fail.');
  console.warn('   Set SUPABASE_SERVICE_ROLE_KEY or SUPABASE_SERVICE_KEY in .env for full functionality.');
} else {
  console.log('✅ Using service role key for admin operations');
}

// Helper function to get table prefix from email
function getUserTablePrefix(email) {
  return 'user_' + email.toLowerCase().trim().replace('@', '_at_').replace(/\./g, '_');
}

function getUserBucketName(email) {
  const normalized = email
    .toLowerCase()
    .trim()
    .replace('@', '-at-')
    .replace(/[^a-z0-9-]/g, '-');
  // Supabase bucket names must be <=63 chars, start with letter/number
  const sanitized = normalized.replace(/^-+/, '').slice(0, 60);
  return sanitized ? `user-${sanitized}` : 'user-default';
}

// Helper functions for extraction
function extractWeek(text) {
  if (!text) return null;
  // Try multiple patterns: "Week 1", "week-1", "week1", etc.
  const patterns = [
    /Week\s*(\d+)/i,
    /week-(\d+)/i,
    /week(\d+)/i,
    /week\s*(\d+)\s*[:/]/i, // Fixed: removed - from character class
  ];
  
  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (match) {
      return parseInt(match[1]);
    }
  }
  return null;
}

// Extract week from folder name (e.g., "week-1-aug-24-30" -> 1)
function extractWeekFromFolder(folderName) {
  if (!folderName) return null;
  return extractWeek(folderName);
}

// Extract week from page slug or title
function extractWeekFromPage(page) {
  // Try pageSlug first (e.g., "week-1-aug-24-30-introduction")
  if (page.pageSlug) {
    const week = extractWeek(page.pageSlug);
    if (week) return week;
  }
  
  // Try title (e.g., "Week 1: Aug 24-30")
  if (page.title) {
    const week = extractWeek(page.title);
    if (week) return week;
  }
  
  return null;
}

function extractChapter(filename) {
  if (!filename) return null;
  const match = filename.match(/Ch\s*(\d+)/i);
  return match ? parseInt(match[1]) : null;
}

function classifyFileType(filename) {
  if (!filename) return 'other';
  const lower = filename.toLowerCase();
  if (lower.includes('syllabus')) return 'syllabus';
  if (lower.includes('problem') || lower.includes('probset')) return 'problem';
  if (lower.includes('answer') || lower.includes('solution') || lower.includes('key')) return 'solution';
  if (lower.includes('practice')) return 'practice';
  if (lower.includes('exam') || lower.includes('midterm') || lower.includes('final')) return 'exam';
  if (lower.endsWith('.pptx') || lower.includes('lecture') || lower.includes('ch')) return 'lecture';
  return 'other';
}

function extractDate(text) {
  if (!text) return null;
  const match = text.match(/(\d+\/\d+)/);
  return match ? match[1] : null;
}

function getMimeType(filename) {
  const ext = filename.split('.').pop()?.toLowerCase();
  const mimeTypes = {
    'pdf': 'application/pdf',
    'doc': 'application/msword',
    'docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'docm': 'application/vnd.ms-word.document.macroEnabled.12',
    'ppt': 'application/vnd.ms-powerpoint',
    'pptx': 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
    'xls': 'application/vnd.ms-excel',
    'xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'xlsm': 'application/vnd.ms-excel.sheet.macroEnabled.12',
    'jpg': 'image/jpeg',
    'jpeg': 'image/jpeg',
    'png': 'image/png',
    'gif': 'image/gif',
    'txt': 'text/plain',
    'html': 'text/html',
    'json': 'application/json',
    'ipynb': 'application/x-ipynb+json',
  };
  return mimeTypes[ext] || 'application/octet-stream';
}

async function ensureStorageBucket(bucketName) {
  if (!supabaseServiceKey || supabaseServiceKey === supabaseAnonKey) {
    console.warn('\n⚠️  Cannot auto-create storage bucket without SUPABASE_SERVICE_ROLE_KEY or SUPABASE_SERVICE_KEY');
    console.warn('   Set SUPABASE_SERVICE_ROLE_KEY or SUPABASE_SERVICE_KEY in .env to allow storage management.\n');
    return false;
  }

  console.log(`\n🪣 Ensuring storage bucket "${bucketName}" exists...`);
  const { data: buckets, error: listError } = await supabase.storage.listBuckets();

  if (listError) {
    console.error('   ⚠️  Unable to list storage buckets:', listError.message);
    return false;
  }

  const exists = buckets?.some((bucket) => bucket.name === bucketName);

  if (exists) {
    console.log(`   ✅ Storage bucket "${bucketName}" already exists`);
    return true;
  }

  const { data: createdBucket, error: createError } = await supabase.storage.createBucket(bucketName, {
    public: false,
    allowedMimeTypes: null,
  });

  if (createError) {
    if (createError.message?.toLowerCase().includes('maximum allowed size')) {
      console.error(`   ❌ Failed to create bucket "${bucketName}": ${createError.message}`);
      console.error(`      Supabase reported the file_size_limit exceeded its maximum. Try omitting fileSizeLimit or use dashboard to raise limit.`);
    } else {
      console.error(`   ❌ Failed to create bucket "${bucketName}":`, createError.message);
    }
    return false;
  }

  console.log(`   ✅ Created storage bucket "${createdBucket?.name || bucketName}"`);
  return true;
}

// Function to upload file to Supabase Storage with organized path
async function uploadFileToStorage(bucketName, userEmail, courseId, entityId, filePath, filename, fileData = {}, metadata = {}) {
  try {
    // Generate organized path based on metadata
    const organizedPath = generateOrganizedStoragePath(courseId, fileData, metadata, entityId, filename);
    
    // Read file
    const fileBuffer = readFileSync(filePath);
    const fileStats = statSync(filePath);
    const fileSizeMB = (fileStats.size / (1024 * 1024)).toFixed(2);
    
    console.log(`      📤 Uploading ${filename} (${fileSizeMB} MB) to organized path...`);
    
    const mimeType = getMimeType(filename);
    
    // Upload to storage bucket with organized path
    const { data, error } = await supabase.storage
      .from(bucketName)
      .upload(organizedPath, fileBuffer, {
        contentType: mimeType,
        upsert: true,
        cacheControl: '3600',
      });
    
    if (error) {
      if (error.message.includes('size') || error.message.includes('limit')) {
        console.error(`      ⚠️  File too large: ${filename} (${fileSizeMB} MB)`);
        console.error(`      💡 Consider increasing bucket file_size_limit`);
      }
      console.error(`      ⚠️  Error uploading file:`, error.message);
      return null;
    }
    
    console.log(`      ✅ Uploaded ${filename} (${fileSizeMB} MB) to ${organizedPath}`);
    
    return {
      storagePath: organizedPath,
      organizedPath: organizeFileByMetadata(fileData, metadata),
      size: fileStats.size,
      mimeType: mimeType
    };
  } catch (error) {
    console.error(`      ⚠️  Error processing file:`, error.message);
    return null;
  }
}

// Helper to recursively get all files
function getAllFiles(dirPath, arrayOfFiles = []) {
  try {
    const files = readdirSync(dirPath, { withFileTypes: true });
    
    files.forEach(file => {
      const filePath = join(dirPath, file.name);
      if (file.isDirectory()) {
        arrayOfFiles = getAllFiles(filePath, arrayOfFiles);
      } else {
        // Skip system files
        if (!file.name.startsWith('.') && file.name !== 'Thumbs.db' && file.name !== '.DS_Store') {
          arrayOfFiles.push(filePath);
        }
      }
    });
  } catch (error) {
    // Directory doesn't exist or can't be read
  }
  
  return arrayOfFiles;
}

// Get user email and data path from command line
const userEmail = process.argv[2];
const dataPathArg = process.argv[3];

async function uploadExtractionData() {
  try {
    // Determine the data path
    let extractionDataPath;
    if (dataPathArg) {
      // Check if it's an absolute path
      if (dataPathArg.startsWith('/') || (process.platform === 'win32' && /^[A-Za-z]:/.test(dataPathArg))) {
        extractionDataPath = dataPathArg;
        console.log(`📁 Using absolute path: ${extractionDataPath}`);
      } else if (dataPathArg.startsWith('..')) {
        // Relative path starting with .. - resolve from frontend directory
        extractionDataPath = join(__dirname, '..', dataPathArg);
        console.log(`📁 Using relative path from frontend: ${extractionDataPath}`);
      } else {
        // Relative path - use the old logic (relative to mock-data/extraction-data)
        extractionDataPath = join(__dirname, '..', 'mock-data', 'extraction-data', dataPathArg);
      }
    } else {
      const sampleDataPath = join(__dirname, '..', 'mock-data', 'extraction-data', 'sample_data');
      const rootDataPath = join(__dirname, '..', 'mock-data', 'extraction-data');
      
      try {
        statSync(sampleDataPath);
        extractionDataPath = sampleDataPath;
        console.log('📁 Using sample_data folder');
      } catch {
        extractionDataPath = rootDataPath;
        console.log('📁 Using extraction-data root folder');
      }
    }
    
    const summaryPath = join(extractionDataPath, 'extraction-summary.json');
    
    if (!statSync(summaryPath).isFile()) {
      console.error(`❌ Error: extraction-summary.json not found at: ${summaryPath}`);
      process.exit(1);
    }
    
    console.log('📖 Reading extraction summary...');
    const summary = JSON.parse(readFileSync(summaryPath, 'utf-8'));
    
    const email = userEmail || summary.user?.email;
    if (!email) {
      console.error('❌ Error: No user email provided');
      console.error('   Usage: node supabase/upload-extraction-data.js <user_email> [data_path]');
      process.exit(1);
    }
    
    const normalizedEmail = email.toLowerCase().trim();
    const userBucketName = getUserBucketName(normalizedEmail);
    console.log(`📧 Uploading data for user: ${normalizedEmail}`);
    console.log(`📂 Data path: ${extractionDataPath}\n`);
    
    // Ensure user data table exists
    console.log(`🏗️  Ensuring user data table exists...`);
    const { error: tableError } = await supabase.rpc('create_user_data_table', {
      user_email: normalizedEmail
    });
    
    if (tableError) {
      console.warn(`   ⚠️  Error creating table:`, tableError.message);
      console.log(`   💡 Table may already exist or will be created automatically`);
      } else {
      console.log(`   ✅ User data table ready`);
    }
    
    // Wait for PostgREST cache refresh
    await new Promise(resolve => setTimeout(resolve, 1000));
    
    const colorPalette = [
      'hsl(220, 45%, 48%)',
      'hsl(160, 45%, 48%)',
      'hsl(280, 45%, 48%)',
      'hsl(35, 65%, 52%)',
      'hsl(4, 74%, 58%)',
      'hsl(195, 61%, 52%)',
      'hsl(120, 39%, 49%)'
    ];
    
    function extractCourseMetadata(courseData, index) {
      const folderName = courseData.courseFolderName || courseData.fullName || '';
      let code = courseData.courseCode || courseData.code || '';
      let name = courseData.courseName || courseData.name || '';
      let instructor = courseData.instructor || '';
      
      if ((!code || !name) && folderName) {
        const [codePart, ...rest] = folderName.split(':');
        if (!code && codePart) code = codePart.trim();
        if (!name && rest.length) name = rest.join(':').trim();
      }
      
      if (!instructor && name) {
        const instructorMatch = name.match(/\(([^)]+)\)\s*$/);
        if (instructorMatch) {
          instructor = instructorMatch[1].trim();
          name = name.replace(/\([^)]+\)\s*$/, '').trim();
        }
      }
      
      if (!name && folderName) {
        name = folderName.replace(code, '').replace(':', '').trim();
      }
      
      return {
        code,
        name,
        instructor,
        color: courseData.color || colorPalette[index % colorPalette.length]
      };
    }
    
    // Helper function to match course directory to course object
    // Returns { course, matchMethod } or null if no match
    function findCourseForDirectory(courseDir, coursesList) {
      // Priority 1: Exact match with courseFolderName (most reliable)
      for (const c of coursesList) {
        if (c.courseFolderName && c.courseFolderName === courseDir) {
          return { course: c, matchMethod: 'exact courseFolderName' };
        }
      }
      
      // Priority 2: Exact match with fullName
      for (const c of coursesList) {
        const fullName = c.fullName || `${c.code}: ${c.name}`;
        if (fullName === courseDir) {
          return { course: c, matchMethod: 'exact fullName' };
        }
      }
      
      // Priority 3: Exact match with code: name format
      for (const c of coursesList) {
        if (`${c.code}: ${c.name}` === courseDir) {
          return { course: c, matchMethod: 'exact code:name' };
        }
      }
      
      // Priority 4: Check if courseDir starts with course code (more strict than includes)
      const startsWithMatches = coursesList.filter(c => {
        if (c.code && courseDir.trim().startsWith(c.code.trim())) {
          return true;
        }
        return false;
      });
      
      if (startsWithMatches.length === 1) {
        return { course: startsWithMatches[0], matchMethod: 'starts with code' };
      } else if (startsWithMatches.length > 1) {
        console.error(`   ❌ Ambiguous course match for "${courseDir}" - ${startsWithMatches.length} courses start with same code:`);
        startsWithMatches.forEach(m => console.error(`      - ${m.courseFolderName || m.fullName} (${m.code})`));
        return null; // Ambiguous - don't match
      }
      
      // Priority 5: Last resort - check if course code appears as a word boundary
      const wordBoundaryMatches = coursesList.filter(c => {
        if (c.code) {
          const codeRegex = new RegExp(`\\b${c.code.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'i');
          if (codeRegex.test(courseDir)) {
            return true;
          }
        }
        return false;
      });
      
      if (wordBoundaryMatches.length === 1) {
        return { course: wordBoundaryMatches[0], matchMethod: 'word boundary code' };
      } else if (wordBoundaryMatches.length > 1) {
        console.error(`   ❌ Ambiguous course match for "${courseDir}" - ${wordBoundaryMatches.length} courses match word boundary:`);
        wordBoundaryMatches.forEach(m => console.error(`      - ${m.courseFolderName || m.fullName} (${m.code})`));
        return null; // Ambiguous - don't match
      }
      
      return null; // No match found
    }
    
    // Upload courses
    console.log('\n📚 Uploading courses...');
    let courses = [];
    if (Array.isArray(summary.courses)) {
      courses = summary.courses.map((courseData, index) => {
        const metadata = extractCourseMetadata(courseData, index);
        return {
          id: parseInt(courseData.id) || parseInt(courseData.courseId) || index + 1,
          code: metadata.code,
          name: metadata.name,
          fullName: courseData.fullName || courseData.courseFolderName || `${metadata.code}: ${metadata.name}`,
          courseFolderName: courseData.courseFolderName || courseData.fullName || `${metadata.code}: ${metadata.name}`, // Store exact folder name
          instructor: metadata.instructor,
          color: metadata.color,
          enrollmentTermId: courseData.enrollmentTermId || 1,
          workflowState: courseData.workflowState || 'available',
        };
      });
    } else if (summary.courses && typeof summary.courses === 'object') {
      courses = Object.values(summary.courses).map((courseData, index) => {
        const metadata = extractCourseMetadata(courseData, index);
        return {
          id: parseInt(courseData.courseId || courseData.id) || 0,
          code: metadata.code,
          name: metadata.name,
          fullName: courseData.courseFolderName || courseData.fullName || `${metadata.code}: ${metadata.name}`,
          courseFolderName: courseData.courseFolderName || courseData.fullName || `${metadata.code}: ${metadata.name}`, // Store exact folder name
          instructor: metadata.instructor,
          color: metadata.color,
          enrollmentTermId: courseData.enrollmentTermId || 1,
          workflowState: courseData.workflowState || 'available',
        };
      });
    }
    
    for (const course of courses) {
      const { error } = await supabase.rpc('upsert_user_entity', {
        user_email: normalizedEmail,
        entity_type_val: 'course',
        entity_id_val: course.id.toString(),
        data_val: course,
        course_id_val: course.id.toString(),
        metadata_val: {
          fullName: course.fullName,
          extractedWeek: null,
        }
        });
      
      if (error) {
        console.error(`   ⚠️  Error uploading course ${course.code}:`, error.message);
      } else {
        console.log(`   ✅ Uploaded course: ${course.code}`);
      }
    }
    
    const datasetsPath = join(extractionDataPath, 'datasets', 'courses');
    
    // Upload assignments
    console.log('\n📝 Uploading assignments...');
    let assignmentCount = 0;
    
    if (statSync(datasetsPath).isDirectory()) {
      const courseDirs = readdirSync(datasetsPath, { withFileTypes: true })
        .filter(dirent => dirent.isDirectory())
        .map(dirent => dirent.name);
      
      for (const courseDir of courseDirs) {
        const assignmentsPath = join(datasetsPath, courseDir, 'assignments');
        let assignmentFiles = [];
        
        try {
          if (statSync(assignmentsPath).isDirectory()) {
            assignmentFiles = readdirSync(assignmentsPath)
              .filter(f => f.endsWith('.json'))
              .sort();
          }
        } catch (e) {
          continue;
        }
        
        if (assignmentFiles.length === 0) continue;
        
        // Match course using strict matching logic
        const matchResult = findCourseForDirectory(courseDir, courses);
        if (!matchResult) {
          console.warn(`   ⚠️  Course not found for directory: ${courseDir} (skipping assignments)`);
          continue;
        }
        
        const { course, matchMethod } = matchResult;
        if (matchMethod !== 'exact courseFolderName' && matchMethod !== 'exact fullName') {
          console.warn(`   ⚠️  Using ${matchMethod} for "${courseDir}" → "${course.courseFolderName || course.fullName}" (${course.code})`);
        }
        
        for (const file of assignmentFiles) {
          try {
            const filePath = join(assignmentsPath, file);
            const assignment = JSON.parse(readFileSync(filePath, 'utf-8'));
            
            const metadata = {
              extractedWeek: extractWeek(assignment.title),
              dueDate: assignment.dueDate || assignment.due_date,
              points: assignment.points || assignment.pointsPossible,
            };
            
            const { error } = await supabase.rpc('upsert_user_entity', {
              user_email: normalizedEmail,
              entity_type_val: 'assignment',
              entity_id_val: assignment.assignmentId?.toString() || assignment.id?.toString() || file.replace('.json', ''),
              data_val: assignment,
              course_id_val: course.id.toString(),
              metadata_val: metadata
              });
            
            if (error) {
              console.error(`   ⚠️  Error uploading assignment:`, error.message);
            } else {
              assignmentCount++;
            }
          } catch (fileError) {
            console.error(`   ⚠️  Error reading assignment file ${file}:`, fileError.message);
          }
        }
      }
    }
    console.log(`   ✅ Uploaded ${assignmentCount} assignments`);
    
    // Upload announcements
    console.log('\n📢 Uploading announcements...');
    let announcementCount = 0;
    
    if (statSync(datasetsPath).isDirectory()) {
      const courseDirs = readdirSync(datasetsPath, { withFileTypes: true })
        .filter(dirent => dirent.isDirectory())
        .map(dirent => dirent.name);
      
      for (const courseDir of courseDirs) {
        const announcementsPath = join(datasetsPath, courseDir, 'announcements');
        let announcementFiles = [];
        
        try {
          if (statSync(announcementsPath).isDirectory()) {
            announcementFiles = readdirSync(announcementsPath)
              .filter(f => f.endsWith('.json'))
              .sort();
          }
        } catch (e) {
          continue;
        }
        
        if (announcementFiles.length === 0) continue;
        
        const matchResult = findCourseForDirectory(courseDir, courses);
        if (!matchResult) {
          console.warn(`   ⚠️  Course not found for directory: ${courseDir} (skipping announcements)`);
          continue;
        }
        
        const { course, matchMethod } = matchResult;
        if (matchMethod !== 'exact courseFolderName' && matchMethod !== 'exact fullName') {
          console.warn(`   ⚠️  Using ${matchMethod} for "${courseDir}" → "${course.courseFolderName || course.fullName}" (${course.code})`);
        }
        
        for (const file of announcementFiles) {
          try {
            const filePath = join(announcementsPath, file);
            const announcement = JSON.parse(readFileSync(filePath, 'utf-8'));
            
            const { error } = await supabase.rpc('upsert_user_entity', {
              user_email: normalizedEmail,
              entity_type_val: 'announcement',
              entity_id_val: announcement.announcementId?.toString() || announcement.id?.toString() || file.replace('.json', ''),
              data_val: announcement,
              course_id_val: course.id.toString(),
              metadata_val: {
                postedAt: announcement.postedAt || announcement.posted_at,
              }
              });
            
            if (error) {
              console.error(`   ⚠️  Error uploading announcement:`, error.message);
            } else {
              announcementCount++;
            }
          } catch (fileError) {
            console.error(`   ⚠️  Error reading announcement file ${file}:`, fileError.message);
          }
        }
      }
    }
    console.log(`   ✅ Uploaded ${announcementCount} announcements`);
    
    // Upload quizzes
    console.log('\n📝 Uploading quizzes...');
    let quizCount = 0;
    
    if (statSync(datasetsPath).isDirectory()) {
      const courseDirs = readdirSync(datasetsPath, { withFileTypes: true })
        .filter(dirent => dirent.isDirectory())
        .map(dirent => dirent.name);
      
      for (const courseDir of courseDirs) {
        const quizzesPath = join(datasetsPath, courseDir, 'quizzes');
        let quizFiles = [];
        
        try {
          if (statSync(quizzesPath).isDirectory()) {
            quizFiles = readdirSync(quizzesPath)
              .filter(f => f.endsWith('.json'))
              .sort();
          }
        } catch (e) {
          continue;
        }
        
        if (quizFiles.length === 0) continue;
        
        // Match course using strict matching logic
        const matchResult = findCourseForDirectory(courseDir, courses);
        if (!matchResult) {
          console.warn(`   ⚠️  Course not found for directory: ${courseDir} (skipping quizzes)`);
          continue;
        }
        
        const { course, matchMethod } = matchResult;
        if (matchMethod !== 'exact courseFolderName' && matchMethod !== 'exact fullName') {
          console.warn(`   ⚠️  Using ${matchMethod} for "${courseDir}" → "${course.courseFolderName || course.fullName}" (${course.code})`);
        }
        
        for (const file of quizFiles) {
          try {
            const filePath = join(quizzesPath, file);
            const quiz = JSON.parse(readFileSync(filePath, 'utf-8'));
            
            const metadata = {
              extractedWeek: extractWeek(quiz.title),
              dueDate: quiz.metadata?.dueDate || quiz.dueDate,
              points: quiz.metadata?.points || quiz.pointsPossible,
              questionCount: quiz.questionCount || quiz.questions?.length || 0,
              timeLimit: quiz.metadata?.timeLimit,
              attempts: quiz.metadata?.attempts,
            };
            
            const { error } = await supabase.rpc('upsert_user_entity', {
              user_email: normalizedEmail,
              entity_type_val: 'quiz',
              entity_id_val: quiz.quizId?.toString() || quiz.id?.toString() || file.replace('.json', ''),
              data_val: quiz,
              course_id_val: course.id.toString(),
              metadata_val: metadata
              });
            
            if (error) {
              console.error(`   ⚠️  Error uploading quiz:`, error.message);
            } else {
              quizCount++;
            }
          } catch (fileError) {
            console.error(`   ⚠️  Error reading quiz file ${file}:`, fileError.message);
          }
        }
      }
    }
    console.log(`   ✅ Uploaded ${quizCount} quizzes`);
    
    // Upload modules (process moduleFiles into proper module structure)
    console.log('\n📦 Uploading modules...');
    let moduleCount = 0;
    
    if (statSync(datasetsPath).isDirectory()) {
      const courseDirs = readdirSync(datasetsPath, { withFileTypes: true })
        .filter(dirent => dirent.isDirectory())
        .map(dirent => dirent.name);
      
      for (const courseDir of courseDirs) {
        const modulesPath = join(datasetsPath, courseDir, 'modules');
        let moduleFiles = [];
        
        try {
          if (statSync(modulesPath).isDirectory()) {
            moduleFiles = readdirSync(modulesPath)
              .filter(f => f.endsWith('.json'))
              .sort();
          }
        } catch (e) {
          continue;
        }
        
        if (moduleFiles.length === 0) continue;
        
        const matchResult = findCourseForDirectory(courseDir, courses);
        if (!matchResult) {
          console.warn(`   ⚠️  Course not found for directory: ${courseDir} (skipping modules)`);
          continue;
        }
        
        const { course, matchMethod } = matchResult;
        if (matchMethod !== 'exact courseFolderName' && matchMethod !== 'exact fullName') {
          console.warn(`   ⚠️  Using ${matchMethod} for "${courseDir}" → "${course.courseFolderName || course.fullName}" (${course.code})`);
        }
        
        // Group moduleFiles by moduleId to create proper module structure
        const modulesMap = new Map();
        
        for (const file of moduleFiles) {
          try {
            const filePath = join(modulesPath, file);
            const moduleData = JSON.parse(readFileSync(filePath, 'utf-8'));
            
            // Process moduleFiles array
            if (Array.isArray(moduleData.moduleFiles)) {
              for (const moduleFile of moduleData.moduleFiles) {
                const moduleId = moduleFile.moduleId?.toString() || 'unknown';
                const moduleName = moduleFile.moduleName || 'Untitled Module';
                
                if (!modulesMap.has(moduleId)) {
                  modulesMap.set(moduleId, {
                    moduleId: moduleId,
                    name: moduleName,
                    position: moduleFile.modulePosition || 0,
                    courseId: course.id,
                    items: []
                  });
                }
                
                const module = modulesMap.get(moduleId);
                module.items.push({
                  id: moduleFile.moduleItemId || 0,
                  title: moduleFile.moduleItemTitle || moduleFile.fileName || 'Untitled Item',
                  type: moduleFile.moduleItemType || 'File',
                  position: moduleFile.moduleItemPosition || 0,
                  indent: moduleFile.indent || 0,
                  fileId: moduleFile.fileId,
                  fileName: moduleFile.fileName,
                  downloadUrl: moduleFile.downloadUrl,
                });
              }
            }
          } catch (fileError) {
            console.error(`   ⚠️  Error reading module file ${file}:`, fileError.message);
          }
        }
        
        // Upload each module
        for (const [moduleId, module] of modulesMap) {
          const metadata = {
            extractedWeek: extractWeek(module.name),
            extractedDate: extractDate(module.name),
            itemCount: module.items.length,
          };
          
          const { error } = await supabase.rpc('upsert_user_entity', {
            user_email: normalizedEmail,
            entity_type_val: 'module',
            entity_id_val: moduleId,
            data_val: module,
            course_id_val: course.id.toString(),
            metadata_val: metadata
          });
          
          if (error) {
            console.error(`   ⚠️  Error uploading module ${module.name}:`, error.message);
          } else {
            moduleCount++;
          }
        }
      }
    }
    console.log(`   ✅ Uploaded ${moduleCount} modules`);
    
    // Upload pages and organize by week
    console.log('\n📄 Uploading pages and organizing by week...');
    let pageCount = 0;
    
    // Map to track week-based modules: courseId -> week -> { pages: [], files: [] }
    const weekModulesMap = new Map();
    
    if (statSync(datasetsPath).isDirectory()) {
      const courseDirs = readdirSync(datasetsPath, { withFileTypes: true })
        .filter(dirent => dirent.isDirectory())
        .map(dirent => dirent.name);
      
      for (const courseDir of courseDirs) {
        const pagesPath = join(datasetsPath, courseDir, 'pages');
        let pageFiles = [];
        
        try {
          if (statSync(pagesPath).isDirectory()) {
            pageFiles = readdirSync(pagesPath)
              .filter(f => f.endsWith('.json'))
              .sort();
          }
        } catch (e) {
          continue;
        }
        
        if (pageFiles.length === 0) continue;
        
        const matchResult = findCourseForDirectory(courseDir, courses);
        if (!matchResult) {
          console.warn(`   ⚠️  Course not found for directory: ${courseDir} (skipping pages)`);
          continue;
        }
        
        const { course, matchMethod } = matchResult;
        if (matchMethod !== 'exact courseFolderName' && matchMethod !== 'exact fullName') {
          console.warn(`   ⚠️  Using ${matchMethod} for "${courseDir}" → "${course.courseFolderName || course.fullName}" (${course.code})`);
        }
        
        // Initialize week modules map for this course
        if (!weekModulesMap.has(course.id)) {
          weekModulesMap.set(course.id, new Map());
        }
        const courseWeekMap = weekModulesMap.get(course.id);
        
        for (const file of pageFiles) {
          try {
            const filePath = join(pagesPath, file);
            const page = JSON.parse(readFileSync(filePath, 'utf-8'));
            
            // Extract week from page
            const week = extractWeekFromPage(page);
            const weekKey = week ? `week-${week}` : 'other';
            
            // Get or create week module
            if (!courseWeekMap.has(weekKey)) {
              courseWeekMap.set(weekKey, {
                week: week,
                weekName: week ? `Week ${week}` : 'Other Content',
                pages: [],
                files: [],
                position: week || 9999, // Other content goes last
                seenPages: new Set(), // Track seen pages to prevent duplicates
              });
            }
            
            const weekModule = courseWeekMap.get(weekKey);
            const pageId = page.pageId?.toString() || page.id?.toString() || file.replace('.json', '');
            
            // Deduplicate: check if we've already added this page to this week module
            const pageKey = `${pageId}|${page.title || ''}`;
            if (weekModule.seenPages && weekModule.seenPages.has(pageKey)) {
              continue; // Skip duplicate page
            }
            if (!weekModule.seenPages) {
              weekModule.seenPages = new Set();
            }
            weekModule.seenPages.add(pageKey);
            
            weekModule.pages.push({
              id: pageId,
                title: page.title || 'Untitled Page',
              pageSlug: page.pageSlug,
              url: page.url,
              content: page.content,
            });
            
            // Debug: log first few pages per week
            if (weekModule.pages.length <= 3) {
              console.log(`      📄 Added page to ${weekModule.weekName}: "${page.title || 'Untitled'}" (week ${week})`);
            }
            
            const metadata = {
              moduleId: page.location?.moduleId,
              moduleName: page.location?.moduleName,
              published: page.metadata?.published,
              extractedWeek: week,
              weekKey: weekKey,
              embeddedFiles: page.embeddedContent?.files || [],
            };
            
            const { error } = await supabase.rpc('upsert_user_entity', {
              user_email: normalizedEmail,
              entity_type_val: 'page',
              entity_id_val: page.pageId?.toString() || page.id?.toString() || file.replace('.json', ''),
              data_val: page,
              course_id_val: course.id.toString(),
              metadata_val: metadata
              });
            
            if (error) {
              console.error(`   ⚠️  Error uploading page:`, error.message);
            } else {
              pageCount++;
            }
          } catch (fileError) {
            console.error(`   ⚠️  Error reading page file ${file}:`, fileError.message);
          }
        }
      }
    }
    console.log(`   ✅ Uploaded ${pageCount} pages`);
    
    // Upload files metadata
    console.log('\n📁 Uploading files metadata...');
    let fileCount = 0;
    
    if (statSync(datasetsPath).isDirectory()) {
      const courseDirs = readdirSync(datasetsPath, { withFileTypes: true })
        .filter(dirent => dirent.isDirectory())
        .map(dirent => dirent.name);
      
      for (const courseDir of courseDirs) {
        const filesPath = join(datasetsPath, courseDir, 'files');
        let fileFiles = [];
        
        try {
          if (statSync(filesPath).isDirectory()) {
            fileFiles = readdirSync(filesPath)
              .filter(f => f.endsWith('.json'))
              .sort();
          }
        } catch (e) {
          continue;
        }
        
        if (fileFiles.length === 0) continue;
        
        const matchResult = findCourseForDirectory(courseDir, courses);
        if (!matchResult) {
          console.warn(`   ⚠️  Course not found for directory: ${courseDir} (skipping files)`);
          continue;
        }
        
        const { course, matchMethod } = matchResult;
        if (matchMethod !== 'exact courseFolderName' && matchMethod !== 'exact fullName') {
          console.warn(`   ⚠️  Using ${matchMethod} for "${courseDir}" → "${course.courseFolderName || course.fullName}" (${course.code})`);
        }
        
        for (const file of fileFiles) {
          try {
            const filePath = join(filesPath, file);
            const fileData = JSON.parse(readFileSync(filePath, 'utf-8'));
            
            const metadata = {
              moduleId: fileData.moduleId,
              moduleName: fileData.moduleName,
              modulePosition: fileData.modulePosition,
              moduleItemId: fileData.moduleItemId,
              moduleItemTitle: fileData.moduleItemTitle,
              moduleItemType: fileData.moduleItemType,
              moduleItemPosition: fileData.moduleItemPosition,
              indent: fileData.indent,
              completionRequirement: fileData.completionRequirement,
              folderPath: fileData.folderPath,
              folderPathString: fileData.folderPathString,
              source: fileData.source,
              fileExtension: fileData.name?.split('.').pop(),
              contentType: fileData.contentType || fileData.content_type,
              extractedWeek: extractWeek(fileData.moduleName || fileData.name),
              extractedChapter: extractChapter(fileData.name),
              extractedContentType: classifyFileType(fileData.name),
              organizedPath: organizeFileByMetadata(fileData, {
                extractedWeek: extractWeek(fileData.moduleName || fileData.name),
                extractedChapter: extractChapter(fileData.name),
                extractedContentType: classifyFileType(fileData.name),
              }),
            };
            
            const { error } = await supabase.rpc('upsert_user_entity', {
              user_email: normalizedEmail,
              entity_type_val: 'file',
              entity_id_val: fileData.fileId?.toString() || fileData.id?.toString() || file.replace('.json', ''),
              data_val: fileData,
              course_id_val: course.id.toString(),
              metadata_val: metadata
              });
            
            if (error) {
              console.error(`   ⚠️  Error uploading file metadata:`, error.message);
            } else {
              fileCount++;
            }
          } catch (fileError) {
            console.error(`   ⚠️  Error reading file metadata ${file}:`, fileError.message);
          }
        }
      }
    }
    console.log(`   ✅ Uploaded ${fileCount} file metadata entries`);
    
    // Upload actual files from downloads folder
    const storageReady = await ensureStorageBucket(userBucketName);
    console.log('\n💾 Uploading actual files from downloads folder...');
    let uploadedFileCount = 0;
    let totalFileSize = 0;
    
    if (!storageReady) {
      console.warn('   ⚠️  Skipping storage uploads because bucket is unavailable');
    }
    
    // Downloads are in courses/{courseName}/downloads, not datasets/courses/{courseName}/downloads
    const downloadsPath = join(extractionDataPath, 'courses');
    
    if (statSync(downloadsPath).isDirectory()) {
      const courseDirs = readdirSync(downloadsPath, { withFileTypes: true })
        .filter(dirent => dirent.isDirectory())
        .map(dirent => dirent.name);
      
      for (const courseDir of courseDirs) {
        const courseDownloadsPath = join(downloadsPath, courseDir, 'downloads');
        
        if (!statSync(courseDownloadsPath).isDirectory()) continue;
        
        const matchResult = findCourseForDirectory(courseDir, courses);
        if (!matchResult) {
          console.warn(`   ⚠️  Course not found for directory: ${courseDir} (skipping downloads)`);
          continue;
        }
        
        const { course, matchMethod } = matchResult;
        if (matchMethod !== 'exact courseFolderName' && matchMethod !== 'exact fullName') {
          console.warn(`   ⚠️  Using ${matchMethod} for "${courseDir}" → "${course.courseFolderName || course.fullName}" (${course.code})`);
        }
        
        console.log(`   📂 Processing files from ${courseDir}...`);
        
        // Initialize week modules map for this course if not already done
        if (!weekModulesMap.has(course.id)) {
          weekModulesMap.set(course.id, new Map());
        }
        const courseWeekMap = weekModulesMap.get(course.id);
        
        // Get all files recursively, organized by folder structure
        function organizeFilesByFolder(dirPath, basePath = '', filesByFolder = new Map()) {
          const entries = readdirSync(dirPath, { withFileTypes: true });
          
          for (const entry of entries) {
            const fullPath = join(dirPath, entry.name);
            const relativePath = basePath ? `${basePath}/${entry.name}` : entry.name;
            
            if (entry.isDirectory()) {
              organizeFilesByFolder(fullPath, relativePath, filesByFolder);
            } else if (!entry.name.startsWith('.') && entry.name !== 'Thumbs.db' && entry.name !== '.DS_Store') {
              const folderKey = basePath || 'root';
              if (!filesByFolder.has(folderKey)) {
                filesByFolder.set(folderKey, []);
              }
              filesByFolder.get(folderKey).push({
                path: fullPath,
                relativePath: relativePath,
                filename: entry.name,
                folder: basePath || 'root',
              });
            }
          }
          
          return filesByFolder;
        }
        
        const filesByFolder = organizeFilesByFolder(courseDownloadsPath);
        
        // Process files and organize by week
        for (const [folder, files] of filesByFolder) {
          // Extract week from folder name
          // Examples: "pages/week-1-aug-24-30" -> week 1, "modules/Week_2" -> week 2
          let week = null;
          if (folder && folder !== 'root') {
            // Try to extract week from folder path
            week = extractWeekFromFolder(folder);
            
            // If not found, try extracting from folder name parts
            if (!week) {
              const folderParts = folder.split('/');
              for (const part of folderParts) {
                week = extractWeekFromFolder(part);
                if (week) break;
              }
            }
          }
          
          const weekKey = week ? `week-${week}` : 'other';
          
          // Get or create week module
          if (!courseWeekMap.has(weekKey)) {
            courseWeekMap.set(weekKey, {
              week: week,
              weekName: week ? `Week ${week}` : 'Other Content',
              pages: [],
              files: [],
              position: week || 9999,
              seenFiles: new Set(), // Track seen files to prevent duplicates
            });
          }
          
          const weekModule = courseWeekMap.get(weekKey);
          
          for (const fileInfo of files) {
            try {
              const relativePath = fileInfo.relativePath;
              const filename = fileInfo.filename;
              const pathParts = relativePath.split('/');
              
              // Generate entity ID from path
              const entityId = `download_${pathParts.join('_').replace(/[^a-zA-Z0-9_]/g, '_')}`;
              
              // Prepare file data and metadata for organization
              const fileData = {
                name: filename,
                moduleName: week ? `Week ${week}` : null,
                folderPath: pathParts.slice(0, -1),
              };
              
              const metadata = {
                originalPath: relativePath,
                entityType: pathParts[0], // 'modules', 'pages', 'announcements', etc.
                context: pathParts.slice(1, -1).join('/'),
                fileExtension: filename.split('.').pop(),
                extractedContentType: classifyFileType(filename),
                extractedWeek: week,
                weekKey: weekKey,
                storageBucket: userBucketName,
              };
              
              // Upload file to storage with organized path (skip if bucket doesn't exist - we'll handle that separately)
              let storageInfo = null;
              if (storageReady) {
                try {
                  storageInfo = await uploadFileToStorage(
                    userBucketName,
                    normalizedEmail,
                    course.id.toString(),
                    entityId,
                    fileInfo.path,
                    filename,
                    fileData,
                    metadata
                  );
                  // Add organized path to metadata
                  if (storageInfo?.organizedPath) {
                    metadata.organizedPath = storageInfo.organizedPath;
                  }
                } catch (storageError) {
                  console.log(`      ⚠️  Skipping storage upload for ${filename} (${storageError.message})`);
                }
              } else {
                console.log(`      ⚠️  Skipping storage upload for ${filename} (storage bucket unavailable)`);
              }
              
              if (storageInfo) {
                uploadedFileCount++;
                totalFileSize += storageInfo.size;
              }
              
              // Deduplicate: check if we've already added this file to this week module
              const fileKey = `${filename.toLowerCase().trim()}`;
              if (weekModule.seenFiles && weekModule.seenFiles.has(fileKey)) {
                continue; // Skip duplicate file
              }
              if (!weekModule.seenFiles) {
                weekModule.seenFiles = new Set();
              }
              weekModule.seenFiles.add(fileKey);
              
              // Add file to week module
              weekModule.files.push({
                id: entityId,
                filename: filename,
                originalPath: relativePath,
                storagePath: storageInfo?.storagePath,
                organizedPath: storageInfo?.organizedPath,
                storageBucket: userBucketName, // Include bucket name for file URL resolution
                size: storageInfo?.size,
                mimeType: storageInfo?.mimeType,
              });
              
              await supabase.rpc('upsert_user_entity', {
                user_email: normalizedEmail,
                entity_type_val: 'file_binary',
                entity_id_val: entityId,
                data_val: {
                  originalPath: relativePath,
                  filename: filename,
                  entityType: pathParts[0],
                  context: pathParts.slice(1, -1).join('/'),
                },
                course_id_val: course.id.toString(),
                metadata_val: metadata,
                file_storage_path_val: storageInfo?.storagePath,
                file_size_val: storageInfo?.size,
                file_mime_type_val: storageInfo?.mimeType
              });
            } catch (error) {
              console.error(`   ⚠️  Error processing file ${fileInfo.path}:`, error.message);
            }
          }
        }
      }
    }
    
    const totalSizeMB = (totalFileSize / (1024 * 1024)).toFixed(2);
    console.log(`   ✅ Uploaded ${uploadedFileCount} files (${totalSizeMB} MB total)`);
    
    // Create week-based modules from pages and files
    console.log('\n📦 Creating week-based modules from pages and files...');
    let weekModuleCount = 0;
    
    for (const [courseId, courseWeekMap] of weekModulesMap) {
      const course = courses.find(c => c.id === courseId);
      if (!course) continue;
      
      // Convert map to array and sort by week number
      const weekModules = Array.from(courseWeekMap.values())
        .filter(wm => wm.pages.length > 0 || wm.files.length > 0) // Only create modules with content
        .sort((a, b) => {
          // Sort by week number, with "other" at the end
          if (a.week === null && b.week === null) return 0;
          if (a.week === null) return 1;
          if (b.week === null) return -1;
          return a.week - b.week;
        });
      
      for (const weekModule of weekModules) {
        console.log(`   📦 Creating module "${weekModule.weekName}" with ${weekModule.pages.length} pages and ${weekModule.files.length} files`);
        
        // Combine pages and files into module items
        const moduleItems = [];
        let itemPosition = 0;
        const seenItemKeys = new Set();
        
        // Add pages as items
        for (const page of weekModule.pages) {
          // Extract numeric ID from page ID (handle "000000001" format)
          let pageNumericId = 0;
          if (typeof page.id === 'string') {
            // Try parsing as-is first
            pageNumericId = parseInt(page.id, 10);
            // If that fails (e.g., "000000001" -> 1), use the numeric value
            if (isNaN(pageNumericId) || pageNumericId === 0) {
              // Try removing leading zeros
              const cleaned = page.id.replace(/^0+/, '') || '0';
              pageNumericId = parseInt(cleaned, 10) || 0;
            }
            // If still 0, use a hash of the string as fallback
            if (pageNumericId === 0 && page.id) {
              // Simple hash function to convert string to number
              let hash = 0;
              for (let i = 0; i < page.id.length; i++) {
                const char = page.id.charCodeAt(i);
                hash = ((hash << 5) - hash) + char;
                hash = hash & hash; // Convert to 32bit integer
              }
              pageNumericId = Math.abs(hash) || 1;
            }
          } else {
            pageNumericId = page.id || 0;
          }
          
          // Ensure we have a valid ID
          if (pageNumericId === 0) pageNumericId = 1;
          
          // Deduplicate: check if we've already added this page
          const pageKey = `${pageNumericId}|${page.title || ''}|Page`;
          if (seenItemKeys.has(pageKey)) {
            continue; // Skip duplicate
          }
          seenItemKeys.add(pageKey);
          
          moduleItems.push({
            id: pageNumericId,
            title: page.title || 'Untitled Page',
            type: 'Page',
            name: page.title || 'Untitled Page', // Include name for compatibility
            position: itemPosition++,
            pageId: page.id,
            pageSlug: page.pageSlug,
            url: page.url,
          });
        }
        
        // Add files as items
        for (const file of weekModule.files) {
          // Extract numeric ID from file ID (handle "download_..." format)
          let fileNumericId = 0;
          if (typeof file.id === 'string') {
            // Try to extract number from "download_..." format
            const match = file.id.match(/(\d+)/);
            if (match) {
              fileNumericId = parseInt(match[1], 10);
            } else {
              // Use hash as fallback
              let hash = 0;
              for (let i = 0; i < file.id.length; i++) {
                const char = file.id.charCodeAt(i);
                hash = ((hash << 5) - hash) + char;
                hash = hash & hash;
              }
              fileNumericId = Math.abs(hash) || 1;
            }
          } else {
            fileNumericId = file.id || 0;
          }
          
          // Ensure we have a valid ID
          if (fileNumericId === 0) fileNumericId = 1;
          
          // Deduplicate: check if we've already added this file
          const fileKey = `${fileNumericId}|${file.filename || ''}|File`;
          if (seenItemKeys.has(fileKey)) {
            continue; // Skip duplicate
          }
          seenItemKeys.add(fileKey);
          
          moduleItems.push({
            id: fileNumericId,
            title: file.filename || 'Untitled File',
            type: 'File',
            name: file.filename || 'Untitled File', // Include name for compatibility
            position: itemPosition++,
            fileName: file.filename,
            storagePath: file.storagePath,
            storageBucket: file.storageBucket, // Include bucket name for file URL resolution
            size: file.size,
            mimeType: file.mimeType,
          });
        }
        
        // Only create module if it has items
        if (moduleItems.length === 0) continue;
        
        // Generate module ID from week
        const moduleId = weekModule.week 
          ? `week-${weekModule.week}-${courseId}` 
          : `other-content-${courseId}`;
        
        const moduleData = {
          moduleId: moduleId,
          name: weekModule.weekName,
          position: weekModule.position,
          courseId: courseId,
          items: moduleItems,
        };
        
        const metadata = {
          extractedWeek: weekModule.week,
          itemCount: moduleItems.length,
          pageCount: weekModule.pages.length,
          fileCount: weekModule.files.length,
          isWeekBased: true,
        };
        
        const { error } = await supabase.rpc('upsert_user_entity', {
          user_email: normalizedEmail,
          entity_type_val: 'module',
          entity_id_val: moduleId,
          data_val: moduleData,
          course_id_val: course.id.toString(),
          metadata_val: metadata
              });
            
            if (error) {
          console.error(`   ⚠️  Error creating week module ${weekModule.weekName}:`, error.message);
            } else {
          weekModuleCount++;
          console.log(`   ✅ Created module: ${weekModule.weekName} (${moduleItems.length} items: ${weekModule.pages.length} pages, ${weekModule.files.length} files)`);
          if (moduleItems.length > 0) {
            console.log(`      Sample items: ${moduleItems.slice(0, 3).map(i => `${i.title} (${i.type})`).join(', ')}`);
            }
          }
        }
      }
    console.log(`   ✅ Created ${weekModuleCount} week-based modules`);
    
    // Upload grades
    console.log('\n📊 Uploading grades...');
    if (summary.grades) {
      const { error } = await supabase.rpc('upsert_user_entity', {
        user_email: normalizedEmail,
        entity_type_val: 'grades',
        entity_id_val: '1',
        data_val: summary.grades,
        course_id_val: null,
        metadata_val: {}
        });
      
      if (error) {
        console.error(`   ⚠️  Error uploading grades:`, error.message);
      } else {
        console.log(`   ✅ Uploaded grades`);
      }
    }
    
    console.log('\n✅ Upload complete!');
    console.log(`\n📊 Summary:`);
    console.log(`   Courses: ${courses.length}`);
    console.log(`   Assignments: ${assignmentCount}`);
    console.log(`   Announcements: ${announcementCount}`);
    console.log(`   Modules (from moduleFiles): ${moduleCount}`);
    console.log(`   Modules (week-based): ${weekModuleCount}`);
    console.log(`   Pages: ${pageCount}`);
    console.log(`   Files (metadata): ${fileCount}`);
    console.log(`   Files (binary): ${uploadedFileCount} (${totalSizeMB} MB)`);
    console.log(`   Grades: ${summary.grades ? 'Yes' : 'No'}`);
    
  } catch (error) {
    console.error('❌ Error uploading extraction data:', error);
    process.exit(1);
  }
}

uploadExtractionData();

