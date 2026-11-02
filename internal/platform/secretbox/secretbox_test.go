package secretbox

import (
	"encoding/base64"
	"strings"
	"testing"
)

func TestSealAndOpen(t *testing.T) {
	key := base64.StdEncoding.EncodeToString([]byte("0123456789abcdef0123456789abcdef"))
	box, err := New(key)
	if err != nil {
		t.Fatalf("New: %v", err)
	}
	sealed, err := box.Seal("JBSWY3DPEHPK3PXP")
	if err != nil || !strings.HasPrefix(sealed, "v1:") || strings.Contains(sealed, "JBSWY3DP") {
		t.Fatalf("Seal = %q, %v", sealed, err)
	}
	opened, err := box.Open(sealed)
	if err != nil || opened != "JBSWY3DPEHPK3PXP" {
		t.Fatalf("Open = %q, %v", opened, err)
	}

	other, _ := New(base64.StdEncoding.EncodeToString([]byte("ffffffffffffffffffffffffffffffff")))
	if _, err := other.Open(sealed); err == nil {
		t.Fatal("expected a different key to fail")
	}
	if _, err := New("short"); err == nil {
		t.Fatal("expected a bad key to be rejected")
	}

	plain, _ := New("")
	value, _ := plain.Seal("secret")
	if value != "plain:secret" {
		t.Fatalf("keyless Seal = %q", value)
	}
	if _, err := plain.Open(sealed); err == nil {
		t.Fatal("expected a keyless box to refuse sealed values")
	}
}
