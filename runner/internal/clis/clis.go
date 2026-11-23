// Package clis finds the agent CLIs of the machine (spec 8.8): installed (path in PATH), version, signed in. werkbuch
// hands a run only to a runner that reports its CLI installed and signed in. The sign-in is asked at most every
// minute (Detector caches it), `doctor` asks afresh.
package clis

import (
	"context"
	"encoding/json"
	"os/exec"
	"regexp"
	"strings"
	"sync"
	"time"

	"github.com/baeroe/werkbuch/runner/internal/protocol"
	"github.com/baeroe/werkbuch/runner/internal/sysexec"
)

// Names are the CLIs werkbuch knows (App\Domain\Agents\AgentCli).
var Names = []string{"claude", "codex"}

// CacheFor is how long a detection holds.
const CacheFor = time.Minute

var versionRe = regexp.MustCompile(`\d+\.\d+(\.\d+)?[\w.+-]*`)

// Version reads the version out of the first line of `--version`.
func Version(out string) string {
	line := strings.TrimSpace(strings.SplitN(strings.TrimSpace(out), "\n", 2)[0])
	if m := versionRe.FindString(line); m != "" {
		return m
	}
	if len(line) > 64 {
		line = line[:64]
	}
	return line
}

// Detect finds one CLI.
func Detect(ctx context.Context, name string, run sysexec.Func) protocol.CLI {
	c := protocol.CLI{CLI: name}
	path, err := exec.LookPath(name)
	if err != nil {
		return c
	}
	c.Installed = true
	c.Path = &path
	if out, err := run(ctx, path, "--version"); err == nil {
		v := Version(string(out))
		if v != "" {
			c.Version = &v
		}
	}
	c.LoggedIn = loggedIn(ctx, name, path, run)
	return c
}

func loggedIn(ctx context.Context, name, path string, run sysexec.Func) bool {
	switch name {
	case "claude":
		out, err := run(ctx, path, "auth", "status", "--json")
		if err != nil {
			return false
		}
		var status struct {
			LoggedIn bool `json:"loggedIn"`
		}
		return json.Unmarshal(out, &status) == nil && status.LoggedIn
	case "codex":
		// `codex login status` ends with 0 only when signed in
		_, err := run(ctx, path, "login", "status")
		return err == nil
	}
	return false
}

// Detector caches the detection of all CLIs.
type Detector struct {
	Run  sysexec.Func
	mu   sync.Mutex
	at   time.Time
	last []protocol.CLI
}

// All returns every CLI of Names, detected at most every CacheFor unless fresh is set.
func (d *Detector) All(ctx context.Context, fresh bool) []protocol.CLI {
	d.mu.Lock()
	defer d.mu.Unlock()
	if !fresh && d.last != nil && time.Since(d.at) < CacheFor {
		return append([]protocol.CLI(nil), d.last...)
	}
	out := make([]protocol.CLI, 0, len(Names))
	for _, n := range Names {
		out = append(out, Detect(ctx, n, d.Run))
	}
	d.last, d.at = out, time.Now()
	return append([]protocol.CLI(nil), out...)
}
