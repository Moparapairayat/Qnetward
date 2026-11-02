package store

import (
	"context"
	"database/sql"
	"errors"
	"time"
)

var (
	ErrMFANotSetUp        = errors.New("two-factor sign-in is not set up")
	ErrMFAAlreadyEnabled  = errors.New("two-factor sign-in is already on")
	ErrMFAChallengeFailed = errors.New("sign-in step expired or had too many attempts; sign in again")
)

// MaxMFAAttempts is how many codes one sign-in challenge accepts.
const MaxMFAAttempts = 5

type MFAState struct {
	SecretEnc      string
	Enabled        bool
	EnabledAt      *time.Time
	RecoveryLeft   int
	LastStep       int64
	recoveryHashes []string
}

// GetMFA returns the user's two-factor state; found is false if they never
// started setting it up.
func (s *Store) GetMFA(ctx context.Context, userID int64) (MFAState, bool, error) {
	var m MFAState
	var enabled sql.NullTime
	var hashes string
	err := s.db.QueryRowContext(ctx, `SELECT secret_enc, enabled_at, recovery_hashes, last_step FROM user_mfa WHERE user_id = $1`, userID).
		Scan(&m.SecretEnc, &enabled, &hashes, &m.LastStep)
	if errors.Is(err, sql.ErrNoRows) {
		return MFAState{}, false, nil
	}
	if err != nil {
		return MFAState{}, false, err
	}
	m.EnabledAt = nullTimePtr(enabled)
	m.Enabled = enabled.Valid
	m.recoveryHashes = parseScopeArray(hashes)
	m.RecoveryLeft = len(m.recoveryHashes)
	return m, true, nil
}

// StartMFASetup stores a new, unconfirmed secret, replacing any earlier
// unconfirmed one. It refuses while two-factor sign-in is on.
func (s *Store) StartMFASetup(ctx context.Context, userID int64, secretEnc string) error {
	res, err := s.db.ExecContext(ctx, `
		INSERT INTO user_mfa (user_id, secret_enc) VALUES ($1, $2)
		ON CONFLICT (user_id) DO UPDATE SET secret_enc = EXCLUDED.secret_enc, last_step = 0, recovery_hashes = '{}', created_at = NOW()
		WHERE user_mfa.enabled_at IS NULL
	`, userID, secretEnc)
	if err != nil {
		return err
	}
	if n, _ := res.RowsAffected(); n == 0 {
		return ErrMFAAlreadyEnabled
	}
	return nil
}

// EnableMFA turns two-factor sign-in on after the first code was confirmed.
func (s *Store) EnableMFA(ctx context.Context, userID, step int64, recoveryHashes []string) error {
	res, err := s.db.ExecContext(ctx, `
		UPDATE user_mfa SET enabled_at = NOW(), last_step = $2, recovery_hashes = $3
		WHERE user_id = $1 AND enabled_at IS NULL
	`, userID, step, recoveryHashes)
	if err != nil {
		return err
	}
	if n, _ := res.RowsAffected(); n == 0 {
		return ErrMFANotSetUp
	}
	return nil
}

// DisableMFA turns two-factor sign-in off and forgets the secret.
func (s *Store) DisableMFA(ctx context.Context, userID int64) error {
	_, err := s.db.ExecContext(ctx, `DELETE FROM user_mfa WHERE user_id = $1`, userID)
	return err
}

// UseMFAStep records an accepted code's time step. It returns false if that
// step, or a later one, was already used: the code is being replayed.
func (s *Store) UseMFAStep(ctx context.Context, userID, step int64) (bool, error) {
	res, err := s.db.ExecContext(ctx, `UPDATE user_mfa SET last_step = $2 WHERE user_id = $1 AND last_step < $2`, userID, step)
	if err != nil {
		return false, err
	}
	n, _ := res.RowsAffected()
	return n == 1, nil
}

// UseRecoveryCode spends a recovery code. It returns false if the code is
// unknown or was already used.
func (s *Store) UseRecoveryCode(ctx context.Context, userID int64, codeHash string) (bool, error) {
	res, err := s.db.ExecContext(ctx, `
		UPDATE user_mfa SET recovery_hashes = array_remove(recovery_hashes, $2)
		WHERE user_id = $1 AND $2 = ANY(recovery_hashes)
	`, userID, codeHash)
	if err != nil {
		return false, err
	}
	n, _ := res.RowsAffected()
	return n == 1, nil
}

// CreateMFAChallenge starts the second sign-in step.
func (s *Store) CreateMFAChallenge(ctx context.Context, userID int64, tokenHash string, expiresAt time.Time) error {
	_, _ = s.db.ExecContext(ctx, `DELETE FROM mfa_challenges WHERE expires_at < NOW()`)
	_, err := s.db.ExecContext(ctx, `INSERT INTO mfa_challenges (token_hash, user_id, expires_at) VALUES ($1, $2, $3)`, tokenHash, userID, expiresAt.UTC())
	return err
}

// TakeMFAChallenge counts one attempt against a challenge and returns its
// user. It fails once the challenge has expired or run out of attempts.
func (s *Store) TakeMFAChallenge(ctx context.Context, tokenHash string) (User, error) {
	var userID int64
	err := s.db.QueryRowContext(ctx, `
		UPDATE mfa_challenges SET attempts = attempts + 1
		WHERE token_hash = $1 AND expires_at > NOW() AND attempts < $2
		RETURNING user_id
	`, tokenHash, MaxMFAAttempts).Scan(&userID)
	if errors.Is(err, sql.ErrNoRows) {
		return User{}, ErrMFAChallengeFailed
	}
	if err != nil {
		return User{}, err
	}
	return s.GetUserByID(ctx, userID)
}

// FinishMFAChallenge removes a challenge once the code was accepted.
func (s *Store) FinishMFAChallenge(ctx context.Context, tokenHash string) error {
	_, err := s.db.ExecContext(ctx, `DELETE FROM mfa_challenges WHERE token_hash = $1`, tokenHash)
	return err
}

// ReplaceRecoveryCodes swaps in a new set of recovery codes.
func (s *Store) ReplaceRecoveryCodes(ctx context.Context, userID int64, recoveryHashes []string) error {
	res, err := s.db.ExecContext(ctx, `UPDATE user_mfa SET recovery_hashes = $2 WHERE user_id = $1 AND enabled_at IS NOT NULL`, userID, recoveryHashes)
	if err != nil {
		return err
	}
	if n, _ := res.RowsAffected(); n == 0 {
		return ErrMFANotSetUp
	}
	return nil
}
