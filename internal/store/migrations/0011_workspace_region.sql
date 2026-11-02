-- Where a workspace's data lives. Every workspace is in Singapore today; the
-- column is here so data residency can be added without reshaping tenants.
ALTER TABLE workspaces ADD COLUMN IF NOT EXISTS data_region TEXT NOT NULL DEFAULT 'ap-southeast-1';
