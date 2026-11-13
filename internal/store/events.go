package store

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"
)

// EventRetention is how long live events are kept for consoles to resume from.
const EventRetention = 24 * time.Hour

// eventsChannel is the Postgres NOTIFY channel new events are announced on.
const eventsChannel = "qnetward_events"

// WorkspaceEvent is one entry in a workspace's live event log.
type WorkspaceEvent struct {
	ID          int64           `json:"id"`
	WorkspaceID int64           `json:"-"`
	Type        string          `json:"type"`
	Payload     json.RawMessage `json:"payload"`
	At          time.Time       `json:"at"`
}

// AppendEvent adds an event to the workspace's log and returns its id. The
// insert's trigger announces it to every API instance. It runs as the login
// role because events are raised by background work as well as requests.
func (s *Store) AppendEvent(ctx context.Context, workspaceID int64, typ string, payload []byte) (int64, error) {
	if s == nil {
		return 0, errors.New("store is not available")
	}
	if len(payload) == 0 {
		payload = []byte("{}")
	}
	var id int64
	err := s.db.QueryRowContext(ctx, `INSERT INTO workspace_events (workspace_id, type, payload) VALUES ($1, $2, $3) RETURNING id`,
		workspaceID, typ, string(payload)).Scan(&id)
	return id, err
}

// EventsSince returns up to limit events after id, oldest first, and whether
// the log still reaches back to id. When it doesn't (the events were pruned),
// the caller can't fill the gap and should refetch everything instead.
func (s *Store) EventsSince(ctx context.Context, workspaceID, after int64, limit int) ([]WorkspaceEvent, bool, error) {
	if s == nil {
		return nil, false, errors.New("store is not available")
	}
	tx, err := s.beginWorkspaceTx(ctx, workspaceID)
	if err != nil {
		return nil, false, err
	}
	defer func() { _ = tx.Rollback() }()
	// Events are pruned oldest first, so if the event the client last saw is
	// still here, everything after it is too. A client already at the newest
	// event (or a workspace with none yet) has nothing to miss.
	var covered bool
	if err := tx.QueryRowContext(ctx, `SELECT EXISTS (SELECT 1 FROM workspace_events WHERE workspace_id = $1 AND id = $2)
		OR $2 >= COALESCE((SELECT MAX(id) FROM workspace_events WHERE workspace_id = $1), 0)`, workspaceID, after).Scan(&covered); err != nil {
		return nil, false, err
	}
	rows, err := tx.QueryContext(ctx, `SELECT id, type, payload, created_at FROM workspace_events
		WHERE workspace_id = $1 AND id > $2 ORDER BY id LIMIT $3`, workspaceID, after, limit)
	if err != nil {
		return nil, false, err
	}
	defer rows.Close()
	out := []WorkspaceEvent{}
	for rows.Next() {
		e := WorkspaceEvent{WorkspaceID: workspaceID}
		var payload []byte
		if err := rows.Scan(&e.ID, &e.Type, &payload, &e.At); err != nil {
			return nil, false, err
		}
		e.Payload = json.RawMessage(payload)
		out = append(out, e)
	}
	return out, covered, rows.Err()
}

// LatestEventID is the newest event id in the workspace, or 0.
func (s *Store) LatestEventID(ctx context.Context, workspaceID int64) (int64, error) {
	if s == nil {
		return 0, errors.New("store is not available")
	}
	tx, err := s.beginWorkspaceTx(ctx, workspaceID)
	if err != nil {
		return 0, err
	}
	defer func() { _ = tx.Rollback() }()
	var id sql.NullInt64
	err = tx.QueryRowContext(ctx, `SELECT MAX(id) FROM workspace_events WHERE workspace_id = $1`, workspaceID).Scan(&id)
	return id.Int64, err
}

// GetEvent reads one event back, for announcements too large to carry it.
func (s *Store) GetEvent(ctx context.Context, id int64) (WorkspaceEvent, error) {
	if s == nil {
		return WorkspaceEvent{}, errors.New("store is not available")
	}
	var e WorkspaceEvent
	var payload []byte
	err := s.db.QueryRowContext(ctx, `SELECT id, workspace_id, type, payload, created_at FROM workspace_events WHERE id = $1`, id).
		Scan(&e.ID, &e.WorkspaceID, &e.Type, &payload, &e.At)
	e.Payload = json.RawMessage(payload)
	return e, err
}

// PruneEvents removes events older than before.
func (s *Store) PruneEvents(ctx context.Context, before time.Time) error {
	if s == nil {
		return nil
	}
	_, err := s.db.ExecContext(ctx, `DELETE FROM workspace_events WHERE created_at < $1`, before.UTC())
	return err
}

// listenDSN is the connection string for LISTEN. Connection poolers in
// transaction mode (such as Neon's "-pooler" hosts) don't keep LISTEN
// sessions, so a Neon pooled host is swapped for its direct one.
func listenDSN(dsn string) string {
	return strings.Replace(dsn, "-pooler.", ".", 1)
}

// ListenEvents holds one connection that hears every new event and hands each
// to deliver. It returns when ctx ends or the connection fails; ready is
// called once the connection is listening.
func (s *Store) ListenEvents(ctx context.Context, ready func(), deliver func(WorkspaceEvent)) error {
	if s == nil {
		return errors.New("store is not available")
	}
	conn, err := pgx.Connect(ctx, listenDSN(s.cfg.DSN))
	if err != nil {
		return err
	}
	defer func() {
		closeCtx, cancel := context.WithTimeout(context.Background(), 3*time.Second)
		defer cancel()
		_ = conn.Close(closeCtx)
	}()
	if _, err := conn.Exec(ctx, "LISTEN "+eventsChannel); err != nil {
		return err
	}
	ready()
	for {
		n, err := conn.WaitForNotification(ctx)
		if err != nil {
			return err
		}
		var msg struct {
			ID  int64           `json:"id"`
			W   int64           `json:"w"`
			T   string          `json:"t"`
			P   json.RawMessage `json:"p"`
			At  time.Time       `json:"at"`
			Big bool            `json:"big"`
		}
		if json.Unmarshal([]byte(n.Payload), &msg) != nil || msg.ID == 0 {
			continue
		}
		e := WorkspaceEvent{ID: msg.ID, WorkspaceID: msg.W, Type: msg.T, Payload: msg.P, At: msg.At}
		if msg.Big {
			readCtx, cancel := context.WithTimeout(ctx, 5*time.Second)
			full, err := s.GetEvent(readCtx, msg.ID)
			cancel()
			if err != nil {
				continue
			}
			e = full
		}
		deliver(e)
	}
}
