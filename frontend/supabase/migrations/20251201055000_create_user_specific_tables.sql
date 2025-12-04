-- Create user-specific schemas and tables
-- Each user gets their own schema with isolated tables

-- Function to get schema name from email
CREATE OR REPLACE FUNCTION get_user_schema_name(user_email TEXT)
RETURNS TEXT AS $$
BEGIN
  RETURN 'user_' || replace(replace(lower(trim(user_email)), '@', '_at_'), '.', '_');
END;
$$ LANGUAGE plpgsql IMMUTABLE;

-- Function to create user schema and tables
CREATE OR REPLACE FUNCTION create_user_schema(user_email TEXT)
RETURNS TEXT AS $$
DECLARE
  schema_name TEXT;
BEGIN
  -- Get schema name
  schema_name := get_user_schema_name(user_email);
  
  -- Create schema if it doesn't exist
  EXECUTE format('CREATE SCHEMA IF NOT EXISTS %I', schema_name);
  
  -- Create courses table in user schema
  EXECUTE format('
    CREATE TABLE IF NOT EXISTS %I.courses (
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
    )', schema_name);
  
  -- Create assignments table
  EXECUTE format('
    CREATE TABLE IF NOT EXISTS %I.assignments (
      id SERIAL PRIMARY KEY,
      assignment_id TEXT NOT NULL,
      course_id INTEGER NOT NULL REFERENCES %I.courses(id) ON DELETE CASCADE,
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
      UNIQUE(assignment_id, course_id)
    )', schema_name, schema_name);
  
  -- Create announcements table
  EXECUTE format('
    CREATE TABLE IF NOT EXISTS %I.announcements (
      id SERIAL PRIMARY KEY,
      announcement_id TEXT NOT NULL,
      course_id INTEGER NOT NULL REFERENCES %I.courses(id) ON DELETE CASCADE,
      url TEXT,
      extracted_at TIMESTAMPTZ,
      title TEXT NOT NULL,
      message TEXT,
      posted_at TIMESTAMPTZ,
      created_at TIMESTAMPTZ DEFAULT NOW(),
      updated_at TIMESTAMPTZ DEFAULT NOW(),
      UNIQUE(announcement_id, course_id)
    )', schema_name, schema_name);
  
  -- Create modules table
  EXECUTE format('
    CREATE TABLE IF NOT EXISTS %I.modules (
      id SERIAL PRIMARY KEY,
      module_id TEXT NOT NULL,
      course_id INTEGER NOT NULL REFERENCES %I.courses(id) ON DELETE CASCADE,
      url TEXT,
      extracted_at TIMESTAMPTZ,
      name TEXT NOT NULL,
      position INTEGER,
      unlock_at TIMESTAMPTZ,
      items JSONB,
      created_at TIMESTAMPTZ DEFAULT NOW(),
      updated_at TIMESTAMPTZ DEFAULT NOW(),
      UNIQUE(module_id, course_id)
    )', schema_name, schema_name);
  
  -- Create grades table
  EXECUTE format('
    CREATE TABLE IF NOT EXISTS %I.grades (
      id SERIAL PRIMARY KEY,
      current_gpa NUMERIC(3, 2),
      semester_progress INTEGER,
      course_grades JSONB,
      created_at TIMESTAMPTZ DEFAULT NOW(),
      updated_at TIMESTAMPTZ DEFAULT NOW()
    )', schema_name);
  
  -- Create indexes
  EXECUTE format('CREATE INDEX IF NOT EXISTS idx_%I_assignments_course_id ON %I.assignments(course_id)', 
    replace(schema_name, 'user_', ''), schema_name);
  EXECUTE format('CREATE INDEX IF NOT EXISTS idx_%I_assignments_due_date ON %I.assignments(due_date)', 
    replace(schema_name, 'user_', ''), schema_name);
  EXECUTE format('CREATE INDEX IF NOT EXISTS idx_%I_announcements_course_id ON %I.announcements(course_id)', 
    replace(schema_name, 'user_', ''), schema_name);
  EXECUTE format('CREATE INDEX IF NOT EXISTS idx_%I_announcements_posted_at ON %I.announcements(posted_at)', 
    replace(schema_name, 'user_', ''), schema_name);
  EXECUTE format('CREATE INDEX IF NOT EXISTS idx_%I_modules_course_id ON %I.modules(course_id)', 
    replace(schema_name, 'user_', ''), schema_name);
  
  -- Create triggers for updated_at (using existing function)
  EXECUTE format('
    DROP TRIGGER IF EXISTS update_%I_courses_updated_at ON %I.courses;
    CREATE TRIGGER update_%I_courses_updated_at
      BEFORE UPDATE ON %I.courses
      FOR EACH ROW
      EXECUTE FUNCTION update_updated_at_column()
  ', replace(schema_name, 'user_', ''), schema_name, replace(schema_name, 'user_', ''), schema_name);
  
  EXECUTE format('
    DROP TRIGGER IF EXISTS update_%I_assignments_updated_at ON %I.assignments;
    CREATE TRIGGER update_%I_assignments_updated_at
      BEFORE UPDATE ON %I.assignments
      FOR EACH ROW
      EXECUTE FUNCTION update_updated_at_column()
  ', replace(schema_name, 'user_', ''), schema_name, replace(schema_name, 'user_', ''), schema_name);
  
  EXECUTE format('
    DROP TRIGGER IF EXISTS update_%I_announcements_updated_at ON %I.announcements;
    CREATE TRIGGER update_%I_announcements_updated_at
      BEFORE UPDATE ON %I.announcements
      FOR EACH ROW
      EXECUTE FUNCTION update_updated_at_column()
  ', replace(schema_name, 'user_', ''), schema_name, replace(schema_name, 'user_', ''), schema_name);
  
  EXECUTE format('
    DROP TRIGGER IF EXISTS update_%I_modules_updated_at ON %I.modules;
    CREATE TRIGGER update_%I_modules_updated_at
      BEFORE UPDATE ON %I.modules
      FOR EACH ROW
      EXECUTE FUNCTION update_updated_at_column()
  ', replace(schema_name, 'user_', ''), schema_name, replace(schema_name, 'user_', ''), schema_name);
  
  EXECUTE format('
    DROP TRIGGER IF EXISTS update_%I_grades_updated_at ON %I.grades;
    CREATE TRIGGER update_%I_grades_updated_at
      BEFORE UPDATE ON %I.grades
      FOR EACH ROW
      EXECUTE FUNCTION update_updated_at_column()
  ', replace(schema_name, 'user_', ''), schema_name, replace(schema_name, 'user_', ''), schema_name);
  
  RETURN schema_name;
END;
$$ LANGUAGE plpgsql;
