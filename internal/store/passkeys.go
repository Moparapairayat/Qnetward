package store

import (
	"context"
	"crypto/rand"
	"database/sql"
	"errors"
	"strings"
	"time"
)

var (
	ErrPasskeyNotFound   = errors.New("passkey not found")
	ErrChallengeNotFound = errors.New("this passkey request expired; try again")
)

// MaxPasskeysPerUser keeps the list manageable and the ceremony payloads small.
const MaxPasskeysPerUser = 10

// Passkey is a stored WebAuthn credential. Credential is the library's own
// JSON record, opaque to the store.
type Passkey struct {
	ID         int64      `json:"id"`
	Name       string     `json:"name"`
	CreatedAt  time.Time  `json:"created_at"`
	LastUsedAt *time.Time `json:"last_used_at,omitempty"`
	Credential []byte     `json:"-"`
}

// WebAuthnHandle returns the user's random WebAuthn handle, creating it the
// first time.
func (s *Store) WebAuthnHandle(ctx context.Context, userID int64) ([]byte, error) {
	var handle []byte
	err := s.db.QueryRowContext(ctx, `SELECT webauthn_handle FROM users WHERE id = $1`, userID).Scan(&handle)
	if errors.Is(err, sql.ErrNoRows) {
		return nil, ErrUserNotFound
	}
	if err != nil {
		return nil, err
	}
	if len(handle) > 0 {
		return handle, nil
	}
	fresh := make([]byte, 32)
	if _, err := rand.Read(fresh); err != nil {
		return nil, err
	}
	// COALESCE keeps whichever handle won if two requests raced.
	err = s.db.QueryRowContext(ctx, `
		UPDATE users SET webauthn_handle = COALESCE(webauthn_handle, $2) WHERE id = $1 RETURNING webauthn_handle
	`, userID, fresh).Scan(&handle)
	return handle, err
}

// UserByWebAuthnHandle finds the account a passkey's user handle belongs to.
func (s *Store) UserByWebAuthnHandle(ctx context.Context, handle []byte) (User, error) {
	var id int64
	err := s.db.QueryRowContext(ctx, `SELECT id FROM users WHERE webauthn_handle = $1`, handle).Scan(&id)
	if errors.Is(err, sql.ErrNoRows) {
		return User{}, ErrUserNotFound
	}
	if err != nil {
		return User{}, err
	}
	return s.GetUserByID(ctx, id)
}

func (s *Store) ListPasskeys(ctx context.Context, userID int64) ([]Passkey, error) {
	rows, err := s.db.QueryContext(ctx, `
		SELECT id, name, created_at, last_used_at, credential FROM webauthn_credentials
		WHERE user_id = $1 ORDER BY created_at
	`, userID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	keys := []Passkey{}
	for rows.Next() {
		var k Passkey
		var used sql.NullTime
		if err := rows.Scan(&k.ID, &k.Name, &k.CreatedAt, &used, &k.Credential); err != nil {
			return nil, err
		}
		k.LastUsedAt = nullTimePtr(used)
		keys = append(keys, k)
	}
	return keys, rows.Err()
}

// AddPasskey stores a newly registered credential.
func (s *Store) AddPasskey(ctx context.Context, userID int64, credentialID []byte, name string, credential []byte) (Passkey, error) {
	name = strings.TrimSpace(name)
	if name == "" {
		name = "Passkey"
	}
	name = truncate(name, 60)
	var count int
	if err := s.db.QueryRowContext(ctx, `SELECT COUNT(*) FROM webauthn_credentials WHERE user_id = $1`, userID).Scan(&count); err != nil {
		return Passkey{}, err
	}
	if count >= MaxPasskeysPerUser {
		return Passkey{}, errors.New("an account can have at most 10 passkeys")
	}
	var k Passkey
	err := s.db.QueryRowContext(ctx, `
		INSERT INTO webauthn_credentials (user_id, credential_id, name, credential) VALUES ($1, $2, $3, $4)
		RETURNING id, name, created_at
	`, userID, credentialID, name, credential).Scan(&k.ID, &k.Name, &k.CreatedAt)
	return k, err
}

// RecordPasskeyUse saves the updated credential (its sign count moves on
// every use) after a successful sign-in.
func (s *Store) RecordPasskeyUse(ctx context.Context, credentialID, credential []byte) error {
	_, err := s.db.ExecContext(ctx, `UPDATE webauthn_credentials SET credential = $2, last_used_at = NOW() WHERE credential_id = $1`, credentialID, credential)
	return err
}

func (s *Store) DeletePasskey(ctx context.Context, userID, passkeyID int64) (Passkey, error) {
	var k Passkey
	err := s.db.QueryRowContext(ctx, `DELETE FROM webauthn_credentials WHERE id = $1 AND user_id = $2 RETURNING id, name, created_at`, passkeyID, userID).
		Scan(&k.ID, &k.Name, &k.CreatedAt)
	if errors.Is(err, sql.ErrNoRows) {
		return Passkey{}, ErrPasskeyNotFound
	}
	return k, err
}

// SaveWebAuthnChallenge keeps ceremony state until "finish". userID is 0 for
// sign-in, where the user isn't known yet.
func (s *Store) SaveWebAuthnChallenge(ctx context.Context, tokenHash string, userID int64, kind string, session []byte, expiresAt time.Time) error {
	_, _ = s.db.ExecContext(ctx, `DELETE FROM webauthn_challenges WHERE expires_at < NOW()`)
	_, err := s.db.ExecContext(ctx, `
		INSERT INTO webauthn_challenges (token_hash, user_id, kind, session, expires_at) VALUES ($1, $2, $3, $4, $5)
	`, tokenHash, nullableID(userID), kind, session, expiresAt.UTC())
	return err
}

// TakeWebAuthnChallenge removes and returns ceremony state, so each one can
// be finished only once.
func (s *Store) TakeWebAuthnChallenge(ctx context.Context, tokenHash, kind string) (int64, []byte, error) {
	var userID sql.NullInt64
	var session []byte
	err := s.db.QueryRowContext(ctx, `
		DELETE FROM webauthn_challenges WHERE token_hash = $1 AND kind = $2 AND expires_at > NOW()
		RETURNING user_id, session
	`, tokenHash, kind).Scan(&userID, &session)
	if errors.Is(err, sql.ErrNoRows) {
		return 0, nil, ErrChallengeNotFound
	}
	if err != nil {
		return 0, nil, err
	}
	return userID.Int64, session, nil
}
