package api

import (
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
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
