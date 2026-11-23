package codex

import (
	"io"
	"slices"
	"strings"
	"testing"

	"github.com/baeroe/werkbuch/runner/internal/adapters"
	"github.com/baeroe/werkbuch/runner/internal/protocol"
)

func TestArgsAndPrompt(t *testing.T) {
	var r protocol.Run
	r.Type, r.Model, r.Prompt, r.SystemPrompt = "comment", "gpt-5-codex", "answer", "contract"
	r.Werkbuch.MCPURL, r.Werkbuch.Token = "https://werkbuch.example.com/mcp", "01abc|wb_secretsecretsecretsecretsecret"
	sess := "th-1"
	r.Thread = &protocol.Thread{ID: "t", SessionID: &sess}
	j := adapters.Job{Run: r, Binary: "/bin/codex", Dir: "/w", TokenEnv: "WERKBUCH_RUN_TOKEN"}
	args := Args(j)
	joined := strings.Join(args, " ")
	if !strings.Contains(joined, "-m gpt-5-codex") || !strings.Contains(joined, `bearer_token_env_var="WERKBUCH_RUN_TOKEN"`) || !strings.HasSuffix(joined, "resume th-1 -") {
		t.Fatalf("args %v", args)
	}
	if !strings.Contains(joined, "--sandbox read-only") || strings.Contains(joined, "dangerously") {
		t.Fatalf("a comment runs read-only: %v", args)
	}
	if !strings.Contains(joined, `projects."/w".trust_level="untrusted"`) {
		t.Fatalf("the working folder stays untrusted: %v", args)
	}
	r.Type = "task"
	if task := strings.Join(Args(adapters.Job{Run: r, TokenEnv: "T", Dir: "/w"}), " "); !strings.Contains(task, "dangerously-bypass") || strings.Contains(task, "read-only") || strings.Contains(task, "untrusted") {
		t.Fatalf("task %v", task)
	}
	r.Type = "comment"
	if strings.Contains(joined, "secret") {
		t.Fatal("token in the arguments")
	}
	cmd := Adapter{}.Command(j)
	in, _ := io.ReadAll(cmd.Stdin)
	if !strings.HasPrefix(string(in), "contract") || !strings.HasSuffix(string(in), "answer") {
		t.Fatalf("prompt %q", in)
	}
	r.SystemPrompt = ""
	if Prompt(r) != "answer" {
		t.Fatal("plain prompt")
	}
}

const sample = `{"type":"thread.started","thread_id":"th-9"}
{"type":"item.completed","item":{"type":"command_execution","command":"go test ./...","exit_code":1}}
{"type":"item.completed","item":{"type":"mcp_tool_call","server":"skilltri","tool":"werkbuch_manage-work-items"}}
{"type":"item.completed","item":{"type":"file_change","changes":[{"path":"a.go"}]}}
{"type":"item.completed","item":{"type":"agent_message","text":"Verdict: approve"}}
{"type":"turn.completed","usage":{"input_tokens":3,"cached_input_tokens":2,"output_tokens":4}}
garbage`

func TestStream(t *testing.T) {
	s := Adapter{}.Stream()
	var kinds []string
	for _, l := range strings.Split(sample, "\n") {
		for _, e := range s.Feed([]byte(l)) {
			kinds = append(kinds, e.Kind)
		}
	}
	if !slices.Equal(kinds, []string{"system", "tool", "tool", "tool", "text", "result", "system"}) {
		t.Fatalf("kinds %v", kinds)
	}
	o := s.Outcome()
	if o.SessionID != "th-9" || o.Answer != "Verdict: approve" || o.Usage.Input != 5 || o.Usage.Output != 4 || !slices.Equal(o.Werkbuch, []string{"skilltri"}) {
		t.Fatalf("%+v", o)
	}
	s.Feed([]byte(`{"type":"turn.failed","error":{"message":"model not found"}}`))
	if o := s.Outcome(); !o.IsError || o.Error != "model not found" {
		t.Fatalf("%+v", o)
	}
}
