package store

import (
	"context"
	"fmt"
	"testing"
	"time"
)

// A payment applies once, stacks on time already paid for, and the plan
// falls back to Free when the period runs out. A plan set by hand never expires.
func TestPaymentsExtendAndExpirePlans(t *testing.T) {
	st := openTestStore(t, Config{BatchSize: 1, FlushInterval: 5 * time.Millisecond})
	ctx, cancel := context.WithTimeout(context.Background(), 60*time.Second)
	defer cancel()

	user, err := st.CreateUser(ctx, "Payer", testEmail("payer"), "hash", false)
	if err != nil {
		t.Fatalf("CreateUser returned error: %v", err)
	}
	workspaceID := mustOwnedWorkspaceID(t, st, user.ID)
	// Invoice IDs are unique across the shared test database.
	run := fmt.Sprintf("%d", time.Now().UnixNano())

	pay := func(months int) Payment {
		t.Helper()
		p, err := st.CreatePayment(ctx, Payment{WorkspaceID: workspaceID, UserID: user.ID, Provider: "uddoktapay", Plan: "pro", Months: months, Amount: 1500, Currency: "BDT"})
		if err != nil {
			t.Fatalf("CreatePayment returned error: %v", err)
		}
		return p
	}

	first := pay(1)
	if _, applied, err := st.CompletePayment(ctx, first.ID, "INV-"+run+"-1", "TX1", "bkash"); err != nil || !applied {
		t.Fatalf("first completion: applied %v, err %v", applied, err)
	}
	expiry, _ := st.WorkspacePlanExpiry(ctx, workspaceID)
	if expiry == nil || expiry.Before(time.Now().AddDate(0, 0, 27)) || expiry.After(time.Now().AddDate(0, 1, 1)) {
		t.Fatalf("expected about a month of Pro, got %v", expiry)
	}
	if _, applied, _ := st.CompletePayment(ctx, first.ID, "INV-"+run+"-1", "TX1", "bkash"); applied {
		t.Fatal("completing the same payment twice must not add time again")
	}
	again, _ := st.WorkspacePlanExpiry(ctx, workspaceID)
	if !again.Equal(*expiry) {
		t.Fatalf("expiry moved on a repeat: %v then %v", expiry, again)
	}

	second := pay(12)
	if _, _, err := st.CompletePayment(ctx, second.ID, "INV-"+run+"-2", "TX2", "nagad"); err != nil {
		t.Fatalf("second completion: %v", err)
	}
	stacked, _ := st.WorkspacePlanExpiry(ctx, workspaceID)
	if want := expiry.AddDate(0, 12, 0); stacked.Sub(want).Abs() > time.Minute {
		t.Fatalf("expected twelve months after the first period, got %v (want about %v)", stacked, want)
	}
	if list, _ := st.ListPayments(ctx, workspaceID); len(list) != 2 || list[0].Status != "paid" {
		t.Fatalf("expected two paid payments, got %+v", list)
	}

	if _, err := st.db.ExecContext(ctx, `UPDATE workspaces SET plan_expires_at = NOW() - INTERVAL '1 minute' WHERE id = $1`, workspaceID); err != nil {
		t.Fatalf("backdating: %v", err)
	}
	if _, err := st.ExpirePlans(ctx); err != nil {
		t.Fatalf("ExpirePlans returned error: %v", err)
	}
	var plan string
	_ = st.db.QueryRowContext(ctx, `SELECT plan FROM workspaces WHERE id = $1`, workspaceID).Scan(&plan)
	if gone, _ := st.WorkspacePlanExpiry(ctx, workspaceID); plan != "free" || gone != nil {
		t.Fatalf("expected Free with no expiry after the period, got %q, %v", plan, gone)
	}

	if err := st.SetWorkspacePlan(ctx, workspaceID, "enterprise"); err != nil {
		t.Fatalf("SetWorkspacePlan returned error: %v", err)
	}
	if manual, _ := st.WorkspacePlanExpiry(ctx, workspaceID); manual != nil {
		t.Fatalf("a plan set by hand shouldn't expire, got %v", manual)
	}
}
