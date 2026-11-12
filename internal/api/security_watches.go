package api

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"log"
	"net/http"
	"slices"
	"strconv"
	"strings"
	"sync"
	"time"

	"qnetward/internal/engine/passive"
	"qnetward/internal/platform/mailer"
	"qnetward/internal/store"
)

const (
	watchPollEvery   = time.Minute
	watchClaimBatch  = 4
	watchConcurrency = 2
)

type watchRequest struct {
	ID            int64  `json:"id,omitempty"`
	Domain        string `json:"domain"`
	IntervalHours int    `json:"interval_hours"`
	NotifyEmail   string `json:"notify_email"`
	Enabled       *bool  `json:"enabled,omitempty"`
}

// handleSecurityWatches lists, saves, and removes the domains whose passive
// check runs on a schedule.
func (srv *Server) handleSecurityWatches(w http.ResponseWriter, r *http.Request) {
	switch r.Method {
	case http.MethodGet:
		user, ok := srv.requireActorFor(w, r, store.ScopeRead)
		if !ok {
			return
		}
		ctx, cancel := context.WithTimeout(r.Context(), 10*time.Second)
		defer cancel()
		watches, err := srv.store.ListSecurityWatches(ctx, user.WorkspaceID)
		if err != nil {
			writeJSON(w, http.StatusInternalServerError, apiError{Error: err.Error()})
			return
		}
		writeJSON(w, http.StatusOK, map[string]any{"watches": watches, "limit": user.Plan.Limits.WatchedDomains, "intervals": store.WatchIntervals})

	case http.MethodPost:
		user, ok := srv.requireActorFor(w, r, store.ScopeWrite)
		if !ok {
			return
		}
		if !srv.isAllowedRequestOrigin(r) {
			writeJSON(w, http.StatusForbidden, apiError{Error: "forbidden origin"})
			return
		}
		var req watchRequest
		if err := decodeJSON(w, r, &req); err != nil {
			writeJSON(w, http.StatusBadRequest, apiError{Error: err.Error()})
			return
		}
		watch := store.SecurityWatch{ID: req.ID, WorkspaceID: user.WorkspaceID, UserID: user.ID, IntervalHours: req.IntervalHours, NotifyEmail: req.NotifyEmail, Enabled: true}
		if watch.IntervalHours == 0 {
			watch.IntervalHours = 24
		}
		if req.Enabled != nil {
			watch.Enabled = *req.Enabled
		}
		if req.ID == 0 {
			domain, err := passive.NormalizeDomain(req.Domain)
			if err != nil {
				writeJSON(w, http.StatusBadRequest, apiError{Error: err.Error()})
				return
			}
			watch.Domain = domain
		}
		ctx, cancel := context.WithTimeout(r.Context(), 10*time.Second)
		defer cancel()
		saved, err := srv.store.SaveSecurityWatch(ctx, watch, user.Plan.Limits.WatchedDomains)
		if err != nil {
			switch {
			case errors.Is(err, store.ErrWatchNotFound):
				writeJSON(w, http.StatusNotFound, apiError{Error: err.Error()})
			case errors.Is(err, store.ErrWatchLimit), errors.Is(err, store.ErrWatchDuplicate):
				writeJSON(w, http.StatusConflict, apiError{Error: err.Error()})
			default:
				writeJSON(w, http.StatusBadRequest, apiError{Error: err.Error()})
			}
			return
		}
		status, action := http.StatusOK, "security.watch_updated"
		if req.ID == 0 {
			status, action = http.StatusCreated, "security.watch_created"
		}
		srv.recordAudit(r, user.WorkspaceID, user.User, action, auditTarget{Type: "domain", ID: saved.Domain, Label: saved.Domain},
			map[string]any{"interval_hours": saved.IntervalHours, "enabled": saved.Enabled})
		writeJSON(w, status, saved)

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
			writeJSON(w, http.StatusBadRequest, apiError{Error: "valid watch id is required"})
			return
		}
		ctx, cancel := context.WithTimeout(r.Context(), 10*time.Second)
		defer cancel()
		removed, err := srv.store.DeleteSecurityWatch(ctx, user.WorkspaceID, id)
		if err != nil {
			if errors.Is(err, store.ErrWatchNotFound) {
				writeJSON(w, http.StatusNotFound, apiError{Error: err.Error()})
				return
			}
			writeJSON(w, http.StatusInternalServerError, apiError{Error: err.Error()})
			return
		}
		srv.recordAudit(r, user.WorkspaceID, user.User, "security.watch_deleted", auditTarget{Type: "domain", ID: removed.Domain, Label: removed.Domain}, nil)
		writeJSON(w, http.StatusOK, map[string]any{"ok": true, "id": id})

	default:
		writeJSON(w, http.StatusMethodNotAllowed, apiError{Error: "method not allowed"})
	}
}

// RunSecurityWatches re-checks watched domains as they come due, until ctx
// ends. Like monitors, claiming moves a watch ahead, so instances share work.
func (srv *Server) RunSecurityWatches(ctx context.Context) {
	if srv.store == nil {
		return
	}
	tick := time.NewTicker(watchPollEvery)
	defer tick.Stop()
	slots := make(chan struct{}, watchConcurrency)
	var wg sync.WaitGroup
	defer wg.Wait()
	for {
		select {
		case <-ctx.Done():
			return
		case <-tick.C:
		}
		// Domain proofs are re-checked on the same clock.
		srv.recheckDomains(ctx)
		free := watchConcurrency - len(slots)
		if free <= 0 {
			continue
		}
		claimCtx, cancel := context.WithTimeout(ctx, 10*time.Second)
		due, err := srv.store.ClaimDueSecurityWatches(claimCtx, min(free, watchClaimBatch))
		cancel()
		if err != nil {
			log.Printf("claiming watched domains failed: %v", err)
			continue
		}
		for _, watch := range due {
			slots <- struct{}{}
			wg.Add(1)
			go func(watch store.SecurityWatch) {
				defer wg.Done()
				defer func() { <-slots }()
				srv.checkWatch(ctx, watch)
			}(watch)
		}
	}
}

// checkWatch runs one scheduled check and alerts on what got worse.
func (srv *Server) checkWatch(ctx context.Context, watch store.SecurityWatch) {
	var previous *passive.Report
	if watch.LastScanID != nil {
		getCtx, cancel := context.WithTimeout(ctx, 10*time.Second)
		if old, err := srv.store.GetSecurityScan(getCtx, watch.WorkspaceID, *watch.LastScanID); err == nil {
			var rep passive.Report
			if json.Unmarshal(old.Report, &rep) == nil {
				previous = &rep
			}
		}
		cancel()
	}

	scan, rep, err := srv.runPassiveScan(ctx, watch.WorkspaceID, watch.UserID, watch.Domain)
	recordCtx, cancel := context.WithTimeout(context.WithoutCancel(ctx), 10*time.Second)
	defer cancel()
	if err != nil {
		if ctx.Err() != nil {
			return // shutting down
		}
		msg := strings.TrimPrefix(err.Error(), errScanFailed.Error()+": ")
		if recErr := srv.store.RecordWatchResult(recordCtx, watch, nil, msg); recErr != nil {
			log.Printf("recording watch %d failed: %v", watch.ID, recErr)
		}
		return
	}
	if err := srv.store.RecordWatchResult(recordCtx, watch, &scan, ""); err != nil {
		log.Printf("recording watch %d failed: %v", watch.ID, err)
	}
	srv.events.publish(watch.WorkspaceID, liveEvent{Type: "security.scan"})

	if previous == nil {
		return
	}
	change := compareReports(*previous, rep)
	if change.empty() {
		return
	}
	in := srv.securityAlert(watch, scan, change)
	srv.notifyChannels(watch.WorkspaceID, store.ChannelEventSecurity, toNotice(in, "security.regressed"))
	if watch.NotifyEmail != "" && srv.mailer != nil {
		in.To = watch.NotifyEmail
		srv.emailAlert(in)
	}
}

// reportChange is what got worse between two scans of a domain.
type reportChange struct {
	FromGrade, ToGrade string
	GradeDropped       bool
	NewHigh            []string
}

func (c reportChange) empty() bool { return !c.GradeDropped && len(c.NewHigh) == 0 }

var gradeRank = map[string]int{"A+": 6, "A": 5, "B": 4, "C": 3, "D": 2, "F": 1}

// compareReports finds a lower grade and high-severity findings that weren't
// there before. Getting better is not alert-worthy.
func compareReports(before, after passive.Report) reportChange {
	change := reportChange{FromGrade: before.Grade, ToGrade: after.Grade}
	change.GradeDropped = gradeRank[after.Grade] < gradeRank[before.Grade]
	var had []string
	for _, f := range before.Findings {
		if f.Severity == passive.High {
			had = append(had, f.ID)
		}
	}
	for _, f := range after.Findings {
		if f.Severity == passive.High && !slices.Contains(had, f.ID) {
			change.NewHigh = append(change.NewHigh, f.Title)
		}
	}
	return change
}

func (srv *Server) securityAlert(watch store.SecurityWatch, scan store.SecurityScan, change reportChange) mailer.AlertEmailInput {
	title := fmt.Sprintf("%s's security grade dropped to %s", watch.Domain, change.ToGrade)
	if !change.GradeDropped {
		title = fmt.Sprintf("New security issue on %s", watch.Domain)
	}
	var parts []string
	if change.GradeDropped {
		parts = append(parts, fmt.Sprintf("The grade went from %s to %s.", change.FromGrade, change.ToGrade))
	}
	if len(change.NewHigh) > 0 {
		parts = append(parts, "New high-severity issues: "+strings.Join(change.NewHigh, "; ")+".")
	}
	url := srv.buildConfiguredDashboardURL("passive-checks")
	if url != "" {
		url += fmt.Sprintf("?scan=%d", scan.ID)
	}
	return mailer.AlertEmailInput{
		Severity:     "warning",
		Title:        title,
		Summary:      strings.Join(parts, " "),
		Target:       watch.Domain,
		TriggeredAt:  time.Now().UTC(),
		DashboardURL: url,
	}
}
