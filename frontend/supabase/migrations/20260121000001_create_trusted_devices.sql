-- Create trusted_devices table for device-based authentication
-- This table tracks which devices have successfully authenticated via Canvas popup

CREATE TABLE IF NOT EXISTS trusted_devices (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  device_id TEXT NOT NULL,
  device_hash TEXT,                    -- Browser characteristics hash (timezone, language, platform, screen)
  user_agent TEXT,
  last_login_at TIMESTAMPTZ NOT NULL,
  trusted_at TIMESTAMPTZ DEFAULT NOW(),
  is_active BOOLEAN DEFAULT true,
  UNIQUE(user_id, device_id)
);

-- Index for fast lookups by user_id and device_id (only active devices)
CREATE INDEX IF NOT EXISTS idx_trusted_devices_lookup
  ON trusted_devices(user_id, device_id)
  WHERE is_active = true;

-- Index for cleanup queries (inactive or old devices)
CREATE INDEX IF NOT EXISTS idx_trusted_devices_last_login
  ON trusted_devices(last_login_at)
  WHERE is_active = true;

-- Enable RLS (Row Level Security)
ALTER TABLE trusted_devices ENABLE ROW LEVEL SECURITY;

-- Policy: Users can only see their own trusted devices
CREATE POLICY "Users can view own trusted devices" ON trusted_devices
  FOR SELECT
  USING (auth.uid() = user_id);

-- Policy: Service role can manage all trusted devices
CREATE POLICY "Service role can manage trusted devices" ON trusted_devices
  FOR ALL
  USING (auth.jwt() ->> 'role' = 'service_role');

-- Grant permissions to authenticated users and service role
GRANT SELECT ON trusted_devices TO authenticated;
GRANT ALL ON trusted_devices TO service_role;

-- Comment for documentation
COMMENT ON TABLE trusted_devices IS 'Tracks devices that have successfully authenticated via Canvas popup. Used for auto-login security.';
COMMENT ON COLUMN trusted_devices.device_id IS 'UUID stored in localStorage on the device';
COMMENT ON COLUMN trusted_devices.device_hash IS 'SHA-256 hash of browser characteristics for secondary validation';
COMMENT ON COLUMN trusted_devices.last_login_at IS 'Timestamp of last successful Canvas popup authentication on this device';
COMMENT ON COLUMN trusted_devices.is_active IS 'Set to false to revoke trust without deleting the record';
