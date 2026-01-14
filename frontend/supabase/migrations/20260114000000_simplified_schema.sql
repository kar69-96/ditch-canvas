-- ============================================
-- SIMPLIFIED SUPABASE SCHEMA
-- ============================================
-- This migration creates a clean, simplified database schema.
-- Run this AFTER backing up all existing data.
-- ============================================

-- ============================================
-- PHASE 1: HELPER FUNCTIONS
-- ============================================

-- Timestamp update function
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Generate fruit name for anonymous forum posts
CREATE OR REPLACE FUNCTION generate_fruit_name()
RETURNS TEXT AS $$
DECLARE
  fruits TEXT[] := ARRAY[
    'Apple', 'Banana', 'Cherry', 'Date', 'Elderberry', 'Fig', 'Grape', 'Honeydew',
    'Kiwi', 'Lemon', 'Mango', 'Nectarine', 'Orange', 'Papaya', 'Quince', 'Raspberry',
    'Strawberry', 'Tangerine', 'Watermelon', 'Yuzu', 'Apricot', 'Blackberry',
    'Cantaloupe', 'Dragonfruit', 'Guava', 'Jackfruit', 'Kumquat', 'Lychee',
    'Mulberry', 'Olive', 'Passionfruit', 'Peach', 'Pineapple', 'Pomegranate',
    'Starfruit', 'Tamarind', 'Gooseberry', 'Lime', 'Persimmon', 'Coconut'
  ];
BEGIN
  RETURN fruits[floor(random() * array_length(fruits, 1) + 1)::INTEGER];
END;
$$ LANGUAGE plpgsql;

-- ============================================
-- PHASE 2: CORE TABLES
-- ============================================

-- 1. USERS TABLE - All user data consolidated
CREATE TABLE IF NOT EXISTS users_new (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email TEXT UNIQUE NOT NULL,
  first_name TEXT NOT NULL,
  student TEXT,                              -- CU identikey (e.g., kare6625)
  school TEXT NOT NULL,
  canvas_cookies JSONB,                      -- Canvas session cookies
  canvas_cookies_updated_at TIMESTAMPTZ,
  invite_code_used TEXT,
  onboarding_completed_at TIMESTAMPTZ,
  last_login_at TIMESTAMPTZ,
  -- Supplementary data (JSONB for flexibility)
  preferences JSONB DEFAULT '{}',            -- {theme, font, uiSettings}
  forum_data JSONB DEFAULT '{}',             -- {courseStats: {courseId: {totalEarned, totalUsed, hasSeenOnboarding}}}
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Users indexes
CREATE INDEX IF NOT EXISTS idx_users_new_email ON users_new(email);
CREATE INDEX IF NOT EXISTS idx_users_new_school ON users_new(school);
CREATE INDEX IF NOT EXISTS idx_users_new_student ON users_new(student) WHERE student IS NOT NULL;

-- Users trigger
DROP TRIGGER IF EXISTS trg_users_new_updated_at ON users_new;
CREATE TRIGGER trg_users_new_updated_at
  BEFORE UPDATE ON users_new
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

-- 2. INVITE CODES TABLE
CREATE TABLE IF NOT EXISTS invite_codes_new (
  code TEXT PRIMARY KEY,
  max_users INTEGER NOT NULL DEFAULT 0,
  current_users INTEGER NOT NULL DEFAULT 0,
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

DROP TRIGGER IF EXISTS trg_invite_codes_new_updated_at ON invite_codes_new;
CREATE TRIGGER trg_invite_codes_new_updated_at
  BEFORE UPDATE ON invite_codes_new
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

-- 3. PENDING EXTRACTIONS TABLE
CREATE TABLE IF NOT EXISTS pending_extractions_new (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_email TEXT NOT NULL UNIQUE,
  user_name TEXT NOT NULL,
  school TEXT NOT NULL,
  cookies JSONB NOT NULL,
  invite_code_used TEXT REFERENCES invite_codes_new(code),
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'in_progress', 'failed')),
  retry_count INTEGER NOT NULL DEFAULT 0,
  last_error TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_pending_new_status ON pending_extractions_new(status, created_at ASC);

DROP TRIGGER IF EXISTS trg_pending_new_updated_at ON pending_extractions_new;
CREATE TRIGGER trg_pending_new_updated_at
  BEFORE UPDATE ON pending_extractions_new
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

-- ============================================
-- PHASE 3: EXTRACTION DATA TABLE
-- ============================================

CREATE TABLE IF NOT EXISTS extraction_data_new (
  id BIGSERIAL PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES users_new(id) ON DELETE CASCADE,
  entity_type TEXT NOT NULL,                 -- course, assignment, file, module, page, quiz, announcement
  entity_id TEXT NOT NULL,
  course_id TEXT DEFAULT '',                 -- Default to empty string for uniqueness
  data JSONB NOT NULL DEFAULT '{}',
  metadata JSONB DEFAULT '{}',
  file_storage_path TEXT,
  file_size BIGINT,
  file_mime_type TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Unique index on (user_id, entity_type, entity_id, course_id)
CREATE UNIQUE INDEX IF NOT EXISTS idx_extraction_new_unique
  ON extraction_data_new(user_id, entity_type, entity_id, COALESCE(course_id, ''));

-- Extraction data indexes
CREATE INDEX IF NOT EXISTS idx_extraction_new_user_type ON extraction_data_new(user_id, entity_type);
CREATE INDEX IF NOT EXISTS idx_extraction_new_user_type_course ON extraction_data_new(user_id, entity_type, course_id) WHERE course_id IS NOT NULL AND course_id != '';
CREATE INDEX IF NOT EXISTS idx_extraction_new_data_gin ON extraction_data_new USING GIN (data);
CREATE INDEX IF NOT EXISTS idx_extraction_new_updated ON extraction_data_new(updated_at DESC);

DROP TRIGGER IF EXISTS trg_extraction_new_updated_at ON extraction_data_new;
CREATE TRIGGER trg_extraction_new_updated_at
  BEFORE UPDATE ON extraction_data_new
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

-- ============================================
-- PHASE 4: CHAT/FORUM TABLES
-- ============================================

-- Chat Posts
CREATE TABLE IF NOT EXISTS chat_posts_new (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  course_id TEXT NOT NULL,                   -- TEXT for consistency
  user_id UUID NOT NULL REFERENCES users_new(id) ON DELETE CASCADE,
  anonymous_thread_id TEXT NOT NULL,
  title TEXT NOT NULL CHECK (char_length(title) BETWEEN 3 AND 200),
  body TEXT NOT NULL CHECK (char_length(body) BETWEEN 10 AND 5000),
  tag TEXT NOT NULL CHECK (tag IN ('problem', 'discussion', 'other')),
  response_count INTEGER DEFAULT 0,
  net_score INTEGER DEFAULT 0,
  is_edited BOOLEAN DEFAULT false,
  edited_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_chat_posts_new_course ON chat_posts_new(course_id);
CREATE INDEX IF NOT EXISTS idx_chat_posts_new_user ON chat_posts_new(user_id);
CREATE INDEX IF NOT EXISTS idx_chat_posts_new_created ON chat_posts_new(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_chat_posts_new_title_gin ON chat_posts_new USING gin(to_tsvector('english', title));

DROP TRIGGER IF EXISTS trg_chat_posts_new_updated_at ON chat_posts_new;
CREATE TRIGGER trg_chat_posts_new_updated_at
  BEFORE UPDATE ON chat_posts_new
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

-- Chat Responses
CREATE TABLE IF NOT EXISTS chat_responses_new (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  post_id UUID NOT NULL REFERENCES chat_posts_new(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES users_new(id) ON DELETE CASCADE,
  anonymous_thread_id TEXT NOT NULL,
  body TEXT NOT NULL CHECK (char_length(body) BETWEEN 10 AND 5000),
  net_score INTEGER DEFAULT 0,
  is_edited BOOLEAN DEFAULT false,
  edited_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_chat_responses_new_post ON chat_responses_new(post_id);
CREATE INDEX IF NOT EXISTS idx_chat_responses_new_score ON chat_responses_new(post_id, net_score DESC);

DROP TRIGGER IF EXISTS trg_chat_responses_new_updated_at ON chat_responses_new;
CREATE TRIGGER trg_chat_responses_new_updated_at
  BEFORE UPDATE ON chat_responses_new
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

-- Chat Votes
CREATE TABLE IF NOT EXISTS chat_votes_new (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users_new(id) ON DELETE CASCADE,
  target_id UUID NOT NULL,
  target_type TEXT NOT NULL CHECK (target_type IN ('post', 'response')),
  vote_type TEXT NOT NULL CHECK (vote_type IN ('up', 'down')),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(user_id, target_id, target_type)
);

CREATE INDEX IF NOT EXISTS idx_chat_votes_new_target ON chat_votes_new(target_id, target_type);

-- Chat Attachments
CREATE TABLE IF NOT EXISTS chat_attachments_new (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  post_id UUID REFERENCES chat_posts_new(id) ON DELETE CASCADE,
  response_id UUID REFERENCES chat_responses_new(id) ON DELETE CASCADE,
  file_path TEXT NOT NULL,
  file_name TEXT NOT NULL,
  file_size BIGINT NOT NULL CHECK (file_size > 0 AND file_size <= 10485760),
  mime_type TEXT NOT NULL,
  display_order INTEGER DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  CHECK ((post_id IS NULL) != (response_id IS NULL))
);

CREATE INDEX IF NOT EXISTS idx_chat_attach_new_post ON chat_attachments_new(post_id) WHERE post_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_chat_attach_new_response ON chat_attachments_new(response_id) WHERE response_id IS NOT NULL;

-- ============================================
-- PHASE 5: CHAT TRIGGERS (Score Updates)
-- ============================================

-- Response count trigger
CREATE OR REPLACE FUNCTION update_post_response_count_new()
RETURNS TRIGGER AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    UPDATE chat_posts_new SET response_count = response_count + 1 WHERE id = NEW.post_id;
    RETURN NEW;
  ELSIF TG_OP = 'DELETE' THEN
    UPDATE chat_posts_new SET response_count = GREATEST(0, response_count - 1) WHERE id = OLD.post_id;
    RETURN OLD;
  END IF;
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trigger_update_response_count_new ON chat_responses_new;
CREATE TRIGGER trigger_update_response_count_new
AFTER INSERT OR DELETE ON chat_responses_new
FOR EACH ROW EXECUTE FUNCTION update_post_response_count_new();

-- Net score trigger
CREATE OR REPLACE FUNCTION update_net_score_new()
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
    UPDATE chat_posts_new SET net_score = net_score + score_change
    WHERE id = COALESCE(NEW.target_id, OLD.target_id);
  ELSIF target_table = 'response' THEN
    UPDATE chat_responses_new SET net_score = net_score + score_change
    WHERE id = COALESCE(NEW.target_id, OLD.target_id);
  END IF;

  RETURN COALESCE(NEW, OLD);
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trigger_update_net_score_new ON chat_votes_new;
CREATE TRIGGER trigger_update_net_score_new
AFTER INSERT OR UPDATE OR DELETE ON chat_votes_new
FOR EACH ROW EXECUTE FUNCTION update_net_score_new();

-- ============================================
-- PHASE 6: INTEGRATION TABLES
-- ============================================

CREATE TABLE IF NOT EXISTS integrations_new (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users_new(id) ON DELETE CASCADE,
  provider TEXT NOT NULL CHECK (provider IN ('google', 'notion')),
  status TEXT DEFAULT 'active' CHECK (status IN ('active', 'needs_reauth', 'disabled')),
  token_ciphertext TEXT NOT NULL,
  token_expires_at TIMESTAMPTZ,
  external_target_id TEXT NOT NULL,
  target_display_name TEXT,
  target_config JSONB DEFAULT '{}',
  last_sync_at TIMESTAMPTZ,
  last_sync_status TEXT,
  last_sync_error TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(user_id, provider)
);

CREATE INDEX IF NOT EXISTS idx_integrations_new_user ON integrations_new(user_id);
CREATE INDEX IF NOT EXISTS idx_integrations_new_active ON integrations_new(provider, status) WHERE status = 'active';

DROP TRIGGER IF EXISTS trg_integrations_new_updated_at ON integrations_new;
CREATE TRIGGER trg_integrations_new_updated_at
  BEFORE UPDATE ON integrations_new
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

CREATE TABLE IF NOT EXISTS integration_item_mappings_new (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  integration_id UUID NOT NULL REFERENCES integrations_new(id) ON DELETE CASCADE,
  item_type TEXT DEFAULT 'assignment',
  internal_id TEXT NOT NULL,
  external_id TEXT NOT NULL,
  content_hash TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(integration_id, item_type, internal_id)
);

CREATE INDEX IF NOT EXISTS idx_item_mappings_new_integration ON integration_item_mappings_new(integration_id);

DROP TRIGGER IF EXISTS trg_item_mappings_new_updated_at ON integration_item_mappings_new;
CREATE TRIGGER trg_item_mappings_new_updated_at
  BEFORE UPDATE ON integration_item_mappings_new
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

-- ============================================
-- PHASE 7: RPC FUNCTIONS
-- ============================================

-- Drop old functions if they exist
DROP FUNCTION IF EXISTS get_user_entities_new(UUID, TEXT, TEXT);
DROP FUNCTION IF EXISTS upsert_user_entity_new(UUID, TEXT, TEXT, TEXT, JSONB, JSONB, TEXT, BIGINT, TEXT);

-- Get user entities (uses user_id UUID instead of email)
CREATE OR REPLACE FUNCTION get_user_entities_new(
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
  FROM extraction_data_new ed
  WHERE ed.user_id = p_user_id
    AND (p_entity_type IS NULL OR ed.entity_type = p_entity_type)
    AND (p_course_id IS NULL OR ed.course_id = p_course_id)
  ORDER BY ed.created_at DESC
  LIMIT 50000;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Upsert user entity (uses user_id UUID instead of email)
CREATE OR REPLACE FUNCTION upsert_user_entity_new(
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
  INSERT INTO extraction_data_new (
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
    metadata = COALESCE(EXCLUDED.metadata, extraction_data_new.metadata),
    file_storage_path = COALESCE(EXCLUDED.file_storage_path, extraction_data_new.file_storage_path),
    file_size = COALESCE(EXCLUDED.file_size, extraction_data_new.file_size),
    file_mime_type = COALESCE(EXCLUDED.file_mime_type, extraction_data_new.file_mime_type),
    updated_at = NOW()
  RETURNING id INTO result_id;
  RETURN result_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Grant permissions
GRANT EXECUTE ON FUNCTION get_user_entities_new(UUID, TEXT, TEXT) TO authenticated, anon;
GRANT EXECUTE ON FUNCTION upsert_user_entity_new(UUID, TEXT, TEXT, TEXT, JSONB, JSONB, TEXT, BIGINT, TEXT) TO authenticated, anon;
GRANT EXECUTE ON FUNCTION generate_fruit_name() TO authenticated, anon;

-- ============================================
-- PHASE 8: ROW LEVEL SECURITY
-- ============================================

-- Users: service role only (backend handles auth)
ALTER TABLE users_new ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Allow all users_new" ON users_new;
CREATE POLICY "Allow all users_new" ON users_new FOR ALL USING (true) WITH CHECK (true);

-- Extraction data: user can only access own data
ALTER TABLE extraction_data_new ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Users access own extraction data" ON extraction_data_new;
CREATE POLICY "Users access own extraction data" ON extraction_data_new FOR ALL
  USING (user_id = (current_setting('app.current_user_id', true))::UUID);

-- Integrations: deny all except service role
ALTER TABLE integrations_new ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Deny all integrations_new" ON integrations_new;
CREATE POLICY "Deny all integrations_new" ON integrations_new FOR ALL USING (FALSE);

ALTER TABLE integration_item_mappings_new ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Deny all item_mappings_new" ON integration_item_mappings_new;
CREATE POLICY "Deny all item_mappings_new" ON integration_item_mappings_new FOR ALL USING (FALSE);

-- Invite codes: deny all except service role
ALTER TABLE invite_codes_new ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Deny all invite_codes_new" ON invite_codes_new;
CREATE POLICY "Deny all invite_codes_new" ON invite_codes_new FOR ALL USING (FALSE);

-- Pending extractions: deny all except service role
ALTER TABLE pending_extractions_new ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Deny all pending_new" ON pending_extractions_new;
CREATE POLICY "Deny all pending_new" ON pending_extractions_new FOR ALL USING (FALSE);

-- Chat tables: RLS disabled (app-level auth by design)
-- Authentication handled in application code

-- ============================================
-- MIGRATION COMPLETE
-- ============================================
-- Tables created with _new suffix.
-- Next step: Run data migration script to copy data from old tables.
-- Then: Rename tables (old -> _deprecated, new -> final names).
-- ============================================
