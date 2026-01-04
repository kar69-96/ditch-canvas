-- ============================================
-- Add phone_number column to users table
-- ============================================
-- This migration adds a phone_number column to the users table
-- for storing user phone numbers for the Assistant feature
-- ============================================

-- Add phone_number column if it doesn't exist
ALTER TABLE public.users 
ADD COLUMN IF NOT EXISTS phone_number TEXT;

-- Create index on phone_number for faster lookups (optional, but useful if we query by phone)
CREATE INDEX IF NOT EXISTS idx_users_phone_number ON public.users(phone_number) WHERE phone_number IS NOT NULL;

-- ============================================
-- Migration Complete
-- ============================================

