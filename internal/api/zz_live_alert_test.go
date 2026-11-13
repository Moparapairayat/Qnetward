package api

// Temporary: sends a real host alert (firing and recovered) by email and to
// Slack/Discord through the production code. Not committed.

import (
	"context"
	"os"
	"testing"
	"time"

	"qnetward/internal/platform/mailer"
	"qnetward/internal/platform/notify"
	"qnetward/internal/store"
)

func TestLiveHostAlertDelivery(t *testing.T) {
	to, slack, discord := os.Getenv("LIVE_ALERT_EMAIL"), os.Getenv("LIVE_SLACK_URL"), os.Getenv("LIVE_DISCORD_URL")
	if to == "" && slack == "" && discord == "" {
		t.Skip("no live destinations")
	}
	agent := int64(1)
	rule := store.HostAlertRule{ID: 1, AgentID: &agent, Metric: "memory", Threshold: 85, Minutes: 5, NotifyEmail: to}
	since := time.Now().Add(-12 * time.Minute)
	changes := []store.HostAlertChange{
		{Rule: rule, AgentID: 1, AgentName: "office-pc", Hostname: "MPA-DESKTOP", Value: 91, Firing: true, Since: since},
		{Rule: rule, AgentID: 1, AgentName: "office-pc", Hostname: "MPA-DESKTOP", Value: 62, Firing: false, Since: since},
	}
	ctx, cancel := context.WithTimeout(context.Background(), 60*time.Second)
	defer cancel()
	var mc *mailer.Client
	if to != "" {
		var err error
		mc, err = mailer.Open(mailer.Config{APIKey: os.Getenv("QNETWARD_RESEND_API_KEY"), From: os.Getenv("QNETWARD_EMAIL_FROM"), ReplyTo: os.Getenv("QNETWARD_EMAIL_REPLY_TO")})
		if err != nil || !mc.Enabled() {
			t.Fatalf("mailer: %v", err)
		}
	}
	sender := (&Server{targetPolicy: testSrv.targetPolicy}).notifySender()
	for _, c := range changes {
		in := hostAlert(c, "https://qnetward.moparapairayat.one/hosts")
		event := "host.alert"
		if !c.Firing {
			event = "host.recovered"
		}
		if mc != nil {
			if err := mc.SendAlert(ctx, in); err != nil {
				t.Errorf("email %s: %v", event, err)
			} else {
				t.Logf("email %s sent: %s", event, in.Title)
			}
		}
		for kind, url := range map[string]string{store.ChannelSlack: slack, store.ChannelDiscord: discord} {
			if url == "" {
				continue
			}
			if err := sender.Send(ctx, kind, notify.Config{URL: url}, toNotice(in, event)); err != nil {
				t.Errorf("%s %s: %v", kind, event, err)
			} else {
				t.Logf("%s %s sent: %s", kind, event, in.Title)
			}
		}
	}
}
