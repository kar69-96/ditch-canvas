-- ============================================
-- Onboarding Flow - Complete Setup
-- ============================================
-- Run this SQL in your Supabase SQL Editor to set up
-- the onboarding tables and update the users table
-- ============================================

-- Step 1: Create waitlist and invite_codes tables
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

-- Ensure update_updated_at_column function exists
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Create trigger to automatically update updated_at for invite_codes
DROP TRIGGER IF EXISTS trg_invite_codes_updated_at ON invite_codes;
CREATE TRIGGER trg_invite_codes_updated_at
  BEFORE UPDATE ON invite_codes
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

-- Step 2: Update users table with onboarding columns
-- ============================================

-- Add school column
ALTER TABLE users 
ADD COLUMN IF NOT EXISTS school TEXT;

-- Add cookies column (JSONB to store cookie data from Canvas extraction)
ALTER TABLE users 
ADD COLUMN IF NOT EXISTS cookies JSONB;

-- Add invite_code_used column (references invite_codes.code)
ALTER TABLE users 
ADD COLUMN IF NOT EXISTS invite_code_used TEXT;

-- Add onboarding_completed_at column
ALTER TABLE users 
ADD COLUMN IF NOT EXISTS onboarding_completed_at TIMESTAMPTZ;

-- Create index on school for faster lookups
CREATE INDEX IF NOT EXISTS idx_users_school ON users(school);

-- Create index on invite_code_used for faster lookups
CREATE INDEX IF NOT EXISTS idx_users_invite_code_used ON users(invite_code_used);

-- ============================================
-- Migration Complete!
-- ============================================
-- You can now add invite codes using:
--   node scripts/utils/add-invite-code.js <CODE> <MAX_USERS>
-- ============================================

