-- Cleanup existing data and set up automatic table creation
-- This migration cleans up old shared tables and sets up triggers for auto-creating user tables

-- Drop old shared tables if they exist (from previous migration)
DROP TABLE IF EXISTS public.courses CASCADE;
DROP TABLE IF EXISTS public.assignments CASCADE;
DROP TABLE IF EXISTS public.announcements CASCADE;
DROP TABLE IF EXISTS public.modules CASCADE;
DROP TABLE IF EXISTS public.grades CASCADE;

-- Create a function that automatically creates user tables when a user is inserted
CREATE OR REPLACE FUNCTION auto_create_user_tables()
RETURNS TRIGGER AS $$
DECLARE
  table_prefix TEXT;
BEGIN
  -- Only create tables if user has an email
  IF NEW.email IS NOT NULL THEN
    -- Create tables for this user
    SELECT create_user_tables(NEW.email) INTO table_prefix;
    RAISE NOTICE 'Created tables for user % with prefix %', NEW.email, table_prefix;
  END IF;
  
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Create trigger to auto-create tables when user is created
DROP TRIGGER IF EXISTS trigger_auto_create_user_tables ON public.users;
CREATE TRIGGER trigger_auto_create_user_tables
  AFTER INSERT ON public.users
  FOR EACH ROW
  EXECUTE FUNCTION auto_create_user_tables();

-- Also create a function to manually create tables (useful for existing users)
CREATE OR REPLACE FUNCTION ensure_user_tables_exist(user_email TEXT)
RETURNS TEXT AS $$
DECLARE
  table_prefix TEXT;
  courses_table TEXT;
BEGIN
  -- Get table prefix
  table_prefix := get_user_table_prefix(user_email);
  courses_table := table_prefix || '_courses';
  
  -- Check if tables already exist
  IF EXISTS (
    SELECT 1 FROM information_schema.tables 
    WHERE table_schema = 'public' 
    AND table_name = courses_table
  ) THEN
    RAISE NOTICE 'Tables already exist for user %', user_email;
    RETURN table_prefix;
  END IF;
  
  -- Create tables
  SELECT create_user_tables(user_email) INTO table_prefix;
  RETURN table_prefix;
END;
$$ LANGUAGE plpgsql;

