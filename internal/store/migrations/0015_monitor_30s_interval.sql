-- Monitors can now check every 30 seconds.
ALTER TABLE monitors DROP CONSTRAINT IF EXISTS monitors_interval_seconds_check;
ALTER TABLE monitors ADD CONSTRAINT monitors_interval_seconds_check CHECK (interval_seconds >= 30);
