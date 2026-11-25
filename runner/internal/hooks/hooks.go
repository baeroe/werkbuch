// Package hooks runs the setup and teardown commands of a project (spec 8.4): set in werkbuch, sent with the claim, run
// with `sh -c` in the worktree after it was made and before it goes (for werkbuch: an own DDEV project per worktree).
// Both see WERKBUCH_WORKTREE, the absolute path of the worktree, and WERKBUCH_STRAND, its name as a project name: lower
// case letters, digits and `-` (A670).
package hooks

import (
	"bytes"
	"context"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"regexp"
	"strings"
	"syscall"
	"time"
)

// Timeout bounds one command.
const Timeout = 15 * time.Minute

var notInName = regexp.MustCompile(`[^a-z0-9]+`)

// Strand is the name of the worktree in dir as a project name (DDEV and the like): lower case, every run of other
// characters one `-`, none at the ends; "worktree" when nothing is left.
func Strand(dir string) string {
	name := strings.Trim(notInName.ReplaceAllString(strings.ToLower(filepath.Base(dir)), "-"), "-")
	if name == "" {
		return "worktree"
	}
	return name
}

// Vars are the variables a command gets for the worktree in dir.
func Vars(dir string) []string {
	abs, err := filepath.Abs(dir)
	if err != nil {
		abs = dir
	}
	return []string{"WERKBUCH_WORKTREE=" + abs, "WERKBUCH_STRAND=" + Strand(dir)}
}

// Run runs command in dir with env (and the variables of the worktree) and returns the end of its output.
func Run(ctx context.Context, dir, command string, env []string) (string, error) {
	ctx, cancel := context.WithTimeout(ctx, Timeout)
	defer cancel()
	cmd := exec.CommandContext(ctx, "sh", "-c", command)
	// its own group: a cancel ends the command and everything it started
	cmd.SysProcAttr = &syscall.SysProcAttr{Setpgid: true}
	cmd.Cancel = func() error { return syscall.Kill(-cmd.Process.Pid, syscall.SIGKILL) }
	cmd.WaitDelay = 2 * time.Second
	cmd.Dir = dir
	cmd.Env = append(append(os.Environ(), env...), Vars(dir)...)
	var out bytes.Buffer
	cmd.Stdout, cmd.Stderr = &out, &out
	err := cmd.Run()
	text := strings.TrimSpace(out.String())
	if len(text) > 2000 {
		text = "…" + text[len(text)-2000:]
	}
	if err != nil {
		return text, fmt.Errorf("%v: %s", err, text)
	}
	return text, nil
}
