package api

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"
)

func TestHandleAuthAccountContextReturnsWorkspace(t *testing.T) {
	st := installTestStore(t)
	user, cookie := issueTestSession(t, st)

	req := httptest.NewRequest(http.MethodGet, "/api/auth/account-context", nil)
	req.AddCookie(cookie)
	rr := httptest.NewRecorder()

	testSrv.handleAuthAccountContext(rr, req)

	if rr.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d: %s", rr.Code, rr.Body.String())
	}

	var resp authWorkspaceContextResponse
	if err := json.Unmarshal(rr.Body.Bytes(), &resp); err != nil {
		t.Fatalf("decode account context response: %v", err)
	}
	if resp.Workspace == nil {
		t.Fatal("expected workspace context")
	}
	if resp.Workspace.Role != "owner" {
		t.Fatalf("expected owner role, got %q", resp.Workspace.Role)
	}
	if resp.Workspace.MemberCount != 1 {
		t.Fatalf("expected member count 1, got %d", resp.Workspace.MemberCount)
	}
	if !strings.Contains(resp.Workspace.Name, user.Name) {
		t.Fatalf("expected workspace name to include user name, got %q", resp.Workspace.Name)
	}
}

func TestHandleWorkspaceTeamReturnsMembersAndInvitations(t *testing.T) {
	st := installTestStore(t)
	user, cookie := issueTestSession(t, st)

	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()
	if _, err := st.CreateWorkspaceInvitationByUserID(ctx, user.ID, fmt.Sprintf("invite-%d@example.com", time.Now().UnixNano()), "member", time.Now().Add(72*time.Hour)); err != nil {
		t.Fatalf("CreateWorkspaceInvitationByUserID returned error: %v", err)
	}

	req := httptest.NewRequest(http.MethodGet, "/api/workspace/team", nil)
	req.AddCookie(cookie)
	rr := httptest.NewRecorder()

	testSrv.handleWorkspaceTeam(rr, req)

	if rr.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d: %s", rr.Code, rr.Body.String())
	}

	var resp workspaceTeamResponse
	if err := json.Unmarshal(rr.Body.Bytes(), &resp); err != nil {
		t.Fatalf("decode workspace team response: %v", err)
	}
	if resp.Workspace == nil {
		t.Fatal("expected workspace payload")
	}
	if len(resp.Members) != 1 {
		t.Fatalf("expected one workspace member, got %d", len(resp.Members))
	}
	if len(resp.Invitations) != 1 {
		t.Fatalf("expected one invitation, got %d", len(resp.Invitations))
	}
}

func TestHandleWorkspaceTeamCreatesInvitation(t *testing.T) {
	st := installTestStore(t)
	user, cookie := issueTestSession(t, st)

	req := httptest.NewRequest(http.MethodPost, "/api/workspace/team", strings.NewReader(fmt.Sprintf(`{"email":"team-%d@example.com","role":"admin"}`, time.Now().UnixNano())))
	req.Header.Set("Content-Type", "application/json")
	req.AddCookie(cookie)
	rr := httptest.NewRecorder()

	testSrv.handleWorkspaceTeam(rr, req)

	if rr.Code != http.StatusCreated {
		t.Fatalf("expected 201, got %d: %s", rr.Code, rr.Body.String())
	}

	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()
	invitations, err := st.ListWorkspaceInvitationsByUserID(ctx, user.ID)
	if err != nil {
		t.Fatalf("ListWorkspaceInvitationsByUserID returned error: %v", err)
	}
	if len(invitations) != 1 {
		t.Fatalf("expected one invitation, got %d", len(invitations))
	}
	if invitations[0].Role != "admin" {
		t.Fatalf("expected admin role invite, got %q", invitations[0].Role)
	}
}

func TestHandleWorkspaceTeamUpdatesMemberRole(t *testing.T) {
	st := installTestStore(t)
	owner, cookie := issueTestSession(t, st)

	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()
	memberEmail := fmt.Sprintf("member-update-%d@example.com", time.Now().UnixNano())
	member, err := st.CreateUser(ctx, "Update Member", memberEmail, "hash-member", false)
	if err != nil {
		t.Fatalf("CreateUser member returned error: %v", err)
	}
	invitation, err := st.CreateWorkspaceInvitationByUserID(ctx, owner.ID, member.Email, "member", time.Now().Add(72*time.Hour))
	if err != nil {
		t.Fatalf("CreateWorkspaceInvitationByUserID returned error: %v", err)
	}
	if _, err := st.AcceptWorkspaceInvitationByUserID(ctx, member.ID, invitation.ID); err != nil {
		t.Fatalf("AcceptWorkspaceInvitationByUserID returned error: %v", err)
	}

	req := httptest.NewRequest(http.MethodPatch, "/api/workspace/team", strings.NewReader(fmt.Sprintf(`{"user_id":%d,"role":"admin"}`, member.ID)))
	req.Header.Set("Content-Type", "application/json")
	req.AddCookie(cookie)
	rr := httptest.NewRecorder()

	testSrv.handleWorkspaceTeam(rr, req)

	if rr.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d: %s", rr.Code, rr.Body.String())
	}

	members, err := st.ListWorkspaceMembersByUserID(ctx, owner.ID)
	if err != nil {
		t.Fatalf("ListWorkspaceMembersByUserID returned error: %v", err)
	}
	if len(members) != 2 || members[1].Role != "admin" {
		t.Fatalf("expected second member to be admin, got %#v", members)
	}
}

func TestHandleWorkspaceTeamRemovesMember(t *testing.T) {
	st := installTestStore(t)
	owner, cookie := issueTestSession(t, st)

	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()
	memberEmail := fmt.Sprintf("member-remove-%d@example.com", time.Now().UnixNano())
	member, err := st.CreateUser(ctx, "Remove Member", memberEmail, "hash-member", false)
	if err != nil {
		t.Fatalf("CreateUser member returned error: %v", err)
	}
	invitation, err := st.CreateWorkspaceInvitationByUserID(ctx, owner.ID, member.Email, "member", time.Now().Add(72*time.Hour))
	if err != nil {
		t.Fatalf("CreateWorkspaceInvitationByUserID returned error: %v", err)
	}
	if _, err := st.AcceptWorkspaceInvitationByUserID(ctx, member.ID, invitation.ID); err != nil {
		t.Fatalf("AcceptWorkspaceInvitationByUserID returned error: %v", err)
	}

	req := httptest.NewRequest(http.MethodDelete, "/api/workspace/team", strings.NewReader(fmt.Sprintf(`{"user_id":%d}`, member.ID)))
	req.Header.Set("Content-Type", "application/json")
	req.AddCookie(cookie)
	rr := httptest.NewRecorder()

	testSrv.handleWorkspaceTeam(rr, req)

	if rr.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d: %s", rr.Code, rr.Body.String())
	}

	members, err := st.ListWorkspaceMembersByUserID(ctx, owner.ID)
	if err != nil {
		t.Fatalf("ListWorkspaceMembersByUserID returned error: %v", err)
	}
	if len(members) != 1 {
		t.Fatalf("expected one member after delete, got %d", len(members))
	}
}

func TestHandleWorkspaceInvitationsReturnsIncomingInvites(t *testing.T) {
	st := installTestStore(t)
	invitee, cookie := issueTestSession(t, st)

	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()
	ownerEmail := fmt.Sprintf("owner-%d@example.com", time.Now().UnixNano())
	owner, err := st.CreateUser(ctx, "Owner Operator", ownerEmail, "hash-owner", false)
	if err != nil {
		t.Fatalf("CreateUser owner returned error: %v", err)
	}
	if _, err := st.CreateWorkspaceInvitationByUserID(ctx, owner.ID, invitee.Email, "viewer", time.Now().Add(72*time.Hour)); err != nil {
		t.Fatalf("CreateWorkspaceInvitationByUserID returned error: %v", err)
	}

	req := httptest.NewRequest(http.MethodGet, "/api/workspace/invitations", nil)
	req.AddCookie(cookie)
	rr := httptest.NewRecorder()

	testSrv.handleWorkspaceInvitations(rr, req)

	if rr.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d: %s", rr.Code, rr.Body.String())
	}

	var resp workspaceInvitationsResponse
	if err := json.Unmarshal(rr.Body.Bytes(), &resp); err != nil {
		t.Fatalf("decode workspace invitations response: %v", err)
	}
	if len(resp.Invitations) != 1 {
		t.Fatalf("expected one incoming invitation, got %d", len(resp.Invitations))
	}
	if resp.Invitations[0].WorkspaceName == "" {
		t.Fatal("expected workspace name on incoming invitation")
	}
}

func TestHandleWorkspaceInvitationsAcceptsInvite(t *testing.T) {
	st := installTestStore(t)
	invitee, cookie := issueTestSession(t, st)

	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()
	ownerEmail := fmt.Sprintf("owner-accept-%d@example.com", time.Now().UnixNano())
	owner, err := st.CreateUser(ctx, "Owner Accept", ownerEmail, "hash-owner", false)
	if err != nil {
		t.Fatalf("CreateUser owner returned error: %v", err)
	}
	invitation, err := st.CreateWorkspaceInvitationByUserID(ctx, owner.ID, invitee.Email, "viewer", time.Now().Add(72*time.Hour))
	if err != nil {
		t.Fatalf("CreateWorkspaceInvitationByUserID returned error: %v", err)
	}

	req := httptest.NewRequest(http.MethodPost, "/api/workspace/invitations", strings.NewReader(fmt.Sprintf(`{"invitation_id":%d,"action":"accept"}`, invitation.ID)))
	req.Header.Set("Content-Type", "application/json")
	req.AddCookie(cookie)
	rr := httptest.NewRecorder()

	testSrv.handleWorkspaceInvitations(rr, req)

	if rr.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d: %s", rr.Code, rr.Body.String())
	}

	members, err := st.ListWorkspaceMembersByUserID(ctx, owner.ID)
	if err != nil {
		t.Fatalf("ListWorkspaceMembersByUserID returned error: %v", err)
	}
	if len(members) != 2 {
		t.Fatalf("expected 2 members after accept, got %d", len(members))
	}
}

func TestHandleWorkspacesListsAndSwitchesActiveWorkspace(t *testing.T) {
	st := installTestStore(t)
	user, cookie := issueTestSession(t, st)

	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()
	ownerEmail := fmt.Sprintf("workspace-switch-owner-%d@example.com", time.Now().UnixNano())
	owner, err := st.CreateUser(ctx, "Switch Owner", ownerEmail, "hash-owner", false)
	if err != nil {
		t.Fatalf("CreateUser owner returned error: %v", err)
	}
	invitation, err := st.CreateWorkspaceInvitationByUserID(ctx, owner.ID, user.Email, "member", time.Now().Add(72*time.Hour))
	if err != nil {
		t.Fatalf("CreateWorkspaceInvitationByUserID returned error: %v", err)
	}
	if _, err := st.AcceptWorkspaceInvitationByUserID(ctx, user.ID, invitation.ID); err != nil {
		t.Fatalf("AcceptWorkspaceInvitationByUserID returned error: %v", err)
	}

	getReq := httptest.NewRequest(http.MethodGet, "/api/workspaces", nil)
	getReq.AddCookie(cookie)
	getRR := httptest.NewRecorder()
	testSrv.handleWorkspaces(getRR, getReq)

	if getRR.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d: %s", getRR.Code, getRR.Body.String())
	}

	var listResp workspaceListResponse
	if err := json.Unmarshal(getRR.Body.Bytes(), &listResp); err != nil {
		t.Fatalf("decode workspace list response: %v", err)
	}
	if len(listResp.Workspaces) != 2 {
		t.Fatalf("expected 2 workspaces, got %d", len(listResp.Workspaces))
	}

	targetWorkspaceID := listResp.Workspaces[1].ID
	switchReq := httptest.NewRequest(http.MethodPost, "/api/workspaces", strings.NewReader(fmt.Sprintf(`{"workspace_id":%d}`, targetWorkspaceID)))
	switchReq.Header.Set("Content-Type", "application/json")
	switchReq.AddCookie(cookie)
	switchRR := httptest.NewRecorder()
	testSrv.handleWorkspaces(switchRR, switchReq)

	if switchRR.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d: %s", switchRR.Code, switchRR.Body.String())
	}

	sessionReq := httptest.NewRequest(http.MethodGet, "/api/auth/session", nil)
	sessionReq.AddCookie(cookie)
	sessionRR := httptest.NewRecorder()
	testSrv.handleAuthSession(sessionRR, sessionReq)

	var sessionResp authSessionResponse
	if err := json.Unmarshal(sessionRR.Body.Bytes(), &sessionResp); err != nil {
		t.Fatalf("decode session response: %v", err)
	}
	if sessionResp.ActiveWorkspaceID != targetWorkspaceID {
		t.Fatalf("expected active workspace id %d, got %d", targetWorkspaceID, sessionResp.ActiveWorkspaceID)
	}
}

func TestHandleWorkspaceTeamRevokesInvitation(t *testing.T) {
	st := installTestStore(t)
	owner, cookie := issueTestSession(t, st)

	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()
	invitation, err := st.CreateWorkspaceInvitationByUserID(ctx, owner.ID, fmt.Sprintf("revoke-handler-%d@example.com", time.Now().UnixNano()), "viewer", time.Now().Add(72*time.Hour))
	if err != nil {
		t.Fatalf("CreateWorkspaceInvitationByUserID returned error: %v", err)
	}

	req := httptest.NewRequest(http.MethodDelete, "/api/workspace/team", strings.NewReader(fmt.Sprintf(`{"invitation_id":%d}`, invitation.ID)))
	req.Header.Set("Content-Type", "application/json")
	req.AddCookie(cookie)
	rr := httptest.NewRecorder()

	testSrv.handleWorkspaceTeam(rr, req)

	if rr.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d: %s", rr.Code, rr.Body.String())
	}

	invitations, err := st.ListWorkspaceInvitationsByUserID(ctx, owner.ID)
	if err != nil {
		t.Fatalf("ListWorkspaceInvitationsByUserID returned error: %v", err)
	}
	if len(invitations) != 1 {
		t.Fatalf("expected 1 invitation, got %d", len(invitations))
	}
	if invitations[0].Status != "revoked" {
		t.Fatalf("expected revoked invitation, got %q", invitations[0].Status)
	}
}

// Owners rename the workspace through /api/workspace; blank names are refused
// and the change is audited.
func TestWorkspaceRename(t *testing.T) {
	st := installTestStore(t)
	_, cookie := issueTestSession(t, st)

	patch := func(body string) *httptest.ResponseRecorder {
		req := httptest.NewRequest(http.MethodPatch, "/api/workspace", strings.NewReader(body))
		req.Header.Set("Content-Type", "application/json")
		req.AddCookie(cookie)
		rr := httptest.NewRecorder()
		testSrv.handleWorkspaceGeneral(rr, req)
		return rr
	}
	if rr := patch(`{"name":"   "}`); rr.Code != http.StatusBadRequest {
		t.Fatalf("blank name: expected 400, got %d", rr.Code)
	}
	rr := patch(`{"name":"  Kestrel   Labs "}`)
	if rr.Code != http.StatusOK {
		t.Fatalf("rename: expected 200, got %d: %s", rr.Code, rr.Body.String())
	}
	var resp struct {
		Workspace struct {
			Name string `json:"name"`
		} `json:"workspace"`
	}
	_ = json.Unmarshal(rr.Body.Bytes(), &resp)
	if resp.Workspace.Name != "Kestrel Labs" {
		t.Fatalf("expected the tidied name, got %q", resp.Workspace.Name)
	}

	req := httptest.NewRequest(http.MethodGet, "/api/workspace", nil)
	req.AddCookie(cookie)
	get := httptest.NewRecorder()
	testSrv.handleWorkspaceGeneral(get, req)
	if !strings.Contains(get.Body.String(), "Kestrel Labs") {
		t.Fatalf("expected the new name on read, got %s", get.Body.String())
	}
}
