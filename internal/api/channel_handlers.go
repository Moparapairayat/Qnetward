package api

import (
	"context"
	"encoding/json"
	"errors"
	"log"
	"net"
	"net/http"
	"strconv"
	"strings"
	"time"

	"qnetward/internal/platform/notify"
	"qnetward/internal/store"
)

type channelRequest struct {
	ID      int64    `json:"id,omitempty"`
	Kind    string   `json:"kind"`
	Name    string   `json:"name"`
	URL     string   `json:"url,omitempty"`
	Token   string   `json:"token,omitempty"`
	ChatID  string   `json:"chat_id,omitempty"`
	Events  []string `json:"events"`
	Enabled *bool    `json:"enabled,omitempty"`
}

type channelSaveResponse struct {
	Channel store.Channel `json:"channel"`
	// SigningSecret is returned once, when a webhook channel is created.
	SigningSecret string `json:"signing_secret,omitempty"`
}

// handleChannels lists, saves, and deletes the workspace's alert channels.
// Any member can list them; owners and admins change them.
func (srv *Server) handleChannels(w http.ResponseWriter, r *http.Request) {
	user, ok := srv.requireActorFor(w, r, "")
	if !ok {
		return
	}
	if r.Method == http.MethodGet {
		ctx, cancel := context.WithTimeout(r.Context(), 10*time.Second)
		defer cancel()
		channels, err := srv.store.ListChannels(ctx, user.WorkspaceID)
		if err != nil {
			writeJSON(w, http.StatusInternalServerError, apiError{Error: err.Error()})
			return
		}
		writeJSON(w, http.StatusOK, map[string]any{"channels": channels, "kinds": store.ChannelKinds, "events": store.ChannelEvents})
		return
	}
	if !srv.canManageChannels(w, r, user) {
		return
	}

	switch r.Method {
	case http.MethodPost:
		var req channelRequest
		if err := decodeJSON(w, r, &req); err != nil {
			writeJSON(w, http.StatusBadRequest, apiError{Error: err.Error()})
			return
		}
		ctx, cancel := context.WithTimeout(r.Context(), 10*time.Second)
		defer cancel()
		ch := store.Channel{ID: req.ID, WorkspaceID: user.WorkspaceID, CreatedBy: user.ID, Kind: req.Kind, Name: req.Name, Events: req.Events, Enabled: true}
		if req.Enabled != nil {
			ch.Enabled = *req.Enabled
		}

		// A new channel needs a destination; an edit may leave it blank to keep it.
		cfg := notify.Config{URL: req.URL, Token: req.Token, ChatID: req.ChatID}
		changing := req.ID == 0 || strings.TrimSpace(req.URL) != "" || strings.TrimSpace(req.Token) != "" || strings.TrimSpace(req.ChatID) != ""
		var secret string
		if changing {
			if req.ID != 0 {
				existing, err := srv.store.GetChannel(ctx, user.WorkspaceID, req.ID)
				if err != nil {
					writeChannelError(w, err)
					return
				}
				ch.Kind = existing.Kind
				// Keep the webhook's signing secret, and a Telegram token or chat left blank.
				if old, err := srv.openChannelConfig(existing); err == nil {
					cfg.Secret = old.Secret
					if ch.Kind == store.ChannelTelegram {
						if cfg.Token == "" {
							cfg.Token = old.Token
						}
						if cfg.ChatID == "" {
							cfg.ChatID = old.ChatID
						}
					}
				}
			}
			if err := notify.Validate(ch.Kind, &cfg); err != nil {
				writeJSON(w, http.StatusBadRequest, apiError{Error: err.Error()})
				return
			}
			if ch.Kind == store.ChannelWebhook && cfg.Secret == "" {
				token, _, err := generateOpaqueToken()
				if err != nil {
					writeJSON(w, http.StatusInternalServerError, apiError{Error: "could not generate a signing secret"})
					return
				}
				cfg.Secret = "whsec_" + token
				secret = cfg.Secret
			}
			sealed, err := srv.sealChannelConfig(cfg)
			if err != nil {
				writeJSON(w, http.StatusInternalServerError, apiError{Error: "could not store the destination"})
				return
			}
			ch.ConfigEnc = sealed
			ch.Target = notify.Mask(ch.Kind, cfg)
		} else if req.ID != 0 {
			existing, err := srv.store.GetChannel(ctx, user.WorkspaceID, req.ID)
			if err != nil {
				writeChannelError(w, err)
				return
			}
			ch.Kind = existing.Kind
		}

		saved, err := srv.store.SaveChannel(ctx, ch)
		if err != nil {
			writeChannelError(w, err)
			return
		}
		status, action := http.StatusOK, "channel.updated"
		if req.ID == 0 {
			status, action = http.StatusCreated, "channel.created"
		}
		srv.recordAudit(r, user.WorkspaceID, user.User, action, idTarget("channel", saved.ID, saved.Name),
			map[string]any{"kind": saved.Kind, "events": strings.Join(saved.Events, ","), "enabled": saved.Enabled})
		writeJSON(w, status, channelSaveResponse{Channel: saved, SigningSecret: secret})
	case http.MethodDelete:
		id, err := strconv.ParseInt(strings.TrimSpace(r.URL.Query().Get("id")), 10, 64)
		if err != nil || id <= 0 {
			writeJSON(w, http.StatusBadRequest, apiError{Error: "valid channel id is required"})
			return
		}
		ctx, cancel := context.WithTimeout(r.Context(), 10*time.Second)
		defer cancel()
		deleted, err := srv.store.DeleteChannel(ctx, user.WorkspaceID, id)
		if err != nil {
			writeChannelError(w, err)
			return
		}
		srv.recordAudit(r, user.WorkspaceID, user.User, "channel.deleted", idTarget("channel", deleted.ID, deleted.Name), map[string]any{"kind": deleted.Kind})
		writeJSON(w, http.StatusOK, map[string]any{"ok": true, "id": id})
	default:
		writeJSON(w, http.StatusMethodNotAllowed, apiError{Error: "method not allowed"})
	}
}

// handleChannelTest sends a test message to a channel and reports the result.
func (srv *Server) handleChannelTest(w http.ResponseWriter, r *http.Request) {
	user, ok := srv.requireActorFor(w, r, "")
	if !ok {
		return
	}
	if r.Method != http.MethodPost {
		writeJSON(w, http.StatusMethodNotAllowed, apiError{Error: "method not allowed"})
		return
	}
	if !srv.canManageChannels(w, r, user) {
		return
	}
	var req struct {
		ID int64 `json:"id"`
	}
	if err := decodeJSON(w, r, &req); err != nil {
		writeJSON(w, http.StatusBadRequest, apiError{Error: err.Error()})
		return
	}
	ctx, cancel := context.WithTimeout(r.Context(), 20*time.Second)
	defer cancel()
	ch, err := srv.store.GetChannel(ctx, user.WorkspaceID, req.ID)
	if err != nil {
		writeChannelError(w, err)
		return
	}
	msg := notify.Message{
		Event:    "test",
		Severity: "info",
		Title:    "Test alert from Qnetward",
		Summary:  "If you can read this, " + ch.Name + " is set up. Real alerts arrive here when a monitor goes down or comes back.",
		URL:      srv.buildConfiguredDashboardURL("monitors"),
		At:       time.Now().UTC(),
	}
	sendErr := srv.deliver(ctx, ch, msg)
	if sendErr != nil {
		writeJSON(w, http.StatusOK, map[string]any{"ok": false, "error": sendErr.Error()})
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"ok": true})
}

func (srv *Server) canManageChannels(w http.ResponseWriter, r *http.Request, user actor) bool {
	if !srv.isAllowedRequestOrigin(r) {
		writeJSON(w, http.StatusForbidden, apiError{Error: "forbidden origin"})
		return false
	}
	if user.Role != "owner" && user.Role != "admin" {
		writeJSON(w, http.StatusForbidden, apiError{Error: "only workspace owners and admins can manage alert channels"})
		return false
	}
	if srv.isDemoUser(user.User) {
		writeJSON(w, http.StatusForbidden, apiError{Error: "the shared demo account can't change alert channels"})
		return false
	}
	return true
}

func writeChannelError(w http.ResponseWriter, err error) {
	switch {
	case errors.Is(err, store.ErrChannelNotFound):
		writeJSON(w, http.StatusNotFound, apiError{Error: err.Error()})
	case errors.Is(err, store.ErrChannelLimit):
		writeJSON(w, http.StatusConflict, apiError{Error: err.Error()})
	default:
		writeJSON(w, http.StatusBadRequest, apiError{Error: err.Error()})
	}
}

func (srv *Server) sealChannelConfig(cfg notify.Config) (string, error) {
	raw, err := json.Marshal(cfg)
	if err != nil {
		return "", err
	}
	return srv.secrets.Seal(string(raw))
}

func (srv *Server) openChannelConfig(ch store.Channel) (notify.Config, error) {
	var cfg notify.Config
	plain, err := srv.secrets.Open(ch.ConfigEnc)
	if err != nil {
		return cfg, err
	}
	err = json.Unmarshal([]byte(plain), &cfg)
	return cfg, err
}

// notifySender delivers through a client that, like probes, can't reach
// private or internal addresses, and doesn't follow redirects.
func (srv *Server) notifySender() notify.Sender {
	dialer := &net.Dialer{Timeout: 5 * time.Second, Control: srv.targetPolicy.DialControl()}
	return notify.Sender{
		Client: &http.Client{
			Timeout:       10 * time.Second,
			Transport:     &http.Transport{DialContext: dialer.DialContext, TLSHandshakeTimeout: 5 * time.Second, DisableKeepAlives: true},
			CheckRedirect: func(*http.Request, []*http.Request) error { return http.ErrUseLastResponse },
		},
		TelegramAPI: srv.telegramAPI,
	}
}

// deliver sends one message to one channel and records how it went.
func (srv *Server) deliver(ctx context.Context, ch store.Channel, msg notify.Message) error {
	cfg, err := srv.openChannelConfig(ch)
	if err == nil {
		err = srv.notifySender().Send(ctx, ch.Kind, cfg, msg)
	}
	errText := ""
	if err != nil {
		errText = err.Error()
	}
	recordCtx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	if recErr := srv.store.RecordChannelDelivery(recordCtx, ch.WorkspaceID, ch.ID, errText); recErr != nil {
		log.Printf("recording delivery for channel %d failed: %v", ch.ID, recErr)
	}
	return err
}

// notifyChannels sends msg, in the background, to every enabled channel in
// the workspace that subscribes to event.
func (srv *Server) notifyChannels(workspaceID int64, event string, msg notify.Message) {
	// Every alert worth sending to a channel is worth showing in open consoles.
	srv.publishNotice(workspaceID, event, msg)
	if srv.store == nil {
		return
	}
	srv.background.Add(1)
	go func() {
		defer srv.background.Done()
		ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
		defer cancel()
		channels, err := srv.store.ChannelsFor(ctx, workspaceID, event)
		if err != nil {
			log.Printf("listing channels for workspace %d failed: %v", workspaceID, err)
			return
		}
		for _, ch := range channels {
			if err := srv.deliver(ctx, ch, msg); err != nil {
				log.Printf("alert to channel %d (%s) failed: %v", ch.ID, ch.Kind, err)
			}
		}
	}()
}
