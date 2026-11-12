package api

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"log"
	"net/http"
	"slices"
	"strconv"
	"strings"
	"time"

	"qnetward/internal/engine/deep"
	"qnetward/internal/engine/passive"
	"qnetward/internal/platform/mailer"
	"qnetward/internal/store"
)

const (
	// consentVersion changes whenever the authorization's wording does.
	consentVersion = "2026-11-12"
	deepMaxHosts   = 20
	deepRunTimeout = 20 * time.Minute
)

// deepWindows are the windows, in hours, a request can ask for.
var deepWindows = []int{24, 72, 168}

var checkDescriptions = map[string]string{
	deep.CheckExposedFiles: "requests for about 20 paths that should never be public, such as /.git/HEAD, /.env, backup archives, database dumps, and server status pages, at most a few per second",
}

// deepScanInput is what a workspace asks for, signed.
type deepScanInput struct {
	Domain      string    `json:"domain"`
	Hosts       []string  `json:"hosts"`
	Checks      []string  `json:"checks"`
	WindowStart time.Time `json:"window_start"`
	WindowHours int       `json:"window_hours"`
	Name        string    `json:"name"`
}

// consentText is the authorization the requester signs. It names every
// detail of the scope, so the signature covers exactly what will run.
func consentText(in deepScanInput, workspace, email string) string {
	var checks []string
	for _, c := range in.Checks {
		checks = append(checks, "- "+c+": "+checkDescriptions[c])
	}
	end := in.WindowStart.Add(time.Duration(in.WindowHours) * time.Hour)
	return fmt.Sprintf(`Qnetward deep scan authorization (version %s)

I, %s, confirm that:

1. I own %s, or I am authorized in writing by its owner, to have these hosts tested:
   %s
2. I authorize Qnetward to run the following checks against those hosts only, between %s and %s UTC:
%s
3. I understand these checks request things an ordinary visitor would not. They may appear in the hosts' logs, trigger security alerts, and in rare cases affect a fragile service.
4. I accept responsibility for this authorization. Qnetward may refuse, pause, or stop the scan at any time, and keeps this record with the time, address, and browser it was signed from.

Requested from the workspace "%s" by %s.`,
		consentVersion, in.Name, in.Domain, strings.Join(in.Hosts, ", "),
		in.WindowStart.UTC().Format("2 Jan 2006 15:04"), end.UTC().Format("2 Jan 2006 15:04"), strings.Join(checks, "\n"),
		workspace, email)
}

func hashText(s string) string {
	sum := sha256.Sum256([]byte(s))
	return hex.EncodeToString(sum[:])
}

// normalizeDeepInput checks the scope against the plan and the workspace's
// verified domains, and fills in defaults.
func (srv *Server) normalizeDeepInput(ctx context.Context, user actor, in deepScanInput) (deepScanInput, error) {
	domain, err := passive.NormalizeDomain(in.Domain)
	if err != nil {
		return in, err
	}
	in.Domain = domain
	in.Name = strings.Join(strings.Fields(in.Name), " ")
	if len(in.Name) < 3 || len(in.Name) > 120 {
		return in, errors.New("type your full name to sign")
	}
	if len(in.Checks) == 0 {
		in.Checks = []string{deep.CheckExposedFiles}
	}
	for _, c := range in.Checks {
		if !slices.Contains(deep.Checks, c) {
			return in, fmt.Errorf("unknown check %q", c)
		}
	}
	if len(in.Hosts) == 0 {
		in.Hosts = []string{domain}
	}
	if len(in.Hosts) > deepMaxHosts {
		return in, fmt.Errorf("a deep scan covers at most %d hosts", deepMaxHosts)
	}
	var hosts []string
	for _, h := range in.Hosts {
		host, err := passive.NormalizeDomain(h)
		if err != nil {
			return in, err
		}
		if host != domain && !strings.HasSuffix(host, "."+domain) {
			return in, fmt.Errorf("%s isn't under %s", host, domain)
		}
		if _, err := srv.store.VerifiedDomainFor(ctx, user.WorkspaceID, host); err != nil {
			return in, fmt.Errorf("verify that you control %s in Assets first", host)
		}
		if !slices.Contains(hosts, host) {
			hosts = append(hosts, host)
		}
	}
	slices.Sort(hosts)
	in.Hosts = hosts
	if !slices.Contains(deepWindows, in.WindowHours) {
		return in, errors.New("the window is 24 hours, 3 days, or 7 days")
	}
	now := time.Now().UTC()
	if in.WindowStart.IsZero() {
		in.WindowStart = now
	}
	in.WindowStart = in.WindowStart.UTC().Truncate(time.Minute)
	if in.WindowStart.Before(now.Add(-time.Hour)) || in.WindowStart.After(now.Add(30*24*time.Hour)) {
		return in, errors.New("the window must start within the next 30 days")
	}
	return in, nil
}

// handleDeepScans lists the workspace's requests (GET), previews the
// authorization to sign (POST ?preview=1), submits a signed request (POST),
// or cancels one (DELETE ?id=).
func (srv *Server) handleDeepScans(w http.ResponseWriter, r *http.Request) {
	switch r.Method {
	case http.MethodGet:
		user, ok := srv.requireActorFor(w, r, store.ScopeRead)
		if !ok {
			return
		}
		ctx, cancel := context.WithTimeout(r.Context(), 10*time.Second)
		defer cancel()
		list, err := srv.store.ListDeepScanRequests(ctx, user.WorkspaceID)
		if err != nil {
			writeJSON(w, http.StatusInternalServerError, apiError{Error: err.Error()})
			return
		}
		writeJSON(w, http.StatusOK, map[string]any{
			"requests": list, "per_month": user.Plan.Limits.DeepScansPerMonth, "windows": deepWindows,
			"checks": map[string]string{deep.CheckExposedFiles: "Exposed files: " + checkDescriptions[deep.CheckExposedFiles]},
		})

	case http.MethodPost:
		user, ok := srv.canRequestDeepScans(w, r)
		if !ok {
			return
		}
		var req struct {
			deepScanInput
			ConsentHash string `json:"consent_hash"`
			Accept      bool   `json:"accept"`
		}
		if err := decodeJSON(w, r, &req); err != nil {
			writeJSON(w, http.StatusBadRequest, apiError{Error: err.Error()})
			return
		}
		ctx, cancel := context.WithTimeout(r.Context(), 15*time.Second)
		defer cancel()
		in, err := srv.normalizeDeepInput(ctx, user, req.deepScanInput)
		if err != nil {
			writeJSON(w, http.StatusBadRequest, apiError{Error: err.Error()})
			return
		}
		// The workspace the request is made in, which may not be the user's first.
		workspace, _ := srv.resolveActiveWorkspace(ctx, user.User, user.WorkspaceID)
		text := consentText(in, workspace.Name, user.Email)
		hash := hashText(text)
		if r.URL.Query().Get("preview") == "1" {
			writeJSON(w, http.StatusOK, map[string]any{"text": text, "hash": hash, "version": consentVersion, "input": in})
			return
		}
		// The signature covers the text the requester saw: same scope, same words.
		if !req.Accept || req.ConsentHash != hash {
			writeJSON(w, http.StatusBadRequest, apiError{Error: "review the authorization again and sign it; the scope changed since it was shown"})
			return
		}
		used, err := srv.store.CountDeepScanRequestsSince(ctx, user.WorkspaceID, time.Now().AddDate(0, 0, -30))
		if err != nil {
			writeJSON(w, http.StatusInternalServerError, apiError{Error: err.Error()})
			return
		}
		if used >= user.Plan.Limits.DeepScansPerMonth {
			writeJSON(w, http.StatusConflict, apiError{Error: fmt.Sprintf("the %s plan allows %d deep scan requests in 30 days", user.Plan.Name, user.Plan.Limits.DeepScansPerMonth)})
			return
		}
		saved, err := srv.store.CreateDeepScanRequest(ctx, store.DeepScanRequest{
			WorkspaceID: user.WorkspaceID, UserID: user.ID, Domain: in.Domain, Hosts: in.Hosts, Checks: in.Checks,
			WindowStart: in.WindowStart, WindowEnd: in.WindowStart.Add(time.Duration(in.WindowHours) * time.Hour),
			ConsentVersion: consentVersion, ConsentText: text, ConsentHash: hash, ConsentName: in.Name,
			ConsentIP: clientIPFromRequest(r), ConsentUserAgent: r.UserAgent(),
		})
		if err != nil {
			writeJSON(w, http.StatusInternalServerError, apiError{Error: err.Error()})
			return
		}
		srv.recordAudit(r, user.WorkspaceID, user.User, "deep.requested", idTarget("deep_scan", saved.ID, saved.Domain),
			map[string]any{"hosts": strings.Join(saved.Hosts, ","), "consent_hash": saved.ConsentHash})
		srv.tellAdminsAboutDeepRequest(saved, workspace.Name)
		writeJSON(w, http.StatusCreated, saved)

	case http.MethodDelete:
		user, ok := srv.canRequestDeepScans(w, r)
		if !ok {
			return
		}
		id, err := strconv.ParseInt(strings.TrimSpace(r.URL.Query().Get("id")), 10, 64)
		if err != nil || id <= 0 {
			writeJSON(w, http.StatusBadRequest, apiError{Error: "valid id is required"})
			return
		}
		ctx, cancel := context.WithTimeout(r.Context(), 10*time.Second)
		defer cancel()
		d, err := srv.store.CancelDeepScanRequest(ctx, user.WorkspaceID, id)
		if err != nil {
			status := http.StatusInternalServerError
			switch {
			case errors.Is(err, store.ErrDeepRequestNotFound):
				status = http.StatusNotFound
			case errors.Is(err, store.ErrDeepRequestState):
				status = http.StatusConflict
			}
			writeJSON(w, status, apiError{Error: err.Error()})
			return
		}
		srv.recordAudit(r, user.WorkspaceID, user.User, "deep.cancelled", idTarget("deep_scan", d.ID, d.Domain), nil)
		writeJSON(w, http.StatusOK, d)

	default:
		writeJSON(w, http.StatusMethodNotAllowed, apiError{Error: "method not allowed"})
	}
}

// canRequestDeepScans lets owners and admins on a plan with deep scans ask.
func (srv *Server) canRequestDeepScans(w http.ResponseWriter, r *http.Request) (actor, bool) {
	user, ok := srv.requireActorFor(w, r, store.ScopeWrite)
	if !ok {
		return actor{}, false
	}
	if !srv.isAllowedRequestOrigin(r) {
		writeJSON(w, http.StatusForbidden, apiError{Error: "forbidden origin"})
		return actor{}, false
	}
	if user.Role != "owner" && user.Role != "admin" {
		writeJSON(w, http.StatusForbidden, apiError{Error: "only workspace owners and admins can request deep scans"})
		return actor{}, false
	}
	if srv.isDemoUser(user.User) {
		writeJSON(w, http.StatusForbidden, apiError{Error: "the shared demo account can't request deep scans"})
		return actor{}, false
	}
	if user.Plan.Limits.DeepScansPerMonth <= 0 {
		writeJSON(w, http.StatusPaymentRequired, apiError{Error: "deep scans are on the Pro and Enterprise plans"})
		return actor{}, false
	}
	return user, true
}

// handleAdminDeepScans lists requests for review (GET ?status=) and
// approves or rejects one (POST). Platform admins only.
func (srv *Server) handleAdminDeepScans(w http.ResponseWriter, r *http.Request) {
	admin, ok := srv.requirePlatformAdmin(w, r)
	if !ok {
		return
	}
	ctx, cancel := context.WithTimeout(r.Context(), 15*time.Second)
	defer cancel()
	switch r.Method {
	case http.MethodGet:
		list, err := srv.store.AdminListDeepScanRequests(ctx, strings.TrimSpace(r.URL.Query().Get("status")))
		if err != nil {
			writeJSON(w, http.StatusInternalServerError, apiError{Error: err.Error()})
			return
		}
		writeJSON(w, http.StatusOK, map[string]any{"requests": list})
	case http.MethodPost:
		if !srv.isAllowedRequestOrigin(r) {
			writeJSON(w, http.StatusForbidden, apiError{Error: "forbidden origin"})
			return
		}
		var req struct {
			ID      int64  `json:"id"`
			Approve bool   `json:"approve"`
			Note    string `json:"note"`
		}
		if err := decodeJSON(w, r, &req); err != nil {
			writeJSON(w, http.StatusBadRequest, apiError{Error: err.Error()})
			return
		}
		if !req.Approve && strings.TrimSpace(req.Note) == "" {
			writeJSON(w, http.StatusBadRequest, apiError{Error: "say why it's rejected; the requester sees the note"})
			return
		}
		d, err := srv.store.ReviewDeepScanRequest(ctx, req.ID, req.Approve, admin.ID, admin.Email, strings.TrimSpace(req.Note))
		if err != nil {
			status := http.StatusInternalServerError
			if errors.Is(err, store.ErrDeepRequestState) {
				status = http.StatusConflict
			}
			writeJSON(w, status, apiError{Error: err.Error()})
			return
		}
		action := "deep.rejected"
		if req.Approve {
			action = "deep.approved"
		}
		srv.recordAudit(r, d.WorkspaceID, admin, action, idTarget("deep_scan", d.ID, d.Domain), map[string]any{"note": d.ReviewNote})
		srv.tellRequesterAboutReview(d)
		if req.Approve && !d.WindowStart.After(time.Now()) {
			srv.background.Add(1)
			go func() {
				defer srv.background.Done()
				srv.runDueDeepScans(context.Background())
			}()
		}
		writeJSON(w, http.StatusOK, d)
	default:
		writeJSON(w, http.StatusMethodNotAllowed, apiError{Error: "method not allowed"})
	}
}

// runDueDeepScans starts approved scans whose window has opened.
func (srv *Server) runDueDeepScans(ctx context.Context) {
	claimCtx, cancel := context.WithTimeout(ctx, 10*time.Second)
	due, err := srv.store.ClaimDueDeepScans(claimCtx, 2)
	cancel()
	if err != nil {
		log.Printf("claiming deep scans failed: %v", err)
		return
	}
	for _, d := range due {
		srv.background.Add(1)
		go func(d store.DeepScanRequest) {
			defer srv.background.Done()
			srv.runDeepScan(d)
		}(d)
	}
}

// deepRun is the scan; tests replace it to stay off the network.
var deepRun = deep.Run

// runDeepScan runs one approved request inside its scope and window.
func (srv *Server) runDeepScan(d store.DeepScanRequest) {
	deadline := time.Now().Add(deepRunTimeout)
	if d.WindowEnd.Before(deadline) {
		deadline = d.WindowEnd
	}
	ctx, cancel := context.WithDeadline(context.Background(), deadline)
	defer cancel()
	rep, err := deepRun(ctx, d.Domain, d.Hosts, d.Checks, deep.Config{
		DialControl: srv.targetPolicy.DialControl(),
		// Every host is checked again right before it's touched: still in the
		// approved scope, and still verified.
		Allowed: func(ctx context.Context, host string) error {
			if !slices.Contains(d.Hosts, host) {
				return errors.New("not in the approved scope")
			}
			if _, err := srv.store.VerifiedDomainFor(ctx, d.WorkspaceID, host); err != nil {
				return errors.New("no longer verified")
			}
			if err := srv.targetPolicy.CheckHost(ctx, host); err != nil {
				return err
			}
			return nil
		},
	})
	saveCtx, saveCancel := context.WithTimeout(context.Background(), 15*time.Second)
	defer saveCancel()
	if err != nil {
		_ = srv.store.FinishDeepScan(saveCtx, d.ID, nil, false)
		log.Printf("deep scan %d failed: %v", d.ID, err)
		return
	}
	raw, _ := json.Marshal(rep)
	scan, err := srv.store.SaveSecurityScan(saveCtx, store.SecurityScan{
		WorkspaceID: d.WorkspaceID, UserID: d.UserID, Kind: "deep", Domain: d.Domain, Grade: rep.Grade, Score: rep.Score,
		High: rep.Counts[passive.High], Medium: rep.Counts[passive.Medium], Low: rep.Counts[passive.Low], Report: raw,
	})
	if err != nil {
		_ = srv.store.FinishDeepScan(saveCtx, d.ID, nil, false)
		log.Printf("saving deep scan %d failed: %v", d.ID, err)
		return
	}
	if err := srv.store.FinishDeepScan(saveCtx, d.ID, &scan.ID, true); err != nil {
		log.Printf("finishing deep scan %d failed: %v", d.ID, err)
	}
	srv.events.publish(d.WorkspaceID, liveEvent{Type: "security.scan"})

	summary := fmt.Sprintf("The deep scan of %s finished: %d high, %d medium, %d low.", d.Domain, scan.High, scan.Medium, scan.Low)
	in := mailer.AlertEmailInput{Severity: "info", Title: "Deep scan of " + d.Domain + " finished", Summary: summary, Target: d.Domain,
		TriggeredAt: time.Now().UTC(), DashboardURL: srv.buildConfiguredDashboardURL("scans")}
	if scan.High > 0 {
		in.Severity = "critical"
	}
	srv.notifyChannels(d.WorkspaceID, store.ChannelEventSecurity, toNotice(in, "deep.completed"))
	if u, err := srv.store.GetUserByID(saveCtx, d.UserID); err == nil {
		in.To, in.Name = u.Email, u.Name
		srv.emailAlert(in)
	}
}

func (srv *Server) tellAdminsAboutDeepRequest(d store.DeepScanRequest, workspace string) {
	url := srv.buildConfiguredDashboardURL("admin-deep-scans")
	for email := range srv.adminEmails {
		srv.emailAlert(mailer.AlertEmailInput{
			To: email, Severity: "warning", Title: "Deep scan request to review",
			Summary: fmt.Sprintf("%s asked for a deep scan of %s (%d hosts), signed by %s. It won't run until it's approved.",
				workspace, d.Domain, len(d.Hosts), d.ConsentName),
			Target: d.Domain, TriggeredAt: time.Now().UTC(), DashboardURL: url,
		})
	}
}

func (srv *Server) tellRequesterAboutReview(d store.DeepScanRequest) {
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	u, err := srv.store.GetUserByID(ctx, d.UserID)
	if err != nil {
		return
	}
	in := mailer.AlertEmailInput{To: u.Email, Name: u.Name, Target: d.Domain, TriggeredAt: time.Now().UTC(), DashboardURL: srv.buildConfiguredDashboardURL("scans")}
	if d.Status == "approved" {
		in.Severity, in.Title = "success", "Deep scan of "+d.Domain+" approved"
		in.Summary = fmt.Sprintf("It runs from %s UTC.", d.WindowStart.UTC().Format("2 Jan 15:04"))
	} else {
		in.Severity, in.Title = "warning", "Deep scan of "+d.Domain+" not approved"
		in.Summary = "Reason: " + d.ReviewNote
	}
	srv.emailAlert(in)
}
