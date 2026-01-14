-- ============================================
-- DATA MIGRATION SCRIPT
-- ============================================
-- This migration copies data from old tables to new simplified tables.
-- Run this AFTER 20260114000000_simplified_schema.sql
-- ============================================

-- ============================================
-- STEP 1: Create User ID Mapping Table
-- ============================================
CREATE TABLE IF NOT EXISTS user_id_mapping (
  old_id TEXT,
  old_email TEXT,
  new_id UUID
);

-- ============================================
-- STEP 2: Migrate Invite Codes (must be first, FK dependency)
-- ============================================
INSERT INTO invite_codes_new (code, max_users, current_users, is_active, created_at, updated_at)
SELECT code, max_users, current_users, is_active, created_at, updated_at
FROM invite_codes
ON CONFLICT (code) DO NOTHING;

-- ============================================
-- STEP 3: Migrate Users
-- ============================================
INSERT INTO users_new (
  id, email, first_name, student, school,
  canvas_cookies, canvas_cookies_updated_at,
  invite_code_used, onboarding_completed_at, last_login_at,
  preferences, forum_data, created_at, updated_at
)
SELECT
  gen_random_uuid() as id,
  email,
  COALESCE(first_name, 'User') as first_name,
  student,
  COALESCE(school, 'Unknown') as school,
  canvas_cookies,
  canvas_cookies_updated_at,
  invite_code_used,
  onboarding_completed_at,
  last_login_at,
  COALESCE(profile_preferences, '{}')::jsonb as preferences,
  '{}'::jsonb as forum_data,
  created_at,
  updated_at
FROM users
WHERE email IS NOT NULL
ON CONFLICT (email) DO NOTHING;

-- Store the ID mapping for later use
INSERT INTO user_id_mapping (old_id, old_email, new_id)
SELECT u_old.id, u_old.email, u_new.id
FROM users u_old
JOIN users_new u_new ON u_old.email = u_new.email;

-- ============================================
-- STEP 4: Merge Forum Stats into Users
-- ============================================

-- Migrate user_unlock_credits into users_new.forum_data
DO $$
DECLARE
  rec RECORD;
BEGIN
  FOR rec IN
    SELECT uc.user_id as old_user_id, uc.course_id, uc.total_earned, uc.total_used, uc.first_unlock_used, m.new_id
    FROM user_unlock_credits uc
    JOIN user_id_mapping m ON uc.user_id = m.old_id
  LOOP
    UPDATE users_new
    SET forum_data = jsonb_set(
      COALESCE(forum_data, '{}'),
      ARRAY['courseStats', rec.course_id::text],
      jsonb_build_object(
        'totalEarned', rec.total_earned,
        'totalUsed', rec.total_used,
        'firstUnlockUsed', rec.first_unlock_used
      ),
      true
    )
    WHERE id = rec.new_id;
  END LOOP;
END $$;

-- Merge user_onboarding_state into users_new.forum_data
DO $$
DECLARE
  rec RECORD;
BEGIN
  FOR rec IN
    SELECT os.user_id as old_user_id, os.course_id, os.has_seen_onboarding, os.seen_at, m.new_id
    FROM user_onboarding_state os
    JOIN user_id_mapping m ON os.user_id = m.old_id
  LOOP
    UPDATE users_new
    SET forum_data = jsonb_set(
      COALESCE(forum_data, '{}'),
      ARRAY['courseStats', rec.course_id::text, 'hasSeenOnboarding'],
      to_jsonb(rec.has_seen_onboarding),
      true
    )
    WHERE id = rec.new_id;
  END LOOP;
END $$;

-- ============================================
-- STEP 5: Migrate Extraction Data
-- ============================================
INSERT INTO extraction_data_new (
  user_id, entity_type, entity_id, course_id,
  data, metadata, file_storage_path, file_size, file_mime_type,
  created_at, updated_at
)
SELECT
  m.new_id as user_id,
  ed.entity_type,
  ed.entity_id,
  ed.course_id,
  ed.data,
  ed.metadata,
  ed.file_storage_path,
  ed.file_size,
  ed.file_mime_type,
  ed.created_at,
  ed.updated_at
FROM extraction_data ed
JOIN user_id_mapping m ON ed.user_email = m.old_email
ON CONFLICT DO NOTHING;

-- ============================================
-- STEP 6: Migrate Chat Posts
-- ============================================
INSERT INTO chat_posts_new (
  id, course_id, user_id, anonymous_thread_id,
  title, body, tag, response_count, net_score,
  is_edited, edited_at, created_at, updated_at
)
SELECT
  cp.id,
  cp.course_id::text as course_id,
  m.new_id as user_id,
  cp.anonymous_thread_id,
  cp.title,
  cp.body,
  cp.tag,
  cp.response_count,
  cp.net_score,
  cp.is_edited,
  cp.edited_at,
  cp.created_at,
  cp.updated_at
FROM chat_posts cp
JOIN user_id_mapping m ON cp.user_id = m.old_id
ON CONFLICT (id) DO NOTHING;

-- ============================================
-- STEP 7: Migrate Chat Responses
-- ============================================
INSERT INTO chat_responses_new (
  id, post_id, user_id, anonymous_thread_id,
  body, net_score, is_edited, edited_at, created_at, updated_at
)
SELECT
  cr.id,
  cr.post_id,
  m.new_id as user_id,
  cr.anonymous_thread_id,
  cr.body,
  cr.net_score,
  cr.is_edited,
  NULL as edited_at,
  cr.created_at,
  cr.updated_at
FROM chat_responses cr
JOIN user_id_mapping m ON cr.user_id = m.old_id
WHERE EXISTS (SELECT 1 FROM chat_posts_new WHERE id = cr.post_id)
ON CONFLICT (id) DO NOTHING;

-- ============================================
-- STEP 8: Migrate Chat Votes
-- ============================================
INSERT INTO chat_votes_new (
  id, user_id, target_id, target_type, vote_type, created_at
)
SELECT
  cv.id,
  m.new_id as user_id,
  cv.target_id,
  cv.target_type::text as target_type,
  cv.vote_type::text as vote_type,
  cv.created_at
FROM chat_votes cv
JOIN user_id_mapping m ON cv.user_id = m.old_id
ON CONFLICT (user_id, target_id, target_type) DO NOTHING;

-- ============================================
-- STEP 9: Migrate Chat Attachments
-- ============================================
INSERT INTO chat_attachments_new (
  id, post_id, response_id, file_path, file_name, file_size, mime_type, display_order, created_at
)
SELECT
  ca.id,
  CASE WHEN EXISTS (SELECT 1 FROM chat_posts_new WHERE id = ca.post_id) THEN ca.post_id ELSE NULL END,
  CASE WHEN EXISTS (SELECT 1 FROM chat_responses_new WHERE id = ca.response_id) THEN ca.response_id ELSE NULL END,
  ca.file_path,
  ca.file_name,
  ca.file_size,
  ca.mime_type,
  ca.display_order,
  ca.created_at
FROM chat_attachments ca
WHERE (EXISTS (SELECT 1 FROM chat_posts_new WHERE id = ca.post_id)
   OR EXISTS (SELECT 1 FROM chat_responses_new WHERE id = ca.response_id))
ON CONFLICT (id) DO NOTHING;

-- ============================================
-- STEP 10: Migrate Integrations
-- ============================================
INSERT INTO integrations_new (
  id, user_id, provider, status, token_ciphertext, token_expires_at,
  external_target_id, target_display_name, target_config,
  last_sync_at, last_sync_status, last_sync_error, created_at, updated_at
)
SELECT
  i.id,
  m.new_id as user_id,
  i.provider,
  i.status,
  i.token_ciphertext,
  i.token_expires_at,
  i.external_target_id,
  i.target_display_name,
  i.target_config,
  i.last_sync_at,
  i.last_sync_status,
  i.last_sync_error,
  i.created_at,
  i.updated_at
FROM integrations i
JOIN user_id_mapping m ON i.user_email = m.old_email
ON CONFLICT (user_id, provider) DO NOTHING;

-- ============================================
-- STEP 11: Migrate Integration Item Mappings
-- ============================================
INSERT INTO integration_item_mappings_new (
  id, integration_id, item_type, internal_id, external_id, content_hash, created_at, updated_at
)
SELECT
  im.id,
  im.integration_id,
  im.item_type,
  im.internal_id,
  im.external_id,
  im.content_hash,
  im.created_at,
  im.updated_at
FROM integration_item_mappings im
WHERE EXISTS (SELECT 1 FROM integrations_new WHERE id = im.integration_id)
ON CONFLICT (integration_id, item_type, internal_id) DO NOTHING;

-- ============================================
-- STEP 12: Migrate Pending Extractions
-- ============================================
INSERT INTO pending_extractions_new (
  id, user_email, user_name, school, cookies, invite_code_used,
  status, retry_count, last_error, created_at, updated_at
)
SELECT
  id, user_email, user_name, school, cookies,
  CASE WHEN EXISTS (SELECT 1 FROM invite_codes_new WHERE code = pe.invite_code_used)
       THEN pe.invite_code_used ELSE NULL END,
  status, retry_count, last_error, created_at, updated_at
FROM pending_extractions pe
ON CONFLICT (user_email) DO NOTHING;

-- ============================================
-- MIGRATION VERIFICATION QUERIES
-- ============================================

-- Run these to verify data was migrated correctly:
-- SELECT 'users' as table_name, COUNT(*) as old_count FROM users
-- UNION ALL SELECT 'users_new', COUNT(*) FROM users_new;

-- SELECT 'extraction_data' as table_name, COUNT(*) as old_count FROM extraction_data
-- UNION ALL SELECT 'extraction_data_new', COUNT(*) FROM extraction_data_new;

-- SELECT 'chat_posts' as table_name, COUNT(*) as old_count FROM chat_posts
-- UNION ALL SELECT 'chat_posts_new', COUNT(*) FROM chat_posts_new;

-- SELECT 'integrations' as table_name, COUNT(*) as old_count FROM integrations
-- UNION ALL SELECT 'integrations_new', COUNT(*) FROM integrations_new;

-- Verify forum_data was populated:
-- SELECT id, email, forum_data FROM users_new WHERE forum_data != '{}' LIMIT 5;

-- ============================================
-- MIGRATION COMPLETE
-- ============================================
-- Next step: Run 20260114000002_finalize_migration.sql to rename tables
-- ============================================
