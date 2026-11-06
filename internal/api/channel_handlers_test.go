package api

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"testing"
	"time"

	"qnetward/internal/platform/notify"
	"qnetward/internal/store"
)

// A webhook channel gets a signing secret once, receives a signed test
// message, keeps its destination through an edit, and hears about a monitor
// going down.
func TestWebhookChannelLifecycle(t *testing.T) {
	st := installTestStore(t)
	user, cookie := issueTestSession(t, st)
	workspaceID := testWorkspaceID(t, st, user.ID)

	var mu sync.Mutex
	var received []notify.Message
	var signatures []bool
	var secret string
	hook := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		body, _ := io.ReadAll(r.Body)
		var m notify.Message
		_ = json.Unmarshal(body, &m)
		mu.Lock()
		received = append(received, m)
		signatures = append(signatures, r.Header.Get("X-Qnetward-Signature") == notify.Sign(secret, r.Header.Get("X-Qnetward-Timestamp"), body))
		mu.Unlock()
	}))
	defer hook.Close()

	call := func(method, path, body string, handler http.HandlerFunc) *httptest.ResponseRecorder {
		req := httptest.NewRequest(method, path, strings.NewReader(body))
		req.Header.Set("Content-Type", "application/json")
		req.AddCookie(cookie)
		rr := httptest.NewRecorder()
		handler(rr, req)
		return rr
	}

	rr := call(http.MethodPost, "/api/workspace/channels", fmt.Sprintf(`{"kind":"webhook","name":"Ops hook","url":%q,"events":["monitors"]}`, hook.URL+"/in/token-abcd"), testSrv.handleChannels)
	if rr.Code != http.StatusCreated {
		t.Fatalf("create: expected 201, got %d: %s", rr.Code, rr.Body.String())
	}
	var created channelSaveResponse
	_ = json.Unmarshal(rr.Body.Bytes(), &created)
	if !strings.HasPrefix(created.SigningSecret, "whsec_") || created.Channel.Target == "" || strings.Contains(rr.Body.String(), "token-abcd") {
		t.Fatalf("expected a signing secret and a masked target, got %s", rr.Body.String())
	}
	secret = created.SigningSecret
	id := created.Channel.ID

	rr = call(http.MethodPost, "/api/workspace/channels/test", fmt.Sprintf(`{"id":%d}`, id), testSrv.handleChannelTest)
	if rr.Code != http.StatusOK || !testOK(t, rr) {
		t.Fatalf("test send: got %d: %s", rr.Code, rr.Body.String())
	}

	// Renaming leaves the URL and the signing secret alone.
	rr = call(http.MethodPost, "/api/workspace/channels", fmt.Sprintf(`{"id":%d,"name":"Ops webhook","events":["monitors","certificates"]}`, id), testSrv.handleChannels)
	if rr.Code != http.StatusOK || strings.Contains(rr.Body.String(), "signing_secret") {
		t.Fatalf("update: got %d: %s", rr.Code, rr.Body.String())
	}

	// A monitor that can't be reached goes down and the channel hears about it.
	ln, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatalf("listen: %v", err)
	}
	port := ln.Addr().(*net.TCPAddr).Port
	_ = ln.Close()
	m, err := st.SaveMonitor(context.Background(), store.Monitor{WorkspaceID: workspaceID, UserID: user.ID, Name: "Closed port", Protocol: "tcpping", Target: "127.0.0.1", Port: &port, IntervalSeconds: 60, Enabled: true}, 20)
	if err != nil {
		t.Fatalf("save monitor: %v", err)
	}
	m.WorkspaceID, m.UserID = workspaceID, user.ID
	testSrv.checkMonitor(context.Background(), m)
	waitFor(t, 10*time.Second, func() bool {
		mu.Lock()
		defer mu.Unlock()
		return len(received) == 2
	})
	mu.Lock()
	if received[0].Event != "test" || received[1].Event != "monitor.down" || received[1].Severity != "critical" || !signatures[0] || !signatures[1] {
		t.Fatalf("unexpected deliveries %+v (signatures %v)", received, signatures)
	}
	mu.Unlock()

	rr = call(http.MethodGet, "/api/workspace/channels", "", testSrv.handleChannels)
	var list struct {
		Channels []store.Channel `json:"channels"`
	}
	_ = json.Unmarshal(rr.Body.Bytes(), &list)
	if len(list.Channels) != 1 || list.Channels[0].Name != "Ops webhook" || list.Channels[0].LastSentAt == nil || len(list.Channels[0].Events) != 2 {
		t.Fatalf("unexpected list %s", rr.Body.String())
	}

	if rr := call(http.MethodDelete, fmt.Sprintf("/api/workspace/channels?id=%d", id), "", testSrv.handleChannels); rr.Code != http.StatusOK {
		t.Fatalf("delete: got %d: %s", rr.Code, rr.Body.String())
	}
}

// A channel whose destination fails reports the reason, and the list shows it.
func TestChannelTestReportsFailures(t *testing.T) {
	st := installTestStore(t)
	_, cookie := issueTestSession(t, st)
	hook := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		http.Error(w, `{"message":"unknown webhook"}`, http.StatusNotFound)
	}))
	defer hook.Close()

	req := httptest.NewRequest(http.MethodPost, "/api/workspace/channels", strings.NewReader(fmt.Sprintf(`{"kind":"webhook","name":"Broken","url":%q,"events":["alert_rules"]}`, hook.URL)))
	req.AddCookie(cookie)
	rr := httptest.NewRecorder()
	testSrv.handleChannels(rr, req)
	var created channelSaveResponse
	_ = json.Unmarshal(rr.Body.Bytes(), &created)

	req = httptest.NewRequest(http.MethodPost, "/api/workspace/channels/test", strings.NewReader(fmt.Sprintf(`{"id":%d}`, created.Channel.ID)))
	req.AddCookie(cookie)
	rr = httptest.NewRecorder()
	testSrv.handleChannelTest(rr, req)
	if testOK(t, rr) || !strings.Contains(rr.Body.String(), "unknown webhook") {
		t.Fatalf("expected the failure reason, got %s", rr.Body.String())
	}

	for _, bad := range []string{
		`{"kind":"slack","name":"x","url":"https://example.com/hook","events":["monitors"]}`,
		`{"kind":"webhook","name":"x","url":"https://example.com/hook","events":[]}`,
		`{"kind":"pager","name":"x","url":"https://example.com/hook","events":["monitors"]}`,
	} {
		req := httptest.NewRequest(http.MethodPost, "/api/workspace/channels", strings.NewReader(bad))
		req.AddCookie(cookie)
		rr := httptest.NewRecorder()
		testSrv.handleChannels(rr, req)
		if rr.Code != http.StatusBadRequest {
			t.Errorf("%s: expected 400, got %d: %s", bad, rr.Code, rr.Body.String())
		}
	}
}

func testOK(t *testing.T, rr *httptest.ResponseRecorder) bool {
	t.Helper()
	var body struct {
		OK bool `json:"ok"`
	}
	if err := json.Unmarshal(rr.Body.Bytes(), &body); err != nil {
		t.Fatalf("decode %s: %v", rr.Body.String(), err)
	}
	return body.OK
}
