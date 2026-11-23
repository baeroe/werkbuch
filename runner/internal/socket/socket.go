// Package socket is the API of the daemon on a Unix socket (0600) for the TUI (WEBU-22) and the commands `status` and
// `update`: HTTP over the socket, JSON.
//
//	GET  /status             the connection, version, places, update, report
//	GET  /runs               running and recent runs
//	GET  /runs/{id}/events   the log of a run as NDJSON, live until it ends
//	POST /runs/{id}/cancel   stops a run (werkbuch hears `canceled`)
//	GET  /load               the last load and the samples of the last minutes
//	GET  /doctor             the checks of `doctor`, made by the daemon with its own environment (A500)
//	POST /update             updates now when no run is left (else when the last ends)
package socket

import (
	"context"
	"encoding/json"
	"errors"
	"net"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"time"

	"github.com/baeroe/werkbuch/runner/internal/executor"
	"github.com/baeroe/werkbuch/runner/internal/protocol"
)

// Status is what `GET /status` answers.
type Status struct {
	Instance        string              `json:"instance"`
	System          string              `json:"system"`
	Version         string              `json:"version"`
	ExpectedVersion string              `json:"expected_version,omitempty"`
	Connected       bool                `json:"connected"`
	LastContact     time.Time           `json:"last_contact,omitzero"`
	LastError       string              `json:"last_error,omitempty"`
	Unauthorized    bool                `json:"unauthorized,omitempty"`
	Places          *protocol.Places    `json:"places,omitempty"`
	Update          string              `json:"update,omitempty"`
	Running         int                 `json:"running"`
	Load            *protocol.Load      `json:"load,omitempty"`
	CLIs            []protocol.CLI      `json:"clis"`
	Equipment       *protocol.Equipment `json:"equipment,omitempty"`
	Started         time.Time           `json:"started"`
}

// LoadAnswer is what `GET /load` answers.
type LoadAnswer struct {
	Last    *protocol.Load  `json:"last"`
	History []protocol.Load `json:"history"`
}

// Check is one finding of `GET /doctor` (the form of doctor.Check, which imports this package).
type Check struct {
	Name   string `json:"name"`
	Level  string `json:"level"`
	Detail string `json:"detail"`
}

// Backend is the daemon as the socket sees it.
type Backend interface {
	Status() Status
	Runs() []executor.Summary
	Execution(id string) *executor.Execution
	Load() LoadAnswer
	RequestUpdate() string
	Doctor(ctx context.Context) []Check
}

// ErrRunning says another daemon listens on the socket.
var ErrRunning = errors.New("a daemon already runs")

// Listen opens the socket; a socket nobody answers on is stale and goes.
func Listen(path string) (net.Listener, error) {
	if c, err := net.DialTimeout("unix", path, time.Second); err == nil {
		c.Close()
		return nil, ErrRunning
	}
	os.Remove(path)
	if err := os.MkdirAll(filepath.Dir(path), 0o700); err != nil {
		return nil, err
	}
	l, err := net.Listen("unix", path)
	if err != nil {
		return nil, err
	}
	if err := os.Chmod(path, 0o600); err != nil {
		l.Close()
		return nil, err
	}
	return l, nil
}

func write(w http.ResponseWriter, status int, v any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	json.NewEncoder(w).Encode(v)
}

// Handler serves the API.
func Handler(b Backend) http.Handler {
	mux := http.NewServeMux()
	mux.HandleFunc("GET /status", func(w http.ResponseWriter, r *http.Request) { write(w, 200, b.Status()) })
	mux.HandleFunc("GET /runs", func(w http.ResponseWriter, r *http.Request) { write(w, 200, b.Runs()) })
	mux.HandleFunc("GET /load", func(w http.ResponseWriter, r *http.Request) { write(w, 200, b.Load()) })
	mux.HandleFunc("GET /doctor", func(w http.ResponseWriter, r *http.Request) { write(w, 200, b.Doctor(r.Context())) })
	mux.HandleFunc("POST /update", func(w http.ResponseWriter, r *http.Request) {
		write(w, 202, map[string]string{"update": b.RequestUpdate()})
	})
	mux.HandleFunc("POST /runs/{id}/cancel", func(w http.ResponseWriter, r *http.Request) {
		e := b.Execution(r.PathValue("id"))
		if e == nil || e.Finished() {
			write(w, 404, map[string]string{"error": "no such run running"})
			return
		}
		e.Cancel()
		write(w, 202, e.Summary())
	})
	mux.HandleFunc("GET /runs/{id}/events", func(w http.ResponseWriter, r *http.Request) {
		e := b.Execution(r.PathValue("id"))
		if e == nil {
			write(w, 404, map[string]string{"error": "no such run"})
			return
		}
		w.Header().Set("Content-Type", "application/x-ndjson")
		past, ch, stop := e.Subscribe()
		defer stop()
		enc := json.NewEncoder(w)
		flusher, _ := w.(http.Flusher)
		for _, ev := range past {
			enc.Encode(ev)
		}
		if flusher != nil {
			flusher.Flush()
		}
		for {
			select {
			case ev, open := <-ch:
				if !open {
					return
				}
				enc.Encode(ev)
				if flusher != nil {
					flusher.Flush()
				}
			case <-r.Context().Done():
				return
			}
		}
	})
	return mux
}

// Serve answers on l until ctx ends.
func Serve(ctx context.Context, l net.Listener, b Backend) error {
	srv := &http.Server{Handler: Handler(b), ReadHeaderTimeout: 5 * time.Second}
	go func() {
		<-ctx.Done()
		sctx, cancel := context.WithTimeout(context.Background(), 2*time.Second)
		defer cancel()
		srv.Shutdown(sctx)
	}()
	err := srv.Serve(l)
	if errors.Is(err, http.ErrServerClosed) {
		return nil
	}
	return err
}

// Client talks to the daemon.
type Client struct{ http *http.Client }

// Dial returns a client of the socket at path.
func Dial(path string) *Client {
	return &Client{http: &http.Client{Transport: &http.Transport{DialContext: func(ctx context.Context, _, _ string) (net.Conn, error) {
		var d net.Dialer
		return d.DialContext(ctx, "unix", path)
	}}}}
}

// Get decodes the answer of a GET.
func (c *Client) Get(ctx context.Context, path string, out any) error {
	return c.do(ctx, http.MethodGet, path, out)
}

// Post decodes the answer of a POST.
func (c *Client) Post(ctx context.Context, path string, out any) error {
	return c.do(ctx, http.MethodPost, path, out)
}

func (c *Client) do(ctx context.Context, method, path string, out any) error {
	req, err := http.NewRequestWithContext(ctx, method, "http://runner"+path, nil)
	if err != nil {
		return err
	}
	resp, err := c.http.Do(req)
	if err != nil {
		return err
	}
	defer resp.Body.Close()
	if resp.StatusCode >= 400 {
		var e struct{ Error string }
		json.NewDecoder(resp.Body).Decode(&e)
		return errors.New(strings.TrimSpace(e.Error))
	}
	if out == nil {
		return nil
	}
	return json.NewDecoder(resp.Body).Decode(out)
}

// Events streams the log of a run until it ends.
func (c *Client) Events(ctx context.Context, id string, each func(protocol.Event)) error {
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, "http://runner/runs/"+id+"/events", nil)
	if err != nil {
		return err
	}
	resp, err := c.http.Do(req)
	if err != nil {
		return err
	}
	defer resp.Body.Close()
	if resp.StatusCode != 200 {
		return errors.New("no such run")
	}
	dec := json.NewDecoder(resp.Body)
	for {
		var ev protocol.Event
		if err := dec.Decode(&ev); err != nil {
			return nil
		}
		each(ev)
	}
}
