-- The overview chart reads every monitor's checks in a time window at once.
CREATE INDEX IF NOT EXISTS idx_monitor_checks_workspace ON monitor_checks (workspace_id, checked_at);
