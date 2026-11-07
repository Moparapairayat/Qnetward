package api

import (
	"encoding/json"
	"fmt"
	"net"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"qnetward/internal/store"

	"qnetward/internal/platform/netguard"
)

func TestHandlePingRejectsInvalidPayload(t *testing.T) {
	st := installTestStore(t)
	req := httptest.NewRequest(http.MethodPost, "/api/ping", strings.NewReader(`{"host":"example.com","count":101}`))
	req.Header.Set("Content-Type", "application/json")
	req.AddCookie(issueTestSessionCookie(t, st))
	rr := httptest.NewRecorder()

	testSrv.handlePing(rr, req)

	if rr.Code != http.StatusBadRequest {
		t.Fatalf("expected 400, got %d", rr.Code)
	}

	var resp apiError
	if err := json.Unmarshal(rr.Body.Bytes(), &resp); err != nil {
		t.Fatalf("failed to decode response: %v", err)
	}
	if !strings.Contains(resp.Error, "count must be") {
		t.Fatalf("unexpected error message: %q", resp.Error)
	}
}

func TestHandlePingRejectsContinuousOverHTTP(t *testing.T) {
	st := installTestStore(t)
	req := httptest.NewRequest(http.MethodPost, "/api/ping", strings.NewReader(`{"host":"example.com","continuous":true}`))
	req.Header.Set("Content-Type", "application/json")
	req.AddCookie(issueTestSessionCookie(t, st))
	rr := httptest.NewRecorder()

	testSrv.handlePing(rr, req)

	if rr.Code != http.StatusBadRequest {
		t.Fatalf("expected 400, got %d", rr.Code)
	}
	if !strings.Contains(rr.Body.String(), "continuous mode requires realtime streaming") {
		t.Fatalf("unexpected body: %s", rr.Body.String())
	}
}

func TestHandlePingRejectsForbiddenOrigin(t *testing.T) {
	st := installTestStore(t)
	req := httptest.NewRequest(http.MethodPost, "/api/ping", strings.NewReader(`{"host":"example.com"}`))
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Origin", "http://evil.example")
	req.Host = "127.0.0.1:8080"
	req.AddCookie(issueTestSessionCookie(t, st))
	rr := httptest.NewRecorder()

	testSrv.handlePing(rr, req)

	if rr.Code != http.StatusForbidden {
		t.Fatalf("expected 403, got %d", rr.Code)
	}
}

func TestHandlePingRejectsOversizedBody(t *testing.T) {
	st := installTestStore(t)
	host := strings.Repeat("a", maxJSONBodyBytes)
	req := httptest.NewRequest(http.MethodPost, "/api/ping", strings.NewReader(`{"host":"`+host+`"}`))
	req.Header.Set("Content-Type", "application/json")
	req.AddCookie(issueTestSessionCookie(t, st))
	rr := httptest.NewRecorder()

	testSrv.handlePing(rr, req)

	if rr.Code != http.StatusBadRequest {
		t.Fatalf("expected 400, got %d", rr.Code)
	}
	if !strings.Contains(rr.Body.String(), "request body too large") {
		t.Fatalf("unexpected body: %s", rr.Body.String())
	}
}

func TestHandlePingRejectsTrailingJSON(t *testing.T) {
	st := installTestStore(t)
	req := httptest.NewRequest(http.MethodPost, "/api/ping", strings.NewReader(`{"host":"example.com"}{"extra":true}`))
	req.Header.Set("Content-Type", "application/json")
	req.AddCookie(issueTestSessionCookie(t, st))
	rr := httptest.NewRecorder()

	testSrv.handlePing(rr, req)

	if rr.Code != http.StatusBadRequest {
		t.Fatalf("expected 400, got %d", rr.Code)
	}
	if !strings.Contains(rr.Body.String(), "single JSON object") {
		t.Fatalf("unexpected body: %s", rr.Body.String())
	}
}

func TestHandlePortScanRejectsInvalidPayload(t *testing.T) {
	st := installTestStore(t)
	req := httptest.NewRequest(http.MethodPost, "/api/portscan", strings.NewReader(`{"host":"example.com","ports":"80-9000"}`))
	req.Header.Set("Content-Type", "application/json")
	req.AddCookie(issueTestSessionCookie(t, st))
	rr := httptest.NewRecorder()

	testSrv.handlePortScan(rr, req)

	if rr.Code != http.StatusBadRequest {
		t.Fatalf("expected 400, got %d", rr.Code)
	}
	if !strings.Contains(rr.Body.String(), "scan is limited") {
		t.Fatalf("unexpected body: %s", rr.Body.String())
	}
}

func TestHandleDNSLookupRejectsEmptyTarget(t *testing.T) {
	st := installTestStore(t)
	req := httptest.NewRequest(http.MethodPost, "/api/dnslookup", strings.NewReader(`{"target":""}`))
	req.Header.Set("Content-Type", "application/json")
	req.AddCookie(issueTestSessionCookie(t, st))
	rr := httptest.NewRecorder()

	testSrv.handleDNSLookup(rr, req)

	if rr.Code != http.StatusBadRequest {
		t.Fatalf("expected 400, got %d", rr.Code)
	}
	if !strings.Contains(rr.Body.String(), "host is required") {
		t.Fatalf("unexpected body: %s", rr.Body.String())
	}
}

func TestHandleTCPPingStoresPerProbeTimestamps(t *testing.T) {
	st := installTestStore(t)
	user, cookie := issueTestSession(t, st)

	ln, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatalf("listen failed: %v", err)
	}
	defer ln.Close()

	done := make(chan struct{})
	go func() {
		defer close(done)
		for {
			conn, err := ln.Accept()
			if err != nil {
				return
			}
			_ = conn.Close()
		}
	}()

	port := ln.Addr().(*net.TCPAddr).Port
	body := fmt.Sprintf(`{"host":"127.0.0.1","port":%d,"count":2,"interval_ms":120,"timeout_ms":500}`, port)
	req := httptest.NewRequest(http.MethodPost, "/api/tcpping", strings.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	req.AddCookie(cookie)
	rr := httptest.NewRecorder()

	testSrv.handleTCPPing(rr, req)

	if rr.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d: %s", rr.Code, rr.Body.String())
	}

	var points []store.HistoryPoint
	waitFor(t, 2*time.Second, func() bool {
		var err error
		points, err = st.QueryHistory(testWorkspaceID(t, st, user.ID), "tcpping", "127.0.0.1", port, 10)
		return err == nil && len(points) == 2
	})

	if points[0].Ts == points[1].Ts {
		t.Fatalf("expected distinct timestamps, got %d and %d", points[0].Ts, points[1].Ts)
	}

	_ = ln.Close()
	<-done
}

func TestHandleTCPPingRejectsContinuousOverHTTP(t *testing.T) {
	st := installTestStore(t)
	req := httptest.NewRequest(http.MethodPost, "/api/tcpping", strings.NewReader(`{"host":"example.com","port":443,"continuous":true}`))
	req.Header.Set("Content-Type", "application/json")
	req.AddCookie(issueTestSessionCookie(t, st))
	rr := httptest.NewRecorder()

	testSrv.handleTCPPing(rr, req)

	if rr.Code != http.StatusBadRequest {
		t.Fatalf("expected 400, got %d", rr.Code)
	}
	if !strings.Contains(rr.Body.String(), "continuous mode requires realtime streaming") {
		t.Fatalf("unexpected body: %s", rr.Body.String())
	}
}

// Traceroute refuses private targets and out-of-range settings before
// sending anything.
func TestTracerouteValidatesRequests(t *testing.T) {
	st := installTestStore(t)
	_, cookie := issueTestSession(t, st)
	withTargetPolicy(t, netguard.Policy{})
	for body, want := range map[string]int{
		`{"target":""}`:                        http.StatusBadRequest,
		`{"target":"10.0.0.1"}`:                http.StatusBadRequest,
		`{"target":"8.8.8.8","max_hops":90}`:   http.StatusBadRequest,
		`{"target":"8.8.8.8","timeout_ms":10}`: http.StatusBadRequest,
		`{"target":"8.8.8.8","queries":12}`:    http.StatusBadRequest,
	} {
		req := httptest.NewRequest(http.MethodPost, "/api/traceroute", strings.NewReader(body))
		req.Header.Set("Content-Type", "application/json")
		req.AddCookie(cookie)
		rr := httptest.NewRecorder()
		testSrv.handleTraceroute(rr, req)
		if rr.Code != want {
			t.Errorf("%s: expected %d, got %d: %s", body, want, rr.Code, rr.Body.String())
		}
	}
}
