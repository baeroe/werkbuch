package tui

import (
	"context"

	"github.com/baeroe/werkbuch/runner/internal/executor"
	"github.com/baeroe/werkbuch/runner/internal/protocol"
	"github.com/baeroe/werkbuch/runner/internal/socket"
)

// Source is what the TUI reads from the daemon (the socket API, A499, A500); tests give a fake one.
type Source interface {
	Status(ctx context.Context) (socket.Status, error)
	Runs(ctx context.Context) ([]executor.Summary, error)
	Load(ctx context.Context) (socket.LoadAnswer, error)
	// Events calls each for every line of the log of a run, live until the run ends or ctx is done.
	Events(ctx context.Context, id string, each func(protocol.Event)) error
	Cancel(ctx context.Context, id string) error
	Doctor(ctx context.Context) ([]socket.Check, error)
}

// SocketSource talks to the daemon over its socket.
type SocketSource struct{ Client *socket.Client }

// NewSocketSource is the source of the socket at path.
func NewSocketSource(path string) SocketSource { return SocketSource{Client: socket.Dial(path)} }

func (s SocketSource) Status(ctx context.Context) (socket.Status, error) {
	var st socket.Status
	return st, s.Client.Get(ctx, "/status", &st)
}

func (s SocketSource) Runs(ctx context.Context) ([]executor.Summary, error) {
	var runs []executor.Summary
	return runs, s.Client.Get(ctx, "/runs", &runs)
}

func (s SocketSource) Load(ctx context.Context) (socket.LoadAnswer, error) {
	var l socket.LoadAnswer
	return l, s.Client.Get(ctx, "/load", &l)
}

func (s SocketSource) Events(ctx context.Context, id string, each func(protocol.Event)) error {
	return s.Client.Events(ctx, id, each)
}

func (s SocketSource) Cancel(ctx context.Context, id string) error {
	return s.Client.Post(ctx, "/runs/"+id+"/cancel", nil)
}

func (s SocketSource) Doctor(ctx context.Context) ([]socket.Check, error) {
	var checks []socket.Check
	return checks, s.Client.Get(ctx, "/doctor", &checks)
}
