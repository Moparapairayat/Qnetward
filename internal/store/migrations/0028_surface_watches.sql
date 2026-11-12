-- A watch is either a passive check or an attack surface scan on a schedule.
-- The same domain can have one of each.
ALTER TABLE security_watches ADD COLUMN IF NOT EXISTS kind TEXT NOT NULL DEFAULT 'passive';
ALTER TABLE security_watches DROP CONSTRAINT IF EXISTS security_watches_kind_check;
ALTER TABLE security_watches ADD CONSTRAINT security_watches_kind_check CHECK (kind IN ('passive', 'surface'));
DROP INDEX IF EXISTS idx_security_watches_domain;
CREATE UNIQUE INDEX IF NOT EXISTS idx_security_watches_domain_kind ON security_watches (workspace_id, domain, kind);
