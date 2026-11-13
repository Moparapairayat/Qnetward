// Package uddoktapay talks to an UddoktaPay installation, a Bangladeshi
// gateway for bKash, Nagad, Rocket, Upay, and bank payments. It creates a
// checkout and verifies the result; it supports one-time payments only.
package uddoktapay

import (
	"bytes"
	"context"
	"crypto/subtle"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"path"
	"strconv"
	"strings"
	"time"
)

// SandboxURL is UddoktaPay's public test installation.
const SandboxURL = "https://sandbox.uddoktapay.com"

// Client calls one installation with its API key.
type Client struct {
	BaseURL string
	APIKey  string
	HTTP    *http.Client
}

// Charge is a checkout to create.
type Charge struct {
	FullName string
	Email    string
	// Phone is not in UddoktaPay's documented API, but panels that keep
	// customers (where it is required) read it; others ignore it.
	Phone       string
	Amount      float64
	Metadata    map[string]string
	RedirectURL string
	CancelURL   string
	WebhookURL  string
}

// Payment is what verify-payment reports.
type Payment struct {
	InvoiceID     string         `json:"invoice_id"`
	Status        string         `json:"status"`
	Amount        string         `json:"amount"`
	ChargedAmount string         `json:"charged_amount"`
	Metadata      map[string]any `json:"metadata"`
	PaymentMethod string         `json:"payment_method"`
	TransactionID string         `json:"transaction_id"`
	SenderNumber  string         `json:"sender_number"`
	Date          string         `json:"date"`
	Message       string         `json:"message"`
}

// Completed reports whether the payment went through.
func (p Payment) Completed() bool { return strings.EqualFold(p.Status, "COMPLETED") }

// Pending reports whether the payment is still waiting, as with a manual bank transfer.
func (p Payment) Pending() bool { return strings.EqualFold(p.Status, "PENDING") }

// Failed reports whether the gateway says the payment definitely didn't go
// through. Other unpaid states, such as INITIATED, may still be paid.
func (p Payment) Failed() bool {
	switch strings.ToUpper(strings.TrimSpace(p.Status)) {
	case "ERROR", "FAILED", "CANCELLED", "CANCELED", "EXPIRED":
		return true
	}
	return false
}

// AmountValue is the amount as a number.
func (p Payment) AmountValue() float64 {
	v, _ := strconv.ParseFloat(strings.TrimSpace(p.Amount), 64)
	return v
}

// Meta reads a metadata value as a string; the gateway may echo numbers.
func (p Payment) Meta(key string) string {
	switch v := p.Metadata[key].(type) {
	case string:
		return v
	case float64:
		return strconv.FormatFloat(v, 'f', -1, 64)
	default:
		return ""
	}
}

// Configured reports whether the client has what it needs.
func (c *Client) Configured() bool {
	return c != nil && strings.TrimSpace(c.BaseURL) != "" && strings.TrimSpace(c.APIKey) != ""
}

// CreateCharge starts a checkout and returns the page to send the customer to.
func (c *Client) CreateCharge(ctx context.Context, ch Charge) (string, error) {
	body := map[string]any{
		"full_name":    ch.FullName,
		"email":        ch.Email,
		"amount":       strconv.FormatFloat(ch.Amount, 'f', 2, 64),
		"metadata":     ch.Metadata,
		"redirect_url": ch.RedirectURL,
		"return_type":  "GET",
		"cancel_url":   ch.CancelURL,
	}
	if ch.WebhookURL != "" {
		body["webhook_url"] = ch.WebhookURL
	}
	if ch.Phone != "" {
		body["phone"] = ch.Phone
	}
	var resp struct {
		Status     bool   `json:"status"`
		Message    string `json:"message"`
		PaymentURL string `json:"payment_url"`
	}
	if err := c.post(ctx, "/api/checkout-v2", body, &resp); err != nil {
		return "", err
	}
	if !resp.Status || resp.PaymentURL == "" {
		return "", fmt.Errorf("the payment gateway refused the checkout: %s", strings.TrimSpace(resp.Message))
	}
	return resp.PaymentURL, nil
}

// Verify asks the gateway how a payment ended. Never trust a redirect or a
// webhook body on its own: this is the only answer to act on.
func (c *Client) Verify(ctx context.Context, invoiceID string) (Payment, error) {
	var p Payment
	if err := c.post(ctx, "/api/verify-payment", map[string]string{"invoice_id": invoiceID}, &p); err != nil {
		return Payment{}, err
	}
	if strings.EqualFold(p.Status, "ERROR") {
		return p, fmt.Errorf("the payment gateway couldn't find that payment: %s", strings.TrimSpace(p.Message))
	}
	return p, nil
}

// ValidKey reports whether a webhook's RT-UDDOKTAPAY-API-KEY header matches.
func (c *Client) ValidKey(header string) bool {
	return c.Configured() && subtle.ConstantTimeCompare([]byte(strings.TrimSpace(header)), []byte(c.APIKey)) == 1
}

// endpoint joins the installation URL and an API path. Panels show their
// "Base URL" with /api on the end (https://pay.example.com/api), while the
// paths here start with /api, so either form of the URL works.
func (c *Client) endpoint(path string) string {
	base := strings.TrimRight(strings.TrimSpace(c.BaseURL), "/")
	base = strings.TrimSuffix(base, "/api")
	return base + path
}

func (c *Client) post(ctx context.Context, path string, body, out any) error {
	raw, err := json.Marshal(body)
	if err != nil {
		return err
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, c.endpoint(path), bytes.NewReader(raw))
	if err != nil {
		return err
	}
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Accept", "application/json")
	req.Header.Set("RT-UDDOKTAPAY-API-KEY", c.APIKey)
	client := c.HTTP
	if client == nil {
		client = &http.Client{Timeout: 20 * time.Second}
	}
	resp, err := client.Do(req)
	if err != nil {
		return errors.New("couldn't reach the payment gateway")
	}
	defer resp.Body.Close()
	data, err := io.ReadAll(io.LimitReader(resp.Body, 64<<10))
	if err != nil {
		return errors.New("couldn't read the payment gateway's answer")
	}
	if resp.StatusCode >= 500 {
		return fmt.Errorf("the payment gateway answered %d", resp.StatusCode)
	}
	if err := json.Unmarshal(data, out); err != nil {
		if resp.StatusCode == http.StatusUnauthorized || resp.StatusCode == http.StatusForbidden {
			return fmt.Errorf("the payment gateway refused the request (%d); check the UddoktaPay URL and API key", resp.StatusCode)
		}
		return fmt.Errorf("the payment gateway answered %d with something unexpected", resp.StatusCode)
	}
	return nil
}

// InvoiceFromURL reads the invoice ID from a checkout's payment page, such as
// https://pay.example.com/checkout/Erm9wzjM0FBwjSYT0QVb (or /payment/...).
// It returns "" when the URL doesn't end in something that looks like one.
func InvoiceFromURL(paymentURL string) string {
	u, err := url.Parse(strings.TrimSpace(paymentURL))
	if err != nil {
		return ""
	}
	id := path.Base(strings.TrimRight(u.Path, "/"))
	if len(id) < 8 || len(id) > 128 {
		return ""
	}
	for _, c := range id {
		if !(c >= 'a' && c <= 'z' || c >= 'A' && c <= 'Z' || c >= '0' && c <= '9' || c == '-' || c == '_') {
			return ""
		}
	}
	return id
}
