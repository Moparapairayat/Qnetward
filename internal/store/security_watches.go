package store

import (
	"context"
	"database/sql"
	"errors"
	"slices"
	"strings"
	"time"

	"github.com/jackc/pgx/v5/pgconn"
)

var (
	ErrWatchNotFound  = errors.New("watched domain not found")
	ErrWatchLimit     = errors.New("this workspace watches as many domains as its plan allows")
	ErrWatchDuplicate = errors.New("this domain is already watched")
)

// WatchIntervals are how often, in hours, a watched domain can be checked.
var WatchIntervals = []int{6, 24, 168}

// SecurityWatch is a domain whose passive check re-runs on a schedule.
type SecurityWatch struct {
	ID            int64      `json:"id"`
	WorkspaceID   int64      `json:"-"`
	UserID        int64      `json:"-"`
	Domain        string     `json:"domain"`
	IntervalHours int        `json:"interval_hours"`
	NotifyEmail   string     `json:"notify_email"`
	Enabled       bool       `json:"enabled"`
	LastScanID    *int64     `json:"last_scan_id,omitempty"`
	LastGrade     string     `json:"last_grade,omitempty"`
	LastScore     *int       `json:"last_score,omitempty"`
	LastCheckedAt *time.Time `json:"last_checked_at,omitempty"`
	LastError     string     `json:"last_error,omitempty"`
	NextRunAt     time.Time  `json:"next_run_at"`
	CreatedAt     time.Time  `json:"created_at"`
}

const watchColumns = `id, workspace_id, COALESCE(user_id, 0), domain, interval_hours, notify_email, enabled,
	last_scan_id, last_grade, last_score, last_checked_at, last_error, next_run_at, created_at`

func scanWatch(row interface{ Scan(...any) error }, w *SecurityWatch) error {
	var lastScan, lastScore sql.NullInt64
	var checked sql.NullTime
	if err := row.Scan(&w.ID, &w.WorkspaceID, &w.UserID, &w.Domain, &w.IntervalHours, &w.NotifyEmail, &w.Enabled,
		&lastScan, &w.LastGrade, &lastScore, &checked, &w.LastError, &w.NextRunAt, &w.CreatedAt); err != nil {
		return err
	}
	w.LastScanID, w.LastScore, w.LastCheckedAt = nil, nil, nil
	if lastScan.Valid {
		v := lastScan.Int64
		w.LastScanID = &v
	}
	if lastScore.Valid {
		v := int(lastScore.Int64)
		w.LastScore = &v
	}
	if checked.Valid {
		t := checked.Time
		w.LastCheckedAt = &t
	}
	return nil
}

// SaveSecurityWatch adds a watched domain, or updates one. A new watch, or
// one switched back on, is checked right away. limit caps the workspace's
// watches; 0 means no cap.
func (s *Store) SaveSecurityWatch(ctx context.Context, w SecurityWatch, limit int) (SecurityWatch, error) {
	if s == nil {
		return SecurityWatch{}, errors.New("store is not available")
	}
	if !slices.Contains(WatchIntervals, w.IntervalHours) {
		return SecurityWatch{}, errors.New("check every 6 hours, 24 hours, or 7 days")
	}
	w.NotifyEmail = strings.TrimSpace(w.NotifyEmail)
	if w.NotifyEmail != "" {
		email, err := NormalizeEmail(w.NotifyEmail)
		if err != nil {
			return SecurityWatch{}, err
		}
		w.NotifyEmail = email
	}
	tx, err := s.beginWorkspaceTx(ctx, w.WorkspaceID)
	if err != nil {
		return SecurityWatch{}, err
	}
	defer func() { _ = tx.Rollback() }()

	var saved SecurityWatch
	if w.ID == 0 {
		if limit > 0 {
			var n int
			if err := tx.QueryRowContext(ctx, `SELECT COUNT(*) FROM security_watches WHERE workspace_id = $1`, w.WorkspaceID).Scan(&n); err != nil {
				return SecurityWatch{}, err
			}
			if n >= limit {
				return SecurityWatch{}, ErrWatchLimit
			}
		}
		err = scanWatch(tx.QueryRowContext(ctx, `
			INSERT INTO security_watches (workspace_id, user_id, domain, interval_hours, notify_email, enabled, last_scan_id, last_grade, last_score, last_checked_at)
			SELECT $1, $2, $3, $4, $5, $6, s.id, COALESCE(s.grade, ''), s.score, s.created_at
			FROM (SELECT 1) one
			LEFT JOIN LATERAL (
				SELECT id, grade, score, created_at FROM security_scans
				WHERE workspace_id = $1 AND domain = $3 ORDER BY created_at DESC LIMIT 1
			) s ON TRUE
			RETURNING `+watchColumns,
			w.WorkspaceID, nullableID(w.UserID), w.Domain, w.IntervalHours, w.NotifyEmail, w.Enabled), &saved)
	} else {
		err = scanWatch(tx.QueryRowContext(ctx, `
			UPDATE security_watches SET
				interval_hours = $3,
				notify_email = $4,
				next_run_at = CASE WHEN $5 AND NOT enabled THEN NOW() ELSE next_run_at END,
				enabled = $5
			WHERE id = $1 AND workspace_id = $2
			RETURNING `+watchColumns, w.ID, w.WorkspaceID, w.IntervalHours, w.NotifyEmail, w.Enabled), &saved)
	}
	if errors.Is(err, sql.ErrNoRows) {
		return SecurityWatch{}, ErrWatchNotFound
	}
	var pgErr *pgconn.PgError
	if errors.As(err, &pgErr) && pgErr.Code == "23505" {
		return SecurityWatch{}, ErrWatchDuplicate
	}
	if err != nil {
		return SecurityWatch{}, err
	}
	return saved, tx.Commit()
}

// ListSecurityWatches returns the workspace's watched domains.
func (s *Store) ListSecurityWatches(ctx context.Context, workspaceID int64) ([]SecurityWatch, error) {
	if s == nil {
		return nil, errors.New("store is not available")
	}
	tx, err := s.beginWorkspaceTx(ctx, workspaceID)
	if err != nil {
		return nil, err
	}
	defer func() { _ = tx.Rollback() }()
	rows, err := tx.QueryContext(ctx, `SELECT `+watchColumns+` FROM security_watches WHERE workspace_id = $1 ORDER BY domain`, workspaceID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []SecurityWatch{}
	for rows.Next() {
		var w SecurityWatch
		if err := scanWatch(rows, &w); err != nil {
			return nil, err
		}
		out = append(out, w)
	}
	return out, rows.Err()
}

// DeleteSecurityWatch stops watching a domain; its past scans stay.
func (s *Store) DeleteSecurityWatch(ctx context.Context, workspaceID, id int64) (SecurityWatch, error) {
	if s == nil {
		return SecurityWatch{}, errors.New("store is not available")
	}
	tx, err := s.beginWorkspaceTx(ctx, workspaceID)
	if err != nil {
		return SecurityWatch{}, err
	}
	defer func() { _ = tx.Rollback() }()
	var w SecurityWatch
	err = scanWatch(tx.QueryRowContext(ctx, `DELETE FROM security_watches WHERE id = $1 AND workspace_id = $2 RETURNING `+watchColumns, id, workspaceID), &w)
	if errors.Is(err, sql.ErrNoRows) {
		return SecurityWatch{}, ErrWatchNotFound
	}
	if err != nil {
		return SecurityWatch{}, err
	}
	return w, tx.Commit()
}

// ClaimDueSecurityWatches picks up to limit enabled watches whose check is
// due and moves each one interval ahead, so another instance won't take it.
// It works across workspaces and runs as the login role.
func (s *Store) ClaimDueSecurityWatches(ctx context.Context, limit int) ([]SecurityWatch, error) {
	if s == nil {
		return nil, nil
	}
	rows, err := s.db.QueryContext(ctx, `
		UPDATE security_watches w
		SET next_run_at = NOW() + make_interval(hours => w.interval_hours)
		WHERE w.id IN (
			SELECT id FROM security_watches
			WHERE enabled AND next_run_at <= NOW()
			ORDER BY next_run_at
			LIMIT $1
			FOR UPDATE SKIP LOCKED
		)
		RETURNING `+watchColumns, limit)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []SecurityWatch
	for rows.Next() {
		var w SecurityWatch
		if err := scanWatch(rows, &w); err != nil {
			return nil, err
		}
		out = append(out, w)
	}
	return out, rows.Err()
}

// RecordWatchResult notes a watch's latest scan, or the error that stopped it.
func (s *Store) RecordWatchResult(ctx context.Context, w SecurityWatch, scan *SecurityScan, scanErr string) error {
	if s == nil {
		return errors.New("store is not available")
	}
	tx, err := s.beginWorkspaceTx(ctx, w.WorkspaceID)
	if err != nil {
		return err
	}
	defer func() { _ = tx.Rollback() }()
	if scan != nil {
		_, err = tx.ExecContext(ctx, `
			UPDATE security_watches SET last_scan_id = $2, last_grade = $3, last_score = $4, last_checked_at = $5, last_error = ''
			WHERE id = $1`, w.ID, scan.ID, scan.Grade, scan.Score, scan.CreatedAt)
	} else {
		_, err = tx.ExecContext(ctx, `UPDATE security_watches SET last_checked_at = NOW(), last_error = $2 WHERE id = $1`, w.ID, scanErr)
	}
	if err != nil {
		return err
	}
	return tx.Commit()
}
