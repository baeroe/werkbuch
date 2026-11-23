// Package equipment reports what the harness of the machine brings (spec 8.7): the MCP servers, skills and plugins of
// the CLIs, by name, and the MCP servers that reach the instance some other way than the run token (`werkbuch_access`):
// with them an agent would act past the lock of run tokens (11.2), so `doctor` warns.
//
// Servers come from `claude mcp list` and `codex mcp list --json`; a server counts as access to werkbuch when its
// address or command names the host of the instance. A run adds what the CLI itself shows: a server with werkbuch's
// tools (`manage-work-items`) that is not `werkbuch-run` (Seen, A492).
package equipment

import (
	"context"
	"encoding/json"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"sync"
	"time"

	"github.com/baeroe/werkbuch/runner/internal/protocol"
	"github.com/baeroe/werkbuch/runner/internal/sysexec"
)

// CacheFor is how long a collection holds (`claude mcp list` checks every server).
const CacheFor = 10 * time.Minute

// RunServer is the server the runner adds to every run.
const RunServer = "werkbuch-run"

// Server is one MCP server as the CLI lists it.
type Server struct {
	Name   string
	Target string
}

// ParseClaude reads `claude mcp list`: lines `<name>: <url or command> - <status>`.
func ParseClaude(out string) []Server {
	var list []Server
	for _, line := range strings.Split(out, "\n") {
		line = strings.TrimSpace(line)
		i := strings.Index(line, ": ")
		if i <= 0 || strings.HasPrefix(line, "Checking") {
			continue
		}
		target := line[i+2:]
		if j := strings.LastIndex(target, " - "); j >= 0 {
			target = target[:j]
		}
		list = append(list, Server{Name: line[:i], Target: target})
	}
	return list
}

// ParseCodex reads `codex mcp list --json`: a list of servers with a name and a transport.
func ParseCodex(out []byte) []Server {
	var raw []map[string]any
	if json.Unmarshal(out, &raw) != nil {
		return nil
	}
	var list []Server
	for _, s := range raw {
		name, _ := s["name"].(string)
		if name == "" {
			continue
		}
		target, _ := json.Marshal(s)
		list = append(list, Server{Name: name, Target: string(target)})
	}
	return list
}

// Reaches says whether a server names the host of the instance.
func Reaches(s Server, host string) bool {
	return host != "" && s.Name != RunServer && strings.Contains(strings.ToLower(s.Target), strings.ToLower(host))
}

// Collector gathers the equipment and caches it.
type Collector struct {
	Run       sysexec.Func
	Host      string
	ClaudeDir string // ~/.claude unless CLAUDE_CONFIG_DIR
	mu        sync.Mutex
	at        time.Time
	last      *protocol.Equipment
	seen      map[string]bool
}

// Seen records a server a run of the CLI showed with werkbuch's tools.
func (c *Collector) Seen(server string) {
	c.mu.Lock()
	defer c.mu.Unlock()
	if c.seen == nil {
		c.seen = map[string]bool{}
	}
	c.seen[server] = true
	c.at = time.Time{}
}

// Collect returns the equipment, at most every CacheFor unless fresh.
func (c *Collector) Collect(ctx context.Context, fresh bool) protocol.Equipment {
	c.mu.Lock()
	cached := c.last
	stale := fresh || cached == nil || time.Since(c.at) >= CacheFor
	c.mu.Unlock()
	if !stale {
		return *cached
	}
	eq := protocol.Equipment{MCPServers: []string{}, Skills: []string{}, Plugins: []string{}, WerkbuchAccess: []string{}}
	access := map[string]bool{}
	names := map[string]bool{}
	add := func(list []Server) {
		for _, s := range list {
			names[s.Name] = true
			if Reaches(s, c.Host) {
				access[s.Name] = true
			}
		}
	}
	if out, err := c.Run(ctx, "claude", "mcp", "list"); err == nil {
		add(ParseClaude(string(out)))
	}
	if out, err := c.Run(ctx, "codex", "mcp", "list", "--json"); err == nil {
		add(ParseCodex(out))
	}
	eq.MCPServers = keys(names)
	dir := c.claudeDir()
	eq.Skills = skills(filepath.Join(dir, "skills"))
	eq.Plugins = plugins(filepath.Join(dir, "plugins", "installed_plugins.json"))

	c.mu.Lock()
	for s := range c.seen {
		access[s] = true
	}
	eq.WerkbuchAccess = keys(access)
	c.last, c.at = &eq, time.Now()
	c.mu.Unlock()
	return eq
}

func (c *Collector) claudeDir() string {
	if c.ClaudeDir != "" {
		return c.ClaudeDir
	}
	if v := os.Getenv("CLAUDE_CONFIG_DIR"); v != "" {
		return v
	}
	home, _ := os.UserHomeDir()
	return filepath.Join(home, ".claude")
}

func skills(dir string) []string {
	entries, err := os.ReadDir(dir)
	out := []string{}
	if err != nil {
		return out
	}
	for _, e := range entries {
		if _, err := os.Stat(filepath.Join(dir, e.Name(), "SKILL.md")); err == nil {
			out = append(out, e.Name())
		}
	}
	return out
}

func plugins(file string) []string {
	out := []string{}
	data, err := os.ReadFile(file)
	if err != nil {
		return out
	}
	var installed struct {
		Plugins map[string]json.RawMessage `json:"plugins"`
	}
	if json.Unmarshal(data, &installed) != nil {
		return out
	}
	set := map[string]bool{}
	for k := range installed.Plugins {
		set[strings.SplitN(k, "@", 2)[0]] = true
	}
	return keys(set)
}

func keys(m map[string]bool) []string {
	out := make([]string, 0, len(m))
	for k := range m {
		if len(k) > 200 {
			k = k[:200]
		}
		out = append(out, k)
	}
	sort.Strings(out)
	if len(out) > 200 {
		out = out[:200]
	}
	return out
}
