-- ============================================
-- Anonymous Class Discussion Forum - Database Migration
-- ============================================
-- This migration creates all tables, functions, triggers, and RLS policies
-- for the anonymous class discussion forum feature.
-- ============================================

-- Helper: updated_at trigger function (idempotent definition)
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- ============================================
-- Enum Types
-- ============================================

-- Create enum types if they don't exist
DO $$ BEGIN
    CREATE TYPE vote_target_type AS ENUM ('post', 'response');
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
    CREATE TYPE vote_type AS ENUM ('up', 'down');
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;

-- ============================================
-- Table: chat_posts
-- ============================================

CREATE TABLE IF NOT EXISTS chat_posts (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    course_id INTEGER NOT NULL,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    anonymous_thread_id TEXT NOT NULL, -- Fruit name
    title TEXT NOT NULL CHECK (char_length(title) >= 3 AND char_length(title) <= 200),
    body TEXT NOT NULL CHECK (char_length(body) >= 10 AND char_length(body) <= 5000),
    tag TEXT NOT NULL CHECK (tag IN ('problem', 'discussion', 'other')),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    edited_at TIMESTAMPTZ,
    is_edited BOOLEAN NOT NULL DEFAULT false,
    response_count INTEGER NOT NULL DEFAULT 0,
    net_score INTEGER NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS idx_chat_posts_course_id ON chat_posts(course_id);
CREATE INDEX IF NOT EXISTS idx_chat_posts_tag ON chat_posts(tag);
CREATE INDEX IF NOT EXISTS idx_chat_posts_created_at ON chat_posts(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_chat_posts_course_tag_created ON chat_posts(course_id, tag, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_chat_posts_title_gin ON chat_posts USING gin(to_tsvector('english', title));
CREATE INDEX IF NOT EXISTS idx_chat_posts_response_count ON chat_posts(response_count DESC);
CREATE INDEX IF NOT EXISTS idx_chat_posts_net_score ON chat_posts(net_score DESC);

DROP TRIGGER IF EXISTS trg_chat_posts_updated_at ON chat_posts;
CREATE TRIGGER trg_chat_posts_updated_at
  BEFORE UPDATE ON chat_posts
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

-- ============================================
-- Table: chat_responses
-- ============================================

CREATE TABLE IF NOT EXISTS chat_responses (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    post_id UUID NOT NULL REFERENCES chat_posts(id) ON DELETE CASCADE,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    anonymous_thread_id TEXT NOT NULL, -- Fruit name
    body TEXT NOT NULL CHECK (char_length(body) >= 10 AND char_length(body) <= 5000),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    is_edited BOOLEAN NOT NULL DEFAULT false,
    net_score INTEGER NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS idx_chat_responses_post_id ON chat_responses(post_id);
CREATE INDEX IF NOT EXISTS idx_chat_responses_created_at ON chat_responses(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_chat_responses_net_score ON chat_responses(net_score DESC);
CREATE INDEX IF NOT EXISTS idx_chat_responses_post_score ON chat_responses(post_id, net_score DESC);

DROP TRIGGER IF EXISTS trg_chat_responses_updated_at ON chat_responses;
CREATE TRIGGER trg_chat_responses_updated_at
  BEFORE UPDATE ON chat_responses
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

-- ============================================
-- Table: chat_votes
-- ============================================

CREATE TABLE IF NOT EXISTS chat_votes (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    target_id UUID NOT NULL,
    target_type vote_target_type NOT NULL,
    vote_type vote_type NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE(user_id, target_id, target_type)
);

CREATE INDEX IF NOT EXISTS idx_chat_votes_target ON chat_votes(target_id, target_type);
CREATE INDEX IF NOT EXISTS idx_chat_votes_user ON chat_votes(user_id);

-- ============================================
-- Table: chat_attachments
-- ============================================

CREATE TABLE IF NOT EXISTS chat_attachments (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    post_id UUID REFERENCES chat_posts(id) ON DELETE CASCADE,
    response_id UUID REFERENCES chat_responses(id) ON DELETE CASCADE,
    file_path TEXT NOT NULL,
    file_name TEXT NOT NULL,
    file_size BIGINT NOT NULL CHECK (file_size > 0 AND file_size <= 10485760), -- 10MB max
    mime_type TEXT NOT NULL,
    display_order INTEGER NOT NULL DEFAULT 0,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CHECK ((post_id IS NULL) != (response_id IS NULL)) -- Exactly one must be set
);

CREATE INDEX IF NOT EXISTS idx_chat_attachments_post ON chat_attachments(post_id) WHERE post_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_chat_attachments_response ON chat_attachments(response_id) WHERE response_id IS NOT NULL;

-- ============================================
-- Table: user_unlock_credits
-- ============================================

CREATE TABLE IF NOT EXISTS user_unlock_credits (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    course_id INTEGER NOT NULL,
    total_earned INTEGER NOT NULL DEFAULT 0 CHECK (total_earned >= 0),
    total_used INTEGER NOT NULL DEFAULT 0 CHECK (total_used >= 0),
    first_unlock_used BOOLEAN NOT NULL DEFAULT false,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE(user_id, course_id)
);

CREATE INDEX IF NOT EXISTS idx_user_unlock_credits_user_course ON user_unlock_credits(user_id, course_id);

DROP TRIGGER IF EXISTS trg_user_unlock_credits_updated_at ON user_unlock_credits;
CREATE TRIGGER trg_user_unlock_credits_updated_at
  BEFORE UPDATE ON user_unlock_credits
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

-- ============================================
-- Table: thread_access_tracking
-- ============================================

CREATE TABLE IF NOT EXISTS thread_access_tracking (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    post_id UUID NOT NULL REFERENCES chat_posts(id) ON DELETE CASCADE,
    has_contributed BOOLEAN NOT NULL DEFAULT false,
    unlock_applied BOOLEAN NOT NULL DEFAULT false,
    unlocked_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE(user_id, post_id)
);

CREATE INDEX IF NOT EXISTS idx_thread_access_user ON thread_access_tracking(user_id);
CREATE INDEX IF NOT EXISTS idx_thread_access_post ON thread_access_tracking(post_id);

-- ============================================
-- Table: user_onboarding_state
-- ============================================

CREATE TABLE IF NOT EXISTS user_onboarding_state (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    course_id INTEGER NOT NULL,
    has_seen_onboarding BOOLEAN NOT NULL DEFAULT false,
    seen_at TIMESTAMPTZ,
    UNIQUE(user_id, course_id)
);

CREATE INDEX IF NOT EXISTS idx_user_onboarding_user_course ON user_onboarding_state(user_id, course_id);

-- ============================================
-- Database Functions
-- ============================================

-- Function: Update Response Count
CREATE OR REPLACE FUNCTION update_post_response_count()
RETURNS TRIGGER AS $$
BEGIN
    IF TG_OP = 'INSERT' THEN
        UPDATE chat_posts
        SET response_count = response_count + 1
        WHERE id = NEW.post_id;
        RETURN NEW;
    ELSIF TG_OP = 'DELETE' THEN
        UPDATE chat_posts
        SET response_count = GREATEST(0, response_count - 1)
        WHERE id = OLD.post_id;
        RETURN OLD;
    END IF;
    RETURN NULL;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trigger_update_response_count ON chat_responses;
CREATE TRIGGER trigger_update_response_count
AFTER INSERT OR DELETE ON chat_responses
FOR EACH ROW EXECUTE FUNCTION update_post_response_count();

-- Function: Update Net Score
CREATE OR REPLACE FUNCTION update_net_score()
RETURNS TRIGGER AS $$
DECLARE
    target_table TEXT;
    score_change INTEGER;
BEGIN
    IF TG_OP = 'DELETE' THEN
        score_change = CASE WHEN OLD.vote_type = 'up' THEN -1 ELSE 1 END;
        target_table = OLD.target_type::TEXT;
    ELSIF TG_OP = 'INSERT' THEN
        score_change = CASE WHEN NEW.vote_type = 'up' THEN 1 ELSE -1 END;
        target_table = NEW.target_type::TEXT;
    ELSIF TG_OP = 'UPDATE' THEN
        -- Vote changed type
        score_change = CASE 
            WHEN OLD.vote_type = 'up' AND NEW.vote_type = 'down' THEN -2
            WHEN OLD.vote_type = 'down' AND NEW.vote_type = 'up' THEN 2
            ELSE 0
        END;
        target_table = NEW.target_type::TEXT;
    END IF;

    IF target_table = 'post' THEN
        UPDATE chat_posts
        SET net_score = net_score + score_change
        WHERE id = COALESCE(NEW.target_id, OLD.target_id);
    ELSIF target_table = 'response' THEN
        UPDATE chat_responses
        SET net_score = net_score + score_change
        WHERE id = COALESCE(NEW.target_id, OLD.target_id);
    END IF;

    RETURN COALESCE(NEW, OLD);
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trigger_update_post_net_score ON chat_votes;
CREATE TRIGGER trigger_update_post_net_score
AFTER INSERT OR UPDATE OR DELETE ON chat_votes
FOR EACH ROW EXECUTE FUNCTION update_net_score();

-- Function: Generate Fruit Name
CREATE OR REPLACE FUNCTION generate_fruit_name()
RETURNS TEXT AS $$
DECLARE
    fruits TEXT[] := ARRAY[
        'Apple', 'Banana', 'Cherry', 'Date', 'Elderberry', 'Fig', 'Grape', 'Honeydew',
        'Kiwi', 'Lemon', 'Mango', 'Nectarine', 'Orange', 'Papaya', 'Quince', 'Raspberry',
        'Strawberry', 'Tangerine', 'Ugli', 'Vanilla', 'Watermelon', 'Xigua', 'Yuzu', 'Zucchini',
        'Apricot', 'Blackberry', 'Cantaloupe', 'Dragonfruit', 'Elderflower', 'Feijoa', 'Guava',
        'Huckleberry', 'Jackfruit', 'Kumquat', 'Lychee', 'Mulberry', 'Nance', 'Olive', 'Passionfruit',
        'Peach', 'Pineapple', 'Pomegranate', 'Rambutan', 'Starfruit', 'Tamarind', 'Uva', 'Vanilla',
        'Waxberry', 'Ximenia', 'Yumberry', 'Ziziphus', 'Acerola', 'Bilberry', 'Cloudberry', 'Damson',
        'Emu', 'Fingerlime', 'Gooseberry', 'Honeysuckle', 'Illawarra', 'Jaboticaba', 'Kaffir', 'Lime',
        'Marionberry', 'Nashi', 'Ohelo', 'Pawpaw', 'Pitaya', 'Quandong', 'Rosehip', 'Saskatoon',
        'Tayberry', 'Ugni', 'Vibernum', 'Wolfberry', 'Xoconostle', 'Youngberry', 'Ziziphus', 'Akee',
        'Breadfruit', 'Canistel', 'Durian', 'Elephant', 'Farkleberry', 'Genip', 'Horned', 'Imbe',
        'Jujube', 'Kei', 'Longan', 'Mamey', 'Noni', 'Otaheite', 'Persimmon', 'Quince', 'Rowan',
        'Salak', 'Tangelo', 'Uvaria', 'Velvet', 'White', 'Xylocarp', 'Yangmei', 'Zapote'
    ];
    random_index INTEGER;
BEGIN
    random_index := floor(random() * array_length(fruits, 1) + 1)::INTEGER;
    RETURN fruits[random_index];
END;
$$ LANGUAGE plpgsql;

-- Function: Award Unlock Credit
-- Note: This function is called when a response receives its first upvote
CREATE OR REPLACE FUNCTION award_unlock_credit(response_id_param UUID, course_id_param INTEGER)
RETURNS BOOLEAN AS $$
DECLARE
    response_user_id UUID;
    upvote_count INTEGER;
BEGIN
    -- Get the user_id of the response author
    SELECT user_id INTO response_user_id
    FROM chat_responses
    WHERE id = response_id_param;

    IF response_user_id IS NULL THEN
        RETURN false;
    END IF;

    -- Check if response has at least one upvote
    SELECT COUNT(*) INTO upvote_count
    FROM chat_votes
    WHERE target_id = response_id_param
      AND target_type = 'response'
      AND vote_type = 'up';

    IF upvote_count >= 1 THEN
        -- Award credit
        INSERT INTO user_unlock_credits (user_id, course_id, total_earned, total_used)
        VALUES (response_user_id, course_id_param, 1, 0)
        ON CONFLICT (user_id, course_id)
        DO UPDATE SET 
            total_earned = user_unlock_credits.total_earned + 1,
            updated_at = NOW();
        RETURN true;
    END IF;
    RETURN false;
END;
$$ LANGUAGE plpgsql;

-- ============================================
-- Row-Level Security (RLS) Policies
-- ============================================
-- NOTE: RLS is DISABLED because this application uses custom authentication
-- (not Supabase Auth). Authentication is handled in application code.
-- The application validates user identity before making database calls.

-- RLS is disabled - authentication handled in application layer
-- ALTER TABLE chat_posts ENABLE ROW LEVEL SECURITY;
-- ALTER TABLE chat_responses ENABLE ROW LEVEL SECURITY;
-- ALTER TABLE chat_votes ENABLE ROW LEVEL SECURITY;
-- ALTER TABLE chat_attachments ENABLE ROW LEVEL SECURITY;
-- ALTER TABLE user_unlock_credits ENABLE ROW LEVEL SECURITY;
-- ALTER TABLE thread_access_tracking ENABLE ROW LEVEL SECURITY;
-- ALTER TABLE user_onboarding_state ENABLE ROW LEVEL SECURITY;

-- RLS Policies are disabled - see note above
-- Application code handles authentication and authorization
/*
-- chat_posts Policies (DISABLED - using application-level auth)
DROP POLICY IF EXISTS "Users can read posts in enrolled courses" ON chat_posts;
CREATE POLICY "Users can read posts in enrolled courses"
ON chat_posts FOR SELECT
USING (
    course_id IN (
        SELECT course_id FROM courses 
        WHERE user_email = (SELECT email FROM users WHERE id = auth.uid()::TEXT)
    )
);

DROP POLICY IF EXISTS "Users can create posts in enrolled courses" ON chat_posts;
CREATE POLICY "Users can create posts in enrolled courses"
ON chat_posts FOR INSERT
WITH CHECK (
    course_id IN (
        SELECT course_id FROM courses 
        WHERE user_email = (SELECT email FROM users WHERE id = auth.uid()::TEXT)
    )
    AND user_id = auth.uid()::TEXT
);

DROP POLICY IF EXISTS "Users can update own posts" ON chat_posts;
CREATE POLICY "Users can update own posts"
ON chat_posts FOR UPDATE
USING (user_id = auth.uid()::TEXT)
WITH CHECK (user_id = auth.uid()::TEXT);

DROP POLICY IF EXISTS "No deletion of posts" ON chat_posts;
CREATE POLICY "No deletion of posts"
ON chat_posts FOR DELETE
USING (false);
*/

-- RLS Policies are disabled - see note above
-- Application code handles authentication and authorization
/*
-- chat_responses Policies (DISABLED)
-- chat_votes Policies (DISABLED)
-- chat_attachments Policies (DISABLED)
-- user_unlock_credits Policies (DISABLED)
-- thread_access_tracking Policies (DISABLED)
-- user_onboarding_state Policies (DISABLED)
*/

-- ============================================
-- Storage Bucket (Note: Must be created via Supabase Dashboard)
-- ============================================
-- Bucket name: chat-attachments
-- Path structure: {course_id}/{post_id|response_id}/{attachment_id}/{filename}
-- 
-- To create the bucket:
-- 1. Go to Supabase Dashboard > Storage
-- 2. Create new bucket: chat-attachments
-- 3. Set as private (not public)
-- 4. Apply the storage policies below via SQL Editor
-- ============================================

-- Storage Policies (run after creating bucket in dashboard)
-- Note: These policies reference storage.objects which is in the storage schema
-- Uncomment and run these after creating the bucket:

/*
-- Policy: Users can read attachments for accessible posts
CREATE POLICY "Users can read attachments for accessible posts"
ON storage.objects FOR SELECT
USING (
    bucket_id = 'chat-attachments' AND
    (storage.foldername(name))[1]::INTEGER IN (
        SELECT course_id FROM courses 
        WHERE user_email = (SELECT email FROM users WHERE id = auth.uid()::TEXT)
    )
);

-- Policy: Users can upload attachments to their posts/responses
CREATE POLICY "Users can upload attachments to their posts/responses"
ON storage.objects FOR INSERT
WITH CHECK (
    bucket_id = 'chat-attachments' AND
    auth.uid() IS NOT NULL
);

-- Policy: Users can delete their own attachments
CREATE POLICY "Users can delete own attachments"
ON storage.objects FOR DELETE
USING (
    bucket_id = 'chat-attachments' AND
    auth.uid() IS NOT NULL
);
*/

-- ============================================
-- Migration Complete
-- ============================================
-- Next Steps:
-- 1. Create storage bucket 'chat-attachments' via Supabase Dashboard
-- 2. Run the storage policies (uncommented above) via SQL Editor
-- 3. Verify all tables, indexes, functions, triggers, and policies
-- ============================================

