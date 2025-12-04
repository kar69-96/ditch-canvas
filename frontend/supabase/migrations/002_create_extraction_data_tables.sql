-- ============================================
-- Supabase Migration: Extraction Data Tables
-- ============================================
-- This migration creates tables for Canvas extraction data:
-- courses, assignments, announcements, modules, grades
-- ============================================

-- Create courses table
CREATE TABLE IF NOT EXISTS courses (
  id INTEGER NOT NULL,
  code TEXT NOT NULL,
  name TEXT NOT NULL,
  full_name TEXT,
  instructor TEXT,
  color TEXT,
  enrollment_term_id INTEGER,
  workflow_state TEXT,
  user_email TEXT NOT NULL, -- Link to user's email
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  PRIMARY KEY (id, user_email),
  UNIQUE(id, user_email)
);

-- Create index on user_email for faster lookups
CREATE INDEX IF NOT EXISTS idx_courses_user_email ON courses(user_email);

-- Create assignments table
CREATE TABLE IF NOT EXISTS assignments (
  id SERIAL PRIMARY KEY,
  assignment_id TEXT NOT NULL,
  course_id INTEGER NOT NULL,
  user_email TEXT NOT NULL, -- Link to user's email
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
  UNIQUE(assignment_id, course_id, user_email),
  FOREIGN KEY (course_id, user_email) REFERENCES courses(id, user_email) ON DELETE CASCADE
);

-- Create index on course_id and user_email
CREATE INDEX IF NOT EXISTS idx_assignments_course_id ON assignments(course_id);
CREATE INDEX IF NOT EXISTS idx_assignments_user_email ON assignments(user_email);
CREATE INDEX IF NOT EXISTS idx_assignments_due_date ON assignments(due_date);

-- Create announcements table
CREATE TABLE IF NOT EXISTS announcements (
  id SERIAL PRIMARY KEY,
  announcement_id TEXT NOT NULL,
  course_id INTEGER NOT NULL,
  user_email TEXT NOT NULL, -- Link to user's email
  url TEXT,
  extracted_at TIMESTAMPTZ,
  title TEXT NOT NULL,
  message TEXT,
  posted_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(announcement_id, course_id, user_email),
  FOREIGN KEY (course_id, user_email) REFERENCES courses(id, user_email) ON DELETE CASCADE
);

-- Create index on course_id and user_email
CREATE INDEX IF NOT EXISTS idx_announcements_course_id ON announcements(course_id);
CREATE INDEX IF NOT EXISTS idx_announcements_user_email ON announcements(user_email);
CREATE INDEX IF NOT EXISTS idx_announcements_posted_at ON announcements(posted_at);

-- Create modules table
CREATE TABLE IF NOT EXISTS modules (
  id SERIAL PRIMARY KEY,
  module_id TEXT NOT NULL,
  course_id INTEGER NOT NULL,
  user_email TEXT NOT NULL, -- Link to user's email
  url TEXT,
  extracted_at TIMESTAMPTZ,
  name TEXT NOT NULL,
  position INTEGER,
  unlock_at TIMESTAMPTZ,
  items JSONB, -- Store module items as JSON
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(module_id, course_id, user_email),
  FOREIGN KEY (course_id, user_email) REFERENCES courses(id, user_email) ON DELETE CASCADE
);

-- Create index on course_id and user_email
CREATE INDEX IF NOT EXISTS idx_modules_course_id ON modules(course_id);
CREATE INDEX IF NOT EXISTS idx_modules_user_email ON modules(user_email);

-- Create grades table
CREATE TABLE IF NOT EXISTS grades (
  id SERIAL PRIMARY KEY,
  user_email TEXT NOT NULL UNIQUE, -- One grade record per user
  current_gpa NUMERIC(3, 2),
  semester_progress INTEGER,
  course_grades JSONB, -- Array of course grade objects
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Create index on user_email
CREATE INDEX IF NOT EXISTS idx_grades_user_email ON grades(user_email);

-- Create trigger to automatically update updated_at for all tables
DROP TRIGGER IF EXISTS update_courses_updated_at ON courses;
CREATE TRIGGER update_courses_updated_at
  BEFORE UPDATE ON courses
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

DROP TRIGGER IF EXISTS update_assignments_updated_at ON assignments;
CREATE TRIGGER update_assignments_updated_at
  BEFORE UPDATE ON assignments
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

DROP TRIGGER IF EXISTS update_announcements_updated_at ON announcements;
CREATE TRIGGER update_announcements_updated_at
  BEFORE UPDATE ON announcements
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

DROP TRIGGER IF EXISTS update_modules_updated_at ON modules;
CREATE TRIGGER update_modules_updated_at
  BEFORE UPDATE ON modules
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

DROP TRIGGER IF EXISTS update_grades_updated_at ON grades;
CREATE TRIGGER update_grades_updated_at
  BEFORE UPDATE ON grades
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

-- Enable Row Level Security (RLS)
ALTER TABLE courses ENABLE ROW LEVEL SECURITY;
ALTER TABLE assignments ENABLE ROW LEVEL SECURITY;
ALTER TABLE announcements ENABLE ROW LEVEL SECURITY;
ALTER TABLE modules ENABLE ROW LEVEL SECURITY;
ALTER TABLE grades ENABLE ROW LEVEL SECURITY;

-- Drop existing policies if they exist
DROP POLICY IF EXISTS "Allow all operations on courses" ON courses;
DROP POLICY IF EXISTS "Allow all operations on assignments" ON assignments;
DROP POLICY IF EXISTS "Allow all operations on announcements" ON announcements;
DROP POLICY IF EXISTS "Allow all operations on modules" ON modules;
DROP POLICY IF EXISTS "Allow all operations on grades" ON grades;

-- Create policies for all tables
CREATE POLICY "Allow all operations on courses" ON courses
  FOR ALL USING (true) WITH CHECK (true);

CREATE POLICY "Allow all operations on assignments" ON assignments
  FOR ALL USING (true) WITH CHECK (true);

CREATE POLICY "Allow all operations on announcements" ON announcements
  FOR ALL USING (true) WITH CHECK (true);

CREATE POLICY "Allow all operations on modules" ON modules
  FOR ALL USING (true) WITH CHECK (true);

CREATE POLICY "Allow all operations on grades" ON grades
  FOR ALL USING (true) WITH CHECK (true);

-- ============================================
-- Migration Complete
-- ============================================
-- Verify tables were created:
-- SELECT * FROM courses;
-- SELECT * FROM assignments;
-- SELECT * FROM announcements;
-- SELECT * FROM modules;
-- SELECT * FROM grades;
-- ============================================

