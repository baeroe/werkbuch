package mcpconfig

import (
	"encoding/json"
	"os"
	"testing"

	"github.com/baeroe/werkbuch/runner/internal/protocol"
)

func TestWrite(t *testing.T) {
	var r protocol.Run
	r.Werkbuch.MCPURL, r.Werkbuch.Token = "https://werkbuch.example.com/mcp", "tok"
	f, err := Write(r)
	if err != nil {
		t.Fatal(err)
	}
	dir, _ := os.Stat(f.Dir)
	file, _ := os.Stat(f.Path)
	if dir.Mode().Perm() != 0o700 || file.Mode().Perm() != 0o600 {
		t.Fatalf("modes %v %v", dir.Mode(), file.Mode())
	}
	var body struct {
		MCPServers map[string]struct {
			Type    string            `json:"type"`
			URL     string            `json:"url"`
			Headers map[string]string `json:"headers"`
		} `json:"mcpServers"`
	}
	data, _ := os.ReadFile(f.Path)
	json.Unmarshal(data, &body)
	s := body.MCPServers["werkbuch-run"]
	if s.Type != "http" || s.URL != r.Werkbuch.MCPURL || s.Headers["Authorization"] != "Bearer tok" || len(body.MCPServers) != 1 {
		t.Fatalf("%s", data)
	}
	f.Remove()
	if _, err := os.Stat(f.Dir); !os.IsNotExist(err) {
		t.Fatal("not removed")
	}
}
