-- ============================================
-- ADD UPDATE LOGS TABLE
-- ============================================
-- Stores update run logs instead of local files
-- ============================================

CREATE TABLE IF NOT EXISTS update_logs (
  id BIGSERIAL PRIMARY KEY,
  user_id UUID REFERENCES users(id) ON DELETE CASCADE,
  run_id TEXT NOT NULL,
  log_type TEXT NOT NULL CHECK (log_type IN ('summary', 'diff', 'update')),
  dry_run BOOLEAN DEFAULT false,
  total_courses_scanned INTEGER DEFAULT 0,
  courses_with_updates INTEGER DEFAULT 0,
  data JSONB NOT NULL DEFAULT '{}',
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Indexes
CREATE INDEX idx_update_logs_user ON update_logs(user_id);
CREATE INDEX idx_update_logs_run ON update_logs(run_id);
CREATE INDEX idx_update_logs_type ON update_logs(log_type);
CREATE INDEX idx_update_logs_created ON update_logs(created_at DESC);

-- RLS
ALTER TABLE update_logs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users access own update logs" ON update_logs FOR ALL
  USING (user_id = (current_setting('app.current_user_id', true))::UUID);

-- Grant permissions
GRANT ALL ON update_logs TO authenticated, anon;
GRANT USAGE, SELECT ON SEQUENCE update_logs_id_seq TO authenticated, anon;
