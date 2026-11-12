package api

import (
	"context"
	"errors"
	"fmt"
	"log"
	"net/http"
	"strconv"
	"time"

	"qnetward/internal/platform/mailer"
	"qnetward/internal/store"
)

var hostMetricNames = map[string]string{"cpu": "CPU", "memory": "Memory", "disk": "Disk", "swap": "Swap"}

type hostRuleRequest struct {
	ID          int64   `json:"id"`
	AgentID     *int64  `json:"agent_id"`
	Metric      string  `json:"metric"`
	Threshold   float64 `json:"threshold"`
	Minutes     int     `json:"minutes"`
	NotifyEmail string  `json:"notify_email"`
	Enabled     *bool   `json:"enabled"`
}

// handleHostAlerts lists, saves, and deletes host alert rules.
func (srv *Server) handleHostAlerts(w http.ResponseWriter, r *http.Request) {
	switch r.Method {
	case http.MethodGet:
		user, ok := srv.requireActorFor(w, r, store.ScopeRead)
		if !ok {
			return
		}
		ctx, cancel := context.WithTimeout(r.Context(), 10*time.Second)
		defer cancel()
		rules, err := srv.store.ListHostAlertRules(ctx, user.WorkspaceID)
		if err != nil {
			writeJSON(w, http.StatusInternalServerError, apiError{Error: err.Error()})
			return
		}
		writeJSON(w, http.StatusOK, map[string]any{"rules": rules, "limit": user.Plan.Limits.HostAlertRules})
	case http.MethodPost:
		user, ok := srv.requireActorFor(w, r, store.ScopeWrite)
		if !ok {
			return
		}
		if !srv.isAllowedRequestOrigin(r) {
			writeJSON(w, http.StatusForbidden, apiError{Error: "forbidden origin"})
			return
		}
		var req hostRuleRequest
		if err := decodeJSON(w, r, &req); err != nil {
			writeJSON(w, http.StatusBadRequest, apiError{Error: err.Error()})
			return
		}
		rule := store.HostAlertRule{ID: req.ID, WorkspaceID: user.WorkspaceID, UserID: user.ID, AgentID: req.AgentID, Metric: req.Metric,
			Threshold: req.Threshold, Minutes: req.Minutes, NotifyEmail: req.NotifyEmail, Enabled: true}
		if rule.AgentID != nil && *rule.AgentID <= 0 {
			rule.AgentID = nil
		}
		if req.Enabled != nil {
			rule.Enabled = *req.Enabled
		}
		ctx, cancel := context.WithTimeout(r.Context(), 10*time.Second)
		defer cancel()
		saved, err := srv.store.SaveHostAlertRule(ctx, rule, user.Plan.Limits.HostAlertRules)
		if err != nil {
			switch {
			case errors.Is(err, store.ErrHostRuleNotFound):
				writeJSON(w, http.StatusNotFound, apiError{Error: err.Error()})
			case errors.Is(err, store.ErrHostRuleLimit):
				writeJSON(w, http.StatusConflict, apiError{Error: err.Error()})
			default:
				writeJSON(w, http.StatusBadRequest, apiError{Error: err.Error()})
			}
			return
		}
		status, action := http.StatusOK, "host_alert.updated"
		if req.ID == 0 {
			status, action = http.StatusCreated, "host_alert.created"
		}
		srv.recordAudit(r, user.WorkspaceID, user.User, action, auditTarget{Type: "host_alert_rule", ID: strconv.FormatInt(saved.ID, 10), Label: hostMetricNames[saved.Metric]},
			map[string]any{"threshold": saved.Threshold, "minutes": saved.Minutes, "enabled": saved.Enabled})
		writeJSON(w, status, saved)
	case http.MethodDelete:
		user, ok := srv.requireActorFor(w, r, store.ScopeWrite)
		if !ok {
			return
		}
		if !srv.isAllowedRequestOrigin(r) {
			writeJSON(w, http.StatusForbidden, apiError{Error: "forbidden origin"})
			return
		}
		id, err := strconv.ParseInt(r.URL.Query().Get("id"), 10, 64)
		if err != nil || id <= 0 {
			writeJSON(w, http.StatusBadRequest, apiError{Error: "id must be a rule id"})
			return
		}
		ctx, cancel := context.WithTimeout(r.Context(), 10*time.Second)
		defer cancel()
		if err := srv.store.DeleteHostAlertRule(ctx, user.WorkspaceID, id); err != nil {
			if errors.Is(err, store.ErrHostRuleNotFound) {
				writeJSON(w, http.StatusNotFound, apiError{Error: err.Error()})
				return
			}
			writeJSON(w, http.StatusInternalServerError, apiError{Error: err.Error()})
			return
		}
		srv.recordAudit(r, user.WorkspaceID, user.User, "host_alert.deleted", auditTarget{Type: "host_alert_rule", ID: strconv.FormatInt(id, 10)}, nil)
		writeJSON(w, http.StatusOK, map[string]any{"deleted": id})
	default:
		writeJSON(w, http.StatusMethodNotAllowed, apiError{Error: "method not allowed"})
	}
}

// watchHosts fires and clears host alert rules.
func (srv *Server) watchHosts(ctx context.Context) {
	ctx, cancel := context.WithTimeout(ctx, 20*time.Second)
	defer cancel()
	changes, err := srv.store.EvaluateHostAlerts(ctx, time.Now())
	if err != nil {
		log.Printf("checking host alert rules failed: %v", err)
	}
	for _, c := range changes {
		in := hostAlert(c, srv.buildConfiguredDashboardURL("hosts"))
		event := "host.alert"
		if !c.Firing {
			event = "host.recovered"
		}
		srv.events.publish(c.Rule.WorkspaceID, liveEvent{Type: "host.changed"})
		srv.notifyChannels(c.Rule.WorkspaceID, store.ChannelEventHosts, toNotice(in, event))
		srv.emailAlert(in)
	}
}

func hostAlert(c store.HostAlertChange, dashboardURL string) mailer.AlertEmailInput {
	metric := hostMetricNames[c.Rule.Metric]
	host := c.AgentName
	if c.Hostname != "" && c.Hostname != c.AgentName {
		host = fmt.Sprintf("%s (%s)", c.AgentName, c.Hostname)
	}
	in := mailer.AlertEmailInput{
		To:           c.Rule.NotifyEmail,
		Target:       host,
		TriggeredAt:  time.Now().UTC(),
		DashboardURL: dashboardURL,
	}
	if c.Firing {
		in.Severity = "warning"
		if c.Value >= 95 {
			in.Severity = "critical"
		}
		in.Title = fmt.Sprintf("%s: %s at %.0f%%", c.AgentName, metric, c.Value)
		in.Summary = fmt.Sprintf("%s on %s has been at or above %.0f%% for %d minutes; it's at %.0f%% now.", metric, host, c.Rule.Threshold, c.Rule.Minutes, c.Value)
		if c.Rule.Metric == "disk" {
			in.Summary += " Free space before the disk fills, or services on it will start failing."
		}
		return in
	}
	in.Severity = "success"
	in.Title = fmt.Sprintf("%s: %s back below %.0f%%", c.AgentName, metric, c.Rule.Threshold)
	in.Summary = fmt.Sprintf("%s on %s is at %.0f%%, below %.0f%%, after being high since %s.", metric, host, c.Value, c.Rule.Threshold, c.Since.UTC().Format("15:04 UTC on 2 Jan"))
	return in
}
