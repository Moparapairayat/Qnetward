package store

import (
	"context"
	"errors"
	"testing"
	"time"
)

func TestMonitorLifecycle(t *testing.T) {
	st := openTestStore(t, Config{BatchSize: 1, FlushInterval: 5 * time.Millisecond})

	ctx, cancel := context.WithTimeout(context.Background(), 60*time.Second)
	defer cancel()

	owner, err := st.CreateUser(ctx, "Monitor Owner", testEmail("monitor-owner"), "hash", false)
	if err != nil {
		t.Fatalf("CreateUser returned error: %v", err)
	}
	workspaceID := mustOwnedWorkspaceID(t, st, owner.ID)
	stranger, err := st.CreateUser(ctx, "Stranger", testEmail("monitor-stranger"), "hash", false)
	if err != nil {
		t.Fatalf("CreateUser returned error: %v", err)
	}
	otherWorkspaceID := mustOwnedWorkspaceID(t, st, stranger.ID)

	monitor, err := st.SaveMonitor(ctx, Monitor{
		WorkspaceID:     workspaceID,
		UserID:          owner.ID,
		Protocol:        "tcpping",
		Target:          "monitor.example",
		Port:            intPtr(443),
		IntervalSeconds: 60,
		NotifyEmail:     owner.Email,
		Enabled:         true,
	}, 0)
	if err != nil {
		t.Fatalf("SaveMonitor returned error: %v", err)
	}
	if monitor.Name != "monitor.example:443" || monitor.Status != "pending" {
		t.Fatalf("unexpected new monitor: %#v", monitor)
	}

	if _, err := st.SaveMonitor(ctx, Monitor{
		WorkspaceID: workspaceID, Protocol: "tcpping", Target: "monitor.example", Port: intPtr(443), IntervalSeconds: 300,
	}, 0); !errors.Is(err, ErrMonitorDuplicate) {
		t.Fatalf("expected ErrMonitorDuplicate, got %v", err)
	}
	if _, err := st.SaveMonitor(ctx, Monitor{
		WorkspaceID: workspaceID, Protocol: "ping", Target: "x.example", IntervalSeconds: 45,
	}, 0); err == nil {
		t.Fatal("expected an unsupported interval to be rejected")
	}
	if _, err := st.SaveMonitor(ctx, Monitor{
		WorkspaceID: workspaceID, Protocol: "ping", Target: "limit.example", IntervalSeconds: 300,
	}, 1); !errors.Is(err, ErrMonitorLimit) {
		t.Fatalf("expected ErrMonitorLimit at a limit of one, got %v", err)
	}

	// A brand-new monitor is due at once; claiming pushes it an interval ahead.
	claimed := claimUntilFound(t, st, monitor.ID)
	if !claimed.NextRunAt.After(time.Now().Add(30 * time.Second)) {
		t.Fatalf("expected next run about a minute out, got %s", claimed.NextRunAt)
	}
	again, err := st.ClaimDueMonitors(ctx, 100)
	if err != nil {
		t.Fatalf("ClaimDueMonitors returned error: %v", err)
	}
	for _, m := range again {
		if m.ID == monitor.ID {
			t.Fatal("monitor was claimed twice within its interval")
		}
	}

	rtt := 21.5
	outcome, err := st.RecordMonitorCheck(ctx, claimed, MonitorCheck{CheckedAt: time.Now(), OK: true, RttMs: &rtt})
	if err != nil || outcome.Previous != "pending" {
		t.Fatalf("first check: previous=%q err=%v", outcome.Previous, err)
	}
	outcome, err = st.RecordMonitorCheck(ctx, claimed, MonitorCheck{CheckedAt: time.Now(), LossPercent: 100, Error: "connection refused"})
	if err != nil || outcome.Previous != "up" {
		t.Fatalf("second check: previous=%q err=%v", outcome.Previous, err)
	}

	monitors, err := st.ListMonitors(ctx, workspaceID)
	if err != nil {
		t.Fatalf("ListMonitors returned error: %v", err)
	}
	if len(monitors) != 1 {
		t.Fatalf("expected one monitor, got %d", len(monitors))
	}
	got := monitors[0]
	if got.Status != "down" || got.LastError != "connection refused" || len(got.RecentChecks) != 2 {
		t.Fatalf("unexpected monitor after checks: %#v", got)
	}
	if got.Uptime24h == nil || *got.Uptime24h != 50 {
		t.Fatalf("expected 50%% uptime, got %v", got.Uptime24h)
	}
	if !got.RecentChecks[0].OK || got.RecentChecks[1].OK {
		t.Fatalf("expected checks oldest first, got %#v", got.RecentChecks)
	}

	// Other workspaces can't see, change, or delete it.
	if list, err := st.ListMonitors(ctx, otherWorkspaceID); err != nil || len(list) != 0 {
		t.Fatalf("other workspace saw %d monitor(s) (err %v)", len(list), err)
	}
	hijack := got
	hijack.WorkspaceID = otherWorkspaceID
	if _, err := st.SaveMonitor(ctx, hijack, 0); !errors.Is(err, ErrMonitorNotFound) {
		t.Fatalf("expected ErrMonitorNotFound updating from another workspace, got %v", err)
	}
	if err := st.DeleteMonitor(ctx, otherWorkspaceID, got.ID); !errors.Is(err, ErrMonitorNotFound) {
		t.Fatalf("expected ErrMonitorNotFound deleting from another workspace, got %v", err)
	}

	// Pointing it at a new target resets the status and checks it right away.
	got.Target = "moved.example"
	moved, err := st.SaveMonitor(ctx, got, 0)
	if err != nil {
		t.Fatalf("SaveMonitor update returned error: %v", err)
	}
	if moved.Status != "pending" || moved.LastCheckedAt != nil || moved.NextRunAt.After(time.Now().Add(5*time.Second)) {
		t.Fatalf("expected a reset, due monitor after retargeting: %#v", moved)
	}

	if err := st.DeleteMonitor(ctx, workspaceID, got.ID); err != nil {
		t.Fatalf("DeleteMonitor returned error: %v", err)
	}
	if _, err := st.RecordMonitorCheck(ctx, claimed, MonitorCheck{CheckedAt: time.Now(), OK: true}); !errors.Is(err, ErrMonitorNotFound) {
		t.Fatalf("expected ErrMonitorNotFound recording for a deleted monitor, got %v", err)
	}
}

// claimUntilFound claims due monitors until the wanted one comes up. The test
// database is shared, so other runs' monitors may be due too.
func claimUntilFound(t *testing.T, st *Store, id int64) Monitor {
	t.Helper()
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()
	for range 20 {
		due, err := st.ClaimDueMonitors(ctx, 50)
		if err != nil {
			t.Fatalf("ClaimDueMonitors returned error: %v", err)
		}
		for _, m := range due {
			if m.ID == id {
				return m
			}
		}
		if len(due) == 0 {
			break
		}
	}
	t.Fatalf("monitor %d was never claimed", id)
	return Monitor{}
}

// An HTTPS monitor warns once per certificate as it nears expiry, and again
// only after the certificate changes.
func TestMonitorWarnsOncePerExpiringCertificate(t *testing.T) {
	st := openTestStore(t, Config{BatchSize: 1, FlushInterval: 5 * time.Millisecond})

	ctx, cancel := context.WithTimeout(context.Background(), 60*time.Second)
	defer cancel()

	user, err := st.CreateUser(ctx, "Cert Watcher", testEmail("monitor-cert"), "hash", false)
	if err != nil {
		t.Fatalf("CreateUser returned error: %v", err)
	}
	monitor, err := st.SaveMonitor(ctx, Monitor{
		WorkspaceID:     mustOwnedWorkspaceID(t, st, user.ID),
		Protocol:        "http",
		Target:          "https://cert.example/health",
		IntervalSeconds: 300,
		Enabled:         true,
	}, 0)
	if err != nil {
		t.Fatalf("SaveMonitor returned error: %v", err)
	}
	if monitor.Port != nil || monitor.Name != "https://cert.example/health" {
		t.Fatalf("unexpected http monitor: %#v", monitor)
	}

	record := func(expires time.Time) MonitorOutcome {
		t.Helper()
		code := 200
		out, err := st.RecordMonitorCheck(ctx, monitor, MonitorCheck{CheckedAt: time.Now(), OK: true, StatusCode: &code, TLSExpiresAt: &expires})
		if err != nil {
			t.Fatalf("RecordMonitorCheck returned error: %v", err)
		}
		return out
	}

	far := time.Now().Add(90 * 24 * time.Hour).UTC().Truncate(time.Second)
	if record(far).WarnTLS {
		t.Fatal("did not expect a warning 90 days out")
	}
	soon := time.Now().Add(5 * 24 * time.Hour).UTC().Truncate(time.Second)
	if !record(soon).WarnTLS {
		t.Fatal("expected a warning 5 days before expiry")
	}
	if record(soon).WarnTLS {
		t.Fatal("expected only one warning for the same certificate")
	}
	renewedButShort := soon.Add(24 * time.Hour)
	if !record(renewedButShort).WarnTLS {
		t.Fatal("expected a new warning for a different certificate")
	}

	list, err := st.ListMonitors(ctx, monitor.WorkspaceID)
	if err != nil {
		t.Fatalf("ListMonitors returned error: %v", err)
	}
	got := list[0]
	if got.LastStatusCode == nil || *got.LastStatusCode != 200 || got.TLSExpiresAt == nil || !got.TLSExpiresAt.Equal(renewedButShort) {
		t.Fatalf("expected status code and certificate expiry on the monitor, got %#v", got)
	}
	if got.RecentChecks[0].StatusCode == nil {
		t.Fatal("expected status codes on recent checks")
	}
}
