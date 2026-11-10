package store

import (
	"context"
	"testing"
	"time"
)

// An agent that stops checking in while it runs a monitor is reported once,
// and its next heartbeat says it's back.
func TestSilentAgentsAreClaimedOnce(t *testing.T) {
	st := openTestStore(t, Config{BatchSize: 1, FlushInterval: 5 * time.Millisecond})
	ctx, cancel := context.WithTimeout(context.Background(), 60*time.Second)
	defer cancel()

	owner, err := st.CreateUser(ctx, "Agent Owner", testEmail("agent-owner"), "hash", false)
	if err != nil {
		t.Fatal(err)
	}
	workspaceID := mustOwnedWorkspaceID(t, st, owner.ID)

	enroll := func(name, token, secret string) Agent {
		if _, err := st.CreateAgent(ctx, workspaceID, owner.ID, name, token, time.Now().Add(time.Hour), 0); err != nil {
			t.Fatal(err)
		}
		a, err := st.EnrollAgent(ctx, token, secret, AgentInfo{Hostname: name + "-host"})
		if err != nil {
			t.Fatal(err)
		}
		return a
	}
	busySecret := testEmail("secret-busy")
	busy := enroll("busy", testEmail("enroll-busy"), busySecret)
	idle := enroll("idle", testEmail("enroll-idle"), testEmail("secret-idle"))

	busyID := busy.ID
	if _, err := st.SaveMonitor(ctx, Monitor{WorkspaceID: workspaceID, UserID: owner.ID, Protocol: "tcpping", Target: "10.0.0.9",
		Port: intPtr(22), IntervalSeconds: 60, Enabled: true, AgentID: &busyID}, 0); err != nil {
		t.Fatal(err)
	}

	// Both go quiet; only the one running a monitor matters.
	if _, err := st.db.ExecContext(ctx, `UPDATE probe_agents SET last_seen_at = NOW() - INTERVAL '10 minutes' WHERE id IN ($1, $2)`, busy.ID, idle.ID); err != nil {
		t.Fatal(err)
	}
	silent, err := st.ClaimSilentAgents(ctx, 3*time.Minute)
	if err != nil {
		t.Fatal(err)
	}
	var found *SilentAgent
	for i := range silent {
		if silent[i].ID == idle.ID {
			t.Fatal("an agent with no monitors must not be reported")
		}
		if silent[i].ID == busy.ID {
			found = &silent[i]
		}
	}
	if found == nil || found.Monitors != 1 || found.CreatorEmail != owner.Email || found.Hostname != "busy-host" {
		t.Fatalf("expected the busy agent with its creator, got %+v", silent)
	}

	again, err := st.ClaimSilentAgents(ctx, 3*time.Minute)
	if err != nil {
		t.Fatal(err)
	}
	for _, a := range again {
		if a.ID == busy.ID {
			t.Fatal("a silent agent is reported once")
		}
	}

	back, err := st.AgentHeartbeat(ctx, busySecret, AgentInfo{})
	if err != nil {
		t.Fatal(err)
	}
	if !back.BackOnline {
		t.Fatal("the first heartbeat after going silent should say it's back")
	}
	next, err := st.AgentHeartbeat(ctx, busySecret, AgentInfo{})
	if err != nil {
		t.Fatal(err)
	}
	if next.BackOnline {
		t.Fatal("later heartbeats are ordinary")
	}
}
