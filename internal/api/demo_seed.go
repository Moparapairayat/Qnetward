package api

import (
	"context"
	"errors"
	"log"

	"qnetward/internal/plans"
	"qnetward/internal/store"
)

// demoStatusSlug is where the demo workspace's status page lives.
const demoStatusSlug = "kestrel-labs"

type demoMonitor struct {
	label    string
	monitor  store.Monitor
	onStatus bool
}

func intPtr(v int) *int { return &v }

// demoMonitors are real, public targets, so the demo shows live checks, not
// made-up numbers.
func demoMonitors() []demoMonitor {
	return []demoMonitor{
		{"Website", store.Monitor{Name: "Website", Protocol: "http", Target: "https://www.cloudflare.com/", IntervalSeconds: 60}, true},
		{"Public API", store.Monitor{Name: "Public API", Protocol: "http", Target: "https://api.github.com/", IntervalSeconds: 60}, true},
		{"DNS resolver", store.Monitor{Name: "DNS resolver", Protocol: "tcpping", Target: "1.1.1.1", Port: intPtr(53), IntervalSeconds: 60}, true},
		{"Search edge", store.Monitor{Name: "Search edge", Protocol: "tcpping", Target: "google.com", Port: intPtr(443), IntervalSeconds: 60}, true},
		{"Docs", store.Monitor{Name: "Docs", Protocol: "http", Target: "https://example.com/", IntervalSeconds: 300}, false},
	}
}

// prepareDemo keeps the shared demo presentable: its name follows the
// configured demo name, and an empty workspace gets monitors, an alert rule,
// and a published status page. Visitors who empty it get it back on the next
// demo login. With full access on, the account is left as its owner keeps it.
func (srv *Server) prepareDemo(ctx context.Context, user store.User) store.User {
	if srv.demoFullAccess {
		return user
	}
	if name := srv.demoName; name != "" && user.Name != name {
		if updated, _, err := srv.store.UpdateUserProfile(ctx, user.ID, name, user.Email); err == nil {
			user = updated
		} else {
			log.Printf("renaming the demo account failed: %v", err)
		}
	}

	workspace, err := srv.store.GetWorkspaceContextByUserID(ctx, user.ID)
	if err != nil {
		return user
	}
	existing, err := srv.store.ListMonitors(ctx, workspace.ID)
	if err != nil || len(existing) > 0 {
		return user
	}

	limit := plans.For(workspace.Plan).Limits.Monitors
	var onPage []store.StatusPageMonitor
	for _, d := range demoMonitors() {
		m := d.monitor
		m.WorkspaceID, m.UserID, m.Enabled = workspace.ID, user.ID, true
		saved, err := srv.store.SaveMonitor(ctx, m, limit)
		if err != nil {
			// A second login racing this one already made it.
			if !errors.Is(err, store.ErrMonitorDuplicate) {
				log.Printf("seeding demo monitor %q failed: %v", m.Name, err)
			}
			continue
		}
		if d.onStatus {
			onPage = append(onPage, store.StatusPageMonitor{MonitorID: saved.ID, Label: d.label})
		}
	}

	threshold := 250.0
	if _, err := srv.store.SaveAlertRule(ctx, store.AlertRule{
		WorkspaceID: workspace.ID, UserID: user.ID, Name: "Search edge is slow",
		Protocol: "tcpping", Target: "google.com", Port: intPtr(443), RecipientEmail: user.Email,
		LatencyThresholdMs: &threshold, ConsecutiveBreaches: 3, CooldownMinutes: 30, NotifyOnRecovery: true, Enabled: true,
	}); err != nil {
		log.Printf("seeding the demo alert rule failed: %v", err)
	}

	if len(onPage) > 0 {
		if _, err := srv.store.SaveStatusPage(ctx, store.StatusPage{
			WorkspaceID: workspace.ID, Slug: demoStatusSlug, Title: workspace.Name + " status",
			Description: "Live status of the services this demo workspace watches. Checks run every minute.",
			Published:   true, Monitors: onPage,
		}, 0); err != nil && !errors.Is(err, store.ErrStatusPageSlugTaken) {
			log.Printf("seeding the demo status page failed: %v", err)
		}
	}
	return user
}
