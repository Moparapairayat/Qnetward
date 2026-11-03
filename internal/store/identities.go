package store

import (
	"context"
	"database/sql"
	"errors"
	"strings"
)

// IdentitySignIn resolves an outside identity (provider and subject) to an
// account:
//
//  1. an account already linked to it,
//  2. otherwise the account with the same email, which gets linked (the
//     provider has verified the email, so this is the same person),
//  3. otherwise a new account, with passwordHash as an unusable password.
//
// created reports whether a new account was made.
func (s *Store) IdentitySignIn(ctx context.Context, provider, subject, email, name, passwordHash string) (user User, created bool, err error) {
	if s == nil {
		return User{}, false, errors.New("store is not available")
	}
	provider = strings.TrimSpace(provider)
	subject = strings.TrimSpace(subject)
	if provider == "" || subject == "" {
		return User{}, false, errors.New("identity provider and subject are required")
	}
	email, err = NormalizeEmail(email)
	if err != nil {
		return User{}, false, err
	}

	var userID int64
	err = s.db.QueryRowContext(ctx, `
		UPDATE user_identities SET last_used_at = NOW(), email = $3
		WHERE provider = $1 AND subject = $2
		RETURNING user_id
	`, provider, subject, email).Scan(&userID)
	if err == nil {
		user, err = s.GetUserByID(ctx, userID)
		return user, false, err
	}
	if !errors.Is(err, sql.ErrNoRows) {
		return User{}, false, err
	}

	user, err = s.GetUserByEmail(ctx, email)
	switch {
	case err == nil:
		// The provider vouches for the address, which also completes any
		// pending email verification.
		if user.VerificationRequired {
			if _, err := s.db.ExecContext(ctx, `UPDATE users SET verification_required = FALSE, email_verified_at = COALESCE(email_verified_at, NOW()) WHERE id = $1`, user.ID); err != nil {
				return User{}, false, err
			}
			user.VerificationRequired = false
		}
	case errors.Is(err, ErrUserNotFound):
		if strings.TrimSpace(name) == "" {
			name = strings.Split(email, "@")[0]
		}
		user, err = s.CreateUser(ctx, name, email, passwordHash, false)
		if err != nil {
			return User{}, false, err
		}
		if _, err := s.db.ExecContext(ctx, `UPDATE users SET email_verified_at = COALESCE(email_verified_at, NOW()) WHERE id = $1`, user.ID); err != nil {
			return User{}, false, err
		}
		created = true
	default:
		return User{}, false, err
	}

	if _, err := s.db.ExecContext(ctx, `
		INSERT INTO user_identities (user_id, provider, subject, email) VALUES ($1, $2, $3, $4)
		ON CONFLICT (provider, subject) DO NOTHING
	`, user.ID, provider, subject, email); err != nil {
		return User{}, false, err
	}
	return user, created, nil
}

// ListUserIdentityProviders returns the providers linked to an account.
func (s *Store) ListUserIdentityProviders(ctx context.Context, userID int64) ([]string, error) {
	rows, err := s.db.QueryContext(ctx, `SELECT provider FROM user_identities WHERE user_id = $1 ORDER BY created_at`, userID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var providers []string
	for rows.Next() {
		var p string
		if err := rows.Scan(&p); err != nil {
			return nil, err
		}
		providers = append(providers, p)
	}
	return providers, rows.Err()
}
