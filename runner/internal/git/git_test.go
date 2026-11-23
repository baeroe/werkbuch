package git

import (
	"context"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
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
