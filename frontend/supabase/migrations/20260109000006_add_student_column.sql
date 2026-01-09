-- Add student column to users table to store CU Boulder identikey
-- This column will store identik like "kare6625"

ALTER TABLE users ADD COLUMN IF NOT EXISTS student TEXT;

-- Create index for faster lookups
CREATE INDEX IF NOT EXISTS idx_users_student ON users(student);

-- Add comment for clarity
COMMENT ON COLUMN users.student IS 'CU Boulder identikey (e.g., kare6625)';
