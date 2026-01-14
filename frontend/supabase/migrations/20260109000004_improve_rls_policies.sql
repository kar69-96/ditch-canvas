-- ============================================
-- Supabase Schema Consolidation - Phase 5
-- Improve RLS Policies (Documentation Only)
-- ============================================
-- This migration documents improved RLS policies for chat tables.
-- IMPORTANT: Chat RLS is currently DISABLED by design (app-level auth).
-- Enabling these policies requires updating chat API code to set
-- current_setting('app.current_user_id').
-- Apply only after testing with application code changes.
-- ============================================

-- NOTE: This migration is provided for future reference but does NOT
-- enable RLS on chat tables. To enable, uncomment the sections below
-- after updating application code to support RLS.

/*
-- Re-enable RLS on chat tables with proper policies
ALTER TABLE chat_posts ENABLE ROW LEVEL SECURITY;
ALTER TABLE chat_responses ENABLE ROW LEVEL SECURITY;
ALTER TABLE chat_votes ENABLE ROW LEVEL SECURITY;
ALTER TABLE chat_attachments ENABLE ROW LEVEL SECURITY;

-- Drop existing overly-permissive policies
DROP POLICY IF EXISTS "Allow all operations on chat_posts" ON chat_posts;
DROP POLICY IF EXISTS "Allow all operations on chat_responses" ON chat_responses;

-- Create proper RLS policies for chat_posts
CREATE POLICY "Users can read all posts in their courses" ON chat_posts
  FOR SELECT
  USING (true); -- All users can read all posts (anonymous forum)

CREATE POLICY "Users can create posts" ON chat_posts
  FOR INSERT
  WITH CHECK (user_id = current_setting('app.current_user_id', true));

CREATE POLICY "Users can update own posts" ON chat_posts
  FOR UPDATE
  USING (user_id = current_setting('app.current_user_id', true))
  WITH CHECK (user_id = current_setting('app.current_user_id', true));

CREATE POLICY "Users can delete own posts" ON chat_posts
  FOR DELETE
  USING (user_id = current_setting('app.current_user_id', true));

-- Similar policies for chat_responses
CREATE POLICY "Users can read all responses" ON chat_responses
  FOR SELECT
  USING (true);

CREATE POLICY "Users can create responses" ON chat_responses
  FOR INSERT
  WITH CHECK (user_id = current_setting('app.current_user_id', true));

CREATE POLICY "Users can update own responses" ON chat_responses
  FOR UPDATE
  USING (user_id = current_setting('app.current_user_id', true))
  WITH CHECK (user_id = current_setting('app.current_user_id', true));

CREATE POLICY "Users can delete own responses" ON chat_responses
  FOR DELETE
  USING (user_id = current_setting('app.current_user_id', true));

-- Chat votes policies
CREATE POLICY "Users can read all votes" ON chat_votes
  FOR SELECT
  USING (true);

CREATE POLICY "Users can create own votes" ON chat_votes
  FOR INSERT
  WITH CHECK (user_id = current_setting('app.current_user_id', true));

CREATE POLICY "Users can delete own votes" ON chat_votes
  FOR DELETE
  USING (user_id = current_setting('app.current_user_id', true));

-- Chat attachments policies
CREATE POLICY "Users can read all attachments" ON chat_attachments
  FOR SELECT
  USING (true);

-- Attachments inherit access from post/response
CREATE POLICY "Users can manage attachments on own posts" ON chat_attachments
  FOR ALL
  USING (
    post_id IN (SELECT id FROM chat_posts WHERE user_id = current_setting('app.current_user_id', true))
    OR response_id IN (SELECT id FROM chat_responses WHERE user_id = current_setting('app.current_user_id', true))
  )
  WITH CHECK (
    post_id IN (SELECT id FROM chat_posts WHERE user_id = current_setting('app.current_user_id', true))
    OR response_id IN (SELECT id FROM chat_responses WHERE user_id = current_setting('app.current_user_id', true))
  );
*/

-- ============================================
-- Migration Complete - Phase 5
-- ============================================
-- RLS policies documented but NOT enabled.
-- Chat tables remain with RLS DISABLED (current design).
-- To enable: Uncomment sections above after updating application code.
-- ============================================
