package api

import (
	"bufio"
	"context"
	"net"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"qnetward/internal/store"
)

// A console's stream hears its own workspace's monitor checks, as they're
// recorded, and nothing from other workspaces.
func TestEventsStreamMonitorChecks(t *testing.T) {
	st := installTestStore(t)
	user, cookie := issueTestSession(t, st)
	workspaceID := testWorkspaceID(t, st, user.ID)

	server := httptest.NewServer(testSrv.Handler())
	defer server.Close()
	ctx, cancel := context.WithTimeout(context.Background(), 20*time.Second)
	defer cancel()
	req, _ := http.NewRequestWithContext(ctx, http.MethodGet, server.URL+"/api/events", nil)
	req.AddCookie(cookie)
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatalf("connect: %v", err)
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK || !strings.HasPrefix(resp.Header.Get("Content-Type"), "text/event-stream") {
		t.Fatalf("expected an event stream, got %d %q", resp.StatusCode, resp.Header.Get("Content-Type"))
	}
	lines := make(chan string, 32)
	go func() {
		sc := bufio.NewScanner(resp.Body)
		for sc.Scan() {
			lines <- sc.Text()
		}
		close(lines)
	}()
	waitLine := func(prefix string) string {
		t.Helper()
		for {
			select {
			case line, ok := <-lines:
				if !ok {
					t.Fatalf("stream closed while waiting for %q", prefix)
				}
				if strings.HasPrefix(line, prefix) {
					return line
				}
			case <-ctx.Done():
				t.Fatalf("timed out waiting for %q", prefix)
			}
		}
	}
	waitLine(": connected")

	// Another workspace's event must not arrive; ours must.
	testSrv.events.publish(workspaceID+1_000_000, liveEvent{Type: "monitor.check", MonitorID: 1})

	ln, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatalf("listen: %v", err)
	}
	port := ln.Addr().(*net.TCPAddr).Port
	_ = ln.Close()
	m, err := st.SaveMonitor(ctx, store.Monitor{WorkspaceID: workspaceID, UserID: user.ID, Protocol: "tcpping", Target: "127.0.0.1", Port: &port, IntervalSeconds: 60, Enabled: true}, 20)
	if err != nil {
		t.Fatalf("save monitor: %v", err)
	}
	m.WorkspaceID, m.UserID = workspaceID, user.ID
	testSrv.checkMonitor(ctx, m)

	if line := waitLine("event: "); line != "event: monitor.check" {
		t.Fatalf("expected a monitor.check event, got %q", line)
	}
	data := waitLine("data: ")
	if !strings.Contains(data, `"status":"down"`) || strings.Contains(data, "1000000") {
		t.Fatalf("unexpected event data %q", data)
	}
}

func TestEventHubCapsStreamsPerWorkspace(t *testing.T) {
	h := newEventHub()
	var cancels []func()
	for i := 0; i < eventMaxPerWorkspace; i++ {
		_, cancel, ok := h.subscribe(7)
		if !ok {
			t.Fatalf("stream %d refused early", i)
		}
		cancels = append(cancels, cancel)
	}
	if _, _, ok := h.subscribe(7); ok {
		t.Fatal("expected the cap to refuse another stream")
	}
	if _, _, ok := h.subscribe(8); !ok {
		t.Fatal("another workspace has its own allowance")
	}
	cancels[0]()
	if _, _, ok := h.subscribe(7); !ok {
		t.Fatal("closing a stream should free a slot")
	}
}
