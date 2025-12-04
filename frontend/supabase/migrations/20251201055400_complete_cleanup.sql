-- Complete Cleanup: Delete ALL users and ALL user tables
-- This migration will clean up everything for a fresh start

-- Step 1: Delete all sessions (if table exists)
DO $$
BEGIN
  IF EXISTS (SELECT FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'sessions') THEN
    DELETE FROM public.sessions;
    RAISE NOTICE 'Deleted all sessions';
  END IF;
END $$;

-- Step 2: Delete ALL users first (if table exists)
DO $$
BEGIN
  IF EXISTS (SELECT FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'users') THEN
    DELETE FROM public.users;
    RAISE NOTICE 'Deleted all users';
  END IF;
END $$;

-- Step 3: Drop ALL user-specific tables
DO $$
DECLARE
  r RECORD;
  dropped_count INTEGER := 0;
BEGIN
  -- Get all tables that start with 'user_'
  FOR r IN 
    SELECT tablename 
    FROM pg_tables 
    WHERE schemaname = 'public' 
    AND tablename LIKE 'user_%'
    ORDER BY tablename
  LOOP
    EXECUTE format('DROP TABLE IF EXISTS %I CASCADE', r.tablename);
    dropped_count := dropped_count + 1;
    RAISE NOTICE 'Dropped table: %', r.tablename;
  END LOOP;
  
  RAISE NOTICE 'Total tables dropped: %', dropped_count;
END $$;

-- Step 4: Recreate users and sessions tables if they were dropped
-- (They might have been dropped if there were foreign key constraints)

-- Recreate users table
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

CREATE INDEX IF NOT EXISTS idx_users_numeric_id ON users(numeric_id);
CREATE INDEX IF NOT EXISTS idx_users_email ON users(email);

-- Recreate sessions table
CREATE TABLE IF NOT EXISTS sessions (
  id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::TEXT,
  user_id INTEGER NOT NULL REFERENCES users(numeric_id) ON DELETE CASCADE,
  token TEXT NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_sessions_user_id ON sessions(user_id);
CREATE INDEX IF NOT EXISTS idx_sessions_token ON sessions(token);

-- Recreate update_updated_at function
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Recreate trigger
DROP TRIGGER IF EXISTS update_users_updated_at ON users;
CREATE TRIGGER update_users_updated_at
  BEFORE UPDATE ON users
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

-- Re-enable RLS
ALTER TABLE users ENABLE ROW LEVEL SECURITY;
ALTER TABLE sessions ENABLE ROW LEVEL SECURITY;

-- Recreate policies
DROP POLICY IF EXISTS "Allow all operations on users" ON users;
CREATE POLICY "Allow all operations on users" ON users
  FOR ALL USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "Allow all operations on sessions" ON sessions;
CREATE POLICY "Allow all operations on sessions" ON sessions
  FOR ALL USING (true) WITH CHECK (true);

-- Step 5: Verify cleanup
DO $$
DECLARE
  user_count INTEGER;
  table_count INTEGER;
BEGIN
  SELECT COUNT(*) INTO user_count FROM public.users;
  SELECT COUNT(*) INTO table_count 
  FROM information_schema.tables 
  WHERE table_schema = 'public' 
  AND table_name LIKE 'user_%';
  
  RAISE NOTICE 'Cleanup complete. Users: %, User tables: %', user_count, table_count;
END $$;

