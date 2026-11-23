package equipment

import (
	"context"
	"errors"
	"os"
	"path/filepath"
	"reflect"
	"testing"
)

const claudeList = `Checking MCP server health…

claude.ai Claude Docs: https://api.example.com/v1/pages/mcp - ✔ Connected
werkbuch: https://werkbuch.example.com/mcp (HTTP) - ✔ Connected
playwright: npx @playwright/mcp - ✗ Failed to connect
`

func TestParseClaude(t *testing.T) {
	got := ParseClaude(claudeList)
	want := []Server{{"claude.ai Claude Docs", "https://api.example.com/v1/pages/mcp"}, {"werkbuch", "https://werkbuch.example.com/mcp (HTTP)"}, {"playwright", "npx @playwright/mcp"}}
	if !reflect.DeepEqual(got, want) {
		t.Fatalf("%+v", got)
	}
	if !Reaches(got[1], "werkbuch.example.com") || Reaches(got[0], "werkbuch.example.com") || Reaches(Server{RunServer, "https://werkbuch.example.com/mcp"}, "werkbuch.example.com") {
		t.Fatal("reaches")
	}
}

func TestParseCodex(t *testing.T) {
	got := ParseCodex([]byte(`[{"name":"docs","transport":{"type":"streamable_http","url":"https://werkbuch.example.com/mcp"}},{"transport":{}}]`))
	if len(got) != 1 || got[0].Name != "docs" || !Reaches(got[0], "werkbuch.example.com") {
		t.Fatalf("%+v", got)
	}
	if ParseCodex([]byte("not json")) != nil {
		t.Fatal("junk")
	}
}

func TestCollect(t *testing.T) {
	dir := t.TempDir()
	os.MkdirAll(filepath.Join(dir, "skills", "proof"), 0o755)
	os.WriteFile(filepath.Join(dir, "skills", "proof", "SKILL.md"), []byte("x"), 0o644)
	os.MkdirAll(filepath.Join(dir, "skills", "empty"), 0o755)
	os.MkdirAll(filepath.Join(dir, "plugins"), 0o755)
	os.WriteFile(filepath.Join(dir, "plugins", "installed_plugins.json"), []byte(`{"version":2,"plugins":{"superpowers@official":[],"lsp@official":[]}}`), 0o644)
	calls := 0
	c := &Collector{Host: "werkbuch.example.com", ClaudeDir: dir, Run: func(ctx context.Context, name string, args ...string) ([]byte, error) {
		calls++
		if name == "claude" {
			return []byte(claudeList), nil
		}
		return nil, errors.New("no codex")
	}}
	eq := c.Collect(context.Background(), false)
	if !reflect.DeepEqual(eq.MCPServers, []string{"claude.ai Claude Docs", "playwright", "werkbuch"}) ||
		!reflect.DeepEqual(eq.Skills, []string{"proof"}) ||
		!reflect.DeepEqual(eq.Plugins, []string{"lsp", "superpowers"}) ||
		!reflect.DeepEqual(eq.WerkbuchAccess, []string{"werkbuch"}) {
		t.Fatalf("%+v", eq)
	}
	n := calls
	c.Collect(context.Background(), false)
	if calls != n {
		t.Fatal("not cached")
	}
	c.Seen("skilltri")
	eq = c.Collect(context.Background(), false)
	if !reflect.DeepEqual(eq.WerkbuchAccess, []string{"skilltri", "werkbuch"}) {
		t.Fatalf("seen %+v", eq.WerkbuchAccess)
	}
}
