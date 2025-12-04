-- ============================================
-- Optimize entity queries for better performance
-- ============================================
-- This migration:
-- 1. Adds created_at index to table creation function
-- 2. Adds composite indexes for common query patterns
-- 3. Optimizes get_user_entities function
-- ============================================

-- Update the create_user_data_table function to include created_at index
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
  EXECUTE format('CREATE INDEX IF NOT EXISTS idx_%I_course_id ON %I(course_id) WHERE course_id IS NOT NULL', 
    table_prefix, data_table);
  
  -- Composite index for entity_type + course_id queries (very common pattern)
  EXECUTE format('CREATE INDEX IF NOT EXISTS idx_%I_entity_type_course ON %I(entity_type, course_id) WHERE course_id IS NOT NULL', 
    table_prefix, data_table);
  
  -- Index for created_at (used in ORDER BY)
  EXECUTE format('CREATE INDEX IF NOT EXISTS idx_%I_created_at ON %I(created_at DESC)', 
    table_prefix, data_table);
  
  -- Composite index for entity_type + created_at (for filtered and sorted queries)
  EXECUTE format('CREATE INDEX IF NOT EXISTS idx_%I_entity_type_created ON %I(entity_type, created_at DESC)', 
    table_prefix, data_table);
  
  -- GIN indexes for JSONB queries
  EXECUTE format('CREATE INDEX IF NOT EXISTS idx_%I_data_gin ON %I USING GIN(data)', 
    table_prefix, data_table);
  EXECUTE format('CREATE INDEX IF NOT EXISTS idx_%I_metadata_gin ON %I USING GIN(metadata)', 
    table_prefix, data_table);
  
  -- Index for file storage path
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

-- Optimize get_user_entities function
-- Add a reasonable limit and improve query structure
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
  
  -- Optimized query that leverages indexes better
  -- Using a reasonable limit to prevent loading too much data at once
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
    LIMIT 50000
  ', data_table) USING entity_type_filter, course_id_filter;
END;
$$ LANGUAGE plpgsql;

-- Add indexes to existing tables (for tables that were created before this migration)
-- This is a one-time operation that will attempt to add indexes to existing user tables
DO $$
DECLARE
  r RECORD;
  table_prefix TEXT;
BEGIN
  -- Find all user data tables
  FOR r IN 
    SELECT tablename 
    FROM pg_tables 
    WHERE schemaname = 'public' 
    AND tablename LIKE 'user_%_data'
  LOOP
    table_prefix := substring(r.tablename from '^(user_.+?)_data$');
    
    -- Add created_at index if it doesn't exist
    BEGIN
      EXECUTE format('CREATE INDEX IF NOT EXISTS idx_%I_created_at ON %I(created_at DESC)', 
        table_prefix, r.tablename);
    EXCEPTION WHEN OTHERS THEN
      RAISE NOTICE 'Could not create created_at index on %: %', r.tablename, SQLERRM;
    END;
    
    -- Add composite index for entity_type + created_at
    BEGIN
      EXECUTE format('CREATE INDEX IF NOT EXISTS idx_%I_entity_type_created ON %I(entity_type, created_at DESC)', 
        table_prefix, r.tablename);
    EXCEPTION WHEN OTHERS THEN
      RAISE NOTICE 'Could not create entity_type_created index on %: %', r.tablename, SQLERRM;
    END;
    
    -- Add composite index for entity_type + course_id
    BEGIN
      EXECUTE format('CREATE INDEX IF NOT EXISTS idx_%I_entity_type_course ON %I(entity_type, course_id) WHERE course_id IS NOT NULL', 
        table_prefix, r.tablename);
    EXCEPTION WHEN OTHERS THEN
      RAISE NOTICE 'Could not create entity_type_course index on %: %', r.tablename, SQLERRM;
    END;
    
    RAISE NOTICE 'Added indexes to existing table: %', r.tablename;
  END LOOP;
END $$;

