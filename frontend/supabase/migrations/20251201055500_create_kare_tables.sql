-- Manually create tables for kare6625@colorado.edu
-- This ensures the tables exist even if the trigger didn't fire

-- Call the create_user_tables function for kare6625@colorado.edu
SELECT create_user_tables('kare6625@colorado.edu');

-- Verify tables were created
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
  RAISE NOTICE 'Total tables created: %', table_count;
END $$;

