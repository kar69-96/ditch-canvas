-- ============================================
-- Extraction Queue Tables
-- ============================================
-- This migration creates tables to track users waiting for initial
-- Canvas data extraction and completed extractions.
-- ============================================

-- Create pending_extractions table for users awaiting extraction
CREATE TABLE IF NOT EXISTS pending_extractions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_email TEXT NOT NULL UNIQUE,
  user_name TEXT NOT NULL,
  school TEXT NOT NULL,
  cookies JSONB NOT NULL, -- Canvas authentication cookies
  invite_code_used TEXT,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'in_progress', 'failed')),
  retry_count INTEGER NOT NULL DEFAULT 0,
  last_error TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  CONSTRAINT fk_invite_code FOREIGN KEY (invite_code_used) REFERENCES invite_codes(code)
);

-- Create completed_extractions table for tracking completed extractions
CREATE TABLE IF NOT EXISTS completed_extractions (
  id UUID PRIMARY KEY,
  user_email TEXT NOT NULL UNIQUE,
  user_name TEXT NOT NULL,
  school TEXT NOT NULL,
  cookies JSONB NOT NULL,
  invite_code_used TEXT,
  status TEXT NOT NULL DEFAULT 'completed' CHECK (status IN ('completed', 'partially_completed')),
  extraction_started_at TIMESTAMPTZ,
  extraction_completed_at TIMESTAMPTZ DEFAULT NOW(),
  extraction_duration_seconds INTEGER,
  extraction_metadata JSONB DEFAULT '{}', -- Stats like courses extracted, files downloaded, etc.
  created_at TIMESTAMPTZ NOT NULL, -- Original pending creation time
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  notes TEXT -- Manual notes about the extraction
);

-- Create indexes for pending_extractions
CREATE INDEX IF NOT EXISTS idx_pending_extractions_email ON pending_extractions(user_email);
CREATE INDEX IF NOT EXISTS idx_pending_extractions_status ON pending_extractions(status);
CREATE INDEX IF NOT EXISTS idx_pending_extractions_created_at ON pending_extractions(created_at ASC);

-- Create indexes for completed_extractions
CREATE INDEX IF NOT EXISTS idx_completed_extractions_email ON completed_extractions(user_email);
CREATE INDEX IF NOT EXISTS idx_completed_extractions_completed_at ON completed_extractions(extraction_completed_at DESC);

-- Create trigger to automatically update updated_at for pending_extractions
DROP TRIGGER IF EXISTS trg_pending_extractions_updated_at ON pending_extractions;
CREATE TRIGGER trg_pending_extractions_updated_at
  BEFORE UPDATE ON pending_extractions
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

-- Create trigger to automatically update updated_at for completed_extractions
DROP TRIGGER IF EXISTS trg_completed_extractions_updated_at ON completed_extractions;
CREATE TRIGGER trg_completed_extractions_updated_at
  BEFORE UPDATE ON completed_extractions
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

-- Enable Row Level Security (RLS)
ALTER TABLE pending_extractions ENABLE ROW LEVEL SECURITY;
ALTER TABLE completed_extractions ENABLE ROW LEVEL SECURITY;

-- Drop existing policies if they exist (for idempotency)
DROP POLICY IF EXISTS "Allow all operations on pending_extractions" ON pending_extractions;
DROP POLICY IF EXISTS "Allow all operations on completed_extractions" ON completed_extractions;

-- Create policies for pending_extractions table
CREATE POLICY "Allow all operations on pending_extractions" ON pending_extractions
  FOR ALL
  USING (true)
  WITH CHECK (true);

-- Create policies for completed_extractions table
CREATE POLICY "Allow all operations on completed_extractions" ON completed_extractions
  FOR ALL
  USING (true)
  WITH CHECK (true);

-- ============================================
-- Migration Complete
-- ============================================
-- To verify:
-- SELECT * FROM pending_extractions ORDER BY created_at ASC;
-- SELECT * FROM completed_extractions ORDER BY extraction_completed_at DESC;
-- ============================================
