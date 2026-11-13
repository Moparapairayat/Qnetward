-- Who a workspace's payments are from: the name and phone sent to the payment
-- gateway (it requires a phone), and an optional company and address printed
-- on receipts. One row per workspace, written by its owners and admins.
CREATE TABLE IF NOT EXISTS workspace_billing (
	workspace_id BIGINT PRIMARY KEY REFERENCES workspaces(id) ON DELETE CASCADE,
	name TEXT NOT NULL DEFAULT '',
	phone TEXT NOT NULL DEFAULT '',
	company TEXT NOT NULL DEFAULT '',
	address TEXT NOT NULL DEFAULT '',
	city TEXT NOT NULL DEFAULT '',
	postcode TEXT NOT NULL DEFAULT '',
	country TEXT NOT NULL DEFAULT 'BD',
	updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- The payment reconciler looks for recent pending checkouts every few minutes.
CREATE INDEX IF NOT EXISTS idx_payments_pending ON payments (created_at) WHERE status = 'pending';
