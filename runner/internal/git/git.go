// Package git keeps the repositories and working folders of the runner (spec 8.1): per repository one bare clone with
// remote-tracking branches (`repos/`), per strand one worktree that lives until the strand ends (`worktrees/<strand>`, the
// session of the CLI hangs on it), per review without a strand one worktree at its commit (`worktrees/run-<id>`,
// removed after the run), and per strand of a project without repository a plain folder (`work/<strand>`).
//
// A token for git (WEBU-24) is never written into a config, into argv or into the environment: it lives in a file 0600
// in the private folder of the run (TokenFile), which the runner replaces when it renews the token (WEBU-31). A credential
// helper reads that file on every call (Env), so a git started by a CLI that runs since before the renewal still pushes
// with the new token; `gh` gets it as GH_TOKEN from a wrapper that reads the same file (GhWrapper).
package git

import (
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"regexp"
	"strings"
	"sync"
	"time"
)

// TokenFileEnv names the token file to the credential helper (the path, never the token).
const TokenFileEnv = "WERKBUCH_GIT_TOKEN_FILE"

// helper answers `get` with the token of the file and nothing else (`store` and `erase` are no-ops: no token reaches a
// keychain).
const helper = `!f() { test "$1" = get || exit 0; t=$(cat "$` + TokenFileEnv + `" 2>/dev/null) || exit 0; echo username=x-access-token; printf 'password=%s\n' "$t"; }; f`

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
	Source    string // the repository, "" without one
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
	Name      string // strand ID, or run-<id>
	Repo      string // URL or local path, "" without a repository
	Branch    string // the branch of the strand
	Base      string // its base, "" for the default branch
	Head      string // a commit to look at (review without strand)
	TokenFile string // the file of the installation token, "" without one
	Teardown  string
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

// Env is the environment git, the setup command and the CLI get for a token file: the helpers of the machine are reset
// (an empty `credential.helper` empties the list: osxkeychain or `gh auth git-credential` neither answer with a stale
// token nor store this one), then the helper that reads the file. The token itself is in no variable.
func Env(tokenFile string) []string {
	if tokenFile == "" {
		return nil
	}
	return []string{
		TokenFileEnv + "=" + tokenFile,
		"GIT_TERMINAL_PROMPT=0",
		"GIT_CONFIG_COUNT=2",
		"GIT_CONFIG_KEY_0=credential.helper",
		"GIT_CONFIG_VALUE_0=",
		"GIT_CONFIG_KEY_1=credential.helper",
		"GIT_CONFIG_VALUE_1=" + helper,
	}
}

// TokenFile holds the git token of a run (0600 in the private folder of the run).
type TokenFile struct {
	Path string
	dir  string
	mu   sync.Mutex
}

// NewTokenFile names the token file in dir (written by Write).
func NewTokenFile(dir string) *TokenFile {
	return &TokenFile{Path: filepath.Join(dir, "git-token"), dir: dir}
}

// Write replaces the token at once: a new file 0600 next to it, renamed over it. A reader sees the old or the new
// token, never half of one.
func (f *TokenFile) Write(token string) error {
	f.mu.Lock()
	defer f.mu.Unlock()
	tmp, err := os.CreateTemp(f.dir, ".git-token-*")
	if err != nil {
		return err
	}
	name := tmp.Name()
	_, werr := tmp.WriteString(token)
	cerr := tmp.Close()
	if err := errors.Join(werr, cerr, os.Chmod(name, 0o600)); err != nil {
		os.Remove(name)
		return err
	}
	if err := os.Rename(name, f.Path); err != nil {
		os.Remove(name)
		return err
	}
	return nil
}

// GhWrapper writes `<dir>/bin/gh`, which sets GH_TOKEN from the token file and runs the real gh, and returns the folder
// to put in front of PATH. GH_TOKEN reaches only gh and what gh starts, and always the current token.
func GhWrapper(dir, tokenFile, gh string) (string, error) {
	bin := filepath.Join(dir, "bin")
	if err := os.MkdirAll(bin, 0o700); err != nil {
		return "", err
	}
	script := "#!/bin/sh\nGH_TOKEN=$(cat " + quote(tokenFile) + ") || exit 1\nexport GH_TOKEN\nexec " + quote(gh) + ` "$@"` + "\n"
	return bin, os.WriteFile(filepath.Join(bin, "gh"), []byte(script), 0o700)
}

// quote quotes a word for sh.
func quote(s string) string { return "'" + strings.ReplaceAll(s, "'", `'\''`) + "'" }

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
	env := Env(s.TokenFile)
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
	ws := &Workspace{Dir: dir, Repo: true, Source: s.Repo, Env: env, meta: dir + ".json"}
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

// ContextMax bounds one prepared file.
const ContextMax = 4 << 20

// Context prepares what a light run would ask git for, as files of text (A493: light runs have no shell): for a review
// the diff of the checked-out head against the base (`<base>...HEAD`) and the log of its commits, for a comment the
// last 20 commits and the status of the strand's worktree. Without a repository: none.
func (m *Manager) Context(ctx context.Context, ws *Workspace, kind, base string) map[string]string {
	if !ws.Repo {
		return nil
	}
	if base == "" {
		base = m.DefaultBranch(ctx, m.mirror(ws.Source))
	}
	files := map[string]string{}
	add := func(name string, args ...string) {
		out, err := m.run(ctx, nil, ws.Dir, args...)
		if err != nil {
			out = "not available: " + err.Error()
		}
		if len(out) > ContextMax {
			out = out[:ContextMax] + "\n… cut at 4 MB"
		}
		files[name] = out + "\n"
	}
	if kind == "review" {
		add("pull-request.diff", "diff", "--no-color", "--end-of-options", "origin/"+base+"...HEAD")
		add("pull-request-log.txt", "log", "--no-color", "--stat", "--end-of-options", "origin/"+base+"..HEAD")
		return files
	}
	add("git-log.txt", "log", "--no-color", "-20", "--stat")
	add("git-status.txt", "status")
	return files
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

// Take hands the sweep a folder for itself: it returns how to give it back, or false while a run has it.
type Take func(name string) (release func(), ok bool)

// Sweep removes worktrees and folders whose last run is older than keep (A497). Each folder is taken first (take: the
// turn of the runs, never one a run has); under it the last use is read again, and it is held over teardown and
// removal, so a run that comes meanwhile waits at its folder and makes it anew afterwards.
func (m *Manager) Sweep(ctx context.Context, keep time.Duration, take Take, teardown Teardown) []string {
	var removed []string
	old := func(metaFile string) bool {
		var meta Meta
		data, err := os.ReadFile(metaFile)
		return err == nil && json.Unmarshal(data, &meta) == nil && time.Since(meta.LastUsed) >= keep
	}
	for _, area := range []string{"worktrees", "work"} {
		metas, _ := filepath.Glob(filepath.Join(m.Data, area, "*.json"))
		for _, metaFile := range metas {
			dir := strings.TrimSuffix(metaFile, ".json")
			if !old(metaFile) {
				continue
			}
			release := func() {}
			if take != nil {
				r, ok := take(filepath.Base(dir))
				if !ok {
					continue
				}
				release = r
			}
			if old(metaFile) && m.Remove(ctx, dir, teardown) == nil {
				removed = append(removed, dir)
			}
			release()
		}
	}
	return removed
}
