package daemon

import (
	"context"
	"errors"
	"io"
	"log/slog"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/baeroe/werkbuch/runner/internal/client"
	"github.com/baeroe/werkbuch/runner/internal/clis"
	"github.com/baeroe/werkbuch/runner/internal/executor"
	"github.com/baeroe/werkbuch/runner/internal/fakewerkbuch"
	"github.com/baeroe/werkbuch/runner/internal/git"
	"github.com/baeroe/werkbuch/runner/internal/protocol"
	"github.com/baeroe/werkbuch/runner/internal/socket"
	"github.com/baeroe/werkbuch/runner/internal/sysexec"
)

type fakeUpdater struct {
	mu      sync.Mutex
	applied []string
	fail    error
}

var errRestarted = errors.New("restarted")

func (u *fakeUpdater) Apply(ctx context.Context, v string) error {
	u.mu.Lock()
	defer u.mu.Unlock()
	u.applied = append(u.applied, v)
	return u.fail
}
func (u *fakeUpdater) Restart() error { return errRestarted }

func newDaemon(t *testing.T, fake *fakewerkbuch.Server) *Daemon {
	bin := t.TempDir()
	src, _ := filepath.Abs("../../testdata/claude")
	os.Symlink(src, filepath.Join(bin, "claude"))
	t.Setenv("PATH", bin+":"+os.Getenv("PATH"))
	c := client.New(fake.URL, fakewerkbuch.Token, "1.0.0")
	return &Daemon{
		Instance: fake.URL, Version: "1.0.0", Client: c,
		Executor: &executor.Executor{Client: c, Git: &git.Manager{Data: t.TempDir()}, Grace: 200 * time.Millisecond, Flush: 30 * time.Millisecond, Retry: time.Second},
		CLIs:     &clis.Detector{Run: sysexec.Run},
		Log:      slog.New(slog.NewTextHandler(io.Discard, nil)),
		Fast:     20 * time.Millisecond, Slow: 50 * time.Millisecond, SlowAfter: 200 * time.Millisecond,
		Updater: &fakeUpdater{}, UpdateRetry: time.Hour,
	}
}

func eventually(t *testing.T, what string, ok func() bool) {
	t.Helper()
	deadline := time.Now().Add(10 * time.Second)
	for !ok() {
		if time.Now().After(deadline) {
			t.Fatalf("never: %s", what)
		}
		time.Sleep(20 * time.Millisecond)
	}
}

func run(id, prompt string) protocol.Run {
	r := protocol.Run{ID: id, Type: protocol.Comment, CLI: "claude", Model: "haiku", TimeoutMinutes: 10, Prompt: prompt}
	r.Project.Identifier = "WEB"
	r.Werkbuch.Token = "tok-" + id + "-longenough"
	return r
}

func TestPollsReportsAndRuns(t *testing.T) {
	fake := fakewerkbuch.New()
	defer fake.Close()
	fake.Heartbeat = 1
	d := newDaemon(t, fake)
	ctx, cancel := context.WithCancel(context.Background())
	done := make(chan error)
	go func() { done <- d.Run(ctx) }()

	eventually(t, "two claims without work", func() bool { return len(fake.Paths()) >= 2 })
	rep, _ := fake.LastReport()
	if len(rep.CLIs) != 2 || rep.CLIs[0].CLI != "claude" || !rep.CLIs[0].Installed || !rep.CLIs[0].LoggedIn || *rep.CLIs[0].Version != "2.1.330" {
		t.Fatalf("report %+v", rep)
	}
	fake.Queue(run("01a", "answer"))
	eventually(t, "the run succeeded", func() bool { return fake.State("01a").Status == protocol.Succeeded })
	eventually(t, "recent", func() bool { r := d.Runs(); return len(r) == 1 && r[0].Status == "finished" })
	st := d.Status()
	if !st.Connected || st.Places == nil || st.Places.Total != 2 || st.Running != 0 || st.ExpectedVersion != "1.0.0" || d.Execution("01a") == nil {
		t.Fatalf("status %+v", st)
	}
	if d.Load().History == nil {
		t.Fatal("load without sampler")
	}
	if !strings.Contains(d.RequestUpdate(), "has the version") {
		t.Fatal("update without a new version")
	}
	cancel()
	if err := <-done; err != nil {
		t.Fatal(err)
	}
}

func TestUpdatesWhenNoRunIsLeft(t *testing.T) {
	fake := fakewerkbuch.New()
	defer fake.Close()
	fake.Heartbeat = 1
	d := newDaemon(t, fake)
	fake.Queue(run("01slow", "sleep"))
	done := make(chan error)
	go func() { done <- d.Run(context.Background()) }()
	eventually(t, "the run started", func() bool { return len(fake.State("01slow").Events) > 0 })

	fake.Version = "2.0.0"
	eventually(t, "the update is pending", func() bool { return d.Status().Update == "pending" })
	fake.Queue(run("01next", "answer"))
	time.Sleep(200 * time.Millisecond)
	if fake.State("01next").Status != "queued" {
		t.Fatal("a new run was taken while an update waits")
	}
	if u := d.Updater.(*fakeUpdater); len(u.applied) != 0 {
		t.Fatal("updated while a run runs")
	}
	fake.Cancel("01slow")
	if err := <-done; !errors.Is(err, errRestarted) {
		t.Fatalf("restart: %v", err)
	}
	if u := d.Updater.(*fakeUpdater); len(u.applied) != 1 || u.applied[0] != "2.0.0" {
		t.Fatalf("applied %v", u.applied)
	}
	if fake.State("01slow").Status != protocol.Canceled {
		t.Fatal("the run did not end")
	}
}

func TestFailedUpdateKeepsRunning(t *testing.T) {
	fake := fakewerkbuch.New()
	defer fake.Close()
	d := newDaemon(t, fake)
	d.Updater = &fakeUpdater{fail: errors.New("checksum of the download does not match")}
	fake.Version = "2.0.0"
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	go d.Run(ctx)
	eventually(t, "update failed", func() bool { return strings.HasPrefix(d.Status().Update, "failed: checksum") })
	fake.Queue(run("01go", "answer"))
	eventually(t, "the old runner works on", func() bool { return fake.State("01go").Status == protocol.Succeeded })
}

func TestUnauthorized(t *testing.T) {
	fake := fakewerkbuch.New()
	defer fake.Close()
	d := newDaemon(t, fake)
	d.Client.Token = "wbr_revokedrevokedrevokedrevoked"
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	go d.Run(ctx)
	eventually(t, "refused", func() bool { return d.Status().Unauthorized })
	if strings.Contains(d.Status().LastError, "revoked") {
		t.Fatal("token in the status")
	}
}

func TestSweepRunsTheTeardown(t *testing.T) {
	fake := fakewerkbuch.New()
	defer fake.Close()
	d := newDaemon(t, fake)
	d.defaults()
	d.Keep = -time.Second
	torn := filepath.Join(t.TempDir(), "torn")
	if _, err := d.Executor.Git.Prepare(context.Background(), git.Spec{Name: "old-strand", Teardown: "touch " + torn}); err != nil {
		t.Fatal(err)
	}
	d.sweep(context.Background())
	if _, err := os.Stat(torn); err != nil {
		t.Fatal("the sweep did not run the teardown")
	}
}

func TestAClaimThatNamesEndedStrandsRemovesTheirWorktrees(t *testing.T) {
	fake := fakewerkbuch.New()
	defer fake.Close()
	fake.ClosedThreads = []string{"ended-strand", "unknown"}
	d := newDaemon(t, fake)
	d.defaults()
	torn := filepath.Join(t.TempDir(), "torn")
	ws, err := d.Executor.Git.Prepare(context.Background(), git.Spec{Name: "ended-strand", Teardown: "touch " + torn})
	if err != nil {
		t.Fatal(err)
	}
	var wg sync.WaitGroup
	d.claim(context.Background(), &wg)
	wg.Wait()
	if _, err := os.Stat(torn); err != nil {
		t.Fatal("the teardown did not run for the ended strand")
	}
	if _, err := os.Stat(ws.Dir); !os.IsNotExist(err) {
		t.Fatal("the worktree of the ended strand stays")
	}
}

func TestReportReadsTheCache(t *testing.T) {
	fake := fakewerkbuch.New()
	defer fake.Close()
	d := newDaemon(t, fake)
	if r := d.Report(); len(r.CLIs) != 0 {
		t.Fatal("no report before the first refresh")
	}
	d.refreshReport(context.Background())
	if r := d.Report(); len(r.CLIs) != 2 {
		t.Fatalf("%+v", r)
	}
}

func TestOneSweepAtATimeBesideThePolling(t *testing.T) {
	fake := fakewerkbuch.New()
	defer fake.Close()
	d := newDaemon(t, fake)
	d.defaults()
	d.Keep = -time.Second
	if _, err := d.Executor.Git.Prepare(context.Background(), git.Spec{Name: "slow", Teardown: "sleep 0.5"}); err != nil {
		t.Fatal(err)
	}
	var wg sync.WaitGroup
	if !d.sweepInBackground(context.Background(), &wg) {
		t.Fatal("the first sweep did not start")
	}
	if d.sweepInBackground(context.Background(), &wg) {
		t.Fatal("a second sweep ran beside the first")
	}
	wg.Wait()
	if !d.sweepInBackground(context.Background(), &wg) {
		t.Fatal("no sweep after the first ended")
	}
	wg.Wait()
}

func TestARunWaitsForTheSweepOfItsFolder(t *testing.T) {
	fake := fakewerkbuch.New()
	defer fake.Close()
	fake.Heartbeat = 0
	d := newDaemon(t, fake)
	d.defaults()
	d.Keep = -time.Second
	origin := filepath.Join(t.TempDir(), "origin")
	for _, args := range [][]string{{"init", "--quiet", "-b", "main", origin}, {"-C", origin, "-c", "user.name=t", "-c", "user.email=t@example.com", "commit", "--quiet", "--allow-empty", "-m", "first"}} {
		if out, err := exec.Command("git", args...).CombinedOutput(); err != nil {
			t.Fatalf("%v %s", err, out)
		}
	}
	d.Executor.Repos = func() map[string]string { return map[string]string{"WEB": origin} }
	marks := t.TempDir()
	started, done := filepath.Join(marks, "started"), filepath.Join(marks, "done")
	// an old worktree of the strand, whose teardown is slow
	if _, err := d.Executor.Git.Prepare(context.Background(), git.Spec{Name: "thread-old", Repo: origin, Branch: "agent/old", Teardown: "touch " + started + "; sleep 1; touch " + done}); err != nil {
		t.Fatal(err)
	}
	var wg sync.WaitGroup
	d.sweepInBackground(context.Background(), &wg)
	eventually(t, "the teardown started", func() bool { _, err := os.Stat(started); return err == nil })

	r := run("01corr", "answer")
	r.Type = protocol.Correction
	r.Thread = &protocol.Thread{ID: "thread-old", Branch: strp("agent/old")}
	fake.Queue(r)
	a, _ := d.Client.Claim(context.Background(), protocol.Report{})
	e := executor.NewExecution(*a.Run)
	status := d.Executor.Run(context.Background(), e)
	wg.Wait()
	if status != protocol.Succeeded {
		t.Fatalf("%q", status)
	}
	if _, err := os.Stat(done); err != nil {
		t.Fatal("the sweep did not finish its teardown")
	}
	// the run came after the sweep: its folder is there, made anew
	if _, err := os.Stat(filepath.Join(e.Summary().Dir, ".git")); err != nil {
		t.Fatalf("the run lost its folder: %v", err)
	}
	if !strings.Contains(fake.State("01corr").Events[0].Text, "working in") {
		t.Fatal(fake.State("01corr").Events)
	}
}

func strp(s string) *string { return &s }

func TestDoctorAddsTheVersion(t *testing.T) {
	d := &Daemon{Instance: "https://werkbuch.example.com", Version: "0.1.0", Checks: func(ctx context.Context) []socket.Check {
		return []socket.Check{{Name: "git", Level: "ok", Detail: "git version 2.47.1"}}
	}}
	checks := d.Doctor(context.Background())
	if len(checks) != 2 || checks[0].Name != "version" || checks[0].Level != "ok" || checks[1].Name != "git" {
		t.Fatalf("%+v", checks)
	}
	d.mu.Lock()
	d.expected, d.update = "0.2.0", "failed: checksum mismatch"
	d.mu.Unlock()
	if c := d.Doctor(context.Background())[0]; c.Level != "warn" || !strings.Contains(c.Detail, "werkbuch expects 0.2.0") || !strings.Contains(c.Detail, "update failed: checksum mismatch") {
		t.Fatalf("%+v", c)
	}
	if st := d.Status(); st.System != runtime.GOOS+"/"+runtime.GOARCH {
		t.Fatal(st.System)
	}
	if checks := (&Daemon{Version: "dev"}).Doctor(context.Background()); len(checks) != 1 || !strings.Contains(checks[0].Detail, "dev") {
		t.Fatalf("%+v", checks)
	}
}

func TestDoctorRunsOnceAtATime(t *testing.T) {
	release := make(chan struct{})
	var mu sync.Mutex
	calls := 0
	d := &Daemon{Version: "0.4.0", Checks: func(ctx context.Context) []socket.Check {
		mu.Lock()
		calls++
		mu.Unlock()
		<-release
		return []socket.Check{{Name: "git", Level: "ok"}}
	}}
	results := make(chan []socket.Check, 3)
	for range 3 {
		go func() { results <- d.Doctor(context.Background()) }()
	}
	eventually(t, "the first run", func() bool { mu.Lock(); defer mu.Unlock(); return calls == 1 })
	time.Sleep(50 * time.Millisecond) // the others wait
	close(release)
	for range 3 {
		if r := <-results; len(r) != 2 || r[1].Name != "git" {
			t.Fatalf("%+v", r)
		}
	}
	if calls != 1 {
		t.Fatalf("%d runs", calls)
	}
	// a caller that gives up gets nothing, the run goes on
	again := make(chan struct{})
	d.Checks = func(ctx context.Context) []socket.Check { <-again; return nil }
	go d.Doctor(context.Background())
	eventually(t, "a run in flight", func() bool { d.doctorMu.Lock(); defer d.doctorMu.Unlock(); return d.doctorRun != nil })
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	if r := d.Doctor(ctx); len(r) != 1 {
		t.Fatalf("%+v", r)
	}
	close(again)
	if st := d.Status(); st.Now.IsZero() {
		t.Fatal("no clock in the status")
	}
}

func TestDoctorRecoversFromAPanic(t *testing.T) {
	d := &Daemon{Version: "0.4.0", Checks: func(ctx context.Context) []socket.Check { panic("checks broke") }}
	func() {
		defer func() { recover() }()
		d.Doctor(context.Background())
	}()
	d.doctorMu.Lock()
	left := d.doctorRun
	d.doctorMu.Unlock()
	if left != nil {
		t.Fatal("a dead run stays")
	}
	d.Checks = func(ctx context.Context) []socket.Check { return []socket.Check{{Name: "git", Level: "ok"}} }
	if r := d.Doctor(context.Background()); len(r) != 2 {
		t.Fatalf("%+v", r)
	}
}
