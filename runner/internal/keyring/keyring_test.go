package keyring

import (
	"errors"
	"testing"
)

func TestRoundTrip(t *testing.T) {
	Mock()
	if _, err := Get("https://a.example.com"); !errors.Is(err, ErrNotFound) {
		t.Fatalf("missing: %v", err)
	}
	if err := Set("https://a.example.com", "wbr_x"); err != nil {
		t.Fatal(err)
	}
	if v, err := Get("https://a.example.com"); err != nil || v != "wbr_x" {
		t.Fatalf("%q %v", v, err)
	}
	if err := Delete("https://a.example.com"); err != nil {
		t.Fatal(err)
	}
	if err := Delete("https://a.example.com"); err != nil {
		t.Fatalf("delete missing: %v", err)
	}
}
