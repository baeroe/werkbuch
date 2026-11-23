package executor

import (
	"sync"
	"time"

	"github.com/baeroe/werkbuch/runner/internal/protocol"
)

// Keep is how many lines of its log an execution holds for the socket.
const Keep = 500

// Execution is a run on this runner as the daemon, the socket and the TUI see it.
type Execution struct {
	Run     protocol.Run
	Started time.Time

	mu       sync.Mutex
	status   string
	dir      string
	ended    time.Time
	result   string
	events   []protocol.Event
	subs     map[chan protocol.Event]struct{}
	stop     chan string
	stopOnce sync.Once
}

// NewExecution starts the record of a run.
func NewExecution(run protocol.Run) *Execution {
	return &Execution{Run: run, Started: time.Now(), status: "starting", subs: map[chan protocol.Event]struct{}{}, stop: make(chan string, 1)}
}

// Cancel stops the run from this machine (socket, TUI): the CLI ends and werkbuch hears `canceled`.
func (e *Execution) Cancel() {
	e.stopOnce.Do(func() { e.stop <- protocol.Canceled })
}

func (e *Execution) set(status string) {
	e.mu.Lock()
	e.status = status
	e.mu.Unlock()
}

func (e *Execution) finish(status string) {
	e.mu.Lock()
	e.status, e.result, e.ended = "finished", status, time.Now()
	for ch := range e.subs {
		close(ch)
	}
	e.subs = map[chan protocol.Event]struct{}{}
	e.mu.Unlock()
}

func (e *Execution) add(events []protocol.Event) {
	e.mu.Lock()
	defer e.mu.Unlock()
	e.events = append(e.events, events...)
	if len(e.events) > Keep {
		e.events = e.events[len(e.events)-Keep:]
	}
	for ch := range e.subs {
		for _, ev := range events {
			select {
			case ch <- ev:
			default: // a slow reader misses lines, the run never waits for it
			}
		}
	}
}

// Subscribe returns the lines so far and a channel of the next ones, closed when the run ends.
func (e *Execution) Subscribe() ([]protocol.Event, chan protocol.Event, func()) {
	e.mu.Lock()
	defer e.mu.Unlock()
	ch := make(chan protocol.Event, 256)
	past := append([]protocol.Event(nil), e.events...)
	if e.status == "finished" {
		close(ch)
		return past, ch, func() {}
	}
	e.subs[ch] = struct{}{}
	return past, ch, func() {
		e.mu.Lock()
		if _, ok := e.subs[ch]; ok {
			delete(e.subs, ch)
			close(ch)
		}
		e.mu.Unlock()
	}
}

// Summary is what the socket shows of a run.
type Summary struct {
	ID       string    `json:"id"`
	Attempt  int       `json:"attempt"`
	Type     string    `json:"type"`
	CLI      string    `json:"cli"`
	Model    string    `json:"model"`
	Project  string    `json:"project"`
	Item     string    `json:"item,omitempty"`
	Title    string    `json:"title,omitempty"`
	Status   string    `json:"status"`
	Result   string    `json:"result,omitempty"`
	Dir      string    `json:"dir,omitempty"`
	Started  time.Time `json:"started"`
	Ended    time.Time `json:"ended,omitzero"`
	Deadline time.Time `json:"deadline"`
	Lines    int       `json:"lines"`
}

// Summary describes the execution.
func (e *Execution) Summary() Summary {
	e.mu.Lock()
	defer e.mu.Unlock()
	s := Summary{ID: e.Run.ID, Attempt: e.Run.Attempt, Type: e.Run.Type, CLI: e.Run.CLI, Model: e.Run.Model, Project: e.Run.Project.Identifier,
		Status: e.status, Result: e.result, Dir: e.dir, Started: e.Started, Ended: e.ended, Deadline: e.Run.Deadline(e.Started), Lines: len(e.events)}
	if e.Run.Item != nil {
		s.Item, s.Title = e.Run.Item.Key, e.Run.Item.Title
	}
	return s
}

// Finished says whether the run ended.
func (e *Execution) Finished() bool {
	e.mu.Lock()
	defer e.mu.Unlock()
	return e.status == "finished"
}
