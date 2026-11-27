// Package codex runs Codex headless (spec 7.8): `codex exec --json`, the prompt on standard input (`-`), `-m`, `resume
// <session>`, the server `werkbuch-run` through `-c mcp_servers.werkbuch-run.*` with the token in an environment
// variable (never an argument), in addition to the machine's servers (spec 8.1). Codex has no flag for a system prompt:
// the contract goes in front of the prompt (A494). Runs that change code bypass approvals and sandbox, light runs run in
// the read-only sandbox (A493).
package codex

import (
	"encoding/json"
	"os/exec"
	"strconv"
	"strings"
	"time"

	"github.com/baeroe/werkbuch/runner/internal/adapters"
	"github.com/baeroe/werkbuch/runner/internal/protocol"
)

func init() { adapters.Register(Adapter{}) }

// Adapter is Codex.
type Adapter struct{}

func (Adapter) Name() string { return "codex" }

// Args are the arguments of a run.
func Args(job adapters.Job) []string {
	args := []string{"exec", "--json", "--skip-git-repo-check"}
	if protocol.Light(job.Run.Type) {
		// read-only, and the working folder untrusted: Codex then ignores `.codex/` of the checked-out pull request
		// (project config, hooks, exec policies, A493)
		args = append(args, "--sandbox", "read-only")
		if job.Dir != "" {
			args = append(args, "-c", "projects."+strconv.Quote(job.Dir)+".trust_level=\"untrusted\"")
		}
	} else {
		args = append(args, "--dangerously-bypass-approvals-and-sandbox")
	}
	if job.Run.Model != "" {
		args = append(args, "-m", job.Run.Model)
	}
	if job.Run.Werkbuch.MCPURL != "" && job.TokenEnv != "" {
		args = append(args,
			"-c", "mcp_servers.werkbuch-run.url="+strconv.Quote(job.Run.Werkbuch.MCPURL),
			"-c", "mcp_servers.werkbuch-run.bearer_token_env_var="+strconv.Quote(job.TokenEnv))
	}
	if id := job.Run.SessionID(); id != "" {
		args = append(args, "resume", id)
	}
	return append(args, "-")
}

// Prompt is the contract, then the prompt.
func Prompt(run protocol.Run) string {
	if run.SystemPrompt == "" {
		return run.Prompt
	}
	return run.SystemPrompt + "\n\n---\n\n" + run.Prompt
}

func (Adapter) Command(job adapters.Job) *exec.Cmd {
	cmd := exec.Command(job.Binary, Args(job)...)
	cmd.Dir = job.Dir
	cmd.Stdin = strings.NewReader(Prompt(job.Run))
	return cmd
}

func (Adapter) Stream() adapters.Stream { return &stream{} }

type stream struct{ out adapters.Outcome }

type line struct {
	Type     string `json:"type"`
	ThreadID string `json:"thread_id"`
	Message  string `json:"message"`
	Item     struct {
		Type     string          `json:"type"`
		Text     string          `json:"text"`
		Command  string          `json:"command"`
		ExitCode *int            `json:"exit_code"`
		Server   string          `json:"server"`
		Tool     string          `json:"tool"`
		Changes  json.RawMessage `json:"changes"`
		Message  string          `json:"message"`
	} `json:"item"`
	Usage *struct {
		Input  int `json:"input_tokens"`
		Cached int `json:"cached_input_tokens"`
		Output int `json:"output_tokens"`
	} `json:"usage"`
	Error *struct {
		Message string `json:"message"`
	} `json:"error"`
}

func ev(kind, text string) protocol.Event {
	return protocol.Event{Kind: kind, Text: adapters.Cut(text, protocol.EventTextMax), At: time.Now().UTC()}
}

func (s *stream) Feed(raw []byte) []protocol.Event {
	var l line
	if err := json.Unmarshal(raw, &l); err != nil || l.Type == "" {
		if t := strings.TrimSpace(string(raw)); t != "" {
			return []protocol.Event{ev(protocol.KindSystem, t)}
		}
		return nil
	}
	switch l.Type {
	case "thread.started":
		s.out.SessionID = l.ThreadID
		return []protocol.Event{ev(protocol.KindSystem, "session started")}
	case "item.completed":
		switch l.Item.Type {
		case "agent_message":
			s.out.Answer = strings.TrimSpace(l.Item.Text)
			return []protocol.Event{ev(protocol.KindText, s.out.Answer)}
		case "command_execution":
			text := "shell: " + l.Item.Command
			if l.Item.ExitCode != nil && *l.Item.ExitCode != 0 {
				text += " (exit " + strconv.Itoa(*l.Item.ExitCode) + ")"
			}
			return []protocol.Event{ev(protocol.KindTool, adapters.Cut(text, 300))}
		case "mcp_tool_call":
			if l.Item.Server != "werkbuch-run" && (l.Item.Tool == "manage-work-items" || strings.HasSuffix(l.Item.Tool, "_manage-work-items")) {
				s.out.Werkbuch = append(s.out.Werkbuch, l.Item.Server)
			}
			return []protocol.Event{ev(protocol.KindTool, l.Item.Server+": "+l.Item.Tool)}
		case "file_change":
			return []protocol.Event{ev(protocol.KindTool, adapters.Cut("files: "+string(l.Item.Changes), 300))}
		case "error":
			return []protocol.Event{ev(protocol.KindError, l.Item.Message)}
		}
	case "turn.completed":
		if l.Usage != nil {
			u := protocol.Usage{Input: l.Usage.Input + l.Usage.Cached, Output: l.Usage.Output}
			if s.out.Usage != nil {
				u.Input += s.out.Usage.Input
				u.Output += s.out.Usage.Output
			}
			s.out.Usage = &u
		}
		return []protocol.Event{ev(protocol.KindResult, s.out.Answer)}
	case "turn.failed", "error":
		msg := l.Message
		if l.Error != nil {
			msg = l.Error.Message
		}
		s.out.IsError, s.out.Error = true, msg
		return []protocol.Event{ev(protocol.KindError, msg)}
	}
	return nil
}

// Done is false: Codex ends its run itself (no background tasks wake its session).
func (s *stream) Done() bool { return false }

func (s *stream) Outcome() adapters.Outcome { return s.out }
