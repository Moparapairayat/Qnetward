package store

import (
	"context"
	"database/sql"
	"errors"
	"net/mail"
	"strings"
	"time"
)

var (
	ErrUserExists         = errors.New("user already exists")
	ErrUserNotFound       = errors.New("user not found")
	ErrInvalidCredentials = errors.New("invalid email or password")
	ErrEmailNotVerified   = errors.New("email not verified")
	ErrSessionNotFound    = errors.New("session not found")
	ErrResetTokenNotFound = errors.New("reset token not found")
	ErrVerificationCode   = errors.New("verification code is invalid or expired")
)

type User struct {
	ID                   int64      `json:"id"`
	Name                 string     `json:"name"`
	Email                string     `json:"email"`
	VerificationRequired bool       `json:"verification_required"`
	EmailVerifiedAt      *time.Time `json:"email_verified_at,omitempty"`
	CreatedAt            time.Time  `json:"created_at"`
}

type SessionDetails struct {
	User              User
	ActiveWorkspaceID int64
}

func NormalizeEmail(value string) (string, error) {
	value = strings.ToLower(strings.TrimSpace(value))
	if value == "" {
		return "", errors.New("email is required")
	}
	addr, err := mail.ParseAddress(value)
	if err != nil || !strings.EqualFold(strings.TrimSpace(addr.Address), value) {
		return "", errors.New("email is invalid")
	}
	return value, nil
}

func (s *Store) CreateUser(ctx context.Context, name, email, passwordHash string, verificationRequired bool) (User, error) {
	email, err := NormalizeEmail(email)
	if err != nil {
		return User{}, err
	}
	name = strings.TrimSpace(name)
	if name == "" {
		return User{}, errors.New("name is required")
	}

	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return User{}, err
	}
	defer func() {
		_ = tx.Rollback()
	}()

	var user User
	err = tx.QueryRowContext(ctx, `
		INSERT INTO users (name, email, password_hash, verification_required)
		VALUES ($1, $2, $3, $4)
		RETURNING id, name, email, verification_required, email_verified_at, created_at
	`, name, email, passwordHash, verificationRequired).Scan(&user.ID, &user.Name, &user.Email, &user.VerificationRequired, &user.EmailVerifiedAt, &user.CreatedAt)
	if err != nil {
		if strings.Contains(strings.ToLower(err.Error()), "idx_users_email_lower") {
			return User{}, ErrUserExists
		}
		return User{}, err
	}
	if _, err := ensureDefaultWorkspaceTx(ctx, tx, user); err != nil {
		return User{}, err
	}
	if err := tx.Commit(); err != nil {
		return User{}, err
	}
	return user, nil
}

// ReclaimUnverifiedUser lets someone sign up again with an email whose account
// was never verified, for a typo in the name or a forgotten password before the
// code arrived. Nobody could have used that account, so it takes the new name
// and password. A verified account is never touched: it returns ErrUserExists.
func (s *Store) ReclaimUnverifiedUser(ctx context.Context, name, email, passwordHash string) (User, error) {
	email, err := NormalizeEmail(email)
	if err != nil {
		return User{}, err
	}
	name = strings.TrimSpace(name)
	if name == "" {
		return User{}, errors.New("name is required")
	}
	var user User
	err = s.db.QueryRowContext(ctx, `
		UPDATE users SET name = $2, password_hash = $3
		WHERE email = $1 AND verification_required AND email_verified_at IS NULL
		RETURNING id, name, email, verification_required, email_verified_at, created_at
	`, email, name, passwordHash).Scan(&user.ID, &user.Name, &user.Email, &user.VerificationRequired, &user.EmailVerifiedAt, &user.CreatedAt)
	if errors.Is(err, sql.ErrNoRows) {
		return User{}, ErrUserExists
	}
	return user, err
}

func (s *Store) AuthenticateUser(ctx context.Context, email string) (User, string, error) {
	email, err := NormalizeEmail(email)
	if err != nil {
		return User{}, "", err
	}

	var user User
	var passwordHash string
	err = s.db.QueryRowContext(ctx, `
		SELECT id, name, email, password_hash, verification_required, email_verified_at, created_at
		FROM users
		WHERE email = $1
	`, email).Scan(&user.ID, &user.Name, &user.Email, &passwordHash, &user.VerificationRequired, &user.EmailVerifiedAt, &user.CreatedAt)
	if errors.Is(err, sql.ErrNoRows) {
		return User{}, "", ErrInvalidCredentials
	}
	if err != nil {
		return User{}, "", err
	}
	return user, passwordHash, nil
}

func (s *Store) GetUserByEmail(ctx context.Context, email string) (User, error) {
	email, err := NormalizeEmail(email)
	if err != nil {
		return User{}, err
	}

	var user User
	err = s.db.QueryRowContext(ctx, `
		SELECT id, name, email, verification_required, email_verified_at, created_at
		FROM users
		WHERE email = $1
	`, email).Scan(&user.ID, &user.Name, &user.Email, &user.VerificationRequired, &user.EmailVerifiedAt, &user.CreatedAt)
	if errors.Is(err, sql.ErrNoRows) {
		return User{}, ErrUserNotFound
	}
	if err != nil {
		return User{}, err
	}
	return user, nil
}

// GetUserByID looks a user up by ID.
func (s *Store) GetUserByID(ctx context.Context, userID int64) (User, error) {
	var user User
	err := s.db.QueryRowContext(ctx, `
		SELECT id, name, email, verification_required, email_verified_at, created_at
		FROM users
		WHERE id = $1
	`, userID).Scan(&user.ID, &user.Name, &user.Email, &user.VerificationRequired, &user.EmailVerifiedAt, &user.CreatedAt)
	if errors.Is(err, sql.ErrNoRows) {
		return User{}, ErrUserNotFound
	}
	if err != nil {
		return User{}, err
	}
	return user, nil
}

func (s *Store) UpdateUserProfile(ctx context.Context, userID int64, name, email string) (User, bool, error) {
	email, err := NormalizeEmail(email)
	if err != nil {
		return User{}, false, err
	}
	name = strings.TrimSpace(name)
	if name == "" {
		return User{}, false, errors.New("name is required")
	}

	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return User{}, false, err
	}
	defer func() {
		_ = tx.Rollback()
	}()

	var current User
	err = tx.QueryRowContext(ctx, `
		SELECT id, name, email, verification_required, email_verified_at, created_at
		FROM users
		WHERE id = $1
		FOR UPDATE
	`, userID).Scan(&current.ID, &current.Name, &current.Email, &current.VerificationRequired, &current.EmailVerifiedAt, &current.CreatedAt)
	if errors.Is(err, sql.ErrNoRows) {
		return User{}, false, ErrUserNotFound
	}
	if err != nil {
		return User{}, false, err
	}

	emailChanged := current.Email != email
	if !emailChanged && current.Name == name {
		return current, false, tx.Commit()
	}

	var updated User
	err = tx.QueryRowContext(ctx, `
		UPDATE users
		SET
			name = $2,
			email = $3,
			verification_required = CASE WHEN $4 THEN TRUE ELSE verification_required END,
			email_verified_at = CASE WHEN $4 THEN NULL ELSE email_verified_at END
		WHERE id = $1
		RETURNING id, name, email, verification_required, email_verified_at, created_at
	`, userID, name, email, emailChanged).Scan(&updated.ID, &updated.Name, &updated.Email, &updated.VerificationRequired, &updated.EmailVerifiedAt, &updated.CreatedAt)
	if err != nil {
		if strings.Contains(strings.ToLower(err.Error()), "idx_users_email_lower") {
			return User{}, false, ErrUserExists
		}
		return User{}, false, err
	}

	if emailChanged {
		if _, err := tx.ExecContext(ctx, `
			DELETE FROM email_verification_codes
			WHERE user_id = $1
		`, userID); err != nil {
			return User{}, false, err
		}
	}

	return updated, emailChanged, tx.Commit()
}

// CreateSession stores a session without browser details; see CreateSessionWithMeta.
func (s *Store) CreateSession(ctx context.Context, userID int64, tokenHash string, expiresAt time.Time) error {
	return s.CreateSessionWithMeta(ctx, userID, tokenHash, expiresAt, SessionMeta{})
}

func (s *Store) GetUserBySessionToken(ctx context.Context, tokenHash string) (User, error) {
	session, err := s.GetSessionDetailsByToken(ctx, tokenHash)
	if err != nil {
		return User{}, err
	}
	return session.User, nil
}

func (s *Store) GetSessionDetailsByToken(ctx context.Context, tokenHash string) (SessionDetails, error) {
	var details SessionDetails
	var user User
	err := s.db.QueryRowContext(ctx, `
		SELECT u.id, u.name, u.email, u.verification_required, u.email_verified_at, u.created_at, COALESCE(s.active_workspace_id, 0)
		FROM sessions s
		INNER JOIN users u ON u.id = s.user_id
		WHERE s.token_hash = $1 AND s.expires_at > NOW()
	`, tokenHash).Scan(&user.ID, &user.Name, &user.Email, &user.VerificationRequired, &user.EmailVerifiedAt, &user.CreatedAt, &details.ActiveWorkspaceID)
	if errors.Is(err, sql.ErrNoRows) {
		return SessionDetails{}, ErrSessionNotFound
	}
	if err != nil {
		return SessionDetails{}, err
	}
	details.User = user
	return details, nil
}

func (s *Store) SetSessionActiveWorkspace(ctx context.Context, tokenHash string, userID, workspaceID int64) error {
	var exists bool
	if err := s.db.QueryRowContext(ctx, `
		SELECT EXISTS(
			SELECT 1
			FROM workspace_members
			WHERE user_id = $1 AND workspace_id = $2
		)
	`, userID, workspaceID).Scan(&exists); err != nil {
		return err
	}
	if !exists {
		return ErrWorkspaceMemberNotFound
	}
	result, err := s.db.ExecContext(ctx, `
		UPDATE sessions
		SET active_workspace_id = $3
		WHERE token_hash = $1 AND user_id = $2
	`, tokenHash, userID, workspaceID)
	if err != nil {
		return err
	}
	rowsAffected, err := result.RowsAffected()
	if err != nil {
		return err
	}
	if rowsAffected == 0 {
		return ErrSessionNotFound
	}
	return nil
}

func (s *Store) DeleteSession(ctx context.Context, tokenHash string) error {
	if tokenHash == "" {
		return nil
	}
	_, err := s.db.ExecContext(ctx, `DELETE FROM sessions WHERE token_hash = $1`, tokenHash)
	return err
}

func (s *Store) DeleteExpiredSessions(ctx context.Context) error {
	_, err := s.db.ExecContext(ctx, `DELETE FROM sessions WHERE expires_at <= NOW()`)
	return err
}

func (s *Store) CreateEmailVerificationCode(ctx context.Context, userID int64, codeHash string, expiresAt time.Time) error {
	_, err := s.db.ExecContext(ctx, `
		INSERT INTO email_verification_codes (user_id, code_hash, expires_at)
		VALUES ($1, $2, $3)
		ON CONFLICT (user_id)
		DO UPDATE
		SET code_hash = EXCLUDED.code_hash,
			expires_at = EXCLUDED.expires_at,
			attempts = 0,
			created_at = NOW()
	`, userID, codeHash, expiresAt.UTC())
	return err
}

func (s *Store) DeleteExpiredEmailVerificationCodes(ctx context.Context) error {
	_, err := s.db.ExecContext(ctx, `
		DELETE FROM email_verification_codes
		WHERE expires_at <= NOW()
	`)
	return err
}

func (s *Store) HasRecentEmailVerificationCode(ctx context.Context, userID int64, since time.Time) (bool, error) {
	var exists bool
	err := s.db.QueryRowContext(ctx, `
		SELECT EXISTS(
			SELECT 1
			FROM email_verification_codes
			WHERE user_id = $1
				AND created_at >= $2
				AND expires_at > NOW()
		)
	`, userID, since.UTC()).Scan(&exists)
	return exists, err
}

func (s *Store) DeleteEmailVerificationCode(ctx context.Context, userID int64) error {
	_, err := s.db.ExecContext(ctx, `
		DELETE FROM email_verification_codes
		WHERE user_id = $1
	`, userID)
	return err
}

// MaxEmailCodeAttempts is how many wrong guesses one email verification code
// takes before it is spent.
const MaxEmailCodeAttempts = 5

func (s *Store) VerifyUserEmailCode(ctx context.Context, email string, codeHash string) (User, error) {
	email, err := NormalizeEmail(email)
	if err != nil {
		return User{}, err
	}

	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return User{}, err
	}
	defer func() {
		_ = tx.Rollback()
	}()

	var user User
	err = tx.QueryRowContext(ctx, `
		SELECT u.id, u.name, u.email, u.verification_required, u.email_verified_at, u.created_at
		FROM users u
		INNER JOIN email_verification_codes evc ON evc.user_id = u.id
		WHERE u.email = $1
			AND u.verification_required = TRUE
			AND evc.code_hash = $2
			AND evc.expires_at > NOW()
			AND evc.attempts < $3
		FOR UPDATE
	`, email, codeHash, MaxEmailCodeAttempts).Scan(&user.ID, &user.Name, &user.Email, &user.VerificationRequired, &user.EmailVerifiedAt, &user.CreatedAt)
	if errors.Is(err, sql.ErrNoRows) {
		// A wrong code counts against the one that was sent; once it has had
		// MaxEmailCodeAttempts wrong guesses it is spent, and a new one must be
		// requested. Guessing all million codes is then out of reach, from any
		// number of addresses.
		if _, err := tx.ExecContext(ctx, `
			UPDATE email_verification_codes SET attempts = attempts + 1
			WHERE user_id = (SELECT id FROM users WHERE email = $1)`, email); err != nil {
			return User{}, err
		}
		if _, err := tx.ExecContext(ctx, `
			DELETE FROM email_verification_codes
			WHERE attempts >= $2 AND user_id = (SELECT id FROM users WHERE email = $1)`, email, MaxEmailCodeAttempts); err != nil {
			return User{}, err
		}
		if err := tx.Commit(); err != nil {
			return User{}, err
		}
		return User{}, ErrVerificationCode
	}
	if err != nil {
		return User{}, err
	}

	var verifiedAt time.Time
	if err := tx.QueryRowContext(ctx, `
		UPDATE users
		SET verification_required = FALSE, email_verified_at = NOW()
		WHERE id = $1
		RETURNING email_verified_at
	`, user.ID).Scan(&verifiedAt); err != nil {
		return User{}, err
	}

	if _, err := tx.ExecContext(ctx, `
		DELETE FROM email_verification_codes
		WHERE user_id = $1
	`, user.ID); err != nil {
		return User{}, err
	}

	user.VerificationRequired = false
	user.EmailVerifiedAt = &verifiedAt

	return user, tx.Commit()
}

func (s *Store) CreatePasswordResetToken(ctx context.Context, userID int64, tokenHash string, expiresAt time.Time) error {
	_, err := s.db.ExecContext(ctx, `
		INSERT INTO password_reset_tokens (user_id, token_hash, expires_at, used_at)
		VALUES ($1, $2, $3, NULL)
		ON CONFLICT (user_id)
		DO UPDATE
		SET token_hash = EXCLUDED.token_hash,
			expires_at = EXCLUDED.expires_at,
			used_at = NULL,
			created_at = NOW()
	`, userID, tokenHash, expiresAt.UTC())
	return err
}

func (s *Store) HasRecentPasswordResetToken(ctx context.Context, userID int64, since time.Time) (bool, error) {
	var exists bool
	err := s.db.QueryRowContext(ctx, `
		SELECT EXISTS(
			SELECT 1
			FROM password_reset_tokens
			WHERE user_id = $1
				AND created_at >= $2
				AND used_at IS NULL
				AND expires_at > NOW()
		)
	`, userID, since.UTC()).Scan(&exists)
	return exists, err
}

func (s *Store) DeletePasswordResetToken(ctx context.Context, userID int64) error {
	_, err := s.db.ExecContext(ctx, `
		DELETE FROM password_reset_tokens
		WHERE user_id = $1
	`, userID)
	return err
}

func (s *Store) DeleteExpiredPasswordResetTokens(ctx context.Context) error {
	_, err := s.db.ExecContext(ctx, `
		DELETE FROM password_reset_tokens
		WHERE expires_at <= NOW() OR used_at IS NOT NULL
	`)
	return err
}

func (s *Store) ResetPasswordWithToken(ctx context.Context, tokenHash string, passwordHash string) error {
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return err
	}
	defer func() {
		_ = tx.Rollback()
	}()

	var userID int64
	err = tx.QueryRowContext(ctx, `
		SELECT user_id
		FROM password_reset_tokens
		WHERE token_hash = $1 AND used_at IS NULL AND expires_at > NOW()
		FOR UPDATE
	`, tokenHash).Scan(&userID)
	if errors.Is(err, sql.ErrNoRows) {
		return ErrResetTokenNotFound
	}
	if err != nil {
		return err
	}

	if _, err := tx.ExecContext(ctx, `
		UPDATE users
		SET password_hash = $1
		WHERE id = $2
	`, passwordHash, userID); err != nil {
		return err
	}

	if _, err := tx.ExecContext(ctx, `
		UPDATE password_reset_tokens
		SET used_at = NOW()
		WHERE token_hash = $1
	`, tokenHash); err != nil {
		return err
	}

	if _, err := tx.ExecContext(ctx, `DELETE FROM sessions WHERE user_id = $1`, userID); err != nil {
		return err
	}

	return tx.Commit()
}
