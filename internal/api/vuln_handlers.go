package api

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"slices"
	"strconv"
	"strings"
	"time"

	"qnetward/internal/engine/surface"
	"qnetward/internal/platform/vulndb"
	"qnetward/internal/store"
)

// vulnView is one vulnerability on one host, from the domain's latest
// attack surface scan, with the workspace's decision about it if any.
type vulnView struct {
	surface.Vuln
	Domain      string                 `json:"domain"`
	ScanID      int64                  `json:"scan_id"`
	ScannedAt   time.Time              `json:"scanned_at"`
	Disposition *store.VulnDisposition `json:"disposition,omitempty"`
}

// handleVulnerabilities lists the known vulnerabilities found across the
// workspace's domains, worst first.
func (srv *Server) handleVulnerabilities(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		writeJSON(w, http.StatusMethodNotAllowed, apiError{Error: "method not allowed"})
		return
	}
	user, ok := srv.requireActorFor(w, r, store.ScopeRead)
	if !ok {
		return
	}
	ctx, cancel := context.WithTimeout(r.Context(), 15*time.Second)
	defer cancel()
	scans, err := srv.store.LatestSurfaceScans(ctx, user.WorkspaceID)
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, apiError{Error: err.Error()})
		return
	}
	decisions, err := srv.store.ListVulnDispositions(ctx, user.WorkspaceID)
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, apiError{Error: err.Error()})
		return
	}
	byKey := map[string]*store.VulnDisposition{}
	for i := range decisions {
		byKey[decisions[i].Host+"|"+decisions[i].CVE] = &decisions[i]
	}

	out := []vulnView{}
	domains := []map[string]any{}
	for _, sc := range scans {
		var rep surface.Report
		if json.Unmarshal(sc.Report, &rep) != nil {
			continue
		}
		domains = append(domains, map[string]any{"domain": sc.Domain, "scan_id": sc.ID, "scanned_at": sc.CreatedAt, "vuln_error": rep.VulnError})
		for _, v := range rep.Vulns {
			out = append(out, vulnView{Vuln: v, Domain: sc.Domain, ScanID: sc.ID, ScannedAt: sc.CreatedAt, Disposition: byKey[v.Host+"|"+v.CVE]})
		}
	}
	// Worst first, the same order as within a scan.
	plain := make([]vulndb.Vuln, len(out))
	for i := range out {
		plain[i] = out[i].Vuln.Vuln
	}
	order := make(map[string]int, len(out))
	vulndb.SortVulns(plain)
	for i, v := range plain {
		if _, seen := order[v.CVE]; !seen {
			order[v.CVE] = i
		}
	}
	slices.SortStableFunc(out, func(a, b vulnView) int {
		if d := order[a.CVE] - order[b.CVE]; d != 0 {
			return d
		}
		return strings.Compare(a.Host, b.Host)
	})
	writeJSON(w, http.StatusOK, map[string]any{"vulns": out, "domains": domains})
}

// handleVulnDispositions records or undoes a decision about a vulnerability.
// Owners and admins decide; the shared demo can't.
func (srv *Server) handleVulnDispositions(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost && r.Method != http.MethodDelete {
		writeJSON(w, http.StatusMethodNotAllowed, apiError{Error: "method not allowed"})
		return
	}
	user, ok := srv.requireActorFor(w, r, store.ScopeWrite)
	if !ok {
		return
	}
	if !srv.isAllowedRequestOrigin(r) {
		writeJSON(w, http.StatusForbidden, apiError{Error: "forbidden origin"})
		return
	}
	if user.Role != "owner" && user.Role != "admin" {
		writeJSON(w, http.StatusForbidden, apiError{Error: "only workspace owners and admins can accept risks or mark false positives"})
		return
	}
	if srv.isDemoUser(user.User) {
		writeJSON(w, http.StatusForbidden, apiError{Error: "the shared demo account can't change these"})
		return
	}
	ctx, cancel := context.WithTimeout(r.Context(), 10*time.Second)
	defer cancel()

	if r.Method == http.MethodDelete {
		id, err := strconv.ParseInt(strings.TrimSpace(r.URL.Query().Get("id")), 10, 64)
		if err != nil || id <= 0 {
			writeJSON(w, http.StatusBadRequest, apiError{Error: "valid id is required"})
			return
		}
		d, err := srv.store.DeleteVulnDisposition(ctx, user.WorkspaceID, id)
		if err != nil {
			status := http.StatusInternalServerError
			if errors.Is(err, store.ErrDispositionNotFound) {
				status = http.StatusNotFound
			}
			writeJSON(w, status, apiError{Error: err.Error()})
			return
		}
		srv.recordAudit(r, user.WorkspaceID, user.User, "vuln.reopened", auditTarget{Type: "vulnerability", ID: d.CVE, Label: d.CVE + " on " + d.Host}, nil)
		writeJSON(w, http.StatusOK, map[string]any{"ok": true, "id": id})
		return
	}

	var req struct {
		Host   string `json:"host"`
		CVE    string `json:"cve"`
		Status string `json:"status"`
		Reason string `json:"reason"`
	}
	if err := decodeJSON(w, r, &req); err != nil {
		writeJSON(w, http.StatusBadRequest, apiError{Error: err.Error()})
		return
	}
	d, err := srv.store.SetVulnDisposition(ctx, store.VulnDisposition{WorkspaceID: user.WorkspaceID, UserID: user.ID, Host: req.Host, CVE: req.CVE, Status: req.Status, Reason: req.Reason})
	if err != nil {
		writeJSON(w, http.StatusBadRequest, apiError{Error: err.Error()})
		return
	}
	srv.recordAudit(r, user.WorkspaceID, user.User, "vuln."+d.Status, auditTarget{Type: "vulnerability", ID: d.CVE, Label: d.CVE + " on " + d.Host}, map[string]any{"reason": d.Reason})
	writeJSON(w, http.StatusOK, d)
}
