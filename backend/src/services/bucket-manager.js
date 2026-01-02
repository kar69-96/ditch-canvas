/**
 * Bucket Management Service
 * Manages Supabase Storage buckets for organized file storage
 */

const { createClient } = require('@supabase/supabase-js');

/**
 * Get Supabase client
 */
function getSupabaseClient() {
  const supabaseUrl = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
  const supabaseKey = process.env.SUPABASE_SERVICE_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY;
  
  if (!supabaseUrl || !supabaseKey) {
    throw new Error('Supabase URL and Service Key must be set in environment variables');
  }
  
  return createClient(supabaseUrl, supabaseKey);
}

/**
 * Normalize email for bucket name
 */
function normalizeEmailForBucket(email) {
  return email.toLowerCase().trim().replace(/[^a-z0-9]/g, '_');
}

/**
 * Get user bucket name
 */
function getUserBucketName(userEmail) {
  const normalized = normalizeEmailForBucket(userEmail);
  return `user_${normalized}`;
}

/**
 * Ensure user bucket exists
 */
async function ensureUserBucket(userEmail) {
  const supabase = getSupabaseClient();
  const bucketName = getUserBucketName(userEmail);
  
  try {
    // Check if bucket exists
    const { data: buckets, error: listError } = await supabase.storage.listBuckets();
    
    if (listError) {
      throw new Error(`Failed to list buckets: ${listError.message}`);
    }
    
    const bucketExists = buckets.some(b => b.name === bucketName);
    
    if (bucketExists) {
      return { exists: true, bucketName };
    }
    
    // Create bucket
    const { data: bucket, error: createError } = await supabase.storage.createBucket(bucketName, {
      public: false,
      fileSizeLimit: null, // No limit
      allowedMimeTypes: null, // Allow all types
    });
    
    if (createError) {
      throw new Error(`Failed to create bucket: ${createError.message}`);
    }
    
    return { exists: false, created: true, bucketName };
  } catch (error) {
    console.error(`Error ensuring bucket for ${userEmail}:`, error);
    throw error;
  }
}

/**
 * Create organized folder structure in bucket
 * This ensures the folder structure exists (Supabase Storage creates folders automatically on upload)
 */
async function ensureOrganizedFolders(userEmail, courseId, organizedPath) {
  const supabase = getSupabaseClient();
  const bucketName = getUserBucketName(userEmail);
  
  // Supabase Storage creates folders automatically when files are uploaded
  // This function is mainly for validation/preparation
  const fullPath = `courses/${courseId}/organized/${organizedPath}`;
  
  return {
    bucketName,
    organizedPath: fullPath,
  };
}

/**
 * List files in organized structure
 */
async function listOrganizedFiles(userEmail, courseId, pathPrefix = '') {
  const supabase = getSupabaseClient();
  const bucketName = getUserBucketName(userEmail);
  
  const searchPath = pathPrefix 
    ? `courses/${courseId}/organized/${pathPrefix}`
    : `courses/${courseId}/organized`;
  
  const { data, error } = await supabase.storage
    .from(bucketName)
    .list(searchPath, {
      limit: 1000,
      offset: 0,
      sortBy: { column: 'name', order: 'asc' },
    });
  
  if (error) {
    throw new Error(`Failed to list files: ${error.message}`);
  }
  
  return data || [];
}

/**
 * Get file structure tree
 */
async function getFileStructureTree(userEmail, courseId) {
  const supabase = getSupabaseClient();
  const bucketName = getUserBucketName(userEmail);
  
  const basePath = `courses/${courseId}/organized`;
  
  // List all files in organized structure
  const { data: files, error } = await supabase.storage
    .from(bucketName)
    .list(basePath, {
      limit: 10000,
      offset: 0,
      sortBy: { column: 'name', order: 'asc' },
    });
  
  if (error) {
    throw new Error(`Failed to list files: ${error.message}`);
  }
  
  // Build tree structure
  const tree = {};
  
  (files || []).forEach(file => {
    const pathParts = file.name.split('/');
    let current = tree;
    
    for (let i = 0; i < pathParts.length; i++) {
      const part = pathParts[i];
      if (!current[part]) {
        current[part] = i === pathParts.length - 1 
          ? { type: 'file', ...file }
          : { type: 'folder', children: {} };
      }
      if (i < pathParts.length - 1) {
        current = current[part].children;
      }
    }
  });
  
  return tree;
}

module.exports = {
  getSupabaseClient,
  getUserBucketName,
  ensureUserBucket,
  ensureOrganizedFolders,
  listOrganizedFiles,
  getFileStructureTree,
  normalizeEmailForBucket,
};




