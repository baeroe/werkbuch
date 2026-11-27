// Package usage reads how much of the Claude subscription the machine's sign-in has used (WEBU-65), as `/usage` of
// Claude Code shows it: the session (five hours) and the week in percent with their reset times. It only reads: the
// OAuth token of Claude Code (macOS keychain, else `.credentials.json` of the Claude folder) goes to Anthropic's usage
// endpoint and nowhere else, never into a log or a report. werkbuch holds back new runs of `claude` once a window
// reaches the runner's limit.
package usage

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"os"
	"path/filepath"
	"runtime"
	"strings"
	"sync"
	"time"

	"github.com/baeroe/werkbuch/runner/internal/protocol"
	"github.com/baeroe/werkbuch/runner/internal/sysexec"
)

// URL is the usage endpoint of a Claude subscription, the one Claude Code asks for `/usage`.
const URL = "https://api.anthropic.com/api/oauth/usage"

// Keychain is the service under which Claude Code keeps its sign-in on macOS.
const Keychain = "Claude Code-credentials"

// CacheFor is how long a reading holds; KeepFor how long a reading stays after the endpoint failed.
const (
	CacheFor = 5 * time.Minute
	KeepFor  = 30 * time.Minute
)

// Reader asks the endpoint at most every CacheFor.
type Reader struct {
	Run       sysexec.Func
	HTTP      *http.Client
	URL       string
	ClaudeDir string // ~/.claude unless CLAUDE_CONFIG_DIR
	GOOS      string

	mu     sync.Mutex
	asked  time.Time
	read   time.Time
	last   *protocol.Subscription
	tokens func(ctx context.Context) (string, error) // tests
}

// Current is the last reading, asked afresh once it is older than CacheFor. Without a reading of the last KeepFor
// it is an empty usage (both windows unknown): werkbuch then holds nothing back.
func (r *Reader) Current(ctx context.Context) *protocol.Subscription {
	r.mu.Lock()
	defer r.mu.Unlock()
	if r.asked.IsZero() || time.Since(r.asked) >= CacheFor {
		r.asked = time.Now()
		if u, err := r.fetch(ctx); err == nil {
			r.last, r.read = u, time.Now()
		}
	}
	if r.last == nil || time.Since(r.read) >= KeepFor {
		return &protocol.Subscription{}
	}
	u := *r.last
	return &u
}

func (r *Reader) fetch(ctx context.Context) (*protocol.Subscription, error) {
	token, err := r.token(ctx)
	if err != nil {
		return nil, err
	}
	url := r.URL
	if url == "" {
		url = URL
	}
	ctx, cancel := context.WithTimeout(ctx, 10*time.Second)
	defer cancel()
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, url, nil)
	if err != nil {
		return nil, err
	}
	req.Header.Set("Authorization", "Bearer "+token)
	req.Header.Set("anthropic-beta", "oauth-2025-04-20")
	client := r.HTTP
	if client == nil {
		client = http.DefaultClient
	}
	res, err := client.Do(req)
	if err != nil {
		return nil, errors.New("usage endpoint not reachable") // the error of Do names the URL, never the token
	}
	defer res.Body.Close()
	if res.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("usage endpoint answered %d", res.StatusCode)
	}
	return Parse(io.LimitReader(res.Body, 1<<20))
}

// Parse reads the answer of the endpoint: `five_hour` and `seven_day`, each null or {utilization, resets_at}.
func Parse(body io.Reader) (*protocol.Subscription, error) {
	var answer struct {
		FiveHour *window `json:"five_hour"`
		SevenDay *window `json:"seven_day"`
	}
	if err := json.NewDecoder(body).Decode(&answer); err != nil {
		return nil, err
	}
	return &protocol.Subscription{Session: answer.FiveHour.window(), Week: answer.SevenDay.window()}, nil
}

type window struct {
	Utilization *float64 `json:"utilization"`
	ResetsAt    *string  `json:"resets_at"`
}

func (w *window) window() *protocol.UsageWindow {
	if w == nil || w.Utilization == nil {
		return nil
	}
	p := min(max(*w.Utilization, 0), 100)
	out := &protocol.UsageWindow{Percent: p}
	if w.ResetsAt != nil {
		if t, err := time.Parse(time.RFC3339Nano, *w.ResetsAt); err == nil {
			s := t.UTC().Format(time.RFC3339)
			out.ResetsAt = &s
		}
	}
	return out
}

type credentials struct {
	OAuth struct {
		AccessToken string `json:"accessToken"`
		ExpiresAt   int64  `json:"expiresAt"` // milliseconds
	} `json:"claudeAiOauth"`
}

// token is the access token of Claude Code's sign-in, if it has not expired (Claude Code renews it, the runner never).
func (r *Reader) token(ctx context.Context) (string, error) {
	if r.tokens != nil {
		return r.tokens(ctx)
	}
	var raw []byte
	goos := r.GOOS
	if goos == "" {
		goos = runtime.GOOS
	}
	// shortcut: on macOS only the keychain entry of the default Claude folder, not the one Claude Code names after a
	// CLAUDE_CONFIG_DIR; read that one too once someone runs a runner with its own Claude folder.
	if goos == "darwin" && r.Run != nil {
		if out, err := r.Run(ctx, "security", "find-generic-password", "-s", Keychain, "-w"); err == nil {
			raw = out
		}
	}
	if raw == nil {
		b, err := os.ReadFile(filepath.Join(r.claudeDir(), ".credentials.json"))
		if err != nil {
			return "", errors.New("no sign-in of Claude Code")
		}
		raw = b
	}
	var c credentials
	if err := json.Unmarshal([]byte(strings.TrimSpace(string(raw))), &c); err != nil || c.OAuth.AccessToken == "" {
		return "", errors.New("no OAuth sign-in of Claude Code")
	}
	if c.OAuth.ExpiresAt > 0 && time.UnixMilli(c.OAuth.ExpiresAt).Before(time.Now()) {
		return "", errors.New("the sign-in of Claude Code has expired")
	}
	return c.OAuth.AccessToken, nil
}

func (r *Reader) claudeDir() string {
	if r.ClaudeDir != "" {
		return r.ClaudeDir
	}
	if v := os.Getenv("CLAUDE_CONFIG_DIR"); v != "" {
		return v
	}
	home, _ := os.UserHomeDir()
	return filepath.Join(home, ".claude")
}
