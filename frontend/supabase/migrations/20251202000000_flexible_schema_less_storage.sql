-- ============================================
-- Flexible Schema-Less Storage Migration with File Support
-- ============================================
-- This migration drops all existing user-specific tables
-- and creates a flexible JSONB-based storage system
-- that can hold any type of information AND store actual files
-- ============================================

-- Step 1: Drop all existing user-specific tables and functions
DO $$
DECLARE
  r RECORD;
BEGIN
  -- Drop all tables that start with 'user_'
  FOR r IN 
    SELECT tablename 
    FROM pg_tables 
    WHERE schemaname = 'public' 
    AND tablename LIKE 'user_%'
  LOOP
    EXECUTE format('DROP TABLE IF EXISTS %I CASCADE', r.tablename);
    RAISE NOTICE 'Dropped table: %', r.tablename;
  END LOOP;
  
  -- Drop functions related to user tables
  DROP FUNCTION IF EXISTS create_user_tables(TEXT) CASCADE;
  DROP FUNCTION IF EXISTS get_user_table_prefix(TEXT) CASCADE;
  DROP FUNCTION IF EXISTS ensure_user_tables_exist(TEXT) CASCADE;
  
  RAISE NOTICE 'Cleaned up all user-specific tables and functions';
END $$;

-- Step 2: Create flexible storage tables
-- Each user gets a single "data" table that stores everything as JSONB

-- Helper function for updated_at trigger
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Function to get table name prefix from email
CREATE OR REPLACE FUNCTION get_user_table_prefix(user_email TEXT)
RETURNS TEXT AS $$
BEGIN
  RETURN 'user_' || replace(replace(lower(trim(user_email)), '@', '_at_'), '.', '_');
END;
$$ LANGUAGE plpgsql IMMUTABLE;

-- Function to create flexible user data table
-- SECURITY DEFINER allows this function to create tables even when called by anon role
CREATE OR REPLACE FUNCTION create_user_data_table(user_email TEXT)
RETURNS TEXT
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  table_prefix TEXT;
  data_table TEXT;
BEGIN
  table_prefix := get_user_table_prefix(user_email);
  data_table := table_prefix || '_data';
  
  -- Create a single flexible table for all course data
  EXECUTE format('
    CREATE TABLE IF NOT EXISTS %I (
      id SERIAL PRIMARY KEY,
      entity_type TEXT NOT NULL,  -- ''course'', ''file'', ''page'', ''module'', ''assignment'', etc.
      entity_id TEXT NOT NULL,    -- Original ID from extraction data
      course_id TEXT,              -- Optional: for grouping by course
      data JSONB NOT NULL DEFAULT ''{}''::jsonb,  -- All data stored here
      metadata JSONB DEFAULT ''{}''::jsonb,        -- Additional metadata
      file_storage_path TEXT,      -- Path to file in Supabase Storage (if entity is a file)
      file_size BIGINT,            -- File size in bytes
      file_mime_type TEXT,         -- MIME type of stored file
      created_at TIMESTAMPTZ DEFAULT NOW(),
      updated_at TIMESTAMPTZ DEFAULT NOW(),
      
      -- Unique constraint on entity_type + entity_id + course_id
      UNIQUE(entity_type, entity_id, course_id)
    )', data_table);
  
  -- Create indexes for common queries
  EXECUTE format('CREATE INDEX IF NOT EXISTS idx_%I_entity_type ON %I(entity_type)', 
    table_prefix, data_table);
  EXECUTE format('CREATE INDEX IF NOT EXISTS idx_%I_course_id ON %I(course_id)', 
    table_prefix, data_table);
  EXECUTE format('CREATE INDEX IF NOT EXISTS idx_%I_data_gin ON %I USING GIN(data)', 
    table_prefix, data_table);
  EXECUTE format('CREATE INDEX IF NOT EXISTS idx_%I_metadata_gin ON %I USING GIN(metadata)', 
    table_prefix, data_table);
  EXECUTE format('CREATE INDEX IF NOT EXISTS idx_%I_file_storage ON %I(file_storage_path) WHERE file_storage_path IS NOT NULL', 
    table_prefix, data_table);
  
  -- Create trigger for updated_at
  EXECUTE format('
    DROP TRIGGER IF EXISTS update_%I_updated_at ON %I;
    CREATE TRIGGER update_%I_updated_at
      BEFORE UPDATE ON %I
      FOR EACH ROW
      EXECUTE FUNCTION update_updated_at_column()
  ', table_prefix, data_table, table_prefix, data_table);
  
  RETURN data_table;
END;
$$ LANGUAGE plpgsql;

-- Function to automatically create user table when user is created
CREATE OR REPLACE FUNCTION auto_create_user_data_table()
RETURNS TRIGGER AS $$
BEGIN
  PERFORM create_user_data_table(NEW.email);
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Create trigger to auto-create data table when user is created
-- Only create trigger if users table exists
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'users') THEN
    DROP TRIGGER IF EXISTS trigger_auto_create_user_data_table ON users;
    EXECUTE 'CREATE TRIGGER trigger_auto_create_user_data_table
      AFTER INSERT ON users
      FOR EACH ROW
      EXECUTE FUNCTION auto_create_user_data_table()';
  END IF;
END $$;

-- Step 3: Create helper functions for flexible queries

-- Function to get all entities of a type for a user
CREATE OR REPLACE FUNCTION get_user_entities(
  user_email TEXT,
  entity_type_filter TEXT DEFAULT NULL,
  course_id_filter TEXT DEFAULT NULL
)
RETURNS TABLE (
  id INTEGER,
  entity_type TEXT,
  entity_id TEXT,
  course_id TEXT,
  data JSONB,
  metadata JSONB,
  file_storage_path TEXT,
  file_size BIGINT,
  file_mime_type TEXT,
  created_at TIMESTAMPTZ,
  updated_at TIMESTAMPTZ
) AS $$
DECLARE
  table_prefix TEXT;
  data_table TEXT;
BEGIN
  table_prefix := get_user_table_prefix(user_email);
  data_table := table_prefix || '_data';
  
  RETURN QUERY EXECUTE format('
    SELECT 
      t.id,
      t.entity_type,
      t.entity_id,
      t.course_id,
      t.data,
      t.metadata,
      t.file_storage_path,
      t.file_size,
      t.file_mime_type,
      t.created_at,
      t.updated_at
    FROM %I t
    WHERE ($1 IS NULL OR t.entity_type = $1)
      AND ($2 IS NULL OR t.course_id = $2)
    ORDER BY t.created_at DESC
  ', data_table) USING entity_type_filter, course_id_filter;
END;
$$ LANGUAGE plpgsql;

-- Function to upsert entity data (with optional file storage)
-- SECURITY DEFINER allows this function to create tables even when called by anon role
CREATE OR REPLACE FUNCTION upsert_user_entity(
  user_email TEXT,
  entity_type_val TEXT,
  entity_id_val TEXT,
  data_val JSONB,
  course_id_val TEXT DEFAULT NULL,
  metadata_val JSONB DEFAULT '{}'::jsonb,
  file_storage_path_val TEXT DEFAULT NULL,
  file_size_val BIGINT DEFAULT NULL,
  file_mime_type_val TEXT DEFAULT NULL
)
RETURNS INTEGER
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  table_prefix TEXT;
  data_table TEXT;
  result_id INTEGER;
BEGIN
  table_prefix := get_user_table_prefix(user_email);
  data_table := table_prefix || '_data';
  
  -- Ensure table exists
  PERFORM create_user_data_table(user_email);
  
  -- Upsert the entity
  EXECUTE format('
    INSERT INTO %I (entity_type, entity_id, course_id, data, metadata, file_storage_path, file_size, file_mime_type)
    VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
    ON CONFLICT (entity_type, entity_id, course_id)
    DO UPDATE SET
      data = EXCLUDED.data,
      metadata = EXCLUDED.metadata,
      file_storage_path = COALESCE(EXCLUDED.file_storage_path, %I.file_storage_path),
      file_size = COALESCE(EXCLUDED.file_size, %I.file_size),
      file_mime_type = COALESCE(EXCLUDED.file_mime_type, %I.file_mime_type),
      updated_at = NOW()
    RETURNING id
  ', data_table, data_table, data_table, data_table) 
  INTO result_id
  USING entity_type_val, entity_id_val, course_id_val, data_val, metadata_val, 
        file_storage_path_val, file_size_val, file_mime_type_val;
  
  RETURN result_id;
END;
$$ LANGUAGE plpgsql;

-- Function to get file storage path for an entity
CREATE OR REPLACE FUNCTION get_file_storage_path(
  user_email TEXT,
  entity_type_val TEXT,
  entity_id_val TEXT,
  course_id_val TEXT DEFAULT NULL
)
RETURNS TEXT AS $$
DECLARE
  table_prefix TEXT;
  data_table TEXT;
  storage_path TEXT;
BEGIN
  table_prefix := get_user_table_prefix(user_email);
  data_table := table_prefix || '_data';
  
  EXECUTE format('
    SELECT file_storage_path 
    FROM %I 
    WHERE entity_type = $1 
      AND entity_id = $2 
      AND ($3 IS NULL OR course_id = $3)
    LIMIT 1
  ', data_table) 
  INTO storage_path
  USING entity_type_val, entity_id_val, course_id_val;
  
  RETURN storage_path;
END;
$$ LANGUAGE plpgsql;

-- Step 4: Helper function to generate file storage path
CREATE OR REPLACE FUNCTION generate_file_storage_path(
  user_email TEXT,
  course_id_val TEXT,
  entity_id_val TEXT,
  filename TEXT
)
RETURNS TEXT AS $$
DECLARE
  table_prefix TEXT;
  storage_path TEXT;
BEGIN
  table_prefix := get_user_table_prefix(user_email);
  
  -- Generate path: user_{email}/courses/{course_id}/files/{entity_id}/{filename}
  storage_path := table_prefix || '/courses/' || 
                  COALESCE(course_id_val, 'uncategorized') || 
                  '/files/' || entity_id_val || '/' || filename;
  
  RETURN storage_path;
END;
$$ LANGUAGE plpgsql;

-- Step 5: Create indexes on JSONB fields for common queries
CREATE OR REPLACE FUNCTION create_jsonb_index(
  user_email TEXT,
  jsonb_path TEXT,
  index_name TEXT
)
RETURNS VOID AS $$
DECLARE
  table_prefix TEXT;
  data_table TEXT;
BEGIN
  table_prefix := get_user_table_prefix(user_email);
  data_table := table_prefix || '_data';
  
  EXECUTE format('
    CREATE INDEX IF NOT EXISTS %I ON %I USING GIN ((data->%L))
  ', index_name, data_table, jsonb_path);
END;
$$ LANGUAGE plpgsql;

-- ============================================
-- Migration Complete
-- ============================================
-- The new system:
-- 1. Stores ALL data in JSONB format - no rigid schemas
-- 2. Single table per user: user_{email}_data
-- 3. Can store any structure from extraction data
-- 4. Supports file storage via Supabase Storage
-- 5. File references stored in file_storage_path column
-- 6. Indexed for fast queries
-- 7. Auto-creates when user is created
-- ============================================
-- 
-- Next Steps:
-- 1. Create storage bucket 'user-files' via Dashboard
-- 2. Set bucket file_size_limit to NULL or very high value
-- 3. Configure RLS policies for file access
-- ============================================

