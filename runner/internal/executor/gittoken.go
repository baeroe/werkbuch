package executor

import (
	"context"
	"errors"
	"log/slog"
	"net/http"
	"sync"
	"time"

	"github.com/baeroe/werkbuch/runner/internal/client"
	"github.com/baeroe/werkbuch/runner/internal/git"
	"github.com/baeroe/werkbuch/runner/internal/protocol"
	"github.com/baeroe/werkbuch/runner/internal/redact"
)

// gitToken is the installation token of a run (WEBU-31): the file the credential helper and the wrapper of gh read, and
// every token the run held, blanked in every text until the run ended.
type gitToken struct {
	file *git.TokenFile
	mu   sync.Mutex
	held []string
}

func (g *gitToken) hold(token string) {
	redact.Hold(token)
	g.mu.Lock()
	g.held = append(g.held, token)
	g.mu.Unlock()
}

func (g *gitToken) release() {
	g.mu.Lock()
	defer g.mu.Unlock()
	for _, t := range g.held {
		redact.Release(t)
	}
	g.held = nil
}

// renewGit keeps the git token of a run fresh until stop: RenewBefore its `expires_at` it asks werkbuch for a new one
// (`POST runs/{id}/git-token`) and replaces the file at once. A 5xx, 429 or a network error tries again (from RenewRetry,
// doubling up to a minute, also past the expiry: a later token still helps the next git). 409 `run_replaced` or 404 (and
// 401) stop the run as a heartbeat would; every other refusal (`no_repository`, `repository_unavailable`,
// `run_canceling`, `merge_guard_open`, …) only ends the renewal, the run goes on with the token it has.
func (x *Executor) renewGit(l *lease, run protocol.Run, tok *gitToken, s *sender, log *slog.Logger) (stop func()) {
	ctx, cancel := context.WithCancel(l.ctx)
	done := make(chan struct{})
	go func() {
		defer close(done)
		x.renewLoop(ctx, l, run, tok, s, log)
	}()
	return func() { cancel(); <-done }
}

func (x *Executor) renewLoop(ctx context.Context, l *lease, run protocol.Run, tok *gitToken, s *sender, log *slog.Logger) {
	expires := run.Git.ExpiresAt
	floor := time.Duration(0)
	for expires != nil {
		if !pause(ctx, max(time.Until(expires.Add(-x.RenewBefore)), floor)) {
			return
		}
		// a token that comes too short-lived to wait for is asked again no sooner than RenewRetry
		floor = x.RenewRetry
		wait := x.RenewRetry
		for {
			rctx, done := context.WithTimeout(ctx, 30*time.Second)
			a, err := x.Client.GitToken(rctx, run.ID, run.Attempt)
			done()
			if ctx.Err() != nil {
				return
			}
			if err == nil && a.Git.Token == "" {
				err = errNoToken
			}
			if err == nil {
				tok.hold(a.Git.Token)
				if err := tok.file.Write(a.Git.Token); err != nil {
					log.Error("git token not written", "err", err)
					s.add(protocol.Event{Kind: protocol.KindError, Text: "git token not renewed: " + err.Error(), At: time.Now().UTC()})
					return
				}
				expires = a.Git.ExpiresAt
				text := "git token renewed"
				if expires != nil {
					text += ", valid until " + expires.UTC().Format(time.RFC3339)
				}
				log.Info("git token renewed", "expires_at", expires)
				s.add(protocol.Event{Kind: protocol.KindSystem, Text: text, At: time.Now().UTC()})
				break
			}
			if client.Replaced(err) || client.Unauthorized(err) {
				log.Warn("git token: werkbuch gave the run away", "err", err)
				l.decide(replaced)
				return
			}
			if final(err) {
				log.Warn("git token not renewed", "err", err)
				s.add(protocol.Event{Kind: protocol.KindError, Text: "git token not renewed: " + err.Error(), At: time.Now().UTC()})
				return
			}
			log.Warn("git token renewal failed, again", "err", err, "in", wait)
			if !pause(ctx, wait) {
				return
			}
			wait = min(wait*2, time.Minute)
		}
	}
}

// final says a renewal will not succeed by asking again: a refusal below 500 other than 408 and 429, or an answer
// without a token.
func final(err error) bool {
	var p *client.ProblemError
	if errors.As(err, &p) {
		return p.Status < 500 && p.Status != http.StatusTooManyRequests && p.Status != http.StatusRequestTimeout
	}
	return errors.Is(err, errNoToken)
}

var errNoToken = errors.New("werkbuch answered without a token")

// pause waits d, false when ctx ended first.
func pause(ctx context.Context, d time.Duration) bool {
	if d <= 0 {
		return ctx.Err() == nil
	}
	t := time.NewTimer(d)
	defer t.Stop()
	select {
	case <-t.C:
		return true
	case <-ctx.Done():
		return false
	}
}
