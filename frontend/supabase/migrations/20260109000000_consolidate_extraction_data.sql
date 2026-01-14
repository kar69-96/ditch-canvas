-- ============================================
-- Supabase Schema Consolidation - Phase 1
-- Unified Extraction Data Table
-- ============================================
-- This migration creates a single unified table to replace
-- the per-user user_{email}_data tables.
-- Simplifies schema, improves maintainability, better query performance.
-- ============================================

-- Create unified extraction_data table
CREATE TABLE IF NOT EXISTS extraction_data (
  id BIGSERIAL PRIMARY KEY,
  user_email TEXT NOT NULL,
  entity_type TEXT NOT NULL,
  entity_id TEXT NOT NULL,
  course_id TEXT,
  data JSONB NOT NULL DEFAULT '{}',
  metadata JSONB DEFAULT '{}',
  file_storage_path TEXT,
  file_size BIGINT,
  file_mime_type TEXT,
  organized_path TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(user_email, entity_type, entity_id, course_id),
  CONSTRAINT fk_user_email FOREIGN KEY (user_email) REFERENCES users(email) ON DELETE CASCADE
);

-- Create comprehensive indexes for query performance
CREATE INDEX IF NOT EXISTS idx_extraction_data_user_email ON extraction_data(user_email);
CREATE INDEX IF NOT EXISTS idx_extraction_data_entity_type ON extraction_data(entity_type);
CREATE INDEX IF NOT EXISTS idx_extraction_data_course_id ON extraction_data(course_id) WHERE course_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_extraction_data_entity_type_course ON extraction_data(user_email, entity_type, course_id) WHERE course_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_extraction_data_created_at ON extraction_data(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_extraction_data_entity_type_created ON extraction_data(user_email, entity_type, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_extraction_data_data_gin ON extraction_data USING GIN (data);
CREATE INDEX IF NOT EXISTS idx_extraction_data_metadata_gin ON extraction_data USING GIN (metadata);
CREATE INDEX IF NOT EXISTS idx_extraction_data_file_storage ON extraction_data(file_storage_path) WHERE file_storage_path IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_extraction_data_organized_path ON extraction_data(organized_path) WHERE organized_path IS NOT NULL;

-- Enable Row Level Security
ALTER TABLE extraction_data ENABLE ROW LEVEL SECURITY;

-- Drop existing policies if they exist
DROP POLICY IF EXISTS "Users can access own extraction data" ON extraction_data;

-- RLS Policy: Users can only access their own data
-- Note: Relies on app.current_user_email being set by application
CREATE POLICY "Users can access own extraction data" ON extraction_data
  FOR ALL
  USING (user_email = current_setting('app.current_user_email', true))
  WITH CHECK (user_email = current_setting('app.current_user_email', true));

-- Trigger for automatically updating updated_at timestamp
CREATE TRIGGER trg_extraction_data_updated_at
  BEFORE UPDATE ON extraction_data
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

-- ============================================
-- Migration Complete - Phase 1.1
-- ============================================
-- Next step: Run migration function to copy data from per-user tables
-- Then: Update RPC functions to use this unified table
-- ============================================
