-- Migration: Add organized_path column and index for file organization
-- This migration adds support for organized file paths in the flexible schema

-- Function to add organized_path column to user data table if it doesn't exist
CREATE OR REPLACE FUNCTION add_organized_path_column(user_email TEXT)
RETURNS VOID AS $$
DECLARE
  table_prefix TEXT;
  data_table TEXT;
BEGIN
  table_prefix := get_user_table_prefix(user_email);
  data_table := table_prefix || '_data';
  
  -- Add organized_path column if it doesn't exist
  EXECUTE format('
    DO $$
    BEGIN
      IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_schema = ''public'' 
        AND table_name = %L 
        AND column_name = ''organized_path''
      ) THEN
        ALTER TABLE %I ADD COLUMN organized_path TEXT;
      END IF;
    END $$;
  ', data_table, data_table);
  
  -- Create index on organized_path for efficient queries
  EXECUTE format('
    CREATE INDEX IF NOT EXISTS idx_%I_organized_path ON %I(organized_path) WHERE organized_path IS NOT NULL
  ', table_prefix, data_table);
  
  -- Create GIN index on metadata->organizedPath for JSONB queries
  EXECUTE format('
    CREATE INDEX IF NOT EXISTS idx_%I_metadata_organized_path ON %I USING GIN ((metadata->''organizedPath'')) WHERE (metadata->''organizedPath'') IS NOT NULL
  ', table_prefix, data_table);
END;
$$ LANGUAGE plpgsql;

-- Function to update organized_path from metadata
CREATE OR REPLACE FUNCTION update_organized_path_from_metadata(user_email TEXT)
RETURNS INTEGER AS $$
DECLARE
  table_prefix TEXT;
  data_table TEXT;
  updated_count INTEGER;
BEGIN
  table_prefix := get_user_table_prefix(user_email);
  data_table := table_prefix || '_data';
  
  -- Update organized_path from metadata for files that don't have it set
  EXECUTE format('
    UPDATE %I 
    SET organized_path = metadata->>''organizedPath''
    WHERE entity_type = ''file'' 
      AND (organized_path IS NULL OR organized_path = '''')
      AND metadata->>''organizedPath'' IS NOT NULL
      AND metadata->>''organizedPath'' != ''''
  ', data_table);
  
  GET DIAGNOSTICS updated_count = ROW_COUNT;
  RETURN updated_count;
END;
$$ LANGUAGE plpgsql;

-- Function to get files by organized path
CREATE OR REPLACE FUNCTION get_files_by_organized_path(
  user_email TEXT,
  course_id_filter TEXT DEFAULT NULL,
  path_prefix TEXT DEFAULT NULL
)
RETURNS TABLE (
  id INTEGER,
  entity_id TEXT,
  course_id TEXT,
  file_name TEXT,
  organized_path TEXT,
  storage_path TEXT,
  metadata JSONB
) AS $$
DECLARE
  table_prefix TEXT;
  data_table TEXT;
BEGIN
  table_prefix := get_user_table_prefix(user_email);
  data_table := table_prefix || '_data';
  
  EXECUTE format('
    SELECT 
      d.id,
      d.entity_id,
      d.course_id,
      d.data->>''name'' as file_name,
      COALESCE(d.organized_path, d.metadata->>''organizedPath'') as organized_path,
      d.file_storage_path as storage_path,
      d.metadata
    FROM %I d
    WHERE d.entity_type = ''file''
      AND (d.organized_path IS NOT NULL OR d.metadata->>''organizedPath'' IS NOT NULL)
      AND ($1 IS NULL OR d.course_id = $1)
      AND ($2 IS NULL OR COALESCE(d.organized_path, d.metadata->>''organizedPath'') LIKE $2 || ''%%'')
    ORDER BY COALESCE(d.organized_path, d.metadata->>''organizedPath''), d.data->>''name''
  ', data_table) USING course_id_filter, path_prefix;
END;
$$ LANGUAGE plpgsql;

-- Grant permissions
GRANT EXECUTE ON FUNCTION add_organized_path_column(TEXT) TO authenticated, anon;
GRANT EXECUTE ON FUNCTION update_organized_path_from_metadata(TEXT) TO authenticated, anon;
GRANT EXECUTE ON FUNCTION get_files_by_organized_path(TEXT, TEXT, TEXT) TO authenticated, anon;

-- Note: This migration adds the column structure but doesn't automatically
-- add it to existing user tables. Run add_organized_path_column() for each user
-- or update existing data using update_organized_path_from_metadata()

