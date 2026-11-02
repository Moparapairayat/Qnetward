package api

import (
	"context"
	"errors"
	"fmt"
	"log"
	"net/http"
	"strconv"
	"strings"
	"time"

	"qnetward/internal/engine/report"
	"qnetward/internal/platform/mailer"
	"qnetward/internal/probe"
	"qnetward/internal/store"
)

type alertRuleRequest struct {
	ID                   int64   `json:"id,omitempty"`
	Name                 string  `json:"name,omitempty"`
	Protocol             string  `json:"protocol"`
	Target               string  `json:"target"`
	Port                 int     `json:"port,omitempty"`
	RecipientEmail       string  `json:"recipient_email,omitempty"`
	LatencyThresholdMs   float64 `json:"latency_threshold_ms,omitempty"`
	LossThresholdPercent float64 `json:"loss_threshold_percent,omitempty"`
	ConsecutiveBreaches  int     `json:"consecutive_breaches,omitempty"`
	CooldownMinutes      int     `json:"cooldown_minutes,omitempty"`
	NotifyOnRecovery     *bool   `json:"notify_on_recovery,omitempty"`
	Enabled              *bool   `json:"enabled,omitempty"`
}

func (srv *Server) handleAlertRules(w http.ResponseWriter, r *http.Request) {
	user, ok := srv.requireActor(w, r)
	if !ok {
		return
	}
	if srv.store == nil {
		writeJSON(w, http.StatusServiceUnavailable, apiError{Error: "storage not available"})
		return
	}

	switch r.Method {
	case http.MethodGet:
		ctx, cancel := context.WithTimeout(r.Context(), 5*time.Second)
		defer cancel()

		rules, err := srv.store.ListAlertRules(ctx, user.WorkspaceID)
		if err != nil {
			writeJSON(w, http.StatusInternalServerError, apiError{Error: err.Error()})
			return
		}
		writeJSON(w, http.StatusOK, rules)
	case http.MethodPost:
		if !srv.isAllowedRequestOrigin(r) {
			writeJSON(w, http.StatusForbidden, apiError{Error: "forbidden origin"})
			return
		}
		var req alertRuleRequest
		if err := decodeJSON(w, r, &req); err != nil {
			writeJSON(w, http.StatusBadRequest, apiError{Error: err.Error()})
			return
		}
		rule, err := normalizeAlertRuleRequest(user.User, req)
		if err != nil {
			writeJSON(w, http.StatusBadRequest, apiError{Error: err.Error()})
			return
		}
		rule.WorkspaceID = user.WorkspaceID
		ctx, cancel := context.WithTimeout(r.Context(), 5*time.Second)
		defer cancel()

		saved, err := srv.store.SaveAlertRule(ctx, rule)
		if err != nil {
			switch {
			case errors.Is(err, store.ErrAlertRuleNotFound):
				writeJSON(w, http.StatusNotFound, apiError{Error: "alert rule not found"})
			default:
				writeJSON(w, http.StatusBadRequest, apiError{Error: err.Error()})
			}
			return
		}
		status := http.StatusOK
		action := "alert_rule.updated"
		if req.ID == 0 {
			status = http.StatusCreated
			action = "alert_rule.created"
		}
		srv.recordAudit(r, user.WorkspaceID, user.User, action, idTarget("alert_rule", saved.ID, saved.Name), map[string]any{"target": alertTargetLabel(saved), "enabled": saved.Enabled})
		writeJSON(w, status, saved)
	case http.MethodDelete:
		if !srv.isAllowedRequestOrigin(r) {
			writeJSON(w, http.StatusForbidden, apiError{Error: "forbidden origin"})
			return
		}
		ruleID, err := strconv.ParseInt(strings.TrimSpace(r.URL.Query().Get("id")), 10, 64)
		if err != nil || ruleID <= 0 {
			writeJSON(w, http.StatusBadRequest, apiError{Error: "valid rule id is required"})
			return
		}
		ctx, cancel := context.WithTimeout(r.Context(), 5*time.Second)
		defer cancel()
		if err := srv.store.DeleteAlertRule(ctx, user.WorkspaceID, ruleID); err != nil {
			switch {
			case errors.Is(err, store.ErrAlertRuleNotFound):
				writeJSON(w, http.StatusNotFound, apiError{Error: "alert rule not found"})
			default:
				writeJSON(w, http.StatusInternalServerError, apiError{Error: err.Error()})
			}
			return
		}
		srv.recordAudit(r, user.WorkspaceID, user.User, "alert_rule.deleted", idTarget("alert_rule", ruleID, ""), nil)
		writeJSON(w, http.StatusOK, map[string]any{"ok": true, "id": ruleID})
	default:
		writeJSON(w, http.StatusMethodNotAllowed, apiError{Error: "method not allowed"})
	}
}

func normalizeAlertRuleRequest(user store.User, req alertRuleRequest) (store.AlertRule, error) {
	protocol := strings.ToLower(strings.TrimSpace(req.Protocol))
	target := strings.TrimSpace(req.Target)
	port := req.Port

	switch protocol {
	case "ping":
		normalizedTarget, err := probe.NormalizeHost(target)
		if err != nil {
			return store.AlertRule{}, err
		}
		target = normalizedTarget
		port = 0
	case "tcpping":
		if parsedHost, parsedPort, ok := probe.SplitHostPort(target); ok {
			target = parsedHost
			if port == 0 {
				port = parsedPort
			}
		}
		normalizedTarget, normalizedPort, _, err := probe.NormalizeTCPPingRequest(target, port, 1, probe.DefaultInterval, probe.DefaultTimeout, false)
		if err != nil {
			return store.AlertRule{}, err
		}
		target = normalizedTarget
		port = normalizedPort
	default:
		return store.AlertRule{}, fmt.Errorf("protocol must be ping or tcpping")
	}

	var latencyThreshold *float64
	if req.LatencyThresholdMs > 0 {
		v := req.LatencyThresholdMs
		latencyThreshold = &v
	}
	var lossThreshold *float64
	if req.LossThresholdPercent > 0 {
		v := req.LossThresholdPercent
		lossThreshold = &v
	}

	recipientEmail := strings.TrimSpace(req.RecipientEmail)
	if recipientEmail == "" {
		recipientEmail = user.Email
	}

	notifyOnRecovery := true
	if req.NotifyOnRecovery != nil {
		notifyOnRecovery = *req.NotifyOnRecovery
	}
	enabled := true
	if req.Enabled != nil {
		enabled = *req.Enabled
	}

	rule := store.AlertRule{
		ID:                   req.ID,
		UserID:               user.ID,
		Name:                 strings.TrimSpace(req.Name),
		Protocol:             protocol,
		Target:               target,
		RecipientEmail:       recipientEmail,
		LatencyThresholdMs:   latencyThreshold,
		LossThresholdPercent: lossThreshold,
		ConsecutiveBreaches:  req.ConsecutiveBreaches,
		CooldownMinutes:      req.CooldownMinutes,
		NotifyOnRecovery:     notifyOnRecovery,
		Enabled:              enabled,
	}
	if protocol == "tcpping" {
		rule.Port = &port
	}
	return rule, nil
}

func (srv *Server) buildDashboardURL(r *http.Request, panel string) string {
	base := srv.buildConfiguredDashboardURL(panel)
	if base != "" {
		return base
	}
	return fmt.Sprintf("%s://%s%s", requestScheme(r), requestHost(r), dashboardRoutePath(panel))
}

func (srv *Server) buildConfiguredDashboardURL(panel string) string {
	base := strings.TrimRight(strings.TrimSpace(srv.publicBaseURL), "/")
	if base == "" {
		return ""
	}
	return base + dashboardRoutePath(panel)
}

func dashboardRoutePath(panel string) string {
	switch strings.TrimSpace(panel) {
	case "", "overview":
		return "/overview"
	case "ping":
		return "/icmp-ping"
	case "tcpping":
		return "/tcp-ping"
	case "portscan":
		return "/port-scan"
	case "dnslookup":
		return "/dns-lookup"
	case "history":
		return "/history"
	case "alerts":
		return "/alerts"
	case "monitors":
		return "/monitors"
	case "settings":
		return "/settings"
	case "profile":
		return "/profile"
	default:
		return "/overview"
	}
}

func (srv *Server) enqueueAlertEvaluation(user actor, protocol, target string, port int, summary report.Summary, dashboardURL string) {
	if srv.store == nil {
		return
	}

	sample := store.AlertSample{
		LossPercent: summary.Loss,
		Sent:        summary.Sent,
		Recv:        summary.Recv,
	}
	if summary.Recv > 0 {
		avgMs := float64(summary.Avg) / float64(time.Millisecond)
		sample.LatencyAvgMs = &avgMs
	}

	go func() {
		ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
		defer cancel()

		decisions, err := srv.store.EvaluateAlertRules(ctx, user.WorkspaceID, protocol, target, port, sample)
		if err != nil {
			log.Printf("alert evaluation failed for %s/%s: %v", protocol, target, err)
			return
		}
		if srv.mailer == nil {
			return
		}
		for _, decision := range decisions {
			alertTitle := decision.Rule.Name
			if strings.TrimSpace(alertTitle) == "" {
				alertTitle = "Monitoring Alert"
			}
			if err := srv.mailer.SendAlert(ctx, mailer.AlertEmailInput{
				To:           decision.Rule.RecipientEmail,
				Name:         user.Name,
				Severity:     decision.Severity,
				Title:        alertTitle,
				Summary:      decision.Summary,
				Target:       alertTargetLabel(decision.Rule),
				TriggeredAt:  time.Now().UTC(),
				DashboardURL: dashboardURL,
			}); err != nil {
				log.Printf("alert email failed for rule %d: %v", decision.Rule.ID, err)
			}
		}
	}()
}

func alertTargetLabel(rule store.AlertRule) string {
	if rule.Protocol == "tcpping" && rule.Port != nil {
		return fmt.Sprintf("%s:%d", rule.Target, *rule.Port)
	}
	return rule.Target
}
