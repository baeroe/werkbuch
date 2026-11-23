// Package claude runs Claude Code headless (spec 7.8): `claude -p --output-format stream-json --verbose`, the prompt on
// standard input, the contract appended to the system prompt, `--model`, `--resume <session>`, the server
// `werkbuch-run` through `--mcp-config` in addition to the machine's own servers (no `--strict-mcp-config`, spec 8.1,
// 8.7), and `--permission-mode bypassPermissions` for an unattended run (A490).
package claude

import (
	"encoding/json"
	"os/exec"
	"strings"
	"time"

	"github.com/baeroe/werkbuch/runner/internal/adapters"
	"github.com/baeroe/werkbuch/runner/internal/protocol"
)

func init() { adapters.Register(Adapter{}) }

// Adapter is Claude Code.
type Adapter struct{}

func (Adapter) Name() string { return "claude" }

// Args are the arguments of a run.
func Args(job adapters.Job) []string {
	args := []string{"-p", "--output-format", "stream-json", "--verbose", "--permission-mode", "bypassPermissions"}
	if job.Run.Model != "" {
		args = append(args, "--model", job.Run.Model)
	}
	if job.MCPConfig != "" {
		args = append(args, "--mcp-config", job.MCPConfig)
	}
	if job.Run.SystemPrompt != "" {
		args = append(args, "--append-system-prompt", job.Run.SystemPrompt)
	}
	if id := job.Run.SessionID(); id != "" {
		args = append(args, "--resume", id)
	}
	return args
}

func (a Adapter) Command(job adapters.Job) *exec.Cmd {
	cmd := exec.Command(job.Binary, Args(job)...)
	cmd.Dir = job.Dir
	cmd.Stdin = strings.NewReader(job.Run.Prompt)
	return cmd
}

func (Adapter) Stream() adapters.Stream { return &stream{} }

type stream struct{ out adapters.Outcome }

type block struct {
	Type    string          `json:"type"`
	Text    string          `json:"text"`
	Name    string          `json:"name"`
	Input   json.RawMessage `json:"input"`
	IsError bool            `json:"is_error"`
	Content json.RawMessage `json:"content"`
}

type line struct {
	Type       string   `json:"type"`
	Subtype    string   `json:"subtype"`
	SessionID  string   `json:"session_id"`
	Model      string   `json:"model"`
	Tools      []string `json:"tools"`
	MCPServers []struct {
		Name   string `json:"name"`
		Status string `json:"status"`
	} `json:"mcp_servers"`
	Message struct {
		Content []block `json:"content"`
	} `json:"message"`
	Result  string `json:"result"`
	IsError bool   `json:"is_error"`
	Usage   *struct {
		Input         int `json:"input_tokens"`
		Output        int `json:"output_tokens"`
		CacheRead     int `json:"cache_read_input_tokens"`
		CacheCreation int `json:"cache_creation_input_tokens"`
	} `json:"usage"`
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
	if l.SessionID != "" {
		s.out.SessionID = l.SessionID
	}
	var events []protocol.Event
	switch l.Type {
	case "system":
		if l.Subtype != "init" {
			return nil
		}
		text := "session started"
		if l.Model != "" {
			text += " with " + l.Model
		}
		events = append(events, ev(protocol.KindSystem, text))
		for _, server := range l.MCPServers {
			if server.Name == "werkbuch-run" && server.Status != "connected" {
				events = append(events, ev(protocol.KindError, "MCP server werkbuch-run: "+server.Status))
			}
		}
		seen := map[string]bool{}
		for _, tool := range l.Tools {
			if server, ok := adapters.Werkbuch(tool); ok && server != "werkbuch-run" && !seen[server] {
				seen[server] = true
				s.out.Werkbuch = append(s.out.Werkbuch, server)
				events = append(events, ev(protocol.KindError, "MCP server "+server+" reaches werkbuch past the run token; switch it off for the runner"))
			}
		}
	case "assistant":
		for _, b := range l.Message.Content {
			switch b.Type {
			case "text":
				if t := strings.TrimSpace(b.Text); t != "" {
					events = append(events, ev(protocol.KindText, t))
					s.out.Answer = t
				}
			case "tool_use":
				events = append(events, ev(protocol.KindTool, adapters.ToolLine(b.Name, b.Input)))
			}
		}
	case "user":
		for _, b := range l.Message.Content {
			if b.Type == "tool_result" && b.IsError {
				events = append(events, ev(protocol.KindError, adapters.Cut(contentText(b.Content), 500)))
			}
		}
	case "result":
		if l.Usage != nil {
			s.out.Usage = &protocol.Usage{Input: l.Usage.Input + l.Usage.CacheRead + l.Usage.CacheCreation, Output: l.Usage.Output}
		}
		if t := strings.TrimSpace(l.Result); t != "" {
			s.out.Answer = t
		}
		if l.IsError || (l.Subtype != "" && l.Subtype != "success") {
			s.out.IsError = true
			s.out.Error = strings.TrimSpace(l.Result)
			if s.out.Error == "" {
				s.out.Error = l.Subtype
			}
			events = append(events, ev(protocol.KindError, s.out.Error))
		} else {
			events = append(events, ev(protocol.KindResult, s.out.Answer))
		}
	}
	return events
}

func contentText(raw json.RawMessage) string {
	var text string
	if json.Unmarshal(raw, &text) == nil {
		return text
	}
	var parts []block
	if json.Unmarshal(raw, &parts) == nil {
		var out []string
		for _, p := range parts {
			out = append(out, p.Text)
		}
		return strings.Join(out, "\n")
	}
	return string(raw)
}

func (s *stream) Outcome() adapters.Outcome { return s.out }
