package store

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"strings"
	"time"
)

// AuditRetention is how long audit events are kept.
const AuditRetention = 365 * 24 * time.Hour

const maxAuditPage = 100

// AuditEvent is one entry in the audit log. WorkspaceID is 0 for account
// events such as sign-ins.
type AuditEvent struct {
	ID          int64          `json:"id"`
	OccurredAt  time.Time      `json:"occurred_at"`
	WorkspaceID int64          `json:"-"`
	ActorUserID int64          `json:"actor_user_id,omitempty"`
	ActorEmail  string         `json:"actor_email,omitempty"`
	Action      string         `json:"action"`
	TargetType  string         `json:"target_type,omitempty"`
	TargetID    string         `json:"target_id,omitempty"`
	TargetLabel string         `json:"target_label,omitempty"`
	IPAddress   string         `json:"ip_address,omitempty"`
	UserAgent   string         `json:"user_agent,omitempty"`
	Metadata    map[string]any `json:"metadata,omitempty"`
}

// AuditCategories group actions for filtering; each maps to an action prefix.
var AuditCategories = map[string]string{
	"member":  "member.",
	"monitor": "monitor.",
	"alert":   "alert_rule.",
	"scan":    "scan.",
	"export":  "history.",
	"apikey":  "apikey.",
}

// AuditQuery pages through events newest first. Before is an event ID cursor.
type AuditQuery struct {
	Category string
	Before   int64
	Limit    int
}

// RecordAuditEvent appends an event. It runs as the login role, so request
// handlers can record account events that belong to no workspace.
func (s *Store) RecordAuditEvent(ctx context.Context, e AuditEvent) error {
	if s == nil {
		return errors.New("store is not available")
	}
	e.Action = strings.TrimSpace(e.Action)
	if e.Action == "" {
		return errors.New("audit action is required")
	}
	metadata := []byte("{}")
	if len(e.Metadata) > 0 {
		encoded, err := json.Marshal(e.Metadata)
		if err != nil {
			return fmt.Errorf("encode audit metadata: %w", err)
		}
		metadata = encoded
	}
	_, err := s.db.ExecContext(ctx, `
		INSERT INTO audit_events (workspace_id, actor_user_id, actor_email, action, target_type, target_id, target_label, ip_address, user_agent, metadata)
		VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
	`, nullableID(e.WorkspaceID), nullableID(e.ActorUserID), truncate(e.ActorEmail, 320), e.Action,
		truncate(e.TargetType, 64), truncate(e.TargetID, 128), truncate(e.TargetLabel, 512),
		truncate(e.IPAddress, 64), truncate(e.UserAgent, 512), metadata)
	return err
}

// ListWorkspaceAuditEvents returns one page of a workspace's events.
func (s *Store) ListWorkspaceAuditEvents(ctx context.Context, workspaceID int64, q AuditQuery) ([]AuditEvent, error) {
	if s == nil {
		return nil, errors.New("store is not available")
	}
	limit := clampAuditLimit(q.Limit)
	prefix := ""
	if q.Category != "" {
		p, ok := AuditCategories[q.Category]
		if !ok {
			return nil, fmt.Errorf("unknown audit category %q", q.Category)
		}
		prefix = p
	}

	tx, err := s.beginWorkspaceTx(ctx, workspaceID)
	if err != nil {
		return nil, err
	}
	defer func() { _ = tx.Rollback() }()

	rows, err := tx.QueryContext(ctx, `
		SELECT `+auditColumns+`
		FROM audit_events
		WHERE workspace_id = $1
			AND ($2 = '' OR action LIKE $2 || '%')
			AND ($3 = 0 OR id < $3)
		ORDER BY id DESC
		LIMIT $4
	`, workspaceID, prefix, q.Before, limit)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	return scanAuditEvents(rows, limit)
}

// ListAccountAuditEvents returns a user's own account events, newest first.
func (s *Store) ListAccountAuditEvents(ctx context.Context, userID int64, limit int) ([]AuditEvent, error) {
	if s == nil {
		return nil, errors.New("store is not available")
	}
	limit = clampAuditLimit(limit)
	rows, err := s.db.QueryContext(ctx, `
		SELECT `+auditColumns+`
		FROM audit_events
		WHERE workspace_id IS NULL AND actor_user_id = $1
		ORDER BY id DESC
		LIMIT $2
	`, userID, limit)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	return scanAuditEvents(rows, limit)
}

// PruneAuditEvents deletes events older than the cutoff, across workspaces.
func (s *Store) PruneAuditEvents(ctx context.Context, before time.Time) error {
	if s == nil {
		return nil
	}
	_, err := s.db.ExecContext(ctx, `DELETE FROM audit_events WHERE occurred_at < $1`, before.UTC())
	return err
}

const auditColumns = `id, occurred_at, COALESCE(workspace_id, 0), COALESCE(actor_user_id, 0), actor_email, action,
	target_type, target_id, target_label, ip_address, user_agent, metadata`

type auditRows interface {
	Next() bool
	Scan(dest ...any) error
	Err() error
}

func scanAuditEvents(rows auditRows, capacity int) ([]AuditEvent, error) {
	events := make([]AuditEvent, 0, capacity)
	for rows.Next() {
		var e AuditEvent
		var metadata []byte
		if err := rows.Scan(&e.ID, &e.OccurredAt, &e.WorkspaceID, &e.ActorUserID, &e.ActorEmail, &e.Action,
			&e.TargetType, &e.TargetID, &e.TargetLabel, &e.IPAddress, &e.UserAgent, &metadata); err != nil {
			return nil, err
		}
		if len(metadata) > 2 {
			if err := json.Unmarshal(metadata, &e.Metadata); err != nil {
				return nil, fmt.Errorf("decode audit metadata: %w", err)
			}
		}
		events = append(events, e)
	}
	return events, rows.Err()
}

func clampAuditLimit(limit int) int {
	if limit <= 0 {
		return 50
	}
	if limit > maxAuditPage {
		return maxAuditPage
	}
	return limit
}

func truncate(value string, max int) string {
	value = strings.TrimSpace(value)
	if len(value) <= max {
		return value
	}
	// Cut on a byte boundary, then drop any rune the cut split.
	return strings.ToValidUTF8(value[:max], "")
}
