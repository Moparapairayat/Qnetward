package api

import (
	"bufio"
	"context"
	"fmt"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"qnetward/internal/store"
)

// A public page's visitors hear "update" when one of its monitors changes
// status, nothing for other monitors, nothing that names targets or errors,
// and "gone" when the page is unpublished.
func TestPublicStatusPageStream(t *testing.T) {
	st := installTestStore(t)
	user, _ := issueTestSession(t, st)
	workspaceID := testWorkspaceID(t, st, user.ID)
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()

	port := 443
	shown, err := st.SaveMonitor(ctx, store.Monitor{WorkspaceID: workspaceID, UserID: user.ID, Name: "API", Protocol: "tcpping", Target: "secret-host.internal.example", Port: &port, IntervalSeconds: 60, Enabled: true}, 20)
	if err != nil {
		t.Fatal(err)
	}
	other, err := st.SaveMonitor(ctx, store.Monitor{WorkspaceID: workspaceID, UserID: user.ID, Name: "Other", Protocol: "tcpping", Target: "other.example", Port: &port, IntervalSeconds: 60, Enabled: true}, 20)
	if err != nil {
		t.Fatal(err)
	}
	slug := fmt.Sprintf("live-%d", time.Now().UnixNano()%1_000_000)
	page, err := st.SaveStatusPage(ctx, store.StatusPage{WorkspaceID: workspaceID, Slug: slug, Title: "Acme", Published: true, Monitors: []store.StatusPageMonitor{{MonitorID: shown.ID, Label: "API"}}}, 10)
	if err != nil {
		t.Fatal(err)
	}

	server := httptest.NewServer(testSrv.Handler())
	defer server.Close()
	if resp, err := http.Get(server.URL + "/api/public/status/no-such-page/events"); err != nil || resp.StatusCode != http.StatusNotFound {
		t.Fatalf("an unknown page is 404")
	}
	req, _ := http.NewRequestWithContext(ctx, http.MethodGet, server.URL+"/api/public/status/"+slug+"/events", nil)
	resp, err := http.DefaultClient.Do(req)
	if err != nil || resp.StatusCode != http.StatusOK {
		t.Fatalf("connect: %v", err)
	}
	defer resp.Body.Close()
	lines := make(chan string, 64)
	go func() {
		sc := bufio.NewScanner(resp.Body)
		for sc.Scan() {
			lines <- sc.Text()
		}
		close(lines)
	}()
	next := func(wait time.Duration) string {
		t.Helper()
		deadline := time.After(wait)
		for {
			select {
			case l, ok := <-lines:
				if !ok {
					return "closed"
				}
				if strings.Contains(l, "secret-host") || strings.Contains(l, "other.example") {
					t.Fatalf("a public stream must not carry targets: %q", l)
				}
				if strings.HasPrefix(l, "event: ") {
					return strings.TrimPrefix(l, "event: ")
				}
			case <-deadline:
				return ""
			}
		}
	}
	if e := next(5 * time.Second); e != "ready" {
		t.Fatalf("a stream starts with ready, got %q", e)
	}

	// Another monitor changing says nothing.
	testSrv.events.publish(workspaceID, liveEvent{Type: EventMonitor, MonitorID: other.ID, Status: "down"})
	if e := next(2500 * time.Millisecond); e != "" {
		t.Fatalf("a monitor not on the page is silent, got %q", e)
	}
	// The page's monitor going down is an update; the same status again isn't.
	testSrv.events.publish(workspaceID, liveEvent{Type: EventMonitor, MonitorID: shown.ID, Status: "down"})
	if e := next(5 * time.Second); e != "update" {
		t.Fatalf("a status change updates the page, got %q", e)
	}
	testSrv.events.publish(workspaceID, liveEvent{Type: EventMonitor, MonitorID: shown.ID, Status: "down"})
	if e := next(2500 * time.Millisecond); e != "" {
		t.Fatalf("the same status again is silent, got %q", e)
	}

	// Unpublishing ends the stream.
	page.Published = false
	if _, err := st.SaveStatusPage(ctx, page, 10); err != nil {
		t.Fatal(err)
	}
	testSrv.events.publish(workspaceID, liveEvent{Type: EventStatusPage})
	if e := next(5 * time.Second); e != "gone" {
		t.Fatalf("an unpublished page is gone, got %q", e)
	}
}
