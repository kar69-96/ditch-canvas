-- Ensure all 10 tables exist for kare6625@colorado.edu
-- This migration explicitly creates any missing tables

DO $$
DECLARE
  table_prefix TEXT;
  email TEXT := 'kare6625@colorado.edu';
BEGIN
  table_prefix := get_user_table_prefix(email);
  
  -- Call create_user_tables which should create all tables
  PERFORM create_user_tables(email);
  
  RAISE NOTICE 'Ensured all tables exist for %', table_prefix;
END $$;

-- Verify all 10 tables exist
SELECT 
  COUNT(*) as total_tables,
  string_agg(table_name, ', ' ORDER BY table_name) as table_names
FROM information_schema.tables
WHERE table_schema = 'public'
AND table_name LIKE 'user_kare6625_at_colorado_edu_%';

