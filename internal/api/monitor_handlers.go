package api

import (
	"context"
	"errors"
	"fmt"
	"log"
	"net/http"
	"strconv"
	"strings"
	"sync"
	"time"

	"qnetward/internal/engine/httpcheck"
	"qnetward/internal/engine/ping"
	"qnetward/internal/engine/report"
	"qnetward/internal/engine/tcpping"
	"qnetward/internal/platform/mailer"
	"qnetward/internal/probe"
	"qnetward/internal/store"
)

// Scheduling bounds for uptime monitors.
const (
	monitorPollEvery      = 5 * time.Second
	monitorClaimBatch     = 20
	monitorConcurrency    = 8
	monitorProbeCount     = 3
	monitorProbeInterval  = 500 * time.Millisecond
	monitorProbeTimeout   = 2 * time.Second
	monitorHTTPTimeout    = 10 * time.Second
	monitorCheckRetention = 30 * 24 * time.Hour
	monitorPruneEvery     = time.Hour
)

type monitorRequest struct {
	ID              int64  `json:"id,omitempty"`
	Name            string `json:"name,omitempty"`
	Protocol        string `json:"protocol"`
	Target          string `json:"target"`
	Port            int    `json:"port,omitempty"`
	IntervalSeconds int    `json:"interval_seconds"`
	NotifyEmail     string `json:"notify_email"`
	Enabled         *bool  `json:"enabled,omitempty"`
	ExpectedStatus  *int   `json:"expected_status,omitempty"`
}

func (srv *Server) handleMonitors(w http.ResponseWriter, r *http.Request) {
	user, ok := srv.requireActor(w, r)
	if !ok {
		return
	}

	switch r.Method {
	case http.MethodGet:
		ctx, cancel := context.WithTimeout(r.Context(), 10*time.Second)
		defer cancel()
		monitors, err := srv.store.ListMonitors(ctx, user.WorkspaceID)
		if err != nil {
			writeJSON(w, http.StatusInternalServerError, apiError{Error: err.Error()})
			return
		}
		writeJSON(w, http.StatusOK, monitors)
	case http.MethodPost:
		if !srv.isAllowedRequestOrigin(r) {
			writeJSON(w, http.StatusForbidden, apiError{Error: "forbidden origin"})
			return
		}
		var req monitorRequest
		if err := decodeJSON(w, r, &req); err != nil {
			writeJSON(w, http.StatusBadRequest, apiError{Error: err.Error()})
			return
		}
		monitor, err := normalizeMonitorRequest(user, req)
		if err != nil {
			writeJSON(w, http.StatusBadRequest, apiError{Error: err.Error()})
			return
		}
		ctx, cancel := context.WithTimeout(r.Context(), 10*time.Second)
		defer cancel()
		saved, err := srv.store.SaveMonitor(ctx, monitor, user.Plan.Limits.Monitors)
		if err != nil {
			switch {
			case errors.Is(err, store.ErrMonitorNotFound):
				writeJSON(w, http.StatusNotFound, apiError{Error: err.Error()})
			case errors.Is(err, store.ErrMonitorDuplicate), errors.Is(err, store.ErrMonitorLimit):
				writeJSON(w, http.StatusConflict, apiError{Error: err.Error()})
			default:
				writeJSON(w, http.StatusBadRequest, apiError{Error: err.Error()})
			}
			return
		}
		status := http.StatusOK
		action := "monitor.updated"
		if req.ID == 0 {
			status = http.StatusCreated
			action = "monitor.created"
		}
		srv.recordAudit(r, user.WorkspaceID, user.User, action, idTarget("monitor", saved.ID, saved.Name),
			map[string]any{"target": monitorTargetLabel(saved), "protocol": saved.Protocol, "interval_seconds": saved.IntervalSeconds, "enabled": saved.Enabled})
		writeJSON(w, status, saved)
	case http.MethodDelete:
		if !srv.isAllowedRequestOrigin(r) {
			writeJSON(w, http.StatusForbidden, apiError{Error: "forbidden origin"})
			return
		}
		id, err := strconv.ParseInt(strings.TrimSpace(r.URL.Query().Get("id")), 10, 64)
		if err != nil || id <= 0 {
			writeJSON(w, http.StatusBadRequest, apiError{Error: "valid monitor id is required"})
			return
		}
		ctx, cancel := context.WithTimeout(r.Context(), 10*time.Second)
		defer cancel()
		if err := srv.store.DeleteMonitor(ctx, user.WorkspaceID, id); err != nil {
			if errors.Is(err, store.ErrMonitorNotFound) {
				writeJSON(w, http.StatusNotFound, apiError{Error: err.Error()})
				return
			}
			writeJSON(w, http.StatusInternalServerError, apiError{Error: err.Error()})
			return
		}
		srv.recordAudit(r, user.WorkspaceID, user.User, "monitor.deleted", idTarget("monitor", id, ""), nil)
		writeJSON(w, http.StatusOK, map[string]any{"ok": true, "id": id})
	default:
		writeJSON(w, http.StatusMethodNotAllowed, apiError{Error: "method not allowed"})
	}
}

// seriesWindows are the chart ranges the overview offers, each with a bucket
// that keeps a line to a few hundred points at most.
var seriesWindows = map[string]struct{ span, bucket time.Duration }{
	"15m": {15 * time.Minute, time.Second},
	"1h":  {time.Hour, time.Second},
	"6h":  {6 * time.Hour, 2 * time.Minute},
	"24h": {24 * time.Hour, 10 * time.Minute},
}

// handleMonitorSeries returns each monitor's checks over a window, for the
// response-time chart on the overview.
func (srv *Server) handleMonitorSeries(w http.ResponseWriter, r *http.Request) {
	user, ok := srv.requireActorFor(w, r, store.ScopeRead)
	if !ok {
		return
	}
	if r.Method != http.MethodGet {
		writeJSON(w, http.StatusMethodNotAllowed, apiError{Error: "method not allowed"})
		return
	}
	name := r.URL.Query().Get("window")
	if name == "" {
		name = "1h"
	}
	win, found := seriesWindows[name]
	if !found {
		writeJSON(w, http.StatusBadRequest, apiError{Error: "window must be 15m, 1h, 6h, or 24h"})
		return
	}
	ctx, cancel := context.WithTimeout(r.Context(), 10*time.Second)
	defer cancel()
	now := time.Now()
	series, err := srv.store.ListMonitorSeries(ctx, user.WorkspaceID, now.Add(-win.span), win.bucket)
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, apiError{Error: err.Error()})
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{
		"window":         name,
		"now":            now.UnixMilli(),
		"span_ms":        win.span.Milliseconds(),
		"bucket_seconds": int(win.bucket / time.Second),
		"monitors":       series,
	})
}

func normalizeMonitorRequest(user actor, req monitorRequest) (store.Monitor, error) {
	protocol := strings.ToLower(strings.TrimSpace(req.Protocol))
	enabled := true
	if req.Enabled != nil {
		enabled = *req.Enabled
	}
	m := store.Monitor{
		ID:              req.ID,
		WorkspaceID:     user.WorkspaceID,
		UserID:          user.ID,
		Name:            req.Name,
		Protocol:        protocol,
		IntervalSeconds: req.IntervalSeconds,
		NotifyEmail:     req.NotifyEmail,
		Enabled:         enabled,
		ExpectedStatus:  req.ExpectedStatus,
	}

	if protocol == "http" {
		target, err := httpcheck.NormalizeURL(req.Target)
		if err != nil {
			return store.Monitor{}, err
		}
		m.Target = target
		return m, nil
	}

	target := strings.TrimSpace(req.Target)
	port := req.Port
	if host, parsedPort, ok := probe.SplitHostPort(target); ok {
		target = host
		if port == 0 {
			port = parsedPort
		}
	}
	host, err := probe.NormalizeHost(target)
	if err != nil {
		return store.Monitor{}, err
	}
	m.Target = host
	if protocol == "tcpping" {
		m.Port = &port
	}
	return m, nil
}

// RunMonitors checks due monitors until ctx is cancelled. Every instance can
// run it: claiming a monitor moves its next run forward, so no two instances
// check the same monitor at once.
func (srv *Server) RunMonitors(ctx context.Context) {
	if srv.store == nil {
		return
	}
	poll := time.NewTicker(monitorPollEvery)
	defer poll.Stop()
	prune := time.NewTicker(monitorPruneEvery)
	defer prune.Stop()

	slots := make(chan struct{}, monitorConcurrency)
	var wg sync.WaitGroup
	defer wg.Wait()

	for {
		select {
		case <-ctx.Done():
			return
		case <-prune.C:
			pruneCtx, cancel := context.WithTimeout(ctx, 30*time.Second)
			if err := srv.store.PruneMonitorChecks(pruneCtx, time.Now().Add(-monitorCheckRetention)); err != nil {
				log.Printf("monitor check pruning failed: %v", err)
			}
			// The hourly maintenance pass also trims the audit log to its retention.
			if err := srv.store.PruneAuditEvents(pruneCtx, time.Now().Add(-store.AuditRetention)); err != nil {
				log.Printf("audit log pruning failed: %v", err)
			}
			cancel()
		case <-poll.C:
			free := monitorConcurrency - len(slots)
			if free <= 0 {
				continue
			}
			claimCtx, cancel := context.WithTimeout(ctx, 10*time.Second)
			due, err := srv.store.ClaimDueMonitors(claimCtx, min(free, monitorClaimBatch))
			cancel()
			if err != nil {
				log.Printf("claiming due monitors failed: %v", err)
				continue
			}
			for _, m := range due {
				slots <- struct{}{}
				wg.Add(1)
				go func(m store.Monitor) {
					defer wg.Done()
					defer func() { <-slots }()
					srv.checkMonitor(ctx, m)
				}(m)
			}
		}
	}
}

// checkMonitor runs one check, records it, and emails on a change between up
// and down or when an HTTPS certificate nears expiry.
func (srv *Server) checkMonitor(ctx context.Context, m store.Monitor) {
	ctx, cancel := context.WithTimeout(ctx, 30*time.Second)
	defer cancel()

	var check store.MonitorCheck
	var summary *report.Summary
	if m.Protocol == "http" {
		check = srv.runHTTPCheck(ctx, m)
	} else {
		check, summary = srv.runProbeCheck(ctx, m)
	}
	if ctx.Err() != nil && errors.Is(ctx.Err(), context.Canceled) {
		return // shutting down
	}

	saveCtx, saveCancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer saveCancel()
	outcome, err := srv.store.RecordMonitorCheck(saveCtx, m, check)
	if err != nil {
		if !errors.Is(err, store.ErrMonitorNotFound) {
			log.Printf("recording check for monitor %d failed: %v", m.ID, err)
		}
		return
	}

	// Ping and TCP samples also feed the workspace's alert rules.
	if summary != nil && summary.Sent > 0 {
		srv.enqueueAlertEvaluation(actor{User: store.User{ID: m.UserID}, WorkspaceID: m.WorkspaceID},
			m.Protocol, m.Target, monitorPort(m), *summary, srv.buildConfiguredDashboardURL("alerts"))
	}

	if m.NotifyEmail == "" || srv.mailer == nil {
		return
	}
	wentDown := !check.OK && outcome.Previous != "down"
	recovered := check.OK && outcome.Previous == "down"
	if wentDown || recovered {
		srv.sendMonitorEmail(saveCtx, m, check, recovered)
	}
	if outcome.WarnTLS {
		srv.sendCertificateWarning(saveCtx, m, *check.TLSExpiresAt)
	}
}

// runProbeCheck sends three pings or TCP connects. Any reply means up. Each
// sample is also written to the results table, so it shows in History.
func (srv *Server) runProbeCheck(ctx context.Context, m store.Monitor) (store.MonitorCheck, *report.Summary) {
	port := monitorPort(m)
	record := func(res report.Result) error {
		srv.storeResult(m.WorkspaceID, m.UserID, m.Protocol, m.Target, res.Addr, port, res, time.Now())
		return nil
	}

	var rep report.Report
	var err error
	switch m.Protocol {
	case "ping":
		var cfg ping.Config
		cfg, err = probe.NormalizePingConfig(monitorProbeCount, monitorProbeInterval, monitorProbeTimeout, 0, false, false)
		if err == nil {
			cfg.AddrCheck = srv.targetPolicy.CheckIP
			rep, err = ping.RunStreamContext(ctx, m.Target, cfg, record)
		}
	case "tcpping":
		var cfg tcpping.Config
		_, _, cfg, err = probe.NormalizeTCPPingRequest(m.Target, port, monitorProbeCount, monitorProbeInterval, monitorProbeTimeout, false)
		if err == nil {
			cfg.AddrCheck = srv.targetPolicy.CheckIP
			rep, err = tcpping.RunStreamContext(ctx, m.Target, port, cfg, record)
		}
	default:
		err = fmt.Errorf("unsupported protocol %q", m.Protocol)
	}

	check := store.MonitorCheck{CheckedAt: time.Now(), LossPercent: 100}
	switch {
	case err != nil:
		check.Error = err.Error()
		return check, nil
	case rep.Summary.Recv == 0:
		check.Error = firstProbeError(rep)
	default:
		check.OK = true
		check.LossPercent = rep.Summary.Loss
		avg := float64(rep.Summary.Avg) / float64(time.Millisecond)
		check.RttMs = &avg
	}
	return check, &rep.Summary
}

// runHTTPCheck fetches the URL once. It is up when the final response, after
// redirects, has the expected status, or any 2xx or 3xx when none is set.
func (srv *Server) runHTTPCheck(ctx context.Context, m store.Monitor) store.MonitorCheck {
	res, err := httpcheck.Run(ctx, m.Target, httpcheck.Config{
		Timeout:     monitorHTTPTimeout,
		DialControl: srv.targetPolicy.DialControl(),
		RootCAs:     srv.monitorRootCAs,
	})
	check := store.MonitorCheck{CheckedAt: time.Now(), LossPercent: 100}
	if err != nil {
		check.Error = err.Error()
		return check
	}
	code := res.StatusCode
	ms := float64(res.Duration) / float64(time.Millisecond)
	check.StatusCode = &code
	check.RttMs = &ms
	check.TLSExpiresAt = res.TLSExpiresAt
	if httpStatusMatches(code, m.ExpectedStatus) {
		check.OK = true
		check.LossPercent = 0
		return check
	}
	if m.ExpectedStatus != nil {
		check.Error = fmt.Sprintf("returned %d, expected %d", code, *m.ExpectedStatus)
	} else {
		check.Error = fmt.Sprintf("returned %d %s", code, http.StatusText(code))
	}
	return check
}

func httpStatusMatches(code int, expected *int) bool {
	if expected != nil {
		return code == *expected
	}
	return code >= 200 && code < 400
}

func monitorPort(m store.Monitor) int {
	if m.Port != nil {
		return *m.Port
	}
	return 0
}

func monitorTargetLabel(m store.Monitor) string {
	if m.Port != nil {
		return fmt.Sprintf("%s:%d", m.Target, *m.Port)
	}
	return m.Target
}

func (srv *Server) sendMonitorEmail(ctx context.Context, m store.Monitor, check store.MonitorCheck, recovered bool) {
	target := monitorTargetLabel(m)
	in := mailer.AlertEmailInput{
		To:           m.NotifyEmail,
		Severity:     "critical",
		Title:        m.Name + " is down",
		Summary:      fmt.Sprintf("No replies from %s in the last check. %s", target, check.Error),
		Target:       target,
		TriggeredAt:  check.CheckedAt.UTC(),
		DashboardURL: srv.buildConfiguredDashboardURL("monitors"),
	}
	if m.Protocol == "http" {
		in.Summary = fmt.Sprintf("The last check of %s failed: %s.", target, check.Error)
	}
	if recovered {
		in.Severity = "success"
		in.Title = m.Name + " is back up"
		in.Summary = fmt.Sprintf("%s is answering again.", target)
		if check.RttMs != nil {
			in.Summary = fmt.Sprintf("%s is answering again, %.0f ms.", target, *check.RttMs)
		}
	}
	in.Summary = strings.TrimSpace(in.Summary)
	if err := srv.mailer.SendAlert(ctx, in); err != nil {
		log.Printf("monitor email failed for monitor %d: %v", m.ID, err)
	}
}

func (srv *Server) sendCertificateWarning(ctx context.Context, m store.Monitor, expires time.Time) {
	days := int(time.Until(expires).Hours() / 24)
	when := fmt.Sprintf("in %d days", days)
	switch {
	case days < 0:
		when = "already"
	case days == 0:
		when = "today"
	case days == 1:
		when = "tomorrow"
	}
	in := mailer.AlertEmailInput{
		To:           m.NotifyEmail,
		Severity:     "warning",
		Title:        "Certificate for " + m.Name + " expires " + when,
		Summary:      fmt.Sprintf("The TLS certificate served by %s expires on %s UTC. Renew it before visitors start seeing errors.", m.Target, expires.UTC().Format("2 Jan 2006 15:04")),
		Target:       m.Target,
		TriggeredAt:  time.Now().UTC(),
		DashboardURL: srv.buildConfiguredDashboardURL("monitors"),
	}
	if err := srv.mailer.SendAlert(ctx, in); err != nil {
		log.Printf("certificate warning failed for monitor %d: %v", m.ID, err)
	}
}

func firstProbeError(rep report.Report) string {
	for _, res := range rep.Results {
		if res.Error != "" {
			return res.Error
		}
	}
	return "no replies"
}
