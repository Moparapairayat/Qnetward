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

// A device is added with sealed credentials, handed to its agent with them,
// and shown in the console without them. Polls update its state and history.
func TestNetworkDevices(t *testing.T) {
	st := installTestStore(t)
	_, cookie := issueTestSession(t, st)
	_, otherCookie := issueTestSession(t, st)

	call := func(handler http.HandlerFunc, method, path, secret string, c *http.Cookie, body string) *httptest.ResponseRecorder {
		req := httptest.NewRequest(method, path, strings.NewReader(body))
		req.Header.Set("Content-Type", "application/json")
		if secret != "" {
			req.Header.Set("Authorization", "Bearer "+secret)
		} else if c != nil {
			req.AddCookie(c)
		}
		rr := httptest.NewRecorder()
		handler(rr, req)
		return rr
	}

	rr := call(testSrv.handleAgents, http.MethodPost, "/api/agents", "", cookie, `{"name":"office"}`)
	var created agentCreateResponse
	_ = json.Unmarshal(rr.Body.Bytes(), &created)
	rr = call(testSrv.handleAgentEnroll, http.MethodPost, "/api/agent/enroll", "", nil, fmt.Sprintf(`{"token":%q}`, created.EnrollToken))
	var enrolled struct {
		Secret string `json:"secret"`
	}
	_ = json.Unmarshal(rr.Body.Bytes(), &enrolled)
	agentID := created.Agent.ID

	for _, bad := range []string{
		`{"name":"sw","address":"not an address!","version":"2c","community":"public"}`,
		`{"name":"sw","address":"10.0.0.2","version":"1","community":"public"}`,
		`{"name":"sw","address":"10.0.0.2","version":"2c"}`,
		`{"name":"sw","address":"10.0.0.2","version":"3","username":"mon","auth_protocol":"sha","auth_password":"short"}`,
		`{"name":"sw","address":"10.0.0.2","version":"3","username":"mon","auth_protocol":"none","priv_protocol":"aes","priv_password":"longenough1"}`,
	} {
		if rr := call(testSrv.handleDevices, http.MethodPost, "/api/devices", "", cookie, bad); rr.Code != http.StatusBadRequest {
			t.Fatalf("%s: expected 400, got %d %s", bad, rr.Code, rr.Body.String())
		}
	}
	if rr := call(testSrv.handleDevices, http.MethodPost, "/api/devices", "", otherCookie, fmt.Sprintf(`{"name":"sw","address":"10.0.0.2","version":"2c","community":"x","agent_id":%d}`, agentID)); rr.Code != http.StatusBadRequest {
		t.Fatalf("another workspace's agent is refused, got %d", rr.Code)
	}
	rr = call(testSrv.handleDevices, http.MethodPost, "/api/devices", "", cookie, fmt.Sprintf(`{"name":"core-sw","address":"10.0.0.2","version":"2c","community":"s3cret-comm","agent_id":%d}`, agentID))
	if rr.Code != http.StatusCreated || strings.Contains(rr.Body.String(), "s3cret-comm") || !strings.Contains(rr.Body.String(), `"community_set": true`) {
		t.Fatalf("create: %d %s", rr.Code, rr.Body.String())
	}
	var dev struct {
		ID     int64  `json:"id"`
		Status string `json:"status"`
	}
	_ = json.Unmarshal(rr.Body.Bytes(), &dev)

	rr = call(testSrv.handleAgentHeartbeat, http.MethodPost, "/api/agent/heartbeat", enrolled.Secret, nil, `{}`)
	if !strings.Contains(rr.Body.String(), `"community": "s3cret-comm"`) || !strings.Contains(rr.Body.String(), `"address": "10.0.0.2"`) {
		t.Fatalf("the agent gets the device with its credentials: %s", rr.Body.String())
	}

	now := time.Now().UTC().Truncate(time.Second)
	sample := func(at time.Time, reachable bool, in float64) string {
		return fmt.Sprintf(`{"samples":[{"device_id":%d,"at":%q,"reachable":%v,"rtt_ms":2.5,"sys":{"name":"core-sw-1","uptime_s":1000,"descr":"demo"},
			"interfaces":[{"index":1,"name":"Gi1","admin":"up","oper":"up","speed_bps":1000000000,"in_bps":%v,"out_bps":100,"has_rates":true},
			{"index":2,"name":"Gi2","admin":"up","oper":"down","has_rates":true},{"index":3,"name":"Gi3","admin":"down","oper":"down"}]}]}`,
			dev.ID, at.Format(time.RFC3339), reachable, in)
	}
	if rr := call(testSrv.handleAgentDevices, http.MethodPost, "/api/agent/devices", enrolled.Secret, nil, sample(now.Add(-time.Minute), true, 5000)); !strings.Contains(rr.Body.String(), `"accepted": 1`) {
		t.Fatalf("ingest: %s", rr.Body.String())
	}
	rr = call(testSrv.handleDevices, http.MethodGet, "/api/devices", "", cookie, "")
	if !strings.Contains(rr.Body.String(), `"status": "up"`) || !strings.Contains(rr.Body.String(), `"core-sw-1"`) || !strings.Contains(rr.Body.String(), `"Gi2"`) || strings.Contains(rr.Body.String(), "s3cret") {
		t.Fatalf("list: %s", rr.Body.String())
	}
	if rr := call(testSrv.handleDevices, http.MethodGet, "/api/devices", "", otherCookie, ""); strings.Contains(rr.Body.String(), "core-sw") {
		t.Fatalf("another workspace must not see the device: %s", rr.Body.String())
	}

	rr = call(testSrv.handleDevices, http.MethodGet, fmt.Sprintf("/api/devices?id=%d&range=1h", dev.ID), "", cookie, "")
	if !strings.Contains(rr.Body.String(), `"in_bps": 5000`) {
		t.Fatalf("device totals: %s", rr.Body.String())
	}
	rr = call(testSrv.handleDevices, http.MethodGet, fmt.Sprintf("/api/devices?id=%d&range=1h&if=1", dev.ID), "", cookie, "")
	if !strings.Contains(rr.Body.String(), `"in_bps": 5000`) {
		t.Fatalf("interface series: %s", rr.Body.String())
	}

	if rr := call(testSrv.handleAgentDevices, http.MethodPost, "/api/agent/devices", enrolled.Secret, nil,
		fmt.Sprintf(`{"samples":[{"device_id":%d,"at":%q,"reachable":false,"error":"no answer"}]}`, dev.ID, now.Format(time.RFC3339))); !strings.Contains(rr.Body.String(), `"accepted": 1`) {
		t.Fatalf("down sample: %s", rr.Body.String())
	}
	rr = call(testSrv.handleDevices, http.MethodGet, "/api/devices", "", cookie, "")
	if !strings.Contains(rr.Body.String(), `"status": "down"`) || !strings.Contains(rr.Body.String(), `"no answer"`) || !strings.Contains(rr.Body.String(), `"Gi1"`) {
		t.Fatalf("down keeps the last interfaces and shows why: %s", rr.Body.String())
	}

	// Renaming without credentials keeps them.
	rr = call(testSrv.handleDevices, http.MethodPost, "/api/devices", "", cookie, fmt.Sprintf(`{"id":%d,"name":"core switch","address":"10.0.0.2","version":"2c","agent_id":%d}`, dev.ID, agentID))
	if rr.Code != http.StatusOK {
		t.Fatalf("rename: %d %s", rr.Code, rr.Body.String())
	}
	if rr := call(testSrv.handleAgentHeartbeat, http.MethodPost, "/api/agent/heartbeat", enrolled.Secret, nil, `{}`); !strings.Contains(rr.Body.String(), `"community": "s3cret-comm"`) {
		t.Fatalf("credentials are kept: %s", rr.Body.String())
	}
	// A device of another agent can't be written by this one.
	if rr := call(testSrv.handleAgentDevices, http.MethodPost, "/api/agent/devices", enrolled.Secret, nil, `{"samples":[{"device_id":999999,"at":"`+now.Format(time.RFC3339)+`","reachable":true}]}`); !strings.Contains(rr.Body.String(), `"accepted": 0`) {
		t.Fatalf("unknown device is ignored: %s", rr.Body.String())
	}
	if rr := call(testSrv.handleDevices, http.MethodDelete, fmt.Sprintf("/api/devices?id=%d", dev.ID), "", otherCookie, ""); rr.Code != http.StatusNotFound && rr.Code != http.StatusForbidden {
		t.Fatalf("another workspace can't delete, got %d", rr.Code)
	}
	if rr := call(testSrv.handleDevices, http.MethodDelete, fmt.Sprintf("/api/devices?id=%d", dev.ID), "", cookie, ""); rr.Code != http.StatusOK {
		t.Fatalf("delete: %d", rr.Code)
	}
}
