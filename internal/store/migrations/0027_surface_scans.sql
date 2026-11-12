-- Attack surface scans live next to passive ones. They take minutes, so a
-- scan row is created as running and filled in when it finishes.
ALTER TABLE security_scans DROP CONSTRAINT IF EXISTS security_scans_kind_check;
ALTER TABLE security_scans ADD CONSTRAINT security_scans_kind_check CHECK (kind IN ('passive', 'surface'));
ALTER TABLE security_scans ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'done';
ALTER TABLE security_scans DROP CONSTRAINT IF EXISTS security_scans_status_check;
ALTER TABLE security_scans ADD CONSTRAINT security_scans_status_check CHECK (status IN ('running', 'done', 'failed'));
ALTER TABLE security_scans ADD COLUMN IF NOT EXISTS error TEXT NOT NULL DEFAULT '';
GRANT UPDATE ON security_scans TO qnetward_tenant;
CREATE INDEX IF NOT EXISTS idx_security_scans_kind ON security_scans (workspace_id, kind, created_at DESC);
-- A scan cut short by a restart doesn't stay "running" for ever.
CREATE INDEX IF NOT EXISTS idx_security_scans_running ON security_scans (created_at) WHERE status = 'running';
