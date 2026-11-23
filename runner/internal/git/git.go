// Package git keeps the repositories and working folders of the runner (spec 8.1): per repository one bare clone with
// remote-tracking branches (`repos/`), per strand one worktree that lives until the strand ends (`worktrees/<strand>`, the
// session of the CLI hangs on it), per review without a strand one worktree at its commit (`worktrees/run-<id>`,
// removed after the run), and per strand of a project without repository a plain folder (`work/<strand>`).
//
// A token for git (WEBU-24) is never written into a config: a credential helper reads it from the environment of the
// run (Env), `gh` gets it as GH_TOKEN.
package git

import (
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"regexp"
	"strings"
	"sync"
	"time"
)

// TokenEnv carries the git token to the credential helper.
const TokenEnv = "WERKBUCH_GIT_TOKEN"

// KeepFor is how long a worktree stays after its last run (A497).
const KeepFor = 72 * time.Hour

// Manager lays out the data folder. Every git command on a bare clone (clone, fetch, worktree add, remove, prune) runs
// under the lock of that clone: runs side by side and the sweep never work on one at the same time.
type Manager struct {
	Data  string
	locks sync.Map // mirror path → *sync.Mutex
}

func (m *Manager) lock(mirror string) func() {
	l, _ := m.locks.LoadOrStore(mirror, &sync.Mutex{})
	mu := l.(*sync.Mutex)
	mu.Lock()
	return mu.Unlock
}

// Workspace is where one run works.
type Workspace struct {
	Dir       string
	Repo      bool
	Created   bool   // made now: the setup command runs
	Temporary bool   // removed after the run (a review without strand)
	StartHead string // HEAD when the run started (a code run reports a new one)
	Env       []string
	meta      string
}

// Meta is what the runner keeps next to a worktree.
type Meta struct {
	Repo     string    `json:"repo,omitempty"`
	Teardown string    `json:"teardown,omitempty"`
	LastUsed time.Time `json:"last_used"`
}

// Spec says what a run needs.
type Spec struct {
	Name     string // strand ID, or run-<id>
	Repo     string // URL or local path, "" without a repository
	Branch   string // the branch of the strand
	Base     string // its base, "" for the default branch
	Head     string // a commit to look at (review without strand)
	Token    string // installation token, "" without one
	Teardown string
}

var (
	unsafeChars = regexp.MustCompile(`[^A-Za-z0-9._-]+`)
	nameRe      = regexp.MustCompile(`^[A-Za-z0-9][A-Za-z0-9._-]*$`)
	shaRe       = regexp.MustCompile(`^[0-9a-fA-F]{7,64}$`)
)

// Name makes a folder name of a strand or run: only letters, digits, `.`, `_`, `-`, starting with a letter or digit
// (never `.` or `..`).
func Name(raw string) (string, error) {
	name := unsafeChars.ReplaceAllString(raw, "-")
	if !nameRe.MatchString(name) || len(name) > 128 {
		return "", fmt.Errorf("unusable name %q for a working folder", raw)
	}
	return name, nil
}

// Env is the environment git and the CLI get for a token: a credential helper reading it, and GH_TOKEN.
func Env(token string) []string {
	if token == "" {
		return nil
	}
	return []string{
		TokenEnv + "=" + token,
		"GH_TOKEN=" + token,
		"GIT_TERMINAL_PROMPT=0",
		"GIT_CONFIG_COUNT=1",
		"GIT_CONFIG_KEY_0=credential.helper",
		`GIT_CONFIG_VALUE_0=!f() { echo username=x-access-token; echo "password=$` + TokenEnv + `"; }; f`,
	}
}

func (m *Manager) run(ctx context.Context, env []string, dir string, args ...string) (string, error) {
	cmd := exec.CommandContext(ctx, "git", args...)
	cmd.Dir = dir
	cmd.Env = append(os.Environ(), env...)
	var out, errb bytes.Buffer
	cmd.Stdout, cmd.Stderr = &out, &errb
	if err := cmd.Run(); err != nil {
		return "", fmt.Errorf("git %s: %v: %s", args[0], err, strings.TrimSpace(errb.String()))
	}
	return strings.TrimSpace(out.String()), nil
}

func (m *Manager) mirror(repo string) string {
	sum := sha256.Sum256([]byte(repo))
	base := strings.Trim(unsafeChars.ReplaceAllString(strings.TrimSuffix(filepath.Base(strings.TrimRight(repo, "/")), ".git"), "-"), ".-")
	if base == "" {
		base = "repo"
	}
	return filepath.Join(m.Data, "repos", base+"-"+hex.EncodeToString(sum[:])[:12]+".git")
}

// Mirror clones the repository bare (once) and fetches it.
func (m *Manager) Mirror(ctx context.Context, repo string, env []string) (string, error) {
	dir := m.mirror(repo)
	defer m.lock(dir)()
	return dir, m.mirrorLocked(ctx, dir, repo, env)
}

// mirrorLocked clones and fetches under the lock of the clone.
func (m *Manager) mirrorLocked(ctx context.Context, dir, repo string, env []string) error {
	if _, err := os.Stat(filepath.Join(dir, "HEAD")); err != nil {
		if err := os.MkdirAll(filepath.Dir(dir), 0o700); err != nil {
			return err
		}
		tmp := dir + ".tmp"
		os.RemoveAll(tmp)
		if _, err := m.run(ctx, env, "", "clone", "--bare", "--quiet", "--", repo, tmp); err != nil {
			return err
		}
		if _, err := m.run(ctx, env, tmp, "config", "remote.origin.fetch", "+refs/heads/*:refs/remotes/origin/*"); err != nil {
			return err
		}
		if err := os.Rename(tmp, dir); err != nil {
			return err
		}
	}
	_, err := m.run(ctx, env, dir, "fetch", "--quiet", "--prune", "origin")
	return err
}

// ValidBranch checks a branch name as git does (`git check-ref-format --branch`).
func (m *Manager) ValidBranch(ctx context.Context, branch string) error {
	if strings.HasPrefix(branch, "-") {
		return fmt.Errorf("invalid branch %q", branch)
	}
	if _, err := m.run(ctx, nil, "", "check-ref-format", "--branch", branch); err != nil {
		return fmt.Errorf("invalid branch %q", branch)
	}
	return nil
}

// DefaultBranch is the branch HEAD of the remote names.
func (m *Manager) DefaultBranch(ctx context.Context, mirror string) string {
	out, err := m.run(ctx, nil, mirror, "symbolic-ref", "--short", "HEAD")
	if err != nil || out == "" {
		return "main"
	}
	return out
}

func (m *Manager) exists(ctx context.Context, mirror, ref string) bool {
	_, err := m.run(ctx, nil, mirror, "rev-parse", "--verify", "--quiet", "--end-of-options", ref+"^{commit}")
	return err == nil
}

// Prepare makes or reuses the working folder of a run. Branch, base and head are checked before git sees them.
func (m *Manager) Prepare(ctx context.Context, s Spec) (*Workspace, error) {
	name, err := Name(s.Name)
	if err != nil {
		return nil, err
	}
	for _, b := range []string{s.Branch, s.Base} {
		if b != "" {
			if err := m.ValidBranch(ctx, b); err != nil {
				return nil, err
			}
		}
	}
	if s.Head != "" && !shaRe.MatchString(s.Head) {
		return nil, fmt.Errorf("invalid commit %q", s.Head)
	}
	env := Env(s.Token)
	if s.Repo == "" {
		dir := filepath.Join(m.Data, "work", name)
		ws := &Workspace{Dir: dir, Env: env, meta: dir + ".json"}
		if _, err := os.Stat(dir); err != nil {
			if err := os.MkdirAll(dir, 0o700); err != nil {
				return nil, err
			}
			ws.Created = true
		}
		return ws, m.touch(ws, s)
	}
	mirror := m.mirror(s.Repo)
	unlock := m.lock(mirror)
	defer unlock()
	if err := m.mirrorLocked(ctx, mirror, s.Repo, env); err != nil {
		return nil, err
	}
	dir := filepath.Join(m.Data, "worktrees", name)
	ws := &Workspace{Dir: dir, Repo: true, Env: env, meta: dir + ".json"}
	if _, err := os.Stat(filepath.Join(dir, ".git")); err != nil {
		os.RemoveAll(dir)
		if err := os.MkdirAll(filepath.Dir(dir), 0o700); err != nil {
			return nil, err
		}
		if _, err := m.run(ctx, nil, mirror, "worktree", "prune"); err != nil {
			return nil, err
		}
		base := s.Base
		if base == "" {
			base = m.DefaultBranch(ctx, mirror)
		}
		switch {
		case s.Branch == "":
			start := s.Head
			if start == "" {
				start = "origin/" + base
			}
			if _, err := m.run(ctx, nil, mirror, "worktree", "add", "--quiet", "--detach", "--", dir, start); err != nil {
				return nil, err
			}
			ws.Temporary = true
		default:
			start := "origin/" + base
			if m.exists(ctx, mirror, "origin/"+s.Branch) {
				start = "origin/" + s.Branch
			}
			if _, err := m.run(ctx, nil, mirror, "worktree", "add", "--quiet", "-B", s.Branch, "--", dir, start); err != nil {
				return nil, err
			}
			for _, kv := range [][2]string{{"branch." + s.Branch + ".remote", "origin"}, {"branch." + s.Branch + ".merge", "refs/heads/" + s.Branch}} {
				if _, err := m.run(ctx, nil, dir, "config", kv[0], kv[1]); err != nil {
					return nil, err
				}
			}
		}
		ws.Created = true
	}
	ws.StartHead = m.Head(ctx, ws)
	return ws, m.touch(ws, s)
}

// Head is the commit checked out in a worktree, "" outside of git.
func (m *Manager) Head(ctx context.Context, ws *Workspace) string {
	if !ws.Repo {
		return ""
	}
	out, _ := m.run(ctx, nil, ws.Dir, "rev-parse", "HEAD")
	return out
}

func (m *Manager) touch(ws *Workspace, s Spec) error {
	meta := Meta{Repo: s.Repo, Teardown: s.Teardown, LastUsed: time.Now().UTC()}
	data, _ := json.Marshal(meta)
	return os.WriteFile(ws.meta, data, 0o600)
}

// Teardown is a command to run in a folder before it goes.
type Teardown func(ctx context.Context, dir, command string)

// Remove takes a worktree or folder away, its teardown command first.
func (m *Manager) Remove(ctx context.Context, dir string, teardown Teardown) error {
	metaFile := dir + ".json"
	var meta Meta
	if data, err := os.ReadFile(metaFile); err == nil {
		json.Unmarshal(data, &meta)
	}
	if meta.Teardown != "" && teardown != nil {
		teardown(ctx, dir, meta.Teardown)
	}
	if meta.Repo != "" {
		mirror := m.mirror(meta.Repo)
		unlock := m.lock(mirror)
		m.run(ctx, nil, mirror, "worktree", "remove", "--force", "--", dir)
		m.run(ctx, nil, mirror, "worktree", "prune")
		defer unlock()
	}
	os.Remove(metaFile)
	return os.RemoveAll(dir)
}

// Sweep removes worktrees and folders whose last run is older than keep (A497); the names of runs still busy stay.
func (m *Manager) Sweep(ctx context.Context, keep time.Duration, busy map[string]bool, teardown Teardown) []string {
	var removed []string
	for _, area := range []string{"worktrees", "work"} {
		metas, _ := filepath.Glob(filepath.Join(m.Data, area, "*.json"))
		for _, metaFile := range metas {
			dir := strings.TrimSuffix(metaFile, ".json")
			if busy[filepath.Base(dir)] {
				continue
			}
			var meta Meta
			data, err := os.ReadFile(metaFile)
			if err != nil || json.Unmarshal(data, &meta) != nil || time.Since(meta.LastUsed) < keep {
				continue
			}
			if m.Remove(ctx, dir, teardown) == nil {
				removed = append(removed, dir)
			}
		}
	}
	return removed
}
