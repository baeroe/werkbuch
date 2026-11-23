package service

import (
	"context"
	"errors"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"strings"
	"testing"
)

// fakeRun records the commands and answers with the error of the first matching prefix.
type fakeRun struct {
	calls []string
	fail  map[string]error
}

func (f *fakeRun) run(_ context.Context, name string, args ...string) ([]byte, error) {
	line := strings.TrimSpace(name + " " + strings.Join(args, " "))
	f.calls = append(f.calls, line)
	for prefix, err := range f.fail {
		if strings.HasPrefix(line, prefix) {
			return []byte("refused"), err
		}
	}
	return nil, nil
}

func options(t *testing.T, system string) Options {
	dir := t.TempDir()
	return Options{
		OS:    system,
		Exe:   "/Users/mara/.local/bin/werkbuch-runner",
		Dir:   filepath.Join(dir, "units"),
		State: filepath.Join(dir, "state"),
		Home:  "/Users/mara",
		UID:   501,
		Env:   map[string]string{"PATH": "/Users/mara/.local/bin:/opt/homebrew/bin:/usr/bin:/bin", "WERKBUCH_RUNNER_CONFIG_DIR": "/tmp/a & <b>"},
	}
}

func TestPlist(t *testing.T) {
	o := options(t, "darwin")
	text, err := Render(o)
	if err != nil {
		t.Fatal(err)
	}
	for _, want := range []string{
		`<?xml version="1.0" encoding="UTF-8"?>`,
		"<key>Label</key>\n\t<string>dev.werkbuch.runner</string>",
		"<string>/Users/mara/.local/bin/werkbuch-runner</string>\n\t\t<string>daemon</string>",
		"<key>RunAtLoad</key>\n\t<true/>",
		"<key>KeepAlive</key>\n\t<true/>",
		"<key>ThrottleInterval</key>\n\t<integer>10</integer>",
		"<key>PATH</key>\n\t\t<string>/Users/mara/.local/bin:/opt/homebrew/bin:/usr/bin:/bin</string>",
		"<string>/tmp/a &amp; &lt;b&gt;</string>",
		"<key>StandardOutPath</key>\n\t<string>" + filepath.Join(o.State, "runner.log") + "</string>",
		"<key>WorkingDirectory</key>\n\t<string>/Users/mara</string>",
	} {
		if !strings.Contains(text, want) {
			t.Errorf("the plist lacks %q:\n%s", want, text)
		}
	}
	if strings.Contains(text, "ProcessType") {
		t.Error("a background process type throttles the agents")
	}
	if p, _ := exec.LookPath("plutil"); p != "" {
		file := filepath.Join(t.TempDir(), "x.plist")
		os.WriteFile(file, []byte(text), 0o644)
		if out, err := exec.Command(p, "-lint", file).CombinedOutput(); err != nil {
			t.Fatalf("plutil: %s", out)
		}
	}
}

func TestUnit(t *testing.T) {
	o := options(t, "linux")
	o.Exe = "/home/mara/.local/bin/werkbuch-runner"
	o.Env["WERKBUCH_RUNNER_DATA_DIR"] = `/srv/100% "runner" $HOME\x`
	text, err := Render(o)
	if err != nil {
		t.Fatal(err)
	}
	for _, want := range []string{
		"[Unit]\nDescription=werkbuch runner\n",
		"[Service]\nType=simple\nExecStart=/home/mara/.local/bin/werkbuch-runner daemon\n",
		"Restart=always\nRestartSec=10\n",
		`Environment="PATH=/Users/mara/.local/bin:/opt/homebrew/bin:/usr/bin:/bin"`,
		// systemd.exec(5): Environment= takes specifiers (%) and C escapes, but expands no $
		`Environment="WERKBUCH_RUNNER_DATA_DIR=/srv/100%% \"runner\" $HOME\\x"`,
		"[Install]\nWantedBy=default.target\n",
	} {
		if !strings.Contains(text, want) {
			t.Errorf("the unit lacks %q:\n%s", want, text)
		}
	}
	// the variables in a fixed order: a second install writes the same file
	if strings.Index(text, "PATH=") > strings.Index(text, "WERKBUCH_RUNNER_CONFIG_DIR=") {
		t.Error("PATH first")
	}
	if strings.Index(text, "WERKBUCH_RUNNER_CONFIG_DIR=") > strings.Index(text, "WERKBUCH_RUNNER_DATA_DIR=") {
		t.Error("variables sorted")
	}
}

func TestRenderRefuses(t *testing.T) {
	o := options(t, "windows")
	if _, err := Render(o); err == nil {
		t.Fatal("windows has no service")
	}
	o = options(t, "linux")
	o.Exe = "/home/a b/werkbuch-runner"
	if _, err := Render(o); err == nil {
		t.Fatal("a path with a space in ExecStart")
	}
	o.Exe = "/home/$USER/werkbuch-runner"
	if _, err := Render(o); err == nil {
		t.Fatal("a $ in ExecStart")
	}
	o.Exe = "relative/werkbuch-runner"
	if _, err := Render(o); err == nil {
		t.Fatal("a relative path")
	}
	o = options(t, "linux")
	o.Env["X"] = "a\nb"
	if _, err := Render(o); err == nil {
		t.Fatal("a line break in a value")
	}
}

func TestInstallLaunchd(t *testing.T) {
	o := options(t, "darwin")
	f := &fakeRun{fail: map[string]error{"launchctl bootout": errors.New("exit status 3")}}
	o.Run = f.run
	path, err := Install(context.Background(), o, true)
	if err != nil {
		t.Fatal(err)
	}
	if path != filepath.Join(o.Dir, "dev.werkbuch.runner.plist") {
		t.Fatal(path)
	}
	if info, err := os.Stat(path); err != nil || info.Mode().Perm() != 0o644 {
		t.Fatalf("%v %v", info, err)
	}
	if info, err := os.Stat(o.State); err != nil || !info.IsDir() {
		t.Fatal("the folder of the log is missing")
	}
	want := []string{
		"launchctl bootout gui/501/dev.werkbuch.runner",
		"launchctl enable gui/501/dev.werkbuch.runner",
		"launchctl bootstrap gui/501 " + path,
	}
	if strings.Join(f.calls, "\n") != strings.Join(want, "\n") {
		t.Fatalf("%q", f.calls)
	}
	if Started(o) != "launchd dev.werkbuch.runner loaded and started" {
		t.Fatal(Started(o))
	}
}

func TestInstallLaunchdWithoutAGUISession(t *testing.T) {
	o := options(t, "darwin")
	f := &fakeRun{fail: map[string]error{"launchctl bootstrap": errors.New("exit status 125")}}
	o.Run = f.run
	o.Pause = func() {}
	_, err := Install(context.Background(), o, true)
	if err == nil || !strings.Contains(err.Error(), "needs a GUI session of this user") || !strings.Contains(err.Error(), "werkbuch-runner service install") {
		t.Fatal(err)
	}
}

func TestTrimLog(t *testing.T) {
	dir := t.TempDir()
	log := filepath.Join(dir, "runner.log")
	if err := TrimLog(log, 10); err != nil {
		t.Fatalf("no log yet: %v", err)
	}
	os.WriteFile(log, []byte("0123456789"), 0o600)
	if err := TrimLog(log, 10); err != nil {
		t.Fatal(err)
	}
	if data, _ := os.ReadFile(log); string(data) != "0123456789" {
		t.Fatal("a log at the limit stays")
	}
	os.WriteFile(log+".1", []byte("older"), 0o600)
	// launchd holds the file open with O_APPEND: the log is emptied in place, never renamed
	held, _ := os.OpenFile(log, os.O_WRONLY|os.O_APPEND, 0)
	defer held.Close()
	held.WriteString("ab")
	if err := TrimLog(log, 10); err != nil {
		t.Fatal(err)
	}
	if data, _ := os.ReadFile(log + ".1"); string(data) != "0123456789ab" {
		t.Fatalf("the predecessor is %q", data)
	}
	held.WriteString("new")
	if data, _ := os.ReadFile(log); string(data) != "new" {
		t.Fatalf("the log is %q", data)
	}
	if info, _ := os.Stat(log + ".1"); info.Mode().Perm() != 0o600 {
		t.Fatal(info.Mode())
	}
	if LogFile("/s") != "/s/runner.log" || LogMax != 10<<20 {
		t.Fatal(LogFile("/s"), LogMax)
	}
}

func TestInstallLaunchdRetriesTheBootstrap(t *testing.T) {
	o := options(t, "darwin")
	f := &fakeRun{fail: map[string]error{"launchctl bootstrap": errors.New("exit status 5")}}
	o.Run = f.run
	o.Pause = func() {}
	_, err := Install(context.Background(), o, true)
	if err == nil || !strings.Contains(err.Error(), "launchctl bootstrap") || !strings.Contains(err.Error(), "refused") {
		t.Fatal(err)
	}
	bootstraps := 0
	for _, c := range f.calls {
		if strings.HasPrefix(c, "launchctl bootstrap") {
			bootstraps++
		}
	}
	if bootstraps != 5 {
		t.Fatalf("%d bootstraps", bootstraps)
	}
}

func TestInstallSystemd(t *testing.T) {
	o := options(t, "linux")
	f := &fakeRun{}
	o.Run = f.run
	path, err := Install(context.Background(), o, true)
	if err != nil {
		t.Fatal(err)
	}
	if path != filepath.Join(o.Dir, "werkbuch-runner.service") {
		t.Fatal(path)
	}
	want := []string{
		"systemctl --user daemon-reload",
		"systemctl --user enable werkbuch-runner.service",
		"systemctl --user restart werkbuch-runner.service",
	}
	if strings.Join(f.calls, "\n") != strings.Join(want, "\n") {
		t.Fatalf("%q", f.calls)
	}
	if Started(o) != "systemd werkbuch-runner.service enabled and started" {
		t.Fatal(Started(o))
	}

	f = &fakeRun{fail: map[string]error{"systemctl --user daemon-reload": errors.New("exit status 1")}}
	o.Run = f.run
	if _, err := Install(context.Background(), o, true); err == nil || !strings.Contains(err.Error(), "systemctl --user") {
		t.Fatal(err)
	}
}

func TestInstallWithoutStart(t *testing.T) {
	for _, system := range []string{"darwin", "linux"} {
		o := options(t, system)
		f := &fakeRun{}
		o.Run = f.run
		path, err := Install(context.Background(), o, false)
		if err != nil {
			t.Fatal(err)
		}
		if len(f.calls) != 0 {
			t.Fatalf("%s: %q", system, f.calls)
		}
		if _, err := os.Stat(path); err != nil {
			t.Fatal(err)
		}
		// a second write leaves no temporary file
		if _, err := Install(context.Background(), o, false); err != nil {
			t.Fatal(err)
		}
		if entries, _ := os.ReadDir(o.Dir); len(entries) != 1 {
			t.Fatalf("%v", entries)
		}
	}
}

func TestUninstall(t *testing.T) {
	o := options(t, "darwin")
	f := &fakeRun{}
	o.Run = f.run
	path, _ := Install(context.Background(), o, false)
	if err := Uninstall(context.Background(), o); err != nil {
		t.Fatal(err)
	}
	if _, err := os.Stat(path); !os.IsNotExist(err) {
		t.Fatal("the plist stays")
	}
	if f.calls[0] != "launchctl bootout gui/501/dev.werkbuch.runner" {
		t.Fatalf("%q", f.calls)
	}
	if err := Uninstall(context.Background(), o); err != nil {
		t.Fatalf("twice: %v", err)
	}

	o = options(t, "linux")
	f = &fakeRun{fail: map[string]error{"systemctl --user disable": errors.New("not loaded")}}
	o.Run = f.run
	Install(context.Background(), o, false)
	if err := Uninstall(context.Background(), o); err != nil {
		t.Fatal(err)
	}
	if strings.Join(f.calls, "\n") != "systemctl --user disable --now werkbuch-runner.service\nsystemctl --user daemon-reload" {
		t.Fatalf("%q", f.calls)
	}
}

func TestDefaults(t *testing.T) {
	t.Setenv("WERKBUCH_RUNNER_SERVICE_DIR", "")
	t.Setenv("XDG_CONFIG_HOME", "")
	t.Setenv("WERKBUCH_RUNNER_CONFIG_DIR", "/c")
	t.Setenv("WERKBUCH_RUNNER_STATE_DIR", "/s")
	t.Setenv("WERKBUCH_RUNNER_IGNORED", "x")
	o, err := Defaults()
	if err != nil {
		t.Fatal(err)
	}
	if o.OS != runtime.GOOS || o.Exe == "" || o.Home == "" || o.State != "/s" || o.Run == nil {
		t.Fatalf("%+v", o)
	}
	if o.Env["PATH"] != os.Getenv("PATH") || o.Env["WERKBUCH_RUNNER_CONFIG_DIR"] != "/c" || o.Env["WERKBUCH_RUNNER_STATE_DIR"] != "/s" {
		t.Fatalf("%v", o.Env)
	}
	if _, ok := o.Env["WERKBUCH_RUNNER_IGNORED"]; ok {
		t.Fatal("only the folders of the runner")
	}
	want := filepath.Join(o.Home, ".config/systemd/user")
	if runtime.GOOS == "darwin" {
		want = filepath.Join(o.Home, "Library/LaunchAgents")
	}
	if o.Dir != want {
		t.Fatal(o.Dir)
	}
	t.Setenv("WERKBUCH_RUNNER_SERVICE_DIR", "/units")
	if o, _ := Defaults(); o.Dir != "/units" {
		t.Fatal(o.Dir)
	}
	if runtime.GOOS == "linux" {
		t.Setenv("WERKBUCH_RUNNER_SERVICE_DIR", "")
		t.Setenv("XDG_CONFIG_HOME", "/xdg")
		if o, _ := Defaults(); o.Dir != "/xdg/systemd/user" {
			t.Fatal(o.Dir)
		}
	}
}

func TestUninstallRefusesOtherSystems(t *testing.T) {
	if err := Uninstall(context.Background(), Options{OS: "windows"}); err == nil {
		t.Fatal("windows")
	}
}
