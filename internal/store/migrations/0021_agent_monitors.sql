-- A monitor can run from one of the workspace's probe agents instead of the
-- server. Removing the agent hands the monitor back to the server. Each check
-- remembers which agent ran it, so results can be told apart by location.
ALTER TABLE monitors ADD COLUMN IF NOT EXISTS agent_id BIGINT REFERENCES probe_agents(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS idx_monitors_agent ON monitors (agent_id) WHERE agent_id IS NOT NULL;

ALTER TABLE monitor_checks ADD COLUMN IF NOT EXISTS agent_id BIGINT REFERENCES probe_agents(id) ON DELETE SET NULL;

-- The server's scheduler only claims monitors it runs itself.
DROP INDEX IF EXISTS idx_monitors_due;
CREATE INDEX IF NOT EXISTS idx_monitors_due ON monitors (next_run_at) WHERE enabled AND agent_id IS NULL;
