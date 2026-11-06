package store

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"strings"
	"time"
)

type WorkspaceContext struct {
	ID            int64     `json:"id"`
	Name          string    `json:"name"`
	Plan          string    `json:"plan"`
	BillingStatus string    `json:"billing_status"`
	Role          string    `json:"role"`
	MemberCount   int       `json:"member_count"`
	CreatedAt     time.Time `json:"created_at"`
}

type WorkspaceMember struct {
	UserID    int64     `json:"user_id"`
	Name      string    `json:"name"`
	Email     string    `json:"email"`
	Role      string    `json:"role"`
	JoinedAt  time.Time `json:"joined_at"`
	IsCurrent bool      `json:"is_current"`
	// AvatarKey locates the member's picture; the API turns it into avatar_url.
	AvatarKey string `json:"-"`
	AvatarURL string `json:"avatar_url,omitempty"`
}

type WorkspaceInvitation struct {
	ID            int64     `json:"id"`
	WorkspaceID   int64     `json:"workspace_id"`
	WorkspaceName string    `json:"workspace_name"`
	Email         string    `json:"email"`
	Role          string    `json:"role"`
	Status        string    `json:"status"`
	ExpiresAt     time.Time `json:"expires_at"`
	CreatedAt     time.Time `json:"created_at"`
	InviterName   string    `json:"inviter_name"`
}

var (
	ErrWorkspaceInviteConflict     = errors.New("workspace invitation already exists")
	ErrWorkspaceRoleInvalid        = errors.New("workspace role is invalid")
	ErrWorkspaceInvitationNotFound = errors.New("workspace invitation not found")
	ErrWorkspaceInvitationExpired  = errors.New("workspace invitation is expired")
	ErrWorkspaceMemberNotFound     = errors.New("workspace member not found")
	ErrWorkspacePermissionDenied   = errors.New("workspace permission denied")
)

func (s *Store) EnsureDefaultWorkspaceForUser(ctx context.Context, user User) (WorkspaceContext, error) {
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return WorkspaceContext{}, err
	}
	defer func() {
		_ = tx.Rollback()
	}()

	workspace, err := ensureDefaultWorkspaceTx(ctx, tx, user)
	if err != nil {
		return WorkspaceContext{}, err
	}
	return workspace, tx.Commit()
}

func (s *Store) GetWorkspaceContextByUserID(ctx context.Context, userID int64) (WorkspaceContext, error) {
	var workspace WorkspaceContext
	err := s.db.QueryRowContext(ctx, `
		SELECT
			w.id,
			w.name,
			w.plan,
			w.billing_status,
			wm.role,
			(
				SELECT COUNT(*)
				FROM workspace_members member_count
				WHERE member_count.workspace_id = w.id
			) AS member_count,
			w.created_at
		FROM workspace_members wm
		INNER JOIN workspaces w ON w.id = wm.workspace_id
		WHERE wm.user_id = $1
		ORDER BY
			CASE WHEN wm.role = 'owner' THEN 0 ELSE 1 END,
			w.created_at ASC
		LIMIT 1
	`, userID).Scan(
		&workspace.ID,
		&workspace.Name,
		&workspace.Plan,
		&workspace.BillingStatus,
		&workspace.Role,
		&workspace.MemberCount,
		&workspace.CreatedAt,
	)
	if errors.Is(err, sql.ErrNoRows) {
		return WorkspaceContext{}, ErrUserNotFound
	}
	if err != nil {
		return WorkspaceContext{}, err
	}
	return workspace, nil
}

func (s *Store) ListWorkspaceContextsByUserID(ctx context.Context, userID int64) ([]WorkspaceContext, error) {
	rows, err := s.db.QueryContext(ctx, `
		SELECT
			w.id,
			w.name,
			w.plan,
			w.billing_status,
			wm.role,
			(
				SELECT COUNT(*)
				FROM workspace_members member_count
				WHERE member_count.workspace_id = w.id
			) AS member_count,
			w.created_at
		FROM workspace_members wm
		INNER JOIN workspaces w ON w.id = wm.workspace_id
		WHERE wm.user_id = $1
		ORDER BY
			CASE WHEN wm.role = 'owner' THEN 0 ELSE 1 END,
			w.created_at ASC
	`, userID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var workspaces []WorkspaceContext
	for rows.Next() {
		var workspace WorkspaceContext
		if err := rows.Scan(
			&workspace.ID,
			&workspace.Name,
			&workspace.Plan,
			&workspace.BillingStatus,
			&workspace.Role,
			&workspace.MemberCount,
			&workspace.CreatedAt,
		); err != nil {
			return nil, err
		}
		workspaces = append(workspaces, workspace)
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	if len(workspaces) == 0 {
		return nil, ErrUserNotFound
	}
	return workspaces, nil
}

func (s *Store) GetWorkspaceContextByWorkspaceIDAndUserID(ctx context.Context, workspaceID, userID int64) (WorkspaceContext, error) {
	var workspace WorkspaceContext
	err := s.db.QueryRowContext(ctx, `
		SELECT
			w.id,
			w.name,
			w.plan,
			w.billing_status,
			wm.role,
			(
				SELECT COUNT(*)
				FROM workspace_members member_count
				WHERE member_count.workspace_id = w.id
			) AS member_count,
			w.created_at
		FROM workspace_members wm
		INNER JOIN workspaces w ON w.id = wm.workspace_id
		WHERE wm.user_id = $1 AND wm.workspace_id = $2
	`, userID, workspaceID).Scan(
		&workspace.ID,
		&workspace.Name,
		&workspace.Plan,
		&workspace.BillingStatus,
		&workspace.Role,
		&workspace.MemberCount,
		&workspace.CreatedAt,
	)
	if errors.Is(err, sql.ErrNoRows) {
		return WorkspaceContext{}, ErrWorkspaceMemberNotFound
	}
	if err != nil {
		return WorkspaceContext{}, err
	}
	return workspace, nil
}

func (s *Store) ListWorkspaceMembersByUserID(ctx context.Context, userID int64) ([]WorkspaceMember, error) {
	workspace, err := s.GetWorkspaceContextByUserID(ctx, userID)
	if err != nil {
		return nil, err
	}
	return s.ListWorkspaceMembersByWorkspaceIDAndUserID(ctx, workspace.ID, userID)
}

func (s *Store) ListWorkspaceMembersByWorkspaceIDAndUserID(ctx context.Context, workspaceID, userID int64) ([]WorkspaceMember, error) {
	if _, err := s.GetWorkspaceContextByWorkspaceIDAndUserID(ctx, workspaceID, userID); err != nil {
		return nil, err
	}
	rows, err := s.db.QueryContext(ctx, `
		SELECT
			u.id,
			u.name,
			u.email,
			wm.role,
			wm.created_at,
			COALESCE(p.avatar_key, '')
		FROM workspace_members wm
		INNER JOIN users u ON u.id = wm.user_id
		LEFT JOIN user_profiles p ON p.user_id = u.id
		WHERE wm.workspace_id = $1
		ORDER BY
			CASE WHEN wm.role = 'owner' THEN 0 WHEN wm.role = 'admin' THEN 1 ELSE 2 END,
			wm.created_at ASC,
			u.id ASC
	`, workspaceID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var members []WorkspaceMember
	for rows.Next() {
		var member WorkspaceMember
		if err := rows.Scan(&member.UserID, &member.Name, &member.Email, &member.Role, &member.JoinedAt, &member.AvatarKey); err != nil {
			return nil, err
		}
		member.IsCurrent = member.UserID == userID
		members = append(members, member)
	}
	return members, rows.Err()
}

func (s *Store) ListWorkspaceInvitationsByUserID(ctx context.Context, userID int64) ([]WorkspaceInvitation, error) {
	workspace, err := s.GetWorkspaceContextByUserID(ctx, userID)
	if err != nil {
		return nil, err
	}
	return s.ListWorkspaceInvitationsByWorkspaceIDAndUserID(ctx, workspace.ID, userID)
}

func (s *Store) ListWorkspaceInvitationsByWorkspaceIDAndUserID(ctx context.Context, workspaceID, userID int64) ([]WorkspaceInvitation, error) {
	if _, err := s.GetWorkspaceContextByWorkspaceIDAndUserID(ctx, workspaceID, userID); err != nil {
		return nil, err
	}
	rows, err := s.db.QueryContext(ctx, `
		SELECT
			wi.id,
			wi.workspace_id,
			w.name,
			wi.email,
			wi.role,
			wi.status,
			wi.expires_at,
			wi.created_at,
			COALESCE(inviter.name, inviter.email, 'Workspace Owner')
		FROM workspace_invitations wi
		INNER JOIN workspaces w ON w.id = wi.workspace_id
		LEFT JOIN users inviter ON inviter.id = wi.inviter_user_id
		WHERE wi.workspace_id = $1
		ORDER BY wi.created_at DESC
	`, workspaceID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var invitations []WorkspaceInvitation
	for rows.Next() {
		var invitation WorkspaceInvitation
		if err := rows.Scan(
			&invitation.ID,
			&invitation.WorkspaceID,
			&invitation.WorkspaceName,
			&invitation.Email,
			&invitation.Role,
			&invitation.Status,
			&invitation.ExpiresAt,
			&invitation.CreatedAt,
			&invitation.InviterName,
		); err != nil {
			return nil, err
		}
		invitations = append(invitations, invitation)
	}
	return invitations, rows.Err()
}

func (s *Store) ListIncomingWorkspaceInvitationsByEmail(ctx context.Context, email string) ([]WorkspaceInvitation, error) {
	email, err := NormalizeEmail(email)
	if err != nil {
		return nil, err
	}

	rows, err := s.db.QueryContext(ctx, `
		SELECT
			wi.id,
			wi.workspace_id,
			w.name,
			wi.email,
			wi.role,
			wi.status,
			wi.expires_at,
			wi.created_at,
			COALESCE(inviter.name, inviter.email, 'Workspace Owner')
		FROM workspace_invitations wi
		INNER JOIN workspaces w ON w.id = wi.workspace_id
		LEFT JOIN users inviter ON inviter.id = wi.inviter_user_id
		WHERE LOWER(wi.email) = LOWER($1)
		ORDER BY
			CASE WHEN wi.status = 'pending' THEN 0 ELSE 1 END,
			wi.created_at DESC
	`, email)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var invitations []WorkspaceInvitation
	for rows.Next() {
		var invitation WorkspaceInvitation
		if err := rows.Scan(
			&invitation.ID,
			&invitation.WorkspaceID,
			&invitation.WorkspaceName,
			&invitation.Email,
			&invitation.Role,
			&invitation.Status,
			&invitation.ExpiresAt,
			&invitation.CreatedAt,
			&invitation.InviterName,
		); err != nil {
			return nil, err
		}
		invitations = append(invitations, invitation)
	}
	return invitations, rows.Err()
}

func (s *Store) CreateWorkspaceInvitationByUserID(ctx context.Context, inviterUserID int64, inviteeEmail string, role string, expiresAt time.Time) (WorkspaceInvitation, error) {
	workspace, err := s.GetWorkspaceContextByUserID(ctx, inviterUserID)
	if err != nil {
		return WorkspaceInvitation{}, err
	}
	return s.CreateWorkspaceInvitationByWorkspaceIDAndUserID(ctx, workspace.ID, inviterUserID, inviteeEmail, role, expiresAt)
}

func (s *Store) CreateWorkspaceInvitationByWorkspaceIDAndUserID(ctx context.Context, workspaceID, inviterUserID int64, inviteeEmail string, role string, expiresAt time.Time) (WorkspaceInvitation, error) {
	workspace, err := s.GetWorkspaceContextByWorkspaceIDAndUserID(ctx, workspaceID, inviterUserID)
	if err != nil {
		return WorkspaceInvitation{}, err
	}

	role, err = normalizeWorkspaceRole(role)
	if err != nil {
		return WorkspaceInvitation{}, err
	}
	if !canInviteWorkspaceRole(workspace.Role, role) {
		return WorkspaceInvitation{}, ErrWorkspacePermissionDenied
	}
	inviteeEmail, err = NormalizeEmail(inviteeEmail)
	if err != nil {
		return WorkspaceInvitation{}, err
	}

	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return WorkspaceInvitation{}, err
	}
	defer func() {
		_ = tx.Rollback()
	}()

	var memberExists bool
	err = tx.QueryRowContext(ctx, `
		SELECT EXISTS(
			SELECT 1
			FROM workspace_members wm
			INNER JOIN users u ON u.id = wm.user_id
			WHERE wm.workspace_id = $1 AND LOWER(u.email) = LOWER($2)
		)
	`, workspace.ID, inviteeEmail).Scan(&memberExists)
	if err != nil {
		return WorkspaceInvitation{}, err
	}
	if memberExists {
		return WorkspaceInvitation{}, ErrWorkspaceInviteConflict
	}

	if _, err := tx.ExecContext(ctx, `
		DELETE FROM workspace_invitations
		WHERE workspace_id = $1
			AND LOWER(email) = LOWER($2)
			AND status = 'pending'
	`, workspace.ID, inviteeEmail); err != nil {
		return WorkspaceInvitation{}, err
	}

	var invitation WorkspaceInvitation
	err = tx.QueryRowContext(ctx, `
		INSERT INTO workspace_invitations (workspace_id, inviter_user_id, email, role, status, expires_at)
		VALUES ($1, $2, $3, $4, 'pending', $5)
		RETURNING id, workspace_id, email, role, status, expires_at, created_at
	`, workspace.ID, inviterUserID, inviteeEmail, role, expiresAt.UTC()).Scan(
		&invitation.ID,
		&invitation.WorkspaceID,
		&invitation.Email,
		&invitation.Role,
		&invitation.Status,
		&invitation.ExpiresAt,
		&invitation.CreatedAt,
	)
	if err != nil {
		return WorkspaceInvitation{}, err
	}

	var inviterName string
	if err := tx.QueryRowContext(ctx, `SELECT COALESCE(name, email) FROM users WHERE id = $1`, inviterUserID).Scan(&inviterName); err != nil {
		return WorkspaceInvitation{}, err
	}
	invitation.WorkspaceName = workspace.Name
	invitation.InviterName = inviterName

	return invitation, tx.Commit()
}

func (s *Store) AcceptWorkspaceInvitationByUserID(ctx context.Context, userID int64, invitationID int64) (WorkspaceInvitation, error) {
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return WorkspaceInvitation{}, err
	}
	defer func() {
		_ = tx.Rollback()
	}()

	var user User
	if err := tx.QueryRowContext(ctx, `
		SELECT id, name, email, verification_required, email_verified_at, created_at
		FROM users
		WHERE id = $1
	`, userID).Scan(&user.ID, &user.Name, &user.Email, &user.VerificationRequired, &user.EmailVerifiedAt, &user.CreatedAt); err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return WorkspaceInvitation{}, ErrUserNotFound
		}
		return WorkspaceInvitation{}, err
	}

	var invitation WorkspaceInvitation
	err = tx.QueryRowContext(ctx, `
		SELECT
			wi.id,
			wi.workspace_id,
			w.name,
			wi.email,
			wi.role,
			wi.status,
			wi.expires_at,
			wi.created_at,
			COALESCE((SELECT COALESCE(u.name, u.email) FROM users u WHERE u.id = wi.inviter_user_id), 'Workspace Owner')
		FROM workspace_invitations wi
		INNER JOIN workspaces w ON w.id = wi.workspace_id
		WHERE wi.id = $1 AND LOWER(wi.email) = LOWER($2)
		FOR UPDATE
	`, invitationID, user.Email).Scan(
		&invitation.ID,
		&invitation.WorkspaceID,
		&invitation.WorkspaceName,
		&invitation.Email,
		&invitation.Role,
		&invitation.Status,
		&invitation.ExpiresAt,
		&invitation.CreatedAt,
		&invitation.InviterName,
	)
	if errors.Is(err, sql.ErrNoRows) {
		return WorkspaceInvitation{}, ErrWorkspaceInvitationNotFound
	}
	if err != nil {
		return WorkspaceInvitation{}, err
	}
	if invitation.Status != "pending" {
		return WorkspaceInvitation{}, ErrWorkspaceInvitationNotFound
	}
	if !invitation.ExpiresAt.IsZero() && invitation.ExpiresAt.Before(time.Now().UTC()) {
		if _, execErr := tx.ExecContext(ctx, `UPDATE workspace_invitations SET status = 'expired' WHERE id = $1`, invitation.ID); execErr != nil {
			return WorkspaceInvitation{}, execErr
		}
		return WorkspaceInvitation{}, ErrWorkspaceInvitationExpired
	}

	if err := ensureWorkspaceMembershipTx(ctx, tx, invitation.WorkspaceID, user.ID, invitation.Role); err != nil {
		return WorkspaceInvitation{}, err
	}
	if _, err := tx.ExecContext(ctx, `UPDATE workspace_invitations SET status = 'accepted' WHERE id = $1`, invitation.ID); err != nil {
		return WorkspaceInvitation{}, err
	}
	invitation.Status = "accepted"
	return invitation, tx.Commit()
}

func (s *Store) CancelWorkspaceInvitationByWorkspaceIDAndUserID(ctx context.Context, workspaceID, actorUserID, invitationID int64) (WorkspaceInvitation, error) {
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return WorkspaceInvitation{}, err
	}
	defer func() {
		_ = tx.Rollback()
	}()

	actorRole, err := workspaceRoleForUserInWorkspaceTx(ctx, tx, workspaceID, actorUserID)
	if err != nil {
		if errors.Is(err, ErrWorkspaceMemberNotFound) {
			return WorkspaceInvitation{}, ErrWorkspacePermissionDenied
		}
		return WorkspaceInvitation{}, err
	}
	if actorRole != "owner" && actorRole != "admin" {
		return WorkspaceInvitation{}, ErrWorkspacePermissionDenied
	}

	var invitation WorkspaceInvitation
	err = tx.QueryRowContext(ctx, `
		SELECT
			wi.id,
			wi.workspace_id,
			w.name,
			wi.email,
			wi.role,
			wi.status,
			wi.expires_at,
			wi.created_at,
			COALESCE((SELECT COALESCE(u.name, u.email) FROM users u WHERE u.id = wi.inviter_user_id), 'Workspace Owner')
		FROM workspace_invitations wi
		INNER JOIN workspaces w ON w.id = wi.workspace_id
		WHERE wi.workspace_id = $1 AND wi.id = $2
		FOR UPDATE
	`, workspaceID, invitationID).Scan(
		&invitation.ID,
		&invitation.WorkspaceID,
		&invitation.WorkspaceName,
		&invitation.Email,
		&invitation.Role,
		&invitation.Status,
		&invitation.ExpiresAt,
		&invitation.CreatedAt,
		&invitation.InviterName,
	)
	if errors.Is(err, sql.ErrNoRows) {
		return WorkspaceInvitation{}, ErrWorkspaceInvitationNotFound
	}
	if err != nil {
		return WorkspaceInvitation{}, err
	}
	if invitation.Status != "pending" {
		return WorkspaceInvitation{}, ErrWorkspaceInvitationNotFound
	}

	if _, err := tx.ExecContext(ctx, `
		UPDATE workspace_invitations
		SET status = 'revoked'
		WHERE id = $1
	`, invitation.ID); err != nil {
		return WorkspaceInvitation{}, err
	}
	invitation.Status = "revoked"

	return invitation, tx.Commit()
}

func (s *Store) UpdateWorkspaceMemberRoleByUserID(ctx context.Context, actorUserID, targetUserID int64, nextRole string) (WorkspaceMember, error) {
	workspace, err := s.GetWorkspaceContextByUserID(ctx, actorUserID)
	if err != nil {
		return WorkspaceMember{}, err
	}
	return s.UpdateWorkspaceMemberRoleByWorkspaceIDAndUserID(ctx, workspace.ID, actorUserID, targetUserID, nextRole)
}

func (s *Store) UpdateWorkspaceMemberRoleByWorkspaceIDAndUserID(ctx context.Context, workspaceID, actorUserID, targetUserID int64, nextRole string) (WorkspaceMember, error) {
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return WorkspaceMember{}, err
	}
	defer func() {
		_ = tx.Rollback()
	}()

	nextRole, err = normalizeWorkspaceRole(nextRole)
	if err != nil {
		return WorkspaceMember{}, err
	}

	actorRole, err := workspaceRoleForUserInWorkspaceTx(ctx, tx, workspaceID, actorUserID)
	if err != nil {
		if errors.Is(err, ErrWorkspaceMemberNotFound) {
			return WorkspaceMember{}, ErrWorkspacePermissionDenied
		}
		return WorkspaceMember{}, err
	}
	targetRole, err := workspaceRoleForUserInWorkspaceTx(ctx, tx, workspaceID, targetUserID)
	if err != nil {
		if errors.Is(err, ErrWorkspaceMemberNotFound) {
			return WorkspaceMember{}, ErrWorkspaceMemberNotFound
		}
		return WorkspaceMember{}, err
	}
	if actorUserID == targetUserID {
		return WorkspaceMember{}, ErrWorkspacePermissionDenied
	}
	if !canManageWorkspaceMember(actorRole, targetRole, nextRole) {
		return WorkspaceMember{}, ErrWorkspacePermissionDenied
	}

	if _, err := tx.ExecContext(ctx, `
		UPDATE workspace_members
		SET role = $3
		WHERE workspace_id = $1 AND user_id = $2
	`, workspaceID, targetUserID, nextRole); err != nil {
		return WorkspaceMember{}, err
	}

	member, err := workspaceMemberByIDTx(ctx, tx, workspaceID, targetUserID)
	if err != nil {
		return WorkspaceMember{}, err
	}
	return member, tx.Commit()
}

func (s *Store) RemoveWorkspaceMemberByUserID(ctx context.Context, actorUserID, targetUserID int64) error {
	workspace, err := s.GetWorkspaceContextByUserID(ctx, actorUserID)
	if err != nil {
		return err
	}
	return s.RemoveWorkspaceMemberByWorkspaceIDAndUserID(ctx, workspace.ID, actorUserID, targetUserID)
}

func (s *Store) RemoveWorkspaceMemberByWorkspaceIDAndUserID(ctx context.Context, workspaceID, actorUserID, targetUserID int64) error {
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return err
	}
	defer func() {
		_ = tx.Rollback()
	}()

	actorRole, err := workspaceRoleForUserInWorkspaceTx(ctx, tx, workspaceID, actorUserID)
	if err != nil {
		if errors.Is(err, ErrWorkspaceMemberNotFound) {
			return ErrWorkspacePermissionDenied
		}
		return err
	}
	targetRole, err := workspaceRoleForUserInWorkspaceTx(ctx, tx, workspaceID, targetUserID)
	if err != nil {
		if errors.Is(err, ErrWorkspaceMemberNotFound) {
			return ErrWorkspaceMemberNotFound
		}
		return err
	}
	if actorUserID == targetUserID {
		return ErrWorkspacePermissionDenied
	}
	if !canManageWorkspaceMember(actorRole, targetRole, "") {
		return ErrWorkspacePermissionDenied
	}

	result, err := tx.ExecContext(ctx, `
		DELETE FROM workspace_members
		WHERE workspace_id = $1 AND user_id = $2
	`, workspaceID, targetUserID)
	if err != nil {
		return err
	}
	rowsAffected, err := result.RowsAffected()
	if err != nil {
		return err
	}
	if rowsAffected == 0 {
		return ErrWorkspaceMemberNotFound
	}
	return tx.Commit()
}

func ensureDefaultWorkspaceTx(ctx context.Context, tx *sql.Tx, user User) (WorkspaceContext, error) {
	var workspace WorkspaceContext
	err := tx.QueryRowContext(ctx, `
		SELECT
			w.id,
			w.name,
			w.plan,
			w.billing_status,
			COALESCE(wm.role, 'owner'),
			(
				SELECT COUNT(*)
				FROM workspace_members member_count
				WHERE member_count.workspace_id = w.id
			) AS member_count,
			w.created_at
		FROM workspaces w
		LEFT JOIN workspace_members wm
			ON wm.workspace_id = w.id AND wm.user_id = $1
		WHERE w.owner_user_id = $1
		ORDER BY w.created_at ASC
		LIMIT 1
	`, user.ID).Scan(
		&workspace.ID,
		&workspace.Name,
		&workspace.Plan,
		&workspace.BillingStatus,
		&workspace.Role,
		&workspace.MemberCount,
		&workspace.CreatedAt,
	)
	if err == nil {
		if err := ensureWorkspaceMembershipTx(ctx, tx, workspace.ID, user.ID, "owner"); err != nil {
			return WorkspaceContext{}, err
		}
		workspace.MemberCount = maxInt(workspace.MemberCount, 1)
		return workspace, nil
	}
	if !errors.Is(err, sql.ErrNoRows) {
		return WorkspaceContext{}, err
	}

	workspaceName := defaultWorkspaceName(user.Name)
	err = tx.QueryRowContext(ctx, `
		INSERT INTO workspaces (owner_user_id, name, plan, billing_status)
		VALUES ($1, $2, 'starter', 'trial')
		RETURNING id, name, plan, billing_status, created_at
	`, user.ID, workspaceName).Scan(
		&workspace.ID,
		&workspace.Name,
		&workspace.Plan,
		&workspace.BillingStatus,
		&workspace.CreatedAt,
	)
	if err != nil {
		return WorkspaceContext{}, err
	}

	if err := ensureWorkspaceMembershipTx(ctx, tx, workspace.ID, user.ID, "owner"); err != nil {
		return WorkspaceContext{}, err
	}

	workspace.Role = "owner"
	workspace.MemberCount = 1
	return workspace, nil
}

func workspaceRoleForUserInWorkspaceTx(ctx context.Context, tx *sql.Tx, workspaceID, userID int64) (string, error) {
	var role string
	err := tx.QueryRowContext(ctx, `
		SELECT role
		FROM workspace_members
		WHERE workspace_id = $1 AND user_id = $2
	`, workspaceID, userID).Scan(&role)
	if errors.Is(err, sql.ErrNoRows) {
		return "", ErrWorkspaceMemberNotFound
	}
	if err != nil {
		return "", err
	}
	return role, nil
}

func workspaceMemberByIDTx(ctx context.Context, tx *sql.Tx, workspaceID, userID int64) (WorkspaceMember, error) {
	var member WorkspaceMember
	err := tx.QueryRowContext(ctx, `
		SELECT u.id, u.name, u.email, wm.role, wm.created_at
		FROM workspace_members wm
		INNER JOIN users u ON u.id = wm.user_id
		WHERE wm.workspace_id = $1 AND wm.user_id = $2
	`, workspaceID, userID).Scan(&member.UserID, &member.Name, &member.Email, &member.Role, &member.JoinedAt)
	if errors.Is(err, sql.ErrNoRows) {
		return WorkspaceMember{}, ErrWorkspaceMemberNotFound
	}
	if err != nil {
		return WorkspaceMember{}, err
	}
	return member, nil
}

func canManageWorkspaceMember(actorRole, targetRole, nextRole string) bool {
	if targetRole == "owner" {
		return false
	}
	switch actorRole {
	case "owner":
		if nextRole == "" {
			return true
		}
		return nextRole == "admin" || nextRole == "member" || nextRole == "viewer"
	case "admin":
		if targetRole != "member" && targetRole != "viewer" {
			return false
		}
		if nextRole == "" {
			return true
		}
		return nextRole == "member" || nextRole == "viewer"
	default:
		return false
	}
}

func canInviteWorkspaceRole(actorRole, inviteRole string) bool {
	switch actorRole {
	case "owner":
		return inviteRole == "owner" || inviteRole == "admin" || inviteRole == "member" || inviteRole == "viewer"
	case "admin":
		return inviteRole == "member" || inviteRole == "viewer"
	default:
		return false
	}
}

func ensureWorkspaceMembershipTx(ctx context.Context, tx *sql.Tx, workspaceID, userID int64, role string) error {
	var err error
	role, err = normalizeWorkspaceRole(role)
	if err != nil {
		return err
	}
	_, err = tx.ExecContext(ctx, `
		INSERT INTO workspace_members (workspace_id, user_id, role)
		VALUES ($1, $2, $3)
		ON CONFLICT (workspace_id, user_id)
		DO UPDATE SET role = EXCLUDED.role
	`, workspaceID, userID, role)
	return err
}

func defaultWorkspaceName(userName string) string {
	userName = strings.TrimSpace(userName)
	if userName == "" {
		return "Qnetward Workspace"
	}
	return fmt.Sprintf("%s Workspace", userName)
}

func normalizeWorkspaceRole(role string) (string, error) {
	role = strings.TrimSpace(strings.ToLower(role))
	switch role {
	case "", "member":
		return "member", nil
	case "owner", "admin", "viewer":
		return role, nil
	default:
		return "", ErrWorkspaceRoleInvalid
	}
}

func maxInt(left, right int) int {
	if left > right {
		return left
	}
	return right
}

// RenameWorkspace changes a workspace's display name.
func (s *Store) RenameWorkspace(ctx context.Context, workspaceID int64, name string) (string, error) {
	if s == nil {
		return "", errors.New("store is not available")
	}
	name = strings.Join(strings.Fields(name), " ")
	if name == "" {
		return "", errors.New("name is required")
	}
	if len([]rune(name)) > 60 {
		return "", errors.New("name must be 60 characters or fewer")
	}
	res, err := s.db.ExecContext(ctx, `UPDATE workspaces SET name = $2 WHERE id = $1`, workspaceID, name)
	if err != nil {
		return "", err
	}
	if n, _ := res.RowsAffected(); n == 0 {
		return "", ErrWorkspaceNotFound
	}
	return name, nil
}
