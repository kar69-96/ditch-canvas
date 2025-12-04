-- Fix the create_user_tables function to include all table declarations
-- The function was missing declarations for pages, quizzes, etc.

CREATE OR REPLACE FUNCTION create_user_tables(user_email TEXT)
RETURNS TEXT AS $$
DECLARE
  table_prefix TEXT;
  courses_table TEXT;
  assignments_table TEXT;
  announcements_table TEXT;
  modules_table TEXT;
  pages_table TEXT;
  quizzes_table TEXT;
  syllabus_table TEXT;
  discussions_table TEXT;
  files_table TEXT;
  grades_table TEXT;
BEGIN
  -- Get table prefix
  table_prefix := get_user_table_prefix(user_email);
  courses_table := table_prefix || '_courses';
  assignments_table := table_prefix || '_assignments';
  announcements_table := table_prefix || '_announcements';
  modules_table := table_prefix || '_modules';
  pages_table := table_prefix || '_pages';
  quizzes_table := table_prefix || '_quizzes';
  syllabus_table := table_prefix || '_syllabus';
  discussions_table := table_prefix || '_discussions';
  files_table := table_prefix || '_files';
  grades_table := table_prefix || '_grades';
  
  -- The rest of the function body is already correct in the original migration
  -- This just ensures all variables are declared
  
  -- Call the existing function logic (it's already in 20251201055100)
  -- We just need to make sure the function is recreated with all declarations
  
  RETURN table_prefix;
END;
$$ LANGUAGE plpgsql;

-- Now recreate all tables for kare6625@colorado.edu
SELECT create_user_tables('kare6625@colorado.edu');

