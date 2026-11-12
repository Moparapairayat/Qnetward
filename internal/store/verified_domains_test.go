package store

import (
	"context"
	"testing"
	"time"
)

// A verified domain survives a short gap in its proof, lapses after a week
// without it, and is verified again when the proof comes back.
func TestVerifiedDomainLapses(t *testing.T) {
	st := openTestStore(t, Config{BatchSize: 1, FlushInterval: 5 * time.Millisecond})
	ctx, cancel := context.WithTimeout(context.Background(), 60*time.Second)
	defer cancel()
	owner, err := st.CreateUser(ctx, "Domain Owner", testEmail("domain-owner"), "hash", false)
	if err != nil {
		t.Fatal(err)
	}
	workspaceID := mustOwnedWorkspaceID(t, st, owner.ID)
	d, err := st.AddDomain(ctx, VerifiedDomain{WorkspaceID: workspaceID, UserID: owner.ID, Domain: "lapse.example", Token: "qnetward-verify=abc"}, 0)
	if err != nil {
		t.Fatal(err)
	}
	d, _, err = st.RecordDomainCheck(ctx, d, DomainCheckResult{Found: true, Method: "http"})
	if err != nil || d.Status != "verified" {
		t.Fatalf("verify: %+v %v", d, err)
	}
	if time.Until(d.NextCheckAt) < 23*time.Hour {
		t.Fatalf("a verified domain is re-checked daily, next at %s", d.NextCheckAt)
	}

	d, _, _ = st.RecordDomainCheck(ctx, d, DomainCheckResult{Error: "gone"})
	if d.Status != "verified" || time.Until(d.NextCheckAt) > 7*time.Hour {
		t.Fatalf("a short gap keeps it verified and checks again sooner: %+v", d)
	}
	if _, err := st.db.ExecContext(ctx, `UPDATE verified_domains SET last_seen_at = NOW() - INTERVAL '8 days' WHERE id = $1`, d.ID); err != nil {
		t.Fatal(err)
	}
	d, before, _ := st.RecordDomainCheck(ctx, d, DomainCheckResult{Error: "gone"})
	if d.Status != "lapsed" || before != "verified" {
		t.Fatalf("a week without proof lapses it: %+v", d)
	}
	if _, err := st.VerifiedDomainFor(ctx, workspaceID, "lapse.example"); err == nil {
		t.Fatal("a lapsed domain must not allow deep checks")
	}
	d, before, _ = st.RecordDomainCheck(ctx, d, DomainCheckResult{Found: true, Method: "dns"})
	if d.Status != "verified" || before != "lapsed" || d.Method != "dns" {
		t.Fatalf("proof back verifies it again: %+v", d)
	}
}
