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
	ErrHostRuleNotFound = errors.New("alert rule not found")
	ErrHostRuleLimit    = errors.New("this plan's host alert rule limit is reached")
)

// HostMetrics are the measures a host alert rule can watch.
var HostMetrics = []string{"cpu", "memory", "disk", "swap"}

// HostAlertRule fires when a metric stays at or above Threshold percent for
// Minutes on a host. AgentID nil means every host in the workspace.
type HostAlertRule struct {
	ID          int64     `json:"id"`
	WorkspaceID int64     `json:"-"`
	UserID      int64     `json:"-"`
	AgentID     *int64    `json:"agent_id"`
	Metric      string    `json:"metric"`
	Threshold   float64   `json:"threshold"`
	Minutes     int       `json:"minutes"`
	NotifyEmail string    `json:"notify_email"`
	Enabled     bool      `json:"enabled"`
	CreatedAt   time.Time `json:"created_at"`
	// Firing lists the hosts this rule is firing for now.
	Firing []HostAlertFiring `json:"firing"`
	// OverPlan is set on lists when the workspace's plan doesn't cover this
	// one, so it waits (see plan_caps.go).
	OverPlan bool `json:"over_plan,omitempty"`
}

// HostAlertFiring is a host a rule is firing for.
type HostAlertFiring struct {
	AgentID     int64     `json:"agent_id"`
	FiringSince time.Time `json:"firing_since"`
	Value       float64   `json:"value"`
}

const hostRuleColumns = `id, workspace_id, COALESCE(created_by, 0), agent_id, metric, threshold, minutes, notify_email, enabled, created_at`

func scanHostRule(row interface{ Scan(...any) error }, r *HostAlertRule) error {
	var agent sql.NullInt64
	if err := row.Scan(&r.ID, &r.WorkspaceID, &r.UserID, &agent, &r.Metric, &r.Threshold, &r.Minutes, &r.NotifyEmail, &r.Enabled, &r.CreatedAt); err != nil {
		return err
	}
	if agent.Valid {
		id := agent.Int64
		r.AgentID = &id
	}
	r.Firing = []HostAlertFiring{}
	return nil
}

func validateHostRule(r *HostAlertRule) error {
	if !slices.Contains(HostMetrics, r.Metric) {
		return errors.New("metric must be cpu, memory, disk, or swap")
	}
	if r.Threshold <= 0 || r.Threshold > 100 {
		return errors.New("threshold must be between 1 and 100 percent")
	}
	if r.Minutes < 1 || r.Minutes > 60 {
		return errors.New("minutes must be between 1 and 60")
	}
	r.NotifyEmail = strings.TrimSpace(r.NotifyEmail)
	if r.NotifyEmail != "" {
		email, err := NormalizeEmail(r.NotifyEmail)
		if err != nil {
			return err
		}
		r.NotifyEmail = email
	}
	return nil
}

// SaveHostAlertRule creates a rule (ID 0) or updates one.
func (s *Store) SaveHostAlertRule(ctx context.Context, r HostAlertRule, limit int) (HostAlertRule, error) {
	if s == nil {
		return HostAlertRule{}, errors.New("store is not available")
	}
	if err := validateHostRule(&r); err != nil {
		return HostAlertRule{}, err
	}
	tx, err := s.beginWorkspaceTx(ctx, r.WorkspaceID)
	if err != nil {
		return HostAlertRule{}, err
	}
	defer func() { _ = tx.Rollback() }()
	if r.AgentID != nil {
		var ok bool
		if err := tx.QueryRowContext(ctx, `SELECT EXISTS (SELECT 1 FROM probe_agents WHERE id = $1 AND workspace_id = $2)`, *r.AgentID, r.WorkspaceID).Scan(&ok); err != nil {
			return HostAlertRule{}, err
		}
		if !ok {
			return HostAlertRule{}, errors.New("that host isn't in this workspace")
		}
	}
	var saved HostAlertRule
	if r.ID == 0 {
		if limit > 0 {
			var n int
			if err := tx.QueryRowContext(ctx, `SELECT COUNT(*) FROM host_alert_rules WHERE workspace_id = $1`, r.WorkspaceID).Scan(&n); err != nil {
				return HostAlertRule{}, err
			}
			if n >= limit {
				return HostAlertRule{}, ErrHostRuleLimit
			}
		}
		err = scanHostRule(tx.QueryRowContext(ctx, `INSERT INTO host_alert_rules (workspace_id, created_by, agent_id, metric, threshold, minutes, notify_email, enabled)
			VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING `+hostRuleColumns,
			r.WorkspaceID, nullableID(r.UserID), r.AgentID, r.Metric, r.Threshold, r.Minutes, r.NotifyEmail, r.Enabled), &saved)
	} else {
		err = scanHostRule(tx.QueryRowContext(ctx, `UPDATE host_alert_rules SET
				agent_id = $3, metric = $4, threshold = $5, minutes = $6, notify_email = $7, enabled = $8
			WHERE id = $1 AND workspace_id = $2 RETURNING `+hostRuleColumns,
			r.ID, r.WorkspaceID, r.AgentID, r.Metric, r.Threshold, r.Minutes, r.NotifyEmail, r.Enabled), &saved)
		if err == nil {
			// A changed rule starts over, so it can fire again on its new terms.
			_, err = tx.ExecContext(ctx, `DELETE FROM host_alert_states WHERE rule_id = $1`, r.ID)
		}
	}
	if errors.Is(err, sql.ErrNoRows) {
		return HostAlertRule{}, ErrHostRuleNotFound
	}
	if err != nil {
		return HostAlertRule{}, err
	}
	return saved, tx.Commit()
}

// ListHostAlertRules returns the workspace's rules with where they fire.
func (s *Store) ListHostAlertRules(ctx context.Context, workspaceID int64) ([]HostAlertRule, error) {
	if s == nil {
		return nil, errors.New("store is not available")
	}
	tx, err := s.beginWorkspaceTx(ctx, workspaceID)
	if err != nil {
		return nil, err
	}
	defer func() { _ = tx.Rollback() }()
	rows, err := tx.QueryContext(ctx, `SELECT `+hostRuleColumns+` FROM host_alert_rules WHERE workspace_id = $1 ORDER BY id`, workspaceID)
	if err != nil {
		return nil, err
	}
	out := []HostAlertRule{}
	index := map[int64]int{}
	for rows.Next() {
		var r HostAlertRule
		if err := scanHostRule(rows, &r); err != nil {
			rows.Close()
			return nil, err
		}
		index[r.ID] = len(out)
		out = append(out, r)
	}
	rows.Close()
	if err := rows.Err(); err != nil {
		return nil, err
	}
	states, err := tx.QueryContext(ctx, `SELECT rule_id, agent_id, firing_since, value FROM host_alert_states WHERE workspace_id = $1 ORDER BY firing_since`, workspaceID)
	if err != nil {
		return nil, err
	}
	defer states.Close()
	for states.Next() {
		var ruleID int64
		var f HostAlertFiring
		if err := states.Scan(&ruleID, &f.AgentID, &f.FiringSince, &f.Value); err != nil {
			return nil, err
		}
		if i, ok := index[ruleID]; ok {
			out[i].Firing = append(out[i].Firing, f)
		}
	}
	return out, states.Err()
}

// DeleteHostAlertRule removes a rule.
func (s *Store) DeleteHostAlertRule(ctx context.Context, workspaceID, id int64) error {
	if s == nil {
		return errors.New("store is not available")
	}
	tx, err := s.beginWorkspaceTx(ctx, workspaceID)
	if err != nil {
		return err
	}
	defer func() { _ = tx.Rollback() }()
	res, err := tx.ExecContext(ctx, `DELETE FROM host_alert_rules WHERE id = $1 AND workspace_id = $2`, id, workspaceID)
	if err != nil {
		return err
	}
	if n, _ := res.RowsAffected(); n == 0 {
		return ErrHostRuleNotFound
	}
	return tx.Commit()
}

// HostAlertChange is a rule that started or stopped firing for a host.
type HostAlertChange struct {
	Rule      HostAlertRule
	AgentID   int64
	AgentName string
	Hostname  string
	Value     float64
	Firing    bool
	Since     time.Time
}

// EvaluateHostAlerts checks every enabled rule against recent samples and
// returns the transitions. A rule fires for a host when every sample in its
// window is at or above the threshold and the window is mostly covered; it
// clears when every sample in the window is below. Claiming the state row
// makes each transition happen once across server instances. It runs as the
// login role, across workspaces.
func (s *Store) EvaluateHostAlerts(ctx context.Context, now time.Time) ([]HostAlertChange, error) {
	if s == nil {
		return nil, nil
	}
	rows, err := s.db.QueryContext(ctx, `
		WITH win AS (
			SELECT r.id AS rule_id, m.agent_id,
				MIN(v.value) AS lo, MAX(v.value) AS hi, COUNT(*) AS n,
				(ARRAY_AGG(v.value ORDER BY m.at DESC))[1] AS last
			FROM host_alert_rules r
			JOIN host_metrics m ON m.workspace_id = r.workspace_id
				AND (r.agent_id IS NULL OR m.agent_id = r.agent_id)
				AND m.at > $1::timestamptz - make_interval(mins => r.minutes)
			CROSS JOIN LATERAL (SELECT CASE r.metric
				WHEN 'cpu' THEN m.cpu::float8
				WHEN 'memory' THEN CASE WHEN m.mem_total > 0 THEN m.mem_used::float8 * 100 / m.mem_total ELSE 0 END
				WHEN 'disk' THEN CASE WHEN m.disk_total > 0 THEN m.disk_used::float8 * 100 / m.disk_total ELSE 0 END
				ELSE CASE WHEN m.swap_total > 0 THEN m.swap_used::float8 * 100 / m.swap_total ELSE 0 END
			END AS value) v
			WHERE r.enabled AND `+withinPlanSQL("r.id", "host_alert_rules", "t.enabled", hostRuleCap)+`
			GROUP BY r.id, m.agent_id
		)
		SELECT r.id, r.workspace_id, COALESCE(r.created_by, 0), r.agent_id, r.metric, r.threshold, r.minutes, r.notify_email, r.enabled, r.created_at, w.agent_id, a.name, a.hostname, w.lo, w.hi, w.n, w.last, st.rule_id IS NOT NULL
		FROM win w
		JOIN host_alert_rules r ON r.id = w.rule_id
		JOIN probe_agents a ON a.id = w.agent_id
		LEFT JOIN host_alert_states st ON st.rule_id = w.rule_id AND st.agent_id = w.agent_id`, now.UTC())
	if err != nil {
		return nil, err
	}
	type candidate struct {
		rule           HostAlertRule
		agentID        int64
		name, hostname string
		lo, hi, last   float64
		n              int
		firing         bool
	}
	var cands []candidate
	for rows.Next() {
		var c candidate
		if err := scanHostRule(scanWithExtra{rows, []any{&c.agentID, &c.name, &c.hostname, &c.lo, &c.hi, &c.n, &c.last, &c.firing}}, &c.rule); err != nil {
			rows.Close()
			return nil, err
		}
		cands = append(cands, c)
	}
	rows.Close()
	if err := rows.Err(); err != nil {
		return nil, err
	}

	var out []HostAlertChange
	for _, c := range cands {
		// Samples come once a minute; a window counts once most of it is there.
		need := c.rule.Minutes * 3 / 4
		if need < 1 {
			need = 1
		}
		switch {
		case !c.firing && c.n >= need && c.lo >= c.rule.Threshold:
			var since time.Time
			err := s.db.QueryRowContext(ctx, `INSERT INTO host_alert_states (rule_id, agent_id, workspace_id, value) VALUES ($1, $2, $3, $4)
				ON CONFLICT DO NOTHING RETURNING firing_since`, c.rule.ID, c.agentID, c.rule.WorkspaceID, c.last).Scan(&since)
			if errors.Is(err, sql.ErrNoRows) {
				continue
			}
			if err != nil {
				return out, err
			}
			out = append(out, HostAlertChange{Rule: c.rule, AgentID: c.agentID, AgentName: c.name, Hostname: c.hostname, Value: c.last, Firing: true, Since: since})
		case c.firing && c.hi < c.rule.Threshold:
			var since time.Time
			err := s.db.QueryRowContext(ctx, `DELETE FROM host_alert_states WHERE rule_id = $1 AND agent_id = $2 RETURNING firing_since`, c.rule.ID, c.agentID).Scan(&since)
			if errors.Is(err, sql.ErrNoRows) {
				continue
			}
			if err != nil {
				return out, err
			}
			out = append(out, HostAlertChange{Rule: c.rule, AgentID: c.agentID, AgentName: c.name, Hostname: c.hostname, Value: c.last, Firing: false, Since: since})
		case c.firing:
			_, _ = s.db.ExecContext(ctx, `UPDATE host_alert_states SET value = $3 WHERE rule_id = $1 AND agent_id = $2`, c.rule.ID, c.agentID, c.last)
		}
	}
	return out, nil
}
