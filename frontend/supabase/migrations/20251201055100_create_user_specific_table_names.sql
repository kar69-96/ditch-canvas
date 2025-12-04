-- Create user-specific tables using table name prefixes
-- Each user gets tables like: courses_user_kare6625_at_colorado_edu

-- Function to get table name prefix from email
CREATE OR REPLACE FUNCTION get_user_table_prefix(user_email TEXT)
RETURNS TEXT AS $$
BEGIN
  RETURN 'user_' || replace(replace(lower(trim(user_email)), '@', '_at_'), '.', '_');
END;
$$ LANGUAGE plpgsql IMMUTABLE;

-- Function to create user-specific tables
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
  
  -- Create courses table
  EXECUTE format('
    CREATE TABLE IF NOT EXISTS %I (
      id INTEGER PRIMARY KEY,
      code TEXT NOT NULL,
      name TEXT NOT NULL,
      full_name TEXT,
      instructor TEXT,
      color TEXT,
      enrollment_term_id INTEGER,
      workflow_state TEXT,
      created_at TIMESTAMPTZ DEFAULT NOW(),
      updated_at TIMESTAMPTZ DEFAULT NOW()
    )', courses_table);
  
  -- Create assignments table
  EXECUTE format('
    CREATE TABLE IF NOT EXISTS %I (
      id SERIAL PRIMARY KEY,
      assignment_id TEXT NOT NULL,
      course_id INTEGER NOT NULL,
      url TEXT,
      extracted_at TIMESTAMPTZ,
      title TEXT NOT NULL,
      description TEXT,
      due_date TIMESTAMPTZ,
      assigned_at TIMESTAMPTZ,
      points INTEGER,
      points_possible INTEGER,
      submission_types JSONB,
      workflow_state TEXT,
      course_name TEXT,
      course_code TEXT,
      created_at TIMESTAMPTZ DEFAULT NOW(),
      updated_at TIMESTAMPTZ DEFAULT NOW(),
      UNIQUE(assignment_id, course_id),
      FOREIGN KEY (course_id) REFERENCES %I(id) ON DELETE CASCADE
    )', assignments_table, courses_table);
  
  -- Create announcements table
  EXECUTE format('
    CREATE TABLE IF NOT EXISTS %I (
      id SERIAL PRIMARY KEY,
      announcement_id TEXT NOT NULL,
      course_id INTEGER NOT NULL,
      url TEXT,
      extracted_at TIMESTAMPTZ,
      title TEXT NOT NULL,
      message TEXT,
      posted_at TIMESTAMPTZ,
      created_at TIMESTAMPTZ DEFAULT NOW(),
      updated_at TIMESTAMPTZ DEFAULT NOW(),
      UNIQUE(announcement_id, course_id),
      FOREIGN KEY (course_id) REFERENCES %I(id) ON DELETE CASCADE
    )', announcements_table, courses_table);
  
  -- Create modules table
  EXECUTE format('
    CREATE TABLE IF NOT EXISTS %I (
      id SERIAL PRIMARY KEY,
      module_id TEXT NOT NULL,
      course_id INTEGER NOT NULL,
      url TEXT,
      extracted_at TIMESTAMPTZ,
      name TEXT NOT NULL,
      position INTEGER,
      unlock_at TIMESTAMPTZ,
      items JSONB,
      created_at TIMESTAMPTZ DEFAULT NOW(),
      updated_at TIMESTAMPTZ DEFAULT NOW(),
      UNIQUE(module_id, course_id),
      FOREIGN KEY (course_id) REFERENCES %I(id) ON DELETE CASCADE
    )', modules_table, courses_table);
  
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
    )', pages_table, courses_table);
  
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
    )', quizzes_table, courses_table);
  
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
    )', syllabus_table, courses_table);
  
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
    )', discussions_table, courses_table);
  
  -- Create files table (file metadata)
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
    )', files_table, courses_table);
  
  -- Create grades table
  EXECUTE format('
    CREATE TABLE IF NOT EXISTS %I (
      id SERIAL PRIMARY KEY,
      current_gpa NUMERIC(3, 2),
      semester_progress INTEGER,
      course_grades JSONB,
      created_at TIMESTAMPTZ DEFAULT NOW(),
      updated_at TIMESTAMPTZ DEFAULT NOW()
    )', grades_table);
  
  -- Create indexes
  EXECUTE format('CREATE INDEX IF NOT EXISTS idx_%I_assignments_course_id ON %I(course_id)', 
    table_prefix, assignments_table);
  EXECUTE format('CREATE INDEX IF NOT EXISTS idx_%I_assignments_due_date ON %I(due_date)', 
    table_prefix, assignments_table);
  EXECUTE format('CREATE INDEX IF NOT EXISTS idx_%I_announcements_course_id ON %I(course_id)', 
    table_prefix, announcements_table);
  EXECUTE format('CREATE INDEX IF NOT EXISTS idx_%I_announcements_posted_at ON %I(posted_at)', 
    table_prefix, announcements_table);
  EXECUTE format('CREATE INDEX IF NOT EXISTS idx_%I_modules_course_id ON %I(course_id)', 
    table_prefix, modules_table);
  EXECUTE format('CREATE INDEX IF NOT EXISTS idx_%I_pages_course_id ON %I(course_id)', 
    table_prefix, table_prefix || '_pages');
  EXECUTE format('CREATE INDEX IF NOT EXISTS idx_%I_quizzes_course_id ON %I(course_id)', 
    table_prefix, table_prefix || '_quizzes');
  EXECUTE format('CREATE INDEX IF NOT EXISTS idx_%I_discussions_course_id ON %I(course_id)', 
    table_prefix, table_prefix || '_discussions');
  EXECUTE format('CREATE INDEX IF NOT EXISTS idx_%I_files_course_id ON %I(course_id)', 
    table_prefix, table_prefix || '_files');
  
  -- Create triggers for updated_at
  EXECUTE format('
    DROP TRIGGER IF EXISTS update_%I_courses_updated_at ON %I;
    CREATE TRIGGER update_%I_courses_updated_at
      BEFORE UPDATE ON %I
      FOR EACH ROW
      EXECUTE FUNCTION update_updated_at_column()
  ', table_prefix, courses_table, table_prefix, courses_table);
  
  EXECUTE format('
    DROP TRIGGER IF EXISTS update_%I_assignments_updated_at ON %I;
    CREATE TRIGGER update_%I_assignments_updated_at
      BEFORE UPDATE ON %I
      FOR EACH ROW
      EXECUTE FUNCTION update_updated_at_column()
  ', table_prefix, assignments_table, table_prefix, assignments_table);
  
  EXECUTE format('
    DROP TRIGGER IF EXISTS update_%I_announcements_updated_at ON %I;
    CREATE TRIGGER update_%I_announcements_updated_at
      BEFORE UPDATE ON %I
      FOR EACH ROW
      EXECUTE FUNCTION update_updated_at_column()
  ', table_prefix, announcements_table, table_prefix, announcements_table);
  
  EXECUTE format('
    DROP TRIGGER IF EXISTS update_%I_modules_updated_at ON %I;
    CREATE TRIGGER update_%I_modules_updated_at
      BEFORE UPDATE ON %I
      FOR EACH ROW
      EXECUTE FUNCTION update_updated_at_column()
  ', table_prefix, modules_table, table_prefix, modules_table);
  
  EXECUTE format('
    DROP TRIGGER IF EXISTS update_%I_grades_updated_at ON %I;
    CREATE TRIGGER update_%I_grades_updated_at
      BEFORE UPDATE ON %I
      FOR EACH ROW
      EXECUTE FUNCTION update_updated_at_column()
  ', table_prefix, grades_table, table_prefix, grades_table);
  
  -- Triggers for new tables
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
  
  RETURN table_prefix;
END;
$$ LANGUAGE plpgsql;

