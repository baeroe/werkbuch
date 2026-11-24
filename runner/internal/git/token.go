package git

import (
	"errors"
	"net/url"
	"os"
	"path/filepath"
	"regexp"
	"strings"
	"sync"
)

// TokenFileEnv names the token file to the credential helper (the path, never the token).
const TokenFileEnv = "WERKBUCH_GIT_TOKEN_FILE"

// helper answers `get` with the token of the file and nothing else (`store` and `erase` are no-ops: no token reaches a
// keychain).
const helper = `!f() { test "$1" = get || exit 0; t=$(cat "$` + TokenFileEnv + `" 2>/dev/null) || exit 0; echo username=x-access-token; printf 'password=%s\n' "$t"; }; f`

// TokenFile holds the installation token of a run in a private folder of its own (A531): `git-token` (0600) for the
// credential helper and `gh/hosts.yml` (0600) for gh (GH_CONFIG_DIR), both for the host of the repository only and
// both replaced at once by Write. git and gh read them on every call, so a process started before a renewal and a git
// or gh it starts later use the new token; nothing of it sits in an environment.
type TokenFile struct {
	Path   string
	dir    string
	scheme string // of the repository, "" when it is no http(s) URL (no helper, no gh config)
	host   string // with port, as git matches credentials
	mu     sync.Mutex
}

// NewTokenFile names the files in dir for the repository at repo (written by Write).
func NewTokenFile(dir, repo string) *TokenFile {
	f := &TokenFile{Path: filepath.Join(dir, "git-token"), dir: dir}
	if u, err := url.Parse(repo); err == nil && (u.Scheme == "https" || u.Scheme == "http") && u.Host != "" && u.User == nil {
		f.scheme, f.host = u.Scheme, strings.ToLower(u.Host)
	}
	return f
}

// GhConfigDir is the configuration folder of gh for the run ("" without a host).
func (f *TokenFile) GhConfigDir() string {
	if f == nil || f.host == "" {
		return ""
	}
	return filepath.Join(f.dir, "gh")
}

// Env is the environment git, the setup command and a code run get: the helpers of the machine are reset (an empty
// `credential.helper` empties the list: osxkeychain or `gh auth git-credential` neither answer with a stale token nor
// store this one), then the helper that reads the file, for the host of the repository only (`credential.<url>.helper`);
// gh reads its token from GH_CONFIG_DIR, the token variables of the machine are emptied (gh prefers them). The token
// itself is in no variable. Nil without a token.
func (f *TokenFile) Env() []string {
	if f == nil {
		return nil
	}
	env := []string{TokenFileEnv + "=" + f.Path, "GIT_TERMINAL_PROMPT=0", "GIT_CONFIG_KEY_0=credential.helper", "GIT_CONFIG_VALUE_0="}
	if f.host == "" {
		return append(env, "GIT_CONFIG_COUNT=1")
	}
	return append(env,
		"GIT_CONFIG_COUNT=2",
		"GIT_CONFIG_KEY_1=credential."+f.scheme+"://"+f.host+".helper",
		"GIT_CONFIG_VALUE_1="+helper,
		"GH_CONFIG_DIR="+f.GhConfigDir(),
		"GH_TOKEN=", "GITHUB_TOKEN=", "GH_ENTERPRISE_TOKEN=", "GITHUB_ENTERPRISE_TOKEN=",
	)
}

// tokenRe is what a token of GitHub is made of; anything else never reaches a file (it goes into YAML and a helper).
var tokenRe = regexp.MustCompile(`^[A-Za-z0-9_-]+$`)

// ClosedEnv is the environment of the CLI of a light run (A531): it pushes nothing and needs no token, so git and gh
// fail closed instead of reaching for the logins of the machine: every credential helper off, gh with an empty config
// folder (emptyDir, made by the caller) and the token variables empty.
func ClosedEnv(emptyDir string) []string {
	return []string{
		"GIT_TERMINAL_PROMPT=0", "GIT_CONFIG_COUNT=1", "GIT_CONFIG_KEY_0=credential.helper", "GIT_CONFIG_VALUE_0=",
		"GH_CONFIG_DIR=" + emptyDir,
		"GH_TOKEN=", "GITHUB_TOKEN=", "GH_ENTERPRISE_TOKEN=", "GITHUB_ENTERPRISE_TOKEN=",
	}
}

// Write replaces the token: new files 0600 next to the old ones, renamed over them. A reader of one file sees the old or
// the new token, never half of one. The three files (git-token, gh/config.yml, gh/hosts.yml) are renamed one after the
// other, so for a moment git may read the new token while gh still reads the old one (or the other way round after a
// failed write): both are valid then, the old one runs out only RenewBefore later.
func (f *TokenFile) Write(token string) error {
	f.mu.Lock()
	defer f.mu.Unlock()
	if !tokenRe.MatchString(token) {
		return errors.New("a git token with a character no token has")
	}
	if err := replace(f.dir, f.Path, token); err != nil {
		return err
	}
	gh := f.GhConfigDir()
	if gh == "" {
		return nil
	}
	if err := os.MkdirAll(gh, 0o700); err != nil {
		return err
	}
	// version 1 is the form with accounts: gh migrates nothing and asks GitHub for no user (an installation token has none)
	if err := replace(gh, filepath.Join(gh, "config.yml"), "version: \"1\"\ngit_protocol: https\nprompt: disabled\n"); err != nil {
		return err
	}
	host := strings.Split(f.host, ":")[0]
	hosts := host + ":\n    users:\n        x-access-token:\n            oauth_token: " + token + "\n    git_protocol: https\n    oauth_token: " + token + "\n    user: x-access-token\n"
	return replace(gh, filepath.Join(gh, "hosts.yml"), hosts)
}

// replace writes content to path through a new file 0600 in dir.
func replace(dir, path, content string) error {
	tmp, err := os.CreateTemp(dir, ".tmp-*")
	if err != nil {
		return err
	}
	name := tmp.Name()
	_, werr := tmp.WriteString(content)
	cerr := tmp.Close()
	if err := errors.Join(werr, cerr, os.Chmod(name, 0o600)); err != nil {
		os.Remove(name)
		return err
	}
	if err := os.Rename(name, path); err != nil {
		os.Remove(name)
		return err
	}
	return nil
}
