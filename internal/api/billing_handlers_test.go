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
			"payment_method": "bkash", "transaction_id": "TX-" + id, "phone": body["phone"], "full_name": body["full_name"],
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

	// No phone yet: the gateway needs one, so checkout asks for billing details.
	if rr := checkout(`{"plan":"pro","months":1}`); rr.Code != http.StatusConflict || !strings.Contains(rr.Body.String(), "billing_details_required") {
		t.Fatalf("checkout without a phone: expected 409, got %d %s", rr.Code, rr.Body.String())
	}
	if _, err := st.SaveBillingDetails(t.Context(), workspaceID, store.BillingDetails{Name: "Kestrel Labs Ltd", Phone: "01712345678", Country: "BD"}); err != nil {
		t.Fatal(err)
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
	if got := fake.invoices[inv(1)]; got["phone"] != "01712345678" || got["full_name"] != "Kestrel Labs Ltd" {
		t.Fatalf("the gateway should get the billing name and phone, got %v / %v", got["full_name"], got["phone"])
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

	// Leaving the payment page without paying (INITIATED) records nothing; a
	// gateway error marks it failed; and paying in full afterwards still
	// applies the plan, so money taken is never left without Pro.
	var started struct {
		PaymentID int64 `json:"payment_id"`
	}
	_ = json.Unmarshal(checkout(`{"plan":"pro","months":1}`).Body.Bytes(), &started)
	fake.override[inv(5)] = map[string]any{"status": "INITIATED"}
	if loc := settle(inv(5)); !strings.HasSuffix(loc, "payment=unpaid") {
		t.Fatalf("unpaid: expected unpaid, got %q", loc)
	}
	if p, err := st.GetPayment(t.Context(), started.PaymentID); err != nil || p.Status != "pending" {
		t.Fatalf("an unpaid checkout must stay pending, got %q (%v)", p.Status, err)
	}
	fake.override[inv(5)] = map[string]any{"status": "ERROR"}
	if loc := settle(inv(5)); !strings.HasSuffix(loc, "payment=failed") {
		t.Fatalf("gateway error: expected failed, got %q", loc)
	}
	delete(fake.override, inv(5))
	if loc := settle(inv(5)); !strings.HasSuffix(loc, "payment=success") {
		t.Fatalf("paid after a failure: expected success, got %q", loc)
	}
	afterLate, _ := st.WorkspacePlanExpiry(t.Context(), workspaceID)
	if !afterLate.After(expiry.AddDate(0, 0, 27)) {
		t.Fatalf("a payment completed after a failure must add its month, got %v from %v", afterLate, expiry)
	}
	expiry = afterLate

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

	// A customer pays and closes the tab, so the browser never comes back and
	// no webhook arrives: the reconciler asks the gateway and applies the plan.
	var abandoned struct {
		PaymentID int64 `json:"payment_id"`
	}
	_ = json.Unmarshal(checkout(`{"plan":"pro","months":1}`).Body.Bytes(), &abandoned)
	if p, err := st.GetPayment(t.Context(), abandoned.PaymentID); err != nil || p.InvoiceID != inv(6) {
		t.Fatalf("checkout should keep the gateway's invoice, got %q (%v)", p.InvoiceID, err)
	}
	beforeReconcile, _ := st.WorkspacePlanExpiry(t.Context(), workspaceID)
	testSrv.reconcilePayments(t.Context(), 0)
	if p, _ := st.GetPayment(t.Context(), abandoned.PaymentID); p.Status != "paid" {
		t.Fatalf("the reconciler should complete a paid checkout, status %q", p.Status)
	}
	reconciled, _ := st.WorkspacePlanExpiry(t.Context(), workspaceID)
	if !reconciled.After(beforeReconcile.AddDate(0, 0, 27)) {
		t.Fatalf("the reconciled payment should add its month, %v -> %v", beforeReconcile, reconciled)
	}
	// Running it again changes nothing.
	testSrv.reconcilePayments(t.Context(), 0)
	if again, _ := st.WorkspacePlanExpiry(t.Context(), workspaceID); !again.Equal(*reconciled) {
		t.Fatal("reconciling again must not add time")
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

func TestNormalizePhone(t *testing.T) {
	for _, c := range []struct{ in, country, want string }{
		{"01712345678", "BD", "01712345678"},
		{"+880 1712-345678", "BD", "01712345678"},
		{"8801712345678", "", "01712345678"},
		{"+44 20 7946 0958", "GB", "+442079460958"},
		{"442079460958", "GB", "+442079460958"},
	} {
		if got, err := normalizePhone(c.in, c.country); err != nil || got != c.want {
			t.Errorf("%q (%s): got %q, %v; want %q", c.in, c.country, got, err, c.want)
		}
	}
	for _, c := range []struct{ in, country string }{
		{"0171234567", "BD"},  // one digit short
		{"01212345678", "BD"}, // no operator starts with 012
		{"017123456789", "BD"},
		{"call me", "BD"},
		{"12", "GB"},
		{"", "BD"},
	} {
		if got, err := normalizePhone(c.in, c.country); err == nil {
			t.Errorf("%q (%s) should be refused, got %q", c.in, c.country, got)
		}
	}
}

// Owners save billing details, and the name, phone, and country are cleaned.
func TestBillingDetails(t *testing.T) {
	st := installTestStore(t)
	_, cookie := issueTestSession(t, st)
	call := func(method, body string) *httptest.ResponseRecorder {
		req := httptest.NewRequest(method, "/api/billing/details", strings.NewReader(body))
		req.Header.Set("Content-Type", "application/json")
		req.AddCookie(cookie)
		rr := httptest.NewRecorder()
		testSrv.handleBillingDetails(rr, req)
		return rr
	}
	if rr := call(http.MethodGet, ""); rr.Code != http.StatusOK || !strings.Contains(rr.Body.String(), `"country": "BD"`) {
		t.Fatalf("empty details: %d %s", rr.Code, rr.Body.String())
	}
	if rr := call(http.MethodPut, `{"name":"Kestrel","phone":"123","country":"BD"}`); rr.Code != http.StatusBadRequest {
		t.Fatalf("a bad phone should be refused, got %d", rr.Code)
	}
	if rr := call(http.MethodPut, `{"name":"  Kestrel   Labs ","phone":"+880 1812-345678","company":"Kestrel Labs Ltd","city":"Dhaka","country":"bd"}`); rr.Code != http.StatusOK {
		t.Fatalf("save: %d %s", rr.Code, rr.Body.String())
	}
	var got store.BillingDetails
	_ = json.Unmarshal(call(http.MethodGet, "").Body.Bytes(), &got)
	if got.Name != "Kestrel Labs" || got.Phone != "01812345678" || got.Company != "Kestrel Labs Ltd" || got.City != "Dhaka" || got.Country != "BD" {
		t.Fatalf("saved details: %+v", got)
	}
}

func TestReconcileDue(t *testing.T) {
	for _, c := range []struct {
		age  time.Duration
		tick int
		want bool
	}{
		{10 * time.Minute, 7, true}, // young: every tick
		{3 * time.Hour, 8, true},    // a few hours: every eighth tick
		{3 * time.Hour, 9, false},
		{20 * time.Hour, 30, true}, // older: every thirtieth tick
		{20 * time.Hour, 8, false},
		{40 * time.Hour, 0, true}, // the first tick after a start asks about everything
	} {
		if got := reconcileDue(c.age, c.tick); got != c.want {
			t.Errorf("age %v tick %d: got %v, want %v", c.age, c.tick, got, c.want)
		}
	}
}
