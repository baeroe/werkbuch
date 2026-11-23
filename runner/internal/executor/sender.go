package executor

import (
	"context"
	"sync"
	"time"

	"github.com/baeroe/werkbuch/runner/internal/client"
	"github.com/baeroe/werkbuch/runner/internal/protocol"
	"github.com/baeroe/werkbuch/runner/internal/redact"
)

// Pending bounds the lines waiting for werkbuch; past it the oldest go (werkbuch keeps at most 2 000 per run anyway).
const Pending = 2000

// sender batches the log of a run to werkbuch: at most every Flush, at most protocol.EventsPerBatch per request. Every
// line is blanked of tokens here, whatever wrote it (CLI, setup, runner). A refusal as replaced stops the run.
type sender struct {
	x       *Executor
	e       *Execution
	l       *lease
	mu      sync.Mutex
	pending []protocol.Event
	done    chan struct{}
	stopped chan struct{}
	once    sync.Once
}

func newSender(x *Executor, e *Execution, l *lease) *sender {
	s := &sender{x: x, e: e, l: l, done: make(chan struct{}), stopped: make(chan struct{})}
	go s.loop()
	return s
}

func (s *sender) add(events ...protocol.Event) {
	if len(events) == 0 {
		return
	}
	clean := make([]protocol.Event, len(events))
	for i, ev := range events {
		ev.Text = redact.String(ev.Text)
		clean[i] = ev
	}
	s.e.add(clean)
	s.mu.Lock()
	s.pending = append(s.pending, clean...)
	if len(s.pending) > Pending {
		s.pending = s.pending[len(s.pending)-Pending:]
	}
	s.mu.Unlock()
}

func (s *sender) loop() {
	defer close(s.stopped)
	t := time.NewTicker(s.x.Flush)
	defer t.Stop()
	for {
		select {
		case <-t.C:
			s.flush()
		case <-s.done:
			return
		}
	}
}

// flush sends what waits; a batch is taken out before it is sent and goes back in front when the send failed.
func (s *sender) flush() {
	for {
		s.mu.Lock()
		n := min(len(s.pending), protocol.EventsPerBatch)
		batch := s.pending[:n:n]
		s.pending = s.pending[n:]
		s.mu.Unlock()
		if n == 0 {
			return
		}
		err := s.x.Client.Events(context.Background(), s.e.Run.ID, s.e.Run.Attempt, batch)
		switch {
		case client.Replaced(err) || client.Unauthorized(err):
			s.l.decide(replaced)
			return
		case err != nil:
			s.x.Log.Warn("events failed", "run", s.e.Run.ID, "err", err)
			s.mu.Lock()
			s.pending = append(batch, s.pending...)
			if len(s.pending) > Pending {
				s.pending = s.pending[len(s.pending)-Pending:]
			}
			s.mu.Unlock()
			return
		}
	}
}

// close stops the batching; with last it sends what still waits.
func (s *sender) close(last bool) {
	s.once.Do(func() {
		close(s.done)
		<-s.stopped
		if last {
			s.flush()
		}
	})
}
