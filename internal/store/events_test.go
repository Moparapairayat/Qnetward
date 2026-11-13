package store

import (
	"context"
	"testing"
	"time"
)

// Events get increasing ids, are readable from any point the log still
// covers, stay inside their workspace, and are announced to listeners.
func TestWorkspaceEventLog(t *testing.T) {
	st := openTestStore(t, Config{BatchSize: 1, FlushInterval: 5 * time.Millisecond})
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()
	owner, err := st.CreateUser(ctx, "Event Owner", testEmail("event-owner"), "hash", false)
	if err != nil {
		t.Fatal(err)
	}
	ws := mustOwnedWorkspaceID(t, st, owner.ID)
	other, err := st.CreateUser(ctx, "Event Other", testEmail("event-other"), "hash", false)
	if err != nil {
		t.Fatal(err)
	}
	otherWS := mustOwnedWorkspaceID(t, st, other.ID)

	if covered := mustSince(t, st, ws, 0, 10); !covered.ok || len(covered.events) != 0 {
		t.Fatalf("an empty log covers position 0: %+v", covered)
	}

	// Listen first, so the announcements below are heard.
	heard := make(chan WorkspaceEvent, 8)
	ready := make(chan struct{})
	listenCtx, stopListening := context.WithCancel(ctx)
	defer stopListening()
	go func() {
		_ = st.ListenEvents(listenCtx, func() { close(ready) }, func(e WorkspaceEvent) {
			if e.WorkspaceID == ws || e.WorkspaceID == otherWS {
				heard <- e
			}
		})
	}()
	select {
	case <-ready:
	case <-time.After(15 * time.Second):
		t.Fatal("the listener should connect")
	}

	first, err := st.AppendEvent(ctx, ws, "monitor.check", []byte(`{"type":"monitor.check","monitor_id":7}`))
	if err != nil {
		t.Fatal(err)
	}
	second, _ := st.AppendEvent(ctx, ws, "host.changed", nil)
	if _, err := st.AppendEvent(ctx, otherWS, "agent.changed", nil); err != nil {
		t.Fatal(err)
	}
	if second <= first {
		t.Fatalf("ids increase: %d then %d", first, second)
	}

	got := map[string]bool{}
	for len(got) < 3 {
		select {
		case e := <-heard:
			got[e.Type] = true
			if e.Type == "monitor.check" && (e.ID != first || string(e.Payload) == "") {
				t.Fatalf("the announcement carries the event: %+v", e)
			}
		case <-time.After(10 * time.Second):
			t.Fatalf("every event is announced, heard %v", got)
		}
	}

	r := mustSince(t, st, ws, first, 10)
	if !r.ok || len(r.events) != 1 || r.events[0].ID != second {
		t.Fatalf("after the first event comes only the second: %+v", r)
	}
	if r := mustSince(t, st, ws, 0, 10); r.ok {
		t.Fatalf("a client that saw nothing, while the log has events, must resync: %+v", r)
	}
	if latest, _ := st.LatestEventID(ctx, ws); latest != second {
		t.Fatalf("latest is the second event, got %d", latest)
	}
	if r := mustSince(t, st, otherWS, 0, 10); r.ok || len(r.events) != 1 {
		t.Fatalf("another workspace sees only its own event: %+v", r)
	}

	// Once the event a client last saw is pruned, it can't be caught up.
	if _, err := st.db.ExecContext(ctx, `UPDATE workspace_events SET created_at = NOW() - INTERVAL '2 days' WHERE id = $1`, first); err != nil {
		t.Fatal(err)
	}
	if err := st.PruneEvents(ctx, time.Now().Add(-EventRetention)); err != nil {
		t.Fatal(err)
	}
	if r := mustSince(t, st, ws, first, 10); r.ok {
		t.Fatalf("a pruned position is not covered: %+v", r)
	}
	if r := mustSince(t, st, ws, second, 10); !r.ok || len(r.events) != 0 {
		t.Fatalf("a client at the newest event has nothing to miss: %+v", r)
	}
}

type sinceResult struct {
	events []WorkspaceEvent
	ok     bool
}

func mustSince(t *testing.T, st *Store, ws, after int64, limit int) sinceResult {
	t.Helper()
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	events, ok, err := st.EventsSince(ctx, ws, after, limit)
	if err != nil {
		t.Fatal(err)
	}
	return sinceResult{events, ok}
}

func TestListenDSNSkipsPooler(t *testing.T) {
	in := "postgresql://u:p@ep-cool-name-123-pooler.ap-southeast-1.aws.neon.tech/db?sslmode=require"
	want := "postgresql://u:p@ep-cool-name-123.ap-southeast-1.aws.neon.tech/db?sslmode=require"
	if got := listenDSN(in); got != want {
		t.Fatalf("got %s", got)
	}
	if got := listenDSN("postgres://localhost/db"); got != "postgres://localhost/db" {
		t.Fatalf("plain DSNs stay the same: %s", got)
	}
}
