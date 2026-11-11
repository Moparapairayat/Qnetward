package api

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"strconv"
	"strings"
	"time"

	"qnetward/internal/engine/passive"
	"qnetward/internal/store"
)

const (
	// passiveScanTimeout bounds one scan; most finish in a few seconds.
	passiveScanTimeout = 40 * time.Second
	// The same domain at most this often per workspace, so a busy workspace
	// can't hammer someone else's site through us.
	passiveSameDomainPerHour = 12
)

// handlePassiveScans runs a passive check of a domain (POST), lists past
// scans (GET), returns one with its report (GET ?id=), or deletes one
// (DELETE ?id=).
func (srv *Server) handlePassiveScans(w http.ResponseWriter, r *http.Request) {
	switch r.Method {
	case http.MethodGet:
		user, ok := srv.requireActorFor(w, r, store.ScopeRead)
		if !ok {
			return
		}
		ctx, cancel := context.WithTimeout(r.Context(), 10*time.Second)
		defer cancel()
		if raw := strings.TrimSpace(r.URL.Query().Get("id")); raw != "" {
			id, err := strconv.ParseInt(raw, 10, 64)
			if err != nil || id <= 0 {
				writeJSON(w, http.StatusBadRequest, apiError{Error: "valid scan id is required"})
				return
			}
			scan, err := srv.store.GetSecurityScan(ctx, user.WorkspaceID, id)
			if err != nil {
				writeScanError(w, err)
				return
			}
			writeJSON(w, http.StatusOK, scan)
			return
		}
		domain := ""
		if raw := strings.TrimSpace(r.URL.Query().Get("domain")); raw != "" {
			d, err := passive.NormalizeDomain(raw)
			if err != nil {
				writeJSON(w, http.StatusBadRequest, apiError{Error: err.Error()})
				return
			}
			domain = d
		}
		limit, _ := strconv.Atoi(r.URL.Query().Get("limit"))
		scans, err := srv.store.ListSecurityScans(ctx, user.WorkspaceID, domain, limit)
		if err != nil {
			writeJSON(w, http.StatusInternalServerError, apiError{Error: err.Error()})
			return
		}
		writeJSON(w, http.StatusOK, map[string]any{"scans": scans})

	case http.MethodPost:
		user, ok := srv.requireActorFor(w, r, store.ScopeProbe)
		if !ok {
			return
		}
		if !srv.isAllowedRequestOrigin(r) {
			writeJSON(w, http.StatusForbidden, apiError{Error: "forbidden origin"})
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
		if allowed, retry := srv.quotaLimiter.Allow(fmt.Sprintf("ws:%d:passive:%s", user.WorkspaceID, domain),
			rateLimitConfig{Limit: passiveSameDomainPerHour, Window: time.Hour}); !allowed {
			w.Header().Set("Retry-After", strconv.Itoa(int(retry.Seconds())))
			writeJSON(w, http.StatusTooManyRequests, apiError{Error: fmt.Sprintf("%s was checked %d times this hour; try again in %s",
				domain, passiveSameDomainPerHour, retry.Round(time.Minute))})
			return
		}
		if !srv.enforceWorkspaceQuota(w, user, quotaScan) {
			return
		}
		release, ok := srv.tryAcquireProbeSlot()
		if !ok {
			writeJSON(w, http.StatusTooManyRequests, apiError{Error: "server busy, try again"})
			return
		}
		defer release()

		scan, rep, err := srv.runPassiveScan(r.Context(), user.WorkspaceID, user.ID, domain)
		if err != nil {
			status := http.StatusInternalServerError
			if errors.Is(err, errScanFailed) {
				status = http.StatusUnprocessableEntity
			}
			writeJSON(w, status, apiError{Error: strings.TrimPrefix(err.Error(), errScanFailed.Error()+": ")})
			return
		}
		srv.events.publish(user.WorkspaceID, liveEvent{Type: "security.scan"})
		srv.recordAudit(r, user.WorkspaceID, user.User, "scan.passive", auditTarget{Type: "domain", ID: rep.Domain, Label: rep.Domain},
			map[string]any{"grade": rep.Grade, "score": rep.Score})
		writeJSON(w, http.StatusCreated, scan)

	case http.MethodDelete:
		user, ok := srv.requireActorFor(w, r, store.ScopeWrite)
		if !ok {
			return
		}
		if !srv.isAllowedRequestOrigin(r) {
			writeJSON(w, http.StatusForbidden, apiError{Error: "forbidden origin"})
			return
		}
		id, err := strconv.ParseInt(strings.TrimSpace(r.URL.Query().Get("id")), 10, 64)
		if err != nil || id <= 0 {
			writeJSON(w, http.StatusBadRequest, apiError{Error: "valid scan id is required"})
			return
		}
		ctx, cancel := context.WithTimeout(r.Context(), 10*time.Second)
		defer cancel()
		if err := srv.store.DeleteSecurityScan(ctx, user.WorkspaceID, id); err != nil {
			writeScanError(w, err)
			return
		}
		writeJSON(w, http.StatusOK, map[string]any{"ok": true, "id": id})

	default:
		writeJSON(w, http.StatusMethodNotAllowed, apiError{Error: "method not allowed"})
	}
}

// errScanFailed wraps a scan that couldn't run, as opposed to one that ran
// but couldn't be saved.
var errScanFailed = errors.New("scan failed")

// runPassiveScan checks a domain and saves the result.
func (srv *Server) runPassiveScan(ctx context.Context, workspaceID, userID int64, domain string) (store.SecurityScan, passive.Report, error) {
	runCtx, cancel := context.WithTimeout(ctx, passiveScanTimeout)
	defer cancel()
	rep, err := passive.Run(runCtx, domain, passive.Config{
		CheckHost:   srv.targetPolicy.CheckHost,
		DialControl: srv.targetPolicy.DialControl(),
		RootCAs:     srv.monitorRootCAs,
	})
	if err != nil {
		return store.SecurityScan{}, passive.Report{}, fmt.Errorf("%w: %w", errScanFailed, err)
	}
	raw, err := json.Marshal(rep)
	if err != nil {
		return store.SecurityScan{}, rep, errors.New("could not save the report")
	}
	saveCtx, saveCancel := context.WithTimeout(context.WithoutCancel(ctx), 10*time.Second)
	defer saveCancel()
	scan, err := srv.store.SaveSecurityScan(saveCtx, store.SecurityScan{
		WorkspaceID: workspaceID, UserID: userID, Kind: "passive", Domain: rep.Domain,
		Grade: rep.Grade, Score: rep.Score, High: rep.Counts[passive.High], Medium: rep.Counts[passive.Medium], Low: rep.Counts[passive.Low],
		Report: raw,
	})
	return scan, rep, err
}

func writeScanError(w http.ResponseWriter, err error) {
	if errors.Is(err, store.ErrSecurityScanNotFound) {
		writeJSON(w, http.StatusNotFound, apiError{Error: err.Error()})
		return
	}
	writeJSON(w, http.StatusInternalServerError, apiError{Error: err.Error()})
}
