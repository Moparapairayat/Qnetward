package api

import (
	"context"
	"log"
	"net/http"
	"strconv"
	"strings"
	"time"

	"qnetward/internal/store"
)

// auditTarget names what an audited action touched.
type auditTarget struct {
	Type  string
	ID    string
	Label string
}

// recordAudit appends an event to the audit log. workspaceID is 0 for account
// events. A failed write is logged and does not fail the request: the action
// itself already happened.
func (srv *Server) recordAudit(r *http.Request, workspaceID int64, actor store.User, action string, target auditTarget, metadata map[string]any) {
	if srv.store == nil {
		return
	}
	ctx, cancel := context.WithTimeout(context.WithoutCancel(r.Context()), 3*time.Second)
	defer cancel()
	err := srv.store.RecordAuditEvent(ctx, store.AuditEvent{
		WorkspaceID: workspaceID,
		ActorUserID: actor.ID,
		ActorEmail:  actor.Email,
		Action:      action,
		TargetType:  target.Type,
		TargetID:    target.ID,
		TargetLabel: target.Label,
		IPAddress:   clientIPFromRequest(r),
		UserAgent:   r.UserAgent(),
		Metadata:    metadata,
	})
	if err != nil {
		log.Printf("audit %s failed: %v", action, err)
	}
	if typ := auditLiveEvent(action); typ != "" && workspaceID > 0 {
		srv.events.publish(workspaceID, liveEvent{Type: typ})
		// Agents pick up changed monitors and devices now, not at their next check-in.
		if typ == EventMonitorChanged || typ == EventDevice {
			srv.syncAgents(workspaceID)
		}
	}
}

func idTarget(kind string, id int64, label string) auditTarget {
	return auditTarget{Type: kind, ID: strconv.FormatInt(id, 10), Label: label}
}

type auditPage struct {
	Events     []store.AuditEvent `json:"events"`
	NextBefore int64              `json:"next_before,omitempty"`
}

// handleWorkspaceAudit pages through the active workspace's audit log. Only
// owners and admins can read it.
func (srv *Server) handleWorkspaceAudit(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		writeJSON(w, http.StatusMethodNotAllowed, apiError{Error: "method not allowed"})
		return
	}
	user, ok := srv.requireActor(w, r)
	if !ok {
		return
	}
	if user.Role != "owner" && user.Role != "admin" {
		writeJSON(w, http.StatusForbidden, apiError{Error: "only workspace owners and admins can view the audit log"})
		return
	}

	query := r.URL.Query()
	q := store.AuditQuery{Category: strings.TrimSpace(query.Get("category"))}
	if q.Category != "" {
		if _, known := store.AuditCategories[q.Category]; !known {
			writeJSON(w, http.StatusBadRequest, apiError{Error: "unknown category"})
			return
		}
	}
	if v := query.Get("before"); v != "" {
		before, err := strconv.ParseInt(v, 10, 64)
		if err != nil || before <= 0 {
			writeJSON(w, http.StatusBadRequest, apiError{Error: "before must be an event id"})
			return
		}
		q.Before = before
	}
	if v := query.Get("limit"); v != "" {
		limit, err := strconv.Atoi(v)
		if err != nil || limit <= 0 || limit > 100 {
			writeJSON(w, http.StatusBadRequest, apiError{Error: "limit must be between 1 and 100"})
			return
		}
		q.Limit = limit
	}
	if q.Limit == 0 {
		q.Limit = 50
	}

	ctx, cancel := context.WithTimeout(r.Context(), 10*time.Second)
	defer cancel()
	events, err := srv.store.ListWorkspaceAuditEvents(ctx, user.WorkspaceID, q)
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, apiError{Error: err.Error()})
		return
	}
	page := auditPage{Events: events}
	if len(events) == q.Limit {
		page.NextBefore = events[len(events)-1].ID
	}
	writeJSON(w, http.StatusOK, page)
}

// handleAccountActivity lists the signed-in user's own account events.
func (srv *Server) handleAccountActivity(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		writeJSON(w, http.StatusMethodNotAllowed, apiError{Error: "method not allowed"})
		return
	}
	user, ok := srv.requireAuthenticatedUser(w, r)
	if !ok {
		return
	}
	ctx, cancel := context.WithTimeout(r.Context(), 10*time.Second)
	defer cancel()
	events, err := srv.store.ListAccountAuditEvents(ctx, user.ID, 30)
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, apiError{Error: err.Error()})
		return
	}
	writeJSON(w, http.StatusOK, auditPage{Events: events})
}
