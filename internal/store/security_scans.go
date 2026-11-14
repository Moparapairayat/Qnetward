package store

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"time"
)

var ErrSecurityScanNotFound = errors.New("scan not found")

// SecurityScanRetention is how long scans are kept.
const SecurityScanRetention = 180 * 24 * time.Hour

// SecurityScan is one passive check of a domain. Report is the engine's JSON,
// filled only when a single scan is fetched.
type SecurityScan struct {
	ID          int64  `json:"id"`
	WorkspaceID int64  `json:"-"`
	UserID      int64  `json:"-"`
	Kind        string `json:"kind"`
	Domain      string `json:"domain"`
	Grade       string `json:"grade"`
	Score       int    `json:"score"`
	High        int    `json:"high"`
	Medium      int    `json:"medium"`
	Low         int    `json:"low"`
	// Status is running while an attack surface scan works, then done or
	// failed (with Error). Passive scans are saved done.
	Status    string          `json:"status"`
	Error     string          `json:"error,omitempty"`
	CreatedAt time.Time       `json:"created_at"`
	Report    json.RawMessage `json:"report,omitempty"`
}

const securityScanColumns = `id, workspace_id, COALESCE(user_id, 0), kind, domain, grade, score, high, medium, low, status, error, created_at`

func scanSecurityScan(row interface{ Scan(...any) error }, s *SecurityScan, withReport bool) error {
	dest := []any{&s.ID, &s.WorkspaceID, &s.UserID, &s.Kind, &s.Domain, &s.Grade, &s.Score, &s.High, &s.Medium, &s.Low, &s.Status, &s.Error, &s.CreatedAt}
	var report []byte
	if withReport {
		dest = append(dest, &report)
	}
	if err := row.Scan(dest...); err != nil {
		return err
	}
	if withReport {
		s.Report = json.RawMessage(report)
	}
	return nil
}

// SaveSecurityScan stores a finished scan.
func (s *Store) SaveSecurityScan(ctx context.Context, scan SecurityScan) (SecurityScan, error) {
	if s == nil {
		return SecurityScan{}, errors.New("store is not available")
	}
	if !json.Valid(scan.Report) {
		return SecurityScan{}, errors.New("scan report must be JSON")
	}
	tx, err := s.beginWorkspaceTx(ctx, scan.WorkspaceID)
	if err != nil {
		return SecurityScan{}, err
	}
	defer func() { _ = tx.Rollback() }()
	if scan.Kind == "" {
		scan.Kind = "passive"
	}
	var saved SecurityScan
	err = scanSecurityScan(tx.QueryRowContext(ctx, `
		INSERT INTO security_scans (workspace_id, user_id, kind, domain, grade, score, high, medium, low, report)
		VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
		RETURNING `+securityScanColumns+`, report`,
		scan.WorkspaceID, nullableID(scan.UserID), scan.Kind, scan.Domain, scan.Grade, scan.Score, scan.High, scan.Medium, scan.Low, []byte(scan.Report)), &saved, true)
	if err != nil {
		return SecurityScan{}, err
	}
	return saved, tx.Commit()
}

// ListSecurityScans returns the workspace's newest scans of a kind (all kinds
// when empty), without reports. A domain narrows them to that domain.
func (s *Store) ListSecurityScans(ctx context.Context, workspaceID int64, kind, domain string, limit int) ([]SecurityScan, error) {
	if s == nil {
		return nil, errors.New("store is not available")
	}
	if limit <= 0 || limit > 200 {
		limit = 50
	}
	tx, err := s.beginWorkspaceTx(ctx, workspaceID)
	if err != nil {
		return nil, err
	}
	defer func() { _ = tx.Rollback() }()
	rows, err := tx.QueryContext(ctx, `SELECT `+securityScanColumns+` FROM security_scans
		WHERE workspace_id = $1 AND ($2 = '' OR domain = $2) AND ($4 = '' OR kind = $4)
		ORDER BY created_at DESC, id DESC LIMIT $3`, workspaceID, domain, limit, kind)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []SecurityScan{}
	for rows.Next() {
		var sc SecurityScan
		if err := scanSecurityScan(rows, &sc, false); err != nil {
			return nil, err
		}
		out = append(out, sc)
	}
	return out, rows.Err()
}

// GetSecurityScan returns one scan with its report.
func (s *Store) GetSecurityScan(ctx context.Context, workspaceID, id int64) (SecurityScan, error) {
	if s == nil {
		return SecurityScan{}, errors.New("store is not available")
	}
	tx, err := s.beginWorkspaceTx(ctx, workspaceID)
	if err != nil {
		return SecurityScan{}, err
	}
	defer func() { _ = tx.Rollback() }()
	var sc SecurityScan
	err = scanSecurityScan(tx.QueryRowContext(ctx, `SELECT `+securityScanColumns+`, report FROM security_scans
		WHERE id = $1 AND workspace_id = $2`, id, workspaceID), &sc, true)
	if errors.Is(err, sql.ErrNoRows) {
		return SecurityScan{}, ErrSecurityScanNotFound
	}
	return sc, err
}

// DeleteSecurityScan removes one scan.
func (s *Store) DeleteSecurityScan(ctx context.Context, workspaceID, id int64) error {
	if s == nil {
		return errors.New("store is not available")
	}
	tx, err := s.beginWorkspaceTx(ctx, workspaceID)
	if err != nil {
		return err
	}
	defer func() { _ = tx.Rollback() }()
	res, err := tx.ExecContext(ctx, `DELETE FROM security_scans WHERE id = $1 AND workspace_id = $2`, id, workspaceID)
	if err != nil {
		return err
	}
	if n, _ := res.RowsAffected(); n == 0 {
		return ErrSecurityScanNotFound
	}
	return tx.Commit()
}

// PruneSecurityScans deletes scans older than the cutoff, across workspaces.
func (s *Store) PruneSecurityScans(ctx context.Context, before time.Time) error {
	if s == nil {
		return nil
	}
	_, err := s.db.ExecContext(ctx, `DELETE FROM security_scans WHERE created_at < $1`, before.UTC())
	return err
}

// StartSecurityScan records a scan that is about to run. It refuses when the
// workspace already has a scan of that kind running.
func (s *Store) StartSecurityScan(ctx context.Context, scan SecurityScan) (SecurityScan, error) {
	if s == nil {
		return SecurityScan{}, errors.New("store is not available")
	}
	tx, err := s.beginWorkspaceTx(ctx, scan.WorkspaceID)
	if err != nil {
		return SecurityScan{}, err
	}
	defer func() { _ = tx.Rollback() }()
	// Serialise starts per workspace, so two requests can't both pass the check.
	if _, err := tx.ExecContext(ctx, `SELECT pg_advisory_xact_lock(hashtext('security_scan'), $1::int)`, scan.WorkspaceID); err != nil {
		return SecurityScan{}, err
	}
	var running bool
	if err := tx.QueryRowContext(ctx, `SELECT EXISTS (SELECT 1 FROM security_scans WHERE workspace_id = $1 AND kind = $2 AND status = 'running')`,
		scan.WorkspaceID, scan.Kind).Scan(&running); err != nil {
		return SecurityScan{}, err
	}
	if running {
		return SecurityScan{}, ErrScanRunning
	}
	var saved SecurityScan
	err = scanSecurityScan(tx.QueryRowContext(ctx, `
		INSERT INTO security_scans (workspace_id, user_id, kind, domain, grade, score, status, report)
		VALUES ($1, $2, $3, $4, '', 0, 'running', '{}'::jsonb)
		RETURNING `+securityScanColumns, scan.WorkspaceID, nullableID(scan.UserID), scan.Kind, scan.Domain), &saved, false)
	if err != nil {
		return SecurityScan{}, err
	}
	return saved, tx.Commit()
}

// ErrScanRunning means the workspace already has a scan of that kind running.
var ErrScanRunning = errors.New("a scan is already running in this workspace; wait for it to finish")

// FinishSecurityScan stores a running scan's result, or why it failed.
func (s *Store) FinishSecurityScan(ctx context.Context, scan SecurityScan, failure string) error {
	if s == nil {
		return errors.New("store is not available")
	}
	tx, err := s.beginWorkspaceTx(ctx, scan.WorkspaceID)
	if err != nil {
		return err
	}
	defer func() { _ = tx.Rollback() }()
	if failure != "" {
		_, err = tx.ExecContext(ctx, `UPDATE security_scans SET status = 'failed', error = $2 WHERE id = $1`, scan.ID, clipText(failure, 500))
	} else {
		if !json.Valid(scan.Report) {
			return errors.New("scan report must be JSON")
		}
		_, err = tx.ExecContext(ctx, `
			UPDATE security_scans SET status = 'done', grade = $2, score = $3, high = $4, medium = $5, low = $6, report = $7
			WHERE id = $1`, scan.ID, scan.Grade, scan.Score, scan.High, scan.Medium, scan.Low, []byte(scan.Report))
	}
	if err != nil {
		return err
	}
	return tx.Commit()
}

// FailStaleScans marks scans left running by a restart as failed. It works
// across workspaces and runs as the login role.
func (s *Store) FailStaleScans(ctx context.Context, olderThan time.Duration) error {
	if s == nil {
		return nil
	}
	_, err := s.db.ExecContext(ctx, `UPDATE security_scans SET status = 'failed', error = 'The scan was interrupted; run it again.'
		WHERE status = 'running' AND created_at < NOW() - make_interval(secs => $1)`, olderThan.Seconds())
	return err
}
