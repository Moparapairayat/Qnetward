package store

import (
	"context"
	"database/sql"
	"errors"
)

// AgentMonitors returns the enabled monitors that run from this agent.
func (s *Store) AgentMonitors(ctx context.Context, workspaceID, agentID int64) ([]Monitor, error) {
	if s == nil {
		return nil, errors.New("store is not available")
	}
	tx, err := s.beginWorkspaceTx(ctx, workspaceID)
	if err != nil {
		return nil, err
	}
	defer func() { _ = tx.Rollback() }()

	rows, err := tx.QueryContext(ctx, `SELECT `+monitorColumns+` FROM monitors
		WHERE workspace_id = $1 AND enabled
			AND EXISTS (SELECT 1 FROM monitor_locations l WHERE l.monitor_id = monitors.id AND l.agent_id = $2)
		ORDER BY id`, workspaceID, agentID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	monitors := []Monitor{}
	for rows.Next() {
		var m Monitor
		if err := scanMonitor(rows, &m); err != nil {
			return nil, err
		}
		monitors = append(monitors, m)
	}
	return monitors, rows.Err()
}

// AgentMonitor returns one monitor if it runs from this agent, so an agent
// can only report results for monitors it was given.
func (s *Store) AgentMonitor(ctx context.Context, workspaceID, agentID, monitorID int64) (Monitor, error) {
	if s == nil {
		return Monitor{}, errors.New("store is not available")
	}
	tx, err := s.beginWorkspaceTx(ctx, workspaceID)
	if err != nil {
		return Monitor{}, err
	}
	defer func() { _ = tx.Rollback() }()

	var m Monitor
	err = scanMonitor(tx.QueryRowContext(ctx, `SELECT `+monitorColumns+` FROM monitors
		WHERE id = $1 AND workspace_id = $2 AND enabled
			AND EXISTS (SELECT 1 FROM monitor_locations l WHERE l.monitor_id = monitors.id AND l.agent_id = $3)`, monitorID, workspaceID, agentID), &m)
	if err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return Monitor{}, ErrMonitorNotFound
		}
		return Monitor{}, err
	}
	return m, nil
}
