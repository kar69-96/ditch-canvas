-- Migration: Create tables for EC2 instance management and auth request queue
-- Purpose: Enable dynamic scaling of streaming authentication instances

-- =============================================================================
-- Table: streaming_instances
-- Tracks EC2 instance states for the streaming authentication service
-- =============================================================================
CREATE TABLE IF NOT EXISTS streaming_instances (
  instance_id VARCHAR(50) PRIMARY KEY,
  status VARCHAR(20) NOT NULL DEFAULT 'starting',
  tunnel_url TEXT,
  current_sessions INTEGER DEFAULT 0,
  max_sessions INTEGER DEFAULT 3,
  last_activity_at TIMESTAMPTZ,
  health_check_failures INTEGER DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),

  -- Constrain status to valid values
  CONSTRAINT valid_status CHECK (status IN ('starting', 'warm', 'active', 'hibernating', 'stopped', 'terminating'))
);

-- Index for finding available instances (warm with capacity)
CREATE INDEX IF NOT EXISTS idx_streaming_instances_available
ON streaming_instances (status, current_sessions)
WHERE status = 'warm' AND current_sessions < max_sessions;

-- Index for finding instances by status
CREATE INDEX IF NOT EXISTS idx_streaming_instances_status
ON streaming_instances (status);

-- =============================================================================
-- Table: auth_requests
-- Queue for pending authentication requests
-- =============================================================================
CREATE TABLE IF NOT EXISTS auth_requests (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email VARCHAR(255) NOT NULL,
  context VARCHAR(20) DEFAULT 'login',
  status VARCHAR(20) DEFAULT 'pending',
  assigned_instance VARCHAR(50) REFERENCES streaming_instances(instance_id) ON DELETE SET NULL,
  tunnel_url TEXT,
  retry_count INTEGER DEFAULT 0,
  error_message TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  assigned_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,

  -- Constrain status to valid values
  CONSTRAINT valid_request_status CHECK (status IN ('pending', 'assigned', 'in_progress', 'completed', 'failed', 'timeout')),
  -- Constrain context to valid values
  CONSTRAINT valid_context CHECK (context IN ('login', 'onboarding'))
);

-- Index for finding pending requests (queue order)
CREATE INDEX IF NOT EXISTS idx_auth_requests_pending
ON auth_requests (created_at ASC)
WHERE status = 'pending';

-- Index for finding requests by email (for duplicate detection)
CREATE INDEX IF NOT EXISTS idx_auth_requests_email
ON auth_requests (email, created_at DESC);

-- Index for finding requests by instance (for session counting)
CREATE INDEX IF NOT EXISTS idx_auth_requests_instance
ON auth_requests (assigned_instance)
WHERE status IN ('assigned', 'in_progress');

-- =============================================================================
-- Table: instance_events
-- Audit log for instance lifecycle events
-- =============================================================================
CREATE TABLE IF NOT EXISTS instance_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  instance_id VARCHAR(50),
  event_type VARCHAR(50) NOT NULL,
  details JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Index for querying events by instance
CREATE INDEX IF NOT EXISTS idx_instance_events_instance
ON instance_events (instance_id, created_at DESC);

-- Index for querying events by type
CREATE INDEX IF NOT EXISTS idx_instance_events_type
ON instance_events (event_type, created_at DESC);

-- =============================================================================
-- Function: Update updated_at timestamp automatically
-- =============================================================================
CREATE OR REPLACE FUNCTION update_streaming_instance_timestamp()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Trigger to auto-update updated_at
DROP TRIGGER IF EXISTS streaming_instances_updated_at ON streaming_instances;
CREATE TRIGGER streaming_instances_updated_at
  BEFORE UPDATE ON streaming_instances
  FOR EACH ROW
  EXECUTE FUNCTION update_streaming_instance_timestamp();

-- =============================================================================
-- Function: Get queue position for a request
-- =============================================================================
CREATE OR REPLACE FUNCTION get_queue_position(request_id UUID)
RETURNS INTEGER AS $$
DECLARE
  position INTEGER;
BEGIN
  SELECT COUNT(*) + 1 INTO position
  FROM auth_requests
  WHERE status = 'pending'
    AND created_at < (SELECT created_at FROM auth_requests WHERE id = request_id);

  RETURN position;
END;
$$ LANGUAGE plpgsql;

-- =============================================================================
-- Function: Find available instance with capacity
-- =============================================================================
CREATE OR REPLACE FUNCTION find_available_instance()
RETURNS TABLE (
  instance_id VARCHAR(50),
  tunnel_url TEXT,
  current_sessions INTEGER,
  max_sessions INTEGER
) AS $$
BEGIN
  RETURN QUERY
  SELECT
    si.instance_id,
    si.tunnel_url,
    si.current_sessions,
    si.max_sessions
  FROM streaming_instances si
  WHERE si.status = 'warm'
    AND si.current_sessions < si.max_sessions
    AND si.tunnel_url IS NOT NULL
  ORDER BY si.current_sessions ASC
  LIMIT 1
  FOR UPDATE SKIP LOCKED;
END;
$$ LANGUAGE plpgsql;

-- =============================================================================
-- Function: Assign request to instance
-- =============================================================================
CREATE OR REPLACE FUNCTION assign_request_to_instance(
  p_request_id UUID,
  p_instance_id VARCHAR(50)
)
RETURNS BOOLEAN AS $$
DECLARE
  v_tunnel_url TEXT;
BEGIN
  -- Get tunnel URL and increment session count
  UPDATE streaming_instances
  SET current_sessions = current_sessions + 1,
      status = CASE
        WHEN current_sessions + 1 >= max_sessions THEN 'active'
        ELSE status
      END,
      last_activity_at = NOW()
  WHERE instance_id = p_instance_id
    AND current_sessions < max_sessions
  RETURNING tunnel_url INTO v_tunnel_url;

  IF v_tunnel_url IS NULL THEN
    RETURN FALSE;
  END IF;

  -- Update the request
  UPDATE auth_requests
  SET status = 'assigned',
      assigned_instance = p_instance_id,
      tunnel_url = v_tunnel_url,
      assigned_at = NOW()
  WHERE id = p_request_id
    AND status = 'pending';

  RETURN TRUE;
END;
$$ LANGUAGE plpgsql;

-- =============================================================================
-- Function: Release instance session (when auth completes or fails)
-- =============================================================================
CREATE OR REPLACE FUNCTION release_instance_session(
  p_request_id UUID,
  p_new_status VARCHAR(20) DEFAULT 'completed'
)
RETURNS VOID AS $$
DECLARE
  v_instance_id VARCHAR(50);
BEGIN
  -- Get and update the request
  UPDATE auth_requests
  SET status = p_new_status,
      completed_at = NOW()
  WHERE id = p_request_id
  RETURNING assigned_instance INTO v_instance_id;

  -- Decrement session count if there was an assigned instance
  IF v_instance_id IS NOT NULL THEN
    UPDATE streaming_instances
    SET current_sessions = GREATEST(0, current_sessions - 1),
        status = CASE
          WHEN current_sessions - 1 < max_sessions AND status = 'active' THEN 'warm'
          ELSE status
        END,
        last_activity_at = NOW()
    WHERE instance_id = v_instance_id;
  END IF;
END;
$$ LANGUAGE plpgsql;

-- =============================================================================
-- Function: Get scaling metrics
-- =============================================================================
CREATE OR REPLACE FUNCTION get_scaling_metrics()
RETURNS TABLE (
  pending_requests BIGINT,
  active_instances BIGINT,
  warm_instances BIGINT,
  hibernated_instances BIGINT,
  total_capacity INTEGER,
  used_capacity BIGINT
) AS $$
BEGIN
  RETURN QUERY
  SELECT
    (SELECT COUNT(*) FROM auth_requests WHERE status = 'pending') AS pending_requests,
    (SELECT COUNT(*) FROM streaming_instances WHERE status = 'active') AS active_instances,
    (SELECT COUNT(*) FROM streaming_instances WHERE status = 'warm') AS warm_instances,
    (SELECT COUNT(*) FROM streaming_instances WHERE status IN ('hibernating', 'stopped')) AS hibernated_instances,
    (SELECT COALESCE(SUM(max_sessions), 0)::INTEGER FROM streaming_instances WHERE status IN ('warm', 'active')) AS total_capacity,
    (SELECT COALESCE(SUM(current_sessions), 0) FROM streaming_instances WHERE status IN ('warm', 'active')) AS used_capacity;
END;
$$ LANGUAGE plpgsql;

-- =============================================================================
-- Grant permissions for service role
-- =============================================================================
GRANT ALL ON streaming_instances TO service_role;
GRANT ALL ON auth_requests TO service_role;
GRANT ALL ON instance_events TO service_role;
GRANT EXECUTE ON FUNCTION get_queue_position TO service_role;
GRANT EXECUTE ON FUNCTION find_available_instance TO service_role;
GRANT EXECUTE ON FUNCTION assign_request_to_instance TO service_role;
GRANT EXECUTE ON FUNCTION release_instance_session TO service_role;
GRANT EXECUTE ON FUNCTION get_scaling_metrics TO service_role;

-- =============================================================================
-- Comments for documentation
-- =============================================================================
COMMENT ON TABLE streaming_instances IS 'Tracks EC2 instances for streaming authentication service';
COMMENT ON TABLE auth_requests IS 'Queue for pending and active authentication requests';
COMMENT ON TABLE instance_events IS 'Audit log for instance lifecycle events';
COMMENT ON FUNCTION get_queue_position IS 'Returns the position of a request in the pending queue';
COMMENT ON FUNCTION find_available_instance IS 'Finds a warm instance with available capacity';
COMMENT ON FUNCTION assign_request_to_instance IS 'Assigns a pending request to an available instance';
COMMENT ON FUNCTION release_instance_session IS 'Releases an instance session when auth completes';
COMMENT ON FUNCTION get_scaling_metrics IS 'Returns metrics for auto-scaling decisions';
