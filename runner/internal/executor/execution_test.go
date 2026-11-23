package executor

import (
	"testing"
	"time"

	"github.com/baeroe/werkbuch/runner/internal/protocol"
)

func TestSummaryNamesTheStrand(t *testing.T) {
	branch, session := "agent/WEB-51-cookie-banner", "4f2c9e1a"
	run := protocol.Run{ID: "01run", Type: protocol.Task, Thread: &protocol.Thread{Branch: &branch, SessionID: &session}}
	if s := NewExecution(run).Summary(); s.Branch != branch || s.Session != session {
		t.Fatalf("%+v", s)
	}
	if s := NewExecution(protocol.Run{ID: "02run"}).Summary(); s.Branch != "" || s.Session != "" {
		t.Fatalf("%+v", s)
	}
}

func TestFake(t *testing.T) {
	started := time.Date(2026, 11, 23, 9, 38, 0, 0, time.UTC)
	ended := started.Add(11 * time.Minute)
	ev := protocol.Event{Kind: protocol.KindText, Text: "done", At: ended}
	e := Fake(protocol.Run{ID: "01run"}, started, "", protocol.Succeeded, "/work/WEB-44", ended, ev)
	s := e.Summary()
	if !e.Finished() || s.Status != "finished" || s.Result != protocol.Succeeded || !s.Started.Equal(started) || !s.Ended.Equal(ended) || s.Dir != "/work/WEB-44" || s.Lines != 1 {
		t.Fatalf("%+v", s)
	}
	running := Fake(protocol.Run{ID: "02run"}, started, "running", "", "", time.Time{})
	if running.Finished() || running.Summary().Status != "running" {
		t.Fatalf("%+v", running.Summary())
	}
	past, ch, stop := running.Subscribe()
	defer stop()
	Feed(running, ev)
	if len(past) != 0 || (<-ch).Text != "done" {
		t.Fatal("no live line")
	}
}
