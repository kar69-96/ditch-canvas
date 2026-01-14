-- ============================================
-- Supabase Schema Consolidation - Phase 1.3
-- Update RPC Functions for Unified Table
-- ============================================
-- This migration updates get_user_entities and upsert_user_entity
-- to query/update the unified extraction_data table instead of
-- per-user tables.
-- ============================================

-- Drop existing functions first (they have different return types)
DROP FUNCTION IF EXISTS get_user_entities(TEXT, TEXT, TEXT);
DROP FUNCTION IF EXISTS upsert_user_entity(TEXT, TEXT, TEXT, TEXT, JSONB, JSONB, TEXT, BIGINT, TEXT);

-- Replace get_user_entities to query unified table
CREATE OR REPLACE FUNCTION get_user_entities(
  user_email TEXT,
  entity_type_filter TEXT DEFAULT NULL,
  course_id_filter TEXT DEFAULT NULL
)
RETURNS TABLE (
  id BIGINT,
  entity_type TEXT,
  entity_id TEXT,
  course_id TEXT,
  data JSONB,
  metadata JSONB,
  file_storage_path TEXT,
  file_size BIGINT,
  file_mime_type TEXT,
  organized_path TEXT,
  created_at TIMESTAMPTZ,
  updated_at TIMESTAMPTZ
) AS $$
BEGIN
  RETURN QUERY
  SELECT
    ed.id, ed.entity_type, ed.entity_id, ed.course_id,
    ed.data, ed.metadata, ed.file_storage_path, ed.file_size,
    ed.file_mime_type, ed.organized_path, ed.created_at, ed.updated_at
  FROM extraction_data ed
  WHERE ed.user_email = get_user_entities.user_email
    AND (entity_type_filter IS NULL OR ed.entity_type = entity_type_filter)
    AND (course_id_filter IS NULL OR ed.course_id = course_id_filter)
  ORDER BY ed.created_at DESC
  LIMIT 50000;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Replace upsert_user_entity to use unified table
CREATE OR REPLACE FUNCTION upsert_user_entity(
  user_email TEXT,
  entity_type TEXT,
  entity_id TEXT,
  course_id TEXT,
  entity_data JSONB,
  entity_metadata JSONB DEFAULT NULL,
  file_path TEXT DEFAULT NULL,
  file_size_bytes BIGINT DEFAULT NULL,
  mime_type TEXT DEFAULT NULL
)
RETURNS BIGINT AS $$
DECLARE
  result_id BIGINT;
BEGIN
  INSERT INTO extraction_data (
    user_email, entity_type, entity_id, course_id,
    data, metadata, file_storage_path, file_size, file_mime_type
  )
  VALUES (
    user_email, entity_type, entity_id, COALESCE(course_id, ''),
    entity_data, COALESCE(entity_metadata, '{}'::jsonb), file_path, file_size_bytes, mime_type
  )
  ON CONFLICT (user_email, entity_type, entity_id, course_id)
  DO UPDATE SET
    data = EXCLUDED.data,
    metadata = EXCLUDED.metadata,
    file_storage_path = COALESCE(EXCLUDED.file_storage_path, extraction_data.file_storage_path),
    file_size = COALESCE(EXCLUDED.file_size, extraction_data.file_size),
    file_mime_type = COALESCE(EXCLUDED.file_mime_type, extraction_data.file_mime_type),
    updated_at = NOW()
  RETURNING id INTO result_id;

  RETURN result_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Grant permissions to appropriate roles
GRANT EXECUTE ON FUNCTION get_user_entities(TEXT, TEXT, TEXT) TO authenticated, anon;
GRANT EXECUTE ON FUNCTION upsert_user_entity(TEXT, TEXT, TEXT, TEXT, JSONB, JSONB, TEXT, BIGINT, TEXT) TO authenticated, anon;

-- ============================================
-- Migration Complete - Phase 1.3
-- ============================================
-- RPC functions now point to unified extraction_data table.
-- Application code (frontend/backend) can continue using these
-- functions without changes.
-- ============================================
