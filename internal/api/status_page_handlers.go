package api

import (
	"context"
	"errors"
	"net/http"
	"strconv"
	"strings"
	"time"

	"qnetward/internal/store"
)

type statusPageRequest struct {
	ID          int64                     `json:"id,omitempty"`
	Slug        string                    `json:"slug"`
	Title       string                    `json:"title"`
	Description string                    `json:"description"`
	Published   bool                      `json:"published"`
	Monitors    []store.StatusPageMonitor `json:"monitors"`
}

// handleStatusPages lists, saves, and deletes the workspace's status pages.
func (srv *Server) handleStatusPages(w http.ResponseWriter, r *http.Request) {
	user, ok := srv.requireActor(w, r)
	if !ok {
		return
	}
	ctx, cancel := context.WithTimeout(r.Context(), 10*time.Second)
	defer cancel()

	switch r.Method {
	case http.MethodGet:
		pages, err := srv.store.ListStatusPages(ctx, user.WorkspaceID)
		if err == nil {
			over := overPlan(len(pages), func(i int) (int64, bool) { return pages[i].ID, pages[i].Published }, user.Plan.Limits.StatusPages)
			for i := range pages {
				pages[i].OverPlan = over[i]
			}
		}
		if err != nil {
			writeJSON(w, http.StatusInternalServerError, apiError{Error: err.Error()})
			return
		}
		writeJSON(w, http.StatusOK, map[string]any{"pages": pages, "limit": user.Plan.Limits.StatusPages})
	case http.MethodPost:
		if !srv.isAllowedRequestOrigin(r) {
			writeJSON(w, http.StatusForbidden, apiError{Error: "forbidden origin"})
			return
		}
		var req statusPageRequest
		if err := decodeJSON(w, r, &req); err != nil {
			writeJSON(w, http.StatusBadRequest, apiError{Error: err.Error()})
			return
		}
		// A public page lives on our domain; the shared demo can't put words there.
		if req.Published && srv.isDemoUser(user.User) {
			writeJSON(w, http.StatusForbidden, apiError{Error: "the shared demo account can't publish a status page"})
			return
		}
		saved, err := srv.store.SaveStatusPage(ctx, store.StatusPage{
			ID: req.ID, WorkspaceID: user.WorkspaceID, Slug: req.Slug, Title: req.Title, Description: req.Description, Published: req.Published, Monitors: req.Monitors,
		}, user.Plan.Limits.StatusPages)
		if err != nil {
			switch {
			case errors.Is(err, store.ErrStatusPageNotFound):
				writeJSON(w, http.StatusNotFound, apiError{Error: err.Error()})
			case errors.Is(err, store.ErrStatusPageSlugTaken), errors.Is(err, store.ErrStatusPageLimit):
				writeJSON(w, http.StatusConflict, apiError{Error: err.Error()})
			default:
				writeJSON(w, http.StatusBadRequest, apiError{Error: err.Error()})
			}
			return
		}
		status, action := http.StatusOK, "status_page.updated"
		if req.ID == 0 {
			status, action = http.StatusCreated, "status_page.created"
		}
		srv.recordAudit(r, user.WorkspaceID, user.User, action, idTarget("status_page", saved.ID, saved.Title),
			map[string]any{"slug": saved.Slug, "published": saved.Published, "monitors": len(saved.Monitors)})
		writeJSON(w, status, saved)
	case http.MethodDelete:
		if !srv.isAllowedRequestOrigin(r) {
			writeJSON(w, http.StatusForbidden, apiError{Error: "forbidden origin"})
			return
		}
		id, err := strconv.ParseInt(strings.TrimSpace(r.URL.Query().Get("id")), 10, 64)
		if err != nil || id <= 0 {
			writeJSON(w, http.StatusBadRequest, apiError{Error: "valid status page id is required"})
			return
		}
		deleted, err := srv.store.DeleteStatusPage(ctx, user.WorkspaceID, id)
		if err != nil {
			if errors.Is(err, store.ErrStatusPageNotFound) {
				writeJSON(w, http.StatusNotFound, apiError{Error: err.Error()})
				return
			}
			writeJSON(w, http.StatusInternalServerError, apiError{Error: err.Error()})
			return
		}
		srv.recordAudit(r, user.WorkspaceID, user.User, "status_page.deleted", idTarget("status_page", deleted.ID, deleted.Title), map[string]any{"slug": deleted.Slug})
		writeJSON(w, http.StatusOK, map[string]any{"ok": true, "id": id})
	default:
		writeJSON(w, http.StatusMethodNotAllowed, apiError{Error: "method not allowed"})
	}
}

// overallStatus sums a page up the way a visitor reads it.
func overallStatus(components []store.PublicComponent) string {
	up, down, known := 0, 0, 0
	for _, c := range components {
		switch c.Status {
		case "up":
			up++
			known++
		case "down":
			down++
			known++
		}
	}
	switch {
	case known == 0:
		return "unknown"
	case down == 0:
		return "operational"
	case up == 0:
		return "outage"
	default:
		return "degraded"
	}
}

// handlePublicStatusPage serves a published page to anyone, without a session.
func (srv *Server) handlePublicStatusPage(w http.ResponseWriter, r *http.Request) {
	if srv.store == nil {
		writeJSON(w, http.StatusServiceUnavailable, apiError{Error: "storage not available"})
		return
	}
	ctx, cancel := context.WithTimeout(r.Context(), 10*time.Second)
	defer cancel()
	page, err := srv.store.GetPublicStatusPage(ctx, r.PathValue("slug"))
	if err != nil {
		if errors.Is(err, store.ErrStatusPageNotFound) {
			writeJSON(w, http.StatusNotFound, apiError{Error: "status page not found"})
			return
		}
		writeJSON(w, http.StatusInternalServerError, apiError{Error: "couldn't load the status page"})
		return
	}
	w.Header().Set("Cache-Control", "public, max-age=30")
	writeJSON(w, http.StatusOK, map[string]any{
		"page":    page,
		"status":  overallStatus(page.Components),
		"days":    store.StatusPageDays,
		"version": 1,
	})
}
