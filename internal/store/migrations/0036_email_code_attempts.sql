-- Wrong guesses at an email verification code. After a few, the code is spent
-- and a new one has to be sent, so a six-digit code can't be guessed by
-- trying them all from many addresses.
ALTER TABLE email_verification_codes ADD COLUMN IF NOT EXISTS attempts INTEGER NOT NULL DEFAULT 0;
