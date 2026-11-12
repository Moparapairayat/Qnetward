package store

import (
	"context"
	"database/sql"
	"errors"
	"regexp"
	"strings"
	"time"
)

var ErrDispositionNotFound = errors.New("decision not found")

var cveRe = regexp.MustCompile(`^CVE-\d{4}-\d{4,}$`)

// VulnDisposition is a workspace's decision about one vulnerability on one host.
type VulnDisposition struct {
	ID          int64     `json:"id"`
	WorkspaceID int64     `json:"-"`
	UserID      int64     `json:"-"`
	Host        string    `json:"host"`
	CVE         string    `json:"cve"`
	Status      string    `json:"status"`
	Reason      string    `json:"reason,omitempty"`
	CreatedAt   time.Time `json:"created_at"`
}

const dispositionColumns = `d.id, d.workspace_id, COALESCE(d.user_id, 0), d.host, d.cve, d.status, d.reason, d.created_at`

func scanDisposition(row interface{ Scan(...any) error }, d *VulnDisposition) error {
	return row.Scan(&d.ID, &d.WorkspaceID, &d.UserID, &d.Host, &d.CVE, &d.Status, &d.Reason, &d.CreatedAt)
}

// SetVulnDisposition records, or replaces, a decision about a vulnerability.
func (s *Store) SetVulnDisposition(ctx context.Context, d VulnDisposition) (VulnDisposition, error) {
	if s == nil {
		return VulnDisposition{}, errors.New("store is not available")
	}
	d.Host = strings.ToLower(strings.TrimSpace(d.Host))
	d.CVE = strings.ToUpper(strings.TrimSpace(d.CVE))
	d.Reason = strings.TrimSpace(d.Reason)
	switch {
	case d.Host == "" || len(d.Host) > 253:
		return VulnDisposition{}, errors.New("host is required")
	case !cveRe.MatchString(d.CVE):
		return VulnDisposition{}, errors.New("CVE must look like CVE-2024-12345")
	case d.Status != "accepted" && d.Status != "false_positive":
		return VulnDisposition{}, errors.New("status must be accepted or false_positive")
	case len(d.Reason) > 500:
		return VulnDisposition{}, errors.New("reason must be 500 characters or fewer")
	}
	tx, err := s.beginWorkspaceTx(ctx, d.WorkspaceID)
	if err != nil {
		return VulnDisposition{}, err
	}
	defer func() { _ = tx.Rollback() }()
	var id int64
	err = tx.QueryRowContext(ctx, `
		INSERT INTO vuln_dispositions (workspace_id, user_id, host, cve, status, reason) VALUES ($1, $2, $3, $4, $5, $6)
		ON CONFLICT (workspace_id, host, cve) DO UPDATE SET user_id = EXCLUDED.user_id, status = EXCLUDED.status, reason = EXCLUDED.reason, created_at = NOW()
		RETURNING id`, d.WorkspaceID, nullableID(d.UserID), d.Host, d.CVE, d.Status, d.Reason).Scan(&id)
	if err != nil {
		return VulnDisposition{}, err
	}
	var saved VulnDisposition
	if err := scanDisposition(tx.QueryRowContext(ctx, `SELECT `+dispositionColumns+` FROM vuln_dispositions d WHERE d.id = $1`, id), &saved); err != nil {
		return VulnDisposition{}, err
	}
	return saved, tx.Commit()
}

// ListVulnDispositions returns the workspace's decisions.
func (s *Store) ListVulnDispositions(ctx context.Context, workspaceID int64) ([]VulnDisposition, error) {
	if s == nil {
		return nil, errors.New("store is not available")
	}
	tx, err := s.beginWorkspaceTx(ctx, workspaceID)
	if err != nil {
		return nil, err
	}
	defer func() { _ = tx.Rollback() }()
	rows, err := tx.QueryContext(ctx, `SELECT `+dispositionColumns+` FROM vuln_dispositions d
		WHERE d.workspace_id = $1 ORDER BY d.created_at DESC`, workspaceID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []VulnDisposition{}
	for rows.Next() {
		var d VulnDisposition
		if err := scanDisposition(rows, &d); err != nil {
			return nil, err
		}
		out = append(out, d)
	}
	return out, rows.Err()
}

// DeleteVulnDisposition undoes a decision.
func (s *Store) DeleteVulnDisposition(ctx context.Context, workspaceID, id int64) (VulnDisposition, error) {
	if s == nil {
		return VulnDisposition{}, errors.New("store is not available")
	}
	tx, err := s.beginWorkspaceTx(ctx, workspaceID)
	if err != nil {
		return VulnDisposition{}, err
	}
	defer func() { _ = tx.Rollback() }()
	var d VulnDisposition
	err = tx.QueryRowContext(ctx, `DELETE FROM vuln_dispositions WHERE id = $1 AND workspace_id = $2 RETURNING id, host, cve, status`, id, workspaceID).
		Scan(&d.ID, &d.Host, &d.CVE, &d.Status)
	if errors.Is(err, sql.ErrNoRows) {
		return VulnDisposition{}, ErrDispositionNotFound
	}
	if err != nil {
		return VulnDisposition{}, err
	}
	return d, tx.Commit()
}

// LatestSurfaceScans returns the newest finished attack surface scan of each
// domain, with its report.
func (s *Store) LatestSurfaceScans(ctx context.Context, workspaceID int64) ([]SecurityScan, error) {
	if s == nil {
		return nil, errors.New("store is not available")
	}
	tx, err := s.beginWorkspaceTx(ctx, workspaceID)
	if err != nil {
		return nil, err
	}
	defer func() { _ = tx.Rollback() }()
	rows, err := tx.QueryContext(ctx, `SELECT DISTINCT ON (domain) `+securityScanColumns+`, report FROM security_scans
		WHERE workspace_id = $1 AND kind = 'surface' AND status = 'done'
		ORDER BY domain, created_at DESC`, workspaceID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []SecurityScan{}
	for rows.Next() {
		var sc SecurityScan
		if err := scanSecurityScan(rows, &sc, true); err != nil {
			return nil, err
		}
		out = append(out, sc)
	}
	return out, rows.Err()
}
