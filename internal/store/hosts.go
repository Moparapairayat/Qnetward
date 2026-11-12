package store

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"math"
	"time"
)

// HostMetricsRetention is how long host samples are kept.
const HostMetricsRetention = 14 * 24 * time.Hour

// HostDisk is the space on one mounted file system.
type HostDisk struct {
	Mount  string `json:"mount"`
	FSType string `json:"fstype"`
	Used   uint64 `json:"used"`
	Total  uint64 `json:"total"`
}

// HostSample is one reading of a machine's load, as an agent sends it.
type HostSample struct {
	At        time.Time  `json:"at"`
	CPU       float64    `json:"cpu"`
	Load1     float64    `json:"load1"`
	Load5     float64    `json:"load5"`
	Load15    float64    `json:"load15"`
	MemUsed   uint64     `json:"mem_used"`
	MemTotal  uint64     `json:"mem_total"`
	SwapUsed  uint64     `json:"swap_used"`
	SwapTotal uint64     `json:"swap_total"`
	Disks     []HostDisk `json:"disks"`
	NetRxBps  float64    `json:"net_rx_bps"`
	NetTxBps  float64    `json:"net_tx_bps"`
	Procs     int        `json:"procs"`
	Uptime    uint64     `json:"uptime"`
}

// Fullest is the disk with the highest share used.
func (s HostSample) Fullest() (HostDisk, bool) {
	var best HostDisk
	found := false
	for _, d := range s.Disks {
		if d.Total == 0 {
			continue
		}
		if !found || float64(d.Used)/float64(d.Total) > float64(best.Used)/float64(best.Total) {
			best, found = d, true
		}
	}
	return best, found
}

// Clean bounds what an agent sent, so a broken or hostile agent can't store
// nonsense. It reports false for a sample not worth keeping.
func (s *HostSample) Clean() bool {
	finite := func(f float64) float64 {
		if math.IsNaN(f) || math.IsInf(f, 0) || f < 0 {
			return 0
		}
		return f
	}
	s.CPU = math.Min(finite(s.CPU), 100)
	s.Load1, s.Load5, s.Load15 = finite(s.Load1), finite(s.Load5), finite(s.Load15)
	s.NetRxBps, s.NetTxBps = finite(s.NetRxBps), finite(s.NetTxBps)
	if s.MemUsed > s.MemTotal {
		s.MemUsed = s.MemTotal
	}
	if s.SwapUsed > s.SwapTotal {
		s.SwapUsed = s.SwapTotal
	}
	if len(s.Disks) > 20 {
		s.Disks = s.Disks[:20]
	}
	disks := s.Disks[:0]
	for _, d := range s.Disks {
		if d.Total == 0 {
			continue
		}
		if d.Used > d.Total {
			d.Used = d.Total
		}
		if len(d.Mount) > 200 {
			d.Mount = d.Mount[:200]
		}
		if len(d.FSType) > 40 {
			d.FSType = d.FSType[:40]
		}
		disks = append(disks, d)
	}
	s.Disks = disks
	if s.Procs < 0 {
		s.Procs = 0
	}
	s.At = s.At.UTC().Truncate(time.Second)
	return !s.At.IsZero() && s.MemTotal > 0
}

// Host is an enrolled agent with what it reports about its machine.
type Host struct {
	Agent
	Info     json.RawMessage `json:"info,omitempty"`
	Latest   *HostSample     `json:"latest,omitempty"`
	LatestAt *time.Time      `json:"latest_at,omitempty"`
}

// RecordHostMetrics saves samples from an agent and keeps the newest as the
// host's current state. info, when given, replaces what the machine is. It
// runs as the login role: agents are trusted by their secret.
func (s *Store) RecordHostMetrics(ctx context.Context, agentID, workspaceID int64, info json.RawMessage, samples []HostSample) (int, error) {
	if s == nil {
		return 0, errors.New("store is not available")
	}
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return 0, err
	}
	defer func() { _ = tx.Rollback() }()
	accepted := 0
	var newest *HostSample
	for i := range samples {
		sm := samples[i]
		disk, _ := sm.Fullest()
		res, err := tx.ExecContext(ctx, `INSERT INTO host_metrics
			(agent_id, workspace_id, at, cpu, load1, mem_used, mem_total, swap_used, swap_total, disk_used, disk_total, net_rx_bps, net_tx_bps, procs)
			VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)
			ON CONFLICT (agent_id, at) DO NOTHING`,
			agentID, workspaceID, sm.At, sm.CPU, sm.Load1, int64(sm.MemUsed), int64(sm.MemTotal), int64(sm.SwapUsed), int64(sm.SwapTotal),
			int64(disk.Used), int64(disk.Total), sm.NetRxBps, sm.NetTxBps, sm.Procs)
		if err != nil {
			return 0, err
		}
		if n, _ := res.RowsAffected(); n > 0 {
			accepted++
		}
		if newest == nil || sm.At.After(newest.At) {
			newest = &samples[i]
		}
	}
	var latest []byte
	var latestAt *time.Time
	if newest != nil {
		latest, _ = json.Marshal(newest)
		latestAt = &newest.At
	}
	if _, err := tx.ExecContext(ctx, `UPDATE probe_agents SET
			host_info = COALESCE($3::jsonb, host_info),
			host_latest = CASE WHEN $5::timestamptz IS NOT NULL AND (host_latest_at IS NULL OR $5 >= host_latest_at) THEN $4::jsonb ELSE host_latest END,
			host_latest_at = CASE WHEN $5::timestamptz IS NOT NULL AND (host_latest_at IS NULL OR $5 >= host_latest_at) THEN $5 ELSE host_latest_at END
		WHERE id = $1 AND workspace_id = $2`, agentID, workspaceID, nullJSON(info), nullJSON(latest), latestAt); err != nil {
		return 0, err
	}
	return accepted, tx.Commit()
}

func nullJSON(b []byte) any {
	if len(b) == 0 || string(b) == "null" {
		return nil
	}
	return string(b)
}

// ListHosts returns the workspace's enrolled agents with their machines.
func (s *Store) ListHosts(ctx context.Context, workspaceID int64) ([]Host, error) {
	if s == nil {
		return nil, errors.New("store is not available")
	}
	tx, err := s.beginWorkspaceTx(ctx, workspaceID)
	if err != nil {
		return nil, err
	}
	defer func() { _ = tx.Rollback() }()
	rows, err := tx.QueryContext(ctx, `SELECT `+agentColumns+`, host_info, host_latest, host_latest_at FROM probe_agents
		WHERE workspace_id = $1 AND secret_hash IS NOT NULL ORDER BY name, id`, workspaceID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []Host{}
	for rows.Next() {
		var h Host
		var info, latest []byte
		var latestAt sql.NullTime
		if err := scanAgent(scanWithExtra{rows, []any{&info, &latest, &latestAt}}, &h.Agent); err != nil {
			return nil, err
		}
		if len(info) > 0 {
			h.Info = json.RawMessage(info)
		}
		if len(latest) > 0 {
			var sm HostSample
			if json.Unmarshal(latest, &sm) == nil {
				h.Latest = &sm
			}
		}
		if latestAt.Valid {
			t := latestAt.Time
			h.LatestAt = &t
		}
		out = append(out, h)
	}
	return out, rows.Err()
}

// HostPoint is one bucket of a host's history.
type HostPoint struct {
	At       time.Time `json:"at"`
	CPU      float64   `json:"cpu"`
	CPUMax   float64   `json:"cpu_max"`
	Load1    float64   `json:"load1"`
	MemPct   float64   `json:"mem_pct"`
	SwapPct  float64   `json:"swap_pct"`
	DiskPct  float64   `json:"disk_pct"`
	NetRxBps float64   `json:"net_rx_bps"`
	NetTxBps float64   `json:"net_tx_bps"`
	Procs    float64   `json:"procs"`
}

// HostSeries returns a host's history since a time, averaged into buckets.
func (s *Store) HostSeries(ctx context.Context, workspaceID, agentID int64, since time.Time, bucket time.Duration) ([]HostPoint, error) {
	if s == nil {
		return nil, errors.New("store is not available")
	}
	tx, err := s.beginWorkspaceTx(ctx, workspaceID)
	if err != nil {
		return nil, err
	}
	defer func() { _ = tx.Rollback() }()
	rows, err := tx.QueryContext(ctx, `
		SELECT date_bin(make_interval(secs => $4), at, TIMESTAMPTZ '2000-01-01') AS b,
			AVG(cpu), MAX(cpu), AVG(load1),
			AVG(CASE WHEN mem_total > 0 THEN mem_used::float8 * 100 / mem_total ELSE 0 END),
			AVG(CASE WHEN swap_total > 0 THEN swap_used::float8 * 100 / swap_total ELSE 0 END),
			MAX(CASE WHEN disk_total > 0 THEN disk_used::float8 * 100 / disk_total ELSE 0 END),
			AVG(net_rx_bps), AVG(net_tx_bps), AVG(procs)
		FROM host_metrics
		WHERE workspace_id = $1 AND agent_id = $2 AND at >= $3
		GROUP BY b ORDER BY b`, workspaceID, agentID, since.UTC(), bucket.Seconds())
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []HostPoint{}
	for rows.Next() {
		var p HostPoint
		if err := rows.Scan(&p.At, &p.CPU, &p.CPUMax, &p.Load1, &p.MemPct, &p.SwapPct, &p.DiskPct, &p.NetRxBps, &p.NetTxBps, &p.Procs); err != nil {
			return nil, err
		}
		out = append(out, p)
	}
	return out, rows.Err()
}

// PruneHostMetrics removes samples older than before.
func (s *Store) PruneHostMetrics(ctx context.Context, before time.Time) error {
	if s == nil {
		return nil
	}
	_, err := s.db.ExecContext(ctx, `DELETE FROM host_metrics WHERE at < $1`, before.UTC())
	return err
}
