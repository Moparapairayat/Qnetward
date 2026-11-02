package api

import (
	"context"
	"errors"
	"fmt"
	"net/http"
	"strings"
	"time"

	"qnetward/internal/plans"
	"qnetward/internal/store"
)

type workspaceInvitationRequest struct {
	Email string `json:"email"`
	Role  string `json:"role"`
}

type workspaceMemberUpdateRequest struct {
	UserID int64  `json:"user_id"`
	Role   string `json:"role"`
}

type workspaceMemberRemoveRequest struct {
	UserID       int64 `json:"user_id"`
	InvitationID int64 `json:"invitation_id,omitempty"`
}

type workspaceInvitationActionRequest struct {
	InvitationID int64  `json:"invitation_id"`
	Action       string `json:"action"`
}

type authWorkspace struct {
	ID            int64     `json:"id"`
	Name          string    `json:"name"`
	Plan          string    `json:"plan"`
	BillingStatus string    `json:"billing_status"`
	Role          string    `json:"role"`
	MemberCount   int       `json:"member_count"`
	CreatedAt     time.Time `json:"created_at"`
}

type authWorkspaceMember struct {
	UserID    int64     `json:"user_id"`
	Name      string    `json:"name"`
	Email     string    `json:"email"`
	Role      string    `json:"role"`
	JoinedAt  time.Time `json:"joined_at"`
	IsCurrent bool      `json:"is_current"`
}

type authWorkspaceInvitation struct {
	ID            int64     `json:"id"`
	WorkspaceID   int64     `json:"workspace_id"`
	WorkspaceName string    `json:"workspace_name,omitempty"`
	Email         string    `json:"email"`
	Role          string    `json:"role"`
	Status        string    `json:"status"`
	ExpiresAt     time.Time `json:"expires_at"`
	CreatedAt     time.Time `json:"created_at"`
	InviterName   string    `json:"inviter_name"`
}

func (srv *Server) handleWorkspaces(w http.ResponseWriter, r *http.Request) {
	if srv.store == nil {
		writeJSON(w, http.StatusServiceUnavailable, apiError{Error: "storage not available"})
		return
	}

	user, tokenHash, activeWorkspaceID, err := srv.currentSessionState(r)
	if err != nil {
		if errors.Is(err, store.ErrSessionNotFound) || errors.Is(err, http.ErrNoCookie) {
			writeJSON(w, http.StatusUnauthorized, apiError{Error: "authentication required"})
			return
		}
		writeJSON(w, http.StatusInternalServerError, apiError{Error: err.Error()})
		return
	}

	switch r.Method {
	case http.MethodGet:
		ctx, cancel := context.WithTimeout(r.Context(), 5*time.Second)
		defer cancel()

		workspaces, err := srv.store.ListWorkspaceContextsByUserID(ctx, user.ID)
		if err != nil {
			if errors.Is(err, store.ErrUserNotFound) {
				workspace, ensureErr := srv.store.EnsureDefaultWorkspaceForUser(ctx, user)
				if ensureErr != nil {
					writeJSON(w, http.StatusInternalServerError, apiError{Error: ensureErr.Error()})
					return
				}
				workspaces = []store.WorkspaceContext{workspace}
			} else {
				writeJSON(w, http.StatusInternalServerError, apiError{Error: err.Error()})
				return
			}
		}

		if activeWorkspaceID == 0 && len(workspaces) > 0 {
			activeWorkspaceID = workspaces[0].ID
		}
		resp := workspaceListResponse{ActiveWorkspaceID: activeWorkspaceID}
		for _, workspace := range workspaces {
			resp.Workspaces = append(resp.Workspaces, toAuthWorkspace(workspace))
		}
		writeJSON(w, http.StatusOK, resp)
	case http.MethodPost:
		if !srv.isAllowedRequestOrigin(r) {
			writeJSON(w, http.StatusForbidden, apiError{Error: "forbidden origin"})
			return
		}
		var req struct {
			WorkspaceID int64 `json:"workspace_id"`
		}
		if err := decodeJSON(w, r, &req); err != nil {
			writeJSON(w, http.StatusBadRequest, apiError{Error: err.Error()})
			return
		}
		if req.WorkspaceID <= 0 {
			writeJSON(w, http.StatusBadRequest, apiError{Error: "workspace id is required"})
			return
		}

		ctx, cancel := context.WithTimeout(r.Context(), 5*time.Second)
		defer cancel()
		if err := srv.store.SetSessionActiveWorkspace(ctx, tokenHash, user.ID, req.WorkspaceID); err != nil {
			if errors.Is(err, store.ErrWorkspaceMemberNotFound) {
				writeJSON(w, http.StatusNotFound, apiError{Error: "workspace not available for this user"})
				return
			}
			writeJSON(w, http.StatusBadRequest, apiError{Error: err.Error()})
			return
		}
		writeJSON(w, http.StatusOK, authMessageResponse{
			OK:      true,
			Message: "Active workspace updated.",
		})
	default:
		writeJSON(w, http.StatusMethodNotAllowed, apiError{Error: "method not allowed"})
	}
}

func (srv *Server) handleWorkspaceTeam(w http.ResponseWriter, r *http.Request) {
	if srv.store == nil {
		writeJSON(w, http.StatusServiceUnavailable, apiError{Error: "storage not available"})
		return
	}

	user, ok := srv.requireAuthenticatedUser(w, r)
	if !ok {
		return
	}
	_, _, activeWorkspaceID, _ := srv.currentSessionState(r)

	switch r.Method {
	case http.MethodGet:
		ctx, cancel := context.WithTimeout(r.Context(), 5*time.Second)
		defer cancel()

		workspace, err := srv.resolveActiveWorkspace(ctx, user, activeWorkspaceID)
		if err != nil {
			writeJSON(w, http.StatusInternalServerError, apiError{Error: err.Error()})
			return
		}

		members, err := srv.store.ListWorkspaceMembersByWorkspaceIDAndUserID(ctx, workspace.ID, user.ID)
		if err != nil {
			writeJSON(w, http.StatusInternalServerError, apiError{Error: err.Error()})
			return
		}
		invitations, err := srv.store.ListWorkspaceInvitationsByWorkspaceIDAndUserID(ctx, workspace.ID, user.ID)
		if err != nil {
			writeJSON(w, http.StatusInternalServerError, apiError{Error: err.Error()})
			return
		}

		writeJSON(w, http.StatusOK, workspaceTeamResponse{
			Workspace:   toAuthWorkspace(workspace),
			Members:     toAuthWorkspaceMembers(members),
			Invitations: toAuthWorkspaceInvitations(invitations),
		})
	case http.MethodPost:
		if !srv.isAllowedRequestOrigin(r) {
			writeJSON(w, http.StatusForbidden, apiError{Error: "forbidden origin"})
			return
		}
		if srv.isDemoUser(user) {
			writeJSON(w, http.StatusForbidden, apiError{Error: "demo access cannot issue workspace invitations"})
			return
		}

		var req workspaceInvitationRequest
		if err := decodeJSON(w, r, &req); err != nil {
			writeJSON(w, http.StatusBadRequest, apiError{Error: err.Error()})
			return
		}

		ctx, cancel := context.WithTimeout(r.Context(), 5*time.Second)
		defer cancel()

		workspace, err := srv.resolveActiveWorkspace(ctx, user, activeWorkspaceID)
		if err != nil {
			writeJSON(w, http.StatusInternalServerError, apiError{Error: err.Error()})
			return
		}

		// Pending invitations count toward the member limit, so a plan can't be
		// overrun by inviting more people than it allows.
		plan := plans.For(workspace.Plan)
		if usage, err := srv.store.GetWorkspaceUsage(ctx, workspace.ID); err == nil && usage.Members+usage.PendingInvitations >= plan.Limits.Members {
			writeJSON(w, http.StatusConflict, apiError{Error: fmt.Sprintf("the %s plan allows %d members, counting pending invitations", plan.Name, plan.Limits.Members)})
			return
		}

		invitation, err := srv.store.CreateWorkspaceInvitationByWorkspaceIDAndUserID(ctx, workspace.ID, user.ID, req.Email, req.Role, time.Now().Add(7*24*time.Hour))
		if err != nil {
			switch {
			case errors.Is(err, store.ErrWorkspaceInviteConflict):
				writeJSON(w, http.StatusConflict, apiError{Error: "user is already a member of this workspace"})
			case errors.Is(err, store.ErrWorkspacePermissionDenied):
				writeJSON(w, http.StatusForbidden, apiError{Error: "workspace invitation role is not allowed for this operator"})
			case errors.Is(err, store.ErrWorkspaceRoleInvalid):
				writeJSON(w, http.StatusBadRequest, apiError{Error: "workspace role must be owner, admin, member, or viewer"})
			default:
				writeJSON(w, http.StatusBadRequest, apiError{Error: err.Error()})
			}
			return
		}

		srv.recordAudit(r, workspace.ID, user, "member.invited", idTarget("invitation", invitation.ID, invitation.Email), map[string]any{"role": invitation.Role})
		writeJSON(w, http.StatusCreated, authMessageResponse{
			OK:      true,
			Message: fmt.Sprintf("Invitation queued for %s as %s.", invitation.Email, invitation.Role),
			Email:   invitation.Email,
		})
	case http.MethodPatch:
		if !srv.isAllowedRequestOrigin(r) {
			writeJSON(w, http.StatusForbidden, apiError{Error: "forbidden origin"})
			return
		}
		if srv.isDemoUser(user) {
			writeJSON(w, http.StatusForbidden, apiError{Error: "demo access cannot modify workspace members"})
			return
		}

		var req workspaceMemberUpdateRequest
		if err := decodeJSON(w, r, &req); err != nil {
			writeJSON(w, http.StatusBadRequest, apiError{Error: err.Error()})
			return
		}
		if req.UserID <= 0 {
			writeJSON(w, http.StatusBadRequest, apiError{Error: "workspace member user id is required"})
			return
		}

		ctx, cancel := context.WithTimeout(r.Context(), 5*time.Second)
		defer cancel()

		workspace, err := srv.resolveActiveWorkspace(ctx, user, activeWorkspaceID)
		if err != nil {
			writeJSON(w, http.StatusInternalServerError, apiError{Error: err.Error()})
			return
		}

		member, err := srv.store.UpdateWorkspaceMemberRoleByWorkspaceIDAndUserID(ctx, workspace.ID, user.ID, req.UserID, req.Role)
		if err != nil {
			switch {
			case errors.Is(err, store.ErrWorkspaceMemberNotFound):
				writeJSON(w, http.StatusNotFound, apiError{Error: "workspace member not found"})
			case errors.Is(err, store.ErrWorkspacePermissionDenied):
				writeJSON(w, http.StatusForbidden, apiError{Error: "workspace member update is not allowed"})
			case errors.Is(err, store.ErrWorkspaceRoleInvalid):
				writeJSON(w, http.StatusBadRequest, apiError{Error: "workspace role must be admin, member, or viewer"})
			default:
				writeJSON(w, http.StatusBadRequest, apiError{Error: err.Error()})
			}
			return
		}

		srv.recordAudit(r, workspace.ID, user, "member.role_changed", idTarget("user", member.UserID, member.Email), map[string]any{"role": member.Role})
		writeJSON(w, http.StatusOK, authMessageResponse{
			OK:      true,
			Message: fmt.Sprintf("Updated %s to %s.", member.Email, member.Role),
			Email:   member.Email,
		})
	case http.MethodDelete:
		if !srv.isAllowedRequestOrigin(r) {
			writeJSON(w, http.StatusForbidden, apiError{Error: "forbidden origin"})
			return
		}
		if srv.isDemoUser(user) {
			writeJSON(w, http.StatusForbidden, apiError{Error: "demo access cannot modify workspace members"})
			return
		}

		var req workspaceMemberRemoveRequest
		if err := decodeJSON(w, r, &req); err != nil {
			writeJSON(w, http.StatusBadRequest, apiError{Error: err.Error()})
			return
		}
		if req.UserID <= 0 && req.InvitationID <= 0 {
			writeJSON(w, http.StatusBadRequest, apiError{Error: "workspace member user id or invitation id is required"})
			return
		}

		ctx, cancel := context.WithTimeout(r.Context(), 5*time.Second)
		defer cancel()

		workspace, err := srv.resolveActiveWorkspace(ctx, user, activeWorkspaceID)
		if err != nil {
			writeJSON(w, http.StatusInternalServerError, apiError{Error: err.Error()})
			return
		}

		if req.InvitationID > 0 {
			invitation, err := srv.store.CancelWorkspaceInvitationByWorkspaceIDAndUserID(ctx, workspace.ID, user.ID, req.InvitationID)
			if err != nil {
				switch {
				case errors.Is(err, store.ErrWorkspaceInvitationNotFound):
					writeJSON(w, http.StatusNotFound, apiError{Error: "workspace invitation not found"})
				case errors.Is(err, store.ErrWorkspacePermissionDenied):
					writeJSON(w, http.StatusForbidden, apiError{Error: "workspace invitation revoke is not allowed"})
				default:
					writeJSON(w, http.StatusBadRequest, apiError{Error: err.Error()})
				}
				return
			}

			srv.recordAudit(r, workspace.ID, user, "member.invitation_revoked", idTarget("invitation", invitation.ID, invitation.Email), nil)
			writeJSON(w, http.StatusOK, authMessageResponse{
				OK:      true,
				Message: fmt.Sprintf("Revoked invitation for %s.", invitation.Email),
				Email:   invitation.Email,
			})
			return
		}

		if err := srv.store.RemoveWorkspaceMemberByWorkspaceIDAndUserID(ctx, workspace.ID, user.ID, req.UserID); err != nil {
			switch {
			case errors.Is(err, store.ErrWorkspaceMemberNotFound):
				writeJSON(w, http.StatusNotFound, apiError{Error: "workspace member not found"})
			case errors.Is(err, store.ErrWorkspacePermissionDenied):
				writeJSON(w, http.StatusForbidden, apiError{Error: "workspace member removal is not allowed"})
			default:
				writeJSON(w, http.StatusBadRequest, apiError{Error: err.Error()})
			}
			return
		}

		srv.recordAudit(r, workspace.ID, user, "member.removed", idTarget("user", req.UserID, ""), nil)
		writeJSON(w, http.StatusOK, authMessageResponse{
			OK:      true,
			Message: "Workspace member removed.",
		})
	default:
		writeJSON(w, http.StatusMethodNotAllowed, apiError{Error: "method not allowed"})
	}
}

func (srv *Server) handleWorkspaceInvitations(w http.ResponseWriter, r *http.Request) {
	if srv.store == nil {
		writeJSON(w, http.StatusServiceUnavailable, apiError{Error: "storage not available"})
		return
	}

	user, ok := srv.requireAuthenticatedUser(w, r)
	if !ok {
		return
	}

	switch r.Method {
	case http.MethodGet:
		ctx, cancel := context.WithTimeout(r.Context(), 5*time.Second)
		defer cancel()

		invitations, err := srv.store.ListIncomingWorkspaceInvitationsByEmail(ctx, user.Email)
		if err != nil {
			writeJSON(w, http.StatusInternalServerError, apiError{Error: err.Error()})
			return
		}
		writeJSON(w, http.StatusOK, workspaceInvitationsResponse{
			Invitations: toAuthWorkspaceInvitations(invitations),
		})
	case http.MethodPost:
		if !srv.isAllowedRequestOrigin(r) {
			writeJSON(w, http.StatusForbidden, apiError{Error: "forbidden origin"})
			return
		}

		var req workspaceInvitationActionRequest
		if err := decodeJSON(w, r, &req); err != nil {
			writeJSON(w, http.StatusBadRequest, apiError{Error: err.Error()})
			return
		}
		if strings.TrimSpace(strings.ToLower(req.Action)) != "accept" {
			writeJSON(w, http.StatusBadRequest, apiError{Error: "workspace invitation action must be accept"})
			return
		}
		if req.InvitationID <= 0 {
			writeJSON(w, http.StatusBadRequest, apiError{Error: "workspace invitation id is required"})
			return
		}

		ctx, cancel := context.WithTimeout(r.Context(), 5*time.Second)
		defer cancel()

		invitation, err := srv.store.AcceptWorkspaceInvitationByUserID(ctx, user.ID, req.InvitationID)
		if err != nil {
			switch {
			case errors.Is(err, store.ErrWorkspaceInvitationNotFound):
				writeJSON(w, http.StatusNotFound, apiError{Error: "workspace invitation not found"})
			case errors.Is(err, store.ErrWorkspaceInvitationExpired):
				writeJSON(w, http.StatusConflict, apiError{Error: "workspace invitation is expired"})
			default:
				writeJSON(w, http.StatusBadRequest, apiError{Error: err.Error()})
			}
			return
		}

		srv.recordAudit(r, invitation.WorkspaceID, user, "member.joined", idTarget("user", user.ID, user.Email), map[string]any{"role": invitation.Role})
		writeJSON(w, http.StatusOK, authMessageResponse{
			OK:      true,
			Message: fmt.Sprintf("Joined %s as %s.", invitation.WorkspaceName, invitation.Role),
		})
	default:
		writeJSON(w, http.StatusMethodNotAllowed, apiError{Error: "method not allowed"})
	}
}

type workspaceListResponse struct {
	ActiveWorkspaceID int64            `json:"active_workspace_id,omitempty"`
	Workspaces        []*authWorkspace `json:"workspaces,omitempty"`
}

type workspaceTeamResponse struct {
	Workspace   *authWorkspace            `json:"workspace,omitempty"`
	Members     []authWorkspaceMember     `json:"members,omitempty"`
	Invitations []authWorkspaceInvitation `json:"invitations,omitempty"`
}

type workspaceInvitationsResponse struct {
	Invitations []authWorkspaceInvitation `json:"invitations,omitempty"`
}

func toAuthWorkspace(workspace store.WorkspaceContext) *authWorkspace {
	return &authWorkspace{
		ID:            workspace.ID,
		Name:          workspace.Name,
		Plan:          workspace.Plan,
		BillingStatus: workspace.BillingStatus,
		Role:          workspace.Role,
		MemberCount:   workspace.MemberCount,
		CreatedAt:     workspace.CreatedAt,
	}
}

func toAuthWorkspaceMembers(members []store.WorkspaceMember) []authWorkspaceMember {
	resp := make([]authWorkspaceMember, 0, len(members))
	for _, member := range members {
		resp = append(resp, authWorkspaceMember{
			UserID:    member.UserID,
			Name:      member.Name,
			Email:     member.Email,
			Role:      member.Role,
			JoinedAt:  member.JoinedAt,
			IsCurrent: member.IsCurrent,
		})
	}
	return resp
}

func toAuthWorkspaceInvitations(invitations []store.WorkspaceInvitation) []authWorkspaceInvitation {
	resp := make([]authWorkspaceInvitation, 0, len(invitations))
	for _, invitation := range invitations {
		resp = append(resp, authWorkspaceInvitation{
			ID:            invitation.ID,
			WorkspaceID:   invitation.WorkspaceID,
			WorkspaceName: invitation.WorkspaceName,
			Email:         invitation.Email,
			Role:          invitation.Role,
			Status:        invitation.Status,
			ExpiresAt:     invitation.ExpiresAt,
			CreatedAt:     invitation.CreatedAt,
			InviterName:   invitation.InviterName,
		})
	}
	return resp
}
