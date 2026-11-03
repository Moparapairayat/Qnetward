package store

import (
	"context"
	"database/sql"
	"errors"
	"time"
)

// SeriesPoint is one slot on a monitor's response-time chart: a single check,
// or every check that fell in a bucket when the window is too long to send raw.
type SeriesPoint struct {
	// T is the slot start in Unix milliseconds.
	T int64 `json:"t"`
	// RttMs averages the round-trip time of the checks that succeeded.
	RttMs *float64 `json:"rtt_ms,omitempty"`
	// Failed counts the checks in the slot that came back down.
	Failed int `json:"failed"`
	Checks int `json:"checks"`
}

// MonitorSeries is a monitor with its checks since a point in time.
type MonitorSeries struct {
	ID              int64         `json:"id"`
	Name            string        `json:"name"`
	Protocol        string        `json:"protocol"`
	Target          string        `json:"target"`
	Port            *int          `json:"port,omitempty"`
	IntervalSeconds int           `json:"interval_seconds"`
	Enabled         bool          `json:"enabled"`
	Status          string        `json:"status"`
	Points          []SeriesPoint `json:"points"`
}

// ListMonitorSeries returns every monitor in the workspace with its checks
// since `since`, grouped into buckets of `bucket` (one second keeps them raw).
func (s *Store) ListMonitorSeries(ctx context.Context, workspaceID int64, since time.Time, bucket time.Duration) ([]MonitorSeries, error) {
	if s == nil {
		return nil, errors.New("store is not available")
	}
	seconds := int64(bucket / time.Second)
	if seconds < 1 {
		seconds = 1
	}
	tx, err := s.beginWorkspaceTx(ctx, workspaceID)
	if err != nil {
		return nil, err
	}
	defer func() { _ = tx.Rollback() }()

	rows, err := tx.QueryContext(ctx, `
		SELECT id, name, protocol, target, port, interval_seconds, enabled, status
		FROM monitors WHERE workspace_id = $1 ORDER BY created_at, id
	`, workspaceID)
	if err != nil {
		return nil, err
	}
	out := make([]MonitorSeries, 0, 8)
	index := map[int64]int{}
	for rows.Next() {
		var m MonitorSeries
		var port sql.NullInt64
		if err := rows.Scan(&m.ID, &m.Name, &m.Protocol, &m.Target, &port, &m.IntervalSeconds, &m.Enabled, &m.Status); err != nil {
			rows.Close()
			return nil, err
		}
		m.Port = nullIntPtr(port)
		m.Points = []SeriesPoint{}
		index[m.ID] = len(out)
		out = append(out, m)
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	rows.Close()
	if len(out) == 0 {
		return out, nil
	}

	points, err := tx.QueryContext(ctx, `
		SELECT monitor_id,
			FLOOR(EXTRACT(EPOCH FROM checked_at) / $3)::bigint * $3 * 1000 AS slot,
			AVG(rtt_ms) FILTER (WHERE ok),
			COUNT(*) FILTER (WHERE NOT ok),
			COUNT(*)
		FROM monitor_checks
		WHERE workspace_id = $1 AND checked_at > $2
		GROUP BY monitor_id, slot
		ORDER BY monitor_id, slot
	`, workspaceID, since.UTC(), seconds)
	if err != nil {
		return nil, err
	}
	defer points.Close()
	for points.Next() {
		var id int64
		var p SeriesPoint
		var rtt sql.NullFloat64
		if err := points.Scan(&id, &p.T, &rtt, &p.Failed, &p.Checks); err != nil {
			return nil, err
		}
		if rtt.Valid {
			v := rtt.Float64
			p.RttMs = &v
		}
		if i, ok := index[id]; ok {
			out[i].Points = append(out[i].Points, p)
		}
	}
	return out, points.Err()
}
