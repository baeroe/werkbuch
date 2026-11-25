package redact

import (
	"bytes"
	"errors"
	"log/slog"
	"strings"
	"testing"
)

// jwt is a made-up installation token in the form GitHub gives since 2026: `ghs_<app>_<JWT>`, base64url segments.
var jwt = "ghs_123456_eyJhbGciOiJSUzI1NiIsInR5cCI6IkpXVCJ9." + strings.Repeat("eyJpc3MiOiIxMjM0NTYi-_", 15) + "." + strings.Repeat("c2ln_-Q", 40)

func TestPatterns(t *testing.T) {
	cases := map[string]string{
		"runner wbr_abcdefghijklmnopqrstuvwxyz012345 ok":         "runner [token] ok",
		"01m84h89mdknggbar3ynnhd99n|wb_abcdefghijklmnopqrstuvwx": "[token]",
		"push ghs_abcdefghijklmnopqrstuvwxyz":                    "push [token]",
		"github_pat_abcdefghijklmnopqrstuvwxyz_1":                "[token]",
		"Authorization: Bearer secret-value":                     "Authorization: Bearer [token]",
		"bare wb_abcdefghijklmnopqrstuvwx":                       "bare [token]",
		"nothing here":                                           "nothing here",
		// the installation tokens of 2026 (A730), made up: whole, the dot that ends the sentence stays
		"pushed with " + jwt + ".":                         "pushed with [token].",
		"x-access-token:" + jwt + "@github.com":            "x-access-token:[token]@github.com",
		jwt + "\n" + jwt:                                   "[token]\n[token]",
		"github_pat_" + strings.Repeat("A1_b2", 12) + ".x": "[token]",
	}
	for in, want := range cases {
		if got := String(in); got != want {
			t.Errorf("String(%q) = %q, want %q", in, got, want)
		}
	}
}

func TestHeldSecrets(t *testing.T) {
	Hold("plain-secret-1234")
	Hold("plain-secret-1234")
	if got := String("x plain-secret-1234 y"); got != "x [token] y" {
		t.Fatalf("held: %q", got)
	}
	Release("plain-secret-1234")
	if got := String("plain-secret-1234"); got != Blank {
		t.Fatalf("still held once: %q", got)
	}
	Release("plain-secret-1234")
	if got := String("plain-secret-1234"); got != "plain-secret-1234" {
		t.Fatalf("released: %q", got)
	}
	Hold("short")
	if String("short") != "short" {
		t.Fatal("a short value is no secret")
	}
}

func TestHandler(t *testing.T) {
	var buf bytes.Buffer
	log := slog.New(Handler{slog.NewTextHandler(&buf, nil)}).With("token", "wbr_abcdefghijklmnopqrstuvwxyz012345")
	log.Info("claimed with wbr_abcdefghijklmnopqrstuvwxyz012345",
		"err", errors.New("Authorization: Bearer leaked"),
		slog.Group("run", "git", "ghs_abcdefghijklmnopqrstuvwxyz"),
		"n", 3)
	out := buf.String()
	for _, leak := range []string{"wbr_abc", "leaked", "ghs_abc"} {
		if strings.Contains(out, leak) {
			t.Fatalf("log shows %q: %s", leak, out)
		}
	}
	if !strings.Contains(out, "n=3") {
		t.Fatalf("lost a number: %s", out)
	}
}
