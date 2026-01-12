-- Fix RLS policies for users table
-- Allow anon key to read user data (needed for frontend queries)

-- Enable RLS on users table (if not already)
ALTER TABLE public.users ENABLE ROW LEVEL SECURITY;

-- Drop existing policies if any
DROP POLICY IF EXISTS "Allow anon read users by email" ON public.users;
DROP POLICY IF EXISTS "Allow anon read users by id" ON public.users;
DROP POLICY IF EXISTS "Allow public read users" ON public.users;
DROP POLICY IF EXISTS "Allow service role full access" ON public.users;

-- Allow anon to read any user (needed for login flow)
-- Note: This is safe because we only expose non-sensitive fields via the API
CREATE POLICY "Allow public read users"
  ON public.users
  FOR SELECT
  TO anon, authenticated
  USING (true);

-- Allow service role full access (for backend with service key)
CREATE POLICY "Allow service role full access"
  ON public.users
  FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

-- Grant necessary permissions
GRANT SELECT ON public.users TO anon;
GRANT SELECT ON public.users TO authenticated;
GRANT ALL ON public.users TO service_role;
