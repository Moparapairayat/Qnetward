package main

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"runtime"
	"strings"
	"sync/atomic"
	"testing"
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
