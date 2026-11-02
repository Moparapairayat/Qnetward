package api

import (
	"context"
	"fmt"
	"net"
	"net/http"
	"os"
	"strings"
	"time"

	"qnetward/internal/engine/dnslookup"
	"qnetward/internal/engine/ping"
	"qnetward/internal/engine/portscan"
	"qnetward/internal/engine/report"
	"qnetward/internal/engine/tcpping"
	"qnetward/internal/probe"
	"qnetward/internal/store"
)

type pingRequest struct {
	Host       string `json:"host"`
	Count      int    `json:"count"`
	IntervalMs int    `json:"interval_ms"`
	TimeoutMs  int    `json:"timeout_ms"`
	Size       int    `json:"size"`
	IPv6       bool   `json:"ipv6"`
	Continuous bool   `json:"continuous,omitempty"`
}

type tcpPingRequest struct {
	Host       string `json:"host"`
	Port       int    `json:"port"`
	Count      int    `json:"count"`
	IntervalMs int    `json:"interval_ms"`
	TimeoutMs  int    `json:"timeout_ms"`
	Continuous bool   `json:"continuous,omitempty"`
}

type portScanRequest struct {
	Host        string `json:"host"`
	Ports       string `json:"ports"`
	TimeoutMs   int    `json:"timeout_ms"`
	Concurrency int    `json:"concurrency"`
}

type dnsLookupRequest struct {
	Target     string `json:"target"`
	TimeoutMs  int    `json:"timeout_ms"`
	RecordType string `json:"record_type,omitempty"`
	Resolver   string `json:"resolver,omitempty"`
}

func (srv *Server) handlePing(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		writeJSON(w, http.StatusMethodNotAllowed, apiError{Error: "method not allowed"})
		return
	}
	user, ok := srv.requireActor(w, r)
	if !ok {
		return
	}
	if !srv.isAllowedRequestOrigin(r) {
		writeJSON(w, http.StatusForbidden, apiError{Error: "forbidden origin"})
		return
	}

	var req pingRequest
	if err := decodeJSON(w, r, &req); err != nil {
		writeJSON(w, http.StatusBadRequest, apiError{Error: err.Error()})
		return
	}
	if normalizedHost, err := probe.NormalizeHost(req.Host); err != nil {
		writeJSON(w, http.StatusBadRequest, apiError{Error: err.Error()})
		return
	} else {
		req.Host = normalizedHost
	}

	count := req.Count
	interval := time.Second
	if req.IntervalMs > 0 {
		interval = time.Duration(req.IntervalMs) * time.Millisecond
	}
	timeout := 2 * time.Second
	if req.TimeoutMs > 0 {
		timeout = time.Duration(req.TimeoutMs) * time.Millisecond
	}
	size := req.Size

	if req.Continuous {
		writeJSON(w, http.StatusBadRequest, apiError{Error: "continuous mode requires realtime streaming"})
		return
	}
	cfg, err := probe.NormalizePingConfig(count, interval, timeout, size, req.IPv6, false)
	if err != nil {
		writeJSON(w, http.StatusBadRequest, apiError{Error: err.Error()})
		return
	}
	release, ok := srv.tryAcquireProbeSlot()
	if !ok {
		writeJSON(w, http.StatusTooManyRequests, apiError{Error: "server busy, try again"})
		return
	}
	defer release()

	cfg.AddrCheck = srv.targetPolicy.CheckIP
	rep, err := ping.RunStreamContext(r.Context(), req.Host, cfg, func(res report.Result) error {
		srv.storeResult(user.WorkspaceID, user.ID, "ping", req.Host, res.Addr, 0, res, time.Now())
		return nil
	})
	if err != nil {
		writeJSON(w, http.StatusBadRequest, apiError{Error: err.Error()})
		return
	}

	srv.enqueueAlertEvaluation(user, "ping", req.Host, 0, rep.Summary, srv.buildDashboardURL(r, "alerts"))

	writeJSON(w, http.StatusOK, probe.ToJSONReport(rep))
}

func (srv *Server) handleTCPPing(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		writeJSON(w, http.StatusMethodNotAllowed, apiError{Error: "method not allowed"})
		return
	}
	user, ok := srv.requireActor(w, r)
	if !ok {
		return
	}
	if !srv.isAllowedRequestOrigin(r) {
		writeJSON(w, http.StatusForbidden, apiError{Error: "forbidden origin"})
		return
	}

	var req tcpPingRequest
	if err := decodeJSON(w, r, &req); err != nil {
		writeJSON(w, http.StatusBadRequest, apiError{Error: err.Error()})
		return
	}

	host := req.Host
	port := req.Port
	if parsedHost, parsedPort, ok := probe.SplitHostPort(host); ok {
		host = parsedHost
		if port == 0 {
			port = parsedPort
		}
	}
	if port == 0 {
		port = 80
	}

	count := req.Count
	interval := time.Second
	if req.IntervalMs > 0 {
		interval = time.Duration(req.IntervalMs) * time.Millisecond
	}
	timeout := 2 * time.Second
	if req.TimeoutMs > 0 {
		timeout = time.Duration(req.TimeoutMs) * time.Millisecond
	}

	if req.Continuous {
		writeJSON(w, http.StatusBadRequest, apiError{Error: "continuous mode requires realtime streaming"})
		return
	}
	host, port, cfg, err := probe.NormalizeTCPPingRequest(host, port, count, interval, timeout, false)
	if err != nil {
		writeJSON(w, http.StatusBadRequest, apiError{Error: err.Error()})
		return
	}
	release, ok := srv.tryAcquireProbeSlot()
	if !ok {
		writeJSON(w, http.StatusTooManyRequests, apiError{Error: "server busy, try again"})
		return
	}
	defer release()

	cfg.AddrCheck = srv.targetPolicy.CheckIP
	rep, err := tcpping.RunStreamContext(r.Context(), host, port, cfg, func(res report.Result) error {
		srv.storeResult(user.WorkspaceID, user.ID, "tcpping", host, res.Addr, port, res, time.Now())
		return nil
	})
	if err != nil {
		writeJSON(w, http.StatusBadRequest, apiError{Error: err.Error()})
		return
	}

	srv.enqueueAlertEvaluation(user, "tcpping", host, port, rep.Summary, srv.buildDashboardURL(r, "alerts"))

	writeJSON(w, http.StatusOK, probe.ToJSONReport(rep))
}

func (srv *Server) handlePortScan(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		writeJSON(w, http.StatusMethodNotAllowed, apiError{Error: "method not allowed"})
		return
	}
	user, ok := srv.requireActor(w, r)
	if !ok {
		return
	}
	if !srv.isAllowedRequestOrigin(r) {
		writeJSON(w, http.StatusForbidden, apiError{Error: "forbidden origin"})
		return
	}

	var req portScanRequest
	if err := decodeJSON(w, r, &req); err != nil {
		writeJSON(w, http.StatusBadRequest, apiError{Error: err.Error()})
		return
	}

	timeout := probe.DefaultTimeout
	if req.TimeoutMs > 0 {
		timeout = time.Duration(req.TimeoutMs) * time.Millisecond
	}

	host, ports, cfg, err := probe.NormalizePortScanRequest(req.Host, req.Ports, timeout, req.Concurrency)
	if err != nil {
		writeJSON(w, http.StatusBadRequest, apiError{Error: err.Error()})
		return
	}
	release, ok := srv.tryAcquireProbeSlot()
	if !ok {
		writeJSON(w, http.StatusTooManyRequests, apiError{Error: "server busy, try again"})
		return
	}
	defer release()

	srv.recordAudit(r, user.WorkspaceID, user.User, "scan.portscan", auditTarget{Type: "host", ID: host, Label: host}, map[string]any{"ports": len(ports), "spec": req.Ports})
	cfg.AddrCheck = srv.targetPolicy.CheckIP
	rep, err := portscan.RunContext(r.Context(), host, cfg)
	if err != nil {
		writeJSON(w, http.StatusBadRequest, apiError{Error: err.Error()})
		return
	}

	writeJSON(w, http.StatusOK, probe.ToJSONPortScanReport(rep))
}

func (srv *Server) handleDNSLookup(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		writeJSON(w, http.StatusMethodNotAllowed, apiError{Error: "method not allowed"})
		return
	}
	if _, ok := srv.requireAuthenticatedUser(w, r); !ok {
		return
	}
	if !srv.isAllowedRequestOrigin(r) {
		writeJSON(w, http.StatusForbidden, apiError{Error: "forbidden origin"})
		return
	}

	var req dnsLookupRequest
	if err := decodeJSON(w, r, &req); err != nil {
		writeJSON(w, http.StatusBadRequest, apiError{Error: err.Error()})
		return
	}

	target, err := probe.NormalizeHost(req.Target)
	if err != nil {
		writeJSON(w, http.StatusBadRequest, apiError{Error: err.Error()})
		return
	}
	timeout := dnslookup.DefaultTimeout
	if req.TimeoutMs > 0 {
		timeout = time.Duration(req.TimeoutMs) * time.Millisecond
	}
	timeout, err = probe.NormalizeDNSLookupTimeout(timeout)
	if err != nil {
		writeJSON(w, http.StatusBadRequest, apiError{Error: err.Error()})
		return
	}

	release, ok := srv.tryAcquireProbeSlot()
	if !ok {
		writeJSON(w, http.StatusTooManyRequests, apiError{Error: "server busy, try again"})
		return
	}
	defer release()

	ctx, cancel := context.WithTimeout(r.Context(), 15*time.Second)
	defer cancel()
	if err := srv.checkCustomResolver(ctx, req.Resolver); err != nil {
		writeJSON(w, http.StatusBadRequest, apiError{Error: err.Error()})
		return
	}
	rep, err := dnslookup.RunContext(ctx, target, dnslookup.Config{
		Timeout:    timeout,
		RecordType: req.RecordType,
		Resolver:   req.Resolver,
	})
	if err != nil {
		writeJSON(w, http.StatusBadRequest, apiError{Error: err.Error()})
		return
	}
	writeJSON(w, http.StatusOK, rep)
}

func (srv *Server) tryAcquireProbeSlot() (func(), bool) {
	select {
	case srv.probeLimiter <- struct{}{}:
		return func() { <-srv.probeLimiter }, true
	default:
		rejected := srv.rejectedProbes.Add(1)
		if rejected == 1 || rejected%100 == 0 {
			fmt.Fprintf(os.Stderr, "probe limiter rejected %d request(s)\n", rejected)
		}
		return nil, false
	}
}

func (srv *Server) storeResult(workspaceID, userID int64, protocol, target, addr string, port int, res report.Result, ts time.Time) {
	if srv.store == nil {
		return
	}
	rec := store.ResultRecord{
		WorkspaceID: workspaceID,
		UserID:      userID,
		Ts:          ts,
		Protocol:    protocol,
		Target:      target,
		Addr:        addr,
		Port:        port,
		Seq:         res.Seq,
		Error:       res.Error,
	}
	if res.Error == "" {
		ms := float64(res.RTT) / float64(time.Millisecond)
		rec.RttMs = &ms
	}
	srv.store.InsertAsync(rec)
}

// checkCustomResolver applies the target policy to a user-supplied DNS
// resolver. Named presets and the system resolver are always allowed.
func (srv *Server) checkCustomResolver(ctx context.Context, resolver string) error {
	value := strings.ToLower(strings.TrimSpace(resolver))
	switch value {
	case "", "auto", "default", "system", "cloudflare", "google", "quad9":
		return nil
	}
	host := value
	if h, _, err := net.SplitHostPort(value); err == nil {
		host = h
	}
	host = strings.Trim(host, "[]")
	if err := srv.targetPolicy.CheckHost(ctx, host); err != nil {
		return fmt.Errorf("resolver: %w", err)
	}
	return nil
}
