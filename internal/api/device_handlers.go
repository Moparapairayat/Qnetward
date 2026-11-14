package api

import (
	"context"
	"encoding/json"
	"errors"
	"log"
	"net/http"
	"strconv"
	"strings"
	"time"

	"qnetward/internal/store"
)

// deviceCredentials are a device's SNMP secrets, sealed at rest.
type deviceCredentials struct {
	Community    string `json:"community,omitempty"`
	Username     string `json:"username,omitempty"`
	AuthProtocol string `json:"auth_protocol,omitempty"`
	AuthPassword string `json:"auth_password,omitempty"`
	PrivProtocol string `json:"priv_protocol,omitempty"`
	PrivPassword string `json:"priv_password,omitempty"`
}

var (
	snmpAuthProtocols = map[string]bool{"none": true, "md5": true, "sha": true, "sha256": true, "sha512": true}
	snmpPrivProtocols = map[string]bool{"none": true, "des": true, "aes": true, "aes256": true}
)

func (c *deviceCredentials) validate(version string) error {
	switch version {
	case "2c":
		c.Community = strings.TrimSpace(c.Community)
		if c.Community == "" || len(c.Community) > 64 {
			return errors.New("community must be 1 to 64 characters")
		}
		c.Username, c.AuthProtocol, c.AuthPassword, c.PrivProtocol, c.PrivPassword = "", "", "", "", ""
	case "3":
		c.Community = ""
		c.Username = strings.TrimSpace(c.Username)
		if c.Username == "" || len(c.Username) > 64 {
			return errors.New("SNMPv3 user must be 1 to 64 characters")
		}
		if c.AuthProtocol == "" {
			c.AuthProtocol = "none"
		}
		if c.PrivProtocol == "" {
			c.PrivProtocol = "none"
		}
		if !snmpAuthProtocols[c.AuthProtocol] || !snmpPrivProtocols[c.PrivProtocol] {
			return errors.New("unknown SNMPv3 authentication or privacy protocol")
		}
		if c.AuthProtocol != "none" && (len(c.AuthPassword) < 8 || len(c.AuthPassword) > 128) {
			return errors.New("the authentication passphrase must be 8 to 128 characters")
		}
		if c.PrivProtocol != "none" {
			if c.AuthProtocol == "none" {
				return errors.New("privacy needs authentication too")
			}
			if len(c.PrivPassword) < 8 || len(c.PrivPassword) > 128 {
				return errors.New("the privacy passphrase must be 8 to 128 characters")
			}
		}
	}
	return nil
}

type deviceRequest struct {
	ID              int64  `json:"id"`
	AgentID         *int64 `json:"agent_id"`
	Name            string `json:"name"`
	Address         string `json:"address"`
	Port            int    `json:"port"`
	Version         string `json:"version"`
	IntervalSeconds int    `json:"interval_seconds"`
	Enabled         *bool  `json:"enabled"`
	deviceCredentials
}

// deviceView is a device as the console sees it: secrets are never sent back.
type deviceView struct {
	store.NetworkDevice
	Credentials map[string]any `json:"credentials"`
}

func (srv *Server) viewDevice(d store.NetworkDevice) deviceView {
	v := deviceView{NetworkDevice: d, Credentials: map[string]any{}}
	if creds, err := srv.openDeviceCredentials(d); err == nil {
		if d.Version == "3" {
			v.Credentials["username"] = creds.Username
			v.Credentials["auth_protocol"] = creds.AuthProtocol
			v.Credentials["priv_protocol"] = creds.PrivProtocol
		} else {
			v.Credentials["community_set"] = creds.Community != ""
		}
	}
	return v
}

func (srv *Server) openDeviceCredentials(d store.NetworkDevice) (deviceCredentials, error) {
	var c deviceCredentials
	plain, err := srv.secrets.Open(d.CredentialsEnc)
	if err != nil {
		return c, err
	}
	err = json.Unmarshal([]byte(plain), &c)
	return c, err
}

// handleDevices lists, saves, and deletes network devices; with ?id= and
// ?range= it returns history (one interface's with ?if=).
func (srv *Server) handleDevices(w http.ResponseWriter, r *http.Request) {
	if r.Method == http.MethodGet {
		srv.listDevices(w, r)
		return
	}
	user, ok := srv.requireActorFor(w, r, store.ScopeWrite)
	if !ok {
		return
	}
	if !srv.isAllowedRequestOrigin(r) {
		writeJSON(w, http.StatusForbidden, apiError{Error: "forbidden origin"})
		return
	}
	if user.Role != "owner" && user.Role != "admin" {
		writeJSON(w, http.StatusForbidden, apiError{Error: "only workspace owners and admins can manage network devices"})
		return
	}
	if srv.isDemoUser(user.User) {
		writeJSON(w, http.StatusForbidden, apiError{Error: "the shared demo account can't add network devices"})
		return
	}
	ctx, cancel := context.WithTimeout(r.Context(), 10*time.Second)
	defer cancel()

	switch r.Method {
	case http.MethodPost:
		var req deviceRequest
		if err := decodeJSON(w, r, &req); err != nil {
			writeJSON(w, http.StatusBadRequest, apiError{Error: err.Error()})
			return
		}
		d := store.NetworkDevice{ID: req.ID, WorkspaceID: user.WorkspaceID, UserID: user.ID, AgentID: req.AgentID, Name: req.Name, Address: req.Address,
			Port: req.Port, Version: req.Version, IntervalSeconds: req.IntervalSeconds, Enabled: true}
		if d.AgentID != nil && *d.AgentID <= 0 {
			d.AgentID = nil
		}
		if req.Enabled != nil {
			d.Enabled = *req.Enabled
		}
		creds := req.deviceCredentials
		given := creds.Community != "" || creds.Username != "" || creds.AuthPassword != "" || creds.PrivPassword != ""
		if req.ID != 0 && !given {
			old, err := srv.store.GetDevice(ctx, user.WorkspaceID, req.ID)
			if err != nil {
				writeJSON(w, http.StatusNotFound, apiError{Error: store.ErrDeviceNotFound.Error()})
				return
			}
			if old.Version != d.Version {
				writeJSON(w, http.StatusBadRequest, apiError{Error: "enter the credentials for the new SNMP version"})
				return
			}
		} else {
			if err := creds.validate(d.Version); err != nil {
				writeJSON(w, http.StatusBadRequest, apiError{Error: err.Error()})
				return
			}
			raw, _ := json.Marshal(creds)
			sealed, err := srv.secrets.Seal(string(raw))
			if err != nil {
				writeJSON(w, http.StatusInternalServerError, apiError{Error: "couldn't protect the credentials"})
				return
			}
			d.CredentialsEnc = sealed
		}
		saved, err := srv.store.SaveDevice(ctx, d, user.Plan.Limits.Devices)
		if err != nil {
			switch {
			case errors.Is(err, store.ErrDeviceNotFound):
				writeJSON(w, http.StatusNotFound, apiError{Error: err.Error()})
			case errors.Is(err, store.ErrDeviceLimit):
				writeJSON(w, http.StatusConflict, apiError{Error: err.Error()})
			default:
				writeJSON(w, http.StatusBadRequest, apiError{Error: err.Error()})
			}
			return
		}
		status, action := http.StatusOK, "device.updated"
		if req.ID == 0 {
			status, action = http.StatusCreated, "device.created"
		}
		srv.recordAudit(r, user.WorkspaceID, user.User, action, auditTarget{Type: "device", ID: strconv.FormatInt(saved.ID, 10), Label: saved.Name},
			map[string]any{"address": saved.Address, "version": saved.Version, "credentials_changed": d.CredentialsEnc != ""})
		srv.events.publish(user.WorkspaceID, liveEvent{Type: "device.changed"})
		writeJSON(w, status, srv.viewDevice(saved))
	case http.MethodDelete:
		id, err := strconv.ParseInt(r.URL.Query().Get("id"), 10, 64)
		if err != nil || id <= 0 {
			writeJSON(w, http.StatusBadRequest, apiError{Error: "id must be a device id"})
			return
		}
		d, err := srv.store.DeleteDevice(ctx, user.WorkspaceID, id)
		if err != nil {
			if errors.Is(err, store.ErrDeviceNotFound) {
				writeJSON(w, http.StatusNotFound, apiError{Error: err.Error()})
				return
			}
			writeJSON(w, http.StatusInternalServerError, apiError{Error: err.Error()})
			return
		}
		srv.recordAudit(r, user.WorkspaceID, user.User, "device.deleted", auditTarget{Type: "device", ID: strconv.FormatInt(id, 10), Label: d.Name}, nil)
		writeJSON(w, http.StatusOK, map[string]any{"ok": true, "id": id})
	default:
		writeJSON(w, http.StatusMethodNotAllowed, apiError{Error: "method not allowed"})
	}
}

func (srv *Server) listDevices(w http.ResponseWriter, r *http.Request) {
	user, ok := srv.requireActorFor(w, r, store.ScopeRead)
	if !ok {
		return
	}
	ctx, cancel := context.WithTimeout(r.Context(), 15*time.Second)
	defer cancel()
	q := r.URL.Query()
	if raw := q.Get("id"); raw != "" {
		id, err := strconv.ParseInt(raw, 10, 64)
		if err != nil || id <= 0 {
			writeJSON(w, http.StatusBadRequest, apiError{Error: "id must be a device id"})
			return
		}
		name := q.Get("range")
		rg, ok := hostRanges[name]
		if !ok || name == "14d" {
			name, rg = "24h", hostRanges["24h"]
		}
		ifIndex, _ := strconv.Atoi(q.Get("if"))
		points, err := srv.store.DeviceSeries(ctx, user.WorkspaceID, id, ifIndex, time.Now().Add(-rg.span), rg.bucket)
		if err != nil {
			writeJSON(w, http.StatusInternalServerError, apiError{Error: err.Error()})
			return
		}
		writeJSON(w, http.StatusOK, map[string]any{"points": points, "range": name, "bucket_seconds": int(rg.bucket.Seconds())})
		return
	}
	devices, err := srv.store.ListDevices(ctx, user.WorkspaceID)
	if err == nil {
		over := overPlan(len(devices), func(i int) (int64, bool) { return devices[i].ID, devices[i].Enabled }, user.Plan.Limits.Devices)
		for i := range devices {
			devices[i].OverPlan = over[i]
		}
	}
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, apiError{Error: err.Error()})
		return
	}
	out := make([]deviceView, 0, len(devices))
	for _, d := range devices {
		out = append(out, srv.viewDevice(d))
	}
	writeJSON(w, http.StatusOK, map[string]any{"devices": out, "limit": user.Plan.Limits.Devices})
}

// agentDeviceJobs are the devices an agent polls, with their credentials.
func (srv *Server) agentDeviceJobs(ctx context.Context, agent store.Agent) []map[string]any {
	plan, err := srv.store.WorkspacePlan(ctx, agent.WorkspaceID)
	if err != nil {
		log.Printf("reading the plan for agent %d failed: %v", agent.ID, err)
		return []map[string]any{}
	}
	devices, err := srv.store.AgentDevices(ctx, agent.WorkspaceID, agent.ID, plan.Limits.Devices)
	if err != nil {
		log.Printf("listing devices for agent %d failed: %v", agent.ID, err)
		return []map[string]any{}
	}
	jobs := make([]map[string]any, 0, len(devices))
	for _, d := range devices {
		creds, err := srv.openDeviceCredentials(d)
		if err != nil {
			continue
		}
		jobs = append(jobs, map[string]any{
			"device_id": d.ID, "address": d.Address, "port": d.Port, "version": d.Version, "interval_seconds": d.IntervalSeconds,
			"community": creds.Community, "username": creds.Username, "auth_protocol": creds.AuthProtocol, "auth_password": creds.AuthPassword,
			"priv_protocol": creds.PrivProtocol, "priv_password": creds.PrivPassword,
		})
	}
	return jobs
}

// handleAgentDevices stores device polls from an agent.
func (srv *Server) handleAgentDevices(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		writeJSON(w, http.StatusMethodNotAllowed, apiError{Error: "method not allowed"})
		return
	}
	if srv.store == nil {
		writeJSON(w, http.StatusServiceUnavailable, apiError{Error: "storage not available"})
		return
	}
	secret, ok := bearerToken(r)
	if !ok || !strings.HasPrefix(secret, agentSecretPrefix) {
		writeJSON(w, http.StatusUnauthorized, apiError{Error: store.ErrAgentCredentials.Error()})
		return
	}
	var req struct {
		Samples []store.DeviceSample `json:"samples"`
	}
	if err := decodeJSON(w, r, &req); err != nil {
		writeJSON(w, http.StatusBadRequest, apiError{Error: err.Error()})
		return
	}
	if len(req.Samples) > 50 {
		writeJSON(w, http.StatusBadRequest, apiError{Error: "send at most 50 device samples at a time"})
		return
	}
	ctx, cancel := context.WithTimeout(r.Context(), 30*time.Second)
	defer cancel()
	agent, err := srv.store.AgentHeartbeat(ctx, hashOpaqueToken(secret), store.AgentInfo{RemoteIP: clientIPFromRequest(r)})
	if err != nil {
		if errors.Is(err, store.ErrAgentCredentials) {
			writeJSON(w, http.StatusUnauthorized, apiError{Error: "this agent was removed or its secret is wrong; enroll it again"})
			return
		}
		writeJSON(w, http.StatusInternalServerError, apiError{Error: "saving device samples failed"})
		return
	}
	if agent.BackOnline {
		srv.agentBackOnline(agent)
	}
	now := time.Now()
	accepted := 0
	for _, s := range req.Samples {
		if s.At.After(now) {
			s.At = now
		}
		if now.Sub(s.At) > hostSampleMaxAge {
			continue
		}
		s.Clean()
		_, err := srv.store.RecordDeviceSample(ctx, agent.ID, agent.WorkspaceID, s)
		if err != nil {
			if !errors.Is(err, store.ErrDeviceNotFound) {
				log.Printf("recording device %d sample failed: %v", s.DeviceID, err)
			}
			continue
		}
		accepted++
	}
	if accepted > 0 {
		// One event per batch: the console refreshes devices and their charts.
		srv.events.publish(agent.WorkspaceID, liveEvent{Type: EventDevice})
	}
	writeJSON(w, http.StatusOK, map[string]any{"accepted": accepted})
}
