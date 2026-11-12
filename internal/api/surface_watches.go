package api

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"log"
	"slices"
	"strings"
	"time"

	"qnetward/internal/engine/passive"
	"qnetward/internal/engine/surface"
	"qnetward/internal/platform/mailer"
	"qnetward/internal/store"
)

// checkSurfaceWatch runs a scheduled attack surface scan and alerts on new
// exposure: a risky port that wasn't open before, or a new high finding.
func (srv *Server) checkSurfaceWatch(ctx context.Context, watch store.SecurityWatch) {
	recordCtx, cancel := context.WithTimeout(context.WithoutCancel(ctx), 10*time.Second)
	defer cancel()
	// The proof is checked again every run; a lapsed domain isn't scanned.
	if _, err := srv.store.VerifiedDomainFor(recordCtx, watch.WorkspaceID, watch.Domain); err != nil {
		if errors.Is(err, store.ErrDomainNotFound) {
			_ = srv.store.RecordWatchResult(recordCtx, watch, nil, watch.Domain+" is no longer verified; verify it again in Assets")
		}
		return
	}
	var previous *surface.Report
	if watch.LastScanID != nil {
		if old, err := srv.store.GetSecurityScan(recordCtx, watch.WorkspaceID, *watch.LastScanID); err == nil && old.Status == "done" {
			var rep surface.Report
			if json.Unmarshal(old.Report, &rep) == nil {
				previous = &rep
			}
		}
	}
	scan, err := srv.store.StartSecurityScan(recordCtx, store.SecurityScan{WorkspaceID: watch.WorkspaceID, UserID: watch.UserID, Kind: "surface", Domain: watch.Domain})
	if errors.Is(err, store.ErrScanRunning) {
		// Someone is scanning by hand; try again shortly.
		_ = srv.store.DelayWatch(recordCtx, watch, 15*time.Minute)
		return
	}
	if err != nil {
		log.Printf("starting scheduled surface scan for watch %d failed: %v", watch.ID, err)
		return
	}
	rep, ok := srv.finishSurfaceScan(scan)
	saveCtx, saveCancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer saveCancel()
	if !ok {
		_ = srv.store.RecordWatchResult(saveCtx, watch, nil, "the scan failed; it runs again at the next interval")
		return
	}
	if done, err := srv.store.GetSecurityScan(saveCtx, watch.WorkspaceID, scan.ID); err == nil {
		if err := srv.store.RecordWatchResult(saveCtx, watch, &done, ""); err != nil {
			log.Printf("recording watch %d failed: %v", watch.ID, err)
		}
	}
	if previous == nil {
		return
	}
	change := compareSurface(*previous, rep)
	if change.empty() {
		return
	}
	in := srv.surfaceAlert(watch, scan, change)
	srv.notifyChannels(watch.WorkspaceID, store.ChannelEventSecurity, toNotice(in, "surface.exposed"))
	if watch.NotifyEmail != "" && srv.mailer != nil {
		in.To = watch.NotifyEmail
		srv.emailAlert(in)
	}
}

// surfaceChange is new exposure between two scans of a domain.
type surfaceChange struct {
	NewHosts []string
	NewPorts []string
	NewHigh  []string
}

// empty says nothing alert-worthy changed. New hosts alone don't alert,
// since deploys add names all the time; they're mentioned alongside new
// ports or high findings.
func (c surfaceChange) empty() bool { return len(c.NewPorts) == 0 && len(c.NewHigh) == 0 }

func compareSurface(before, after surface.Report) surfaceChange {
	var change surfaceChange
	old := map[string][]int{}
	for _, h := range before.Hosts {
		old[h.Name] = h.OpenPorts
	}
	risky := map[int]surface.Port{}
	for _, p := range surface.Ports {
		if p.Severity != passive.Info {
			risky[p.Number] = p
		}
	}
	for _, h := range after.Hosts {
		ports, seen := old[h.Name]
		if !seen {
			change.NewHosts = append(change.NewHosts, h.Name)
		}
		for _, p := range h.OpenPorts {
			if info, ok := risky[p]; ok && !slices.Contains(ports, p) {
				change.NewPorts = append(change.NewPorts, fmt.Sprintf("%s on %s", info.Service, h.Name))
			}
		}
	}
	had := map[string]bool{}
	for _, f := range before.Findings {
		if f.Severity == passive.High {
			had[f.Host+"|"+f.ID] = true
		}
	}
	for _, f := range after.Findings {
		// Open ports are listed above already.
		if f.Severity == passive.High && !had[f.Host+"|"+f.ID] && !strings.HasPrefix(f.ID, "surface.port.") {
			change.NewHigh = append(change.NewHigh, f.Title+" ("+f.Host+")")
		}
	}
	return change
}

func (srv *Server) surfaceAlert(watch store.SecurityWatch, scan store.SecurityScan, change surfaceChange) mailer.AlertEmailInput {
	var parts []string
	if len(change.NewPorts) > 0 {
		parts = append(parts, "Newly open: "+strings.Join(change.NewPorts, ", ")+".")
	}
	if len(change.NewHigh) > 0 {
		parts = append(parts, "New high-severity issues: "+strings.Join(change.NewHigh, "; ")+".")
	}
	if len(change.NewHosts) > 0 {
		parts = append(parts, fmt.Sprintf("%d new host(s) since the last scan.", len(change.NewHosts)))
	}
	url := srv.buildConfiguredDashboardURL("attack-surface")
	if url != "" {
		url += fmt.Sprintf("?scan=%d", scan.ID)
	}
	return mailer.AlertEmailInput{
		Severity:     "critical",
		Title:        "New exposure on " + watch.Domain,
		Summary:      strings.Join(parts, " "),
		Target:       watch.Domain,
		TriggeredAt:  time.Now().UTC(),
		DashboardURL: url,
	}
}
