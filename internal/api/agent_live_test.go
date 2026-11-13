package api

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/gorilla/websocket"

	"qnetward/internal/store"
)

// An agent's live link carries commands to it (live mode, sync, run now) and
// its live readings to open consoles, unstored.
func TestAgentLiveLink(t *testing.T) {
	st := installTestStore(t)
	user, cookie := issueTestSession(t, st)
	workspaceID := testWorkspaceID(t, st, user.ID)
	server := httptest.NewServer(testSrv.Handler())
	defer server.Close()
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()

	call := func(method, path, secret, body string) *http.Response {
		req, _ := http.NewRequestWithContext(ctx, method, server.URL+path, strings.NewReader(body))
		req.Header.Set("Content-Type", "application/json")
		req.Header.Set("Origin", server.URL)
		if secret != "" {
			req.Header.Set("Authorization", "Bearer "+secret)
		} else {
			req.AddCookie(cookie)
		}
		resp, err := http.DefaultClient.Do(req)
		if err != nil {
			t.Fatal(err)
		}
		return resp
	}
	resp := call(http.MethodPost, "/api/agents", "", `{"name":"edge-1"}`)
	var created agentCreateResponse
	_ = json.NewDecoder(resp.Body).Decode(&created)
	resp.Body.Close()
	resp = call(http.MethodPost, "/api/agent/enroll", "", fmt.Sprintf(`{"token":%q}`, created.EnrollToken))
	var enrolled struct {
		Secret string `json:"secret"`
	}
	_ = json.NewDecoder(resp.Body).Decode(&enrolled)
	resp.Body.Close()

	wsURL := "ws" + strings.TrimPrefix(server.URL, "http") + "/api/agent/live"
	if _, resp, err := websocket.DefaultDialer.Dial(wsURL, http.Header{"Authorization": {"Bearer qna_wrong"}}); err == nil || resp.StatusCode != http.StatusUnauthorized {
		t.Fatal("a bad secret is refused")
	}
	conn, _, err := websocket.DefaultDialer.Dial(wsURL, http.Header{"Authorization": {"Bearer " + enrolled.Secret}})
	if err != nil {
		t.Fatalf("dial: %v", err)
	}
	defer conn.Close()
	read := func() map[string]any {
		t.Helper()
		_ = conn.SetReadDeadline(time.Now().Add(10 * time.Second))
		_, data, err := conn.ReadMessage()
		if err != nil {
			t.Fatalf("read: %v", err)
		}
		var m map[string]any
		_ = json.Unmarshal(data, &m)
		return m
	}
	if m := read(); m["type"] != "hello" {
		t.Fatalf("the link opens with hello: %v", m)
	}

	// Live mode: the console asks, the agent hears it.
	resp = call(http.MethodPost, fmt.Sprintf("/api/hosts/live?id=%d", created.Agent.ID), "", "")
	resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("live: %d", resp.StatusCode)
	}
	if m := read(); m["type"] != "live" || m["every_ms"] != float64(1000) {
		t.Fatalf("the agent is told to stream: %v", m)
	}

	// Its readings reach the workspace's consoles, without an id (not stored).
	events, stop, _ := testSrv.events.subscribe(workspaceID)
	defer stop()
	sample := `{"type":"host_sample","host":{"cpu":42.5,"mem_used":100,"mem_total":1000,"disks":[]}}`
	if err := conn.WriteMessage(websocket.TextMessage, []byte(sample)); err != nil {
		t.Fatal(err)
	}
	waitEvent := func(typ string) liveEvent {
		t.Helper()
		deadline := time.After(10 * time.Second)
		for {
			select {
			case e := <-events:
				if e.Type == typ {
					return e
				}
			case <-deadline:
				t.Fatalf("no %s event", typ)
			}
		}
	}
	e := waitEvent(EventHostLive)
	if e.ID != 0 || !strings.Contains(string(e.Data), `"cpu":42.5`) || !strings.Contains(string(e.Data), fmt.Sprintf(`"agent_id":%d`, created.Agent.ID)) {
		t.Fatalf("live reading: %+v %s", e, e.Data)
	}

	// Changing monitors syncs the agent at once; Run now runs its location.
	port := 9
	m, err := st.SaveMonitor(ctx, store.Monitor{WorkspaceID: workspaceID, UserID: user.ID, Name: "via agent", Protocol: "tcpping", Target: "192.0.2.1", Port: &port,
		IntervalSeconds: 60, Enabled: true, LocationIDs: []int64{created.Agent.ID}}, 20)
	if err != nil {
		t.Fatal(err)
	}
	testSrv.syncAgents(workspaceID)
	if m := read(); m["type"] != "sync" {
		t.Fatalf("the agent is told to fetch its work: %v", m)
	}
	resp = call(http.MethodPost, fmt.Sprintf("/api/monitors/run?id=%d", m.ID), "", "")
	resp.Body.Close()
	if resp.StatusCode != http.StatusAccepted {
		t.Fatalf("run now: %d", resp.StatusCode)
	}
	if got := read(); got["type"] != "run" || got["monitor_id"] != float64(m.ID) {
		t.Fatalf("the agent is told to run it: %v", got)
	}
	resp = call(http.MethodPost, fmt.Sprintf("/api/monitors/run?id=%d", m.ID), "", "")
	resp.Body.Close()
	if resp.StatusCode != http.StatusTooManyRequests {
		t.Fatalf("a second run within ten seconds is refused, got %d", resp.StatusCode)
	}

	// A device this agent doesn't poll is ignored.
	_ = conn.WriteMessage(websocket.TextMessage, []byte(`{"type":"device_sample","device":{"device_id":999999,"reachable":true}}`))
	select {
	case e := <-events:
		if e.Type == EventDeviceLive {
			t.Fatalf("a foreign device's reading must not pass: %+v", e)
		}
	case <-time.After(time.Second):
	}
	testSrv.background.Wait()
}
