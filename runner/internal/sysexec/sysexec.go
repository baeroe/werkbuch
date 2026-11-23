// Package sysexec runs short system commands (`ioreg`, `claude --version`, `claude mcp list`) with a time limit; tests
// swap Run for a fake.
package sysexec

import (
	"context"
	"os/exec"
	"time"
)

// Func runs a command and returns its standard output.
type Func func(ctx context.Context, name string, args ...string) ([]byte, error)

// Run is the real one: at most 15 seconds, standard error dropped.
func Run(ctx context.Context, name string, args ...string) ([]byte, error) {
	ctx, cancel := context.WithTimeout(ctx, 15*time.Second)
	defer cancel()
	return exec.CommandContext(ctx, name, args...).Output()
}
