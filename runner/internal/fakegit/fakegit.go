// Package fakegit is a git remote over HTTP for tests (WEBU-31): `git http-backend` behind basic auth that takes a
// token only until it expires, as GitHub takes an installation token (user `x-access-token`). It records every request
// with the token it carried, so a test sees which token a clone, fetch or push used.
package fakegit

import (
	"fmt"
	"net/http"
	"net/http/cgi"
	"net/http/httptest"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"sync"
	"time"
)

// Request is what the remote saw.
type Request struct {
	Push    bool // a request of git-receive-pack
	Token   string
	Allowed bool
	At      time.Time
}

// Server is the remote.
type Server struct {
	*httptest.Server
	Root string

	mu       sync.Mutex
	tokens   map[string]time.Time
	requests []Request
}

// New starts a remote with its repositories under root.
func New(root string) (*Server, error) {
	gitPath, err := exec.LookPath("git")
	if err != nil {
		return nil, err
	}
	s := &Server{Root: root, tokens: map[string]time.Time{}}
	backend := &cgi.Handler{
		Path: gitPath,
		Args: []string{"http-backend"},
		Env:  []string{"GIT_PROJECT_ROOT=" + root, "GIT_HTTP_EXPORT_ALL=1", "GIT_CONFIG_GLOBAL=/dev/null", "GIT_CONFIG_NOSYSTEM=1"},
	}
	s.Server = httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		user, token, ok := r.BasicAuth()
		push := strings.HasSuffix(r.URL.Path, "/git-receive-pack") || r.URL.Query().Get("service") == "git-receive-pack"
		s.mu.Lock()
		until, known := s.tokens[token]
		allowed := ok && user == "x-access-token" && known && time.Now().Before(until)
		if ok {
			s.requests = append(s.requests, Request{Push: push, Token: token, Allowed: allowed, At: time.Now()})
		}
		s.mu.Unlock()
		if !allowed {
			w.Header().Set("WWW-Authenticate", `Basic realm="fakegit"`)
			http.Error(w, "token refused", http.StatusUnauthorized)
			return
		}
		backend.ServeHTTP(w, r)
	}))
	return s, nil
}

// Accept takes token until the given time.
func (s *Server) Accept(token string, until time.Time) {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.tokens[token] = until
}

// Requests returns what the remote saw with a token.
func (s *Server) Requests() []Request {
	s.mu.Lock()
	defer s.mu.Unlock()
	return append([]Request(nil), s.requests...)
}

// Seed makes a bare repository `<name>.git` with one commit on main and returns its URL.
func (s *Server) Seed(name string) (string, error) {
	bare := filepath.Join(s.Root, name+".git")
	work, err := os.MkdirTemp("", "fakegit-")
	if err != nil {
		return "", err
	}
	defer os.RemoveAll(work)
	steps := [][]string{
		{"init", "--quiet", "--bare", "-b", "main", bare},
		{"-C", bare, "config", "http.receivepack", "true"},
		{"-C", work, "init", "--quiet", "-b", "main"},
	}
	for _, args := range steps {
		if err := git(args...); err != nil {
			return "", err
		}
	}
	if err := os.WriteFile(filepath.Join(work, "README.md"), []byte("hi\n"), 0o644); err != nil {
		return "", err
	}
	for _, args := range [][]string{{"-C", work, "add", "."}, {"-C", work, "commit", "--quiet", "-m", "first"}, {"-C", work, "push", "--quiet", bare, "main"}} {
		if err := git(args...); err != nil {
			return "", err
		}
	}
	return s.URL + "/" + name + ".git", nil
}

// Head is the commit a branch of a repository points at ("" without it).
func (s *Server) Head(name, branch string) string {
	cmd := exec.Command("git", "-C", filepath.Join(s.Root, name+".git"), "rev-parse", "--verify", "--quiet", "refs/heads/"+branch)
	cmd.Env = append(os.Environ(), "GIT_CONFIG_GLOBAL=/dev/null", "GIT_CONFIG_NOSYSTEM=1")
	out, err := cmd.Output()
	if err != nil {
		return ""
	}
	return strings.TrimSpace(string(out))
}

func git(args ...string) error {
	cmd := exec.Command("git", args...)
	// no config of the machine (a credential helper, a hook) acts on the seed
	cmd.Env = append(os.Environ(), "GIT_CONFIG_GLOBAL=/dev/null", "GIT_CONFIG_NOSYSTEM=1", "GIT_AUTHOR_NAME=t", "GIT_AUTHOR_EMAIL=t@example.com", "GIT_COMMITTER_NAME=t", "GIT_COMMITTER_EMAIL=t@example.com")
	if out, err := cmd.CombinedOutput(); err != nil {
		return fmt.Errorf("git %v: %v %s", args, err, out)
	}
	return nil
}
