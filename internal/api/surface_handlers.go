package api

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"log"
	"net/http"
	"strconv"
	"time"

	"qnetward/internal/engine/passive"
	"qnetward/internal/engine/surface"
	"qnetward/internal/store"
)

// surfaceScanTimeout bounds one attack surface scan.
const surfaceScanTimeout = 4 * time.Minute

// surfaceRun is the scan; tests replace it to stay off the network.
var surfaceRun = surface.Run

// handleSurfaceScans starts an attack surface scan of a verified domain
// (POST, answered at once while it runs), lists scans, returns one, or
// deletes one.
func (srv *Server) handleSurfaceScans(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		srv.handleScans(w, r, "surface")
		return
	}
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
	ctx, cancel := context.WithTimeout(r.Context(), 10*time.Second)
	defer cancel()

	// The gate: only domains this workspace has proved it controls.
	if _, err := srv.store.VerifiedDomainFor(ctx, user.WorkspaceID, domain); err != nil {
		if errors.Is(err, store.ErrDomainNotFound) {
			writeJSON(w, http.StatusForbidden, apiError{Error: fmt.Sprintf("verify that you control %s in Assets before scanning it", domain)})
			return
		}
		writeJSON(w, http.StatusInternalServerError, apiError{Error: err.Error()})
		return
	}
	limit := user.Plan.Limits.SurfaceScansPerHour
	if allowed, retry := srv.quotaLimiter.Allow(fmt.Sprintf("ws:%d:surface", user.WorkspaceID), rateLimitConfig{Limit: limit, Window: time.Hour}); !allowed {
		w.Header().Set("Retry-After", strconv.Itoa(int(retry.Seconds())))
		writeJSON(w, http.StatusTooManyRequests, apiError{Error: fmt.Sprintf("the %s plan runs %d attack surface scans an hour; try again in %s", user.Plan.Name, limit, retry.Round(time.Minute))})
		return
	}
	scan, err := srv.store.StartSecurityScan(ctx, store.SecurityScan{WorkspaceID: user.WorkspaceID, UserID: user.ID, Kind: "surface", Domain: domain})
	if err != nil {
		status := http.StatusInternalServerError
		if errors.Is(err, store.ErrScanRunning) {
			status = http.StatusConflict
		}
		writeJSON(w, status, apiError{Error: err.Error()})
		return
	}
	srv.recordAudit(r, user.WorkspaceID, user.User, "scan.surface", auditTarget{Type: "domain", ID: domain, Label: domain}, map[string]any{"scan_id": scan.ID})

	srv.background.Add(1)
	go func() {
		defer srv.background.Done()
		srv.runSurfaceScan(scan)
	}()
	writeJSON(w, http.StatusAccepted, scan)
}

// runSurfaceScan does the scan and stores what it found.
func (srv *Server) runSurfaceScan(scan store.SecurityScan) { srv.finishSurfaceScan(scan) }

// finishSurfaceScan runs a started scan, saves the result, and returns it.
func (srv *Server) finishSurfaceScan(scan store.SecurityScan) (surface.Report, bool) {
	ctx, cancel := context.WithTimeout(context.Background(), surfaceScanTimeout)
	defer cancel()
	cfg := surface.Config{
		CheckAddr:   srv.targetPolicy.CheckAddr,
		DialControl: srv.targetPolicy.DialControl(),
	}
	if srv.vulns != nil {
		cfg.Vulns = srv.vulns
	}
	rep, err := surfaceRun(ctx, scan.Domain, cfg)
	saveCtx, saveCancel := context.WithTimeout(context.Background(), 15*time.Second)
	defer saveCancel()
	failure := ""
	if err != nil {
		failure = err.Error()
	} else if raw, mErr := json.Marshal(rep); mErr != nil {
		failure = "could not save the report"
	} else {
		scan.Report, scan.Grade, scan.Score = raw, rep.Grade, rep.Score
		scan.High, scan.Medium, scan.Low = rep.Counts[passive.High], rep.Counts[passive.Medium], rep.Counts[passive.Low]
	}
	if err := srv.store.FinishSecurityScan(saveCtx, scan, failure); err != nil {
		log.Printf("saving attack surface scan %d failed: %v", scan.ID, err)
		failure = "could not save the report"
	}
	srv.events.publish(scan.WorkspaceID, liveEvent{Type: "security.scan"})
	return rep, failure == ""
}
