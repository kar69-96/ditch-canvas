-- ============================================
-- FINALIZE MIGRATION - RENAME TABLES
-- ============================================
-- This migration renames old tables to _deprecated and new tables to final names.
-- Run this AFTER verifying data migration was successful.
-- ============================================

-- ============================================
-- STEP 1: Rename Old Tables to _deprecated
-- ============================================

-- Core tables
ALTER TABLE IF EXISTS users RENAME TO users_deprecated;
ALTER TABLE IF EXISTS extraction_data RENAME TO extraction_data_deprecated;
ALTER TABLE IF EXISTS invite_codes RENAME TO invite_codes_deprecated;
ALTER TABLE IF EXISTS pending_extractions RENAME TO pending_extractions_deprecated;

-- Chat tables
ALTER TABLE IF EXISTS chat_posts RENAME TO chat_posts_deprecated;
ALTER TABLE IF EXISTS chat_responses RENAME TO chat_responses_deprecated;
ALTER TABLE IF EXISTS chat_votes RENAME TO chat_votes_deprecated;
ALTER TABLE IF EXISTS chat_attachments RENAME TO chat_attachments_deprecated;

-- Forum helper tables (being removed)
ALTER TABLE IF EXISTS user_unlock_credits RENAME TO user_unlock_credits_deprecated;
ALTER TABLE IF EXISTS user_onboarding_state RENAME TO user_onboarding_state_deprecated;
ALTER TABLE IF EXISTS thread_access_tracking RENAME TO thread_access_tracking_deprecated;

-- Integration tables
ALTER TABLE IF EXISTS integrations RENAME TO integrations_deprecated;
ALTER TABLE IF EXISTS integration_item_mappings RENAME TO integration_item_mappings_deprecated;

-- Tables being removed entirely
ALTER TABLE IF EXISTS sessions RENAME TO sessions_deprecated;
ALTER TABLE IF EXISTS completed_extractions RENAME TO completed_extractions_deprecated;
ALTER TABLE IF EXISTS waitlist RENAME TO waitlist_deprecated;

-- ============================================
-- STEP 2: Rename New Tables to Final Names
-- ============================================

ALTER TABLE users_new RENAME TO users;
ALTER TABLE extraction_data_new RENAME TO extraction_data;
ALTER TABLE invite_codes_new RENAME TO invite_codes;
ALTER TABLE pending_extractions_new RENAME TO pending_extractions;
ALTER TABLE chat_posts_new RENAME TO chat_posts;
ALTER TABLE chat_responses_new RENAME TO chat_responses;
ALTER TABLE chat_votes_new RENAME TO chat_votes;
ALTER TABLE chat_attachments_new RENAME TO chat_attachments;
ALTER TABLE integrations_new RENAME TO integrations;
ALTER TABLE integration_item_mappings_new RENAME TO integration_item_mappings;

-- ============================================
-- STEP 3: Update RPC Functions to Final Names
-- ============================================

-- Drop the _new functions
DROP FUNCTION IF EXISTS get_user_entities_new(UUID, TEXT, TEXT);
DROP FUNCTION IF EXISTS upsert_user_entity_new(UUID, TEXT, TEXT, TEXT, JSONB, JSONB, TEXT, BIGINT, TEXT);

-- Drop old functions (they reference old tables)
DROP FUNCTION IF EXISTS get_user_entities(TEXT, TEXT, TEXT);
DROP FUNCTION IF EXISTS upsert_user_entity(TEXT, TEXT, TEXT, TEXT, JSONB, JSONB, TEXT, BIGINT, TEXT);

-- Create final versions using user_id UUID
CREATE OR REPLACE FUNCTION get_user_entities(
  p_user_id UUID,
  p_entity_type TEXT DEFAULT NULL,
  p_course_id TEXT DEFAULT NULL
)
RETURNS TABLE (
  id BIGINT,
  entity_type TEXT,
  entity_id TEXT,
  course_id TEXT,
  data JSONB,
  metadata JSONB,
  file_storage_path TEXT,
  file_size BIGINT,
  file_mime_type TEXT,
  created_at TIMESTAMPTZ,
  updated_at TIMESTAMPTZ
) AS $$
BEGIN
  RETURN QUERY
  SELECT
    ed.id, ed.entity_type, ed.entity_id, ed.course_id,
    ed.data, ed.metadata, ed.file_storage_path, ed.file_size,
    ed.file_mime_type, ed.created_at, ed.updated_at
  FROM extraction_data ed
  WHERE ed.user_id = p_user_id
    AND (p_entity_type IS NULL OR ed.entity_type = p_entity_type)
    AND (p_course_id IS NULL OR ed.course_id = p_course_id)
  ORDER BY ed.created_at DESC
  LIMIT 50000;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE OR REPLACE FUNCTION upsert_user_entity(
  p_user_id UUID,
  p_entity_type TEXT,
  p_entity_id TEXT,
  p_course_id TEXT,
  p_data JSONB,
  p_metadata JSONB DEFAULT NULL,
  p_file_path TEXT DEFAULT NULL,
  p_file_size BIGINT DEFAULT NULL,
  p_mime_type TEXT DEFAULT NULL
)
RETURNS BIGINT AS $$
DECLARE
  result_id BIGINT;
BEGIN
  INSERT INTO extraction_data (
    user_id, entity_type, entity_id, course_id,
    data, metadata, file_storage_path, file_size, file_mime_type
  )
  VALUES (
    p_user_id, p_entity_type, p_entity_id, COALESCE(p_course_id, ''),
    p_data, COALESCE(p_metadata, '{}'), p_file_path, p_file_size, p_mime_type
  )
  ON CONFLICT (user_id, entity_type, entity_id, COALESCE(course_id, ''))
  DO UPDATE SET
    data = EXCLUDED.data,
    metadata = COALESCE(EXCLUDED.metadata, extraction_data.metadata),
    file_storage_path = COALESCE(EXCLUDED.file_storage_path, extraction_data.file_storage_path),
    file_size = COALESCE(EXCLUDED.file_size, extraction_data.file_size),
    file_mime_type = COALESCE(EXCLUDED.file_mime_type, extraction_data.file_mime_type),
    updated_at = NOW()
  RETURNING id INTO result_id;
  RETURN result_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Grant permissions
GRANT EXECUTE ON FUNCTION get_user_entities(UUID, TEXT, TEXT) TO authenticated, anon;
GRANT EXECUTE ON FUNCTION upsert_user_entity(UUID, TEXT, TEXT, TEXT, JSONB, JSONB, TEXT, BIGINT, TEXT) TO authenticated, anon;

-- ============================================
-- STEP 4: Update Trigger Functions to Use Final Table Names
-- ============================================

-- Response count trigger
CREATE OR REPLACE FUNCTION update_post_response_count()
RETURNS TRIGGER AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    UPDATE chat_posts SET response_count = response_count + 1 WHERE id = NEW.post_id;
    RETURN NEW;
  ELSIF TG_OP = 'DELETE' THEN
    UPDATE chat_posts SET response_count = GREATEST(0, response_count - 1) WHERE id = OLD.post_id;
    RETURN OLD;
  END IF;
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;

-- Net score trigger
CREATE OR REPLACE FUNCTION update_net_score()
RETURNS TRIGGER AS $$
DECLARE
  target_table TEXT;
  score_change INTEGER;
BEGIN
  IF TG_OP = 'DELETE' THEN
    score_change = CASE WHEN OLD.vote_type = 'up' THEN -1 ELSE 1 END;
    target_table = OLD.target_type;
  ELSIF TG_OP = 'INSERT' THEN
    score_change = CASE WHEN NEW.vote_type = 'up' THEN 1 ELSE -1 END;
    target_table = NEW.target_type;
  ELSIF TG_OP = 'UPDATE' THEN
    score_change = CASE
      WHEN OLD.vote_type = 'up' AND NEW.vote_type = 'down' THEN -2
      WHEN OLD.vote_type = 'down' AND NEW.vote_type = 'up' THEN 2
      ELSE 0
    END;
    target_table = NEW.target_type;
  END IF;

  IF target_table = 'post' THEN
    UPDATE chat_posts SET net_score = net_score + score_change
    WHERE id = COALESCE(NEW.target_id, OLD.target_id);
  ELSIF target_table = 'response' THEN
    UPDATE chat_responses SET net_score = net_score + score_change
    WHERE id = COALESCE(NEW.target_id, OLD.target_id);
  END IF;

  RETURN COALESCE(NEW, OLD);
END;
$$ LANGUAGE plpgsql;

-- ============================================
-- STEP 5: Rename Triggers
-- ============================================

-- Note: Tables have already been renamed from _new to final names in STEP 2
-- So we reference the final table names (chat_responses, chat_votes)

-- Drop old triggers (they reference the now-renamed tables)
DROP TRIGGER IF EXISTS trigger_update_response_count_new ON chat_responses;
DROP TRIGGER IF EXISTS trigger_update_net_score_new ON chat_votes;

-- Drop _new trigger functions (using CASCADE to handle any remaining dependencies)
DROP FUNCTION IF EXISTS update_post_response_count_new() CASCADE;
DROP FUNCTION IF EXISTS update_net_score_new() CASCADE;

-- Create final triggers (tables are already renamed to chat_responses and chat_votes)
DROP TRIGGER IF EXISTS trigger_update_response_count ON chat_responses;
CREATE TRIGGER trigger_update_response_count
AFTER INSERT OR DELETE ON chat_responses
FOR EACH ROW EXECUTE FUNCTION update_post_response_count();

DROP TRIGGER IF EXISTS trigger_update_net_score ON chat_votes;
CREATE TRIGGER trigger_update_net_score
AFTER INSERT OR UPDATE OR DELETE ON chat_votes
FOR EACH ROW EXECUTE FUNCTION update_net_score();

-- ============================================
-- STEP 6: Rename Indexes
-- ============================================
-- Note: Old tables (now _deprecated) may have indexes with target names
-- Drop those first to avoid conflicts

-- Drop old indexes if they exist (they belong to deprecated tables)
DROP INDEX IF EXISTS idx_users_email;
DROP INDEX IF EXISTS idx_users_school;
DROP INDEX IF EXISTS idx_users_student;
DROP INDEX IF EXISTS idx_extraction_user_type;
DROP INDEX IF EXISTS idx_extraction_user_type_course;
DROP INDEX IF EXISTS idx_extraction_data_gin;
DROP INDEX IF EXISTS idx_extraction_updated;
DROP INDEX IF EXISTS idx_chat_posts_course;
DROP INDEX IF EXISTS idx_chat_posts_user;
DROP INDEX IF EXISTS idx_chat_posts_created;
DROP INDEX IF EXISTS idx_chat_posts_title_gin;
DROP INDEX IF EXISTS idx_chat_responses_post;
DROP INDEX IF EXISTS idx_chat_responses_score;
DROP INDEX IF EXISTS idx_chat_votes_target;
DROP INDEX IF EXISTS idx_chat_attach_post;
DROP INDEX IF EXISTS idx_chat_attach_response;
DROP INDEX IF EXISTS idx_integrations_user;
DROP INDEX IF EXISTS idx_integrations_active;
DROP INDEX IF EXISTS idx_item_mappings_integration;
DROP INDEX IF EXISTS idx_pending_status;

-- Users
ALTER INDEX IF EXISTS idx_users_new_email RENAME TO idx_users_email;
ALTER INDEX IF EXISTS idx_users_new_school RENAME TO idx_users_school;
ALTER INDEX IF EXISTS idx_users_new_student RENAME TO idx_users_student;

-- Extraction data
ALTER INDEX IF EXISTS idx_extraction_new_user_type RENAME TO idx_extraction_user_type;
ALTER INDEX IF EXISTS idx_extraction_new_user_type_course RENAME TO idx_extraction_user_type_course;
ALTER INDEX IF EXISTS idx_extraction_new_data_gin RENAME TO idx_extraction_data_gin;
ALTER INDEX IF EXISTS idx_extraction_new_updated RENAME TO idx_extraction_updated;

-- Chat posts
ALTER INDEX IF EXISTS idx_chat_posts_new_course RENAME TO idx_chat_posts_course;
ALTER INDEX IF EXISTS idx_chat_posts_new_user RENAME TO idx_chat_posts_user;
ALTER INDEX IF EXISTS idx_chat_posts_new_created RENAME TO idx_chat_posts_created;
ALTER INDEX IF EXISTS idx_chat_posts_new_title_gin RENAME TO idx_chat_posts_title_gin;

-- Chat responses
ALTER INDEX IF EXISTS idx_chat_responses_new_post RENAME TO idx_chat_responses_post;
ALTER INDEX IF EXISTS idx_chat_responses_new_score RENAME TO idx_chat_responses_score;

-- Chat votes
ALTER INDEX IF EXISTS idx_chat_votes_new_target RENAME TO idx_chat_votes_target;

-- Chat attachments
ALTER INDEX IF EXISTS idx_chat_attach_new_post RENAME TO idx_chat_attach_post;
ALTER INDEX IF EXISTS idx_chat_attach_new_response RENAME TO idx_chat_attach_response;

-- Integrations
ALTER INDEX IF EXISTS idx_integrations_new_user RENAME TO idx_integrations_user;
ALTER INDEX IF EXISTS idx_integrations_new_active RENAME TO idx_integrations_active;

-- Integration item mappings
ALTER INDEX IF EXISTS idx_item_mappings_new_integration RENAME TO idx_item_mappings_integration;

-- Pending extractions
ALTER INDEX IF EXISTS idx_pending_new_status RENAME TO idx_pending_status;

-- ============================================
-- STEP 7: Rename Triggers
-- ============================================

-- These are named correctly already after recreation above
-- Just rename the updated_at triggers

-- ============================================
-- STEP 8: Update RLS Policies
-- ============================================

-- Users
DROP POLICY IF EXISTS "Allow all users_new" ON users;
CREATE POLICY "Allow all on users" ON users FOR ALL USING (true) WITH CHECK (true);

-- Extraction data
DROP POLICY IF EXISTS "Users access own extraction data" ON extraction_data;
CREATE POLICY "Users access own data" ON extraction_data FOR ALL
  USING (user_id = (current_setting('app.current_user_id', true))::UUID);

-- Integrations
DROP POLICY IF EXISTS "Deny all integrations_new" ON integrations;
CREATE POLICY "Deny all integrations" ON integrations FOR ALL USING (FALSE);

DROP POLICY IF EXISTS "Deny all item_mappings_new" ON integration_item_mappings;
CREATE POLICY "Deny all mappings" ON integration_item_mappings FOR ALL USING (FALSE);

-- Invite codes
DROP POLICY IF EXISTS "Deny all invite_codes_new" ON invite_codes;
CREATE POLICY "Deny all invite_codes" ON invite_codes FOR ALL USING (FALSE);

-- Pending extractions
DROP POLICY IF EXISTS "Deny all pending_new" ON pending_extractions;
CREATE POLICY "Deny all pending" ON pending_extractions FOR ALL USING (FALSE);

-- ============================================
-- STEP 9: Cleanup
-- ============================================

-- Drop user_id_mapping table (no longer needed)
DROP TABLE IF EXISTS user_id_mapping;

-- ============================================
-- FINALIZATION COMPLETE
-- ============================================
-- Old tables are now suffixed with _deprecated.
-- New tables have final names.
--
-- To drop deprecated tables after 1 week verification:
-- DROP TABLE users_deprecated CASCADE;
-- DROP TABLE extraction_data_deprecated CASCADE;
-- DROP TABLE chat_posts_deprecated CASCADE;
-- DROP TABLE chat_responses_deprecated CASCADE;
-- DROP TABLE chat_votes_deprecated CASCADE;
-- DROP TABLE chat_attachments_deprecated CASCADE;
-- DROP TABLE user_unlock_credits_deprecated CASCADE;
-- DROP TABLE user_onboarding_state_deprecated CASCADE;
-- DROP TABLE thread_access_tracking_deprecated CASCADE;
-- DROP TABLE integrations_deprecated CASCADE;
-- DROP TABLE integration_item_mappings_deprecated CASCADE;
-- DROP TABLE invite_codes_deprecated CASCADE;
-- DROP TABLE pending_extractions_deprecated CASCADE;
-- DROP TABLE sessions_deprecated CASCADE;
-- DROP TABLE completed_extractions_deprecated CASCADE;
-- DROP TABLE waitlist_deprecated CASCADE;
-- ============================================
