package clis

import (
	"context"
	"errors"
	"os"
	"path/filepath"
	"testing"
)

func TestVersion(t *testing.T) {
	for in, want := range map[string]string{
		"2.1.330 (Claude Code)\n": "2.1.330",
		"codex-cli 0.58.0":        "0.58.0",
		"weird":                   "weird",
	} {
		if got := Version(in); got != want {
			t.Errorf("%q: %q", in, got)
		}
	}
}

func TestDetect(t *testing.T) {
	dir := t.TempDir()
	for _, n := range []string{"claude", "codex"} {
		os.WriteFile(filepath.Join(dir, n), []byte("#!/bin/sh\n"), 0o755)
	}
	t.Setenv("PATH", dir)
	calls := 0
	run := func(ctx context.Context, name string, args ...string) ([]byte, error) {
		calls++
		switch {
		case filepath.Base(name) == "claude" && args[0] == "--version":
			return []byte("2.1.330 (Claude Code)"), nil
		case filepath.Base(name) == "claude":
			return []byte(`{"loggedIn": true, "email": "x@example.com"}`), nil
		case args[0] == "--version":
			return []byte("codex-cli 0.58.0"), nil
		}
		return nil, errors.New("exit status 1")
	}
	d := &Detector{Run: run}
	got := d.All(context.Background(), false)
	if len(got) != 2 || !got[0].Installed || !got[0].LoggedIn || *got[0].Version != "2.1.330" || *got[0].Path != filepath.Join(dir, "claude") {
		t.Fatalf("claude %+v", got[0])
	}
	if !got[1].Installed || got[1].LoggedIn || *got[1].Version != "0.58.0" {
		t.Fatalf("codex %+v", got[1])
	}
	n := calls
	d.All(context.Background(), false)
	if calls != n {
		t.Fatal("not cached")
	}
	d.All(context.Background(), true)
	if calls == n {
		t.Fatal("fresh not asked")
	}

	t.Setenv("PATH", t.TempDir())
	if c := Detect(context.Background(), "claude", run); c.Installed || c.Path != nil || c.LoggedIn {
		t.Fatalf("missing %+v", c)
	}
}
