package uddoktapay

import "testing"

// The installation URL works with or without the /api that panels show on
// their Base URL, and with stray slashes or spaces.
func TestEndpoint(t *testing.T) {
	for _, base := range []string{
		"https://qnetward.paymently.io",
		"https://qnetward.paymently.io/",
		"https://qnetward.paymently.io/api",
		"https://qnetward.paymently.io/api/",
		" https://qnetward.paymently.io/api ",
	} {
		c := &Client{BaseURL: base}
		if got := c.endpoint("/api/checkout-v2"); got != "https://qnetward.paymently.io/api/checkout-v2" {
			t.Errorf("%q: got %q", base, got)
		}
	}
}

func TestInvoiceFromURL(t *testing.T) {
	for in, want := range map[string]string{
		"https://qnetward.paymently.io/checkout/5zJW5cVHzS0Fg4lBo0TKAaKkBvbdrWqOB52XKCgn":  "5zJW5cVHzS0Fg4lBo0TKAaKkBvbdrWqOB52XKCgn",
		"https://sandbox.uddoktapay.com/payment/254663aa2a6a4a5df2aa8dc9f28aa1744a8bae9f/": "254663aa2a6a4a5df2aa8dc9f28aa1744a8bae9f",
		"https://pay.example.com/checkout/short":                                           "",
		"https://pay.example.com/checkout/has%20space1234":                                 "",
		"not a url at all": "",
		"":                 "",
	} {
		if got := InvoiceFromURL(in); got != want {
			t.Errorf("%q: got %q, want %q", in, got, want)
		}
	}
}
