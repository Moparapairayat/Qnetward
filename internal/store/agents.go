package store

import (
	"context"
	"database/sql"
	"errors"
	"strings"
	"time"
)

var (
	ErrAgentNotFound    = errors.New("agent not found")
	ErrAgentLimit       = errors.New("this workspace has reached its plan's agent limit")
	ErrEnrollmentToken  = errors.New("that enrollment token is unknown, used, or expired; create a new one in the console")
	ErrAgentCredentials = errors.New("agent credentials are not valid")
)

// AgentOnlineWithin is how recently an agent must have checked in to count as online.
const AgentOnlineWithin = 90 * time.Second

// Agent is a probe agent as the console shows it.
type Agent struct {
	ID              int64      `json:"id"`
	WorkspaceID     int64      `json:"-"`
	Name            string     `json:"name"`
	Enrolled        bool       `json:"enrolled"`
	EnrollExpiresAt *time.Time `json:"enroll_expires_at,omitempty"`
	EnrolledAt      *time.Time `json:"enrolled_at,omitempty"`
	LastSeenAt      *time.Time `json:"last_seen_at,omitempty"`
	Online          bool       `json:"online"`
	Version         string     `json:"version,omitempty"`
	Hostname        string     `json:"hostname,omitempty"`
	Platform        string     `json:"platform,omitempty"`
	RemoteIP        string     `json:"remote_ip,omitempty"`
	CreatedAt       time.Time  `json:"created_at"`
}

const agentColumns = `id, workspace_id, name, secret_hash IS NOT NULL, enroll_expires_at, enrolled_at, last_seen_at, version, hostname, platform, remote_ip, created_at`

func scanAgent(scanner interface{ Scan(...any) error }, a *Agent) error {
	var expires, enrolled, seen sql.NullTime
	if err := scanner.Scan(&a.ID, &a.WorkspaceID, &a.Name, &a.Enrolled, &expires, &enrolled, &seen, &a.Version, &a.Hostname, &a.Platform, &a.RemoteIP, &a.CreatedAt); err != nil {
		return err
	}
	for _, pair := range []struct {
		src sql.NullTime
		dst **time.Time
	}{{expires, &a.EnrollExpiresAt}, {enrolled, &a.EnrolledAt}, {seen, &a.LastSeenAt}} {
		if pair.src.Valid {
			t := pair.src.Time
			*pair.dst = &t
		}
	}
	a.Online = a.LastSeenAt != nil && time.Since(*a.LastSeenAt) < AgentOnlineWithin
	if a.Enrolled {
		a.EnrollExpiresAt = nil
	}
	return nil
}

func cleanAgentName(name string) (string, error) {
	name = strings.Join(strings.Fields(name), " ")
	if name == "" {
		return "", errors.New("name is required")
	}
	if len([]rune(name)) > 60 {
		return "", errors.New("name must be 60 characters or fewer")
	}
	return name, nil
}

// CreateAgent adds an agent waiting to enroll with the token whose hash is
// given, valid until expires. limit caps the workspace's agents; 0 means none.
func (s *Store) CreateAgent(ctx context.Context, workspaceID, createdBy int64, name, enrollTokenHash string, expires time.Time, limit int) (Agent, error) {
	if s == nil {
		return Agent{}, errors.New("store is not available")
	}
	name, err := cleanAgentName(name)
	if err != nil {
		return Agent{}, err
	}
	tx, err := s.beginWorkspaceTx(ctx, workspaceID)
	if err != nil {
		return Agent{}, err
	}
	defer func() { _ = tx.Rollback() }()
	var count int
	if err := tx.QueryRowContext(ctx, `SELECT COUNT(*) FROM probe_agents WHERE workspace_id = $1`, workspaceID).Scan(&count); err != nil {
		return Agent{}, err
	}
	if limit > 0 && count >= limit {
		return Agent{}, ErrAgentLimit
	}
	var a Agent
	err = scanAgent(tx.QueryRowContext(ctx, `
		INSERT INTO probe_agents (workspace_id, created_by, name, enroll_token_hash, enroll_expires_at)
		VALUES ($1, $2, $3, $4, $5)
		RETURNING `+agentColumns, workspaceID, nullableID(createdBy), name, enrollTokenHash, expires.UTC()), &a)
	if err != nil {
		return Agent{}, err
	}
	return a, tx.Commit()
}

// ListAgents returns the workspace's agents, oldest first.
func (s *Store) ListAgents(ctx context.Context, workspaceID int64) ([]Agent, error) {
	if s == nil {
		return nil, errors.New("store is not available")
	}
	tx, err := s.beginWorkspaceTx(ctx, workspaceID)
	if err != nil {
		return nil, err
	}
	defer func() { _ = tx.Rollback() }()
	rows, err := tx.QueryContext(ctx, `SELECT `+agentColumns+` FROM probe_agents WHERE workspace_id = $1 ORDER BY created_at, id`, workspaceID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []Agent{}
	for rows.Next() {
		var a Agent
		if err := scanAgent(rows, &a); err != nil {
			return nil, err
		}
		out = append(out, a)
	}
	return out, rows.Err()
}

// DeleteAgent removes an agent; its secret stops working at once.
func (s *Store) DeleteAgent(ctx context.Context, workspaceID, id int64) (Agent, error) {
	if s == nil {
		return Agent{}, errors.New("store is not available")
	}
	tx, err := s.beginWorkspaceTx(ctx, workspaceID)
	if err != nil {
		return Agent{}, err
	}
	defer func() { _ = tx.Rollback() }()
	var a Agent
	err = scanAgent(tx.QueryRowContext(ctx, `DELETE FROM probe_agents WHERE id = $1 AND workspace_id = $2 RETURNING `+agentColumns, id, workspaceID), &a)
	if errors.Is(err, sql.ErrNoRows) {
		return Agent{}, ErrAgentNotFound
	}
	if err != nil {
		return Agent{}, err
	}
	return a, tx.Commit()
}

// AgentInfo is what an agent reports about itself.
type AgentInfo struct {
	Version  string
	Hostname string
	Platform string
	RemoteIP string
}

func (i AgentInfo) clipped() AgentInfo {
	clip := func(s string, n int) string {
		s = strings.TrimSpace(s)
		if len(s) > n {
			return s[:n]
		}
		return s
	}
	return AgentInfo{Version: clip(i.Version, 40), Hostname: clip(i.Hostname, 120), Platform: clip(i.Platform, 60), RemoteIP: clip(i.RemoteIP, 64)}
}

// EnrollAgent trades a valid enrollment token for the agent's secret, whose
// hash is given. The token works once. It runs as the login role, because
// the agent doesn't know its workspace yet.
func (s *Store) EnrollAgent(ctx context.Context, enrollTokenHash, secretHash string, info AgentInfo) (Agent, error) {
	if s == nil {
		return Agent{}, errors.New("store is not available")
	}
	info = info.clipped()
	var a Agent
	err := scanAgent(s.db.QueryRowContext(ctx, `
		UPDATE probe_agents SET
			secret_hash = $2, enroll_token_hash = NULL, enroll_expires_at = NULL,
			enrolled_at = NOW(), last_seen_at = NOW(),
			version = $3, hostname = $4, platform = $5, remote_ip = $6
		WHERE enroll_token_hash = $1 AND enroll_expires_at > NOW()
		RETURNING `+agentColumns, enrollTokenHash, secretHash, info.Version, info.Hostname, info.Platform, info.RemoteIP), &a)
	if errors.Is(err, sql.ErrNoRows) {
		return Agent{}, ErrEnrollmentToken
	}
	return a, err
}

// AgentHeartbeat records that the agent with this secret checked in, and
// returns it. It runs as the login role: the secret is the only way in.
func (s *Store) AgentHeartbeat(ctx context.Context, secretHash string, info AgentInfo) (Agent, error) {
	if s == nil {
		return Agent{}, errors.New("store is not available")
	}
	info = info.clipped()
	var a Agent
	err := scanAgent(s.db.QueryRowContext(ctx, `
		UPDATE probe_agents SET
			last_seen_at = NOW(),
			version = COALESCE(NULLIF($2, ''), version),
			hostname = COALESCE(NULLIF($3, ''), hostname),
			platform = COALESCE(NULLIF($4, ''), platform),
			remote_ip = $5
		WHERE secret_hash = $1
		RETURNING `+agentColumns, secretHash, info.Version, info.Hostname, info.Platform, info.RemoteIP), &a)
	if errors.Is(err, sql.ErrNoRows) {
		return Agent{}, ErrAgentCredentials
	}
	return a, err
}
