package executor

import (
	"context"
	"sync"
	"time"

	"github.com/baeroe/werkbuch/runner/internal/client"
	"github.com/baeroe/werkbuch/runner/internal/protocol"
)

// Pending bounds the lines waiting for werkbuch; past it the oldest go (werkbuch keeps at most 2 000 per run anyway).
const Pending = 2000

// sender batches the log of a run to werkbuch: at most every Flush, at most protocol.EventsPerBatch per request. A
// refusal as replaced stops the run.
type sender struct {
	x       *Executor
	e       *Execution
	mu      sync.Mutex
	pending []protocol.Event
	gone    chan string
	done    chan struct{}
	stopped chan struct{}
	once    sync.Once
}

func newSender(x *Executor, e *Execution) *sender {
	s := &sender{x: x, e: e, gone: make(chan string, 1), done: make(chan struct{}), stopped: make(chan struct{})}
	go s.loop()
	return s
}

func (s *sender) add(events ...protocol.Event) {
	if len(events) == 0 {
		return
	}
	s.e.add(events)
	s.mu.Lock()
	s.pending = append(s.pending, events...)
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

// flush sends what waits; false once werkbuch gave the run away.
func (s *sender) flush() bool {
	for {
		s.mu.Lock()
		n := len(s.pending)
		if n > protocol.EventsPerBatch {
			n = protocol.EventsPerBatch
		}
		batch := append([]protocol.Event(nil), s.pending[:n]...)
		s.mu.Unlock()
		if n == 0 {
			return true
		}
		err := s.x.Client.Events(context.Background(), s.e.Run.ID, s.e.Run.Attempt, batch)
		switch {
		case client.Replaced(err) || client.Unauthorized(err):
			select {
			case s.gone <- replaced:
			default:
			}
			return false
		case err != nil:
			s.x.Log.Warn("events failed", "run", s.e.Run.ID, "err", err)
			return true
		}
		s.mu.Lock()
		s.pending = s.pending[n:]
		s.mu.Unlock()
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
