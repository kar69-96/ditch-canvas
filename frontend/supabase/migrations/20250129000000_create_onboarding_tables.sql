-- ============================================
-- Onboarding Flow - Create Waitlist and Invite Codes Tables
-- ============================================
-- This migration creates the waitlist and invite_codes tables
-- for managing user onboarding and invite code validation.
-- ============================================

-- Create waitlist table
CREATE TABLE IF NOT EXISTS waitlist (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  first_name TEXT NOT NULL,
  school TEXT NOT NULL,
  email TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(email)
);

-- Create index on email for faster lookups
CREATE INDEX IF NOT EXISTS idx_waitlist_email ON waitlist(email);

-- Create index on created_at for sorting
CREATE INDEX IF NOT EXISTS idx_waitlist_created_at ON waitlist(created_at DESC);

-- Create invite_codes table
CREATE TABLE IF NOT EXISTS invite_codes (
  code TEXT PRIMARY KEY, -- Uppercase code
  max_users INTEGER NOT NULL DEFAULT 0,
  current_users INTEGER NOT NULL DEFAULT 0,
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Create index on is_active for faster lookups
CREATE INDEX IF NOT EXISTS idx_invite_codes_is_active ON invite_codes(is_active);

-- Create trigger to automatically update updated_at for invite_codes
DROP TRIGGER IF EXISTS trg_invite_codes_updated_at ON invite_codes;
CREATE TRIGGER trg_invite_codes_updated_at
  BEFORE UPDATE ON invite_codes
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

-- ============================================
-- Migration Complete
-- ============================================

