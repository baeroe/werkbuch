// Package adapters is the seam between a run and an agent CLI (spec 8.1): an adapter builds the call of its CLI and
// reads its output (stream-json, JSONL) into events of the log, the session, the usage and the answer.
package adapters

import (
	"encoding/json"
	"os/exec"
	"strings"
	"unicode/utf8"

	"github.com/baeroe/werkbuch/runner/internal/protocol"
)

// Job is what an adapter needs to start a run.
type Job struct {
	Run    protocol.Run
	Binary string // the path of the CLI
	Dir    string // the working folder (worktree or folder of the strand)
	// MCPConfig is the file with the server `werkbuch-run` (Claude Code); Codex takes the token from TokenEnv.
	MCPConfig string
	// TokenEnv is the environment variable holding the run token for CLIs that read it from there.
	TokenEnv string
}

// Outcome is what the output of a run told.
type Outcome struct {
	SessionID string
	Usage     *protocol.Usage
	Answer    string // the last answer of the agent (summary, findings, reply)
	IsError   bool
	Error     string
	// Werkbuch lists MCP servers other than werkbuch-run that offered werkbuch's tools (A492).
	Werkbuch []string
}

// Stream reads the output of one run line by line.
type Stream interface {
	// Feed reads one line of standard output and returns the events it makes.
	Feed(line []byte) []protocol.Event
	// Outcome is what the lines told so far.
	Outcome() Outcome
}

// Adapter knows one CLI.
type Adapter interface {
	Name() string
	// Command builds the call; the prompt goes to its standard input.
	Command(job Job) *exec.Cmd
	// Stream starts reading the output of a run.
	Stream() Stream
}

// For returns the adapter of a CLI, nil for one the runner does not know.
func For(cli string) Adapter {
	if a, ok := registry[cli]; ok {
		return a
	}
	return nil
}

var registry = map[string]Adapter{}

// Register adds an adapter (from the init of its package).
func Register(a Adapter) { registry[a.Name()] = a }

// Cut shortens text to max runes (werkbuch keeps at most protocol.EventTextMax per line).
func Cut(text string, max int) string {
	if utf8.RuneCountInString(text) <= max {
		return text
	}
	runes := []rune(text)
	return string(runes[:max-1]) + "…"
}

// ToolLine is the readable line of a tool call: its name and the one argument that says what it does.
func ToolLine(name string, input json.RawMessage) string {
	var fields map[string]any
	_ = json.Unmarshal(input, &fields)
	for _, key := range []string{"command", "file_path", "path", "pattern", "url", "query", "description"} {
		if v, ok := fields[key].(string); ok && v != "" {
			return Cut(name+": "+strings.TrimSpace(v), 300)
		}
	}
	if len(input) > 0 && string(input) != "{}" && string(input) != "null" {
		return Cut(name+" "+string(input), 300)
	}
	return name
}

// Werkbuch says whether a tool is one of werkbuch's (its MCP server offers `manage-work-items`), as name of an MCP tool
// `mcp__<server>__<tool>`; it returns the server.
func Werkbuch(tool string) (string, bool) {
	if !strings.HasPrefix(tool, "mcp__") {
		return "", false
	}
	rest := strings.TrimPrefix(tool, "mcp__")
	i := strings.Index(rest, "__")
	if i <= 0 {
		return "", false
	}
	server, name := rest[:i], rest[i+2:]
	if name == "manage-work-items" || strings.HasSuffix(name, "_manage-work-items") {
		return server, true
	}
	return "", false
}
