// Package mcpconfig writes the MCP configuration of one run (spec 8.1): the server `werkbuch-run` (`<APP_URL>/mcp`,
// bearer the run token) in a private temporary folder (0700, the file 0600), removed when the run ends. The CLI loads
// it in addition to the servers of the machine.
package mcpconfig

import (
	"encoding/json"
	"os"
	"path/filepath"

	"github.com/baeroe/werkbuch/runner/internal/protocol"
)

// File is the configuration of one run.
type File struct {
	Dir  string
	Path string
}

// Write creates the folder and the file for the run.
func Write(run protocol.Run) (*File, error) {
	dir, err := os.MkdirTemp("", "werkbuch-run-")
	if err != nil {
		return nil, err
	}
	if err := os.Chmod(dir, 0o700); err != nil {
		os.RemoveAll(dir)
		return nil, err
	}
	name := run.Werkbuch.ServerName
	if name == "" {
		name = "werkbuch-run"
	}
	body := map[string]any{"mcpServers": map[string]any{name: map[string]any{
		"type":    "http",
		"url":     run.Werkbuch.MCPURL,
		"headers": map[string]string{"Authorization": "Bearer " + run.Werkbuch.Token},
	}}}
	data, _ := json.MarshalIndent(body, "", "  ")
	path := filepath.Join(dir, "mcp.json")
	if err := os.WriteFile(path, data, 0o600); err != nil {
		os.RemoveAll(dir)
		return nil, err
	}
	return &File{Dir: dir, Path: path}, nil
}

// Remove deletes folder and file.
func (f *File) Remove() {
	if f != nil {
		os.RemoveAll(f.Dir)
	}
}
