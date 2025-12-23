-- ============================================
-- Ensure users and sessions tables exist
-- ============================================
-- This migration ensures the users and sessions tables exist
-- Run this in Supabase SQL Editor if you're seeing "Could not find the table 'public.users'" errors
-- ============================================

-- Create users table if it doesn't exist
CREATE TABLE IF NOT EXISTS public.users (
  id TEXT PRIMARY KEY,
  numeric_id INTEGER UNIQUE NOT NULL,
  email TEXT UNIQUE NOT NULL,
  name TEXT NOT NULL,
  avatar_url TEXT,
  profile_data JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Create index on numeric_id for faster lookups
CREATE INDEX IF NOT EXISTS idx_users_numeric_id ON public.users(numeric_id);

-- Create index on email for faster lookups
CREATE INDEX IF NOT EXISTS idx_users_email ON public.users(email);

-- Create sessions table if it doesn't exist
CREATE TABLE IF NOT EXISTS public.sessions (
  id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::TEXT,
  user_id INTEGER NOT NULL REFERENCES public.users(numeric_id) ON DELETE CASCADE,
  token TEXT NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Create index on user_id for faster lookups
CREATE INDEX IF NOT EXISTS idx_sessions_user_id ON public.sessions(user_id);

-- Create index on token for faster lookups
CREATE INDEX IF NOT EXISTS idx_sessions_token ON public.sessions(token);

-- Create function to update updated_at timestamp if it doesn't exist
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Create trigger to automatically update updated_at
DROP TRIGGER IF EXISTS update_users_updated_at ON public.users;
CREATE TRIGGER update_users_updated_at
  BEFORE UPDATE ON public.users
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

-- Enable Row Level Security (RLS)
ALTER TABLE public.users ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.sessions ENABLE ROW LEVEL SECURITY;

-- Drop existing policies if they exist (for idempotency)
DROP POLICY IF EXISTS "Allow all operations on users" ON public.users;
DROP POLICY IF EXISTS "Allow all operations on sessions" ON public.sessions;

-- Create policies for users table
-- Allow all operations for authenticated users (we'll use anon key for now)
CREATE POLICY "Allow all operations on users" ON public.users
  FOR ALL
  USING (true)
  WITH CHECK (true);

-- Create policies for sessions table
CREATE POLICY "Allow all operations on sessions" ON public.sessions
  FOR ALL
  USING (true)
  WITH CHECK (true);

-- Grant necessary permissions
GRANT ALL ON public.users TO anon, authenticated;
GRANT ALL ON public.sessions TO anon, authenticated;

-- ============================================
-- Migration Complete
-- ============================================





