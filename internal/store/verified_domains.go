package store

import (
	"context"
	"database/sql"
	"errors"
	"strings"
	"time"

	"github.com/jackc/pgx/v5/pgconn"
)

var (
	ErrDomainNotFound  = errors.New("domain not found")
	ErrDomainLimit     = errors.New("this workspace has as many domains as its plan allows")
	ErrDomainDuplicate = errors.New("this domain is already added")
)

const (
	// DomainRecheckEvery is how often a verified domain's proof is checked.
	DomainRecheckEvery = 24 * time.Hour
	// DomainGracePeriod is how long a verified domain's proof may be missing
	// before it lapses.
	DomainGracePeriod = 7 * 24 * time.Hour
	// DomainPendingFor is how long a new domain is checked hourly by itself.
	DomainPendingFor = 7 * 24 * time.Hour
)

// VerifiedDomain is a domain a workspace has added, and how far it has got
// with proving it controls it.
type VerifiedDomain struct {
	ID            int64      `json:"id"`
	WorkspaceID   int64      `json:"-"`
	UserID        int64      `json:"-"`
	Domain        string     `json:"domain"`
	Token         string     `json:"token"`
	Status        string     `json:"status"`
	Method        string     `json:"method,omitempty"`
	VerifiedAt    *time.Time `json:"verified_at,omitempty"`
	LastSeenAt    *time.Time `json:"last_seen_at,omitempty"`
	LastCheckedAt *time.Time `json:"last_checked_at,omitempty"`
	LastError     string     `json:"last_error,omitempty"`
	NextCheckAt   time.Time  `json:"next_check_at"`
	CreatedAt     time.Time  `json:"created_at"`
}

const domainColumns = `id, workspace_id, COALESCE(user_id, 0), domain, token, status, method,
	verified_at, last_seen_at, last_checked_at, last_error, next_check_at, created_at`

func scanDomain(row interface{ Scan(...any) error }, d *VerifiedDomain) error {
	var verified, seen, checked sql.NullTime
	if err := row.Scan(&d.ID, &d.WorkspaceID, &d.UserID, &d.Domain, &d.Token, &d.Status, &d.Method,
		&verified, &seen, &checked, &d.LastError, &d.NextCheckAt, &d.CreatedAt); err != nil {
		return err
	}
	d.VerifiedAt, d.LastSeenAt, d.LastCheckedAt = timePtr(verified), timePtr(seen), timePtr(checked)
	return nil
}

func timePtr(t sql.NullTime) *time.Time {
	if !t.Valid {
		return nil
	}
	v := t.Time
	return &v
}

// AddDomain records a domain the workspace wants to verify, with its token.
func (s *Store) AddDomain(ctx context.Context, d VerifiedDomain, limit int) (VerifiedDomain, error) {
	if s == nil {
		return VerifiedDomain{}, errors.New("store is not available")
	}
	tx, err := s.beginWorkspaceTx(ctx, d.WorkspaceID)
	if err != nil {
		return VerifiedDomain{}, err
	}
	defer func() { _ = tx.Rollback() }()
	if limit > 0 {
		var n int
		if err := tx.QueryRowContext(ctx, `SELECT COUNT(*) FROM verified_domains WHERE workspace_id = $1`, d.WorkspaceID).Scan(&n); err != nil {
			return VerifiedDomain{}, err
		}
		if n >= limit {
			return VerifiedDomain{}, ErrDomainLimit
		}
	}
	var saved VerifiedDomain
	err = scanDomain(tx.QueryRowContext(ctx, `
		INSERT INTO verified_domains (workspace_id, user_id, domain, token) VALUES ($1, $2, $3, $4)
		RETURNING `+domainColumns, d.WorkspaceID, nullableID(d.UserID), d.Domain, d.Token), &saved)
	var pgErr *pgconn.PgError
	if errors.As(err, &pgErr) && pgErr.Code == "23505" {
		return VerifiedDomain{}, ErrDomainDuplicate
	}
	if err != nil {
		return VerifiedDomain{}, err
	}
	return saved, tx.Commit()
}

// ListDomains returns the workspace's domains, verified first.
func (s *Store) ListDomains(ctx context.Context, workspaceID int64) ([]VerifiedDomain, error) {
	if s == nil {
		return nil, errors.New("store is not available")
	}
	tx, err := s.beginWorkspaceTx(ctx, workspaceID)
	if err != nil {
		return nil, err
	}
	defer func() { _ = tx.Rollback() }()
	rows, err := tx.QueryContext(ctx, `SELECT `+domainColumns+` FROM verified_domains WHERE workspace_id = $1
		ORDER BY status = 'verified' DESC, domain`, workspaceID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []VerifiedDomain{}
	for rows.Next() {
		var d VerifiedDomain
		if err := scanDomain(rows, &d); err != nil {
			return nil, err
		}
		out = append(out, d)
	}
	return out, rows.Err()
}

// GetDomain returns one of the workspace's domains.
func (s *Store) GetDomain(ctx context.Context, workspaceID, id int64) (VerifiedDomain, error) {
	if s == nil {
		return VerifiedDomain{}, errors.New("store is not available")
	}
	tx, err := s.beginWorkspaceTx(ctx, workspaceID)
	if err != nil {
		return VerifiedDomain{}, err
	}
	defer func() { _ = tx.Rollback() }()
	var d VerifiedDomain
	err = scanDomain(tx.QueryRowContext(ctx, `SELECT `+domainColumns+` FROM verified_domains WHERE id = $1 AND workspace_id = $2`, id, workspaceID), &d)
	if errors.Is(err, sql.ErrNoRows) {
		return VerifiedDomain{}, ErrDomainNotFound
	}
	return d, err
}

// DeleteDomain removes a domain; scans that needed it stop being allowed.
func (s *Store) DeleteDomain(ctx context.Context, workspaceID, id int64) (VerifiedDomain, error) {
	if s == nil {
		return VerifiedDomain{}, errors.New("store is not available")
	}
	tx, err := s.beginWorkspaceTx(ctx, workspaceID)
	if err != nil {
		return VerifiedDomain{}, err
	}
	defer func() { _ = tx.Rollback() }()
	var d VerifiedDomain
	err = scanDomain(tx.QueryRowContext(ctx, `DELETE FROM verified_domains WHERE id = $1 AND workspace_id = $2 RETURNING `+domainColumns, id, workspaceID), &d)
	if errors.Is(err, sql.ErrNoRows) {
		return VerifiedDomain{}, ErrDomainNotFound
	}
	if err != nil {
		return VerifiedDomain{}, err
	}
	return d, tx.Commit()
}

// DomainCheckResult is what one proof check found.
type DomainCheckResult struct {
	Found  bool
	Method string
	Error  string
}

// RecordDomainCheck applies a proof check: found verifies the domain;
// missing leaves a pending one pending and lapses a verified one only once
// its proof has been gone for DomainGracePeriod. It returns the domain as it
// is now and its status before.
func (s *Store) RecordDomainCheck(ctx context.Context, d VerifiedDomain, res DomainCheckResult) (VerifiedDomain, string, error) {
	if s == nil {
		return VerifiedDomain{}, "", errors.New("store is not available")
	}
	tx, err := s.beginWorkspaceTx(ctx, d.WorkspaceID)
	if err != nil {
		return VerifiedDomain{}, "", err
	}
	defer func() { _ = tx.Rollback() }()
	var before string
	if err := tx.QueryRowContext(ctx, `SELECT status FROM verified_domains WHERE id = $1 FOR UPDATE`, d.ID).Scan(&before); err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return VerifiedDomain{}, "", ErrDomainNotFound
		}
		return VerifiedDomain{}, "", err
	}
	var saved VerifiedDomain
	if res.Found {
		err = scanDomain(tx.QueryRowContext(ctx, `
			UPDATE verified_domains SET
				status = 'verified', method = $2,
				verified_at = CASE WHEN status = 'verified' THEN verified_at ELSE NOW() END,
				last_seen_at = NOW(), last_checked_at = NOW(), last_error = '',
				next_check_at = NOW() + make_interval(secs => $3)
			WHERE id = $1 RETURNING `+domainColumns, d.ID, res.Method, DomainRecheckEvery.Seconds()), &saved)
	} else {
		err = scanDomain(tx.QueryRowContext(ctx, `
			UPDATE verified_domains SET
				status = CASE
					WHEN status = 'verified' AND COALESCE(last_seen_at, verified_at) < NOW() - make_interval(secs => $3) THEN 'lapsed'
					ELSE status
				END,
				last_checked_at = NOW(), last_error = $2,
				-- Pending domains are retried hourly for a week; verified ones
				-- whose proof went missing, every few hours until they lapse.
				next_check_at = NOW() + CASE
					WHEN status = 'pending' AND created_at > NOW() - make_interval(secs => $4) THEN INTERVAL '1 hour'
					WHEN status = 'verified' THEN INTERVAL '6 hours'
					ELSE INTERVAL '100 years'
				END
			WHERE id = $1 RETURNING `+domainColumns, d.ID, clipText(res.Error, 500), DomainGracePeriod.Seconds(), DomainPendingFor.Seconds()), &saved)
	}
	if err != nil {
		return VerifiedDomain{}, "", err
	}
	return saved, before, tx.Commit()
}

// ClaimDueDomains picks domains whose proof is due a check and moves each an
// hour ahead, so another instance won't take it before it's recorded. It
// works across workspaces and runs as the login role.
func (s *Store) ClaimDueDomains(ctx context.Context, limit int) ([]VerifiedDomain, error) {
	if s == nil {
		return nil, nil
	}
	rows, err := s.db.QueryContext(ctx, `
		UPDATE verified_domains d SET next_check_at = NOW() + INTERVAL '1 hour'
		WHERE d.id IN (
			SELECT id FROM verified_domains WHERE next_check_at <= NOW()
			ORDER BY next_check_at LIMIT $1 FOR UPDATE SKIP LOCKED
		)
		RETURNING `+domainColumns, limit)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []VerifiedDomain
	for rows.Next() {
		var d VerifiedDomain
		if err := scanDomain(rows, &d); err != nil {
			return nil, err
		}
		out = append(out, d)
	}
	return out, rows.Err()
}

// VerifiedDomainFor returns the workspace's verified domain that covers host:
// the domain itself or any name under it.
func (s *Store) VerifiedDomainFor(ctx context.Context, workspaceID int64, host string) (VerifiedDomain, error) {
	if s == nil {
		return VerifiedDomain{}, errors.New("store is not available")
	}
	host = strings.TrimSuffix(strings.ToLower(strings.TrimSpace(host)), ".")
	tx, err := s.beginWorkspaceTx(ctx, workspaceID)
	if err != nil {
		return VerifiedDomain{}, err
	}
	defer func() { _ = tx.Rollback() }()
	var d VerifiedDomain
	err = scanDomain(tx.QueryRowContext(ctx, `SELECT `+domainColumns+` FROM verified_domains
		WHERE workspace_id = $1 AND status = 'verified' AND ($2 = domain OR right($2, length(domain) + 1) = '.' || domain)
		ORDER BY length(domain) DESC LIMIT 1`, workspaceID, host), &d)
	if errors.Is(err, sql.ErrNoRows) {
		return VerifiedDomain{}, ErrDomainNotFound
	}
	return d, err
}

func clipText(s string, n int) string {
	if len(s) > n {
		return s[:n]
	}
	return s
}
