package store

import (
	"context"
	"testing"
	"time"
)

func TestAuditLogScopesPagesAndStaysAppendOnly(t *testing.T) {
	st := openTestStore(t, Config{BatchSize: 1, FlushInterval: 5 * time.Millisecond})

	ctx, cancel := context.WithTimeout(context.Background(), 60*time.Second)
	defer cancel()

	owner, err := st.CreateUser(ctx, "Audit Owner", testEmail("audit-owner"), "hash", false)
	if err != nil {
		t.Fatalf("CreateUser returned error: %v", err)
	}
	other, err := st.CreateUser(ctx, "Audit Other", testEmail("audit-other"), "hash", false)
	if err != nil {
		t.Fatalf("CreateUser returned error: %v", err)
	}
	workspaceID := mustOwnedWorkspaceID(t, st, owner.ID)
	otherWorkspaceID := mustOwnedWorkspaceID(t, st, other.ID)

	record := func(e AuditEvent) {
		t.Helper()
		if err := st.RecordAuditEvent(ctx, e); err != nil {
			t.Fatalf("RecordAuditEvent(%s) returned error: %v", e.Action, err)
		}
	}
	record(AuditEvent{WorkspaceID: workspaceID, ActorUserID: owner.ID, ActorEmail: owner.Email, Action: "monitor.created", TargetType: "monitor", TargetID: "1", TargetLabel: "api", Metadata: map[string]any{"interval_seconds": 60}})
	record(AuditEvent{WorkspaceID: workspaceID, ActorUserID: owner.ID, Action: "member.invited", TargetLabel: "new@example.com"})
	record(AuditEvent{WorkspaceID: workspaceID, ActorUserID: owner.ID, Action: "scan.portscan", TargetLabel: "1.1.1.1"})
	record(AuditEvent{WorkspaceID: otherWorkspaceID, ActorUserID: other.ID, Action: "monitor.created"})
	record(AuditEvent{ActorUserID: owner.ID, ActorEmail: owner.Email, Action: "auth.login", IPAddress: "203.0.113.7"})

	events, err := st.ListWorkspaceAuditEvents(ctx, workspaceID, AuditQuery{})
	if err != nil {
		t.Fatalf("ListWorkspaceAuditEvents returned error: %v", err)
	}
	if len(events) != 3 || events[0].Action != "scan.portscan" || events[2].Action != "monitor.created" {
		t.Fatalf("expected this workspace's three events, newest first, got %#v", events)
	}
	if events[2].Metadata["interval_seconds"] != float64(60) {
		t.Fatalf("expected metadata to round-trip, got %#v", events[2].Metadata)
	}

	page, err := st.ListWorkspaceAuditEvents(ctx, workspaceID, AuditQuery{Limit: 2})
	if err != nil || len(page) != 2 {
		t.Fatalf("first page: %d events, err %v", len(page), err)
	}
	rest, err := st.ListWorkspaceAuditEvents(ctx, workspaceID, AuditQuery{Limit: 2, Before: page[1].ID})
	if err != nil || len(rest) != 1 || rest[0].Action != "monitor.created" {
		t.Fatalf("second page: %#v, err %v", rest, err)
	}

	monitors, err := st.ListWorkspaceAuditEvents(ctx, workspaceID, AuditQuery{Category: "monitor"})
	if err != nil || len(monitors) != 1 {
		t.Fatalf("monitor category: %d events, err %v", len(monitors), err)
	}

	account, err := st.ListAccountAuditEvents(ctx, owner.ID, 10)
	if err != nil || len(account) != 1 || account[0].Action != "auth.login" || account[0].IPAddress != "203.0.113.7" {
		t.Fatalf("expected only the account event, got %#v (err %v)", account, err)
	}

	// Row-level security: even unfiltered, another workspace's events are invisible.
	tx, err := st.beginWorkspaceTx(ctx, workspaceID)
	if err != nil {
		t.Fatalf("beginWorkspaceTx returned error: %v", err)
	}
	var visible int
	if err := tx.QueryRowContext(ctx, `SELECT COUNT(*) FROM audit_events WHERE workspace_id = $1 OR workspace_id IS NULL`, otherWorkspaceID).Scan(&visible); err != nil {
		t.Fatalf("count: %v", err)
	}
	_ = tx.Rollback()
	if visible != 0 {
		t.Fatalf("saw %d events outside the workspace", visible)
	}

	// Nobody can rewrite history, not even the login role.
	if _, err := st.db.ExecContext(ctx, `UPDATE audit_events SET action = 'tampered' WHERE id = $1`, events[0].ID); err == nil {
		t.Fatal("expected audit events to reject updates")
	}
}
