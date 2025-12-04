-- Cleanup: Delete all users and tables except kare6625@colorado.edu
-- This will remove all existing data and keep only the specified user

-- Function to drop all user tables for a given email
CREATE OR REPLACE FUNCTION drop_user_tables(user_email TEXT)
RETURNS void AS $$
DECLARE
  table_prefix TEXT;
  table_name TEXT;
  tables_to_drop TEXT[] := ARRAY[
    'courses',
    'assignments',
    'announcements',
    'modules',
    'pages',
    'quizzes',
    'syllabus',
    'discussions',
    'files',
    'grades'
  ];
BEGIN
  table_prefix := get_user_table_prefix(user_email);
  
  FOREACH table_name IN ARRAY tables_to_drop
  LOOP
    EXECUTE format('DROP TABLE IF EXISTS %I CASCADE', table_prefix || '_' || table_name);
  END LOOP;
END;
$$ LANGUAGE plpgsql;

-- Get all users except kare6625@colorado.edu
DO $$
DECLARE
  user_record RECORD;
  user_email TEXT;
BEGIN
  -- Delete all sessions first
  DELETE FROM public.sessions;
  
  -- Get all users except the one we want to keep
  FOR user_record IN 
    SELECT email FROM public.users 
    WHERE email != 'kare6625@colorado.edu' AND email IS NOT NULL
  LOOP
    user_email := user_record.email;
    RAISE NOTICE 'Dropping tables for user: %', user_email;
    PERFORM drop_user_tables(user_email);
  END LOOP;
  
  -- Delete all users except kare6625@colorado.edu
  DELETE FROM public.users WHERE email != 'kare6625@colorado.edu';
  
  RAISE NOTICE 'Cleanup complete. Only kare6625@colorado.edu remains.';
END $$;

-- Verify cleanup
SELECT 
  COUNT(*) as total_users,
  COUNT(*) FILTER (WHERE email = 'kare6625@colorado.edu') as kare_user_exists
FROM public.users;

