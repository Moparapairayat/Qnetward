package api

import (
	"context"
	"fmt"
	"log"
	"time"

	"qnetward/internal/platform/mailer"
	"qnetward/internal/store"
)

const (
	// agentSilentAfter is how long an agent may miss check-ins (every 30
	// seconds) before its workspace hears it's offline. Long enough that a
	// restart or a short network blip stays quiet.
	agentSilentAfter = 3 * time.Minute
	agentWatchEvery  = 30 * time.Second
)

// watchAgents alerts once for each agent that went silent while monitors
// depend on it. Claiming marks the agent, so other instances skip it.
func (srv *Server) watchAgents(ctx context.Context) {
	ctx, cancel := context.WithTimeout(ctx, 20*time.Second)
	defer cancel()
	silent, err := srv.store.ClaimSilentAgents(ctx, agentSilentAfter)
	if err != nil {
		log.Printf("checking for silent agents failed: %v", err)
		return
	}
	for _, a := range silent {
		in := agentOfflineAlert(a, srv.buildConfiguredDashboardURL("agents"))
		srv.events.publish(a.WorkspaceID, liveEvent{Type: "agent.changed"})
		srv.notifyChannels(a.WorkspaceID, store.ChannelEventAgents, toNotice(in, "agent.offline"))
		srv.emailAlert(in)
	}
}

// agentBackOnline tells the workspace an agent that was reported offline is
// checking in again.
func (srv *Server) agentBackOnline(agent store.Agent) {
	in := agentOnlineAlert(agent, srv.buildConfiguredDashboardURL("agents"))
	srv.events.publish(agent.WorkspaceID, liveEvent{Type: "agent.changed"})
	srv.notifyChannels(agent.WorkspaceID, store.ChannelEventAgents, toNotice(in, "agent.online"))
	if srv.mailer == nil || srv.store == nil {
		return
	}
	srv.background.Add(1)
	go func() {
		defer srv.background.Done()
		ctx, cancel := context.WithTimeout(context.Background(), 15*time.Second)
		defer cancel()
		email, name, err := srv.store.AgentCreator(ctx, agent.ID)
		if err != nil || email == "" {
			return
		}
		in.To, in.Name = email, name
		srv.emailAlert(in)
	}()
}

// emailAlert sends an alert email in the background, when there is a
// mailer and an address.
func (srv *Server) emailAlert(in mailer.AlertEmailInput) {
	if srv.mailer == nil || in.To == "" {
		return
	}
	srv.background.Add(1)
	go func() {
		defer srv.background.Done()
		ctx, cancel := context.WithTimeout(context.Background(), 15*time.Second)
		defer cancel()
		if err := srv.mailer.SendAlert(ctx, in); err != nil {
			log.Printf("agent alert email to %s failed: %v", in.To, err)
		}
	}()
}

func agentLabel(a store.Agent) string {
	if a.Hostname != "" {
		return fmt.Sprintf("%s (%s)", a.Name, a.Hostname)
	}
	return a.Name
}

func agentOfflineAlert(a store.SilentAgent, dashboardURL string) mailer.AlertEmailInput {
	since := "a while"
	if a.LastSeenAt != nil {
		since = a.LastSeenAt.UTC().Format("15:04 UTC on 2 Jan")
	}
	monitors := "Its monitor isn't"
	if a.Monitors != 1 {
		monitors = fmt.Sprintf("Its %d monitors aren't", a.Monitors)
	}
	return mailer.AlertEmailInput{
		To:       a.CreatorEmail,
		Name:     a.CreatorName,
		Severity: "critical",
		Title:    a.Name + " is offline",
		Summary: fmt.Sprintf("The probe agent %s hasn't checked in since %s. %s being checked until it's back. "+
			"Check that the machine is on and can reach Qnetward over HTTPS.", agentLabel(a.Agent), since, monitors),
		Target:       agentLabel(a.Agent),
		TriggeredAt:  time.Now().UTC(),
		DashboardURL: dashboardURL,
	}
}

func agentOnlineAlert(a store.Agent, dashboardURL string) mailer.AlertEmailInput {
	return mailer.AlertEmailInput{
		Severity:     "success",
		Title:        a.Name + " is back online",
		Summary:      fmt.Sprintf("The probe agent %s is checking in again, and its monitors are running.", agentLabel(a)),
		Target:       agentLabel(a),
		TriggeredAt:  time.Now().UTC(),
		DashboardURL: dashboardURL,
	}
}
