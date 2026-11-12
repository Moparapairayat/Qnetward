package api

import (
	"context"
	"errors"
	"fmt"
	"log"
	"net/http"
	"strconv"
	"strings"
	"time"

	"qnetward/internal/engine/passive"
	"qnetward/internal/platform/mailer"
	"qnetward/internal/platform/ownership"
	"qnetward/internal/store"
)

// verifyChecksPerHour caps "Verify now" per workspace.
const verifyChecksPerHour = 60

// domainView is a domain with how to prove it, for the console.
type domainView struct {
	store.VerifiedDomain
	RecordName string `json:"record_name"`
	FileURL    string `json:"file_url"`
}

func viewDomain(d store.VerifiedDomain) domainView {
	return domainView{VerifiedDomain: d, RecordName: ownership.RecordName(d.Domain), FileURL: ownership.FileURL(d.Domain)}
}

// handleDomains lists, adds, and removes the workspace's domains.
func (srv *Server) handleDomains(w http.ResponseWriter, r *http.Request) {
	switch r.Method {
	case http.MethodGet:
		user, ok := srv.requireActorFor(w, r, store.ScopeRead)
		if !ok {
			return
		}
		ctx, cancel := context.WithTimeout(r.Context(), 10*time.Second)
		defer cancel()
		list, err := srv.store.ListDomains(ctx, user.WorkspaceID)
		if err != nil {
			writeJSON(w, http.StatusInternalServerError, apiError{Error: err.Error()})
			return
		}
		out := make([]domainView, 0, len(list))
		for _, d := range list {
			out = append(out, viewDomain(d))
		}
		writeJSON(w, http.StatusOK, map[string]any{"domains": out, "limit": user.Plan.Limits.VerifiedDomains})

	case http.MethodPost:
		user, ok := srv.canManageDomains(w, r)
		if !ok {
			return
		}
		var req struct {
			Domain string `json:"domain"`
		}
		if err := decodeJSON(w, r, &req); err != nil {
			writeJSON(w, http.StatusBadRequest, apiError{Error: err.Error()})
			return
		}
		domain, err := passive.NormalizeDomain(req.Domain)
		if err != nil {
			writeJSON(w, http.StatusBadRequest, apiError{Error: err.Error()})
			return
		}
		token, err := ownership.NewToken()
		if err != nil {
			writeJSON(w, http.StatusInternalServerError, apiError{Error: "could not create a token"})
			return
		}
		ctx, cancel := context.WithTimeout(r.Context(), 10*time.Second)
		defer cancel()
		d, err := srv.store.AddDomain(ctx, store.VerifiedDomain{WorkspaceID: user.WorkspaceID, UserID: user.ID, Domain: domain, Token: token}, user.Plan.Limits.VerifiedDomains)
		if err != nil {
			status := http.StatusBadRequest
			if errors.Is(err, store.ErrDomainLimit) || errors.Is(err, store.ErrDomainDuplicate) {
				status = http.StatusConflict
			}
			writeJSON(w, status, apiError{Error: err.Error()})
			return
		}
		srv.recordAudit(r, user.WorkspaceID, user.User, "domain.added", auditTarget{Type: "domain", ID: d.Domain, Label: d.Domain}, nil)
		writeJSON(w, http.StatusCreated, viewDomain(d))

	case http.MethodDelete:
		user, ok := srv.canManageDomains(w, r)
		if !ok {
			return
		}
		id, err := strconv.ParseInt(strings.TrimSpace(r.URL.Query().Get("id")), 10, 64)
		if err != nil || id <= 0 {
			writeJSON(w, http.StatusBadRequest, apiError{Error: "valid domain id is required"})
			return
		}
		ctx, cancel := context.WithTimeout(r.Context(), 10*time.Second)
		defer cancel()
		d, err := srv.store.DeleteDomain(ctx, user.WorkspaceID, id)
		if err != nil {
			writeDomainError(w, err)
			return
		}
		srv.recordAudit(r, user.WorkspaceID, user.User, "domain.removed", auditTarget{Type: "domain", ID: d.Domain, Label: d.Domain}, nil)
		writeJSON(w, http.StatusOK, map[string]any{"ok": true, "id": id})

	default:
		writeJSON(w, http.StatusMethodNotAllowed, apiError{Error: "method not allowed"})
	}
}

// handleDomainVerify looks for a domain's proof now.
func (srv *Server) handleDomainVerify(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		writeJSON(w, http.StatusMethodNotAllowed, apiError{Error: "method not allowed"})
		return
	}
	user, ok := srv.canManageDomains(w, r)
	if !ok {
		return
	}
	var req struct {
		ID int64 `json:"id"`
	}
	if err := decodeJSON(w, r, &req); err != nil {
		writeJSON(w, http.StatusBadRequest, apiError{Error: err.Error()})
		return
	}
	if allowed, retry := srv.quotaLimiter.Allow(fmt.Sprintf("ws:%d:domain-verify", user.WorkspaceID), rateLimitConfig{Limit: verifyChecksPerHour, Window: time.Hour}); !allowed {
		w.Header().Set("Retry-After", strconv.Itoa(int(retry.Seconds())))
		writeJSON(w, http.StatusTooManyRequests, apiError{Error: "too many verification attempts; try again in " + retry.Round(time.Minute).String()})
		return
	}
	ctx, cancel := context.WithTimeout(r.Context(), 30*time.Second)
	defer cancel()
	d, err := srv.store.GetDomain(ctx, user.WorkspaceID, req.ID)
	if err != nil {
		writeDomainError(w, err)
		return
	}
	saved, before, err := srv.checkDomainProof(ctx, d)
	if err != nil {
		writeDomainError(w, err)
		return
	}
	if saved.Status == "verified" && before != "verified" {
		srv.recordAudit(r, user.WorkspaceID, user.User, "domain.verified", auditTarget{Type: "domain", ID: saved.Domain, Label: saved.Domain}, map[string]any{"method": saved.Method})
	}
	writeJSON(w, http.StatusOK, viewDomain(saved))
}

// checkDomainProof looks for the proof and records what it found.
func (srv *Server) checkDomainProof(ctx context.Context, d store.VerifiedDomain) (store.VerifiedDomain, string, error) {
	method, err := ownership.Check(ctx, d.Domain, d.Token, ownership.Config{DialControl: srv.targetPolicy.DialControl()})
	res := store.DomainCheckResult{Found: err == nil, Method: method}
	if err != nil {
		res.Error = strings.TrimPrefix(err.Error(), ownership.ErrNotFound.Error()+" ")
		res.Error = strings.TrimSuffix(strings.TrimPrefix(res.Error, "("), ")")
	}
	saveCtx, cancel := context.WithTimeout(context.WithoutCancel(ctx), 10*time.Second)
	defer cancel()
	return srv.store.RecordDomainCheck(saveCtx, d, res)
}

// recheckDomains re-checks proofs as they come due: new domains hourly for a
// week, verified ones daily. A verified domain whose proof has been gone for
// a week lapses, and its workspace is told.
func (srv *Server) recheckDomains(ctx context.Context) {
	claimCtx, cancel := context.WithTimeout(ctx, 10*time.Second)
	due, err := srv.store.ClaimDueDomains(claimCtx, 10)
	cancel()
	if err != nil {
		log.Printf("claiming domains to re-check failed: %v", err)
		return
	}
	for _, d := range due {
		checkCtx, cancel := context.WithTimeout(ctx, 30*time.Second)
		saved, before, err := srv.checkDomainProof(checkCtx, d)
		cancel()
		if err != nil {
			if ctx.Err() == nil && !errors.Is(err, store.ErrDomainNotFound) {
				log.Printf("re-checking domain %d failed: %v", d.ID, err)
			}
			continue
		}
		if saved.Status == "lapsed" && before == "verified" {
			in := mailer.AlertEmailInput{
				Severity: "warning",
				Title:    saved.Domain + " is no longer verified",
				Summary: fmt.Sprintf("The proof that this workspace controls %s has been missing for a week, so checks that need it are paused. "+
					"Publish the TXT record or file again and verify it from Assets. %s", saved.Domain, saved.LastError),
				Target:       saved.Domain,
				TriggeredAt:  time.Now().UTC(),
				DashboardURL: srv.buildConfiguredDashboardURL("assets"),
			}
			srv.notifyChannels(saved.WorkspaceID, store.ChannelEventSecurity, toNotice(in, "domain.lapsed"))
		}
	}
}

// canManageDomains lets owners and admins change domains; the shared demo
// can't.
func (srv *Server) canManageDomains(w http.ResponseWriter, r *http.Request) (actor, bool) {
	user, ok := srv.requireActorFor(w, r, store.ScopeWrite)
	if !ok {
		return actor{}, false
	}
	if !srv.isAllowedRequestOrigin(r) {
		writeJSON(w, http.StatusForbidden, apiError{Error: "forbidden origin"})
		return actor{}, false
	}
	if user.Role != "owner" && user.Role != "admin" {
		writeJSON(w, http.StatusForbidden, apiError{Error: "only workspace owners and admins can manage domains"})
		return actor{}, false
	}
	if srv.isDemoUser(user.User) {
		writeJSON(w, http.StatusForbidden, apiError{Error: "the shared demo account can't add domains"})
		return actor{}, false
	}
	return user, true
}

func writeDomainError(w http.ResponseWriter, err error) {
	if errors.Is(err, store.ErrDomainNotFound) {
		writeJSON(w, http.StatusNotFound, apiError{Error: err.Error()})
		return
	}
	writeJSON(w, http.StatusInternalServerError, apiError{Error: err.Error()})
}
