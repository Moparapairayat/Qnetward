package api

import (
	"fmt"
	"testing"

	"qnetward/internal/store"
)

// When a workspace's plan drops, the oldest monitors up to the new limit keep
// running and the rest wait; paying again brings them back.
func TestPlanCapsMonitors(t *testing.T) {
	st := installTestStore(t)
	user, _ := issueTestSession(t, st)
	workspaceID := testWorkspaceID(t, st, user.ID)
	ctx := t.Context()

	free := 20 // the Free plan's monitor limit
	var ids []int64
	for i := 0; i < free+2; i++ {
		port := 9000 + i // one target per monitor: the same one twice is refused
		// Saved with no limit, as a Pro workspace could.
		m, err := st.SaveMonitor(ctx, store.Monitor{WorkspaceID: workspaceID, UserID: user.ID, Name: fmt.Sprintf("m%d", i), Protocol: "tcpping",
			Target: "192.0.2.1", Port: &port, IntervalSeconds: 3600, Enabled: true}, 0)
		if err != nil {
			t.Fatal(err)
		}
		ids = append(ids, m.ID)
	}
	if err := st.SetWorkspacePlan(ctx, workspaceID, "free"); err != nil {
		t.Fatal(err)
	}

	claimed := func() map[int64]bool {
		got := map[int64]bool{}
		for {
			due, err := st.ClaimDueMonitors(ctx, 500)
			if err != nil {
				t.Fatal(err)
			}
			if len(due) == 0 {
				return got
			}
			for _, m := range due {
				if m.WorkspaceID == workspaceID {
					got[m.ID] = true
				}
			}
		}
	}
	got := claimed()
	if len(got) != free {
		t.Fatalf("Free should run %d monitors, ran %d", free, len(got))
	}
	for _, id := range ids[:free] {
		if !got[id] {
			t.Fatalf("the oldest monitors run first; %d didn't", id)
		}
	}

	// The list says which ones wait.
	list, err := st.ListMonitors(ctx, workspaceID)
	if err != nil {
		t.Fatal(err)
	}
	over := overPlan(len(list), func(i int) (int64, bool) { return list[i].ID, list[i].Enabled }, free)
	waiting := 0
	for i, m := range list {
		if over[i] {
			waiting++
			if m.ID != ids[free] && m.ID != ids[free+1] {
				t.Fatalf("monitor %d marked over the plan, but it is among the oldest", m.ID)
			}
		}
	}
	if waiting != 2 {
		t.Fatalf("expected 2 monitors marked over the plan, got %d", waiting)
	}

	// Back on Pro, the two that waited run too.
	if err := st.SetWorkspacePlan(ctx, workspaceID, "pro"); err != nil {
		t.Fatal(err)
	}
	if got := claimed(); !got[ids[free]] || !got[ids[free+1]] {
		t.Fatalf("on Pro the waiting monitors should run, got %v", got)
	}
}

func TestOverPlan(t *testing.T) {
	type it struct {
		id     int64
		active bool
	}
	items := []it{{5, true}, {1, true}, {3, false}, {9, true}, {2, true}}
	over := overPlan(len(items), func(i int) (int64, bool) { return items[i].id, items[i].active }, 2)
	// Active by age: 1, 2, 5, 9. The limit of 2 keeps 1 and 2 running.
	want := []bool{true, false, false, true, false}
	for i := range want {
		if over[i] != want[i] {
			t.Fatalf("item %d (id %d): got %v, want %v", i, items[i].id, over[i], want[i])
		}
	}
}
