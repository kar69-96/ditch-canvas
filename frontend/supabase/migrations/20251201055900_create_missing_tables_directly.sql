-- Directly create the missing tables for kare6625@colorado.edu
-- This bypasses the function and creates tables directly

DO $$
DECLARE
  table_prefix TEXT := 'user_kare6625_at_colorado_edu';
  courses_table TEXT := table_prefix || '_courses';
BEGIN
  -- Create pages table
  EXECUTE format('
    CREATE TABLE IF NOT EXISTS %I (
      id SERIAL PRIMARY KEY,
      page_id TEXT NOT NULL,
      course_id INTEGER NOT NULL,
      url TEXT,
      extracted_at TIMESTAMPTZ,
      title TEXT NOT NULL,
      body TEXT,
      published BOOLEAN,
      created_at TIMESTAMPTZ DEFAULT NOW(),
      updated_at TIMESTAMPTZ DEFAULT NOW(),
      UNIQUE(page_id, course_id),
      FOREIGN KEY (course_id) REFERENCES %I(id) ON DELETE CASCADE
    )', table_prefix || '_pages', courses_table);

  -- Create quizzes table
  EXECUTE format('
    CREATE TABLE IF NOT EXISTS %I (
      id SERIAL PRIMARY KEY,
      quiz_id TEXT NOT NULL,
      course_id INTEGER NOT NULL,
      url TEXT,
      extracted_at TIMESTAMPTZ,
      title TEXT NOT NULL,
      description TEXT,
      due_at TIMESTAMPTZ,
      points_possible INTEGER,
      question_count INTEGER,
      created_at TIMESTAMPTZ DEFAULT NOW(),
      updated_at TIMESTAMPTZ DEFAULT NOW(),
      UNIQUE(quiz_id, course_id),
      FOREIGN KEY (course_id) REFERENCES %I(id) ON DELETE CASCADE
    )', table_prefix || '_quizzes', courses_table);

  -- Create syllabus table
  EXECUTE format('
    CREATE TABLE IF NOT EXISTS %I (
      id SERIAL PRIMARY KEY,
      syllabus_id TEXT NOT NULL,
      course_id INTEGER NOT NULL,
      url TEXT,
      extracted_at TIMESTAMPTZ,
      body TEXT,
      created_at TIMESTAMPTZ DEFAULT NOW(),
      updated_at TIMESTAMPTZ DEFAULT NOW(),
      UNIQUE(syllabus_id, course_id),
      FOREIGN KEY (course_id) REFERENCES %I(id) ON DELETE CASCADE
    )', table_prefix || '_syllabus', courses_table);

  -- Create discussions table
  EXECUTE format('
    CREATE TABLE IF NOT EXISTS %I (
      id SERIAL PRIMARY KEY,
      discussion_id TEXT NOT NULL,
      course_id INTEGER NOT NULL,
      url TEXT,
      extracted_at TIMESTAMPTZ,
      title TEXT NOT NULL,
      message TEXT,
      posted_at TIMESTAMPTZ,
      created_at TIMESTAMPTZ DEFAULT NOW(),
      updated_at TIMESTAMPTZ DEFAULT NOW(),
      UNIQUE(discussion_id, course_id),
      FOREIGN KEY (course_id) REFERENCES %I(id) ON DELETE CASCADE
    )', table_prefix || '_discussions', courses_table);

  -- Create files table
  EXECUTE format('
    CREATE TABLE IF NOT EXISTS %I (
      id SERIAL PRIMARY KEY,
      file_id TEXT NOT NULL,
      course_id INTEGER NOT NULL,
      url TEXT,
      extracted_at TIMESTAMPTZ,
      filename TEXT NOT NULL,
      display_name TEXT,
      size INTEGER,
      content_type TEXT,
      folder_path TEXT,
      created_at TIMESTAMPTZ DEFAULT NOW(),
      updated_at TIMESTAMPTZ DEFAULT NOW(),
      UNIQUE(file_id, course_id),
      FOREIGN KEY (course_id) REFERENCES %I(id) ON DELETE CASCADE
    )', table_prefix || '_files', courses_table);

  -- Create indexes
  EXECUTE format('CREATE INDEX IF NOT EXISTS idx_%I_pages_course_id ON %I(course_id)', 
    table_prefix, table_prefix || '_pages');
  EXECUTE format('CREATE INDEX IF NOT EXISTS idx_%I_quizzes_course_id ON %I(course_id)', 
    table_prefix, table_prefix || '_quizzes');
  EXECUTE format('CREATE INDEX IF NOT EXISTS idx_%I_discussions_course_id ON %I(course_id)', 
    table_prefix, table_prefix || '_discussions');
  EXECUTE format('CREATE INDEX IF NOT EXISTS idx_%I_files_course_id ON %I(course_id)', 
    table_prefix, table_prefix || '_files');

  -- Create triggers
  EXECUTE format('
    DROP TRIGGER IF EXISTS update_%I_pages_updated_at ON %I;
    CREATE TRIGGER update_%I_pages_updated_at
      BEFORE UPDATE ON %I
      FOR EACH ROW
      EXECUTE FUNCTION update_updated_at_column()
  ', table_prefix, table_prefix || '_pages', table_prefix, table_prefix || '_pages');

  EXECUTE format('
    DROP TRIGGER IF EXISTS update_%I_quizzes_updated_at ON %I;
    CREATE TRIGGER update_%I_quizzes_updated_at
      BEFORE UPDATE ON %I
      FOR EACH ROW
      EXECUTE FUNCTION update_updated_at_column()
  ', table_prefix, table_prefix || '_quizzes', table_prefix, table_prefix || '_quizzes');

  EXECUTE format('
    DROP TRIGGER IF EXISTS update_%I_syllabus_updated_at ON %I;
    CREATE TRIGGER update_%I_syllabus_updated_at
      BEFORE UPDATE ON %I
      FOR EACH ROW
      EXECUTE FUNCTION update_updated_at_column()
  ', table_prefix, table_prefix || '_syllabus', table_prefix, table_prefix || '_syllabus');

  EXECUTE format('
    DROP TRIGGER IF EXISTS update_%I_discussions_updated_at ON %I;
    CREATE TRIGGER update_%I_discussions_updated_at
      BEFORE UPDATE ON %I
      FOR EACH ROW
      EXECUTE FUNCTION update_updated_at_column()
  ', table_prefix, table_prefix || '_discussions', table_prefix, table_prefix || '_discussions');

  EXECUTE format('
    DROP TRIGGER IF EXISTS update_%I_files_updated_at ON %I;
    CREATE TRIGGER update_%I_files_updated_at
      BEFORE UPDATE ON %I
      FOR EACH ROW
      EXECUTE FUNCTION update_updated_at_column()
  ', table_prefix, table_prefix || '_files', table_prefix, table_prefix || '_files');

  -- Enable RLS
  EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', table_prefix || '_pages');
  EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', table_prefix || '_quizzes');
  EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', table_prefix || '_syllabus');
  EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', table_prefix || '_discussions');
  EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', table_prefix || '_files');

  -- Create policies
  EXECUTE format('
    DROP POLICY IF EXISTS "Allow all operations on %I" ON %I;
    CREATE POLICY "Allow all operations on %I" ON %I
      FOR ALL USING (true) WITH CHECK (true)
  ', table_prefix || '_pages', table_prefix || '_pages', table_prefix || '_pages', table_prefix || '_pages');

  EXECUTE format('
    DROP POLICY IF EXISTS "Allow all operations on %I" ON %I;
    CREATE POLICY "Allow all operations on %I" ON %I
      FOR ALL USING (true) WITH CHECK (true)
  ', table_prefix || '_quizzes', table_prefix || '_quizzes', table_prefix || '_quizzes', table_prefix || '_quizzes');

  EXECUTE format('
    DROP POLICY IF EXISTS "Allow all operations on %I" ON %I;
    CREATE POLICY "Allow all operations on %I" ON %I
      FOR ALL USING (true) WITH CHECK (true)
  ', table_prefix || '_syllabus', table_prefix || '_syllabus', table_prefix || '_syllabus', table_prefix || '_syllabus');

  EXECUTE format('
    DROP POLICY IF EXISTS "Allow all operations on %I" ON %I;
    CREATE POLICY "Allow all operations on %I" ON %I
      FOR ALL USING (true) WITH CHECK (true)
  ', table_prefix || '_discussions', table_prefix || '_discussions', table_prefix || '_discussions', table_prefix || '_discussions');

  EXECUTE format('
    DROP POLICY IF EXISTS "Allow all operations on %I" ON %I;
    CREATE POLICY "Allow all operations on %I" ON %I
      FOR ALL USING (true) WITH CHECK (true)
  ', table_prefix || '_files', table_prefix || '_files', table_prefix || '_files', table_prefix || '_files');

  RAISE NOTICE 'Created missing tables for %', table_prefix;
END $$;

