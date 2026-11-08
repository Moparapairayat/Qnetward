package main

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"runtime"
	"strings"
	"sync/atomic"
	"testing"
	"time"
)

// The agent enrolls once, keeps its secret in a private file, checks in with
// it on later runs, and stops when the console has removed it.
func TestAgentEnrollsThenChecksIn(t *testing.T) {
	var removed atomic.Bool
	var heartbeats atomic.Int32
	mux := http.NewServeMux()
	mux.HandleFunc("/api/agent/enroll", func(w http.ResponseWriter, r *http.Request) {
		var body map[string]string
		_ = json.NewDecoder(r.Body).Decode(&body)
		if body["token"] != "qne_good" {
			w.WriteHeader(http.StatusUnauthorized)
			_, _ = w.Write([]byte(`{"error":"token expired"}`))
			return
		}
		_, _ = w.Write([]byte(`{"agent_id":4,"name":"edge","secret":"qna_secret","heartbeat_seconds":30}`))
	})
	mux.HandleFunc("/api/agent/heartbeat", func(w http.ResponseWriter, r *http.Request) {
		if removed.Load() || r.Header.Get("Authorization") != "Bearer qna_secret" {
			w.WriteHeader(http.StatusUnauthorized)
			return
		}
		heartbeats.Add(1)
		_, _ = w.Write([]byte(`{"heartbeat_seconds":30,"jobs":[]}`))
	})
	srv := httptest.NewServer(mux)
	defer srv.Close()

	dir := t.TempDir()
	var out bytes.Buffer
	ctx := context.Background()

	if err := agentMain(ctx, srv.URL, "", dir, true, &out); err == nil || !strings.Contains(err.Error(), "not enrolled") {
		t.Fatalf("without credentials or a token: got %v", err)
	}
	if err := agentMain(ctx, srv.URL, "qne_bad", dir, true, &out); err == nil || !strings.Contains(err.Error(), "token expired") {
		t.Fatalf("bad token: got %v", err)
	}
	if err := agentMain(ctx, srv.URL, "qne_good", dir, true, &out); err != nil {
		t.Fatalf("enroll: %v", err)
	}
	info, err := os.Stat(filepath.Join(dir, "agent.json"))
	if err != nil {
		t.Fatalf("credentials not saved: %v", err)
	}
	if runtime.GOOS != "windows" && info.Mode().Perm() != 0o600 {
		t.Fatalf("credentials must be private, got %v", info.Mode().Perm())
	}

	// A later run needs no flags.
	if err := agentMain(ctx, "", "", dir, true, &out); err != nil {
		t.Fatalf("second run: %v", err)
	}
	if heartbeats.Load() != 2 {
		t.Fatalf("expected two check-ins, got %d", heartbeats.Load())
	}

	removed.Store(true)
	if err := agentMain(ctx, "", "", dir, true, &out); !errors.Is(err, errAgentRemoved) {
		t.Fatalf("removed agent: got %v", err)
	}
}

// A running agent picks up the monitors in its heartbeat, checks them itself,
// and sends the results back.
func TestAgentRunsJobsAndSendsResults(t *testing.T) {
	listener, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	defer listener.Close()
	go func() {
		for {
			conn, err := listener.Accept()
			if err != nil {
				return
			}
			conn.Close()
		}
	}()
	port := listener.Addr().(*net.TCPAddr).Port

	got := make(chan agentResult, 4)
	mux := http.NewServeMux()
	mux.HandleFunc("/api/agent/heartbeat", func(w http.ResponseWriter, r *http.Request) {
		_, _ = fmt.Fprintf(w, `{"heartbeat_seconds":30,"jobs":[{"monitor_id":7,"protocol":"tcpping","target":"127.0.0.1","port":%d,"interval_seconds":60}]}`, port)
	})
	mux.HandleFunc("/api/agent/results", func(w http.ResponseWriter, r *http.Request) {
		var body struct {
			Results []agentResult `json:"results"`
		}
		_ = json.NewDecoder(r.Body).Decode(&body)
		for _, res := range body.Results {
			got <- res
		}
		_, _ = w.Write([]byte(`{"accepted":1}`))
	})
	srv := httptest.NewServer(mux)
	defer srv.Close()

	dir := t.TempDir()
	if err := saveAgentState(filepath.Join(dir, "agent.json"), &agentState{Server: srv.URL, AgentID: 1, Name: "edge", Secret: "qna_secret"}); err != nil {
		t.Fatal(err)
	}
	old := agentFlushEvery
	agentFlushEvery = 200 * time.Millisecond
	defer func() { agentFlushEvery = old }()

	ctx, cancel := context.WithTimeout(context.Background(), 20*time.Second)
	defer cancel()
	done := make(chan error, 1)
	go func() { done <- agentMain(ctx, "", "", dir, false, io.Discard) }()

	select {
	case res := <-got:
		if res.MonitorID != 7 || !res.OK || res.RttMs == nil || res.CheckedAt.IsZero() {
			t.Fatalf("unexpected result %+v", res)
		}
	case <-ctx.Done():
		t.Fatal("no result arrived")
	}
	cancel()
	if err := <-done; !errors.Is(err, context.Canceled) {
		t.Fatalf("agent should stop with the context, got %v", err)
	}
}

func TestJobRunnerSync(t *testing.T) {
	r := newJobRunner()
	r.sync([]agentJob{{MonitorID: 1, Protocol: "ping", Target: "a", IntervalSeconds: 60}, {MonitorID: 2, Protocol: "ping", Target: "b", IntervalSeconds: 60}})
	r.jobs[1].next = time.Now().Add(time.Hour)
	r.sync([]agentJob{{MonitorID: 1, Protocol: "ping", Target: "a", IntervalSeconds: 60}})
	if r.count() != 1 || time.Until(r.jobs[1].next) < time.Minute {
		t.Fatal("an unchanged job keeps its schedule and a dropped one goes away")
	}
	r.sync([]agentJob{{MonitorID: 1, Protocol: "ping", Target: "c", IntervalSeconds: 60}})
	if time.Until(r.jobs[1].next) > time.Second {
		t.Fatal("a changed job runs at once")
	}
}
