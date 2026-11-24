// Package mcpconfig writes the private files of one run: the MCP configuration (spec 8.1): the server `werkbuch-run` (`<APP_URL>/mcp`,
// bearer the run token) and the system prompt in a private temporary folder (0700, the file 0600), removed when the run ends. The CLI loads
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

// Folder creates a private folder of the run (0700) without a file: the token of git lives in one of its own, out of
// the folder a light run may read (A531).
func Folder() (*File, error) {
	dir, err := os.MkdirTemp("", "werkbuch-run-")
	if err != nil {
		return nil, err
	}
	if err := os.Chmod(dir, 0o700); err != nil {
		os.RemoveAll(dir)
		return nil, err
	}
	return &File{Dir: dir}, nil
}

// Write creates the folder and the file for the run.
func Write(run protocol.Run) (*File, error) {
	f, err := Folder()
	if err != nil {
		return nil, err
	}
	dir := f.Dir
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

// Put writes another private file of the run into the folder (0600), like the system prompt.
func (f *File) Put(name, content string) (string, error) {
	path := filepath.Join(f.Dir, name)
	return path, os.WriteFile(path, []byte(content), 0o600)
}

// Remove deletes folder and file.
func (f *File) Remove() {
	if f != nil {
		os.RemoveAll(f.Dir)
	}
}
