package redact

import (
	"bytes"
	"errors"
	"log/slog"
	"strings"
	"testing"
)

func TestPatterns(t *testing.T) {
	cases := map[string]string{
		"runner wbr_abcdefghijklmnopqrstuvwxyz012345 ok":         "runner [token] ok",
		"01m84h89mdknggbar3ynnhd99n|wb_abcdefghijklmnopqrstuvwx": "[token]",
		"push ghs_abcdefghijklmnopqrstuvwxyz":                    "push [token]",
		"github_pat_abcdefghijklmnopqrstuvwxyz_1":                "[token]",
		"Authorization: Bearer secret-value":                     "Authorization: Bearer [token]",
		"nothing here":                                           "nothing here",
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
