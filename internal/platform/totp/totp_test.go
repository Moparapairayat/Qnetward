package totp

import (
	"encoding/base32"
	"strings"
	"testing"
	"time"
)

// RFC 6238 appendix B test vectors for SHA-1, truncated to six digits.
func TestCodeMatchesRFC6238(t *testing.T) {
	secret := base32.StdEncoding.WithPadding(base32.NoPadding).EncodeToString([]byte("12345678901234567890"))
	cases := map[int64]string{
		59:          "287082",
		1111111109:  "081804",
		1111111111:  "050471",
		1234567890:  "005924",
		2000000000:  "279037",
		20000000000: "353130",
	}
	for unix, want := range cases {
		got, err := Code(secret, Step(time.Unix(unix, 0)))
		if err != nil || got != want {
			t.Errorf("Code at %d = %q, %v; want %q", unix, got, err, want)
		}
	}
}

func TestValidateAcceptsDriftAndRejectsOthers(t *testing.T) {
	secret, err := NewSecret()
	if err != nil {
		t.Fatalf("NewSecret: %v", err)
	}
	now := time.Now()
	prev, _ := Code(secret, Step(now)-1)
	if step, ok := Validate(secret, prev, now); !ok || step != Step(now)-1 {
		t.Fatalf("expected the previous step's code to pass, got %d %v", step, ok)
	}
	old, _ := Code(secret, Step(now)-3)
	if _, ok := Validate(secret, old, now); ok {
		t.Fatal("expected a code three steps old to fail")
	}
	if _, ok := Validate(secret, "12345", now); ok {
		t.Fatal("expected a short code to fail")
	}
	uri := URI("Qnetward", "a@example.com", secret)
	if !strings.HasPrefix(uri, "otpauth://totp/Qnetward:a@example.com?") || !strings.Contains(uri, "secret="+secret) {
		t.Fatalf("unexpected URI %q", uri)
	}
}
