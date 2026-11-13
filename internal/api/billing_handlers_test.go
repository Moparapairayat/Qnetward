package api

import (
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"testing"
	"time"

	"qnetward/internal/platform/uddoktapay"
	"qnetward/internal/store"
)

// fakeGateway stands in for an UddoktaPay installation: it remembers each
// checkout and reports it back from verify-payment, as paid unless told otherwise.
type fakeGateway struct {
	mu sync.Mutex
	// prefix keeps invoice IDs unique across runs on the shared test database.
	prefix   string
	invoices map[string]map[string]any
	// override lets a test change what verify-payment says for an invoice.
	override map[string]map[string]any
}

func (f *fakeGateway) server(t *testing.T, key string) *httptest.Server {
	t.Helper()
	mux := http.NewServeMux()
	mux.HandleFunc("/api/checkout-v2", func(w http.ResponseWriter, r *http.Request) {
		if r.Header.Get("RT-UDDOKTAPAY-API-KEY") != key {
			_ = json.NewEncoder(w).Encode(map[string]any{"status": false, "message": "Unauthorized"})
			return
		}
		var body map[string]any
		_ = json.NewDecoder(r.Body).Decode(&body)
		f.mu.Lock()
		id := fmt.Sprintf("%s%d", f.prefix, len(f.invoices)+1)
		f.invoices[id] = map[string]any{
			"invoice_id": id, "status": "COMPLETED", "amount": body["amount"], "metadata": body["metadata"],
			"payment_method": "bkash", "transaction_id": "TX-" + id,
		}
		f.mu.Unlock()
		_ = json.NewEncoder(w).Encode(map[string]any{"status": true, "message": "Payment Url", "payment_url": "https://gateway.test/payment/" + id})
	})
	mux.HandleFunc("/api/verify-payment", func(w http.ResponseWriter, r *http.Request) {
		var body struct {
			InvoiceID string `json:"invoice_id"`
		}
		_ = json.NewDecoder(r.Body).Decode(&body)
		f.mu.Lock()
		defer f.mu.Unlock()
		record, ok := f.invoices[body.InvoiceID]
		if !ok || r.Header.Get("RT-UDDOKTAPAY-API-KEY") != key {
			_ = json.NewEncoder(w).Encode(map[string]any{"status": "ERROR", "message": "Invalid invoice"})
			return
		}
		out := map[string]any{}
		for k, v := range record {
			out[k] = v
		}
		for k, v := range f.override[body.InvoiceID] {
			out[k] = v
		}
		_ = json.NewEncoder(w).Encode(out)
	})
	srv := httptest.NewServer(mux)
	t.Cleanup(srv.Close)
	return srv
}

func TestUddoktaPayCheckoutAndSettlement(t *testing.T) {
	st := installTestStore(t)
	user, cookie := issueTestSession(t, st)
	workspaceID := testWorkspaceID(t, st, user.ID)

	fake := &fakeGateway{prefix: fmt.Sprintf("INV-%d-", time.Now().UnixNano()), invoices: map[string]map[string]any{}, override: map[string]map[string]any{}}
	inv := func(n int) string { return fmt.Sprintf("%s%d", fake.prefix, n) }
	gateway := fake.server(t, "test-key")
	previousPayments, previousBilling := testSrv.payments, testSrv.billing
	testSrv.payments = &uddoktapay.Client{BaseURL: gateway.URL, APIKey: "test-key"}
	testSrv.billing = Billing{ProMonthlyBDT: 1500, ProYearlyBDT: 15000}
	t.Cleanup(func() { testSrv.payments, testSrv.billing = previousPayments, previousBilling })

	checkout := func(body string) *httptest.ResponseRecorder {
		req := httptest.NewRequest(http.MethodPost, "/api/billing/checkout", strings.NewReader(body))
		req.Header.Set("Content-Type", "application/json")
		req.AddCookie(cookie)
		rr := httptest.NewRecorder()
		testSrv.handleBillingCheckout(rr, req)
		return rr
	}
	settle := func(invoice string) string {
		rr := httptest.NewRecorder()
		testSrv.handleUddoktaPayReturn(rr, httptest.NewRequest(http.MethodGet, "/api/billing/uddoktapay/return?invoice_id="+invoice, nil))
		if rr.Code != http.StatusSeeOther {
			t.Fatalf("return: expected 303, got %d", rr.Code)
		}
		return rr.Header().Get("Location")
	}
	plan := func() string {
		ws, err := st.GetWorkspaceContextByWorkspaceIDAndUserID(t.Context(), workspaceID, user.ID)
		if err != nil {
			t.Fatalf("workspace: %v", err)
		}
		return ws.Plan
	}

	if rr := checkout(`{"plan":"pro","months":3}`); rr.Code != http.StatusBadRequest {
		t.Fatalf("unknown period: expected 400, got %d", rr.Code)
	}
	rr := checkout(`{"plan":"pro","months":1}`)
	if rr.Code != http.StatusOK || !strings.Contains(rr.Body.String(), "https://gateway.test/payment/"+inv(1)) {
		t.Fatalf("checkout: got %d: %s", rr.Code, rr.Body.String())
	}
	if gateway := fake.invoices[inv(1)]["metadata"].(map[string]any); gateway["return_to"] == "" {
		t.Fatal("the checkout should record where to send the browser back to")
	}
	if loc := settle(inv(1)); !strings.HasSuffix(loc, "payment=success") || plan() != "pro" {
		t.Fatalf("expected Pro after paying, redirected to %q with plan %q", loc, plan())
	}
	expiry, _ := st.WorkspacePlanExpiry(t.Context(), workspaceID)
	if loc := settle(inv(1)); !strings.HasSuffix(loc, "payment=success") {
		t.Fatalf("a repeat return should still say success, got %q", loc)
	}
	if again, _ := st.WorkspacePlanExpiry(t.Context(), workspaceID); !again.Equal(*expiry) {
		t.Fatal("a repeat return must not add time")
	}

	// Paying less than the price, or for another workspace, changes nothing.
	checkout(`{"plan":"pro","months":12}`)
	fake.override[inv(2)] = map[string]any{"amount": "1.00"}
	if loc := settle(inv(2)); !strings.HasSuffix(loc, "payment=failed") {
		t.Fatalf("underpaid: expected failed, got %q", loc)
	}
	checkout(`{"plan":"pro","months":12}`)
	// Same payment, but the gateway claims it was for a different workspace.
	original := fake.invoices[inv(3)]["metadata"].(map[string]any)
	fake.override[inv(3)] = map[string]any{"metadata": map[string]any{"payment_id": original["payment_id"], "workspace_id": "999999"}}
	if loc := settle(inv(3)); !strings.HasSuffix(loc, "payment=failed") {
		t.Fatalf("other workspace: expected failed, got %q", loc)
	}
	checkout(`{"plan":"pro","months":12}`)
	fake.override[inv(4)] = map[string]any{"status": "PENDING"}
	if loc := settle(inv(4)); !strings.HasSuffix(loc, "payment=pending") {
		t.Fatalf("pending: expected pending, got %q", loc)
	}
	if still, _ := st.WorkspacePlanExpiry(t.Context(), workspaceID); !still.Equal(*expiry) {
		t.Fatal("failed and pending payments must not add time")
	}

	// The webhook needs the API key, then settles like the return does.
	hook := func(key string) *httptest.ResponseRecorder {
		req := httptest.NewRequest(http.MethodPost, "/api/billing/uddoktapay/webhook", strings.NewReader(`{"invoice_id":"`+inv(4)+`"}`))
		req.Header.Set("RT-UDDOKTAPAY-API-KEY", key)
		rr := httptest.NewRecorder()
		testSrv.handleUddoktaPayWebhook(rr, req)
		return rr
	}
	if rr := hook("wrong"); rr.Code != http.StatusUnauthorized {
		t.Fatalf("webhook with a wrong key: expected 401, got %d", rr.Code)
	}
	delete(fake.override, inv(4))
	if rr := hook("test-key"); rr.Code != http.StatusOK || !strings.Contains(rr.Body.String(), "success") {
		t.Fatalf("webhook: got %d: %s", rr.Code, rr.Body.String())
	}
	if later, _ := st.WorkspacePlanExpiry(t.Context(), workspaceID); !later.After(expiry.AddDate(0, 11, 0)) {
		t.Fatalf("expected twelve more months after the webhook, got %v", later)
	}

	req := httptest.NewRequest(http.MethodGet, "/api/billing", nil)
	req.AddCookie(cookie)
	get := httptest.NewRecorder()
	testSrv.handleBilling(get, req)
	var billing struct {
		Plan     string          `json:"plan"`
		Enabled  bool            `json:"payments_enabled"`
		Payments []store.Payment `json:"payments"`
	}
	_ = json.Unmarshal(get.Body.Bytes(), &billing)
	if billing.Plan != "pro" || !billing.Enabled || len(billing.Payments) < 2 {
		t.Fatalf("unexpected billing summary %s", get.Body.String())
	}
}

// The public price list is what the site shows: each plan's enforced limits,
// and Pro's prices exactly as checkout charges them.
func TestPublicPlans(t *testing.T) {
	previousBilling, previousRetention := testSrv.billing, testSrv.historyRetention
	testSrv.billing = Billing{ProMonthlyBDT: 1500, ProYearlyBDT: 15000}
	testSrv.historyRetention = 7 * 24 * time.Hour
	t.Cleanup(func() { testSrv.billing, testSrv.historyRetention = previousBilling, previousRetention })

	rr := httptest.NewRecorder()
	testSrv.handlePlans(rr, httptest.NewRequest(http.MethodGet, "/api/plans", nil))
	if rr.Code != http.StatusOK {
		t.Fatalf("plans: %d %s", rr.Code, rr.Body.String())
	}
	var resp struct {
		Currency    string `json:"currency"`
		HistoryDays int    `json:"history_days"`
		Plans       []struct {
			ID     string `json:"id"`
			Limits struct {
				Monitors int `json:"monitors"`
			} `json:"limits"`
			Prices []priceOption `json:"prices"`
		} `json:"plans"`
	}
	if err := json.Unmarshal(rr.Body.Bytes(), &resp); err != nil {
		t.Fatal(err)
	}
	if resp.Currency != "BDT" || resp.HistoryDays != 7 || len(resp.Plans) != 3 {
		t.Fatalf("unexpected list: %s", rr.Body.String())
	}
	free, pro, enterprise := resp.Plans[0], resp.Plans[1], resp.Plans[2]
	if free.ID != "free" || pro.ID != "pro" || enterprise.ID != "enterprise" {
		t.Fatalf("plans out of upgrade order: %s", rr.Body.String())
	}
	if free.Limits.Monitors != 20 || pro.Limits.Monitors != 200 {
		t.Fatalf("limits don't match the catalog: %s", rr.Body.String())
	}
	if len(free.Prices) != 0 || len(enterprise.Prices) != 0 {
		t.Fatalf("only Pro has a price: %s", rr.Body.String())
	}
	if len(pro.Prices) != 2 || pro.Prices[0] != (priceOption{Plan: "pro", Months: 1, Amount: 1500}) || pro.Prices[1] != (priceOption{Plan: "pro", Months: 12, Amount: 15000}) {
		t.Fatalf("Pro prices: %+v", pro.Prices)
	}
	if rr.Header().Get("Cache-Control") == "" {
		t.Fatal("the list should be cacheable")
	}
}
