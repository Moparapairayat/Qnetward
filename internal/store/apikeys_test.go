package store

import (
	"context"
	"errors"
	"testing"
	"time"
)

func TestAPIKeyLifecycle(t *testing.T) {
	st := openTestStore(t, Config{BatchSize: 1, FlushInterval: 5 * time.Millisecond})

	ctx, cancel := context.WithTimeout(context.Background(), 60*time.Second)
	defer cancel()

	user, err := st.CreateUser(ctx, "Key Maker", testEmail("apikey"), "hash", false)
	if err != nil {
		t.Fatalf("CreateUser returned error: %v", err)
	}
	other, err := st.CreateUser(ctx, "Other", testEmail("apikey-other"), "hash", false)
	if err != nil {
		t.Fatalf("CreateUser returned error: %v", err)
	}
	workspaceID := mustOwnedWorkspaceID(t, st, user.ID)
	otherWorkspaceID := mustOwnedWorkspaceID(t, st, other.ID)
	hash := "hash-" + testEmail("token")

	if _, err := st.CreateAPIKey(ctx, APIKey{WorkspaceID: workspaceID, Name: "ci", Prefix: "qnw_x", Scopes: []string{"admin"}}, hash, 0); err == nil {
		t.Fatal("expected an unknown scope to be rejected")
	}

	key, err := st.CreateAPIKey(ctx, APIKey{WorkspaceID: workspaceID, CreatedBy: user.ID, Name: " CI deploys ", Prefix: "qnw_abcdef", Scopes: []string{"probe", "read", "read"}}, hash, 0)
	if err != nil {
		t.Fatalf("CreateAPIKey returned error: %v", err)
	}
	if key.Name != "CI deploys" || len(key.Scopes) != 2 || key.Scopes[0] != "read" || key.Scopes[1] != "probe" {
		t.Fatalf("expected a trimmed name and ordered, unique scopes, got %#v", key)
	}

	found, err := st.AuthenticateAPIKey(ctx, hash, "198.51.100.4")
	if err != nil || found.ID != key.ID || found.WorkspaceID != workspaceID || !found.HasScope("probe") || found.HasScope("write") {
		t.Fatalf("AuthenticateAPIKey: %#v, err %v", found, err)
	}

	keys, err := st.ListAPIKeys(ctx, workspaceID)
	if err != nil || len(keys) != 1 || keys[0].LastUsedAt == nil || keys[0].LastUsedIP != "198.51.100.4" || keys[0].CreatorName != "Key Maker" {
		t.Fatalf("ListAPIKeys: %#v, err %v", keys, err)
	}
	if list, err := st.ListAPIKeys(ctx, otherWorkspaceID); err != nil || len(list) != 0 {
		t.Fatalf("another workspace saw %d key(s), err %v", len(list), err)
	}
	if _, err := st.RevokeAPIKey(ctx, otherWorkspaceID, key.ID); !errors.Is(err, ErrAPIKeyNotFound) {
		t.Fatalf("expected ErrAPIKeyNotFound revoking from another workspace, got %v", err)
	}

	revoked, err := st.RevokeAPIKey(ctx, workspaceID, key.ID)
	if err != nil || revoked.RevokedAt == nil {
		t.Fatalf("RevokeAPIKey: %#v, err %v", revoked, err)
	}
	if _, err := st.AuthenticateAPIKey(ctx, hash, ""); !errors.Is(err, ErrAPIKeyNotFound) {
		t.Fatalf("expected a revoked key to stop working, got %v", err)
	}

	// An expired key stops working too.
	expiredHash := hash + "-expired"
	soon := time.Now().Add(2 * time.Second)
	if _, err := st.CreateAPIKey(ctx, APIKey{WorkspaceID: workspaceID, Name: "short", Prefix: "qnw_short", Scopes: []string{"read"}, ExpiresAt: &soon}, expiredHash, 0); err != nil {
		t.Fatalf("CreateAPIKey (expiring) returned error: %v", err)
	}
	if _, err := st.db.ExecContext(ctx, `UPDATE api_keys SET expires_at = NOW() - INTERVAL '1 minute' WHERE token_hash = $1`, expiredHash); err != nil {
		t.Fatalf("expire key: %v", err)
	}
	if _, err := st.AuthenticateAPIKey(ctx, expiredHash, ""); !errors.Is(err, ErrAPIKeyNotFound) {
		t.Fatalf("expected an expired key to stop working, got %v", err)
	}
}
