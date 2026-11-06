// Package notify delivers alerts to chat tools and webhooks: Slack and
// Discord incoming webhooks, a Telegram bot, or any URL that accepts a signed
// JSON POST.
package notify

import (
	"bytes"
	"context"
	"crypto/hmac"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"html"
	"io"
	"net/http"
	"net/url"
	"regexp"
	"strconv"
	"strings"
	"time"
)

// Message is one alert, in words a person reads.
type Message struct {
	// Event names what happened, such as monitor.down or test.
	Event string `json:"event"`
	// Severity is critical, warning, success, or info.
	Severity string    `json:"severity"`
	Title    string    `json:"title"`
	Summary  string    `json:"summary"`
	Target   string    `json:"target,omitempty"`
	URL      string    `json:"url,omitempty"`
	At       time.Time `json:"triggered_at"`
}

// Config is a channel's destination. Which fields count depends on the kind.
type Config struct {
	URL    string `json:"url,omitempty"`
	Token  string `json:"token,omitempty"`
	ChatID string `json:"chat_id,omitempty"`
	// Secret signs webhook payloads.
	Secret string `json:"secret,omitempty"`
}

var (
	telegramToken = regexp.MustCompile(`^\d{5,}:[A-Za-z0-9_-]{30,}$`)
	telegramChat  = regexp.MustCompile(`^(-?\d{1,20}|@[A-Za-z][A-Za-z0-9_]{4,31})$`)
)

// Validate checks and tidies a destination for kind.
func Validate(kind string, cfg *Config) error {
	cfg.URL = strings.TrimSpace(cfg.URL)
	cfg.Token = strings.TrimSpace(cfg.Token)
	cfg.ChatID = strings.TrimSpace(cfg.ChatID)
	switch kind {
	case "slack":
		if !strings.HasPrefix(cfg.URL, "https://hooks.slack.com/services/") {
			return errors.New("use a Slack incoming webhook URL, starting with https://hooks.slack.com/services/")
		}
	case "discord":
		if !strings.HasPrefix(cfg.URL, "https://discord.com/api/webhooks/") && !strings.HasPrefix(cfg.URL, "https://discordapp.com/api/webhooks/") {
			return errors.New("use a Discord webhook URL, starting with https://discord.com/api/webhooks/")
		}
	case "telegram":
		if !telegramToken.MatchString(cfg.Token) {
			return errors.New("the bot token looks like 123456789:AA… and comes from @BotFather")
		}
		if !telegramChat.MatchString(cfg.ChatID) {
			return errors.New("the chat ID is a number such as -1001234567890, or a channel name such as @mychannel")
		}
		cfg.URL = ""
	case "webhook":
		u, err := url.Parse(cfg.URL)
		if err != nil || (u.Scheme != "https" && u.Scheme != "http") || u.Host == "" {
			return errors.New("the webhook URL must start with https:// or http://")
		}
		if u.User != nil {
			return errors.New("put credentials in the payload signature, not the URL")
		}
		if len(cfg.URL) > 2000 {
			return errors.New("the webhook URL is too long")
		}
	default:
		return fmt.Errorf("unknown channel kind %q", kind)
	}
	return nil
}

// Mask is a hint of where a channel points, safe to show in the UI.
func Mask(kind string, cfg Config) string {
	switch kind {
	case "telegram":
		return "chat " + cfg.ChatID
	case "slack", "discord":
		return tail(cfg.URL)
	default:
		u, err := url.Parse(cfg.URL)
		if err != nil {
			return ""
		}
		return u.Scheme + "://" + u.Host + "/" + tail(u.Path)
	}
}

// tail keeps the last few characters of a secret-bearing URL.
func tail(s string) string {
	s = strings.Trim(s, "/")
	if i := strings.LastIndex(s, "/"); i >= 0 {
		s = s[i+1:]
	}
	if len(s) > 4 {
		return "…" + s[len(s)-4:]
	}
	return s
}

// Sender delivers messages. Client must refuse private addresses for
// webhooks; TelegramAPI is the Bot API base, overridable in tests.
type Sender struct {
	Client      *http.Client
	TelegramAPI string
}

// Send delivers m, retrying once after a network error, a 429, or a 5xx.
func (s Sender) Send(ctx context.Context, kind string, cfg Config, m Message) error {
	req, err := s.build(kind, cfg, m)
	if err != nil {
		return err
	}
	err = s.do(ctx, req)
	var retry *retryable
	if errors.As(err, &retry) {
		select {
		case <-ctx.Done():
			return err
		case <-time.After(time.Second):
		}
		again, buildErr := s.build(kind, cfg, m)
		if buildErr != nil {
			return buildErr
		}
		err = s.do(ctx, again)
	}
	if errors.As(err, &retry) {
		return retry.err
	}
	return err
}

type request struct {
	url     string
	body    []byte
	headers map[string]string
	kind    string
}

func (s Sender) build(kind string, cfg Config, m Message) (request, error) {
	var payload any
	headers := map[string]string{}
	target := cfg.URL
	switch kind {
	case "slack":
		payload = SlackPayload(m)
	case "discord":
		payload = DiscordPayload(m)
	case "telegram":
		api := s.TelegramAPI
		if api == "" {
			api = "https://api.telegram.org"
		}
		target = strings.TrimRight(api, "/") + "/bot" + cfg.Token + "/sendMessage"
		payload = map[string]any{"chat_id": cfg.ChatID, "text": TelegramText(m), "parse_mode": "HTML", "disable_web_page_preview": true}
	case "webhook":
		payload = m
	default:
		return request{}, fmt.Errorf("unknown channel kind %q", kind)
	}
	body, err := json.Marshal(payload)
	if err != nil {
		return request{}, err
	}
	if kind == "webhook" {
		ts := strconv.FormatInt(time.Now().Unix(), 10)
		headers["X-Qnetward-Event"] = m.Event
		headers["X-Qnetward-Timestamp"] = ts
		if cfg.Secret != "" {
			headers["X-Qnetward-Signature"] = Sign(cfg.Secret, ts, body)
		}
	}
	return request{url: target, body: body, headers: headers, kind: kind}, nil
}

// Sign is the webhook signature: sha256= and the hex HMAC-SHA256 of the
// timestamp, a dot, and the raw body, keyed with the channel's secret.
func Sign(secret, timestamp string, body []byte) string {
	mac := hmac.New(sha256.New, []byte(secret))
	mac.Write([]byte(timestamp + "."))
	mac.Write(body)
	return "sha256=" + hex.EncodeToString(mac.Sum(nil))
}

type retryable struct{ err error }

func (r *retryable) Error() string { return r.err.Error() }

func (s Sender) do(ctx context.Context, r request) error {
	client := s.Client
	if client == nil {
		client = &http.Client{Timeout: 10 * time.Second}
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, r.url, bytes.NewReader(r.body))
	if err != nil {
		return errors.New("could not build the request")
	}
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("User-Agent", "Qnetward-Notify/1")
	for k, v := range r.headers {
		req.Header.Set(k, v)
	}
	resp, err := client.Do(req)
	if err != nil {
		// The URL holds the secret for most kinds; never echo it back.
		return &retryable{errors.New("could not reach " + hostOf(r.url) + ": " + rootCause(err))}
	}
	defer resp.Body.Close()
	data, _ := io.ReadAll(io.LimitReader(resp.Body, 2048))
	if resp.StatusCode >= 200 && resp.StatusCode < 300 {
		return nil
	}
	msg := fmt.Sprintf("%s answered %d", hostOf(r.url), resp.StatusCode)
	if detail := errorDetail(r.kind, data); detail != "" {
		msg += ": " + detail
	}
	if resp.StatusCode == http.StatusTooManyRequests || resp.StatusCode >= 500 {
		return &retryable{errors.New(msg)}
	}
	return errors.New(msg)
}

// errorDetail pulls a readable reason out of an error response.
func errorDetail(kind string, data []byte) string {
	var parsed struct {
		Description string `json:"description"`
		Message     string `json:"message"`
	}
	if json.Unmarshal(data, &parsed) == nil {
		if parsed.Description != "" {
			return parsed.Description
		}
		if parsed.Message != "" {
			return parsed.Message
		}
	}
	text := strings.TrimSpace(string(data))
	if kind == "slack" && text != "" && len(text) < 80 {
		return text // Slack answers with plain words such as invalid_token.
	}
	return ""
}

func hostOf(raw string) string {
	if u, err := url.Parse(raw); err == nil && u.Host != "" {
		return u.Host
	}
	return "the destination"
}

func rootCause(err error) string {
	var urlErr *url.Error
	if errors.As(err, &urlErr) {
		err = urlErr.Err
	}
	text := err.Error()
	if strings.Contains(text, "not allowed") || strings.Contains(text, "blocked") {
		return "private and internal addresses are not allowed"
	}
	if errors.Is(err, context.DeadlineExceeded) || strings.Contains(text, "timeout") {
		return "timed out"
	}
	return text
}

var severityColor = map[string]int{"critical": 0xe5484d, "warning": 0xf5a524, "success": 0x30a46c, "info": 0x3e63dd}

var severityMark = map[string]string{"critical": "🔴", "warning": "🟡", "success": "🟢", "info": "🔵"}

func colorOf(severity string) int {
	if c, ok := severityColor[severity]; ok {
		return c
	}
	return severityColor["info"]
}

func footer(m Message) string {
	parts := []string{}
	if m.Target != "" {
		parts = append(parts, m.Target)
	}
	parts = append(parts, m.At.UTC().Format("2 Jan 15:04 UTC"))
	return strings.Join(parts, " · ")
}

// SlackPayload is an incoming-webhook message with a coloured side bar.
func SlackPayload(m Message) map[string]any {
	title := slackEscape(m.Title)
	if m.URL != "" {
		title = "<" + m.URL + "|" + title + ">"
	}
	text := "*" + title + "*"
	if m.Summary != "" {
		text += "\n" + slackEscape(m.Summary)
	}
	return map[string]any{
		"text": m.Title,
		"attachments": []any{map[string]any{
			"color": fmt.Sprintf("#%06x", colorOf(m.Severity)),
			"blocks": []any{
				map[string]any{"type": "section", "text": map[string]any{"type": "mrkdwn", "text": text}},
				map[string]any{"type": "context", "elements": []any{map[string]any{"type": "mrkdwn", "text": slackEscape("Qnetward · " + footer(m))}}},
			},
		}},
	}
}

func slackEscape(s string) string {
	return strings.NewReplacer("&", "&amp;", "<", "&lt;", ">", "&gt;").Replace(s)
}

// DiscordPayload is a webhook message with one embed.
func DiscordPayload(m Message) map[string]any {
	embed := map[string]any{
		"title":       m.Title,
		"description": m.Summary,
		"color":       colorOf(m.Severity),
		"timestamp":   m.At.UTC().Format(time.RFC3339),
		"footer":      map[string]any{"text": "Qnetward" + prefixed(m.Target)},
	}
	if m.URL != "" {
		embed["url"] = m.URL
	}
	return map[string]any{"username": "Qnetward", "embeds": []any{embed}, "allowed_mentions": map[string]any{"parse": []string{}}}
}

func prefixed(s string) string {
	if s == "" {
		return ""
	}
	return " · " + s
}

// TelegramText is the message in Telegram's HTML subset.
func TelegramText(m Message) string {
	mark := severityMark[m.Severity]
	if mark == "" {
		mark = severityMark["info"]
	}
	var b strings.Builder
	b.WriteString(mark + " <b>" + html.EscapeString(m.Title) + "</b>")
	if m.Summary != "" {
		b.WriteString("\n" + html.EscapeString(m.Summary))
	}
	b.WriteString("\n<i>" + html.EscapeString(footer(m)) + "</i>")
	if m.URL != "" {
		b.WriteString("\n<a href=\"" + html.EscapeString(m.URL) + "\">Open in Qnetward</a>")
	}
	return b.String()
}
