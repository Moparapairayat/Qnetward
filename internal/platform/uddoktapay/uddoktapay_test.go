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
