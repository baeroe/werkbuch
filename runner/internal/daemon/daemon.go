// Package daemon is `werkbuch-runner daemon` (spec 6.1, 8): it polls werkbuch, also without a free place (then it only
// reports load, CLIs and equipment and hears its places and the expected version), every 3 s without work and every
// 10 s after a minute without, at once after it got a run. Runs execute side by side; their places count in werkbuch.
// When werkbuch names another version, the daemon takes no new runs, updates once none is left and starts again.
// Worktrees of strands without a run for three days go (A497).
package daemon

import (
	"context"
	"log/slog"
	"runtime"
	"sort"
	"sync"
	"sync/atomic"
	"time"

	"github.com/baeroe/werkbuch/runner/internal/client"
	"github.com/baeroe/werkbuch/runner/internal/clis"
	"github.com/baeroe/werkbuch/runner/internal/equipment"
	"github.com/baeroe/werkbuch/runner/internal/executor"
	"github.com/baeroe/werkbuch/runner/internal/git"
	"github.com/baeroe/werkbuch/runner/internal/load"
	"github.com/baeroe/werkbuch/runner/internal/protocol"
	"github.com/baeroe/werkbuch/runner/internal/socket"
	"github.com/baeroe/werkbuch/runner/internal/update"
)

// Recent is how many ended runs the daemon remembers for the socket.
const Recent = 20

// Updater is the part of update the daemon uses.
type Updater interface {
	Apply(ctx context.Context, version string) error
	Restart() error
}

// Daemon holds the state of the runner.
type Daemon struct {
	Instance  string
	Version   string
	Client    *client.Client
	Executor  *executor.Executor
	Sampler   *load.Sampler
	CLIs      *clis.Detector
	Equipment *equipment.Collector
	Updater   Updater
	Log       *slog.Logger
	// Checks runs the checks of `doctor` in the environment of the daemon (`GET /doctor`, A500).
	Checks func(ctx context.Context) []socket.Check

	// Fast and Slow are the intervals of polling without work, Slow after SlowAfter without any.
	Fast, Slow, SlowAfter time.Duration
	// Sweep is how often old worktrees are removed; Keep how old they get.
	Sweep, Keep time.Duration
	// UpdateRetry is the pause after a failed update.
	UpdateRetry time.Duration

	mu           sync.Mutex
	started      time.Time
	running      map[string]*executor.Execution
	recent       []*executor.Execution
	connected    bool
	lastContact  time.Time
	lastError    string
	unauthorized bool
	places       *protocol.Places
	expected     string
	update       string // "", pending, failed: …
	updateAfter  time.Time
	forceUpdate  bool
	wake         chan struct{}
	once         sync.Once
	report       protocol.Report
	reportAt     time.Time
	sweeping     atomic.Bool
	doctorMu     sync.Mutex
	doctorRun    *doctorRun
}

// doctorRun is the one run of the checks in flight: a second `GET /doctor` waits for it instead of starting its own.
type doctorRun struct {
	done   chan struct{}
	checks []socket.Check
}

// ReportEvery is how often the report is refreshed in the background; claims and heartbeats only read it.
const ReportEvery = 15 * time.Second

func (d *Daemon) defaults() { d.once.Do(d.setDefaults) }

func (d *Daemon) setDefaults() {
	if d.Fast == 0 {
		d.Fast = 3 * time.Second
	}
	if d.Slow == 0 {
		d.Slow = 10 * time.Second
	}
	if d.SlowAfter == 0 {
		d.SlowAfter = time.Minute
	}
	if d.Sweep == 0 {
		d.Sweep = time.Hour
	}
	if d.Keep == 0 {
		d.Keep = git.KeepFor
	}
	if d.UpdateRetry == 0 {
		d.UpdateRetry = 10 * time.Minute
	}
	d.running = map[string]*executor.Execution{}
	d.wake = make(chan struct{}, 1)
	d.started = time.Now()
}

// Report is the report of every claim and heartbeat (spec 8.6–8.8): the last refresh of CLIs and equipment, the last
// load sample. It never waits for a command (`claude mcp list` can take seconds).
func (d *Daemon) Report() protocol.Report {
	d.mu.Lock()
	r := d.report
	r.CLIs = append([]protocol.CLI(nil), d.report.CLIs...)
	d.mu.Unlock()
	if d.Sampler != nil {
		r.Load = d.Sampler.Last()
	}
	return r
}

// refreshReport asks the CLIs and the equipment (each with its own cache) and keeps the answer.
func (d *Daemon) refreshReport(ctx context.Context) {
	r := protocol.Report{CLIs: d.CLIs.All(ctx, false)}
	if d.Equipment != nil {
		eq := d.Equipment.Collect(ctx, false)
		r.Equipment = &eq
	}
	d.mu.Lock()
	d.report, d.reportAt = r, time.Now()
	d.mu.Unlock()
}

func (d *Daemon) refreshLoop(ctx context.Context) {
	for {
		select {
		case <-ctx.Done():
			return
		case <-time.After(ReportEvery):
			d.refreshReport(ctx)
		}
	}
}

// Run polls until ctx ends; it returns after a restart failed or ctx ended, once the runs stopped.
func (d *Daemon) Run(ctx context.Context) error {
	d.defaults()
	d.Executor.Report = d.Report
	if d.Equipment != nil {
		d.Executor.Werkbuch = d.Equipment.Seen
	}
	var wg sync.WaitGroup
	defer wg.Wait()
	d.refreshReport(ctx)
	go d.refreshLoop(ctx)

	idleSince := time.Now()
	lastSweep := time.Now()
	for {
		if ctx.Err() != nil {
			return nil
		}
		if d.updateDue() {
			if d.applyUpdate(ctx) {
				wg.Wait()
				d.Log.Info("restarting with the new binary")
				return d.Updater.Restart()
			}
		}
		wait := d.Fast
		if !d.updatePending() {
			got := d.claim(ctx, &wg)
			switch {
			case got:
				idleSince = time.Now()
				wait = 0
			case time.Since(idleSince) >= d.SlowAfter:
				wait = d.Slow
			}
		}
		if time.Since(lastSweep) >= d.Sweep {
			lastSweep = time.Now()
			d.sweepInBackground(ctx, &wg)
		}
		select {
		case <-ctx.Done():
			return nil
		case <-d.wake:
		case <-time.After(wait):
		}
	}
}

func (d *Daemon) claim(ctx context.Context, wg *sync.WaitGroup) bool {
	a, err := d.Client.Claim(ctx, d.Report())
	d.mu.Lock()
	defer d.mu.Unlock()
	if err != nil {
		d.connected = false
		d.lastError = err.Error()
		d.unauthorized = client.Unauthorized(err)
		d.Log.Warn("claim failed", "err", err)
		return false
	}
	d.connected, d.lastContact, d.lastError, d.unauthorized = true, time.Now(), "", false
	d.places = &a.Places
	d.expected = a.Version
	if update.Compare(d.Version, a.Version) && d.update == "" {
		d.update = "pending"
		d.Log.Info("werkbuch expects another version", "running", d.Version, "expected", a.Version)
	}
	if a.HeartbeatSeconds > 0 {
		d.Executor.SetHeartbeat(time.Duration(a.HeartbeatSeconds) * time.Second)
	}
	if a.Run == nil {
		return false
	}
	e := executor.NewExecution(*a.Run)
	d.running[a.Run.ID] = e
	d.Log.Info("run claimed", "run", a.Run.ID, "type", a.Run.Type, "project", a.Run.Project.Identifier)
	wg.Add(1)
	go func() {
		defer wg.Done()
		d.Executor.Run(ctx, e)
		d.mu.Lock()
		delete(d.running, e.Run.ID)
		d.recent = append([]*executor.Execution{e}, d.recent...)
		if len(d.recent) > Recent {
			d.recent = d.recent[:Recent]
		}
		d.mu.Unlock()
		d.poke()
	}()
	return true
}

func (d *Daemon) poke() {
	select {
	case d.wake <- struct{}{}:
	default:
	}
}

func (d *Daemon) updatePending() bool {
	d.mu.Lock()
	defer d.mu.Unlock()
	return d.update == "pending"
}

func (d *Daemon) updateDue() bool {
	d.mu.Lock()
	defer d.mu.Unlock()
	if d.Updater == nil || len(d.running) > 0 {
		return false
	}
	if d.update == "pending" || (d.forceUpdate && update.Compare(d.Version, d.expected)) {
		return time.Now().After(d.updateAfter)
	}
	return false
}

func (d *Daemon) applyUpdate(ctx context.Context) bool {
	d.mu.Lock()
	version := d.expected
	d.forceUpdate = false
	d.mu.Unlock()
	d.Log.Info("updating", "to", version)
	err := d.Updater.Apply(ctx, version)
	d.mu.Lock()
	defer d.mu.Unlock()
	if err != nil {
		d.update = "failed: " + err.Error()
		d.updateAfter = time.Now().Add(d.UpdateRetry)
		d.Log.Error("update failed, the runner goes on with its version", "err", err)
		go func() {
			time.Sleep(d.UpdateRetry)
			d.mu.Lock()
			if d.update != "" && d.update != "pending" {
				d.update = ""
			}
			d.mu.Unlock()
		}()
		return false
	}
	return true
}

// RequestUpdate updates when werkbuch expects another version (now, or when the last run ends).
func (d *Daemon) RequestUpdate() string {
	d.defaults()
	d.mu.Lock()
	defer d.mu.Unlock()
	if !update.Compare(d.Version, d.expected) {
		return "the runner has the version werkbuch expects (" + d.Version + ")"
	}
	d.update, d.forceUpdate, d.updateAfter = "pending", true, time.Time{}
	d.poke()
	return "updating to " + d.expected + " when no run is left"
}

// sweepInBackground removes old worktrees beside the polling (teardowns can take minutes); one sweep at a time.
func (d *Daemon) sweepInBackground(ctx context.Context, wg *sync.WaitGroup) bool {
	if !d.sweeping.CompareAndSwap(false, true) {
		return false
	}
	wg.Add(1)
	go func() {
		defer wg.Done()
		defer d.sweeping.Store(false)
		d.sweep(ctx)
	}()
	return true
}

func (d *Daemon) sweep(ctx context.Context) {
	for _, dir := range d.Executor.Git.Sweep(ctx, d.Keep, d.Executor.TrySlot, d.Executor.Teardown) {
		d.Log.Info("removed an old worktree", "dir", dir)
	}
}

// Status is the answer of the socket.
func (d *Daemon) Status() socket.Status {
	d.defaults()
	d.mu.Lock()
	s := socket.Status{Instance: d.Instance, System: runtime.GOOS + "/" + runtime.GOARCH, Version: d.Version, ExpectedVersion: d.expected, Connected: d.connected, LastContact: d.lastContact,
		LastError: d.lastError, Unauthorized: d.unauthorized, Places: d.places, Update: d.update, Running: len(d.running), Started: d.started, Now: time.Now()}
	d.mu.Unlock()
	r := d.Report()
	s.Load, s.CLIs, s.Equipment = r.Load, r.CLIs, r.Equipment
	return s
}

// Doctor is the answer of `GET /doctor`: the version of the daemon against the one werkbuch expects, then the checks.
func (d *Daemon) Doctor(ctx context.Context) []socket.Check {
	d.mu.Lock()
	expected, upd := d.expected, d.update
	d.mu.Unlock()
	version := socket.Check{Name: "version", Level: "ok", Detail: d.Version}
	switch {
	case d.Version == "dev":
		version.Detail = "dev (a build without a version never updates itself)"
	case expected != "" && expected != d.Version:
		version.Level, version.Detail = "warn", d.Version+", werkbuch expects "+expected
		if upd != "" {
			version.Detail += " (update " + upd + ")"
		}
	}
	return append([]socket.Check{version}, d.checks(ctx)...)
}

// checks runs Checks once at a time: callers that come while a run is in flight share its answer (it asks the CLIs,
// the keychain and the instance and can take seconds).
func (d *Daemon) checks(ctx context.Context) []socket.Check {
	if d.Checks == nil {
		return nil
	}
	d.doctorMu.Lock()
	run := d.doctorRun
	if run == nil {
		run = &doctorRun{done: make(chan struct{})}
		d.doctorRun = run
		d.doctorMu.Unlock()
		// even after a panic in Checks the run leaves the table and its waiters go on
		defer func() {
			d.doctorMu.Lock()
			d.doctorRun = nil
			d.doctorMu.Unlock()
			close(run.done)
		}()
		// the run outlives a caller that gives up, the others still wait for it
		rctx, cancel := context.WithTimeout(context.WithoutCancel(ctx), 2*time.Minute)
		defer cancel()
		run.checks = d.Checks(rctx)
		return run.checks
	}
	d.doctorMu.Unlock()
	select {
	case <-run.done:
		return run.checks
	case <-ctx.Done():
		return nil
	}
}

// Runs lists the running runs, then the recent ones.
func (d *Daemon) Runs() []executor.Summary {
	d.defaults()
	d.mu.Lock()
	defer d.mu.Unlock()
	out := []executor.Summary{}
	for _, e := range d.running {
		out = append(out, e.Summary())
	}
	sort.Slice(out, func(i, j int) bool { return out[i].Started.Before(out[j].Started) })
	for _, e := range d.recent {
		out = append(out, e.Summary())
	}
	return out
}

// Execution finds a running or recent run.
func (d *Daemon) Execution(id string) *executor.Execution {
	d.defaults()
	d.mu.Lock()
	defer d.mu.Unlock()
	if e, ok := d.running[id]; ok {
		return e
	}
	for _, e := range d.recent {
		if e.Run.ID == id {
			return e
		}
	}
	return nil
}

// Load is the answer of `GET /load`.
func (d *Daemon) Load() socket.LoadAnswer {
	if d.Sampler == nil {
		return socket.LoadAnswer{History: []protocol.Load{}}
	}
	return socket.LoadAnswer{Last: d.Sampler.Last(), History: d.Sampler.History()}
}
