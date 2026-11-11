package store

import (
	"context"
	"errors"
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

	if _, err := st.SaveMonitor(ctx, Monitor{WorkspaceID: workspaceID, UserID: owner.ID, Protocol: "tcpping", Target: "10.0.0.9",
		Port: intPtr(22), IntervalSeconds: 60, Enabled: true, LocationIDs: []int64{busy.ID}}, 0); err != nil {
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

// A monitor that runs from several places goes down only when every place
// that is still reporting sees it down, and comes back when any sees it up.
func TestMonitorStatusAcrossLocations(t *testing.T) {
	st := openTestStore(t, Config{BatchSize: 1, FlushInterval: 5 * time.Millisecond})
	ctx, cancel := context.WithTimeout(context.Background(), 60*time.Second)
	defer cancel()

	owner, err := st.CreateUser(ctx, "Location Owner", testEmail("location-owner"), "hash", false)
	if err != nil {
		t.Fatal(err)
	}
	workspaceID := mustOwnedWorkspaceID(t, st, owner.ID)
	token, secret := testEmail("enroll-loc"), testEmail("secret-loc")
	if _, err := st.CreateAgent(ctx, workspaceID, owner.ID, "office", token, time.Now().Add(time.Hour), 0); err != nil {
		t.Fatal(err)
	}
	agent, err := st.EnrollAgent(ctx, token, secret, AgentInfo{})
	if err != nil {
		t.Fatal(err)
	}

	m, err := st.SaveMonitor(ctx, Monitor{WorkspaceID: workspaceID, UserID: owner.ID, Protocol: "tcpping", Target: "multi.example",
		Port: intPtr(443), IntervalSeconds: 60, Enabled: true, LocationIDs: []int64{0, agent.ID, agent.ID}}, 0)
	if err != nil {
		t.Fatal(err)
	}
	if len(m.Locations) != 2 || m.Locations[0].AgentID != 0 || m.Locations[1].Name != "office" || !m.Cloud {
		t.Fatalf("expected the servers and the agent, got %+v", m.Locations)
	}

	record := func(agentID *int64, ok bool) MonitorOutcome {
		t.Helper()
		out, err := st.RecordMonitorCheck(ctx, m, MonitorCheck{CheckedAt: time.Now(), OK: ok, AgentID: agentID, Error: map[bool]string{false: "timeout"}[ok]})
		if err != nil {
			t.Fatal(err)
		}
		return out
	}
	fromAgent := &agent.ID

	// One place failing while the other hasn't reported changes nothing.
	if out := record(nil, false); out.Status != "pending" {
		t.Fatalf("one of two places down, the other silent: got %q", out.Status)
	}
	if out := record(fromAgent, true); out.Status != "up" {
		t.Fatalf("any place up means up, got %q", out.Status)
	}
	if out := record(nil, false); out.Status != "up" {
		t.Fatalf("a lone failing place must not take it down, got %q", out.Status)
	}
	if out := record(fromAgent, false); out.Status != "down" || out.Previous != "up" {
		t.Fatalf("every place down means down, got %+v", out)
	}
	if out := record(nil, true); out.Status != "up" || out.Previous != "down" {
		t.Fatalf("one place recovering brings it back, got %+v", out)
	}

	// An agent that stopped checking in no longer counts: with the servers
	// failing and the agent's last "up" stale, the monitor is down.
	record(fromAgent, true)
	if _, err := st.db.ExecContext(ctx, `UPDATE probe_agents SET last_seen_at = NOW() - INTERVAL '10 minutes' WHERE id = $1`, agent.ID); err != nil {
		t.Fatal(err)
	}
	if out := record(nil, false); out.Status != "down" {
		t.Fatalf("an offline agent's old result must not hold it up, got %q", out.Status)
	}

	// Dropping the servers leaves the agent, and late server results are refused.
	m.LocationIDs = []int64{agent.ID}
	m, err = st.SaveMonitor(ctx, m, 0)
	if err != nil {
		t.Fatal(err)
	}
	if m.Cloud || len(m.Locations) != 1 {
		t.Fatalf("expected the agent alone, got cloud=%v %+v", m.Cloud, m.Locations)
	}
	if _, err := st.RecordMonitorCheck(ctx, m, MonitorCheck{CheckedAt: time.Now(), OK: true}); !errors.Is(err, ErrMonitorNotFound) {
		t.Fatalf("a result from a place the monitor left should be dropped, got %v", err)
	}

	// Removing its only agent hands the monitor back to the servers.
	if _, err := st.DeleteAgent(ctx, workspaceID, agent.ID); err != nil {
		t.Fatal(err)
	}
	list, err := st.ListMonitors(ctx, workspaceID)
	if err != nil {
		t.Fatal(err)
	}
	if len(list) != 1 || !list[0].Cloud || len(list[0].Locations) != 1 || list[0].Locations[0].AgentID != 0 {
		t.Fatalf("expected the monitor back on the servers, got %+v", list)
	}
}
