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

	"qnetward/internal/store"
)

// A host rule fires once when every sample in its window is over the
// threshold, stays quiet while it stays over, and clears once the window is
// all below. Rules can't point at another workspace's hosts.
func TestHostAlertRules(t *testing.T) {
	st := installTestStore(t)
	user, cookie := issueTestSession(t, st)
	_, otherCookie := issueTestSession(t, st)
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()
	ws := testWorkspaceID(t, st, user.ID)

	call := func(c *http.Cookie, handler http.HandlerFunc, method, path, body string) *httptest.ResponseRecorder {
		req := httptest.NewRequest(method, path, strings.NewReader(body))
		req.Header.Set("Content-Type", "application/json")
		req.AddCookie(c)
		rr := httptest.NewRecorder()
		handler(rr, req)
		return rr
	}

	rr := call(cookie, testSrv.handleAgents, http.MethodPost, "/api/agents", `{"name":"web-1"}`)
	var created agentCreateResponse
	_ = json.Unmarshal(rr.Body.Bytes(), &created)
	agentID := created.Agent.ID

	for _, bad := range []string{`{"metric":"gpu","threshold":90,"minutes":5}`, `{"metric":"cpu","threshold":150,"minutes":5}`, `{"metric":"cpu","threshold":90,"minutes":0}`} {
		if rr := call(cookie, testSrv.handleHostAlerts, http.MethodPost, "/api/hosts/alerts", bad); rr.Code != http.StatusBadRequest {
			t.Fatalf("%s: expected 400, got %d", bad, rr.Code)
		}
	}
	if rr := call(otherCookie, testSrv.handleHostAlerts, http.MethodPost, "/api/hosts/alerts", fmt.Sprintf(`{"agent_id":%d,"metric":"cpu","threshold":90,"minutes":5}`, agentID)); rr.Code != http.StatusBadRequest {
		t.Fatalf("another workspace's host is refused, got %d", rr.Code)
	}
	rr = call(cookie, testSrv.handleHostAlerts, http.MethodPost, "/api/hosts/alerts", fmt.Sprintf(`{"agent_id":%d,"metric":"cpu","threshold":90,"minutes":5}`, agentID))
	if rr.Code != http.StatusCreated {
		t.Fatalf("create: %d %s", rr.Code, rr.Body.String())
	}
	var rule store.HostAlertRule
	_ = json.Unmarshal(rr.Body.Bytes(), &rule)

	now := time.Now().UTC().Truncate(time.Minute)
	samples := func(from time.Time, cpu float64) []store.HostSample {
		var out []store.HostSample
		for i := 0; i < 5; i++ {
			out = append(out, store.HostSample{At: from.Add(time.Duration(i) * time.Minute), CPU: cpu, MemUsed: 100, MemTotal: 1000})
		}
		return out
	}
	mine := func(changes []store.HostAlertChange) []store.HostAlertChange {
		var out []store.HostAlertChange
		for _, c := range changes {
			if c.Rule.ID == rule.ID {
				out = append(out, c)
			}
		}
		return out
	}

	// Four high minutes aren't enough for a five-minute rule... until the
	// window is mostly covered; one low sample keeps it quiet.
	mixed := samples(now.Add(-4*time.Minute), 97)
	mixed[2].CPU = 40
	if _, err := st.RecordHostMetrics(ctx, agentID, ws, nil, mixed); err != nil {
		t.Fatal(err)
	}
	changes, err := st.EvaluateHostAlerts(ctx, now.Add(30*time.Second))
	if err != nil || len(mine(changes)) != 0 {
		t.Fatalf("a dip inside the window keeps the rule quiet: %+v %v", mine(changes), err)
	}

	if _, err := st.RecordHostMetrics(ctx, agentID, ws, nil, samples(now.Add(time.Minute), 97)); err != nil {
		t.Fatal(err)
	}
	at := now.Add(5*time.Minute + 30*time.Second)
	changes, err = st.EvaluateHostAlerts(ctx, at)
	got := mine(changes)
	if err != nil || len(got) != 1 || !got[0].Firing || got[0].Value != 97 || got[0].AgentName != "web-1" {
		t.Fatalf("five high minutes fire: %+v %v", got, err)
	}
	fired := got[0]
	if changes, _ := st.EvaluateHostAlerts(ctx, at); len(mine(changes)) != 0 {
		t.Fatal("a firing rule doesn't alert again")
	}
	in := hostAlert(fired, "https://x/hosts")
	if !strings.Contains(in.Title, "CPU at 97%") || in.Severity != "critical" {
		t.Fatalf("alert text: %+v", in)
	}

	rr = call(cookie, testSrv.handleHostAlerts, http.MethodGet, "/api/hosts/alerts", "")
	var list struct {
		Rules []store.HostAlertRule `json:"rules"`
	}
	_ = json.Unmarshal(rr.Body.Bytes(), &list)
	if len(list.Rules) != 1 || len(list.Rules[0].Firing) != 1 || list.Rules[0].Firing[0].AgentID != agentID {
		t.Fatalf("the list shows where a rule fires: %s", rr.Body.String())
	}
	if rr := call(otherCookie, testSrv.handleHostAlerts, http.MethodGet, "/api/hosts/alerts", ""); strings.Contains(rr.Body.String(), fmt.Sprintf(`"id": %d`, rule.ID)) {
		t.Fatalf("another workspace doesn't see the rule: %s", rr.Body.String())
	}

	if _, err := st.RecordHostMetrics(ctx, agentID, ws, nil, samples(now.Add(6*time.Minute), 20)); err != nil {
		t.Fatal(err)
	}
	changes, err = st.EvaluateHostAlerts(ctx, now.Add(10*time.Minute+30*time.Second))
	if got := mine(changes); err != nil || len(got) != 1 || got[0].Firing {
		t.Fatalf("a window all below clears it: %+v %v", got, err)
	}

	if rr := call(otherCookie, testSrv.handleHostAlerts, http.MethodDelete, fmt.Sprintf("/api/hosts/alerts?id=%d", rule.ID), ""); rr.Code != http.StatusNotFound {
		t.Fatalf("another workspace can't delete the rule, got %d", rr.Code)
	}
	if rr := call(cookie, testSrv.handleHostAlerts, http.MethodDelete, fmt.Sprintf("/api/hosts/alerts?id=%d", rule.ID), ""); rr.Code != http.StatusOK {
		t.Fatalf("delete: %d", rr.Code)
	}
}
