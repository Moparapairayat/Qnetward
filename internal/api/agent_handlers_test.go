package api

import (
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"
)

// An agent is created in the console, enrolls once with its token, checks in
// with its secret, and stops working the moment it's removed.
func TestAgentEnrollHeartbeatAndRemove(t *testing.T) {
	st := installTestStore(t)
	_, cookie := issueTestSession(t, st)

	console := func(method, path, body string) *httptest.ResponseRecorder {
		req := httptest.NewRequest(method, path, strings.NewReader(body))
		req.Header.Set("Content-Type", "application/json")
		req.AddCookie(cookie)
		rr := httptest.NewRecorder()
		testSrv.handleAgents(rr, req)
		return rr
	}
	agentCall := func(handler http.HandlerFunc, secret, body string) *httptest.ResponseRecorder {
		req := httptest.NewRequest(http.MethodPost, "/api/agent", strings.NewReader(body))
		req.Header.Set("Content-Type", "application/json")
		if secret != "" {
			req.Header.Set("Authorization", "Bearer "+secret)
		}
		rr := httptest.NewRecorder()
		handler(rr, req)
		return rr
	}

	rr := console(http.MethodPost, "/api/agents", `{"name":"  Dhaka   office  "}`)
	if rr.Code != http.StatusCreated {
		t.Fatalf("create: got %d: %s", rr.Code, rr.Body.String())
	}
	var created agentCreateResponse
	_ = json.Unmarshal(rr.Body.Bytes(), &created)
	if !strings.HasPrefix(created.EnrollToken, "qne_") || created.Agent.Name != "Dhaka office" || created.Agent.Enrolled {
		t.Fatalf("unexpected create response %s", rr.Body.String())
	}

	if rr := agentCall(testSrv.handleAgentEnroll, "", `{"token":"qne_wrong","hostname":"x"}`); rr.Code != http.StatusUnauthorized {
		t.Fatalf("wrong token: expected 401, got %d", rr.Code)
	}
	rr = agentCall(testSrv.handleAgentEnroll, "", fmt.Sprintf(`{"token":%q,"hostname":"edge-01","version":"0.1.0","platform":"linux/amd64"}`, created.EnrollToken))
	if rr.Code != http.StatusOK {
		t.Fatalf("enroll: got %d: %s", rr.Code, rr.Body.String())
	}
	var enrolled struct {
		Secret string `json:"secret"`
	}
	_ = json.Unmarshal(rr.Body.Bytes(), &enrolled)
	if !strings.HasPrefix(enrolled.Secret, "qna_") {
		t.Fatalf("expected an agent secret, got %s", rr.Body.String())
	}
	if rr := agentCall(testSrv.handleAgentEnroll, "", fmt.Sprintf(`{"token":%q}`, created.EnrollToken)); rr.Code != http.StatusUnauthorized {
		t.Fatalf("a used token must not enroll again, got %d", rr.Code)
	}

	if rr := agentCall(testSrv.handleAgentHeartbeat, enrolled.Secret, `{"version":"0.1.1"}`); rr.Code != http.StatusOK {
		t.Fatalf("heartbeat: got %d: %s", rr.Code, rr.Body.String())
	}
	if rr := agentCall(testSrv.handleAgentHeartbeat, "qna_not-a-real-secret", `{}`); rr.Code != http.StatusUnauthorized {
		t.Fatalf("bad secret: expected 401, got %d", rr.Code)
	}

	rr = console(http.MethodGet, "/api/agents", "")
	var list struct {
		Agents []struct {
			Name     string `json:"name"`
			Enrolled bool   `json:"enrolled"`
			Online   bool   `json:"online"`
			Hostname string `json:"hostname"`
			Version  string `json:"version"`
		} `json:"agents"`
	}
	_ = json.Unmarshal(rr.Body.Bytes(), &list)
	if len(list.Agents) != 1 || !list.Agents[0].Enrolled || !list.Agents[0].Online || list.Agents[0].Hostname != "edge-01" || list.Agents[0].Version != "0.1.1" {
		t.Fatalf("unexpected list %s", rr.Body.String())
	}
	if strings.Contains(rr.Body.String(), "qna_") || strings.Contains(rr.Body.String(), "qne_") {
		t.Fatal("the list must never include tokens or secrets")
	}

	if rr := console(http.MethodDelete, fmt.Sprintf("/api/agents?id=%d", created.Agent.ID), ""); rr.Code != http.StatusOK {
		t.Fatalf("delete: got %d", rr.Code)
	}
	if rr := agentCall(testSrv.handleAgentHeartbeat, enrolled.Secret, `{}`); rr.Code != http.StatusUnauthorized {
		t.Fatalf("a removed agent must be refused, got %d", rr.Code)
	}
}

// A monitor set to run from an agent reaches it in the heartbeat, its results
// are recorded with the agent's id, and the agent can't report for monitors
// it doesn't run.
func TestAgentRunsAssignedMonitors(t *testing.T) {
	st := installTestStore(t)
	user, cookie := issueTestSession(t, st)

	call := func(handler http.HandlerFunc, method, path, secret, body string) *httptest.ResponseRecorder {
		req := httptest.NewRequest(method, path, strings.NewReader(body))
		req.Header.Set("Content-Type", "application/json")
		if secret != "" {
			req.Header.Set("Authorization", "Bearer "+secret)
		} else {
			req.AddCookie(cookie)
		}
		rr := httptest.NewRecorder()
		handler(rr, req)
		return rr
	}

	rr := call(testSrv.handleAgents, http.MethodPost, "/api/agents", "", `{"name":"Office"}`)
	var created agentCreateResponse
	_ = json.Unmarshal(rr.Body.Bytes(), &created)
	rr = call(testSrv.handleAgentEnroll, http.MethodPost, "/api/agent/enroll", "", fmt.Sprintf(`{"token":%q}`, created.EnrollToken))
	var enrolled struct {
		Secret string `json:"secret"`
	}
	_ = json.Unmarshal(rr.Body.Bytes(), &enrolled)
	if enrolled.Secret == "" {
		t.Fatalf("enroll failed: %s", rr.Body.String())
	}

	if rr := call(testSrv.handleMonitors, http.MethodPost, "/api/monitors", "", `{"protocol":"tcpping","target":"10.0.0.5","port":22,"interval_seconds":60,"agent_id":987654}`); rr.Code != http.StatusBadRequest {
		t.Fatalf("an unknown agent must be refused, got %d: %s", rr.Code, rr.Body.String())
	}
	rr = call(testSrv.handleMonitors, http.MethodPost, "/api/monitors", "", fmt.Sprintf(`{"name":"NAS","protocol":"tcpping","target":"10.0.0.5","port":22,"interval_seconds":60,"agent_id":%d}`, created.Agent.ID))
	if rr.Code != http.StatusCreated {
		t.Fatalf("create monitor: got %d: %s", rr.Code, rr.Body.String())
	}
	var onAgent struct {
		ID        int64 `json:"id"`
		Locations []struct {
			AgentID int64  `json:"agent_id"`
			Name    string `json:"name"`
		} `json:"locations"`
	}
	_ = json.Unmarshal(rr.Body.Bytes(), &onAgent)
	if len(onAgent.Locations) != 1 || onAgent.Locations[0].AgentID != created.Agent.ID || onAgent.Locations[0].Name != "Office" {
		t.Fatalf("monitor should name its agent: %s", rr.Body.String())
	}
	rr = call(testSrv.handleMonitors, http.MethodPost, "/api/monitors", "", `{"name":"Site","protocol":"http","target":"https://example.com/","interval_seconds":60}`)
	var onServer struct {
		ID int64 `json:"id"`
	}
	_ = json.Unmarshal(rr.Body.Bytes(), &onServer)

	// The server's scheduler leaves the agent's monitor alone.
	due, err := st.ClaimDueMonitors(t.Context(), 50)
	if err != nil {
		t.Fatal(err)
	}
	for _, m := range due {
		if m.ID == onAgent.ID {
			t.Fatal("the server must not claim a monitor that runs from an agent")
		}
	}

	rr = call(testSrv.handleAgentHeartbeat, http.MethodPost, "/api/agent/heartbeat", enrolled.Secret, `{}`)
	var beat struct {
		Jobs []agentJob `json:"jobs"`
	}
	_ = json.Unmarshal(rr.Body.Bytes(), &beat)
	if len(beat.Jobs) != 1 || beat.Jobs[0].MonitorID != onAgent.ID || beat.Jobs[0].Target != "10.0.0.5" || beat.Jobs[0].Port == nil || *beat.Jobs[0].Port != 22 {
		t.Fatalf("heartbeat should carry the agent's monitor: %s", rr.Body.String())
	}

	now := time.Now().UTC().Format(time.RFC3339Nano)
	body := fmt.Sprintf(`{"results":[
		{"monitor_id":%d,"checked_at":%q,"ok":true,"rtt_ms":4.2,"loss_percent":0,
			"samples":[{"seq":1,"rtt_ms":4.0,"addr":"10.0.0.5"},{"seq":2,"rtt_ms":4.4,"addr":"10.0.0.5"},{"seq":3,"error":"timeout"}]},
		{"monitor_id":%d,"checked_at":%q,"ok":false,"error":"forged"}
	]}`, onAgent.ID, now, onServer.ID, now)
	if rr := call(testSrv.handleAgentResults, http.MethodPost, "/api/agent/results", "qna_wrong", body); rr.Code != http.StatusUnauthorized {
		t.Fatalf("bad secret: expected 401, got %d", rr.Code)
	}
	rr = call(testSrv.handleAgentResults, http.MethodPost, "/api/agent/results", enrolled.Secret, body)
	if rr.Code != http.StatusOK || !strings.Contains(strings.ReplaceAll(rr.Body.String(), " ", ""), `"accepted":1`) {
		t.Fatalf("results: got %d: %s", rr.Code, rr.Body.String())
	}
	testSrv.background.Wait()

	// The check's samples land in History like the server's own.
	waitFor(t, 10*time.Second, func() bool {
		points, err := st.QueryHistory(testWorkspaceID(t, st, user.ID), "tcpping", "10.0.0.5", 22, 10)
		return err == nil && len(points) == 3
	})

	rr = call(testSrv.handleMonitors, http.MethodGet, "/api/monitors", "", "")
	var list []struct {
		ID           int64  `json:"id"`
		Status       string `json:"status"`
		RecentChecks []struct {
			OK      bool  `json:"ok"`
			AgentID int64 `json:"agent_id"`
		} `json:"recent_checks"`
	}
	_ = json.Unmarshal(rr.Body.Bytes(), &list)
	for _, m := range list {
		switch m.ID {
		case onAgent.ID:
			if m.Status != "up" || len(m.RecentChecks) != 1 || m.RecentChecks[0].AgentID != created.Agent.ID {
				t.Fatalf("the agent's check should be recorded with its id: %+v", m)
			}
		case onServer.ID:
			if len(m.RecentChecks) != 0 || m.Status != "pending" {
				t.Fatalf("an agent must not report for a monitor it doesn't run: %+v", m)
			}
		}
	}

	// Removing the agent hands its monitor back to the server.
	call(testSrv.handleAgents, http.MethodDelete, fmt.Sprintf("/api/agents?id=%d", created.Agent.ID), "", "")
	rr = call(testSrv.handleMonitors, http.MethodGet, "/api/monitors", "", "")
	if strings.Contains(rr.Body.String(), `"Office"`) {
		t.Fatalf("monitor should be back on the server: %s", rr.Body.String())
	}
}
