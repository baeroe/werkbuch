package doctor

import (
	"context"
	"errors"
	"net/http"
	"path/filepath"
	"strings"
	"testing"

	"github.com/baeroe/werkbuch/runner/internal/config"
	"github.com/baeroe/werkbuch/runner/internal/fakewerkbuch"
	"github.com/baeroe/werkbuch/runner/internal/keyring"
)

func find(checks []Check, name string) Check {
	for _, c := range checks {
		if c.Name == name {
			return c
		}
	}
	return Check{}
}

func TestChecks(t *testing.T) {
	keyring.Mock()
	fake := fakewerkbuch.New()
	defer fake.Close()
	up := http.NewServeMux()
	up.HandleFunc("/up", func(w http.ResponseWriter, r *http.Request) {})
	up.Handle("/", fake.Config.Handler)
	fake.Config.Handler = up

	dir := t.TempDir()
	env := Env{ConfigFile: filepath.Join(dir, "config.yaml"), DataDir: filepath.Join(dir, "data"), Socket: filepath.Join(dir, "none.sock"), Version: "1.0.0", ClaudeDir: dir,
		Run: func(ctx context.Context, name string, args ...string) ([]byte, error) {
			switch {
			case name == "git":
				return []byte("git version 2.50.0\n"), nil
			case name == "claude" && args[0] == "mcp":
				return []byte("werkbuch: " + fake.URL + "/mcp (HTTP) - ✔ Connected\n"), nil
			}
			return nil, errors.New("nope")
		}}

	if checks := Checks(context.Background(), env); !Failed(checks) || find(checks, "config").Level != Fail {
		t.Fatalf("no config: %+v", checks)
	}
	config.Save(env.ConfigFile, config.Config{Instance: fake.URL})
	checks := Checks(context.Background(), env)
	if find(checks, "keychain").Level != Fail {
		t.Fatalf("no token: %+v", checks)
	}
	keyring.Set(fake.URL, fakewerkbuch.Token)
	checks = Checks(context.Background(), env)
	for name, level := range map[string]string{"config": OK, "keychain": OK, "instance": OK, "token": OK, "git": OK, "data": OK, "daemon": Warn, "agents": Fail, "werkbuch access": Warn} {
		if c := find(checks, name); c.Level != level {
			t.Errorf("%s: %+v", name, c)
		}
	}
	if !strings.Contains(find(checks, "werkbuch access").Detail, "werkbuch reaches") && !strings.Contains(find(checks, "werkbuch access").Detail, "MCP server werkbuch") {
		t.Errorf("%+v", find(checks, "werkbuch access"))
	}
	keyring.Set(fake.URL, "wbr_revokedrevokedrevokedrevoked")
	if c := find(Checks(context.Background(), env), "token"); c.Level != Fail || !strings.Contains(c.Detail, "revoked") || strings.Contains(c.Detail, "wbr_") {
		t.Fatalf("%+v", c)
	}
}
