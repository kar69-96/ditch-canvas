-- ============================================
-- Disable RLS on Chat Tables
-- ============================================
-- This migration disables RLS because the application uses custom authentication
-- (not Supabase Auth). Authentication is handled in application code.

-- Disable RLS on all chat tables
ALTER TABLE chat_posts DISABLE ROW LEVEL SECURITY;
ALTER TABLE chat_responses DISABLE ROW LEVEL SECURITY;
ALTER TABLE chat_votes DISABLE ROW LEVEL SECURITY;
ALTER TABLE chat_attachments DISABLE ROW LEVEL SECURITY;
ALTER TABLE user_unlock_credits DISABLE ROW LEVEL SECURITY;
ALTER TABLE thread_access_tracking DISABLE ROW LEVEL SECURITY;
ALTER TABLE user_onboarding_state DISABLE ROW LEVEL SECURITY;

-- Drop any existing RLS policies (they won't work with custom auth anyway)
DROP POLICY IF EXISTS "Users can read posts in enrolled courses" ON chat_posts;
DROP POLICY IF EXISTS "Users can create posts in enrolled courses" ON chat_posts;
DROP POLICY IF EXISTS "Users can update own posts" ON chat_posts;
DROP POLICY IF EXISTS "No deletion of posts" ON chat_posts;
DROP POLICY IF EXISTS "Users can read responses for accessible posts" ON chat_responses;
DROP POLICY IF EXISTS "Users can create responses" ON chat_responses;
DROP POLICY IF EXISTS "Users can read votes" ON chat_votes;
DROP POLICY IF EXISTS "Users can vote" ON chat_votes;
DROP POLICY IF EXISTS "Users can read attachments for accessible posts" ON chat_attachments;
DROP POLICY IF EXISTS "Users can create attachments" ON chat_attachments;
DROP POLICY IF EXISTS "Users can read own credits" ON user_unlock_credits;
DROP POLICY IF EXISTS "Users can update own credits" ON user_unlock_credits;
DROP POLICY IF EXISTS "Users can read own access tracking" ON thread_access_tracking;
DROP POLICY IF EXISTS "Users can manage own access tracking" ON thread_access_tracking;
DROP POLICY IF EXISTS "Users can read own onboarding state" ON user_onboarding_state;
DROP POLICY IF EXISTS "Users can manage own onboarding state" ON user_onboarding_state;

