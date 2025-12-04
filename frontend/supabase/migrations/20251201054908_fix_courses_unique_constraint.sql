-- Fix courses table to have proper unique constraint for upsert
-- Add unique constraint on (id, user_email) for upsert operations
-- We keep the existing primary key on id, and add a unique constraint for the composite key
ALTER TABLE courses ADD CONSTRAINT courses_id_user_email_unique UNIQUE (id, user_email);

