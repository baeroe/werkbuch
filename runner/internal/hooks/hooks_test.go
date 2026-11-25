package hooks

import (
	"context"
	"os"
	"path/filepath"
	"testing"
)

func TestRun(t *testing.T) {
	dir := t.TempDir()
	out, err := Run(context.Background(), dir, `echo "$X" > done; echo ok`, []string{"X=hello"})
	data, _ := os.ReadFile(filepath.Join(dir, "done"))
	if err != nil || out != "ok" || string(data) != "hello\n" {
		t.Fatalf("%q %v %q", out, err, data)
	}
	if _, err := Run(context.Background(), dir, "echo broken; exit 3", nil); err == nil {
		t.Fatal("exit 3 is an error")
	}
}

func TestACommandSeesTheWorktree(t *testing.T) {
	dir := filepath.Join(t.TempDir(), "01M8828WA31ERQVWS0ZGAVS3FQ")
	if err := os.Mkdir(dir, 0o700); err != nil {
		t.Fatal(err)
	}
	// a variable of the caller with the same name never wins
	out, err := Run(context.Background(), dir, `printf '%s|%s' "$WERKBUCH_WORKTREE" "$WERKBUCH_STRAND"`, []string{"WERKBUCH_STRAND=other"})
	if err != nil || out != dir+"|01m8828wa31erqvws0zgavs3fq" {
		t.Fatalf("%q %v", out, err)
	}
	t.Logf("the command saw %s", out)
}

func TestStrand(t *testing.T) {
	for dir, want := range map[string]string{
		"/data/worktrees/01m8828wa31erqvws0zgavs3fq": "01m8828wa31erqvws0zgavs3fq",
		"/data/worktrees/run-01ABC":                  "run-01abc",
		"/data/worktrees/thread-01x.y_z":             "thread-01x-y-z",
		"/data/worktrees/--A__b--":                   "a-b",
		"/data/worktrees/___":                        "worktree",
	} {
		if got := Strand(dir); got != want {
			t.Errorf("Strand(%q) = %q, want %q", dir, got, want)
		}
	}
}
