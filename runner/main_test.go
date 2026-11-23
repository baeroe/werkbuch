package main

import (
	"bytes"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/baeroe/werkbuch/runner/internal/config"
	"github.com/baeroe/werkbuch/runner/internal/executor"
	"github.com/baeroe/werkbuch/runner/internal/fakewerkbuch"
	"github.com/baeroe/werkbuch/runner/internal/keyring"
	"github.com/baeroe/werkbuch/runner/internal/protocol"
	"github.com/baeroe/werkbuch/runner/internal/socket"
)

func home(t *testing.T) {
	dir := t.TempDir()
	t.Setenv("WERKBUCH_RUNNER_CONFIG_DIR", filepath.Join(dir, "config"))
	t.Setenv("WERKBUCH_RUNNER_STATE_DIR", filepath.Join(dir, "state"))
	t.Setenv("WERKBUCH_RUNNER_DATA_DIR", filepath.Join(dir, "data"))
	t.Setenv("WERKBUCH_RUNNER_SOCKET", filepath.Join(dir, "r.sock"))
	keyring.Mock()
}

func cmd(args ...string) (int, string, string) {
	var out, errb bytes.Buffer
	code := run(args, &out, &errb)
	return code, out.String(), errb.String()
}

func TestLoginLogout(t *testing.T) {
	home(t)
	fake := fakewerkbuch.New()
	defer fake.Close()

	if code, _, errs := cmd("login", fake.URL, "--code", "WRONG-CODE"); code != 1 || !strings.Contains(errs, "refused") {
		t.Fatalf("%d %s", code, errs)
	}
	code, out, errs := cmd("login", fake.URL+"/", "--code", fakewerkbuch.Code, "--name", "mac-mini")
	if code != 0 || !strings.Contains(out, `Paired as "mac-mini"`) || strings.Contains(out, "wbr_") {
		t.Fatalf("%d %s %s", code, out, errs)
	}
	if tok, _ := keyring.Get(fake.URL); tok != fakewerkbuch.Token {
		t.Fatal("token not in the keychain")
	}
	if cfg, err := config.Load(filepath.Join(os.Getenv("WERKBUCH_RUNNER_CONFIG_DIR"), "config.yaml")); err != nil || cfg.Instance != fake.URL {
		t.Fatalf("config %+v %v", cfg, err)
	}
	if p := fake.Paired[len(fake.Paired)-1]; p.Name != "mac-mini" || p.OS == "" || p.Version != "dev" {
		t.Fatalf("%+v", p)
	}
	if code, out, _ := cmd("logout"); code != 0 || !strings.Contains(out, "Forgot") {
		t.Fatal(out)
	}
	if _, err := keyring.Get(fake.URL); err == nil {
		t.Fatal("token stays")
	}
	if code, _, errs := cmd("login", "--code", "X"); code != 1 || !strings.Contains(errs, "usage") {
		t.Fatal(errs)
	}
}

func TestSimpleCommands(t *testing.T) {
	home(t)
	if code, out, _ := cmd("version"); code != 0 || out != "dev\n" {
		t.Fatal(out)
	}
	if code, out, _ := cmd(); code != 0 || !strings.Contains(out, "TUI") {
		t.Fatal(out)
	}
	if code, _, _ := cmd("nope"); code != 2 {
		t.Fatal(code)
	}
	if code, _, errs := cmd("status"); code != 1 || !strings.Contains(errs, "no daemon") {
		t.Fatal(errs)
	}
	if code, _, errs := cmd("update"); code != 1 || !strings.Contains(errs, "no daemon") {
		t.Fatal(errs)
	}
	if code, _, errs := cmd("daemon"); code != 1 || !strings.Contains(errs, "pair") {
		t.Fatal(errs)
	}
	if code, out, _ := cmd("doctor"); code != 1 || !strings.Contains(out, "FAIL  config") {
		t.Fatal(out)
	}
}

func TestFormat(t *testing.T) {
	gpu, v := 12.0, "2.1.330"
	st := socket.Status{Instance: "https://werkbuch.example.com", Version: "0.3.2", ExpectedVersion: "0.4.0", Update: "pending", Connected: true,
		Places: &protocol.Places{Total: 2, PerRepo: 1, Light: 2}, Load: &protocol.Load{CPU: 30, GPU: &gpu, RAMUsed: 12, RAMTotal: 32, DiskFree: 400, DiskTotal: 1000},
		CLIs:      []protocol.CLI{{CLI: "claude", Installed: true, Version: &v, LoggedIn: true}, {CLI: "codex"}},
		Equipment: &protocol.Equipment{MCPServers: []string{"playwright"}, WerkbuchAccess: []string{"skilltri"}}}
	now := time.Now()
	out := Format(st, []executor.Summary{{ID: "01r", Type: "task", Item: "WEB-1", Status: "running", Started: now.Add(-time.Minute), Lines: 4}}, now)
	for _, want := range []string{"(connected)", "expects 0.4.0", "update pending", "0/2 in all", "GPU 12 %", "claude  installed 2.1.330, signed in", "codex   not installed", "skilltri reaches", "WEB-1", "1m0s"} {
		if !strings.Contains(out, want) {
			t.Errorf("lacks %q:\n%s", want, out)
		}
	}
}
