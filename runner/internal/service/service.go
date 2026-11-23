// Package service makes the runner a service of the user (spec 8.2): a launch agent on macOS
// (~/Library/LaunchAgents/dev.werkbuch.runner.plist) and a systemd user unit on Linux
// (~/.config/systemd/user/werkbuch-runner.service), both running `werkbuch-runner daemon` with the PATH of the shell
// that installed it (launchd and systemd start with a bare PATH, the CLIs of the agents live in ~/.local/bin or
// Homebrew) and the folders of the runner when they were moved. Never as root, never with sudo: the agents run with the
// rights of this user (spec 11.1). A second install replaces the first, so pairing again leaves one service.
package service

import (
	"context"
	"encoding/xml"
	"errors"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"sort"
	"strconv"
	"strings"
	"time"

	"github.com/baeroe/werkbuch/runner/internal/paths"
	"github.com/baeroe/werkbuch/runner/internal/sysexec"
)

const (
	// Label of the launch agent (like the mock-up of the installer).
	Label = "dev.werkbuch.runner"
	// Unit of systemd.
	Unit = "werkbuch-runner.service"
)

// EnvPrefix names the variables that move the folders of the runner (paths); the service keeps them.
const EnvPrefix = "WERKBUCH_RUNNER_"

// Options describe one service.
type Options struct {
	OS string
	// Exe is the absolute path of the binary the service starts.
	Exe string
	// Dir holds the plist or the unit.
	Dir string
	// State holds the log of the launch agent.
	State string
	Home  string
	UID   int
	// Env is written into the service: PATH and the WERKBUCH_RUNNER_* folders.
	Env map[string]string
	Run sysexec.Func
	// Pause waits between two tries of launchctl bootstrap (a second long in use).
	Pause func()
}

// Defaults are the options for this machine and user.
func Defaults() (Options, error) {
	exe, err := os.Executable()
	if err != nil {
		return Options{}, err
	}
	if resolved, err := filepath.EvalSymlinks(exe); err == nil {
		exe = resolved
	}
	home, err := os.UserHomeDir()
	if err != nil {
		return Options{}, err
	}
	env := map[string]string{"PATH": os.Getenv("PATH")}
	for _, pair := range os.Environ() {
		name, value, _ := strings.Cut(pair, "=")
		switch name {
		case "WERKBUCH_RUNNER_CONFIG_DIR", "WERKBUCH_RUNNER_STATE_DIR", "WERKBUCH_RUNNER_DATA_DIR", "WERKBUCH_RUNNER_SOCKET":
			if value != "" {
				env[name] = value
			}
		}
	}
	dir := os.Getenv("WERKBUCH_RUNNER_SERVICE_DIR")
	if dir == "" && runtime.GOOS == "darwin" {
		dir = filepath.Join(home, "Library", "LaunchAgents")
	}
	if dir == "" {
		config := os.Getenv("XDG_CONFIG_HOME")
		if config == "" {
			config = filepath.Join(home, ".config")
		}
		dir = filepath.Join(config, "systemd", "user")
	}
	return Options{
		OS: runtime.GOOS, Exe: exe, Dir: dir, State: paths.StateDir(), Home: home, UID: os.Getuid(), Env: env,
		Run: sysexec.Run, Pause: func() { time.Sleep(time.Second) },
	}, nil
}

// File is the path of the plist or the unit.
func File(o Options) string {
	if o.OS == "darwin" {
		return filepath.Join(o.Dir, Label+".plist")
	}
	return filepath.Join(o.Dir, Unit)
}

// Started says in a few words what Install(…, true) did, for the installer.
func Started(o Options) string {
	if o.OS == "darwin" {
		return "launchd " + Label + " loaded and started"
	}
	return "systemd " + Unit + " enabled and started"
}

// Render writes the plist (macOS) or the unit (Linux).
func Render(o Options) (string, error) {
	if o.OS != "darwin" && o.OS != "linux" {
		return "", fmt.Errorf("no service on %s: start `werkbuch-runner daemon` yourself", o.OS)
	}
	if !filepath.IsAbs(o.Exe) {
		return "", fmt.Errorf("the path of the runner is not absolute: %s", o.Exe)
	}
	names := make([]string, 0, len(o.Env))
	for name, value := range o.Env {
		if strings.ContainsAny(name+value, "\n\r\x00") {
			return "", fmt.Errorf("the variable %s holds a line break", name)
		}
		if name != "PATH" {
			names = append(names, name)
		}
	}
	sort.Strings(names)
	if _, ok := o.Env["PATH"]; ok {
		names = append([]string{"PATH"}, names...)
	}
	if o.OS == "darwin" {
		return plist(o, names), nil
	}
	// systemd splits ExecStart at spaces; quoting would need its own rules, a home with a space is rare enough to refuse
	if strings.ContainsAny(o.Exe, " \t\"'\\%$") {
		return "", fmt.Errorf("the path of the runner has a space or a special character: %s", o.Exe)
	}
	return unit(o, names), nil
}

func esc(s string) string {
	var b strings.Builder
	xml.EscapeText(&b, []byte(s))
	return b.String()
}

func plist(o Options, names []string) string {
	var b strings.Builder
	b.WriteString(`<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
`)
	key := func(k string) { b.WriteString("\t<key>" + k + "</key>\n") }
	str := func(k, v string) { key(k); b.WriteString("\t<string>" + esc(v) + "</string>\n") }
	str("Label", Label)
	key("ProgramArguments")
	b.WriteString("\t<array>\n\t\t<string>" + esc(o.Exe) + "</string>\n\t\t<string>daemon</string>\n\t</array>\n")
	key("RunAtLoad")
	b.WriteString("\t<true/>\n")
	// up again after a crash or an exit; ThrottleInterval keeps a refused token from a tight loop
	key("KeepAlive")
	b.WriteString("\t<true/>\n")
	key("ThrottleInterval")
	b.WriteString("\t<integer>10</integer>\n")
	if len(names) > 0 {
		key("EnvironmentVariables")
		b.WriteString("\t<dict>\n")
		for _, name := range names {
			b.WriteString("\t\t<key>" + esc(name) + "</key>\n\t\t<string>" + esc(o.Env[name]) + "</string>\n")
		}
		b.WriteString("\t</dict>\n")
	}
	str("WorkingDirectory", o.Home)
	log := filepath.Join(o.State, "runner.log")
	str("StandardOutPath", log)
	str("StandardErrorPath", log)
	b.WriteString("</dict>\n</plist>\n")
	return b.String()
}

// quote writes a value for Environment= of systemd: in double quotes, with %, $, " and \ escaped.
func quote(s string) string {
	s = strings.NewReplacer(`\`, `\\`, `"`, `\"`, "%", "%%", "$", "$$").Replace(s)
	return `"` + s + `"`
}

func unit(o Options, names []string) string {
	var b strings.Builder
	b.WriteString("[Unit]\nDescription=werkbuch runner\nDocumentation=https://werkbuch.dev/en/runner\n\n")
	b.WriteString("[Service]\nType=simple\nExecStart=" + o.Exe + " daemon\n")
	b.WriteString("Restart=always\nRestartSec=10\n")
	for _, name := range names {
		b.WriteString("Environment=" + quote(name+"="+o.Env[name]) + "\n")
	}
	b.WriteString("\n[Install]\nWantedBy=default.target\n")
	return b.String()
}

// Install writes the plist or the unit and, with start, loads it (a running one is replaced: it starts with the new
// binary and token). It returns the path of the file.
func Install(ctx context.Context, o Options, start bool) (string, error) {
	text, err := Render(o)
	if err != nil {
		return "", err
	}
	if err := os.MkdirAll(o.Dir, 0o755); err != nil {
		return "", err
	}
	if o.OS == "darwin" {
		if err := os.MkdirAll(o.State, 0o700); err != nil {
			return "", err
		}
	}
	file := File(o)
	tmp, err := os.CreateTemp(o.Dir, ".werkbuch-runner-*")
	if err != nil {
		return "", err
	}
	defer os.Remove(tmp.Name())
	if _, err := tmp.WriteString(text); err != nil {
		tmp.Close()
		return "", err
	}
	if err := tmp.Close(); err != nil {
		return "", err
	}
	if err := os.Chmod(tmp.Name(), 0o644); err != nil {
		return "", err
	}
	if err := os.Rename(tmp.Name(), file); err != nil {
		return "", err
	}
	if !start {
		return file, nil
	}
	if o.OS == "darwin" {
		return file, load(ctx, o, file)
	}
	for _, args := range [][]string{{"daemon-reload"}, {"enable", Unit}, {"restart", Unit}} {
		if err := call(ctx, o, "systemctl", append([]string{"--user"}, args...)...); err != nil {
			return file, fmt.Errorf("%w (no user session of systemd? `loginctl enable-linger` keeps one for a server)", err)
		}
	}
	return file, nil
}

func load(ctx context.Context, o Options, file string) error {
	domain := "gui/" + strconv.Itoa(o.UID)
	// an agent loaded before goes first (a second pairing, a new binary); none loaded is fine
	_ = call(ctx, o, "launchctl", "bootout", domain+"/"+Label)
	if err := call(ctx, o, "launchctl", "enable", domain+"/"+Label); err != nil {
		return err
	}
	// bootout returns before the old agent is gone; bootstrap then fails with 5 for a moment
	var err error
	for try := 0; try < 5; try++ {
		if err = call(ctx, o, "launchctl", "bootstrap", domain, file); err == nil {
			return nil
		}
		if o.Pause != nil {
			o.Pause()
		}
	}
	return err
}

// Uninstall stops the service and removes its file; a service that is not there is fine.
func Uninstall(ctx context.Context, o Options) error {
	if o.OS != "darwin" && o.OS != "linux" {
		return fmt.Errorf("no service on %s", o.OS)
	}
	if o.OS == "darwin" {
		_ = call(ctx, o, "launchctl", "bootout", "gui/"+strconv.Itoa(o.UID)+"/"+Label)
	} else {
		_ = call(ctx, o, "systemctl", "--user", "disable", "--now", Unit)
	}
	if err := os.Remove(File(o)); err != nil && !errors.Is(err, os.ErrNotExist) {
		return err
	}
	if o.OS != "darwin" {
		_ = call(ctx, o, "systemctl", "--user", "daemon-reload")
	}
	return nil
}

func call(ctx context.Context, o Options, name string, args ...string) error {
	out, err := o.Run(ctx, name, args...)
	if err != nil {
		detail := strings.TrimSpace(string(out))
		var exit *exec.ExitError
		if errors.As(err, &exit) {
			detail = strings.TrimSpace(detail + " " + string(exit.Stderr))
		}
		if detail != "" {
			return fmt.Errorf("%s %s: %v: %s", name, strings.Join(args, " "), err, detail)
		}
		return fmt.Errorf("%s %s: %v", name, strings.Join(args, " "), err)
	}
	return nil
}
