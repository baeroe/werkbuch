// werkbuch-runner runs agents of a werkbuch instance on this machine (docs/superpowers/specs/2026-11-23-runner-design.md):
// it pairs with a one-time code, polls the instance, runs Claude Code or Codex in a worktree per strand and reports
// back. The TUI comes with WEBU-22; until then `status` shows what the daemon does.
package main

import (
	"context"
	"errors"
	"flag"
	"fmt"
	"io"
	"log/slog"
	"os"
	"os/signal"
	"runtime"
	"strings"
	"syscall"
	"time"

	"github.com/baeroe/werkbuch/runner/internal/client"
	"github.com/baeroe/werkbuch/runner/internal/clis"
	"github.com/baeroe/werkbuch/runner/internal/config"
	"github.com/baeroe/werkbuch/runner/internal/daemon"
	"github.com/baeroe/werkbuch/runner/internal/doctor"
	"github.com/baeroe/werkbuch/runner/internal/equipment"
	"github.com/baeroe/werkbuch/runner/internal/executor"
	"github.com/baeroe/werkbuch/runner/internal/git"
	"github.com/baeroe/werkbuch/runner/internal/keyring"
	"github.com/baeroe/werkbuch/runner/internal/load"
	"github.com/baeroe/werkbuch/runner/internal/paths"
	"github.com/baeroe/werkbuch/runner/internal/protocol"
	"github.com/baeroe/werkbuch/runner/internal/redact"
	"github.com/baeroe/werkbuch/runner/internal/socket"
	"github.com/baeroe/werkbuch/runner/internal/sysexec"
	"github.com/baeroe/werkbuch/runner/internal/update"
)

// version is set at build time (-ldflags "-X main.version=…"); it is the version of werkbuch (spec 3).
var version = "dev"

const usage = `werkbuch-runner runs agents of a werkbuch instance on this machine.

Commands:
  login <url> --code <CODE> [--name <name>]   pair with an instance (the code comes from Settings → Runners)
  daemon                                     poll the instance and run what it hands out
  status                                     what the daemon does now
  doctor                                     check CLIs, keychain, instance, git and the equipment
  update                                     update to the version the instance expects
  logout                                     forget the instance and its token
  version                                    print the version
`

func main() {
	os.Exit(run(os.Args[1:], os.Stdout, os.Stderr))
}

func run(args []string, stdout, stderr io.Writer) int {
	if len(args) == 0 {
		fmt.Fprintln(stdout, "The TUI of the runner comes with a later release; until then:")
		fmt.Fprintln(stdout)
		fmt.Fprint(stdout, usage)
		return 0
	}
	ctx := context.Background()
	var err error
	switch args[0] {
	case "version", "--version", "-v":
		fmt.Fprintln(stdout, version)
		return 0
	case "help", "--help", "-h":
		fmt.Fprint(stdout, usage)
		return 0
	case "login":
		err = login(ctx, args[1:], stdout)
	case "logout":
		err = logout(stdout)
	case "daemon":
		err = serve(stderr)
	case "status":
		err = status(ctx, stdout)
	case "doctor":
		return doc(ctx, stdout)
	case "update":
		err = requestUpdate(ctx, stdout)
	default:
		fmt.Fprintf(stderr, "unknown command %q\n\n%s", args[0], usage)
		return 2
	}
	if err != nil {
		fmt.Fprintln(stderr, "werkbuch-runner: "+redact.String(err.Error()))
		return 1
	}
	return 0
}

func login(ctx context.Context, args []string, stdout io.Writer) error {
	fs := flag.NewFlagSet("login", flag.ContinueOnError)
	code := fs.String("code", "", "the one-time code")
	name := fs.String("name", "", "the name of the runner (default: the host name)")
	var url string
	if len(args) > 0 && !strings.HasPrefix(args[0], "-") {
		url, args = args[0], args[1:]
	}
	if err := fs.Parse(args); err != nil {
		return err
	}
	if url == "" && fs.NArg() > 0 {
		url = fs.Arg(0)
	}
	if url == "" || *code == "" {
		return errors.New("usage: werkbuch-runner login <url> --code <CODE>")
	}
	instance, err := config.NormalizeInstance(url)
	if err != nil {
		return err
	}
	if *name == "" {
		*name, _ = os.Hostname()
		*name = strings.TrimSuffix(*name, ".local")
	}
	a, err := client.New(instance, "", version).Pair(ctx, protocol.PairRequest{Code: strings.TrimSpace(*code), Name: *name, OS: runtime.GOOS, Arch: runtime.GOARCH, Version: version})
	if err != nil {
		var p *client.ProblemError
		if errors.As(err, &p) && len(p.Errors["code"]) > 0 {
			return errors.New("the code was refused: " + strings.Join(p.Errors["code"], " "))
		}
		return err
	}
	if err := keyring.Set(instance, a.Token); err != nil {
		return fmt.Errorf("store the token in the keychain: %w", err)
	}
	cfg, err := config.Load(paths.ConfigFile())
	if err != nil && !errors.Is(err, config.ErrMissing) {
		return err
	}
	if cfg.Instance != "" && cfg.Instance != instance {
		keyring.Delete(cfg.Instance)
	}
	cfg.Instance = instance
	if err := config.Save(paths.ConfigFile(), cfg); err != nil {
		return err
	}
	fmt.Fprintf(stdout, "Paired as %q with %s.\nPlaces: %d in all, %d per repository, %d light (set in werkbuch).\nStart the daemon: werkbuch-runner daemon\n",
		a.Runner.Name, instance, a.Places.Total, a.Places.PerRepo, a.Places.Light)
	return nil
}

func logout(stdout io.Writer) error {
	cfg, err := config.Load(paths.ConfigFile())
	if err != nil {
		return err
	}
	if err := keyring.Delete(cfg.Instance); err != nil {
		return err
	}
	cfg.Instance = ""
	if err := config.Save(paths.ConfigFile(), cfg); err != nil {
		return err
	}
	fmt.Fprintf(stdout, "Forgot the token of this runner. Revoke the runner in werkbuch, too.\n")
	return nil
}

func serve(stderr io.Writer) error {
	log := slog.New(redact.Handler{Next: slog.NewTextHandler(stderr, nil)})
	cfg, err := config.Load(paths.ConfigFile())
	if err != nil {
		return err
	}
	token, err := keyring.Get(cfg.Instance)
	if err != nil {
		return err
	}
	redact.Hold(token)
	l, err := socket.Listen(paths.Socket())
	if err != nil {
		return fmt.Errorf("socket %s: %w", paths.Socket(), err)
	}
	ctx, stop := signal.NotifyContext(context.Background(), syscall.SIGINT, syscall.SIGTERM)
	defer stop()

	c := client.New(cfg.Instance, token, version)
	sampler := &load.Sampler{Dir: paths.DataDir(), Run: sysexec.Run}
	sampler.Start(ctx)
	upd, err := update.New(c)
	if err != nil {
		return err
	}
	configFile := paths.ConfigFile()
	d := &daemon.Daemon{
		Instance: cfg.Instance, Version: version, Client: c,
		Executor: &executor.Executor{
			Client: c, Git: &git.Manager{Data: paths.DataDir()}, Log: log,
			// read on every run: a change of config.yaml needs no restart
			Repos: func() map[string]string {
				now, err := config.Load(configFile)
				if err != nil {
					return nil
				}
				return now.Repos
			},
		},
		Sampler: sampler, CLIs: &clis.Detector{Run: sysexec.Run},
		Equipment: &equipment.Collector{Run: sysexec.Run, Host: cfg.Host()},
		Updater:   upd, Log: log,
	}
	go socket.Serve(ctx, l, d)
	defer os.Remove(paths.Socket())
	log.Info("runner started", "instance", cfg.Instance, "version", version, "socket", paths.Socket(), "data", paths.DataDir())
	return d.Run(ctx)
}

func status(ctx context.Context, stdout io.Writer) error {
	var st socket.Status
	c := socket.Dial(paths.Socket())
	if err := c.Get(ctx, "/status", &st); err != nil {
		return errors.New("no daemon runs: start it with `werkbuch-runner daemon`")
	}
	var runs []executor.Summary
	c.Get(ctx, "/runs", &runs)
	fmt.Fprint(stdout, Format(st, runs, time.Now()))
	return nil
}

// Format writes the status for a terminal.
func Format(st socket.Status, runs []executor.Summary, now time.Time) string {
	var b strings.Builder
	conn := "connected"
	switch {
	case st.Unauthorized:
		conn = "token refused: pair the runner again"
	case !st.Connected:
		conn = "not connected: " + st.LastError
	}
	fmt.Fprintf(&b, "Instance   %s (%s)\n", st.Instance, conn)
	fmt.Fprintf(&b, "Version    %s", st.Version)
	if st.ExpectedVersion != "" && st.ExpectedVersion != st.Version {
		fmt.Fprintf(&b, " (werkbuch expects %s)", st.ExpectedVersion)
	}
	if st.Update != "" {
		fmt.Fprintf(&b, ", update %s", st.Update)
	}
	b.WriteString("\n")
	if st.Places != nil {
		p := st.Places
		fmt.Fprintf(&b, "Places     %d/%d in all, %d/%d per repository, %d/%d light\n", p.Used.Total, p.Total, p.Used.PerRepo, p.PerRepo, p.Used.Light, p.Light)
	}
	if l := st.Load; l != nil {
		gpu := "n/a"
		if l.GPU != nil {
			gpu = fmt.Sprintf("%.0f %%", *l.GPU)
		}
		fmt.Fprintf(&b, "Load       CPU %.0f %%, GPU %s, RAM %.1f/%.1f GB, disk %.0f of %.0f GB free\n", l.CPU, gpu, l.RAMUsed, l.RAMTotal, l.DiskFree, l.DiskTotal)
	}
	for _, c := range st.CLIs {
		state := "not installed"
		if c.Installed {
			state = "installed"
			if c.Version != nil {
				state += " " + *c.Version
			}
			if c.LoggedIn {
				state += ", signed in"
			} else {
				state += ", not signed in"
			}
		}
		fmt.Fprintf(&b, "CLI        %-7s %s\n", c.CLI, state)
	}
	if eq := st.Equipment; eq != nil {
		fmt.Fprintf(&b, "Equipment  MCP %s; %d skills; plugins %s\n", join(eq.MCPServers), len(eq.Skills), join(eq.Plugins))
		for _, s := range eq.WerkbuchAccess {
			fmt.Fprintf(&b, "Warning    %s reaches werkbuch past the run token\n", s)
		}
	}
	if len(runs) == 0 {
		b.WriteString("Runs       none yet\n")
	}
	for _, r := range runs {
		what := r.Item
		if what == "" {
			what = r.Project
		}
		state := r.Status
		if r.Result != "" {
			state = r.Result
		}
		took := now.Sub(r.Started)
		if !r.Ended.IsZero() {
			took = r.Ended.Sub(r.Started)
		}
		fmt.Fprintf(&b, "Run        %s %-10s %-8s %-10s %s, %d lines\n", r.ID, r.Type, what, state, took.Round(time.Second), r.Lines)
	}
	return b.String()
}

func join(v []string) string {
	if len(v) == 0 {
		return "none"
	}
	return strings.Join(v, ", ")
}

func doc(ctx context.Context, stdout io.Writer) int {
	checks := doctor.Checks(ctx, doctor.Env{ConfigFile: paths.ConfigFile(), DataDir: paths.DataDir(), Socket: paths.Socket(), Version: version, Run: sysexec.Run})
	marks := map[string]string{doctor.OK: "ok  ", doctor.Warn: "warn", doctor.Fail: "FAIL"}
	for _, c := range checks {
		fmt.Fprintf(stdout, "%s  %-16s %s\n", marks[c.Level], c.Name, redact.String(c.Detail))
	}
	if doctor.Failed(checks) {
		return 1
	}
	return 0
}

func requestUpdate(ctx context.Context, stdout io.Writer) error {
	var a map[string]string
	if err := socket.Dial(paths.Socket()).Post(ctx, "/update", &a); err != nil {
		return errors.New("no daemon runs: start it with `werkbuch-runner daemon`")
	}
	fmt.Fprintln(stdout, a["update"])
	return nil
}
