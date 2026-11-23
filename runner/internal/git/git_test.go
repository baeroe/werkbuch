package git

import (
	"context"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"sync"
	"testing"
	"time"
)

func sh(t *testing.T, dir string, args ...string) string {
	t.Helper()
	cmd := exec.Command("git", args...)
	cmd.Dir = dir
	cmd.Env = append(os.Environ(), "GIT_AUTHOR_NAME=t", "GIT_AUTHOR_EMAIL=t@example.com", "GIT_COMMITTER_NAME=t", "GIT_COMMITTER_EMAIL=t@example.com")
	out, err := cmd.CombinedOutput()
	if err != nil {
		t.Fatalf("git %v: %v %s", args, err, out)
	}
	return strings.TrimSpace(string(out))
}

// Origin makes a repository with one commit on main.
func Origin(t *testing.T) string {
	dir := filepath.Join(t.TempDir(), "origin")
	os.MkdirAll(dir, 0o755)
	sh(t, dir, "init", "--quiet", "-b", "main")
	os.WriteFile(filepath.Join(dir, "README.md"), []byte("hi\n"), 0o644)
	sh(t, dir, "add", ".")
	sh(t, dir, "commit", "--quiet", "-m", "first")
	sh(t, dir, "config", "receive.denyCurrentBranch", "ignore")
	return dir
}

func TestStrandWorktree(t *testing.T) {
	ctx := context.Background()
	origin := Origin(t)
	m := &Manager{Data: t.TempDir()}
	ws, err := m.Prepare(ctx, Spec{Name: "thread-1", Repo: origin, Branch: "agent/WEB-1-x", Teardown: "true"})
	if err != nil {
		t.Fatal(err)
	}
	if !ws.Created || !ws.Repo || ws.StartHead == "" || ws.Temporary {
		t.Fatalf("%+v", ws)
	}
	if got := sh(t, ws.Dir, "branch", "--show-current"); got != "agent/WEB-1-x" {
		t.Fatalf("branch %s", got)
	}
	// the agent commits and pushes with plain `git push`
	os.WriteFile(filepath.Join(ws.Dir, "a.txt"), []byte("a"), 0o644)
	sh(t, ws.Dir, "add", ".")
	sh(t, ws.Dir, "commit", "--quiet", "-m", "work")
	sh(t, ws.Dir, "push", "--quiet")
	if m.Head(ctx, ws) == ws.StartHead {
		t.Fatal("head did not move")
	}
	if sh(t, origin, "rev-parse", "agent/WEB-1-x") != m.Head(ctx, ws) {
		t.Fatal("not pushed")
	}

	again, err := m.Prepare(ctx, Spec{Name: "thread-1", Repo: origin, Branch: "agent/WEB-1-x"})
	if err != nil || again.Created || again.Dir != ws.Dir || again.StartHead != m.Head(ctx, ws) {
		t.Fatalf("reuse %+v %v", again, err)
	}
	// a strand that comes to a runner starts from the pushed branch
	pushed := m.Head(ctx, ws)
	if err := m.Remove(ctx, ws.Dir, nil); err != nil {
		t.Fatal(err)
	}
	moved, err := m.Prepare(ctx, Spec{Name: "thread-2", Repo: origin, Branch: "agent/WEB-1-x"})
	if err != nil || moved.StartHead != pushed {
		t.Fatalf("moved %+v %v", moved, err)
	}
	cfg, _ := os.ReadFile(filepath.Join(m.mirror(origin), "config"))
	if strings.Contains(string(cfg), "token") {
		t.Fatal("a token in the config")
	}
}

func TestReviewWorktreeAndSweep(t *testing.T) {
	ctx := context.Background()
	origin := Origin(t)
	head := sh(t, origin, "rev-parse", "HEAD")
	m := &Manager{Data: t.TempDir()}
	ws, err := m.Prepare(ctx, Spec{Name: "run-01x", Repo: origin, Head: head, Teardown: "echo bye"})
	if err != nil || !ws.Temporary || ws.StartHead != head {
		t.Fatalf("%+v %v", ws, err)
	}
	var tore []string
	if err := m.Remove(ctx, ws.Dir, func(_ context.Context, dir, cmd string) { tore = append(tore, cmd) }); err != nil {
		t.Fatal(err)
	}
	if _, err := os.Stat(ws.Dir); !os.IsNotExist(err) || len(tore) != 1 || tore[0] != "echo bye" {
		t.Fatalf("not removed: %v %v", err, tore)
	}

	old, _ := m.Prepare(ctx, Spec{Name: "old", Repo: origin, Branch: "b1"})
	busy, _ := m.Prepare(ctx, Spec{Name: "busy", Repo: origin, Branch: "b2"})
	plain, _ := m.Prepare(ctx, Spec{Name: "plain"})
	if !plain.Created || plain.Repo {
		t.Fatalf("plain %+v", plain)
	}
	removed := m.Sweep(ctx, -time.Second, map[string]bool{"busy": true}, nil)
	if len(removed) != 2 {
		t.Fatalf("removed %v", removed)
	}
	if _, err := os.Stat(old.Dir); !os.IsNotExist(err) {
		t.Fatal("old stays")
	}
	if _, err := os.Stat(busy.Dir); err != nil {
		t.Fatal("busy went")
	}
	if len(m.Sweep(ctx, time.Hour, nil, nil)) != 0 {
		t.Fatal("fresh went")
	}
}

func TestEnv(t *testing.T) {
	if Env("") != nil {
		t.Fatal("no token, no env")
	}
	env := strings.Join(Env("ghs_x"), "\n")
	if !strings.Contains(env, "GH_TOKEN=ghs_x") || !strings.Contains(env, "credential.helper") {
		t.Fatal(env)
	}
	if strings.Count(env, "ghs_x") != 2 {
		t.Fatal("the token only in the two variables")
	}
}

func TestNamesAndRefs(t *testing.T) {
	for in, want := range map[string]string{"01abc": "01abc", "run-01x": "run-01x", "a b/c": "a-b-c"} {
		if got, err := Name(in); err != nil || got != want {
			t.Errorf("%q: %q %v", in, got, err)
		}
	}
	for _, bad := range []string{"", ".", "..", "-x", "/x", strings.Repeat("a", 200)} {
		if _, err := Name(bad); err == nil {
			t.Errorf("%q accepted", bad)
		}
	}
	ctx := context.Background()
	origin := Origin(t)
	m := &Manager{Data: t.TempDir()}
	for _, s := range []Spec{
		{Name: "x", Repo: origin, Branch: "-fdangerous"},
		{Name: "x", Repo: origin, Branch: "a..b"},
		{Name: "x", Repo: origin, Base: "--upload-pack=evil"},
		{Name: "x", Repo: origin, Head: "--output=/tmp/x"},
		{Name: "..", Repo: origin},
	} {
		if _, err := m.Prepare(ctx, s); err == nil {
			t.Errorf("%+v accepted", s)
		}
	}
	if _, err := m.Prepare(ctx, Spec{Name: "x", Repo: "--upload-pack=touch /tmp/pwned"}); err == nil {
		t.Error("an option as repository accepted")
	}
}

func TestParallelPrepareOnOneMirror(t *testing.T) {
	ctx := context.Background()
	origin := Origin(t)
	m := &Manager{Data: t.TempDir()}
	var wg sync.WaitGroup
	errs := make(chan error, 6)
	for i := 0; i < 6; i++ {
		wg.Add(1)
		go func(i int) {
			defer wg.Done()
			spec := Spec{Name: fmt.Sprintf("t-%d", i), Repo: origin, Branch: fmt.Sprintf("b%d", i)}
			if i%2 == 0 {
				spec = Spec{Name: fmt.Sprintf("run-%d", i), Repo: origin}
			}
			ws, err := m.Prepare(ctx, spec)
			if err == nil && i%3 == 0 {
				err = m.Remove(ctx, ws.Dir, nil)
			}
			errs <- err
		}(i)
	}
	wg.Wait()
	close(errs)
	for err := range errs {
		if err != nil {
			t.Fatal(err)
		}
	}
}

func TestContextOfLightRuns(t *testing.T) {
	ctx := context.Background()
	origin := Origin(t)
	sh(t, origin, "checkout", "--quiet", "-b", "feature")
	os.WriteFile(filepath.Join(origin, "new.txt"), []byte("a change\n"), 0o644)
	sh(t, origin, "add", ".")
	sh(t, origin, "commit", "--quiet", "-m", "the change of the pull request")
	head := sh(t, origin, "rev-parse", "HEAD")
	sh(t, origin, "checkout", "--quiet", "main")
	m := &Manager{Data: t.TempDir()}
	ws, err := m.Prepare(ctx, Spec{Name: "run-r", Repo: origin, Head: head})
	if err != nil {
		t.Fatal(err)
	}
	files := m.Context(ctx, ws, "review", "")
	if !strings.Contains(files["pull-request.diff"], "+a change") || !strings.Contains(files["pull-request-log.txt"], "the change of the pull request") || strings.Contains(files["pull-request-log.txt"], "first") {
		t.Fatalf("%v", files)
	}
	strand, _ := m.Prepare(ctx, Spec{Name: "s", Repo: origin, Branch: "b"})
	files = m.Context(ctx, strand, "comment", "main")
	if !strings.Contains(files["git-log.txt"], "first") || !strings.Contains(files["git-status.txt"], "On branch b") {
		t.Fatalf("%v", files)
	}
	plain, _ := m.Prepare(ctx, Spec{Name: "plain"})
	if m.Context(ctx, plain, "comment", "") != nil {
		t.Fatal("no repository, no context")
	}
}
