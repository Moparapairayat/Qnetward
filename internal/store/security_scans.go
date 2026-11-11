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
	ID          int64           `json:"id"`
	WorkspaceID int64           `json:"-"`
	UserID      int64           `json:"-"`
	Kind        string          `json:"kind"`
	Domain      string          `json:"domain"`
	Grade       string          `json:"grade"`
	Score       int             `json:"score"`
	High        int             `json:"high"`
	Medium      int             `json:"medium"`
	Low         int             `json:"low"`
	CreatedAt   time.Time       `json:"created_at"`
	Report      json.RawMessage `json:"report,omitempty"`
}

const securityScanColumns = `id, workspace_id, COALESCE(user_id, 0), kind, domain, grade, score, high, medium, low, created_at`

func scanSecurityScan(row interface{ Scan(...any) error }, s *SecurityScan, withReport bool) error {
	dest := []any{&s.ID, &s.WorkspaceID, &s.UserID, &s.Kind, &s.Domain, &s.Grade, &s.Score, &s.High, &s.Medium, &s.Low, &s.CreatedAt}
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

// ListSecurityScans returns the workspace's newest scans, without reports.
// A domain narrows them to that domain.
func (s *Store) ListSecurityScans(ctx context.Context, workspaceID int64, domain string, limit int) ([]SecurityScan, error) {
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
		WHERE workspace_id = $1 AND ($2 = '' OR domain = $2)
		ORDER BY created_at DESC, id DESC LIMIT $3`, workspaceID, domain, limit)
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
