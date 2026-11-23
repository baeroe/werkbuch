package daemon

import (
	"context"
	"errors"
	"io"
	"log/slog"
	"os"
	"path/filepath"
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
