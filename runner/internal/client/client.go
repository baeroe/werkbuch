// Package client speaks the runner protocol with werkbuch (spec 6): every request names the version of the runner and
// the protocol in headers, all but pairing carry the runner token. Refusals come back as problem details
// (*ProblemError). The token never appears in an error.
package client

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"strconv"
	"strings"
	"time"

	"github.com/baeroe/werkbuch/runner/internal/protocol"
	"github.com/baeroe/werkbuch/runner/internal/redact"
)

// Client talks to one instance.
type Client struct {
	Instance string
	Token    string
	Version  string
	HTTP     *http.Client
}

// New returns a client with sensible timeouts.
func New(instance, token, version string) *Client {
	return &Client{Instance: strings.TrimRight(instance, "/"), Token: token, Version: version, HTTP: &http.Client{Timeout: 30 * time.Second}}
}

// ProblemError is a refusal of werkbuch (RFC 9457 with werkbuch's `reason` and field errors).
type ProblemError struct {
	Status int                 `json:"status"`
	Reason string              `json:"reason"`
	Title  string              `json:"title"`
	Detail string              `json:"detail"`
	Errors map[string][]string `json:"errors"`
}

func (p *ProblemError) Error() string {
	text := p.Detail
	if text == "" {
		text = p.Title
	}
	msg := fmt.Sprintf("%d %s: %s", p.Status, p.Reason, text)
	for field, list := range p.Errors {
		msg += fmt.Sprintf("; %s: %s", field, strings.Join(list, " "))
	}
	return redact.String(msg)
}

// Reason says whether err is a problem with this reason (or this status when reason is empty).
func Reason(err error, status int, reason string) bool {
	var p *ProblemError
	if !errors.As(err, &p) {
		return false
	}
	return p.Status == status && (reason == "" || p.Reason == reason)
}

// Replaced says werkbuch took the run away: another attempt, another runner, or no such run (the runner stops the CLI
// and reports nothing, A475).
func Replaced(err error) bool {
	return Reason(err, http.StatusConflict, "run_replaced") || Reason(err, http.StatusNotFound, "")
}

// Unauthorized says the token was refused (revoked runner): the runner has to be paired again.
func Unauthorized(err error) bool { return Reason(err, http.StatusUnauthorized, "") }

func (c *Client) do(ctx context.Context, method, path string, body, out any, auth bool) error {
	var reader io.Reader
	if body != nil {
		data, err := json.Marshal(body)
		if err != nil {
			return err
		}
		reader = bytes.NewReader(data)
	}
	req, err := http.NewRequestWithContext(ctx, method, c.Instance+path, reader)
	if err != nil {
		return err
	}
	req.Header.Set("Accept", "application/json")
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("User-Agent", "werkbuch-runner/"+c.Version)
	req.Header.Set("X-Werkbuch-Runner-Version", c.Version)
	req.Header.Set("X-Werkbuch-Protocol", strconv.Itoa(protocol.Version))
	if auth {
		req.Header.Set("Authorization", "Bearer "+c.Token)
	}
	resp, err := c.HTTP.Do(req)
	if err != nil {
		return errors.New(redact.String(err.Error()))
	}
	defer resp.Body.Close()
	data, err := io.ReadAll(io.LimitReader(resp.Body, 16<<20))
	if err != nil {
		return err
	}
	if resp.StatusCode >= 400 {
		p := &ProblemError{Status: resp.StatusCode}
		if json.Unmarshal(data, p) != nil || p.Status == 0 {
			p.Status = resp.StatusCode
			p.Title = http.StatusText(resp.StatusCode)
		}
		return p
	}
	if out != nil && len(data) > 0 {
		if err := json.Unmarshal(data, out); err != nil {
			return fmt.Errorf("%s %s: unreadable answer: %w", method, path, err)
		}
	}
	return nil
}

// Pair redeems a one-time code; the answer carries the token once.
func (c *Client) Pair(ctx context.Context, req protocol.PairRequest) (protocol.PairAnswer, error) {
	var a protocol.PairAnswer
	err := c.do(ctx, http.MethodPost, "/api/runner/pair", req, &a, false)
	return a, err
}

// Claim asks for work with the report; Run is nil without one.
func (c *Client) Claim(ctx context.Context, report protocol.Report) (protocol.ClaimAnswer, error) {
	var a protocol.ClaimAnswer
	err := c.do(ctx, http.MethodPost, "/api/runner/claim", report, &a, true)
	return a, err
}

// Heartbeat extends the lease of a run and says whether it was canceled.
func (c *Client) Heartbeat(ctx context.Context, runID string, attempt int, report protocol.Report) (protocol.HeartbeatAnswer, error) {
	var a protocol.HeartbeatAnswer
	body := struct {
		Attempt int `json:"attempt"`
		protocol.Report
	}{attempt, report}
	err := c.do(ctx, http.MethodPost, "/api/runner/runs/"+runID+"/heartbeat", body, &a, true)
	return a, err
}

// Events sends a batch of log lines (at most protocol.EventsPerBatch).
func (c *Client) Events(ctx context.Context, runID string, attempt int, events []protocol.Event) error {
	body := struct {
		Attempt int              `json:"attempt"`
		Events  []protocol.Event `json:"events"`
	}{attempt, events}
	return c.do(ctx, http.MethodPost, "/api/runner/runs/"+runID+"/events", body, nil, true)
}

// Result ends a run.
func (c *Client) Result(ctx context.Context, runID string, result protocol.Result) error {
	return c.do(ctx, http.MethodPost, "/api/runner/runs/"+runID+"/result", result, nil, true)
}

// noRun is a ULID no run has: the probe of the token (A493).
const noRun = "00000000000000000000000000"

// Probe checks the token without touching any run: a heartbeat of a run that cannot exist answers 404 to a valid
// token and 401 to a refused one (A493).
func (c *Client) Probe(ctx context.Context) error {
	_, err := c.Heartbeat(ctx, noRun, 1, protocol.Report{})
	if Reason(err, http.StatusNotFound, "") {
		return nil
	}
	if err == nil {
		return errors.New("probe: werkbuch answered a run that cannot exist")
	}
	return err
}

// Download fetches a file of the instance without the token (the binary is no secret, spec 8.2).
func (c *Client) Download(ctx context.Context, path string, limit int64) ([]byte, error) {
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, c.Instance+path, nil)
	if err != nil {
		return nil, err
	}
	req.Header.Set("User-Agent", "werkbuch-runner/"+c.Version)
	resp, err := c.HTTP.Do(req)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("GET %s: %d", path, resp.StatusCode)
	}
	data, err := io.ReadAll(io.LimitReader(resp.Body, limit+1))
	if err != nil {
		return nil, err
	}
	if int64(len(data)) > limit {
		return nil, fmt.Errorf("GET %s: larger than %d bytes", path, limit)
	}
	return data, nil
}
