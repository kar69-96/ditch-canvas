-- ============================================
-- Supabase Migration: Users and Sessions
-- ============================================
-- This migration creates the users and sessions tables
-- for email-based authentication and session management.
--
-- To apply: Copy this entire file and run it in Supabase SQL Editor
-- ============================================

-- Create users table
CREATE TABLE IF NOT EXISTS users (
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
CREATE INDEX IF NOT EXISTS idx_users_numeric_id ON users(numeric_id);

-- Create index on email for faster lookups
CREATE INDEX IF NOT EXISTS idx_users_email ON users(email);

-- Create sessions table
CREATE TABLE IF NOT EXISTS sessions (
  id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::TEXT,
  user_id INTEGER NOT NULL REFERENCES users(numeric_id) ON DELETE CASCADE,
  token TEXT NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Create index on user_id for faster lookups
CREATE INDEX IF NOT EXISTS idx_sessions_user_id ON sessions(user_id);

-- Create index on token for faster lookups
CREATE INDEX IF NOT EXISTS idx_sessions_token ON sessions(token);

-- Create function to update updated_at timestamp
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Create trigger to automatically update updated_at
DROP TRIGGER IF EXISTS update_users_updated_at ON users;
CREATE TRIGGER update_users_updated_at
  BEFORE UPDATE ON users
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

-- Enable Row Level Security (RLS)
ALTER TABLE users ENABLE ROW LEVEL SECURITY;
ALTER TABLE sessions ENABLE ROW LEVEL SECURITY;

-- Drop existing policies if they exist (for idempotency)
DROP POLICY IF EXISTS "Allow all operations on users" ON users;
DROP POLICY IF EXISTS "Allow all operations on sessions" ON sessions;

-- Create policies for users table
-- Allow all operations for authenticated users (we'll use anon key for now)
CREATE POLICY "Allow all operations on users" ON users
  FOR ALL
  USING (true)
  WITH CHECK (true);

-- Create policies for sessions table
CREATE POLICY "Allow all operations on sessions" ON sessions
  FOR ALL
  USING (true)
  WITH CHECK (true);

-- ============================================
-- Migration Complete
-- ============================================
-- Verify tables were created:
-- SELECT * FROM users;
-- SELECT * FROM sessions;
-- ============================================
