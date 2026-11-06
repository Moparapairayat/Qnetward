package notify

import (
	"context"
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync/atomic"
	"testing"
	"time"
)

var sample = Message{Event: "monitor.down", Severity: "critical", Title: "api is down", Summary: "No replies <in> the last check.", Target: "api.example.com:443", URL: "https://app.test/monitors", At: time.Date(2026, 11, 6, 9, 30, 0, 0, time.UTC)}

func TestValidate(t *testing.T) {
	cases := []struct {
		kind string
		cfg  Config
		ok   bool
	}{
		{"slack", Config{URL: " https://hooks.slack.com/services/T0/B0/xyz "}, true},
		{"slack", Config{URL: "https://evil.example.com/services/x"}, false},
		{"discord", Config{URL: "https://discord.com/api/webhooks/1/abc"}, true},
		{"discord", Config{URL: "http://discord.com/api/webhooks/1/abc"}, false},
		{"telegram", Config{Token: "123456789:AAEhBP0av28lnAaQzuKcE2yWrFgsXyhd7oU", ChatID: "-1001234567890"}, true},
		{"telegram", Config{Token: "123456789:AAEhBP0av28lnAaQzuKcE2yWrFgsXyhd7oU", ChatID: "@ops_alerts"}, true},
		{"telegram", Config{Token: "nope", ChatID: "1"}, false},
		{"webhook", Config{URL: "https://hooks.example.com/qnetward"}, true},
		{"webhook", Config{URL: "ftp://hooks.example.com"}, false},
		{"webhook", Config{URL: "https://user:pass@hooks.example.com"}, false},
		{"sms", Config{}, false},
	}
	for _, c := range cases {
		cfg := c.cfg
		if err := Validate(c.kind, &cfg); (err == nil) != c.ok {
			t.Errorf("Validate(%s, %+v) error = %v, want ok %v", c.kind, c.cfg, err, c.ok)
		}
	}
}

func TestMaskHidesSecrets(t *testing.T) {
	if got := Mask("slack", Config{URL: "https://hooks.slack.com/services/T0/B0/secretpart9x2k"}); got != "…9x2k" {
		t.Errorf("slack mask = %q", got)
	}
	if got := Mask("webhook", Config{URL: "https://hooks.example.com/path/token-abcd1234"}); got != "https://hooks.example.com/…1234" {
		t.Errorf("webhook mask = %q", got)
	}
	if got := Mask("telegram", Config{Token: "123:secret", ChatID: "-100"}); strings.Contains(got, "secret") {
		t.Errorf("telegram mask leaks the token: %q", got)
	}
}

func TestPayloadsCarryTheAlert(t *testing.T) {
	slack := marshalPlain(SlackPayload(sample))
	for _, want := range []string{`"text":"api is down"`, `#e5484d`, `<https://app.test/monitors|api is down>`, `&lt;in&gt;`} {
		if !strings.Contains(slack, want) {
			t.Errorf("slack payload missing %s: %s", want, slack)
		}
	}
	discord := marshalPlain(DiscordPayload(sample))
	for _, want := range []string{`"color":15026253`, `"url":"https://app.test/monitors"`, `"parse":[]`} {
		if !strings.Contains(discord, want) {
			t.Errorf("discord payload missing %s: %s", want, discord)
		}
	}
	text := TelegramText(sample)
	if !strings.HasPrefix(text, "🔴 <b>api is down</b>") || !strings.Contains(text, "&lt;in&gt;") {
		t.Errorf("telegram text = %q", text)
	}
}

// marshalPlain encodes without escaping <, >, and &, so tests read like the payload.
func marshalPlain(v any) string {
	var b strings.Builder
	enc := json.NewEncoder(&b)
	enc.SetEscapeHTML(false)
	_ = enc.Encode(v)
	return b.String()
}

func TestWebhookIsSignedAndRetried(t *testing.T) {
	var calls atomic.Int32
	var got struct {
		body []byte
		sig  string
		ts   string
	}
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if calls.Add(1) == 1 {
			http.Error(w, "busy", http.StatusServiceUnavailable)
			return
		}
		got.body, _ = io.ReadAll(r.Body)
		got.sig = r.Header.Get("X-Qnetward-Signature")
		got.ts = r.Header.Get("X-Qnetward-Timestamp")
	}))
	defer srv.Close()

	if err := (Sender{}).Send(context.Background(), "webhook", Config{URL: srv.URL, Secret: "whsec_test"}, sample); err != nil {
		t.Fatalf("send: %v", err)
	}
	if calls.Load() != 2 {
		t.Fatalf("expected one retry after the 503, got %d calls", calls.Load())
	}
	if got.sig != Sign("whsec_test", got.ts, got.body) {
		t.Fatalf("signature %q does not match the body", got.sig)
	}
	var decoded Message
	if err := json.Unmarshal(got.body, &decoded); err != nil || decoded.Event != "monitor.down" || decoded.Title != "api is down" {
		t.Fatalf("unexpected body %s (err %v)", got.body, err)
	}
}

func TestTelegramErrorsAreReadableAndHideTheToken(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusBadRequest)
		_, _ = w.Write([]byte(`{"ok":false,"description":"Bad Request: chat not found"}`))
	}))
	defer srv.Close()

	token := "123456789:AAEhBP0av28lnAaQzuKcE2yWrFgsXyhd7oU"
	err := Sender{TelegramAPI: srv.URL}.Send(context.Background(), "telegram", Config{Token: token, ChatID: "-1"}, sample)
	if err == nil || !strings.Contains(err.Error(), "chat not found") || strings.Contains(err.Error(), token) {
		t.Fatalf("unexpected error: %v", err)
	}
}
