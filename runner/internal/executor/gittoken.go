package executor

import (
	"context"
	"errors"
	"fmt"
	"log/slog"
	"net/http"
	"sync"
	"time"

	"github.com/baeroe/werkbuch/runner/internal/client"
	"github.com/baeroe/werkbuch/runner/internal/git"
	"github.com/baeroe/werkbuch/runner/internal/protocol"
	"github.com/baeroe/werkbuch/runner/internal/redact"
)

// GiveUpAfter is how many failed renewals after the current token ran out end the renewal (A532): a refusal that
// lasts (GitHub keeps answering 5xx) stops asking werkbuch every minute for the rest of a long run.
const GiveUpAfter = 5

// gitToken is the installation token of a run (WEBU-31): its files (git.TokenFile) and every token the run held, blanked
// in every text until the run ended.
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

// renewer keeps the git token of a run fresh (A532): RenewBefore its `expires_at` it asks werkbuch for a new one
// (`POST runs/{id}/git-token`) and replaces the files at once. A 5xx, 408, 429 or a network error tries again (from
// RenewRetry, doubling up to a minute, also past the expiry: a later token still helps the next git, until GiveUpAfter
// failures after the expiry); 409 `run_replaced`, 404 and 401 stop the run as a heartbeat would; every other refusal
// (`no_repository`, `repository_unavailable`, `run_canceling`, `merge_guard_open`, …) only ends the renewal, the run goes
// on with the token it has.
type renewer struct {
	x       *Executor
	l       *lease
	run     protocol.Run
	tok     *gitToken
	s       *sender
	log     *slog.Logger
	expires *time.Time
	late    int // failures after the current token ran out
}

type renewal int

const (
	renewedNow renewal = iota // a new token is in the files
	tryAgain                  // a failure that may pass
	giveUp                    // no more renewals (the run may go on, or the lease decided it stops)
)

func (x *Executor) newRenewer(l *lease, run protocol.Run, tok *gitToken, s *sender, log *slog.Logger) *renewer {
	return &renewer{x: x, l: l, run: run, tok: tok, s: s, log: log, expires: run.Git.ExpiresAt}
}

// due says the token runs out within RenewBefore (or already did).
func (r *renewer) due() bool {
	return r.expires != nil && time.Until(*r.expires) < r.x.RenewBefore
}

// try asks once for a new token.
func (r *renewer) try(ctx context.Context) renewal {
	rctx, done := context.WithTimeout(ctx, 30*time.Second)
	a, err := r.x.Client.GitToken(rctx, r.run.ID, r.run.Attempt)
	done()
	if ctx.Err() != nil {
		return giveUp
	}
	if err == nil && a.Git.Token == "" {
		err = errNoToken
	}
	if err == nil {
		r.tok.hold(a.Git.Token)
		if err := r.tok.file.Write(a.Git.Token); err != nil {
			r.end("git token not written", err)
			return giveUp
		}
		r.expires, r.late = a.Git.ExpiresAt, 0
		text := "git token renewed"
		if r.expires != nil {
			text += ", valid until " + r.expires.UTC().Format(time.RFC3339)
		}
		r.log.Info("git token renewed", "expires_at", r.expires)
		r.s.add(protocol.Event{Kind: protocol.KindSystem, Text: text, At: time.Now().UTC()})
		return renewedNow
	}
	if client.Replaced(err) || client.Unauthorized(err) {
		r.log.Warn("git token: werkbuch gave the run away", "err", err)
		r.l.decide(replaced)
		return giveUp
	}
	if final(err) {
		r.end("git token not renewed", err)
		return giveUp
	}
	if r.expires != nil && time.Now().After(*r.expires) {
		if r.late++; r.late >= GiveUpAfter {
			r.end("git token not renewed", fmt.Errorf("%d failures after it ran out, last: %w", r.late, err))
			return giveUp
		}
	}
	r.log.Warn("git token renewal failed, again", "err", err)
	return tryAgain
}

func (r *renewer) end(msg string, err error) {
	r.log.Warn(msg, "err", err)
	r.s.add(protocol.Event{Kind: protocol.KindError, Text: "git token not renewed: " + err.Error(), At: time.Now().UTC()})
}

// start runs the renewal in the background until stop; floor is the least wait before the first request.
func (r *renewer) start(floor time.Duration) (stop func()) {
	ctx, cancel := context.WithCancel(r.l.ctx)
	done := make(chan struct{})
	go func() {
		defer close(done)
		r.loop(ctx, floor)
	}()
	return func() { cancel(); <-done }
}

func (r *renewer) loop(ctx context.Context, floor time.Duration) {
	for r.expires != nil {
		if !pause(ctx, max(time.Until(r.expires.Add(-r.x.RenewBefore)), floor)) {
			return
		}
		// a token that comes too short-lived to wait for is asked again no sooner than RenewRetry
		floor = r.x.RenewRetry
		wait := r.x.RenewRetry
		for again := true; again; {
			switch r.try(ctx) {
			case renewedNow:
				again = false
			case giveUp:
				return
			default:
				if !pause(ctx, wait) {
					return
				}
				wait = min(wait*2, time.Minute)
			}
		}
	}
}

var errNoToken = errors.New("werkbuch answered without a token")

// final says a renewal will not succeed by asking again: a refusal below 500 other than 408 and 429, or an answer
// without a token.
func final(err error) bool {
	var p *client.ProblemError
	if errors.As(err, &p) {
		return p.Status < 500 && p.Status != http.StatusTooManyRequests && p.Status != http.StatusRequestTimeout
	}
	return errors.Is(err, errNoToken)
}

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
