package api

import (
	"context"
	"net/http"
	"qnetward/internal/platform/mailer"
	"strconv"
	"strings"
	"time"

	"qnetward/internal/store"
)

type authAdminUser struct {
	ID                  int64      `json:"id"`
	Name                string     `json:"name"`
	Email               string     `json:"email"`
	EmailVerifiedAt     *time.Time `json:"email_verified_at,omitempty"`
	CreatedAt           time.Time  `json:"created_at"`
	OwnedWorkspaceCount int        `json:"owned_workspace_count"`
	WorkspaceCount      int        `json:"workspace_count"`
	ActiveSessionCount  int        `json:"active_session_count"`
	PlatformRole        string     `json:"platform_role"`
}

type authAdminWorkspace struct {
	ID                     int64     `json:"id"`
	Name                   string    `json:"name"`
	Plan                   string    `json:"plan"`
	BillingStatus          string    `json:"billing_status"`
	CreatedAt              time.Time `json:"created_at"`
	OwnerUserID            int64     `json:"owner_user_id"`
	OwnerName              string    `json:"owner_name"`
	OwnerEmail             string    `json:"owner_email"`
	MemberCount            int       `json:"member_count"`
	PendingInvitationCount int       `json:"pending_invitation_count"`
	ActiveSessionCount     int       `json:"active_session_count"`
}

type authAdminSystemRuntime struct {
	DatabaseDriver string `json:"database_driver,omitempty"`
	RedisEnabled   bool   `json:"redis_enabled"`
	ObjectStorage  bool   `json:"object_storage_enabled"`
	EmailDelivery  bool   `json:"email_delivery_enabled"`
	// EmailHealth is the latest outcome of sending, so a misconfigured sender
	// (an unverified domain, say) shows here instead of only in the logs.
	EmailHealth mailer.Health `json:"email_health"`
}

type authAdminSystemFeatures struct {
	PublicBaseURL    string `json:"public_base_url,omitempty"`
	DemoEnabled      bool   `json:"demo_enabled"`
	SessionTTLHours  int    `json:"session_ttl_hours"`
	ConfiguredAdmins int    `json:"configured_admins"`
}

type authAdminSystemResponse struct {
	Overview store.AdminOverview     `json:"overview"`
	Runtime  authAdminSystemRuntime  `json:"runtime"`
	Features authAdminSystemFeatures `json:"features"`
}

func (srv *Server) handleAdminOverview(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		writeJSON(w, http.StatusMethodNotAllowed, apiError{Error: "method not allowed"})
		return
	}
	if srv.store == nil {
		writeJSON(w, http.StatusServiceUnavailable, apiError{Error: "storage not available"})
		return
	}
	if _, ok := srv.requirePlatformAdmin(w, r); !ok {
		return
	}

	ctx, cancel := context.WithTimeout(r.Context(), 5*time.Second)
	defer cancel()

	overview, err := srv.store.GetAdminOverview(ctx)
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, apiError{Error: err.Error()})
		return
	}
	writeJSON(w, http.StatusOK, overview)
}

func (srv *Server) handleAdminUsers(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		writeJSON(w, http.StatusMethodNotAllowed, apiError{Error: "method not allowed"})
		return
	}
	if srv.store == nil {
		writeJSON(w, http.StatusServiceUnavailable, apiError{Error: "storage not available"})
		return
	}
	if _, ok := srv.requirePlatformAdmin(w, r); !ok {
		return
	}

	limit := parseAdminListLimit(r.URL.Query().Get("limit"))
	ctx, cancel := context.WithTimeout(r.Context(), 5*time.Second)
	defer cancel()

	users, err := srv.store.ListAdminUsers(ctx, limit)
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, apiError{Error: err.Error()})
		return
	}
	writeJSON(w, http.StatusOK, adminUsersResponse{
		Users: srv.toAuthAdminUsers(users),
	})
}

func (srv *Server) handleAdminWorkspaces(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		writeJSON(w, http.StatusMethodNotAllowed, apiError{Error: "method not allowed"})
		return
	}
	if srv.store == nil {
		writeJSON(w, http.StatusServiceUnavailable, apiError{Error: "storage not available"})
		return
	}
	if _, ok := srv.requirePlatformAdmin(w, r); !ok {
		return
	}

	limit := parseAdminListLimit(r.URL.Query().Get("limit"))
	ctx, cancel := context.WithTimeout(r.Context(), 5*time.Second)
	defer cancel()

	workspaces, err := srv.store.ListAdminWorkspaces(ctx, limit)
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, apiError{Error: err.Error()})
		return
	}
	writeJSON(w, http.StatusOK, adminWorkspacesResponse{
		Workspaces: toAuthAdminWorkspaces(workspaces),
	})
}

func (srv *Server) handleAdminSystem(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		writeJSON(w, http.StatusMethodNotAllowed, apiError{Error: "method not allowed"})
		return
	}
	if srv.store == nil {
		writeJSON(w, http.StatusServiceUnavailable, apiError{Error: "storage not available"})
		return
	}
	if _, ok := srv.requirePlatformAdmin(w, r); !ok {
		return
	}

	ctx, cancel := context.WithTimeout(r.Context(), 5*time.Second)
	defer cancel()

	overview, err := srv.store.GetAdminOverview(ctx)
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, apiError{Error: err.Error()})
		return
	}

	writeJSON(w, http.StatusOK, authAdminSystemResponse{
		Overview: overview,
		Runtime: authAdminSystemRuntime{
			DatabaseDriver: srv.store.Driver(),
			RedisEnabled:   srv.cache != nil,
			ObjectStorage:  srv.objects != nil,
			EmailDelivery:  srv.mailer != nil,
			EmailHealth:    srv.mailer.Health(),
		},
		Features: authAdminSystemFeatures{
			PublicBaseURL:    srv.publicBaseURL,
			DemoEnabled:      srv.demoEnabled,
			SessionTTLHours:  int(defaultSessionTTL / time.Hour),
			ConfiguredAdmins: len(srv.adminEmails),
		},
	})
}

func parseAdminListLimit(raw string) int {
	raw = strings.TrimSpace(raw)
	if raw == "" {
		return 50
	}
	limit, err := strconv.Atoi(raw)
	if err != nil || limit <= 0 {
		return 50
	}
	if limit > 200 {
		return 200
	}
	return limit
}

type adminUsersResponse struct {
	Users []authAdminUser `json:"users,omitempty"`
}

type adminWorkspacesResponse struct {
	Workspaces []authAdminWorkspace `json:"workspaces,omitempty"`
}

func (srv *Server) toAuthAdminUsers(users []store.AdminUserSummary) []authAdminUser {
	resp := make([]authAdminUser, 0, len(users))
	for _, user := range users {
		resp = append(resp, authAdminUser{
			ID:                  user.ID,
			Name:                user.Name,
			Email:               user.Email,
			EmailVerifiedAt:     user.EmailVerifiedAt,
			CreatedAt:           user.CreatedAt,
			OwnedWorkspaceCount: user.OwnedWorkspaceCount,
			WorkspaceCount:      user.WorkspaceCount,
			ActiveSessionCount:  user.ActiveSessionCount,
			PlatformRole:        srv.platformRoleForUser(store.User{Email: user.Email}),
		})
	}
	return resp
}

func toAuthAdminWorkspaces(workspaces []store.AdminWorkspaceSummary) []authAdminWorkspace {
	resp := make([]authAdminWorkspace, 0, len(workspaces))
	for _, workspace := range workspaces {
		resp = append(resp, authAdminWorkspace{
			ID:                     workspace.ID,
			Name:                   workspace.Name,
			Plan:                   workspace.Plan,
			BillingStatus:          workspace.BillingStatus,
			CreatedAt:              workspace.CreatedAt,
			OwnerUserID:            workspace.OwnerUserID,
			OwnerName:              workspace.OwnerName,
			OwnerEmail:             workspace.OwnerEmail,
			MemberCount:            workspace.MemberCount,
			PendingInvitationCount: workspace.PendingInvitationCount,
			ActiveSessionCount:     workspace.ActiveSessionCount,
		})
	}
	return resp
}
