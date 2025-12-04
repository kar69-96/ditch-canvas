# Flexible Schema-Less Storage Setup Guide

## Overview

The Supabase storage system has been completely redesigned to use a flexible, schema-less JSONB-based approach that can store any type of information without rigid table requirements. It also supports storing actual files (binary data) in Supabase Storage.

## What Changed

### 1. **Flexible Storage System**
- **Before**: Multiple rigid tables per user (courses, assignments, modules, etc.)
- **After**: Single flexible table per user (`user_{email}_data`) that stores everything as JSONB
- **Benefits**: 
  - Can store any structure from extraction data
  - No schema changes needed for new data types
  - All original data preserved in JSONB format

### 2. **File Storage Support**
- Files from `downloads/` folders are now uploaded to Supabase Storage
- File metadata stored in flexible table with storage path references
- Supports files up to 1GB (configurable)

### 3. **Enhanced Metadata Extraction**
- Automatically extracts week numbers, chapters, content types from filenames
- Stores extracted metadata for better categorization
- Preserves all original extraction data

## Setup Instructions

### Step 1: Apply Migration

Run the new migration to set up the flexible storage system:

```bash
# Option 1: Via Supabase CLI
supabase db reset

# Option 2: Via SQL Editor
# Copy and paste the contents of:
# supabase/migrations/20251202000000_flexible_schema_less_storage.sql
# into Supabase Dashboard → SQL Editor → Run
```

This migration will:
- ✅ Drop all old user-specific tables
- ✅ Create new flexible storage tables
- ✅ Set up helper functions for queries
- ✅ Configure auto-creation of user tables

### Step 2: Create Storage Bucket

Create a storage bucket for file uploads:

**Via Supabase Dashboard:**
1. Go to **Storage** → **Buckets**
2. Click **New bucket**
3. Settings:
   - **Name**: `user-files`
   - **Public**: `false` (Private)
   - **File size limit**: Leave empty or set to `1073741824` (1GB)
   - **Allowed MIME types**: Leave empty (all types allowed)

**Via SQL (if you have admin access):**
```sql
-- Note: Storage buckets are typically created via Dashboard
-- This is for reference only
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'user-files',
  'user-files',
  false,
  NULL,  -- NULL = no limit (or 1073741824 for 1GB)
  NULL   -- NULL = all MIME types
)
ON CONFLICT (id) DO UPDATE
SET file_size_limit = NULL,
    allowed_mime_types = NULL;
```

### Step 3: Set Up RLS Policies

Create Row Level Security policies for file access:

```sql
-- Allow users to upload their own files
CREATE POLICY "Users can upload to user-files"
ON storage.objects FOR INSERT
WITH CHECK (
  bucket_id = 'user-files' AND
  (storage.foldername(name))[1] = 'user_' || replace(replace(lower(auth.email()), '@', '_at_'), '.', '_')
);

-- Allow users to read their own files
CREATE POLICY "Users can read their own files"
ON storage.objects FOR SELECT
USING (
  bucket_id = 'user-files' AND
  (storage.foldername(name))[1] = 'user_' || replace(replace(lower(auth.email()), '@', '_at_'), '.', '_')
);

-- Allow users to delete their own files
CREATE POLICY "Users can delete their own files"
ON storage.objects FOR DELETE
USING (
  bucket_id = 'user-files' AND
  (storage.foldername(name))[1] = 'user_' || replace(replace(lower(auth.email()), '@', '_at_'), '.', '_')
);
```

### Step 4: Upload Data

Upload your extraction data using the new flexible system:

```bash
# Upload data for a user
node supabase/upload-extraction-data.js kare6625@colorado.edu sample_data

# The script will:
# 1. Upload all course data (courses, assignments, announcements, etc.)
# 2. Process modules from moduleFiles arrays
# 3. Upload actual files from downloads/ folders to Supabase Storage
# 4. Store all metadata with extracted categorization
```

## Data Structure

### Entity Types

The flexible storage system uses these entity types:

- `course` - Course information
- `assignment` - Assignments
- `announcement` - Announcements
- `module` - Course modules (with items array)
- `page` - Course pages
- `file` - File metadata
- `file_binary` - Actual binary files in storage
- `grades` - User grades

### Storage Structure

Each entity is stored with:
- `entity_type` - Type of entity
- `entity_id` - Unique identifier
- `course_id` - Course association (if applicable)
- `data` - All original data as JSONB
- `metadata` - Extracted metadata (week, chapter, content type, etc.)
- `file_storage_path` - Path in Supabase Storage (for files)
- `file_size` - File size in bytes
- `file_mime_type` - MIME type

### File Storage Paths

Files are stored with this structure:
```
user_{email}/courses/{course_id}/files/{entity_id}/{filename}
```

Example:
```
user_kare6625_at_colorado_edu/courses/123236/files/download_modules_Week_2_file.pdf
```

## Querying Data

### Using Helper Functions

```sql
-- Get all entities for a user
SELECT * FROM get_user_entities('user@example.com');

-- Get all files for a course
SELECT * FROM get_user_entities('user@example.com', 'file', '123236');

-- Get all modules
SELECT * FROM get_user_entities('user@example.com', 'module');
```

### In Application Code

The data loader (`supabaseDataLoader.ts`) automatically:
- Queries all entities using `get_user_entities`
- Transforms JSONB data to app format
- Handles file storage paths
- Generates signed URLs for private files

## File Access

### Getting File URLs

Files stored in Supabase Storage require signed URLs for private access:

```typescript
import { getFileSignedUrl } from '@/services/api/supabaseDataLoader';

// Get signed URL (valid for 1 hour by default)
const fileUrl = await getFileSignedUrl(userEmail, storagePath, 3600);
```

### File Size Limits

- **Local Development**: 1GB (1024MiB) - set in `supabase/config.toml`
- **Production**: Configure in Supabase Dashboard → Storage → Buckets
- **Recommended**: 500MB - 1GB for course files

## Benefits

1. **Flexibility**: Store any data structure without schema changes
2. **Completeness**: All original extraction data preserved
3. **File Support**: Actual files stored, not just metadata
4. **Categorization**: Automatic extraction of week, chapter, content type
5. **Scalability**: Easy to add new entity types
6. **Performance**: GIN indexes on JSONB for fast queries

## Migration Notes

⚠️ **Important**: The new migration drops all existing user-specific tables. Make sure to:
1. Backup your data if needed
2. Re-upload all data after migration
3. The old table structure is completely replaced

## Troubleshooting

### Files not uploading
- Check storage bucket exists: `user-files`
- Verify bucket file size limit is high enough
- Check RLS policies are set correctly
- Ensure service role key is used for uploads

### Modules not displaying
- Check that modules are being processed from `moduleFiles` arrays
- Verify module items are being parsed correctly
- Check console logs for parsing warnings

### File access errors
- Verify signed URL generation
- Check RLS policies allow user access
- Ensure file_storage_path is set correctly

## Next Steps

1. ✅ Run migration
2. ✅ Create storage bucket
3. ✅ Set up RLS policies
4. ✅ Upload data
5. ✅ Test file access
6. ✅ Verify modules display correctly


