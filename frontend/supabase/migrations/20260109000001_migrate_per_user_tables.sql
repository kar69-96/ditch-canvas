-- ============================================
-- Supabase Schema Consolidation - Phase 1.2
-- Data Migration from Per-User Tables
-- ============================================
-- This migration creates a function to migrate existing data
-- from user_{email}_data tables to the unified extraction_data table.
-- Preserves all existing user data.
-- ============================================

-- Function to migrate data from per-user tables to unified extraction_data
CREATE OR REPLACE FUNCTION migrate_user_data_to_unified()
RETURNS TABLE (migrated_users INTEGER, total_rows_migrated BIGINT) AS $$
DECLARE
  user_record RECORD;
  table_prefix TEXT;
  user_table TEXT;
  rows_for_user INTEGER;
  total_rows BIGINT := 0;
  users_count INTEGER := 0;
BEGIN
  RAISE NOTICE 'Starting migration of per-user tables to unified extraction_data...';

  -- Find all users with existing data
  FOR user_record IN
    SELECT DISTINCT email FROM users
    WHERE email IS NOT NULL
  LOOP
    -- Get table name for this user
    table_prefix := get_user_table_prefix(user_record.email);
    user_table := table_prefix || '_data';

    -- Check if user's table exists
    IF EXISTS (
      SELECT FROM information_schema.tables
      WHERE table_schema = 'public'
      AND table_name = user_table
    ) THEN
      -- Migrate data from user-specific table to unified table
      EXECUTE format('
        INSERT INTO extraction_data (
          user_email, entity_type, entity_id, course_id,
          data, metadata, file_storage_path, file_size, file_mime_type,
          organized_path, created_at, updated_at
        )
        SELECT
          %L as user_email,
          entity_type, entity_id, COALESCE(course_id, '''') as course_id,
          data, metadata, file_storage_path, file_size, file_mime_type,
          organized_path, created_at, updated_at
        FROM %I
        ON CONFLICT (user_email, entity_type, entity_id, course_id)
        DO UPDATE SET
          data = EXCLUDED.data,
          metadata = EXCLUDED.metadata,
          file_storage_path = COALESCE(EXCLUDED.file_storage_path, extraction_data.file_storage_path),
          file_size = COALESCE(EXCLUDED.file_size, extraction_data.file_size),
          file_mime_type = COALESCE(EXCLUDED.file_mime_type, extraction_data.file_mime_type),
          organized_path = COALESCE(EXCLUDED.organized_path, extraction_data.organized_path),
          updated_at = EXCLUDED.updated_at
      ', user_record.email, user_table);

      GET DIAGNOSTICS rows_for_user = ROW_COUNT;
      total_rows := total_rows + rows_for_user;
      users_count := users_count + 1;

      RAISE NOTICE 'Migrated % rows for user: %', rows_for_user, user_record.email;
    ELSE
      RAISE NOTICE 'No table found for user: % (table would be: %)', user_record.email, user_table;
    END IF;
  END LOOP;

  RAISE NOTICE 'Migration complete! Migrated % users with % total rows', users_count, total_rows;

  RETURN QUERY SELECT users_count, total_rows;
END;
$$ LANGUAGE plpgsql;

-- Grant execution to appropriate roles
GRANT EXECUTE ON FUNCTION migrate_user_data_to_unified() TO authenticated, anon;

-- ============================================
-- Migration Complete - Phase 1.2
-- ============================================
-- MANUAL STEP REQUIRED:
-- After applying this migration, run the following in Supabase SQL Editor:
--   SELECT * FROM migrate_user_data_to_unified();
--
-- Then verify data migration:
--   SELECT user_email, entity_type, count(*)
--   FROM extraction_data
--   GROUP BY user_email, entity_type
--   ORDER BY user_email, entity_type;
-- ============================================
