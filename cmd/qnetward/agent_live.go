package main

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"net/url"
	"strings"
	"sync"
	"time"

	"github.com/gorilla/websocket"
)

// The agent's live link: one outbound WebSocket to the console, over which it
// hears commands (pick up new work, run a check now, stream readings) and
// sends live readings. Without it the agent works exactly as before, on its
// usual schedule; with it, changes and "Run now" take effect at once.

// liveCommand is a command from the console.
type liveCommand struct {
	Type      string `json:"type"`
	MonitorID int64  `json:"monitor_id,omitempty"`
	DeviceID  int64  `json:"device_id,omitempty"`
	Seconds   int    `json:"seconds,omitempty"`
	EveryMs   int    `json:"every_ms,omitempty"`
}

// liveLink keeps the WebSocket open, reconnecting with backoff.
type liveLink struct {
	server   string
	secret   string
	commands chan liveCommand
	mu       sync.Mutex
	conn     *websocket.Conn
}

func newLiveLink(server, secret string) *liveLink {
	return &liveLink{server: server, secret: secret, commands: make(chan liveCommand, 16)}
}

func (l *liveLink) url() (string, error) {
	u, err := url.Parse(l.server)
	if err != nil {
		return "", err
	}
	switch u.Scheme {
	case "https":
		u.Scheme = "wss"
	default:
		u.Scheme = "ws"
	}
	u.Path = strings.TrimRight(u.Path, "/") + "/api/agent/live"
	return u.String(), nil
}

// run connects and reads commands until ctx ends. A console without the live
// endpoint (an older server) answers 404, and the agent stops trying for a
// while rather than hammering it.
func (l *liveLink) run(ctx context.Context) error {
	target, err := l.url()
	if err != nil {
		return err
	}
	backoff := 2 * time.Second
	for ctx.Err() == nil {
		started := time.Now()
		header := http.Header{"Authorization": {"Bearer " + l.secret}, "User-Agent": {"qnetward-agent/" + agentVersion}}
		dialer := websocket.Dialer{HandshakeTimeout: 15 * time.Second, Proxy: http.ProxyFromEnvironment}
		conn, resp, err := dialer.DialContext(ctx, target, header)
		if err == nil {
			l.read(ctx, conn)
		} else if resp != nil && resp.StatusCode == http.StatusUnauthorized {
			return errAgentRemoved
		} else if resp != nil && resp.StatusCode == http.StatusNotFound {
			backoff = 10 * time.Minute
		}
		if time.Since(started) > time.Minute && backoff < 10*time.Minute {
			backoff = 2 * time.Second
		}
		select {
		case <-ctx.Done():
			return ctx.Err()
		case <-time.After(backoff):
		}
		if backoff < time.Minute {
			backoff *= 2
		}
	}
	return ctx.Err()
}

func (l *liveLink) read(ctx context.Context, conn *websocket.Conn) {
	l.mu.Lock()
	l.conn = conn
	l.mu.Unlock()
	defer func() {
		l.mu.Lock()
		l.conn = nil
		l.mu.Unlock()
		conn.Close()
	}()
	stop := context.AfterFunc(ctx, func() { conn.Close() })
	defer stop()
	conn.SetReadLimit(64 << 10)
	_ = conn.SetReadDeadline(time.Now().Add(90 * time.Second))
	conn.SetPingHandler(func(data string) error {
		_ = conn.SetReadDeadline(time.Now().Add(90 * time.Second))
		l.mu.Lock()
		defer l.mu.Unlock()
		return conn.WriteControl(websocket.PongMessage, []byte(data), time.Now().Add(10*time.Second))
	})
	for {
		_, data, err := conn.ReadMessage()
		if err != nil {
			return
		}
		_ = conn.SetReadDeadline(time.Now().Add(90 * time.Second))
		var cmd liveCommand
		if json.Unmarshal(data, &cmd) == nil && cmd.Type != "" {
			select {
			case l.commands <- cmd:
			default:
			}
		}
	}
}

// send writes a live reading, if the link is up. Readings are only useful now,
// so one that can't be sent is dropped.
func (l *liveLink) send(v any) error {
	data, err := json.Marshal(v)
	if err != nil {
		return err
	}
	l.mu.Lock()
	defer l.mu.Unlock()
	if l.conn == nil {
		return errors.New("live link is down")
	}
	_ = l.conn.SetWriteDeadline(time.Now().Add(5 * time.Second))
	return l.conn.WriteMessage(websocket.TextMessage, data)
}

// liveWindow is a Live mode request: stream every `every` until `until`.
type liveWindow struct {
	until time.Time
	every time.Duration
}

func (w liveWindow) on(now time.Time) bool { return now.Before(w.until) }

func windowFrom(cmd liveCommand, min time.Duration) liveWindow {
	secs := cmd.Seconds
	if secs <= 0 || secs > 120 {
		secs = 90
	}
	every := time.Duration(cmd.EveryMs) * time.Millisecond
	if every < min {
		every = min
	}
	return liveWindow{until: time.Now().Add(time.Duration(secs) * time.Second), every: every}
}
