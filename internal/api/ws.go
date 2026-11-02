package api

import (
	"context"
	"errors"
	"fmt"
	"net/http"
	"os"
	"strings"
	"sync"
	"time"

	"qnetward/internal/engine/ping"
	"qnetward/internal/engine/portscan"
	"qnetward/internal/engine/report"
	"qnetward/internal/engine/tcpping"
	"qnetward/internal/probe"
	"qnetward/internal/store"

	"github.com/gorilla/websocket"
)

type wsRequest struct {
	Type        string `json:"type"`
	Host        string `json:"host"`
	Port        int    `json:"port,omitempty"`
	Ports       string `json:"ports,omitempty"`
	Count       int    `json:"count"`
	IntervalMs  int    `json:"interval_ms"`
	TimeoutMs   int    `json:"timeout_ms"`
	Size        int    `json:"size"`
	IPv6        bool   `json:"ipv6"`
	Continuous  bool   `json:"continuous,omitempty"`
	Concurrency int    `json:"concurrency,omitempty"`
}

type wsEvent struct {
	Type     string             `json:"type"`
	Protocol string             `json:"protocol,omitempty"`
	Target   string             `json:"target,omitempty"`
	Addr     string             `json:"addr,omitempty"`
	Port     int                `json:"port,omitempty"`
	Ts       int64              `json:"ts,omitempty"`
	Result   *probe.JSONResult  `json:"result,omitempty"`
	Summary  *probe.JSONSummary `json:"summary,omitempty"`
	Error    string             `json:"error,omitempty"`
}

type wsWriter struct {
	conn *websocket.Conn
	mu   sync.Mutex
}

type wsSession struct {
	srv    *Server
	writer *wsWriter

	mu     sync.Mutex
	cancel context.CancelFunc
	done   chan struct{}
}

func (w *wsWriter) WriteEvent(evt wsEvent) error {
	w.mu.Lock()
	defer w.mu.Unlock()

	if err := w.conn.SetWriteDeadline(time.Now().Add(wsWriteTimeout)); err != nil {
		return err
	}
	return w.conn.WriteJSON(evt)
}

func (s *wsSession) start(user actor, req wsRequest) bool {
	s.mu.Lock()
	if s.cancel != nil {
		s.mu.Unlock()
		return false
	}
	ctx, cancel := context.WithCancel(context.Background())
	done := make(chan struct{})
	s.cancel = cancel
	s.done = done
	s.mu.Unlock()

	go func() {
		defer close(done)
		err := s.srv.runWSRequest(ctx, s.writer, user, req)
		if err != nil && !errors.Is(err, context.Canceled) {
			_ = s.writer.WriteEvent(wsEvent{Type: "error", Error: err.Error()})
		}
		s.clear(done)
	}()
	return true
}

func (s *wsSession) stop() bool {
	s.mu.Lock()
	cancel := s.cancel
	s.mu.Unlock()
	if cancel == nil {
		return false
	}
	cancel()
	return true
}

func (s *wsSession) clear(done chan struct{}) {
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.done != done {
		return
	}
	s.cancel = nil
	s.done = nil
}

func (s *wsSession) close() {
	s.stop()
}

func (srv *Server) wsUpgrader() *websocket.Upgrader {
	return &websocket.Upgrader{
		ReadBufferSize:  4096,
		WriteBufferSize: 4096,
		CheckOrigin: func(r *http.Request) bool {
			return srv.isAllowedWSOrigin(r, r.Header.Get("Origin"))
		},
	}
}

func (srv *Server) handleWS(w http.ResponseWriter, r *http.Request) {
	user, ok := srv.requireActorFor(w, r, store.ScopeProbe)
	if !ok {
		return
	}
	conn, err := srv.wsUpgrader().Upgrade(w, r, nil)
	if err != nil {
		fmt.Fprintf(os.Stderr, "WebSocket upgrade error: %v\n", err)
		return
	}
	defer conn.Close()

	session := &wsSession{srv: srv, writer: &wsWriter{conn: conn}}
	defer session.close()

	conn.SetReadLimit(maxWSMessageBytes)
	conn.SetReadDeadline(time.Now().Add(wsReadTimeout))
	conn.SetPongHandler(func(string) error {
		return conn.SetReadDeadline(time.Now().Add(wsReadTimeout))
	})

	for {
		var req wsRequest
		if err := conn.ReadJSON(&req); err != nil {
			// Check if it's a normal close or an error
			if !websocket.IsUnexpectedCloseError(err, websocket.CloseGoingAway, websocket.CloseAbnormalClosure) {
				return // Normal close
			}
			fmt.Fprintf(os.Stderr, "WebSocket read error: %v\n", err)
			return // Abnormal close or error
		}
		req.Type = strings.ToLower(strings.TrimSpace(req.Type))
		if req.Type == "" {
			_ = session.writer.WriteEvent(wsEvent{Type: "error", Error: "type is required"})
			continue
		}

		conn.SetReadDeadline(time.Now().Add(wsReadTimeout))

		switch req.Type {
		case "stop":
			if !session.stop() {
				_ = session.writer.WriteEvent(wsEvent{Type: "error", Error: "no active run"})
			}
		case "ping", "tcpping", "portscan":
			bucket := quotaProbe
			if req.Type == "portscan" {
				bucket = quotaScan
			}
			if allowed, retry, limit := srv.allowWorkspaceQuota(user, bucket); !allowed {
				_ = session.writer.WriteEvent(wsEvent{Type: "error", Error: fmt.Sprintf("this workspace has used its %d runs of this kind for the hour on the %s plan; try again in %s", limit, user.Plan.Name, retry.Round(time.Minute))})
				continue
			}
			if !session.start(user, req) {
				_ = session.writer.WriteEvent(wsEvent{Type: "error", Error: "a run is already in progress"})
				continue
			}
			if req.Type != "portscan" {
				continue
			}
			host := strings.TrimSpace(req.Host)
			srv.recordAudit(r, user.WorkspaceID, user.User, "scan.portscan", auditTarget{Type: "host", ID: host, Label: host}, map[string]any{"spec": req.Ports, "via": "websocket"})
		default:
			_ = session.writer.WriteEvent(wsEvent{Type: "error", Error: "unknown type"})
		}
	}
}

func (srv *Server) runWSRequest(ctx context.Context, writer *wsWriter, user actor, req wsRequest) error {
	switch req.Type {
	case "ping":
		return srv.streamPingWS(ctx, writer, user, req)
	case "tcpping":
		return srv.streamTCPPingWS(ctx, writer, user, req)
	case "portscan":
		return srv.streamPortScanWS(ctx, writer, req)
	default:
		return fmt.Errorf("unknown type")
	}
}

func (srv *Server) streamPingWS(ctx context.Context, writer *wsWriter, user actor, req wsRequest) error {
	release, ok := srv.tryAcquireProbeSlot()
	if !ok {
		return writer.WriteEvent(wsEvent{Type: "error", Error: "server busy, try again"})
	}
	defer release()

	interval := time.Second
	if req.IntervalMs > 0 {
		interval = time.Duration(req.IntervalMs) * time.Millisecond
	}
	timeout := 2 * time.Second
	if req.TimeoutMs > 0 {
		timeout = time.Duration(req.TimeoutMs) * time.Millisecond
	}
	size := req.Size
	var err error
	req.Host, err = probe.NormalizeHost(req.Host)
	if err != nil {
		return writer.WriteEvent(wsEvent{Type: "error", Error: err.Error()})
	}
	cfg, err := probe.NormalizePingConfig(req.Count, interval, timeout, size, req.IPv6, req.Continuous)
	if err != nil {
		return writer.WriteEvent(wsEvent{Type: "error", Error: err.Error()})
	}

	cfg.AddrCheck = srv.targetPolicy.CheckIP
	rep, err := ping.RunStreamContext(ctx, req.Host, cfg, func(res report.Result) error {
		ts := time.Now()
		srv.storeResult(user.WorkspaceID, user.ID, "ping", req.Host, res.Addr, 0, res, ts)
		jr := probe.ToJSONResult(res)
		return writer.WriteEvent(wsEvent{
			Type:     "result",
			Protocol: "icmp",
			Target:   req.Host,
			Ts:       ts.UnixMilli(),
			Result:   &jr,
		})
	})
	if err != nil {
		if errors.Is(err, context.Canceled) {
			summary := probe.ToJSONSummary(rep.Summary)
			return writer.WriteEvent(wsEvent{
				Type:     "stopped",
				Protocol: "icmp",
				Target:   req.Host,
				Addr:     rep.Addr,
				Summary:  &summary,
			})
		}
		return writer.WriteEvent(wsEvent{Type: "error", Error: err.Error()})
	}

	summary := probe.ToJSONSummary(rep.Summary)
	srv.enqueueAlertEvaluation(user, "ping", req.Host, 0, rep.Summary, srv.buildConfiguredDashboardURL("alerts"))
	return writer.WriteEvent(wsEvent{
		Type:     "summary",
		Protocol: rep.Protocol,
		Target:   rep.Target,
		Addr:     rep.Addr,
		Summary:  &summary,
	})
}

func (srv *Server) streamTCPPingWS(ctx context.Context, writer *wsWriter, user actor, req wsRequest) error {
	release, ok := srv.tryAcquireProbeSlot()
	if !ok {
		return writer.WriteEvent(wsEvent{Type: "error", Error: "server busy, try again"})
	}
	defer release()

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

	interval := time.Second
	if req.IntervalMs > 0 {
		interval = time.Duration(req.IntervalMs) * time.Millisecond
	}
	timeout := 2 * time.Second
	if req.TimeoutMs > 0 {
		timeout = time.Duration(req.TimeoutMs) * time.Millisecond
	}

	host, port, cfg, err := probe.NormalizeTCPPingRequest(host, port, req.Count, interval, timeout, req.Continuous)
	if err != nil {
		return writer.WriteEvent(wsEvent{Type: "error", Error: err.Error()})
	}

	cfg.AddrCheck = srv.targetPolicy.CheckIP
	rep, err := tcpping.RunStreamContext(ctx, host, port, cfg, func(res report.Result) error {
		ts := time.Now()
		srv.storeResult(user.WorkspaceID, user.ID, "tcpping", host, res.Addr, port, res, ts)
		jr := probe.ToJSONResult(res)
		return writer.WriteEvent(wsEvent{
			Type:     "result",
			Protocol: "tcp",
			Target:   host,
			Port:     port,
			Ts:       ts.UnixMilli(),
			Result:   &jr,
		})
	})
	if err != nil {
		if errors.Is(err, context.Canceled) {
			summary := probe.ToJSONSummary(rep.Summary)
			return writer.WriteEvent(wsEvent{
				Type:     "stopped",
				Protocol: "tcp",
				Target:   host,
				Addr:     rep.Addr,
				Port:     port,
				Summary:  &summary,
			})
		}
		return writer.WriteEvent(wsEvent{Type: "error", Error: err.Error()})
	}

	summary := probe.ToJSONSummary(rep.Summary)
	srv.enqueueAlertEvaluation(user, "tcpping", host, port, rep.Summary, srv.buildConfiguredDashboardURL("alerts"))
	return writer.WriteEvent(wsEvent{
		Type:     "summary",
		Protocol: rep.Protocol,
		Target:   rep.Target,
		Addr:     rep.Addr,
		Port:     rep.Port,
		Summary:  &summary,
	})
}

func (srv *Server) streamPortScanWS(ctx context.Context, writer *wsWriter, req wsRequest) error {
	release, ok := srv.tryAcquireProbeSlot()
	if !ok {
		return writer.WriteEvent(wsEvent{Type: "error", Error: "server busy, try again"})
	}
	defer release()

	timeout := probe.DefaultTimeout
	if req.TimeoutMs > 0 {
		timeout = time.Duration(req.TimeoutMs) * time.Millisecond
	}

	host, _, cfg, err := probe.NormalizePortScanRequest(req.Host, req.Ports, timeout, req.Concurrency)
	if err != nil {
		return writer.WriteEvent(wsEvent{Type: "error", Error: err.Error()})
	}

	cfg.AddrCheck = srv.targetPolicy.CheckIP
	rep, err := portscan.RunStreamContext(ctx, host, cfg, func(res portscan.Result) error {
		ts := time.Now()
		jr := probe.ToJSONPortScanResult(res)
		return writer.WriteEvent(wsEvent{
			Type:     "result",
			Protocol: "tcp-portscan",
			Target:   host,
			Ts:       ts.UnixMilli(),
			Result:   &jr,
		})
	})
	if err != nil {
		if errors.Is(err, context.Canceled) {
			summary := probe.ToJSONPortScanSummary(rep.Summary)
			return writer.WriteEvent(wsEvent{
				Type:     "stopped",
				Protocol: rep.Protocol,
				Target:   rep.Target,
				Addr:     rep.Addr,
				Summary:  &summary,
			})
		}
		return writer.WriteEvent(wsEvent{Type: "error", Error: err.Error()})
	}

	summary := probe.ToJSONPortScanSummary(rep.Summary)
	return writer.WriteEvent(wsEvent{
		Type:     "summary",
		Protocol: rep.Protocol,
		Target:   rep.Target,
		Addr:     rep.Addr,
		Summary:  &summary,
	})
}
