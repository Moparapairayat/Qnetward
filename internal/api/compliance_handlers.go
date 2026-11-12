package api

import (
	"context"
	"encoding/csv"
	"encoding/json"
	"fmt"
	"net/http"
	"slices"
	"strings"
	"time"

	"qnetward/internal/compliance"
	"qnetward/internal/engine/deep"
	"qnetward/internal/engine/passive"
	"qnetward/internal/engine/surface"
	"qnetward/internal/store"
)

// handleCompliance maps the workspace's latest scans onto framework controls.
// With ?format=csv it returns the same as a spreadsheet for auditors.
func (srv *Server) handleCompliance(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		writeJSON(w, http.StatusMethodNotAllowed, apiError{Error: "method not allowed"})
		return
	}
	user, ok := srv.requireActorFor(w, r, store.ScopeRead)
	if !ok {
		return
	}
	ctx, cancel := context.WithTimeout(r.Context(), 20*time.Second)
	defer cancel()
	in, err := srv.complianceInput(ctx, user.WorkspaceID)
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, apiError{Error: err.Error()})
		return
	}
	rep := compliance.Evaluate(in)
	if r.URL.Query().Get("format") == "csv" {
		writeComplianceCSV(w, rep)
		return
	}
	writeJSON(w, http.StatusOK, rep)
}

func (srv *Server) complianceInput(ctx context.Context, workspaceID int64) (compliance.Input, error) {
	in := compliance.Input{Now: time.Now()}
	for _, kind := range []string{"passive", "surface", "deep"} {
		scans, err := srv.store.LatestScans(ctx, workspaceID, kind)
		if err != nil {
			return in, err
		}
		for _, sc := range scans {
			cs := compliance.Scan{Kind: kind, Domain: sc.Domain, ScanID: sc.ID, At: sc.CreatedAt}
			add := func(host string, f passive.Finding) {
				if strings.HasPrefix(f.ID, "vuln.") {
					return // counted from the vulnerability list instead
				}
				cs.Findings = append(cs.Findings, compliance.Finding{Kind: kind, Domain: sc.Domain, Host: host, ID: f.ID, Title: f.Title, Severity: f.Severity, ScanID: sc.ID, At: sc.CreatedAt})
			}
			switch kind {
			case "passive":
				var rep passive.Report
				if json.Unmarshal(sc.Report, &rep) != nil {
					continue
				}
				for _, f := range rep.Findings {
					add(sc.Domain, f)
				}
			case "surface":
				var rep surface.Report
				if json.Unmarshal(sc.Report, &rep) != nil {
					continue
				}
				for _, f := range rep.Findings {
					add(f.Host, f.Finding)
				}
				for _, v := range rep.Vulns {
					in.Vulns = append(in.Vulns, compliance.Vuln{Domain: sc.Domain, Host: v.Host, CVE: v.CVE, Severity: v.Severity, KEV: v.KEV, Summary: v.Summary, ScanID: sc.ID, At: sc.CreatedAt})
				}
			case "deep":
				var rep deep.Report
				if json.Unmarshal(sc.Report, &rep) != nil {
					continue
				}
				for _, f := range rep.Findings {
					add(f.Host, f.Finding)
				}
			}
			in.Scans = append(in.Scans, cs)
		}
	}

	decisions, err := srv.store.ListVulnDispositions(ctx, workspaceID)
	if err != nil {
		return in, err
	}
	byKey := map[string]string{}
	for _, d := range decisions {
		byKey[d.Host+"|"+d.CVE] = d.Status
	}
	for i := range in.Vulns {
		in.Vulns[i].Decision = byKey[in.Vulns[i].Host+"|"+in.Vulns[i].CVE]
	}

	domains, err := srv.store.ListDomains(ctx, workspaceID)
	if err != nil {
		return in, err
	}
	for _, d := range domains {
		in.Domains = append(in.Domains, compliance.Domain{Domain: d.Domain, Verified: d.Status == "verified"})
	}
	watches, err := srv.store.ListSecurityWatches(ctx, workspaceID)
	if err != nil {
		return in, err
	}
	for _, wt := range watches {
		in.Watches = append(in.Watches, compliance.Watch{Kind: wt.Kind, Domain: wt.Domain, IntervalHours: wt.IntervalHours, Enabled: wt.Enabled})
	}

	monitors, err := srv.store.ListMonitors(ctx, workspaceID)
	if err != nil {
		return in, err
	}
	for _, m := range monitors {
		if m.Enabled {
			in.Monitors++
			if m.NotifyEmail != "" {
				in.Alerting = true
			}
		}
	}
	if in.Monitors > 0 && !in.Alerting {
		channels, err := srv.store.ListChannels(ctx, workspaceID)
		if err != nil {
			return in, err
		}
		for _, c := range channels {
			if c.Enabled && slices.Contains(c.Events, store.ChannelEventMonitors) {
				in.Alerting = true
			}
		}
	}
	return in, nil
}

func writeComplianceCSV(w http.ResponseWriter, rep compliance.Report) {
	w.Header().Set("Content-Type", "text/csv; charset=utf-8")
	w.Header().Set("Content-Disposition", fmt.Sprintf(`attachment; filename="qnetward-compliance-%s.csv"`, rep.CheckedAt.UTC().Format("2006-01-02")))
	cw := csv.NewWriter(w)
	head := []string{"Control", "Area", "Status", "Summary"}
	for _, f := range compliance.Frameworks {
		head = append(head, f.Short)
	}
	head = append(head, "Domains", "Evidence", "Fix")
	_ = cw.Write(head)
	for _, c := range rep.Controls {
		row := []string{c.Title, c.Area, statusLabel(c.Status), c.Summary}
		for _, f := range compliance.Frameworks {
			row = append(row, strings.Join(c.Refs[f.ID], "; "))
		}
		ev := make([]string, 0, len(c.Evidence))
		for _, e := range c.Evidence {
			where := e.Host
			if where == "" {
				where = e.Domain
			}
			line := fmt.Sprintf("[%s] %s", e.Severity, e.Title)
			if where != "" {
				line += " on " + where
			}
			if e.ScanID != 0 {
				line += fmt.Sprintf(" (scan %d, %s)", e.ScanID, e.At.UTC().Format("2006-01-02"))
			}
			ev = append(ev, line)
		}
		fix := ""
		if c.Status == compliance.Warn || c.Status == compliance.Fail {
			fix = c.Fix
		}
		row = append(row, strings.Join(c.Domains, "; "), strings.Join(ev, "\n"), fix)
		_ = cw.Write(row)
	}
	_ = cw.Write(nil)
	_ = cw.Write([]string{fmt.Sprintf("Generated %s from Qnetward scans of the last %d days. Covers only externally observable technical controls; this is evidence, not a certification.", rep.CheckedAt.UTC().Format(time.RFC3339), rep.Window)})
	cw.Flush()
}

func statusLabel(s compliance.Status) string {
	switch s {
	case compliance.Pass:
		return "Pass"
	case compliance.Warn:
		return "Needs attention"
	case compliance.Fail:
		return "Fail"
	}
	return "Not assessed"
}
