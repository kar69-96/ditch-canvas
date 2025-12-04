-- Recreate all tables for kare6625@colorado.edu including pages, quizzes, etc.
-- This ensures all 10 tables exist

-- Drop existing tables first (if they exist)
DO $$
DECLARE
  table_prefix TEXT;
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
  table_name TEXT;
BEGIN
  table_prefix := get_user_table_prefix('kare6625@colorado.edu');
  
  FOREACH table_name IN ARRAY tables_to_drop
  LOOP
    EXECUTE format('DROP TABLE IF EXISTS %I CASCADE', table_prefix || '_' || table_name);
  END LOOP;
END $$;

-- Recreate all tables
SELECT create_user_tables('kare6625@colorado.edu');

-- Verify all tables exist
DO $$
DECLARE
  table_prefix TEXT;
  table_count INTEGER;
BEGIN
  table_prefix := get_user_table_prefix('kare6625@colorado.edu');
  
  SELECT COUNT(*) INTO table_count
  FROM information_schema.tables
  WHERE table_schema = 'public'
  AND table_name LIKE table_prefix || '_%';
  
  RAISE NOTICE 'Created tables with prefix: %', table_prefix;
  RAISE NOTICE 'Total tables: %', table_count;
END $$;

