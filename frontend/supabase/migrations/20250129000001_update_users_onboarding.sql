-- ============================================
-- Onboarding Flow - Update Users Table
-- ============================================
-- This migration adds onboarding-related columns to the users table
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
-- Migration Complete
-- ============================================

