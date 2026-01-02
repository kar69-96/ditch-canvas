-- ============================================
-- Integrations V3 (single destination per provider)
-- Supports one Google Sheet and one Notion Database per user
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
-- Table: integrations
-- One row per user + provider with a single destination
-- ============================================
CREATE TABLE IF NOT EXISTS integrations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_email TEXT NOT NULL,
  provider TEXT NOT NULL CHECK (provider IN ('google', 'notion')),
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','needs_reauth','disabled')),
  token_ciphertext TEXT NOT NULL,
  token_expires_at TIMESTAMPTZ NULL,
  external_target_id TEXT NOT NULL, -- Google: sheetId, Notion: databaseId
  target_display_name TEXT,
  target_config JSONB NOT NULL DEFAULT '{}'::jsonb,
  last_sync_at TIMESTAMPTZ,
  last_sync_status TEXT,
  last_sync_error TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(user_email, provider)
);

CREATE INDEX IF NOT EXISTS idx_integrations_user_provider ON integrations(user_email, provider);
CREATE INDEX IF NOT EXISTS idx_integrations_status_active ON integrations(provider, status) WHERE status = 'active';

DROP TRIGGER IF EXISTS trg_integrations_updated_at ON integrations;
CREATE TRIGGER trg_integrations_updated_at
  BEFORE UPDATE ON integrations
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

-- ============================================
-- Table: integration_item_mappings
-- Stable mapping for idempotent sync
-- ============================================
CREATE TABLE IF NOT EXISTS integration_item_mappings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  integration_id UUID NOT NULL REFERENCES integrations(id) ON DELETE CASCADE,
  item_type TEXT NOT NULL DEFAULT 'assignment',
  internal_id TEXT NOT NULL, -- Assignment identifier from Canvas
  external_id TEXT NOT NULL, -- Sheets: row key, Notion: page_id
  content_hash TEXT NOT NULL, -- Hash of the content to detect changes
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(integration_id, item_type, internal_id)
);

CREATE INDEX IF NOT EXISTS idx_item_mappings_integration_id ON integration_item_mappings(integration_id);
CREATE INDEX IF NOT EXISTS idx_item_mappings_internal_id ON integration_item_mappings(internal_id);

DROP TRIGGER IF EXISTS trg_integration_item_mappings_updated_at ON integration_item_mappings;
CREATE TRIGGER trg_integration_item_mappings_updated_at
  BEFORE UPDATE ON integration_item_mappings
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

-- ============================================
-- Row Level Security (RLS) Policies
-- Deny all access for anon and authenticated roles
-- Only the service role (backend) should access these tables
-- ============================================
ALTER TABLE integrations ENABLE ROW LEVEL SECURITY;
ALTER TABLE integration_item_mappings ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Deny all for integrations" ON integrations;
CREATE POLICY "Deny all for integrations" ON integrations
  FOR ALL USING (FALSE) WITH CHECK (FALSE);

DROP POLICY IF EXISTS "Deny all for integration_item_mappings" ON integration_item_mappings;
CREATE POLICY "Deny all for integration_item_mappings" ON integration_item_mappings
  FOR ALL USING (FALSE) WITH CHECK (FALSE);




