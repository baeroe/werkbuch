package executor

import (
	"context"
	"log/slog"
	"sync"
	"time"

	"github.com/baeroe/werkbuch/runner/internal/client"
	"github.com/baeroe/werkbuch/runner/internal/protocol"
)

// lease keeps a run alive in werkbuch from the claim until werkbuch took its result: a heartbeat in the interval werkbuch
// names, also while the worktree is made, the setup runs and the result is delivered (the lease lasts 60 s, A474). It
// decides once why a run stops: canceled in werkbuch or on the machine, the time limit, an attempt werkbuch gave away,
// the end of the daemon. Its context ends with that decision, so preparation and setup stop, too.
type lease struct {
	x      *Executor
	e      *Execution
	parent context.Context
	ctx    context.Context
	cancel context.CancelFunc
	log    *slog.Logger

	once    sync.Once
	mu      sync.Mutex
	why     string
	decided chan struct{}
	quit    chan struct{}
	ended   chan struct{}
}

func newLease(parent context.Context, x *Executor, e *Execution, log *slog.Logger) *lease {
	ctx, cancel := context.WithCancel(parent)
	l := &lease{x: x, e: e, parent: parent, ctx: ctx, cancel: cancel, log: log, decided: make(chan struct{}), quit: make(chan struct{}), ended: make(chan struct{})}
	go l.loop()
	return l
}

// decide records why the run stops; the first reason wins.
func (l *lease) decide(reason string) {
	l.once.Do(func() {
		l.mu.Lock()
		l.why = reason
		l.mu.Unlock()
		l.log.Info("stopping the run", "reason", reason)
		l.cancel()
		close(l.decided)
	})
}

func (l *lease) reason() string {
	l.mu.Lock()
	defer l.mu.Unlock()
	return l.why
}

// stop ends the heartbeats (after the result).
func (l *lease) stop() {
	select {
	case <-l.quit:
	default:
		close(l.quit)
	}
	<-l.ended
	l.cancel()
}

func (l *lease) loop() {
	defer close(l.ended)
	run := l.e.Run
	deadline := run.Deadline(l.e.Started)
	limit := time.NewTimer(time.Until(deadline))
	defer limit.Stop()
	interval := l.x.heartbeat()
	beat := time.NewTimer(interval)
	defer beat.Stop()
	for {
		select {
		case <-l.quit:
			return
		case reason := <-l.e.stop:
			l.decide(reason)
		case <-l.parent.Done():
			l.decide(shutdown)
			return
		case <-limit.C:
			l.decide(protocol.TimedOut)
		case <-beat.C:
			ctx, cancel := context.WithTimeout(l.parent, 20*time.Second)
			a, err := l.x.Client.Heartbeat(ctx, run.ID, run.Attempt, l.x.Report())
			cancel()
			switch {
			case client.Replaced(err) || client.Unauthorized(err):
				l.decide(replaced)
			case err != nil:
				l.log.Warn("heartbeat failed", "err", err)
			default:
				if a.Cancel {
					l.decide(protocol.Canceled)
				}
				if a.DeadlineAt != nil && !a.DeadlineAt.Equal(deadline) {
					deadline = *a.DeadlineAt
					limit.Reset(time.Until(deadline))
				}
				if a.HeartbeatSeconds > 0 {
					interval = time.Duration(a.HeartbeatSeconds) * time.Second
				}
			}
			beat.Reset(interval)
		}
	}
}
