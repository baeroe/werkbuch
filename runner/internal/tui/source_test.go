package tui

import (
	"context"
	"os"
	"path/filepath"
	"testing"
	"time"

	"github.com/baeroe/werkbuch/runner/internal/executor"
	"github.com/baeroe/werkbuch/runner/internal/protocol"
	"github.com/baeroe/werkbuch/runner/internal/socket"
)

// backend is a daemon behind the real socket handler.
type backend struct{ e *executor.Execution }

func (b backend) Status() socket.Status {
	return socket.Status{Instance: "https://werkbuch.example.com", System: "linux/amd64", Connected: true, Running: 1}
}
func (b backend) Runs() []executor.Summary { return []executor.Summary{b.e.Summary()} }
func (b backend) Execution(id string) *executor.Execution {
	if id == b.e.Run.ID {
		return b.e
	}
	return nil
}
func (b backend) Load() socket.LoadAnswer {
	return socket.LoadAnswer{Last: &protocol.Load{CPU: 7}, History: []protocol.Load{{CPU: 7}}}
}
func (b backend) RequestUpdate() string { return "none" }
func (b backend) Doctor(ctx context.Context) []socket.Check {
	return []socket.Check{{Name: "git", Level: "ok", Detail: "git version 2.47.1"}}
}

func TestSocketSource(t *testing.T) {
	dir, err := os.MkdirTemp("/tmp", "wr-tui-")
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { os.RemoveAll(dir) })
	path := filepath.Join(dir, "r.sock")
	l, err := socket.Listen(path)
	if err != nil {
		t.Fatal(err)
	}
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	item := &protocol.ItemRef{Key: "WEB-51", Title: "Cookie-Banner"}
	e := executor.Fake(protocol.Run{ID: "01run", Type: "task", Item: item}, time.Now(), "running", "", "", time.Time{},
		protocol.Event{Kind: protocol.KindText, Text: "first"})
	go socket.Serve(ctx, l, backend{e})

	src := NewSocketSource(path)
	if st, err := src.Status(ctx); err != nil || st.System != "linux/amd64" {
		t.Fatalf("%+v %v", st, err)
	}
	if runs, err := src.Runs(ctx); err != nil || len(runs) != 1 || runs[0].Item != "WEB-51" {
		t.Fatalf("%+v %v", runs, err)
	}
	if l, err := src.Load(ctx); err != nil || l.Last.CPU != 7 || len(l.History) != 1 {
		t.Fatalf("%+v %v", l, err)
	}
	if c, err := src.Doctor(ctx); err != nil || len(c) != 1 || c[0].Name != "git" {
		t.Fatalf("%+v %v", c, err)
	}
	got := make(chan string, 4)
	sctx, stop := context.WithCancel(ctx)
	done := make(chan error, 1)
	go func() { done <- src.Events(sctx, "01run", func(ev protocol.Event) { got <- ev.Text }) }()
	if text := <-got; text != "first" {
		t.Fatal(text)
	}
	executor.Feed(e, protocol.Event{Kind: protocol.KindText, Text: "live"})
	select {
	case text := <-got:
		if text != "live" {
			t.Fatal(text)
		}
	case <-time.After(2 * time.Second):
		t.Fatal("no live line")
	}
	stop()
	select {
	case <-done:
	case <-time.After(2 * time.Second):
		t.Fatal("the stream outlived its context")
	}
	if err := src.Cancel(ctx, "01run"); err != nil {
		t.Fatal(err)
	}
	if err := src.Cancel(ctx, "nope"); err == nil {
		t.Fatal("canceled an unknown run")
	}

	// the model against the real socket: Status and the log of the run
	h := &harness{t: t, now: time.Now()}
	h.m = New(Options{Source: src, NoTick: true, Tab: TabRuns, Now: func() time.Time { return h.now }})
	h.send(sizeMsg(120, 30))
	h.run(h.m.Init())
	h.settle(2 * time.Second)
	h.sees("● connected", "WEB-51 task", "first", "live")
}
