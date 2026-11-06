-- Avatar images kept in the database, for servers without object storage.
-- Pictures are resized in the browser to 256 px first, so rows stay small.
-- user_profiles.avatar_key is "db:<version>" when the image lives here.
CREATE TABLE IF NOT EXISTS user_avatars (
	user_id BIGINT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
	content_type TEXT NOT NULL,
	data BYTEA NOT NULL,
	updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
