package api

import (
	"context"
	"fmt"
	"net/http"
	"net/http/httptest"
	"os"
	"strings"
	"testing"
	"time"

	"qnetward/internal/platform/mailer"
	"qnetward/internal/platform/netguard"
	"qnetward/internal/store"
)

func openTestStore(t *testing.T) *store.Store {
	t.Helper()

	dsn := strings.TrimSpace(os.Getenv("QNETWARD_TEST_POSTGRES_DSN"))
	if dsn == "" {
		t.Skip("QNETWARD_TEST_POSTGRES_DSN is not set")
	}

	st, err := store.OpenConfigured(store.Config{
		DSN:           dsn,
		BatchSize:     1,
		FlushInterval: 5 * time.Millisecond,
		TableName:     testTableName(t.Name()),
	})
	if err != nil {
		t.Fatalf("open test store: %v", err)
	}
	t.Cleanup(func() {
		_ = st.Close()
	})
	return st
}

func installTestStore(t *testing.T) *store.Store {
	t.Helper()

	st := openTestStore(t)
	oldStore := testSrv.store
	oldCache := testSrv.cache
	oldObjectStore := testSrv.objects
	testSrv.store = st
	testSrv.cache = nil
	testSrv.objects = nil
	t.Cleanup(func() {
		// Alert deliveries and rule checks still running from this test read the store.
		testSrv.background.Wait()
		testSrv.store = oldStore
		testSrv.cache = oldCache
		testSrv.objects = oldObjectStore
	})
	return st
}

func installFailingTestMailer(t *testing.T) {
	t.Helper()

	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusInternalServerError)
		_, _ = w.Write([]byte(`{"message":"mailer unavailable"}`))
	}))
	t.Cleanup(srv.Close)

	client, err := mailer.Open(mailer.Config{
		APIKey:   "test-key",
		From:     "Qnetward <alerts@example.com>",
		ReplyTo:  "support@example.com",
		Endpoint: srv.URL,
		Timeout:  5 * time.Second,
	})
	if err != nil {
		t.Fatalf("open test mailer: %v", err)
	}

	previous := testSrv.mailer
	testSrv.mailer = client
	t.Cleanup(func() {
		testSrv.mailer = previous
	})
}

func issueTestSessionCookie(t *testing.T, st *store.Store) *http.Cookie {
	t.Helper()
	_, cookie := issueTestSession(t, st)
	return cookie
}

func issueTestSession(t *testing.T, st *store.Store) (store.User, *http.Cookie) {
	t.Helper()

	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()

	email := fmt.Sprintf("session_%d@example.com", time.Now().UnixNano())
	user, err := st.CreateUser(ctx, "Session Test User", email, "test-password-hash", false)
	if err != nil {
		t.Fatalf("create session test user: %v", err)
	}

	req := httptest.NewRequest(http.MethodGet, "http://127.0.0.1", nil)
	rr := httptest.NewRecorder()
	if err := testSrv.issueSession(rr, req, ctx, user); err != nil {
		t.Fatalf("issue session: %v", err)
	}

	return user, extractAuthCookie(t, rr.Result())
}

// testWorkspaceID returns the user's personal workspace, where their probe
// results and alert rules land until they switch.
func testWorkspaceID(t *testing.T, st *store.Store, userID int64) int64 {
	t.Helper()
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	workspace, err := st.GetWorkspaceContextByUserID(ctx, userID)
	if err != nil {
		t.Fatalf("personal workspace for user %d: %v", userID, err)
	}
	return workspace.ID
}

func resetAuthRateLimiterForTest(t *testing.T) {
	t.Helper()

	previous := testSrv.authLimiter
	testSrv.authLimiter = newRateLimiter()
	t.Cleanup(func() {
		testSrv.authLimiter = previous
	})
}

func waitFor(t *testing.T, timeout time.Duration, cond func() bool) {
	t.Helper()

	deadline := time.Now().Add(timeout)
	for time.Now().Before(deadline) {
		if cond() {
			return
		}
		time.Sleep(10 * time.Millisecond)
	}
	t.Fatal("condition not met before timeout")
}

func float64Ptr(v float64) *float64 {
	return &v
}

func fillProbeLimiter() {
	for i := 0; i < maxConcurrentProbes; i++ {
		testSrv.probeLimiter <- struct{}{}
	}
}

func drainProbeLimiter() {
	for {
		select {
		case <-testSrv.probeLimiter:
		default:
			return
		}
	}
}

func extractAuthCookie(t *testing.T, resp *http.Response) *http.Cookie {
	t.Helper()

	for _, cookie := range resp.Cookies() {
		if cookie.Name == authCookieName {
			return cookie
		}
	}
	t.Fatal("expected auth cookie")
	return nil
}

func testTableName(name string) string {
	name = strings.ToLower(name)
	var b strings.Builder
	b.WriteString("test_")
	for _, r := range name {
		if (r >= 'a' && r <= 'z') || (r >= '0' && r <= '9') {
			b.WriteRune(r)
			continue
		}
		b.WriteByte('_')
	}
	b.WriteString("_")
	b.WriteString(fmt.Sprintf("%d", time.Now().UnixNano()))
	return b.String()
}

// testSrv is the server the handler tests exercise. A test that changes one of
// its fields restores the old value in t.Cleanup.
var testSrv = newTestServer()

func newTestServer() *Server {
	// Handler tests probe listeners on 127.0.0.1; the hosted default blocks that.
	return New(Deps{}, Options{TargetPolicy: netguard.Policy{AllowPrivate: true}})
}
