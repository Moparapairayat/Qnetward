package store

import (
	"context"
	"database/sql"
	"errors"
	"slices"
	"strings"
	"time"
)

var (
	ErrChannelNotFound = errors.New("channel not found")
	ErrChannelLimit    = errors.New("this workspace already has the most channels it can have")
)

// Channel kinds.
const (
	ChannelSlack    = "slack"
	ChannelDiscord  = "discord"
	ChannelTelegram = "telegram"
	ChannelWebhook  = "webhook"
)

// Channel events: the groups of alerts a channel can subscribe to.
const (
	ChannelEventMonitors     = "monitors"
	ChannelEventCertificates = "certificates"
	ChannelEventAlertRules   = "alert_rules"
	ChannelEventAgents       = "agents"
)

var (
	ChannelKinds  = []string{ChannelSlack, ChannelDiscord, ChannelTelegram, ChannelWebhook}
	ChannelEvents = []string{ChannelEventMonitors, ChannelEventCertificates, ChannelEventAlertRules, ChannelEventAgents}
)

// MaxChannels caps the channels in one workspace.
const MaxChannels = 20

// Channel is a destination for a workspace's alerts. ConfigEnc holds the
// sealed destination and never leaves the server.
type Channel struct {
	ID          int64      `json:"id"`
	WorkspaceID int64      `json:"-"`
	CreatedBy   int64      `json:"-"`
	Kind        string     `json:"kind"`
	Name        string     `json:"name"`
	Target      string     `json:"target"`
	Events      []string   `json:"events"`
	Enabled     bool       `json:"enabled"`
	LastSentAt  *time.Time `json:"last_sent_at,omitempty"`
	LastError   string     `json:"last_error,omitempty"`
	CreatedAt   time.Time  `json:"created_at"`
	ConfigEnc   string     `json:"-"`
}

const channelColumns = `id, workspace_id, COALESCE(created_by, 0), kind, name, target, config_enc, events, enabled, last_sent_at, last_error, created_at`

func scanChannel(scanner interface{ Scan(...any) error }, c *Channel) error {
	var events string
	var sent sql.NullTime
	if err := scanner.Scan(&c.ID, &c.WorkspaceID, &c.CreatedBy, &c.Kind, &c.Name, &c.Target, &c.ConfigEnc, &events, &c.Enabled, &sent, &c.LastError, &c.CreatedAt); err != nil {
		return err
	}
	c.Events = parseScopeArray(events)
	if sent.Valid {
		t := sent.Time
		c.LastSentAt = &t
	}
	return nil
}

func validateChannel(c *Channel) error {
	if c.WorkspaceID <= 0 {
		return errors.New("workspace is required")
	}
	if !slices.Contains(ChannelKinds, c.Kind) {
		return errors.New("kind must be slack, discord, telegram, or webhook")
	}
	c.Name = strings.TrimSpace(c.Name)
	if c.Name == "" {
		return errors.New("name is required")
	}
	if len(c.Name) > 80 {
		return errors.New("name must be 80 characters or fewer")
	}
	events := make([]string, 0, len(c.Events))
	for _, e := range c.Events {
		if !slices.Contains(ChannelEvents, e) {
			return errors.New("events must be monitors, certificates, or alert_rules")
		}
		if !slices.Contains(events, e) {
			events = append(events, e)
		}
	}
	if len(events) == 0 {
		return errors.New("pick at least one kind of alert")
	}
	c.Events = events
	return nil
}

// ListChannels returns the workspace's channels, oldest first.
func (s *Store) ListChannels(ctx context.Context, workspaceID int64) ([]Channel, error) {
	return s.queryChannels(ctx, workspaceID, `SELECT `+channelColumns+` FROM notification_channels WHERE workspace_id = $1 ORDER BY created_at, id`, workspaceID)
}

// ChannelsFor returns the enabled channels that subscribe to event.
func (s *Store) ChannelsFor(ctx context.Context, workspaceID int64, event string) ([]Channel, error) {
	return s.queryChannels(ctx, workspaceID, `SELECT `+channelColumns+` FROM notification_channels
		WHERE workspace_id = $1 AND enabled AND $2 = ANY(events) ORDER BY created_at, id`, workspaceID, event)
}

func (s *Store) queryChannels(ctx context.Context, workspaceID int64, query string, args ...any) ([]Channel, error) {
	if s == nil {
		return nil, errors.New("store is not available")
	}
	tx, err := s.beginWorkspaceTx(ctx, workspaceID)
	if err != nil {
		return nil, err
	}
	defer func() { _ = tx.Rollback() }()
	rows, err := tx.QueryContext(ctx, query, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []Channel{}
	for rows.Next() {
		var c Channel
		if err := scanChannel(rows, &c); err != nil {
			return nil, err
		}
		out = append(out, c)
	}
	return out, rows.Err()
}

// GetChannel returns one channel, with its sealed config.
func (s *Store) GetChannel(ctx context.Context, workspaceID, id int64) (Channel, error) {
	if s == nil {
		return Channel{}, errors.New("store is not available")
	}
	tx, err := s.beginWorkspaceTx(ctx, workspaceID)
	if err != nil {
		return Channel{}, err
	}
	defer func() { _ = tx.Rollback() }()
	var c Channel
	err = scanChannel(tx.QueryRowContext(ctx, `SELECT `+channelColumns+` FROM notification_channels WHERE id = $1 AND workspace_id = $2`, id, workspaceID), &c)
	if errors.Is(err, sql.ErrNoRows) {
		return Channel{}, ErrChannelNotFound
	}
	return c, err
}

// SaveChannel creates a channel, or updates one in the same workspace. On an
// update an empty ConfigEnc and Target keep the stored destination, and the
// kind can't change.
func (s *Store) SaveChannel(ctx context.Context, c Channel) (Channel, error) {
	if s == nil {
		return Channel{}, errors.New("store is not available")
	}
	if err := validateChannel(&c); err != nil {
		return Channel{}, err
	}
	tx, err := s.beginWorkspaceTx(ctx, c.WorkspaceID)
	if err != nil {
		return Channel{}, err
	}
	defer func() { _ = tx.Rollback() }()

	var saved Channel
	if c.ID == 0 {
		if c.ConfigEnc == "" {
			return Channel{}, errors.New("destination is required")
		}
		var count int
		if err := tx.QueryRowContext(ctx, `SELECT COUNT(*) FROM notification_channels WHERE workspace_id = $1`, c.WorkspaceID).Scan(&count); err != nil {
			return Channel{}, err
		}
		if count >= MaxChannels {
			return Channel{}, ErrChannelLimit
		}
		err = scanChannel(tx.QueryRowContext(ctx, `
			INSERT INTO notification_channels (workspace_id, created_by, kind, name, target, config_enc, events, enabled)
			VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
			RETURNING `+channelColumns,
			c.WorkspaceID, nullableID(c.CreatedBy), c.Kind, c.Name, c.Target, c.ConfigEnc, c.Events, c.Enabled,
		), &saved)
	} else {
		err = scanChannel(tx.QueryRowContext(ctx, `
			UPDATE notification_channels SET
				name = $3,
				events = $4,
				enabled = $5,
				target = CASE WHEN $6 = '' THEN target ELSE $6 END,
				config_enc = CASE WHEN $7 = '' THEN config_enc ELSE $7 END,
				last_error = CASE WHEN $7 = '' THEN last_error ELSE '' END
			WHERE id = $1 AND workspace_id = $2 AND kind = $8
			RETURNING `+channelColumns,
			c.ID, c.WorkspaceID, c.Name, c.Events, c.Enabled, c.Target, c.ConfigEnc, c.Kind,
		), &saved)
		if errors.Is(err, sql.ErrNoRows) {
			return Channel{}, ErrChannelNotFound
		}
	}
	if err != nil {
		return Channel{}, err
	}
	return saved, tx.Commit()
}

// DeleteChannel removes a channel and returns what it was.
func (s *Store) DeleteChannel(ctx context.Context, workspaceID, id int64) (Channel, error) {
	if s == nil {
		return Channel{}, errors.New("store is not available")
	}
	tx, err := s.beginWorkspaceTx(ctx, workspaceID)
	if err != nil {
		return Channel{}, err
	}
	defer func() { _ = tx.Rollback() }()
	var c Channel
	err = scanChannel(tx.QueryRowContext(ctx, `DELETE FROM notification_channels WHERE id = $1 AND workspace_id = $2 RETURNING `+channelColumns, id, workspaceID), &c)
	if errors.Is(err, sql.ErrNoRows) {
		return Channel{}, ErrChannelNotFound
	}
	if err != nil {
		return Channel{}, err
	}
	return c, tx.Commit()
}

// RecordChannelDelivery notes the outcome of a send. An empty errText means
// it went through.
func (s *Store) RecordChannelDelivery(ctx context.Context, workspaceID, id int64, errText string) error {
	if s == nil {
		return nil
	}
	tx, err := s.beginWorkspaceTx(ctx, workspaceID)
	if err != nil {
		return err
	}
	defer func() { _ = tx.Rollback() }()
	if len(errText) > 300 {
		errText = errText[:300]
	}
	if _, err := tx.ExecContext(ctx, `
		UPDATE notification_channels SET
			last_sent_at = CASE WHEN $3 = '' THEN NOW() ELSE last_sent_at END,
			last_error = $3
		WHERE id = $1 AND workspace_id = $2
	`, id, workspaceID, errText); err != nil {
		return err
	}
	return tx.Commit()
}
