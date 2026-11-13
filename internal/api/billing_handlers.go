package api

import (
	"context"
	"encoding/json"
	"errors"
	"log"
	"math"
	"net/http"
	"strconv"
	"strings"
	"time"

	"qnetward/internal/plans"
	"qnetward/internal/platform/uddoktapay"
	"qnetward/internal/store"
)

// Billing settings: where UddoktaPay lives and what Pro costs, in taka.
type Billing struct {
	UddoktaPayURL string
	UddoktaPayKey string
	ProMonthlyBDT float64
	ProYearlyBDT  float64
}

type priceOption struct {
	Plan   string  `json:"plan"`
	Months int     `json:"months"`
	Amount float64 `json:"amount"`
}

func (srv *Server) priceOptions() []priceOption {
	out := []priceOption{}
	if srv.billing.ProMonthlyBDT > 0 {
		out = append(out, priceOption{Plan: "pro", Months: 1, Amount: srv.billing.ProMonthlyBDT})
	}
	if srv.billing.ProYearlyBDT > 0 {
		out = append(out, priceOption{Plan: "pro", Months: 12, Amount: srv.billing.ProYearlyBDT})
	}
	return out
}

func (srv *Server) paymentsEnabled() bool {
	return srv.payments.Configured() && len(srv.priceOptions()) > 0
}

// handleBilling describes the workspace's plan, what it can buy, and, for
// owners and admins, its payments.
func (srv *Server) handleBilling(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		writeJSON(w, http.StatusMethodNotAllowed, apiError{Error: "method not allowed"})
		return
	}
	user, workspace, ok := srv.billingWorkspace(w, r)
	if !ok {
		return
	}
	ctx, cancel := context.WithTimeout(r.Context(), 10*time.Second)
	defer cancel()
	expires, err := srv.store.WorkspacePlanExpiry(ctx, workspace.ID)
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, apiError{Error: err.Error()})
		return
	}
	resp := map[string]any{
		"plan":             workspace.Plan,
		"plan_expires_at":  expires,
		"payments_enabled": srv.paymentsEnabled(),
		"prices":           srv.priceOptions(),
		"currency":         "BDT",
		"can_pay":          canManageBilling(workspace) && !srv.isDemoUser(user),
	}
	if canManageBilling(workspace) {
		payments, err := srv.store.ListPayments(ctx, workspace.ID)
		if err != nil {
			writeJSON(w, http.StatusInternalServerError, apiError{Error: err.Error()})
			return
		}
		resp["payments"] = payments
	}
	writeJSON(w, http.StatusOK, resp)
}

// handleBillingCheckout starts an UddoktaPay checkout for a plan period and
// returns the page to send the browser to.
func (srv *Server) handleBillingCheckout(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		writeJSON(w, http.StatusMethodNotAllowed, apiError{Error: "method not allowed"})
		return
	}
	if !srv.isAllowedRequestOrigin(r) {
		writeJSON(w, http.StatusForbidden, apiError{Error: "forbidden origin"})
		return
	}
	user, workspace, ok := srv.billingWorkspace(w, r)
	if !ok {
		return
	}
	if !canManageBilling(workspace) {
		writeJSON(w, http.StatusForbidden, apiError{Error: "only workspace owners and admins can pay for a plan"})
		return
	}
	if srv.isDemoUser(user) {
		writeJSON(w, http.StatusForbidden, apiError{Error: "the shared demo account can't buy a plan"})
		return
	}
	if !srv.paymentsEnabled() {
		writeJSON(w, http.StatusServiceUnavailable, apiError{Error: "online payment isn't set up on this server"})
		return
	}
	if workspace.Plan == "enterprise" {
		writeJSON(w, http.StatusConflict, apiError{Error: "this workspace is on Enterprise; contact us to change it"})
		return
	}
	var req struct {
		Plan   string `json:"plan"`
		Months int    `json:"months"`
	}
	if err := decodeJSON(w, r, &req); err != nil {
		writeJSON(w, http.StatusBadRequest, apiError{Error: err.Error()})
		return
	}
	var option *priceOption
	for _, o := range srv.priceOptions() {
		if o.Plan == req.Plan && o.Months == req.Months {
			option = &o
			break
		}
	}
	if option == nil {
		writeJSON(w, http.StatusBadRequest, apiError{Error: "pick Pro for 1 or 12 months"})
		return
	}

	ctx, cancel := context.WithTimeout(r.Context(), 30*time.Second)
	defer cancel()
	// The gateway needs a phone number; ask for billing details first.
	details, err := srv.store.GetBillingDetails(ctx, workspace.ID)
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, apiError{Error: "couldn't load billing details"})
		return
	}
	if details.Phone == "" {
		writeJSON(w, http.StatusConflict, map[string]any{"error": "add a phone number to the billing details first", "billing_details_required": true})
		return
	}
	payment, err := srv.store.CreatePayment(ctx, store.Payment{
		WorkspaceID: workspace.ID, UserID: user.ID, Provider: "uddoktapay", Plan: option.Plan, Months: option.Months, Amount: option.Amount, Currency: "BDT",
	})
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, apiError{Error: "couldn't start the payment"})
		return
	}
	name := details.Name
	if name == "" {
		name = strings.TrimSpace(user.Name)
	}
	if name == "" {
		name = user.Email
	}
	// Send the browser back to the site it paid from, so a local or staging
	// console doesn't land on production after paying.
	origin := r.Header.Get("Origin")
	if origin == "" {
		origin = r.Header.Get("X-Qnetward-Origin") // set by the console's API proxy
	}
	base := srv.billingReturnBase(r, strings.TrimRight(origin, "/"))
	paymentURL, err := srv.payments.CreateCharge(ctx, uddoktapay.Charge{
		FullName: name,
		Email:    user.Email,
		Phone:    details.Phone,
		Amount:   option.Amount,
		Metadata: map[string]string{
			"payment_id":   strconv.FormatInt(payment.ID, 10),
			"workspace_id": strconv.FormatInt(workspace.ID, 10),
			"return_to":    base,
		},
		RedirectURL: base + "/api/billing/uddoktapay/return",
		CancelURL:   base + "/workspace/billing?payment=cancelled",
		WebhookURL:  srv.appURL(r, "/api/billing/uddoktapay/webhook"),
	})
	if err != nil {
		log.Printf("starting payment %d failed: %v", payment.ID, err)
		_ = srv.store.FailPayment(ctx, payment.ID)
		writeJSON(w, http.StatusBadGateway, apiError{Error: err.Error()})
		return
	}
	// Keep the invoice now: if the browser never returns from the gateway,
	// the reconciler can still learn the outcome from it.
	if invoiceID := uddoktapay.InvoiceFromURL(paymentURL); invoiceID != "" {
		if err := srv.store.SetPaymentInvoice(ctx, payment.ID, invoiceID); err != nil {
			log.Printf("recording invoice for payment %d failed: %v", payment.ID, err)
		}
	}
	srv.recordAudit(r, workspace.ID, user, "billing.checkout_started", idTarget("payment", payment.ID, ""),
		map[string]any{"plan": option.Plan, "months": option.Months, "amount": option.Amount, "currency": "BDT"})
	writeJSON(w, http.StatusOK, map[string]any{"payment_url": paymentURL, "payment_id": payment.ID})
}

// handleUddoktaPayReturn is where the gateway sends the browser after paying.
// The invoice ID arrives in the query or form; the outcome comes from asking
// the gateway, never from the request itself.
func (srv *Server) handleUddoktaPayReturn(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet && r.Method != http.MethodPost {
		writeJSON(w, http.StatusMethodNotAllowed, apiError{Error: "method not allowed"})
		return
	}
	outcome, base := "failed", srv.billingReturnBase(r, "")
	if invoiceID := strings.TrimSpace(r.FormValue("invoice_id")); invoiceID != "" && srv.payments.Configured() {
		ctx, cancel := context.WithTimeout(r.Context(), 30*time.Second)
		defer cancel()
		var returnTo string
		outcome, returnTo = srv.settlePayment(ctx, r, invoiceID)
		base = srv.billingReturnBase(r, returnTo)
	}
	http.Redirect(w, r, base+"/workspace/billing?payment="+outcome, http.StatusSeeOther)
}

// handleUddoktaPayWebhook accepts the gateway's IPN. The API key header must
// match, and the payment is still verified with the gateway before use.
func (srv *Server) handleUddoktaPayWebhook(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		writeJSON(w, http.StatusMethodNotAllowed, apiError{Error: "method not allowed"})
		return
	}
	if !srv.payments.ValidKey(r.Header.Get("RT-UDDOKTAPAY-API-KEY")) {
		writeJSON(w, http.StatusUnauthorized, apiError{Error: "unauthorized"})
		return
	}
	var body struct {
		InvoiceID string `json:"invoice_id"`
	}
	if err := json.NewDecoder(http.MaxBytesReader(w, r.Body, 64<<10)).Decode(&body); err != nil || strings.TrimSpace(body.InvoiceID) == "" {
		writeJSON(w, http.StatusBadRequest, apiError{Error: "invoice_id is required"})
		return
	}
	ctx, cancel := context.WithTimeout(r.Context(), 30*time.Second)
	defer cancel()
	outcome, _ := srv.settlePayment(ctx, r, strings.TrimSpace(body.InvoiceID))
	writeJSON(w, http.StatusOK, map[string]any{"ok": true, "outcome": outcome})
}

// billingReturnBase picks the site to send the browser back to: candidate
// when it's one of the configured allowed origins, the public URL otherwise.
func (srv *Server) billingReturnBase(r *http.Request, candidate string) string {
	if normalized, err := normalizeOrigin(candidate); candidate != "" && err == nil {
		if _, ok := srv.allowedOrigins[normalized]; ok {
			return normalized
		}
	}
	return strings.TrimRight(srv.appURL(r, ""), "/")
}

// settlePayment verifies an invoice with the gateway and, if it's paid in
// full for one of our pending payments, applies the plan. r is nil when the
// reconciler calls it. It returns
// success, pending, or failed, and the site the checkout started from.
func (srv *Server) settlePayment(ctx context.Context, r *http.Request, invoiceID string) (string, string) {
	verified, err := srv.payments.Verify(ctx, invoiceID)
	if err != nil {
		log.Printf("verifying invoice %s failed: %v", invoiceID, err)
		return "failed", ""
	}
	returnTo := verified.Meta("return_to")
	paymentID, _ := strconv.ParseInt(verified.Meta("payment_id"), 10, 64)
	payment, err := srv.store.GetPayment(ctx, paymentID)
	if err != nil {
		log.Printf("invoice %s names an unknown payment %q", invoiceID, verified.Meta("payment_id"))
		return "failed", returnTo
	}
	if verified.Meta("workspace_id") != strconv.FormatInt(payment.WorkspaceID, 10) {
		log.Printf("invoice %s: workspace doesn't match payment %d", invoiceID, payment.ID)
		return "failed", returnTo
	}
	if payment.Status == "paid" {
		return "success", returnTo
	}
	switch {
	case verified.Pending():
		return "pending", returnTo
	case verified.Failed():
		_ = srv.store.FailPayment(ctx, payment.ID)
		return "failed", returnTo
	case !verified.Completed():
		// Not paid yet (INITIATED: the visitor left the payment page without
		// paying). Nothing is recorded, so paying later still completes it.
		return "unpaid", returnTo
	case math.Round(verified.AmountValue()*100) < math.Round(payment.Amount*100):
		log.Printf("invoice %s paid %s for payment %d of %.2f; not applying", invoiceID, verified.Amount, payment.ID, payment.Amount)
		return "failed", returnTo
	}
	paid, applied, err := srv.store.CompletePayment(ctx, payment.ID, invoiceID, verified.TransactionID, verified.PaymentMethod)
	if err != nil {
		log.Printf("applying payment %d failed: %v", payment.ID, err)
		return "failed", returnTo
	}
	if applied {
		srv.recordAudit(r, paid.WorkspaceID, store.User{ID: paid.UserID}, "billing.payment_completed", idTarget("payment", paid.ID, invoiceID),
			map[string]any{"plan": paid.Plan, "months": paid.Months, "amount": paid.Amount, "method": paid.PaymentMethod})
	}
	return "success", returnTo
}

func canManageBilling(w store.WorkspaceContext) bool {
	return w.Role == "owner" || w.Role == "admin"
}

func (srv *Server) billingWorkspace(w http.ResponseWriter, r *http.Request) (store.User, store.WorkspaceContext, bool) {
	if srv.store == nil {
		writeJSON(w, http.StatusServiceUnavailable, apiError{Error: "storage not available"})
		return store.User{}, store.WorkspaceContext{}, false
	}
	user, ok := srv.requireAuthenticatedUser(w, r)
	if !ok {
		return store.User{}, store.WorkspaceContext{}, false
	}
	_, _, activeWorkspaceID, _ := srv.currentSessionState(r)
	ctx, cancel := context.WithTimeout(r.Context(), 5*time.Second)
	defer cancel()
	workspace, err := srv.resolveActiveWorkspace(ctx, user, activeWorkspaceID)
	if err != nil {
		if errors.Is(err, store.ErrWorkspaceNotFound) {
			writeJSON(w, http.StatusNotFound, apiError{Error: err.Error()})
		} else {
			writeJSON(w, http.StatusInternalServerError, apiError{Error: err.Error()})
		}
		return store.User{}, store.WorkspaceContext{}, false
	}
	return user, workspace, true
}

// publicPlan is one plan on the public price list.
type publicPlan struct {
	plans.Plan
	// Prices are what the plan costs per period; empty for Free and Enterprise.
	Prices []priceOption `json:"prices"`
}

// handlePlans is the public price list: every plan's limits and what Pro
// costs. The landing page and the billing page both read it, so the numbers
// on the site are the ones the server enforces and charges.
func (srv *Server) handlePlans(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		writeJSON(w, http.StatusMethodNotAllowed, apiError{Error: "method not allowed"})
		return
	}
	out := make([]publicPlan, 0, len(plans.IDs))
	for _, id := range plans.IDs {
		p := publicPlan{Plan: plans.For(id), Prices: []priceOption{}}
		for _, o := range srv.priceOptions() {
			if o.Plan == id {
				p.Prices = append(p.Prices, o)
			}
		}
		out = append(out, p)
	}
	w.Header().Set("Cache-Control", "public, max-age=300")
	writeJSON(w, http.StatusOK, map[string]any{
		"currency":         "BDT",
		"payments_enabled": srv.paymentsEnabled(),
		"history_days":     int(srv.historyRetention.Hours() / 24),
		"plans":            out,
	})
}
