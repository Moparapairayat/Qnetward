package api

import (
	"context"
	"errors"
	"fmt"
	"net/http"
	"strconv"
	"time"

	"qnetward/internal/plans"
	"qnetward/internal/store"
)

// Quota buckets counted per workspace, or per key for API requests.
const (
	quotaProbe = "probe"
	quotaScan  = "scan"
)

func quotaKey(workspaceID int64, bucket string) string {
	return fmt.Sprintf("ws:%d:%s", workspaceID, bucket)
}

// allowWorkspaceQuota spends one unit of an hourly workspace quota. It
// returns how long to wait when the quota is used up.
func (srv *Server) allowWorkspaceQuota(user actor, bucket string) (bool, time.Duration, int) {
	limit := user.Plan.Limits.ProbesPerHour
	if bucket == quotaScan {
		limit = user.Plan.Limits.ScansPerHour
	}
	allowed, retry := srv.quotaLimiter.Allow(quotaKey(user.WorkspaceID, bucket), rateLimitConfig{Limit: limit, Window: time.Hour})
	return allowed, retry, limit
}

// enforceWorkspaceQuota is allowWorkspaceQuota for HTTP handlers: it writes a
// 429 with Retry-After when the quota is used up.
func (srv *Server) enforceWorkspaceQuota(w http.ResponseWriter, user actor, bucket string) bool {
	allowed, retry, limit := srv.allowWorkspaceQuota(user, bucket)
	if allowed {
		return true
	}
	what := "probes"
	if bucket == quotaScan {
		what = "port scans"
	}
	w.Header().Set("Retry-After", strconv.Itoa(int(retry.Seconds())))
	writeJSON(w, http.StatusTooManyRequests, apiError{Error: fmt.Sprintf("this workspace has used its %d %s for the hour on the %s plan; try again in %s",
		limit, what, user.Plan.Name, retry.Round(time.Minute))})
	return false
}

type usageResponse struct {
	Plan  plans.Plan   `json:"plan"`
	Plans []plans.Plan `json:"plans"`
	Usage struct {
		store.WorkspaceUsage
		ProbesLastHour int `json:"probes_last_hour"`
		ScansLastHour  int `json:"scans_last_hour"`
	} `json:"usage"`
}

// handleWorkspaceUsage reports the active workspace's plan, its limits, and
// how much of each it uses.
func (srv *Server) handleWorkspaceUsage(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		writeJSON(w, http.StatusMethodNotAllowed, apiError{Error: "method not allowed"})
		return
	}
	user, ok := srv.requireActor(w, r)
	if !ok {
		return
	}
	ctx, cancel := context.WithTimeout(r.Context(), 10*time.Second)
	defer cancel()
	usage, err := srv.store.GetWorkspaceUsage(ctx, user.WorkspaceID)
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, apiError{Error: err.Error()})
		return
	}
	var resp usageResponse
	resp.Plan = user.Plan
	for _, id := range plans.IDs {
		resp.Plans = append(resp.Plans, plans.For(id))
	}
	resp.Usage.WorkspaceUsage = usage
	resp.Usage.ProbesLastHour = srv.quotaLimiter.Count(quotaKey(user.WorkspaceID, quotaProbe), time.Hour)
	resp.Usage.ScansLastHour = srv.quotaLimiter.Count(quotaKey(user.WorkspaceID, quotaScan), time.Hour)
	writeJSON(w, http.StatusOK, resp)
}

type adminPlanRequest struct {
	WorkspaceID int64  `json:"workspace_id"`
	Plan        string `json:"plan"`
}

// handleAdminWorkspacePlan lets a platform admin move a workspace to another
// plan. It stands in for the billing provider until payments exist.
func (srv *Server) handleAdminWorkspacePlan(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		writeJSON(w, http.StatusMethodNotAllowed, apiError{Error: "method not allowed"})
		return
	}
	admin, ok := srv.requirePlatformAdmin(w, r)
	if !ok {
		return
	}
	if !srv.isAllowedRequestOrigin(r) {
		writeJSON(w, http.StatusForbidden, apiError{Error: "forbidden origin"})
		return
	}
	var req adminPlanRequest
	if err := decodeJSON(w, r, &req); err != nil {
		writeJSON(w, http.StatusBadRequest, apiError{Error: err.Error()})
		return
	}
	if req.WorkspaceID <= 0 || !plans.Valid(req.Plan) {
		writeJSON(w, http.StatusBadRequest, apiError{Error: "workspace_id and a plan of free, pro, or enterprise are required"})
		return
	}
	ctx, cancel := context.WithTimeout(r.Context(), 10*time.Second)
	defer cancel()
	if err := srv.store.SetWorkspacePlan(ctx, req.WorkspaceID, req.Plan); err != nil {
		if errors.Is(err, store.ErrWorkspaceNotFound) {
			writeJSON(w, http.StatusNotFound, apiError{Error: err.Error()})
			return
		}
		writeJSON(w, http.StatusInternalServerError, apiError{Error: err.Error()})
		return
	}
	srv.recordAudit(r, req.WorkspaceID, admin, "workspace.plan_changed", idTarget("workspace", req.WorkspaceID, ""), map[string]any{"plan": req.Plan, "by": "platform admin"})
	writeJSON(w, http.StatusOK, map[string]any{"ok": true, "plan": plans.For(req.Plan)})
}
