-- Two-factor sign-in with an authenticator app (TOTP).
CREATE TABLE IF NOT EXISTS user_mfa (
	user_id BIGINT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
	-- The TOTP seed, encrypted by the application (internal/platform/secretbox).
	secret_enc TEXT NOT NULL,
	-- NULL until the user confirms a first code; until then sign-in is unchanged.
	enabled_at TIMESTAMPTZ,
	-- SHA-256 hashes of unused one-time recovery codes.
	recovery_hashes TEXT[] NOT NULL DEFAULT '{}',
	-- The last accepted time step, so a code can't be replayed.
	last_step BIGINT NOT NULL DEFAULT 0,
	created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- The step between a correct password and a correct code. The token is
-- short-lived and allows a few attempts.
CREATE TABLE IF NOT EXISTS mfa_challenges (
	token_hash TEXT PRIMARY KEY,
	user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
	expires_at TIMESTAMPTZ NOT NULL,
	attempts INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_mfa_challenges_expires ON mfa_challenges (expires_at);
