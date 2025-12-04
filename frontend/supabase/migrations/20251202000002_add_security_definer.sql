-- Update functions to use SECURITY DEFINER so they can create tables
-- This allows anon role to call these functions and create tables

-- Update create_user_data_table function
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
      entity_type TEXT NOT NULL,
      entity_id TEXT NOT NULL,
      course_id TEXT,
      data JSONB NOT NULL DEFAULT ''{}''::jsonb,
      metadata JSONB DEFAULT ''{}''::jsonb,
      file_storage_path TEXT,
      file_size BIGINT,
      file_mime_type TEXT,
      created_at TIMESTAMPTZ DEFAULT NOW(),
      updated_at TIMESTAMPTZ DEFAULT NOW(),
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

-- Update upsert_user_entity function
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


