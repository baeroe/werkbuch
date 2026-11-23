package claude

import (
	"io"
	"slices"
	"strings"
	"testing"

	"github.com/baeroe/werkbuch/runner/internal/adapters"
	"github.com/baeroe/werkbuch/runner/internal/protocol"
)

func job(kind string, session *string) adapters.Job {
	var r protocol.Run
	r.Type, r.Model, r.Prompt, r.SystemPrompt = kind, "haiku", "do it", "contract"
	r.Thread = &protocol.Thread{ID: "t", SessionID: session}
	return adapters.Job{Run: r, Binary: "/bin/claude", Dir: "/w", MCPConfig: "/tmp/x/mcp.json"}
}

func TestArgs(t *testing.T) {
	id := "sess-1"
	args := Args(job("correction", &id))
	for _, want := range [][]string{{"--model", "haiku"}, {"--mcp-config", "/tmp/x/mcp.json"}, {"--resume", "sess-1"}, {"--append-system-prompt", "contract"}, {"--output-format", "stream-json"}} {
		i := slices.Index(args, want[0])
		if i < 0 || args[i+1] != want[1] {
			t.Fatalf("%v lacks %v", args, want)
		}
	}
	if args[slices.Index(args, "--permission-mode")+1] != "bypassPermissions" || slices.Contains(args, "--allowedTools") {
		t.Fatalf("a code run bypasses the prompts: %v", args)
	}
	light := Args(job("review", nil))
	if light[slices.Index(light, "--permission-mode")+1] != "dontAsk" || slices.Contains(light, "bypassPermissions") {
		t.Fatalf("light %v", light)
	}
	if allowed := light[slices.Index(light, "--allowedTools")+1]; allowed != "Read,Grep,Glob,mcp__werkbuch-run__*" {
		t.Fatalf("allowed %q", allowed)
	}
	if light[slices.Index(light, "--disallowedTools")+1] != "Bash,Write,Edit,MultiEdit,NotebookEdit" {
		t.Fatalf("%v", light)
	}
	if i := slices.Index(light, "--setting-sources"); i < 0 || light[i+1] != "user" {
		t.Fatalf("a light run reads no settings of the repository: %v", light)
	}
	if slices.Contains(args, "--setting-sources") {
		t.Fatalf("a code run keeps the settings of its repository: %v", args)
	}
	jr := job("review", nil)
	jr.Private = "/tmp/werkbuch-run-1"
	if withDir := Args(jr); withDir[slices.Index(withDir, "--add-dir")+1] != "/tmp/werkbuch-run-1" {
		t.Fatalf("the prepared context is readable: %v", withDir)
	}
	j := job("task", nil)
	j.SystemPromptFile = "/tmp/x/system-prompt.md"
	withFile := Args(j)
	if withFile[slices.Index(withFile, "--append-system-prompt-file")+1] != "/tmp/x/system-prompt.md" || slices.Contains(withFile, "--append-system-prompt") {
		t.Fatalf("file %v", withFile)
	}
	if slices.Contains(args, "--strict-mcp-config") {
		t.Fatal("the machine's servers stay (spec 8.1)")
	}
	if slices.Contains(Args(job("review", &id)), "--resume") {
		t.Fatal("a review never resumes")
	}
	if slices.Contains(Args(job("task", nil)), "--resume") {
		t.Fatal("no session, no resume")
	}
	cmd := Adapter{}.Command(job("task", nil))
	in, _ := io.ReadAll(cmd.Stdin)
	if cmd.Dir != "/w" || string(in) != "do it" || cmd.Path != "/bin/claude" {
		t.Fatalf("cmd %v %q", cmd, in)
	}
	if adapters.For("claude") == nil || adapters.For("nope") != nil {
		t.Fatal("registry")
	}
}

const sample = `{"type":"system","subtype":"init","session_id":"s-42","model":"claude-haiku","tools":["Bash","mcp__werkbuch-run__manage-work-items","mcp__skilltri__werkbuch_manage-work-items","mcp__skilltri__werkbuch_whoami"],"mcp_servers":[{"name":"werkbuch-run","status":"failed"}]}
not json at all
{"type":"assistant","message":{"content":[{"type":"text","text":"Reading WEBU-1"},{"type":"tool_use","name":"Bash","input":{"command":"git status"}},{"type":"tool_use","name":"mcp__werkbuch-run__work-items","input":{"action":"get"}}]}}
{"type":"user","message":{"content":[{"type":"tool_result","is_error":true,"content":"exit 1"},{"type":"tool_result","content":[{"type":"text","text":"fine"}]}]}}
{"type":"result","subtype":"success","is_error":false,"result":"Done: added a test.","session_id":"s-42","usage":{"input_tokens":10,"cache_read_input_tokens":5,"cache_creation_input_tokens":1,"output_tokens":7}}
`

func TestStream(t *testing.T) {
	s := Adapter{}.Stream()
	var kinds, texts []string
	for _, l := range strings.Split(sample, "\n") {
		for _, e := range s.Feed([]byte(l)) {
			kinds = append(kinds, e.Kind)
			texts = append(texts, e.Text)
		}
	}
	want := []string{"system", "error", "error", "system", "text", "tool", "tool", "error", "result"}
	if !slices.Equal(kinds, want) {
		t.Fatalf("kinds %v\n%v", kinds, texts)
	}
	if texts[5] != "Bash: git status" || !strings.Contains(texts[2], "skilltri") {
		t.Fatalf("texts %v", texts)
	}
	o := s.Outcome()
	if o.SessionID != "s-42" || o.Answer != "Done: added a test." || o.IsError || o.Usage.Input != 16 || o.Usage.Output != 7 || !slices.Equal(o.Werkbuch, []string{"skilltri"}) {
		t.Fatalf("outcome %+v", o)
	}
}

func TestStreamError(t *testing.T) {
	s := Adapter{}.Stream()
	s.Feed([]byte(`{"type":"result","subtype":"error_max_turns","is_error":true}`))
	if o := s.Outcome(); !o.IsError || o.Error != "error_max_turns" {
		t.Fatalf("%+v", o)
	}
}
