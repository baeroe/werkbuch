package socket

import (
	"context"
	"errors"
	"path/filepath"
	"testing"
	"time"

	"github.com/baeroe/werkbuch/runner/internal/executor"
	"github.com/baeroe/werkbuch/runner/internal/protocol"
)

type backend struct{ e *executor.Execution }

func (b backend) Status() Status           { return Status{Instance: "https://werkbuch.example.com", Running: 1} }
func (b backend) Runs() []executor.Summary { return []executor.Summary{b.e.Summary()} }
func (b backend) Execution(id string) *executor.Execution {
	if id == b.e.Run.ID {
		return b.e
	}
	return nil
}
func (b backend) Load() LoadAnswer      { return LoadAnswer{Last: &protocol.Load{CPU: 5}} }
func (b backend) RequestUpdate() string { return "none" }
func (b backend) Doctor(ctx context.Context) []Check {
	return []Check{{Name: "git", Level: "ok", Detail: "git version 2.47.1"}, {Name: "codex", Level: "warn", Detail: "not signed in"}}
}

func TestSocket(t *testing.T) {
	dir, err := filepath.Abs(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	path := filepath.Join(dir, "r.sock")
	if len(path) > 100 {
		path = filepath.Join("/tmp", "wr-"+filepath.Base(dir)+".sock")
		t.Cleanup(func() {})
	}
	l, err := Listen(path)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := Listen(path); !errors.Is(err, ErrRunning) {
		t.Fatalf("second daemon: %v", err)
	}
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	e := executor.NewExecution(protocol.Run{ID: "01run", Type: "task"})
	go Serve(ctx, l, backend{e})
	c := Dial(path)

	var st Status
	if err := c.Get(ctx, "/status", &st); err != nil || st.Running != 1 {
		t.Fatalf("%+v %v", st, err)
	}
	var runs []executor.Summary
	if err := c.Get(ctx, "/runs", &runs); err != nil || len(runs) != 1 || runs[0].ID != "01run" {
		t.Fatalf("%+v %v", runs, err)
	}
	var load LoadAnswer
	if err := c.Get(ctx, "/load", &load); err != nil || load.Last.CPU != 5 {
		t.Fatal(err)
	}
	var checks []Check
	if err := c.Get(ctx, "/doctor", &checks); err != nil || len(checks) != 2 || checks[1] != (Check{Name: "codex", Level: "warn", Detail: "not signed in"}) {
		t.Fatalf("%+v %v", checks, err)
	}
	var upd map[string]string
	if err := c.Post(ctx, "/update", &upd); err != nil || upd["update"] != "none" {
		t.Fatal(err)
	}
	var se *StatusError
	if err := c.Post(ctx, "/runs/nope/cancel", nil); !errors.As(err, &se) || se.Code != 404 || err.Error() != "no such run running" {
		t.Fatalf("unknown run canceled: %v", err)
	}
	if err := c.Get(ctx, "/nope", nil); !errors.As(err, &se) || se.Code != 404 || err.Error() != "Not Found" {
		t.Fatalf("an unknown route: %v", err)
	}
	if err := c.Post(ctx, "/runs/01run/cancel", nil); err != nil {
		t.Fatal(err)
	}

	got := make(chan string, 10)
	go c.Events(ctx, "01run", func(ev protocol.Event) { got <- ev.Text })
	time.Sleep(100 * time.Millisecond)
	executor.Feed(e, protocol.Event{Kind: "text", Text: "live"})
	select {
	case text := <-got:
		if text != "live" {
			t.Fatal(text)
		}
	case <-time.After(2 * time.Second):
		t.Fatal("no live line")
	}
	if err := c.Events(ctx, "nope", func(protocol.Event) {}); err == nil {
		t.Fatal("unknown run streamed")
	}
}
