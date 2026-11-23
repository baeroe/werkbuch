// Package hooks runs the setup and teardown commands of a project (spec 8.4): set in werkbuch, sent with the claim, run
// with `sh -c` in the worktree after it was made and before it goes (for werkbuch: an own DDEV project per worktree).
package hooks

import (
	"bytes"
	"context"
	"fmt"
	"os"
	"os/exec"
	"strings"
	"time"
)

// Timeout bounds one command.
const Timeout = 15 * time.Minute

// Run runs command in dir with env and returns the end of its output.
func Run(ctx context.Context, dir, command string, env []string) (string, error) {
	ctx, cancel := context.WithTimeout(ctx, Timeout)
	defer cancel()
	cmd := exec.CommandContext(ctx, "sh", "-c", command)
	cmd.Dir = dir
	cmd.Env = append(os.Environ(), env...)
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
