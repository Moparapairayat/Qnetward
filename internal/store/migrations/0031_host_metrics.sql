-- Host metrics: agents report the load of the machine they run on. Each
-- sample keeps the headline numbers in columns for charts; the agent row keeps
-- the newest sample in full (every disk) and what the machine is.
ALTER TABLE probe_agents ADD COLUMN IF NOT EXISTS host_info JSONB;
ALTER TABLE probe_agents ADD COLUMN IF NOT EXISTS host_latest JSONB;
ALTER TABLE probe_agents ADD COLUMN IF NOT EXISTS host_latest_at TIMESTAMPTZ;

CREATE TABLE IF NOT EXISTS host_metrics (
	agent_id BIGINT NOT NULL REFERENCES probe_agents(id) ON DELETE CASCADE,
	workspace_id BIGINT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
	at TIMESTAMPTZ NOT NULL,
	cpu REAL NOT NULL DEFAULT 0,
	load1 REAL NOT NULL DEFAULT 0,
	mem_used BIGINT NOT NULL DEFAULT 0,
	mem_total BIGINT NOT NULL DEFAULT 0,
	swap_used BIGINT NOT NULL DEFAULT 0,
	swap_total BIGINT NOT NULL DEFAULT 0,
	-- The fullest disk, which is the one that matters.
	disk_used BIGINT NOT NULL DEFAULT 0,
	disk_total BIGINT NOT NULL DEFAULT 0,
	net_rx_bps DOUBLE PRECISION NOT NULL DEFAULT 0,
	net_tx_bps DOUBLE PRECISION NOT NULL DEFAULT 0,
	procs INT NOT NULL DEFAULT 0,
	PRIMARY KEY (agent_id, at)
);
CREATE INDEX IF NOT EXISTS idx_host_metrics_at ON host_metrics (at);

GRANT SELECT, INSERT, DELETE ON host_metrics TO qnetward_tenant;

ALTER TABLE host_metrics ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS workspace_isolation ON host_metrics;
CREATE POLICY workspace_isolation ON host_metrics
	TO qnetward_tenant
	USING (workspace_id = NULLIF(current_setting('app.workspace_id', true), '')::bigint)
	WITH CHECK (workspace_id = NULLIF(current_setting('app.workspace_id', true), '')::bigint);
