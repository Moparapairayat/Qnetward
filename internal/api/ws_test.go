package api

import (
	"net"
	"net/http"
	"net/http/httptest"
	"qnetward/internal/probe"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/gorilla/websocket"
)

// newWSTestServer serves handleWS for one test. Its cleanup runs before the
// test store is swapped out (cleanups run last in, first out, and the store is
// installed first): it closes the server and waits for every handler to
// return, so nothing a handler still does, such as writing an audit event,
// races the swap.
func newWSTestServer(t *testing.T) *httptest.Server {
	t.Helper()
	var running sync.WaitGroup
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		running.Add(1)
		defer running.Done()
		testSrv.handleWS(w, r)
	}))
	t.Cleanup(func() {
		server.Close()
		running.Wait()
	})
	return server
}

func TestIsAllowedWSOriginAcceptsSameHostAndRejectsDifferentHost(t *testing.T) {
	req := httptest.NewRequest(http.MethodGet, "http://127.0.0.1:8080/ws", nil)
	req.Host = "127.0.0.1:8080"

	if !testSrv.isAllowedWSOrigin(req, "http://127.0.0.1:8080") {
		t.Fatal("expected same host origin to be allowed")
	}
	if testSrv.isAllowedWSOrigin(req, "http://example.com:8080") {
		t.Fatal("expected different host origin to be rejected")
	}
}

func TestHandleWSRejectsInvalidPingRequest(t *testing.T) {
	st := installTestStore(t)
	cookie := issueTestSessionCookie(t, st)

	server := newWSTestServer(t)

	wsURL := "ws" + strings.TrimPrefix(server.URL, "http") + "/ws"
	header := http.Header{}
	header.Set("Origin", server.URL)
	header.Add("Cookie", cookie.Name+"="+cookie.Value)

	conn, _, err := websocket.DefaultDialer.Dial(wsURL, header)
	if err != nil {
		t.Fatalf("websocket dial failed: %v", err)
	}
	defer conn.Close()

	if err := conn.WriteJSON(wsRequest{Type: "ping", Host: "example.com", Count: probe.MaxCount + 1}); err != nil {
		t.Fatalf("write failed: %v", err)
	}

	var evt wsEvent
	if err := conn.ReadJSON(&evt); err != nil {
		t.Fatalf("read failed: %v", err)
	}
	if evt.Type != "error" {
		t.Fatalf("expected error event, got %q", evt.Type)
	}
	if !strings.Contains(evt.Error, "count must be") {
		t.Fatalf("unexpected websocket error: %q", evt.Error)
	}
}

func TestHandleWSRejectsInvalidPortScanRequest(t *testing.T) {
	st := installTestStore(t)
	cookie := issueTestSessionCookie(t, st)

	server := newWSTestServer(t)

	wsURL := "ws" + strings.TrimPrefix(server.URL, "http") + "/ws"
	header := http.Header{}
	header.Set("Origin", server.URL)
	header.Add("Cookie", cookie.Name+"="+cookie.Value)

	conn, _, err := websocket.DefaultDialer.Dial(wsURL, header)
	if err != nil {
		t.Fatalf("websocket dial failed: %v", err)
	}
	defer conn.Close()

	if err := conn.WriteJSON(wsRequest{Type: "portscan", Host: "example.com", Ports: "1-9000"}); err != nil {
		t.Fatalf("write failed: %v", err)
	}

	var evt wsEvent
	if err := conn.ReadJSON(&evt); err != nil {
		t.Fatalf("read failed: %v", err)
	}
	if evt.Type != "error" {
		t.Fatalf("expected error event, got %q", evt.Type)
	}
	if !strings.Contains(evt.Error, "scan is limited") {
		t.Fatalf("unexpected websocket error: %q", evt.Error)
	}
}

func TestHandleWSRejectsWhenProbeLimiterFull(t *testing.T) {
	fillProbeLimiter()
	defer drainProbeLimiter()
	st := installTestStore(t)
	cookie := issueTestSessionCookie(t, st)

	server := newWSTestServer(t)

	wsURL := "ws" + strings.TrimPrefix(server.URL, "http") + "/ws"
	header := http.Header{}
	header.Set("Origin", server.URL)
	header.Add("Cookie", cookie.Name+"="+cookie.Value)

	conn, _, err := websocket.DefaultDialer.Dial(wsURL, header)
	if err != nil {
		t.Fatalf("websocket dial failed: %v", err)
	}
	defer conn.Close()

	if err := conn.WriteJSON(wsRequest{Type: "ping", Host: "example.com", Count: 1}); err != nil {
		t.Fatalf("write failed: %v", err)
	}

	var evt wsEvent
	if err := conn.ReadJSON(&evt); err != nil {
		t.Fatalf("read failed: %v", err)
	}
	if evt.Type != "error" || !strings.Contains(evt.Error, "server busy") {
		t.Fatalf("unexpected websocket event: %#v", evt)
	}
}

func TestHandleWSStopCancelsActiveRun(t *testing.T) {
	st := installTestStore(t)
	cookie := issueTestSessionCookie(t, st)

	ln, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatalf("listen failed: %v", err)
	}
	defer ln.Close()

	acceptDone := make(chan struct{})
	go func() {
		defer close(acceptDone)
		for {
			conn, err := ln.Accept()
			if err != nil {
				return
			}
			_ = conn.Close()
		}
	}()

	server := newWSTestServer(t)

	wsURL := "ws" + strings.TrimPrefix(server.URL, "http") + "/ws"
	header := http.Header{}
	header.Set("Origin", server.URL)
	header.Add("Cookie", cookie.Name+"="+cookie.Value)

	conn, _, err := websocket.DefaultDialer.Dial(wsURL, header)
	if err != nil {
		t.Fatalf("websocket dial failed: %v", err)
	}
	defer conn.Close()

	port := ln.Addr().(*net.TCPAddr).Port
	if err := conn.WriteJSON(wsRequest{Type: "tcpping", Host: "127.0.0.1", Port: port, Count: 50, IntervalMs: 5000, TimeoutMs: 200}); err != nil {
		t.Fatalf("write failed: %v", err)
	}

	_ = conn.SetReadDeadline(time.Now().Add(2 * time.Second))

	var evt wsEvent
	if err := conn.ReadJSON(&evt); err != nil {
		t.Fatalf("read first event failed: %v", err)
	}
	if evt.Type != "result" {
		t.Fatalf("expected first event to be result, got %#v", evt)
	}

	if err := conn.WriteJSON(wsRequest{Type: "stop"}); err != nil {
		t.Fatalf("stop write failed: %v", err)
	}

	_ = conn.SetReadDeadline(time.Now().Add(2 * time.Second))
	if err := conn.ReadJSON(&evt); err != nil {
		t.Fatalf("read stopped event failed: %v", err)
	}
	if evt.Type != "stopped" {
		t.Fatalf("expected stopped event, got %#v", evt)
	}
	if evt.Summary == nil {
		t.Fatal("expected partial summary on stopped event")
	}
	if evt.Summary.Sent < 1 || evt.Summary.Sent >= 50 {
		t.Fatalf("expected partial run summary, got sent=%d", evt.Summary.Sent)
	}

	_ = ln.Close()
	<-acceptDone
}
