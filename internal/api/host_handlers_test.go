package api

import (
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"qnetward/internal/store"
)

// An agent reports its machine; the console lists it with its newest sample
// and charts its history, and other workspaces see none of it.
func TestHostMetrics(t *testing.T) {
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

	rr := call(testSrv.handleAgents, http.MethodPost, "/api/agents", "", cookie, `{"name":"db-1"}`)
	var created agentCreateResponse
	_ = json.Unmarshal(rr.Body.Bytes(), &created)
	rr = call(testSrv.handleAgentEnroll, http.MethodPost, "/api/agent/enroll", "", nil, fmt.Sprintf(`{"token":%q}`, created.EnrollToken))
	var enrolled struct {
		Secret string `json:"secret"`
	}
	_ = json.Unmarshal(rr.Body.Bytes(), &enrolled)
	if enrolled.Secret == "" {
		t.Fatalf("enroll failed: %s", rr.Body.String())
	}
	if rr := call(testSrv.handleAgentHeartbeat, http.MethodPost, "/api/agent/heartbeat", enrolled.Secret, nil, `{}`); !strings.Contains(rr.Body.String(), `"metrics_seconds": 60`) {
		t.Fatalf("the heartbeat tells the agent how often to sample: %s", rr.Body.String())
	}

	now := time.Now().UTC().Truncate(time.Second)
	sample := func(at time.Time, cpu float64, used int) string {
		return fmt.Sprintf(`{"at":%q,"cpu":%v,"load1":0.5,"mem_used":%d,"mem_total":1000,"swap_used":0,"swap_total":0,
			"disks":[{"mount":"/","fstype":"ext4","used":200,"total":1000},{"mount":"/data","fstype":"xfs","used":900,"total":1000}],
			"net_rx_bps":100,"net_tx_bps":50,"procs":120,"uptime":3600}`, at.Format(time.RFC3339), cpu, used)
	}
	body := `{"info":{"os":"linux","platform":"ubuntu","platform_version":"24.04","cores":4,"mem_total":1000,"extra":"<script>"},"samples":[` +
		sample(now.Add(-2*time.Minute), 20, 400) + `,` + sample(now.Add(-time.Minute), 250, 600) + `,` + sample(now.Add(-5*time.Hour), 10, 100) + `]}`
	if rr := call(testSrv.handleAgentMetrics, http.MethodPost, "/api/agent/metrics", "qna_wrong", nil, body); rr.Code != http.StatusUnauthorized {
		t.Fatalf("a bad secret is refused, got %d", rr.Code)
	}
	rr = call(testSrv.handleAgentMetrics, http.MethodPost, "/api/agent/metrics", enrolled.Secret, nil, body)
	if rr.Code != http.StatusOK || !strings.Contains(rr.Body.String(), `"accepted": 2`) {
		t.Fatalf("two fresh samples are kept, the stale one dropped: %d %s", rr.Code, rr.Body.String())
	}
	// Sending the same samples again stores nothing twice.
	if rr := call(testSrv.handleAgentMetrics, http.MethodPost, "/api/agent/metrics", enrolled.Secret, nil, body); !strings.Contains(rr.Body.String(), `"accepted": 0`) {
		t.Fatalf("resent samples are ignored: %s", rr.Body.String())
	}

	rr = call(testSrv.handleHosts, http.MethodGet, "/api/hosts", "", cookie, "")
	var list struct {
		Hosts []store.Host `json:"hosts"`
	}
	_ = json.Unmarshal(rr.Body.Bytes(), &list)
	if rr.Code != http.StatusOK || len(list.Hosts) != 1 || list.Hosts[0].Latest == nil {
		t.Fatalf("list: %d %s", rr.Code, rr.Body.String())
	}
	h := list.Hosts[0]
	var info map[string]any
	_ = json.Unmarshal(h.Info, &info)
	if h.Latest.CPU != 100 || h.Latest.MemUsed != 600 || len(h.Latest.Disks) != 2 || info["platform"] != "ubuntu" || info["extra"] != nil {
		t.Fatalf("the newest sample, clamped, with cleaned info: %+v %s", h.Latest, h.Info)
	}

	rr = call(testSrv.handleHosts, http.MethodGet, fmt.Sprintf("/api/hosts?id=%d&range=1h", h.ID), "", cookie, "")
	var series struct {
		Points []store.HostPoint `json:"points"`
	}
	_ = json.Unmarshal(rr.Body.Bytes(), &series)
	if rr.Code != http.StatusOK || len(series.Points) != 2 || series.Points[1].MemPct != 60 || series.Points[1].DiskPct != 90 {
		t.Fatalf("series uses memory share and the fullest disk: %d %s", rr.Code, rr.Body.String())
	}

	if rr := call(testSrv.handleHosts, http.MethodGet, "/api/hosts", "", otherCookie, ""); strings.Contains(rr.Body.String(), "db-1") {
		t.Fatalf("another workspace must not list the host: %s", rr.Body.String())
	}
	rr = call(testSrv.handleHosts, http.MethodGet, fmt.Sprintf("/api/hosts?id=%d&range=1h", h.ID), "", otherCookie, "")
	if !strings.Contains(rr.Body.String(), `"points": []`) {
		t.Fatalf("another workspace must not read the history: %s", rr.Body.String())
	}
}
