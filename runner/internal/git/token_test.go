package git

import (
	"context"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/baeroe/werkbuch/runner/internal/fakegit"
)

const (
	first  = "ghs_first0000000000000000000000"
	second = "ghs_second000000000000000000000"
)

func TestEnv(t *testing.T) {
	var none *TokenFile
	if none.Env() != nil {
		t.Fatal("no token, no env")
	}
	env := strings.Join(NewTokenFile("/private/run", "https://github.com/acme/app.git").Env(), "\n")
	for _, want := range []string{
		TokenFileEnv + "=/private/run/git-token", "GIT_CONFIG_KEY_0=credential.helper\nGIT_CONFIG_VALUE_0=\n",
		"GIT_CONFIG_KEY_1=credential.https://github.com.helper", "GIT_TERMINAL_PROMPT=0",
		"GH_CONFIG_DIR=/private/run/gh", "\nGH_TOKEN=\n", "\nGITHUB_TOKEN=\n",
	} {
		if !strings.Contains(env+"\n", want) {
			t.Fatalf("no %q in\n%s", want, env)
		}
	}
	// a local repository: the helpers of the machine are reset, no helper of the run, no gh
	local := strings.Join(NewTokenFile("/private/run", "/srv/repos/app").Env(), "\n")
	if !strings.Contains(local, "GIT_CONFIG_COUNT=1") || strings.Contains(local, "GH_CONFIG_DIR") {
		t.Fatal(local)
	}
}

func TestTokenFile(t *testing.T) {
	dir := t.TempDir()
	f := NewTokenFile(dir, "https://github.com/acme/app.git")
	if err := f.Write(first); err != nil {
		t.Fatal(err)
	}
	if err := f.Write(second); err != nil {
		t.Fatal(err)
	}
	for _, path := range []string{f.Path, filepath.Join(dir, "gh", "hosts.yml"), filepath.Join(dir, "gh", "config.yml")} {
		info, err := os.Stat(path)
		if err != nil || info.Mode().Perm() != 0o600 {
			t.Fatalf("%s: %v %v", path, info, err)
		}
	}
	data, _ := os.ReadFile(f.Path)
	hosts, _ := os.ReadFile(filepath.Join(dir, "gh", "hosts.yml"))
	if string(data) != second || strings.Contains(string(hosts), first) || strings.Count(string(hosts), second) != 2 || !strings.HasPrefix(string(hosts), "github.com:\n") {
		t.Fatalf("%q\n%s", data, hosts)
	}
	for _, sub := range []string{dir, filepath.Join(dir, "gh")} {
		entries, _ := os.ReadDir(sub)
		for _, e := range entries {
			if strings.HasPrefix(e.Name(), ".tmp-") {
				t.Fatalf("left %s", e.Name())
			}
		}
	}
	for _, bad := range []string{"ghs_x\nline", "ghs_x y", "ghs_x'", "ghs_x:", ""} {
		if f.Write(bad) == nil {
			t.Fatalf("took %q", bad)
		}
	}
}

// remote is a fake GitHub remote with one repository.
func remote(t *testing.T) (*fakegit.Server, string) {
	fg, err := fakegit.New(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(fg.Close)
	url, err := fg.Seed("origin")
	if err != nil {
		t.Fatal(err)
	}
	return fg, url
}

func TestTheHelperReadsTheTokenFileOnEveryCall(t *testing.T) {
	ctx := context.Background()
	fg, url := remote(t)
	// a helper of the machine (osxkeychain, `gh auth setup-git`) never answers or stores: the list is reset
	global := filepath.Join(t.TempDir(), "gitconfig")
	os.WriteFile(global, []byte("[credential]\n\thelper = \"!f() { echo username=x-access-token; echo password=stale-machine-token; }; f\"\n"), 0o600)
	t.Setenv("GIT_CONFIG_GLOBAL", global)

	fg.Accept(first, time.Now().Add(time.Hour))
	file := NewTokenFile(t.TempDir(), url)
	file.Write(first)
	m := &Manager{Data: t.TempDir()}
	ws, err := m.Prepare(ctx, Spec{Name: "thread-1", Repo: url, Branch: "agent/WEB-1-x", Auth: file})
	if err != nil {
		t.Fatal(err)
	}
	// the token is renewed and the first one runs out: a push after it uses the new one, with the same environment
	fg.Accept(second, time.Now().Add(time.Hour))
	fg.Accept(first, time.Now())
	file.Write(second)
	os.WriteFile(filepath.Join(ws.Dir, "a.txt"), []byte("a"), 0o644)
	sh(t, ws.Dir, "add", ".")
	sh(t, ws.Dir, "commit", "--quiet", "-m", "work")
	push := exec.Command("git", "push", "--quiet")
	push.Dir = ws.Dir
	push.Env = append(os.Environ(), ws.Env...)
	if out, err := push.CombinedOutput(); err != nil {
		t.Fatalf("push: %v %s", err, out)
	}
	if fg.Head("origin", "agent/WEB-1-x") != m.Head(ctx, ws) {
		t.Fatal("not pushed")
	}
	var pushed []string
	for _, r := range fg.Requests() {
		if r.Token == "stale-machine-token" {
			t.Fatal("a helper of the machine answered")
		}
		if r.Push && r.Allowed {
			pushed = append(pushed, r.Token)
		}
	}
	if len(pushed) == 0 || pushed[0] != second {
		t.Fatalf("pushed with %v", pushed)
	}
	for _, dir := range []string{m.mirror(url), ws.Dir} {
		cfg, _ := os.ReadFile(filepath.Join(dir, "config"))
		if strings.Contains(string(cfg), "ghs_") {
			t.Fatal("a token in a config")
		}
	}

	// another host never gets the token of the run
	other, otherURL := remote(t)
	other.Accept(second, time.Now().Add(time.Hour))
	probe := exec.Command("git", "ls-remote", "--", otherURL)
	probe.Env = append(os.Environ(), ws.Env...)
	if out, err := probe.CombinedOutput(); err == nil {
		t.Fatalf("another host answered: %s", out)
	}
	for _, r := range other.Requests() {
		if r.Token == second || r.Token == first {
			t.Fatal("the token went to another host")
		}
	}
}

// ghEnv is the environment of a run on a machine whose gh is logged in elsewhere.
func ghEnv(t *testing.T, file *TokenFile) []string {
	machine := t.TempDir()
	os.WriteFile(filepath.Join(machine, "hosts.yml"), []byte("github.com:\n    oauth_token: gho_machinemachinemachinemachine\n    user: baeroe\n"), 0o600)
	t.Setenv("GH_CONFIG_DIR", machine)
	t.Setenv("GH_TOKEN", "gho_machinetokenmachinetoken0001")
	t.Setenv("GITHUB_TOKEN", "gho_machinetokenmachinetoken0002")
	return append(os.Environ(), file.Env()...)
}

func TestGhCalledByItsPathSeesOnlyTheTokenOfTheRun(t *testing.T) {
	bin := t.TempDir()
	fakeGh := filepath.Join(bin, "gh")
	// a fake gh as gh reads its token: GH_TOKEN, GITHUB_TOKEN, else hosts.yml of GH_CONFIG_DIR
	os.WriteFile(fakeGh, []byte("#!/bin/sh\ntok=${GH_TOKEN:-$GITHUB_TOKEN}\n[ -z \"$tok\" ] && tok=$(sed -n 's/^    oauth_token: //p' \"$GH_CONFIG_DIR/hosts.yml\")\nprintf '%s' \"$tok\"\n"), 0o700)
	file := NewTokenFile(t.TempDir(), "https://github.com/acme/app.git")
	file.Write(first)
	env := ghEnv(t, file)
	run := func() string {
		cmd := exec.Command(fakeGh, "pr", "view")
		cmd.Env = env
		out, err := cmd.Output()
		if err != nil {
			t.Fatal(err)
		}
		return string(out)
	}
	if got := run(); got != first {
		t.Fatalf("gh saw %q", got)
	}
	file.Write(second)
	if got := run(); got != second {
		t.Fatalf("gh saw %q after the renewal", got)
	}
}

func TestTheRealGhReadsTheTokenOfTheRun(t *testing.T) {
	gh, err := exec.LookPath("gh")
	if err != nil {
		t.Skip("no gh on this machine")
	}
	file := NewTokenFile(t.TempDir(), "https://github.com/acme/app.git")
	file.Write(first)
	env := ghEnv(t, file)
	for _, want := range []string{first, second} {
		file.Write(want)
		cmd := exec.Command(gh, "auth", "token", "--hostname", "github.com")
		cmd.Env = env
		out, err := cmd.CombinedOutput()
		if err != nil || strings.TrimSpace(string(out)) != want {
			t.Fatalf("gh auth token: %v, the token of the run: %v", err, strings.TrimSpace(string(out)) == want)
		}
	}
	hosts, _ := os.ReadFile(filepath.Join(file.GhConfigDir(), "hosts.yml"))
	if strings.Contains(string(hosts), "machine") {
		t.Fatal("gh wrote the machine's login into the config of the run")
	}
}

func TestClosedEnv(t *testing.T) {
	env := strings.Join(ClosedEnv("/private/empty"), "\n") + "\n"
	for _, want := range []string{"GIT_CONFIG_COUNT=1\n", "GIT_CONFIG_KEY_0=credential.helper\nGIT_CONFIG_VALUE_0=\n", "GH_CONFIG_DIR=/private/empty\n", "GH_TOKEN=\n", "GITHUB_TOKEN=\n", "GH_ENTERPRISE_TOKEN=\n", "GITHUB_ENTERPRISE_TOKEN=\n"} {
		if !strings.Contains(env, want) {
			t.Fatalf("no %q in\n%s", want, env)
		}
	}
	if strings.Contains(env, TokenFileEnv) {
		t.Fatal("the token file in a closed environment")
	}
	// git asks no helper of the machine: the remote sees no login
	fg, url := remote(t)
	global := filepath.Join(t.TempDir(), "gitconfig")
	os.WriteFile(global, []byte("[credential]\n\thelper = \"!f() { echo username=x-access-token; echo password=stale-machine-token; }; f\"\n"), 0o600)
	t.Setenv("GIT_CONFIG_GLOBAL", global)
	probe := exec.Command("git", "ls-remote", "--", url)
	probe.Env = append(os.Environ(), ClosedEnv(t.TempDir())...)
	if out, err := probe.CombinedOutput(); err == nil {
		t.Fatalf("answered without a token: %s", out)
	}
	for _, r := range fg.Requests() {
		if r.Token != "" {
			t.Fatalf("a login reached the remote")
		}
	}
}
