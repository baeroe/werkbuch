// Package doctor checks what a runner needs (spec 8.5, 8.7, 8.8): config, token in the keychain, the instance and the
// token, git, the CLIs (installed, version, signed in), the data folder, the daemon, and the equipment of the machine
// with a warning for another way to werkbuch (an MCP server reaching the instance past the run token).
package doctor

import (
	"context"
	"fmt"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"time"

	"github.com/baeroe/werkbuch/runner/internal/client"
	"github.com/baeroe/werkbuch/runner/internal/clis"
	"github.com/baeroe/werkbuch/runner/internal/config"
	"github.com/baeroe/werkbuch/runner/internal/equipment"
	"github.com/baeroe/werkbuch/runner/internal/keyring"
	"github.com/baeroe/werkbuch/runner/internal/load"
	"github.com/baeroe/werkbuch/runner/internal/socket"
	"github.com/baeroe/werkbuch/runner/internal/sysexec"
)

// Level of a finding.
const (
	OK   = "ok"
	Warn = "warn"
	Fail = "fail"
)

// Check is one finding.
type Check struct {
	Name   string
	Level  string
	Detail string
}

// Env is what doctor reads.
type Env struct {
	ConfigFile string
	DataDir    string
	Socket     string
	Version    string
	Run        sysexec.Func
	ClaudeDir  string
}

// Checks runs every check.
func Checks(ctx context.Context, env Env) []Check {
	var out []Check
	add := func(name, level, detail string) { out = append(out, Check{name, level, detail}) }

	cfg, err := config.Load(env.ConfigFile)
	if err != nil {
		add("config", Fail, err.Error())
		return out
	}
	add("config", OK, env.ConfigFile+": "+cfg.Instance)

	token, err := keyring.Get(cfg.Instance)
	switch {
	case err != nil:
		add("keychain", Fail, err.Error())
	default:
		add("keychain", OK, "runner token for "+cfg.Instance+" ("+keyring.Service+")")
	}

	up, err := reach(ctx, cfg.Instance)
	if err != nil {
		add("instance", Fail, err.Error())
	} else {
		add("instance", OK, up)
		if token != "" {
			if err := client.New(cfg.Instance, token, env.Version).Probe(ctx); err != nil {
				if client.Unauthorized(err) {
					add("token", Fail, "werkbuch refuses the runner token: the runner was revoked, pair it again")
				} else {
					add("token", Fail, err.Error())
				}
			} else {
				add("token", OK, "werkbuch accepts the runner token")
			}
		}
	}

	if out, err := env.Run(ctx, "git", "--version"); err != nil {
		add("git", Fail, "git is not installed")
	} else {
		add("git", OK, strings.TrimSpace(string(out)))
	}

	ready := 0
	for _, c := range (&clis.Detector{Run: env.Run}).All(ctx, true) {
		switch {
		case !c.Installed:
			add(c.CLI, Warn, "not installed (runs of agents with "+c.CLI+" wait for another runner)")
		case !c.LoggedIn:
			add(c.CLI, Warn, fmt.Sprintf("%s %s is not signed in: run `%s` once and sign in", *c.Path, deref(c.Version), signIn(c.CLI)))
		default:
			ready++
			add(c.CLI, OK, fmt.Sprintf("%s %s, signed in", *c.Path, deref(c.Version)))
		}
	}
	if ready == 0 {
		add("agents", Fail, "no CLI is installed and signed in: the runner gets no runs")
	}

	if err := writable(env.DataDir); err != nil {
		add("data", Fail, err.Error())
	} else {
		detail := env.DataDir
		if l := load.Measure(ctx, env.DataDir, env.Run); l.DiskTotal > 0 {
			detail += fmt.Sprintf(" (%.0f of %.0f GB free)", l.DiskFree, l.DiskTotal)
			if l.GPU == nil {
				detail += ", GPU load not available"
			}
		}
		add("data", OK, detail)
	}

	eq := (&equipment.Collector{Run: env.Run, Host: cfg.Host(), ClaudeDir: env.ClaudeDir}).Collect(ctx, true)
	add("equipment", OK, fmt.Sprintf("MCP servers: %s; skills: %d; plugins: %s", list(eq.MCPServers), len(eq.Skills), list(eq.Plugins)))
	for _, s := range eq.WerkbuchAccess {
		add("werkbuch access", Warn, "the MCP server "+s+" reaches "+cfg.Host()+" past the run token: switch it off for the user of the runner")
	}

	var st socket.Status
	sctx, cancel := context.WithTimeout(ctx, 2*time.Second)
	defer cancel()
	if err := socket.Dial(env.Socket).Get(sctx, "/status", &st); err != nil {
		add("daemon", Warn, "no daemon runs ("+env.Socket+"): start it with `werkbuch-runner daemon`")
	} else if !st.Connected {
		add("daemon", Warn, "the daemon runs but reaches no werkbuch: "+st.LastError)
	} else {
		add("daemon", OK, fmt.Sprintf("runs since %s, %d runs now", st.Started.Format(time.RFC3339), st.Running))
	}
	return out
}

func deref(s *string) string {
	if s == nil {
		return ""
	}
	return *s
}

func signIn(cli string) string {
	if cli == "codex" {
		return "codex login"
	}
	return "claude"
}

func list(v []string) string {
	if len(v) == 0 {
		return "none"
	}
	return strings.Join(v, ", ")
}

func reach(ctx context.Context, instance string) (string, error) {
	ctx, cancel := context.WithTimeout(ctx, 10*time.Second)
	defer cancel()
	req, _ := http.NewRequestWithContext(ctx, http.MethodGet, instance+"/up", nil)
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		return "", fmt.Errorf("%s does not answer: %v", instance, err)
	}
	resp.Body.Close()
	if resp.StatusCode != 200 {
		return "", fmt.Errorf("%s/up answers %d", instance, resp.StatusCode)
	}
	return instance + " answers", nil
}

func writable(dir string) error {
	if err := os.MkdirAll(dir, 0o700); err != nil {
		return err
	}
	probe := filepath.Join(dir, ".doctor")
	if err := os.WriteFile(probe, nil, 0o600); err != nil {
		return err
	}
	return os.Remove(probe)
}

// Failed says whether any check failed.
func Failed(checks []Check) bool {
	for _, c := range checks {
		if c.Level == Fail {
			return true
		}
	}
	return false
}
