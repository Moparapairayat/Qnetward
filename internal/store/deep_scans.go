package store

import (
	"context"
	"database/sql"
	"errors"
	"time"
)

var (
	ErrDeepRequestNotFound = errors.New("deep scan request not found")
	ErrDeepRequestState    = errors.New("this request can't change from its current state")
)

// DeepScanRequest is a workspace's signed request for a Tier 2 scan.
type DeepScanRequest struct {
	ID               int64      `json:"id"`
	WorkspaceID      int64      `json:"workspace_id"`
	WorkspaceName    string     `json:"workspace_name,omitempty"`
	UserID           int64      `json:"-"`
	Domain           string     `json:"domain"`
	Hosts            []string   `json:"hosts"`
	Checks           []string   `json:"checks"`
	WindowStart      time.Time  `json:"window_start"`
	WindowEnd        time.Time  `json:"window_end"`
	ConsentVersion   string     `json:"consent_version"`
	ConsentText      string     `json:"consent_text"`
	ConsentHash      string     `json:"consent_hash"`
	ConsentName      string     `json:"consent_name"`
	ConsentIP        string     `json:"consent_ip,omitempty"`
	ConsentUserAgent string     `json:"-"`
	Status           string     `json:"status"`
	ReviewerEmail    string     `json:"reviewer_email,omitempty"`
	ReviewedAt       *time.Time `json:"reviewed_at,omitempty"`
	ReviewNote       string     `json:"review_note,omitempty"`
	ScanID           *int64     `json:"scan_id,omitempty"`
	CreatedAt        time.Time  `json:"created_at"`
}

const deepColumns = `r.id, r.workspace_id, r.domain, r.hosts, r.checks, r.window_start, r.window_end, r.consent_version, r.consent_text,
	r.consent_hash, r.consent_name, r.consent_ip, r.status, r.reviewer_email, r.reviewed_at, r.review_note, r.scan_id, r.created_at, COALESCE(r.user_id, 0)`

func scanDeep(row interface{ Scan(...any) error }, d *DeepScanRequest, extra ...any) error {
	var hosts, checks string
	var reviewed sql.NullTime
	var scan sql.NullInt64
	dest := []any{&d.ID, &d.WorkspaceID, &d.Domain, &hosts, &checks, &d.WindowStart, &d.WindowEnd, &d.ConsentVersion, &d.ConsentText,
		&d.ConsentHash, &d.ConsentName, &d.ConsentIP, &d.Status, &d.ReviewerEmail, &reviewed, &d.ReviewNote, &scan, &d.CreatedAt, &d.UserID}
	if err := row.Scan(append(dest, extra...)...); err != nil {
		return err
	}
	d.Hosts, d.Checks = parseScopeArray(hosts), parseScopeArray(checks)
	d.ReviewedAt = timePtr(reviewed)
	if scan.Valid {
		v := scan.Int64
		d.ScanID = &v
	}
	return nil
}

// CreateDeepScanRequest stores a signed request, pending review.
func (s *Store) CreateDeepScanRequest(ctx context.Context, d DeepScanRequest) (DeepScanRequest, error) {
	if s == nil {
		return DeepScanRequest{}, errors.New("store is not available")
	}
	tx, err := s.beginWorkspaceTx(ctx, d.WorkspaceID)
	if err != nil {
		return DeepScanRequest{}, err
	}
	defer func() { _ = tx.Rollback() }()
	var saved DeepScanRequest
	err = scanDeep(tx.QueryRowContext(ctx, `
		INSERT INTO deep_scan_requests AS r (workspace_id, user_id, domain, hosts, checks, window_start, window_end,
			consent_version, consent_text, consent_hash, consent_name, consent_ip, consent_user_agent)
		VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
		RETURNING `+deepColumns,
		d.WorkspaceID, nullableID(d.UserID), d.Domain, d.Hosts, d.Checks, d.WindowStart.UTC(), d.WindowEnd.UTC(),
		d.ConsentVersion, d.ConsentText, d.ConsentHash, d.ConsentName, clipText(d.ConsentIP, 64), clipText(d.ConsentUserAgent, 300)), &saved)
	if err != nil {
		return DeepScanRequest{}, err
	}
	return saved, tx.Commit()
}

// ListDeepScanRequests returns the workspace's requests, newest first.
func (s *Store) ListDeepScanRequests(ctx context.Context, workspaceID int64) ([]DeepScanRequest, error) {
	if s == nil {
		return nil, errors.New("store is not available")
	}
	tx, err := s.beginWorkspaceTx(ctx, workspaceID)
	if err != nil {
		return nil, err
	}
	defer func() { _ = tx.Rollback() }()
	rows, err := tx.QueryContext(ctx, `SELECT `+deepColumns+` FROM deep_scan_requests r WHERE r.workspace_id = $1 ORDER BY r.created_at DESC LIMIT 100`, workspaceID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []DeepScanRequest{}
	for rows.Next() {
		var d DeepScanRequest
		if err := scanDeep(rows, &d); err != nil {
			return nil, err
		}
		out = append(out, d)
	}
	return out, rows.Err()
}

// CountDeepScanRequestsSince counts the workspace's requests since t, for
// the plan's monthly allowance. Rejected and cancelled ones don't count.
func (s *Store) CountDeepScanRequestsSince(ctx context.Context, workspaceID int64, since time.Time) (int, error) {
	if s == nil {
		return 0, errors.New("store is not available")
	}
	tx, err := s.beginWorkspaceTx(ctx, workspaceID)
	if err != nil {
		return 0, err
	}
	defer func() { _ = tx.Rollback() }()
	var n int
	err = tx.QueryRowContext(ctx, `SELECT COUNT(*) FROM deep_scan_requests WHERE workspace_id = $1 AND created_at >= $2
		AND status NOT IN ('rejected', 'cancelled')`, workspaceID, since).Scan(&n)
	return n, err
}

// CancelDeepScanRequest withdraws a request that hasn't started.
func (s *Store) CancelDeepScanRequest(ctx context.Context, workspaceID, id int64) (DeepScanRequest, error) {
	if s == nil {
		return DeepScanRequest{}, errors.New("store is not available")
	}
	tx, err := s.beginWorkspaceTx(ctx, workspaceID)
	if err != nil {
		return DeepScanRequest{}, err
	}
	defer func() { _ = tx.Rollback() }()
	var d DeepScanRequest
	err = scanDeep(tx.QueryRowContext(ctx, `UPDATE deep_scan_requests r SET status = 'cancelled'
		WHERE r.id = $1 AND r.workspace_id = $2 AND r.status IN ('pending', 'approved') RETURNING `+deepColumns, id, workspaceID), &d)
	if errors.Is(err, sql.ErrNoRows) {
		var exists bool
		_ = tx.QueryRowContext(ctx, `SELECT EXISTS (SELECT 1 FROM deep_scan_requests WHERE id = $1 AND workspace_id = $2)`, id, workspaceID).Scan(&exists)
		if exists {
			return DeepScanRequest{}, ErrDeepRequestState
		}
		return DeepScanRequest{}, ErrDeepRequestNotFound
	}
	if err != nil {
		return DeepScanRequest{}, err
	}
	return d, tx.Commit()
}

// AdminListDeepScanRequests returns requests across workspaces for review,
// pending first. It runs as the login role; only platform admins call it.
func (s *Store) AdminListDeepScanRequests(ctx context.Context, status string) ([]DeepScanRequest, error) {
	if s == nil {
		return nil, errors.New("store is not available")
	}
	rows, err := s.db.QueryContext(ctx, `SELECT `+deepColumns+`, COALESCE(w.name, '') FROM deep_scan_requests r
		LEFT JOIN workspaces w ON w.id = r.workspace_id
		WHERE ($1 = '' OR r.status = $1)
		ORDER BY r.status = 'pending' DESC, r.created_at DESC LIMIT 200`, status)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []DeepScanRequest{}
	for rows.Next() {
		var d DeepScanRequest
		if err := scanDeep(rows, &d, &d.WorkspaceName); err != nil {
			return nil, err
		}
		out = append(out, d)
	}
	return out, rows.Err()
}

// ReviewDeepScanRequest approves or rejects a pending request. It runs as
// the login role; only platform admins call it.
func (s *Store) ReviewDeepScanRequest(ctx context.Context, id int64, approve bool, reviewerID int64, reviewerEmail, note string) (DeepScanRequest, error) {
	if s == nil {
		return DeepScanRequest{}, errors.New("store is not available")
	}
	status := "rejected"
	if approve {
		status = "approved"
	}
	var d DeepScanRequest
	err := scanDeep(s.db.QueryRowContext(ctx, `UPDATE deep_scan_requests r SET status = $2, reviewer_id = $3, reviewer_email = $4, reviewed_at = NOW(), review_note = $5
		WHERE r.id = $1 AND r.status = 'pending' AND r.window_end > NOW() RETURNING `+deepColumns,
		id, status, nullableID(reviewerID), reviewerEmail, clipText(note, 500)), &d)
	if errors.Is(err, sql.ErrNoRows) {
		return DeepScanRequest{}, ErrDeepRequestState
	}
	return d, err
}

// ClaimDueDeepScans marks approved requests whose window has opened as
// running and returns them; requests whose window passed unrun expire. It
// works across workspaces and runs as the login role.
func (s *Store) ClaimDueDeepScans(ctx context.Context, limit int) ([]DeepScanRequest, error) {
	if s == nil {
		return nil, nil
	}
	if _, err := s.db.ExecContext(ctx, `UPDATE deep_scan_requests SET status = 'expired'
		WHERE status IN ('pending', 'approved') AND window_end <= NOW()`); err != nil {
		return nil, err
	}
	rows, err := s.db.QueryContext(ctx, `
		UPDATE deep_scan_requests r SET status = 'running'
		WHERE r.id IN (
			SELECT id FROM deep_scan_requests WHERE status = 'approved' AND window_start <= NOW() AND window_end > NOW()
			ORDER BY window_start LIMIT $1 FOR UPDATE SKIP LOCKED
		)
		RETURNING `+deepColumns, limit)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []DeepScanRequest
	for rows.Next() {
		var d DeepScanRequest
		if err := scanDeep(rows, &d); err != nil {
			return nil, err
		}
		out = append(out, d)
	}
	return out, rows.Err()
}

// FinishDeepScan records how a running request ended. It runs as the login role.
func (s *Store) FinishDeepScan(ctx context.Context, id int64, scanID *int64, ok bool) error {
	if s == nil {
		return errors.New("store is not available")
	}
	status := "failed"
	if ok {
		status = "completed"
	}
	_, err := s.db.ExecContext(ctx, `UPDATE deep_scan_requests SET status = $2, scan_id = $3 WHERE id = $1 AND status = 'running'`, id, status, scanID)
	return err
}
