// Package fakewerkbuch is a werkbuch for tests: the runner protocol of PR #65 (pair, claim, heartbeat, events, result,
// problem details, attempts) in memory, plus the downloads of WEBU-23. Tests queue runs, cancel or replace them and read
// what the runner sent.
package fakewerkbuch

import (
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"time"

	"github.com/baeroe/werkbuch/runner/internal/protocol"
)

// Token is the runner token the fake hands out.
const Token = "wbr_fakefakefakefakefakefakefakefakefakefakefake1"

// Code is the one-time code it accepts.
const Code = "ABCD-EFGH"

// RunState is what the fake knows of a run.
type RunState struct {
	Run      protocol.Run
	Status   string
	Canceled bool
	Events   []protocol.Event
	Result   *protocol.Result
	Beats    int
}

// Server is the fake.
type Server struct {
	*httptest.Server
	mu        sync.Mutex
	Version   string
	queue     []string
	runs      map[string]*RunState
	Reports   []protocol.Report
	Requests  []*http.Request
	Headers   []http.Header
	Paired    []protocol.PairRequest
	used      bool
	Binary    []byte
	Checksum  string
	Heartbeat int
}

// New starts the fake.
func New() *Server {
	s := &Server{Version: "1.0.0", runs: map[string]*RunState{}, Heartbeat: 15}
	s.Server = httptest.NewServer(http.HandlerFunc(s.handle))
	return s
}

// Queue adds a run waiting for a runner.
func (s *Server) Queue(run protocol.Run) {
	s.mu.Lock()
	defer s.mu.Unlock()
	if run.Attempt == 0 {
		run.Attempt = 1
	}
	s.runs[run.ID] = &RunState{Run: run, Status: "queued"}
	s.queue = append(s.queue, run.ID)
}

// Cancel marks a running run `canceling`: the next heartbeat says it.
func (s *Server) Cancel(id string) {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.runs[id].Canceled = true
}

// Replace gives a run a new attempt, as when its lease ran out (A475): the old attempt gets 409 run_replaced.
func (s *Server) Replace(id string) {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.runs[id].Run.Attempt++
}

// State returns a copy of what the fake knows of a run.
func (s *Server) State(id string) RunState {
	s.mu.Lock()
	defer s.mu.Unlock()
	st := *s.runs[id]
	st.Events = append([]protocol.Event(nil), st.Events...)
	return st
}

// LastReport is the last report the runner sent.
func (s *Server) LastReport() (protocol.Report, bool) {
	s.mu.Lock()
	defer s.mu.Unlock()
	if len(s.Reports) == 0 {
		return protocol.Report{}, false
	}
	return s.Reports[len(s.Reports)-1], true
}

// Paths lists the paths the runner asked for.
func (s *Server) Paths() []string {
	s.mu.Lock()
	defer s.mu.Unlock()
	var out []string
	for _, r := range s.Requests {
		out = append(out, r.Method+" "+r.URL.Path)
	}
	return out
}

func problem(w http.ResponseWriter, status int, reason, detail string) {
	w.Header().Set("Content-Type", "application/problem+json")
	w.WriteHeader(status)
	json.NewEncoder(w).Encode(map[string]any{"type": "about:blank", "title": http.StatusText(status), "status": status, "reason": reason, "detail": detail})
}

func (s *Server) answer() map[string]any {
	return map[string]any{
		"places":            map[string]any{"total": 2, "per_repo": 1, "light": 2, "used": map[string]int{"total": 0, "per_repo": 0, "light": 0}},
		"version":           s.Version,
		"protocol":          protocol.Version,
		"heartbeat_seconds": s.Heartbeat,
	}
}

func merge(a map[string]any, b map[string]any) map[string]any {
	for k, v := range b {
		a[k] = v
	}
	return a
}

func (s *Server) handle(w http.ResponseWriter, r *http.Request) {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.Requests = append(s.Requests, r)
	s.Headers = append(s.Headers, r.Header.Clone())

	if strings.HasPrefix(r.URL.Path, "/runner/download/") {
		if strings.HasSuffix(r.URL.Path, ".sha256") {
			fmt.Fprintf(w, "%s  werkbuch-runner\n", s.Checksum)
			return
		}
		if s.Binary == nil {
			http.NotFound(w, r)
			return
		}
		w.Write(s.Binary)
		return
	}
	if r.Method != http.MethodPost || !strings.HasPrefix(r.URL.Path, "/api/runner/") {
		http.NotFound(w, r)
		return
	}
	var body map[string]json.RawMessage
	json.NewDecoder(r.Body).Decode(&body)
	path := strings.TrimPrefix(r.URL.Path, "/api/runner/")

	if path == "pair" {
		var req protocol.PairRequest
		raw, _ := json.Marshal(body)
		json.Unmarshal(raw, &req)
		s.Paired = append(s.Paired, req)
		if req.Code != Code {
			problem(w, 422, "validation_failed", "The code is unknown.")
			return
		}
		if s.used {
			problem(w, 422, "validation_failed", "The code was used already.")
			return
		}
		s.used = true
		w.WriteHeader(201)
		json.NewEncoder(w).Encode(merge(s.answer(), map[string]any{"runner": map[string]string{"id": "01runner", "name": req.Name}, "token": Token}))
		return
	}
	if r.Header.Get("Authorization") != "Bearer "+Token {
		problem(w, 401, "unauthenticated", "")
		return
	}
	report := func() {
		var rep protocol.Report
		raw, _ := json.Marshal(body)
		json.Unmarshal(raw, &rep)
		s.Reports = append(s.Reports, rep)
	}

	if path == "claim" {
		report()
		a := s.answer()
		a["run"] = nil
		if len(s.queue) > 0 {
			id := s.queue[0]
			s.queue = s.queue[1:]
			st := s.runs[id]
			st.Status = "running"
			run := st.Run
			a["run"] = run
		}
		json.NewEncoder(w).Encode(a)
		return
	}

	parts := strings.Split(path, "/")
	if len(parts) != 3 || parts[0] != "runs" {
		http.NotFound(w, r)
		return
	}
	st, ok := s.runs[parts[1]]
	if !ok {
		problem(w, 404, "not_found", "")
		return
	}
	var attempt int
	json.Unmarshal(body["attempt"], &attempt)
	if attempt != st.Run.Attempt || st.Status != "running" {
		problem(w, 409, "run_replaced", "")
		return
	}
	switch parts[2] {
	case "heartbeat":
		report()
		st.Beats++
		deadline := st.Run.Deadline(time.Now())
		json.NewEncoder(w).Encode(merge(s.answer(), map[string]any{"cancel": st.Canceled, "deadline_at": deadline, "lease_expires_at": time.Now().Add(time.Minute)}))
	case "events":
		var events []protocol.Event
		json.Unmarshal(body["events"], &events)
		if len(events) == 0 || len(events) > protocol.EventsPerBatch {
			problem(w, 422, "validation_failed", "events")
			return
		}
		st.Events = append(st.Events, events...)
		json.NewEncoder(w).Encode(map[string]int{"stored": len(events), "dropped": 0})
	case "result":
		var res protocol.Result
		raw, _ := json.Marshal(body)
		json.Unmarshal(raw, &res)
		st.Result = &res
		st.Status = res.Status
		json.NewEncoder(w).Encode(map[string]any{"run": map[string]string{"id": st.Run.ID, "status": res.Status}})
	default:
		http.NotFound(w, r)
	}
}
