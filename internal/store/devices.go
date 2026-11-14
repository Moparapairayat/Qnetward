package store

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"math"
	"net"
	"regexp"
	"strings"
	"time"
)

var (
	ErrDeviceNotFound = errors.New("device not found")
	ErrDeviceLimit    = errors.New("this plan's network device limit is reached")
)

// DeviceMetricsRetention is how long device and interface samples are kept.
const DeviceMetricsRetention = 7 * 24 * time.Hour

var hostnameRe = regexp.MustCompile(`^[A-Za-z0-9]([A-Za-z0-9-]{0,62}[A-Za-z0-9])?(\.[A-Za-z0-9]([A-Za-z0-9-]{0,62}[A-Za-z0-9])?)*$`)

// NetworkDevice is a router, switch, or firewall an agent polls over SNMP.
type NetworkDevice struct {
	ID              int64           `json:"id"`
	WorkspaceID     int64           `json:"-"`
	UserID          int64           `json:"-"`
	AgentID         *int64          `json:"agent_id"`
	AgentName       string          `json:"agent_name,omitempty"`
	AgentOnline     bool            `json:"agent_online"`
	Name            string          `json:"name"`
	Address         string          `json:"address"`
	Port            int             `json:"port"`
	Version         string          `json:"version"`
	CredentialsEnc  string          `json:"-"`
	IntervalSeconds int             `json:"interval_seconds"`
	Enabled         bool            `json:"enabled"`
	Status          string          `json:"status"`
	LastPolledAt    *time.Time      `json:"last_polled_at,omitempty"`
	LastError       string          `json:"last_error,omitempty"`
	Sys             json.RawMessage `json:"sys,omitempty"`
	Interfaces      json.RawMessage `json:"interfaces,omitempty"`
	CreatedAt       time.Time       `json:"created_at"`
	// OverPlan is set on lists when the workspace's plan doesn't cover this
	// one, so it waits (see plan_caps.go).
	OverPlan bool `json:"over_plan,omitempty"`
}

const deviceColumns = `d.id, d.workspace_id, COALESCE(d.created_by, 0), d.agent_id, COALESCE(a.name, ''),
	COALESCE(a.last_seen_at > NOW() - INTERVAL '90 seconds', FALSE), d.name, d.address, d.port, d.version, d.credentials_enc,
	d.interval_seconds, d.enabled, d.status, d.last_polled_at, d.last_error, d.sys, d.interfaces, d.created_at`

const deviceFrom = ` FROM network_devices d LEFT JOIN probe_agents a ON a.id = d.agent_id`

func scanDevice(row interface{ Scan(...any) error }, d *NetworkDevice) error {
	var agent sql.NullInt64
	var polled sql.NullTime
	var sys, ifs []byte
	if err := row.Scan(&d.ID, &d.WorkspaceID, &d.UserID, &agent, &d.AgentName, &d.AgentOnline, &d.Name, &d.Address, &d.Port, &d.Version, &d.CredentialsEnc,
		&d.IntervalSeconds, &d.Enabled, &d.Status, &polled, &d.LastError, &sys, &ifs, &d.CreatedAt); err != nil {
		return err
	}
	if agent.Valid {
		id := agent.Int64
		d.AgentID = &id
	}
	if polled.Valid {
		t := polled.Time
		d.LastPolledAt = &t
	}
	if len(sys) > 0 {
		d.Sys = json.RawMessage(sys)
	}
	if len(ifs) > 0 {
		d.Interfaces = json.RawMessage(ifs)
	}
	return nil
}

// ValidateDeviceAddress accepts an IP address or a host name. Agents poll
// inside private networks, so private addresses are expected here.
func ValidateDeviceAddress(addr string) (string, error) {
	addr = strings.TrimSpace(strings.ToLower(addr))
	if ip := net.ParseIP(addr); ip != nil {
		return ip.String(), nil
	}
	if len(addr) > 253 || !hostnameRe.MatchString(addr) {
		return "", errors.New("address must be an IP address or a host name")
	}
	return addr, nil
}

func validateDevice(d *NetworkDevice) error {
	d.Name = strings.Join(strings.Fields(d.Name), " ")
	if d.Name == "" || len(d.Name) > 80 {
		return errors.New("name must be 1 to 80 characters")
	}
	addr, err := ValidateDeviceAddress(d.Address)
	if err != nil {
		return err
	}
	d.Address = addr
	if d.Port == 0 {
		d.Port = 161
	}
	if d.Port < 1 || d.Port > 65535 {
		return errors.New("port must be between 1 and 65535")
	}
	if d.Version != "2c" && d.Version != "3" {
		return errors.New("version must be 2c or 3")
	}
	if d.IntervalSeconds == 0 {
		d.IntervalSeconds = 60
	}
	if d.IntervalSeconds < 30 || d.IntervalSeconds > 3600 {
		return errors.New("poll every 30 seconds to 1 hour")
	}
	return nil
}

// SaveDevice creates a device (ID 0) or updates one. An empty
// CredentialsEnc on update keeps the stored credentials.
func (s *Store) SaveDevice(ctx context.Context, d NetworkDevice, limit int) (NetworkDevice, error) {
	if s == nil {
		return NetworkDevice{}, errors.New("store is not available")
	}
	if err := validateDevice(&d); err != nil {
		return NetworkDevice{}, err
	}
	tx, err := s.beginWorkspaceTx(ctx, d.WorkspaceID)
	if err != nil {
		return NetworkDevice{}, err
	}
	defer func() { _ = tx.Rollback() }()
	if d.AgentID != nil {
		var ok bool
		if err := tx.QueryRowContext(ctx, `SELECT EXISTS (SELECT 1 FROM probe_agents WHERE id = $1 AND workspace_id = $2)`, *d.AgentID, d.WorkspaceID).Scan(&ok); err != nil {
			return NetworkDevice{}, err
		}
		if !ok {
			return NetworkDevice{}, errors.New("that agent isn't in this workspace")
		}
	}
	var id int64
	if d.ID == 0 {
		if d.CredentialsEnc == "" {
			return NetworkDevice{}, errors.New("credentials are required")
		}
		if limit > 0 {
			var n int
			if err := tx.QueryRowContext(ctx, `SELECT COUNT(*) FROM network_devices WHERE workspace_id = $1`, d.WorkspaceID).Scan(&n); err != nil {
				return NetworkDevice{}, err
			}
			if n >= limit {
				return NetworkDevice{}, ErrDeviceLimit
			}
		}
		err = tx.QueryRowContext(ctx, `INSERT INTO network_devices (workspace_id, created_by, agent_id, name, address, port, version, credentials_enc, interval_seconds, enabled)
			VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10) RETURNING id`,
			d.WorkspaceID, nullableID(d.UserID), d.AgentID, d.Name, d.Address, d.Port, d.Version, d.CredentialsEnc, d.IntervalSeconds, d.Enabled).Scan(&id)
	} else {
		// A device moved to new settings starts over: its old state no longer applies.
		err = tx.QueryRowContext(ctx, `UPDATE network_devices SET
				agent_id = $3, name = $4, address = $5, port = $6, version = $7,
				credentials_enc = COALESCE(NULLIF($8, ''), credentials_enc),
				interval_seconds = $9, enabled = $10,
				status = CASE WHEN address <> $5 OR port <> $6 OR version <> $7 OR $8 <> '' OR agent_id IS DISTINCT FROM $3 THEN 'unknown' ELSE status END
			WHERE id = $1 AND workspace_id = $2 RETURNING id`,
			d.ID, d.WorkspaceID, d.AgentID, d.Name, d.Address, d.Port, d.Version, d.CredentialsEnc, d.IntervalSeconds, d.Enabled).Scan(&id)
	}
	if errors.Is(err, sql.ErrNoRows) {
		return NetworkDevice{}, ErrDeviceNotFound
	}
	if err != nil {
		return NetworkDevice{}, err
	}
	var saved NetworkDevice
	if err := scanDevice(tx.QueryRowContext(ctx, `SELECT `+deviceColumns+deviceFrom+` WHERE d.id = $1`, id), &saved); err != nil {
		return NetworkDevice{}, err
	}
	return saved, tx.Commit()
}

// ListDevices returns the workspace's devices.
func (s *Store) ListDevices(ctx context.Context, workspaceID int64) ([]NetworkDevice, error) {
	if s == nil {
		return nil, errors.New("store is not available")
	}
	tx, err := s.beginWorkspaceTx(ctx, workspaceID)
	if err != nil {
		return nil, err
	}
	defer func() { _ = tx.Rollback() }()
	rows, err := tx.QueryContext(ctx, `SELECT `+deviceColumns+deviceFrom+` WHERE d.workspace_id = $1 ORDER BY d.name, d.id`, workspaceID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []NetworkDevice{}
	for rows.Next() {
		var d NetworkDevice
		if err := scanDevice(rows, &d); err != nil {
			return nil, err
		}
		out = append(out, d)
	}
	return out, rows.Err()
}

// GetDevice returns one device.
func (s *Store) GetDevice(ctx context.Context, workspaceID, id int64) (NetworkDevice, error) {
	if s == nil {
		return NetworkDevice{}, errors.New("store is not available")
	}
	tx, err := s.beginWorkspaceTx(ctx, workspaceID)
	if err != nil {
		return NetworkDevice{}, err
	}
	defer func() { _ = tx.Rollback() }()
	var d NetworkDevice
	err = scanDevice(tx.QueryRowContext(ctx, `SELECT `+deviceColumns+deviceFrom+` WHERE d.id = $1 AND d.workspace_id = $2`, id, workspaceID), &d)
	if errors.Is(err, sql.ErrNoRows) {
		return NetworkDevice{}, ErrDeviceNotFound
	}
	return d, err
}

// DeleteDevice removes a device and its history.
func (s *Store) DeleteDevice(ctx context.Context, workspaceID, id int64) (NetworkDevice, error) {
	d, err := s.GetDevice(ctx, workspaceID, id)
	if err != nil {
		return NetworkDevice{}, err
	}
	tx, err := s.beginWorkspaceTx(ctx, workspaceID)
	if err != nil {
		return NetworkDevice{}, err
	}
	defer func() { _ = tx.Rollback() }()
	if _, err := tx.ExecContext(ctx, `DELETE FROM network_devices WHERE id = $1 AND workspace_id = $2`, id, workspaceID); err != nil {
		return NetworkDevice{}, err
	}
	return d, tx.Commit()
}

// AgentDevices returns the enabled devices an agent polls.
// limit is the plan's device limit: only the oldest enabled devices up to it
// are polled (see plan_caps.go).
func (s *Store) AgentDevices(ctx context.Context, workspaceID, agentID int64, limit int) ([]NetworkDevice, error) {
	if s == nil {
		return nil, errors.New("store is not available")
	}
	tx, err := s.beginWorkspaceTx(ctx, workspaceID)
	if err != nil {
		return nil, err
	}
	defer func() { _ = tx.Rollback() }()
	rows, err := tx.QueryContext(ctx, `SELECT `+deviceColumns+deviceFrom+` WHERE d.workspace_id = $1 AND d.agent_id = $2 AND d.enabled
		AND d.id IN (SELECT id FROM network_devices WHERE workspace_id = $1 AND enabled ORDER BY id LIMIT $3) ORDER BY d.id`, workspaceID, agentID, limit)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []NetworkDevice{}
	for rows.Next() {
		var d NetworkDevice
		if err := scanDevice(rows, &d); err != nil {
			return nil, err
		}
		out = append(out, d)
	}
	return out, rows.Err()
}

// DeviceSys is what a device says about itself.
type DeviceSys struct {
	Descr    string `json:"descr"`
	ObjectID string `json:"object_id"`
	UptimeS  int64  `json:"uptime_s"`
	Name     string `json:"name"`
	Location string `json:"location"`
	Contact  string `json:"contact"`
}

// DeviceIf is one interface at a poll.
type DeviceIf struct {
	Index         int     `json:"index"`
	Name          string  `json:"name"`
	Descr         string  `json:"descr"`
	Alias         string  `json:"alias"`
	Type          int     `json:"type"`
	Admin         string  `json:"admin"`
	Oper          string  `json:"oper"`
	SpeedBps      uint64  `json:"speed_bps"`
	InBps         float64 `json:"in_bps"`
	OutBps        float64 `json:"out_bps"`
	InErrorsPS    float64 `json:"in_errors_ps"`
	OutErrorsPS   float64 `json:"out_errors_ps"`
	InDiscardsPS  float64 `json:"in_discards_ps"`
	OutDiscardsPS float64 `json:"out_discards_ps"`
	HasRates      bool    `json:"has_rates"`
}

// DeviceSample is one poll, as an agent sends it.
type DeviceSample struct {
	DeviceID   int64      `json:"device_id"`
	At         time.Time  `json:"at"`
	Reachable  bool       `json:"reachable"`
	Error      string     `json:"error,omitempty"`
	RTTMs      float64    `json:"rtt_ms"`
	Sys        *DeviceSys `json:"sys,omitempty"`
	Interfaces []DeviceIf `json:"interfaces"`
}

func clip(s string, n int) string {
	s = strings.TrimSpace(strings.ToValidUTF8(s, ""))
	if len(s) > n {
		return s[:n]
	}
	return s
}

func finiteNonNeg(f float64) float64 {
	if math.IsNaN(f) || math.IsInf(f, 0) || f < 0 {
		return 0
	}
	return f
}

var ifStates = map[string]bool{"up": true, "down": true, "testing": true, "unknown": true, "dormant": true, "notPresent": true, "lowerLayerDown": true, "": true}

// Clean bounds what an agent sent.
func (s *DeviceSample) Clean() {
	s.At = s.At.UTC().Truncate(time.Second)
	s.Error = clip(s.Error, 300)
	s.RTTMs = finiteNonNeg(s.RTTMs)
	if s.Sys != nil {
		s.Sys.Descr, s.Sys.ObjectID = clip(s.Sys.Descr, 300), clip(s.Sys.ObjectID, 120)
		s.Sys.Name, s.Sys.Location, s.Sys.Contact = clip(s.Sys.Name, 120), clip(s.Sys.Location, 120), clip(s.Sys.Contact, 120)
		if s.Sys.UptimeS < 0 {
			s.Sys.UptimeS = 0
		}
	}
	if len(s.Interfaces) > 512 {
		s.Interfaces = s.Interfaces[:512]
	}
	for i := range s.Interfaces {
		f := &s.Interfaces[i]
		f.Name, f.Descr, f.Alias = clip(f.Name, 120), clip(f.Descr, 120), clip(f.Alias, 120)
		if !ifStates[f.Admin] {
			f.Admin = "unknown"
		}
		if !ifStates[f.Oper] {
			f.Oper = "unknown"
		}
		f.InBps, f.OutBps = finiteNonNeg(f.InBps), finiteNonNeg(f.OutBps)
		f.InErrorsPS, f.OutErrorsPS = finiteNonNeg(f.InErrorsPS), finiteNonNeg(f.OutErrorsPS)
		f.InDiscardsPS, f.OutDiscardsPS = finiteNonNeg(f.InDiscardsPS), finiteNonNeg(f.OutDiscardsPS)
	}
	if !s.Reachable {
		s.Interfaces = nil
		s.Sys = nil
	}
}

// DeviceChange says how a poll moved a device's state.
type DeviceChange struct {
	Device     NetworkDevice
	OldStatus  string
	NewStatus  string
	Interfaces []DeviceIf // the previous interfaces, to compare
}

// RecordDeviceSample stores a poll from the agent that owns the device and
// returns what changed. It runs as the login role: agents are trusted by
// their secret, and the device must be assigned to this agent.
func (s *Store) RecordDeviceSample(ctx context.Context, agentID, workspaceID int64, sm DeviceSample) (DeviceChange, error) {
	if s == nil {
		return DeviceChange{}, errors.New("store is not available")
	}
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return DeviceChange{}, err
	}
	defer func() { _ = tx.Rollback() }()
	var ch DeviceChange
	var prevIfs []byte
	var polled sql.NullTime
	err = tx.QueryRowContext(ctx, `SELECT status, interfaces, last_polled_at FROM network_devices WHERE id = $1 AND agent_id = $2 AND workspace_id = $3 FOR UPDATE`,
		sm.DeviceID, agentID, workspaceID).Scan(&ch.OldStatus, &prevIfs, &polled)
	if errors.Is(err, sql.ErrNoRows) {
		return DeviceChange{}, ErrDeviceNotFound
	}
	if err != nil {
		return DeviceChange{}, err
	}
	if len(prevIfs) > 0 {
		_ = json.Unmarshal(prevIfs, &ch.Interfaces)
	}
	var in, out, errs float64
	up, down, rated := 0, 0, false
	for _, f := range sm.Interfaces {
		rated = rated || f.HasRates
		in += f.InBps
		out += f.OutBps
		errs += f.InErrorsPS + f.OutErrorsPS
		switch {
		case f.Oper == "up":
			up++
		case f.Admin == "up":
			down++ // only interfaces meant to be up count as down
		}
	}
	// The first poll after a start has no rates yet; leaving it out keeps
	// charts from dipping to zero. Unreachable polls are always kept.
	if !sm.Reachable || rated || len(sm.Interfaces) == 0 {
		if _, err := tx.ExecContext(ctx, `INSERT INTO device_metrics (device_id, workspace_id, at, reachable, rtt_ms, in_bps, out_bps, errors_ps, if_up, if_down)
		VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10) ON CONFLICT DO NOTHING`,
			sm.DeviceID, workspaceID, sm.At, sm.Reachable, sm.RTTMs, in, out, errs, up, down); err != nil {
			return DeviceChange{}, err
		}
	}
	for _, f := range sm.Interfaces {
		if !f.HasRates {
			continue
		}
		if _, err := tx.ExecContext(ctx, `INSERT INTO device_if_metrics (device_id, workspace_id, if_index, at, in_bps, out_bps, errors_ps, discards_ps)
			VALUES ($1, $2, $3, $4, $5, $6, $7, $8) ON CONFLICT DO NOTHING`,
			sm.DeviceID, workspaceID, f.Index, sm.At, f.InBps, f.OutBps, f.InErrorsPS+f.OutErrorsPS, f.InDiscardsPS+f.OutDiscardsPS); err != nil {
			return DeviceChange{}, err
		}
	}
	// An older sample (sent late) is kept for history but doesn't change state.
	if polled.Valid && sm.At.Before(polled.Time) {
		ch.NewStatus = ch.OldStatus
		return ch, tx.Commit()
	}
	ch.NewStatus = "down"
	var sys, ifs any
	if sm.Reachable {
		ch.NewStatus = "up"
		b, _ := json.Marshal(sm.Sys)
		sys = string(b)
		b, _ = json.Marshal(sm.Interfaces)
		ifs = string(b)
	}
	if err := scanDevice(tx.QueryRowContext(ctx, `
		WITH upd AS (
			UPDATE network_devices SET status = $2, last_polled_at = $3, last_error = $4,
				sys = COALESCE($5::jsonb, sys), interfaces = COALESCE($6::jsonb, interfaces)
			WHERE id = $1 RETURNING *
		)
		SELECT `+strings.ReplaceAll(deviceColumns, "d.", "u.")+` FROM upd u LEFT JOIN probe_agents a ON a.id = u.agent_id`,
		sm.DeviceID, ch.NewStatus, sm.At, sm.Error, sys, ifs), &ch.Device); err != nil {
		return DeviceChange{}, err
	}
	return ch, tx.Commit()
}

// DevicePoint is one bucket of a device's or an interface's history.
type DevicePoint struct {
	At       time.Time `json:"at"`
	InBps    float64   `json:"in_bps"`
	OutBps   float64   `json:"out_bps"`
	ErrorsPS float64   `json:"errors_ps"`
	RTTMs    float64   `json:"rtt_ms,omitempty"`
	Up       float64   `json:"up"`
}

// DeviceSeries returns a device's totals, or one interface's when ifIndex is
// above 0, since a time and averaged into buckets.
func (s *Store) DeviceSeries(ctx context.Context, workspaceID, deviceID int64, ifIndex int, since time.Time, bucket time.Duration) ([]DevicePoint, error) {
	if s == nil {
		return nil, errors.New("store is not available")
	}
	tx, err := s.beginWorkspaceTx(ctx, workspaceID)
	if err != nil {
		return nil, err
	}
	defer func() { _ = tx.Rollback() }()
	q := `SELECT date_bin(make_interval(secs => $4), at, TIMESTAMPTZ '2000-01-01') AS b,
			AVG(in_bps), AVG(out_bps), AVG(errors_ps), AVG(rtt_ms), AVG(CASE WHEN reachable THEN 1 ELSE 0 END)
		FROM device_metrics WHERE workspace_id = $1 AND device_id = $2 AND at >= $3 GROUP BY b ORDER BY b`
	args := []any{workspaceID, deviceID, since.UTC(), bucket.Seconds()}
	if ifIndex > 0 {
		q = `SELECT date_bin(make_interval(secs => $4), at, TIMESTAMPTZ '2000-01-01') AS b,
				AVG(in_bps), AVG(out_bps), AVG(errors_ps), 0::float8, 1::float8
			FROM device_if_metrics WHERE workspace_id = $1 AND device_id = $2 AND at >= $3 AND if_index = $5 GROUP BY b ORDER BY b`
		args = append(args, ifIndex)
	}
	rows, err := tx.QueryContext(ctx, q, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []DevicePoint{}
	for rows.Next() {
		var p DevicePoint
		if err := rows.Scan(&p.At, &p.InBps, &p.OutBps, &p.ErrorsPS, &p.RTTMs, &p.Up); err != nil {
			return nil, err
		}
		out = append(out, p)
	}
	return out, rows.Err()
}

// PruneDeviceMetrics removes samples older than before.
func (s *Store) PruneDeviceMetrics(ctx context.Context, before time.Time) error {
	if s == nil {
		return nil
	}
	if _, err := s.db.ExecContext(ctx, `DELETE FROM device_if_metrics WHERE at < $1`, before.UTC()); err != nil {
		return err
	}
	_, err := s.db.ExecContext(ctx, `DELETE FROM device_metrics WHERE at < $1`, before.UTC())
	return err
}
