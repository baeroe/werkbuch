// Command demo is a fake daemon of the runner for the screenshots of the TUI (runner/docs/screenshots.sh, A502): it
// serves the socket API (internal/socket) with the demo data of the clickdummy (`/_tui`, WEBU-18): an instance
// werkbuch.example.com, WEB-51 running with a log that grows every few seconds, recent runs, the load with a history,
// and doctor with Codex not signed in and a second way to werkbuch. Nothing here talks to a real host.
//
//	go run ./docs/demo -socket /tmp/wr-demo.sock
package main

import (
	"context"
	"flag"
	"fmt"
	"log"
	"math"
	"os"
	"os/signal"
	"sync"
	"syscall"
	"time"

	"github.com/baeroe/werkbuch/runner/internal/executor"
	"github.com/baeroe/werkbuch/runner/internal/load"
	"github.com/baeroe/werkbuch/runner/internal/protocol"
	"github.com/baeroe/werkbuch/runner/internal/socket"
)

const instance = "https://werkbuch.example.com"

func main() {
	path := flag.String("socket", os.Getenv("WERKBUCH_RUNNER_SOCKET"), "the socket to serve")
	flag.Parse()
	if *path == "" {
		log.Fatal("demo: -socket is required")
	}
	l, err := socket.Listen(*path)
	if err != nil {
		log.Fatal(err)
	}
	ctx, stop := signal.NotifyContext(context.Background(), syscall.SIGINT, syscall.SIGTERM)
	defer stop()
	d := newDemo(time.Now())
	go d.feed(ctx)
	defer os.Remove(*path)
	if err := socket.Serve(ctx, l, d); err != nil {
		log.Fatal(err)
	}
}

type demo struct {
	mu      sync.Mutex
	started time.Time
	running *executor.Execution
	recent  []*executor.Execution
	samples []protocol.Load
	next    []protocol.Event
}

func str(s string) *string { return &s }

func run(id, typ, model, key, title string) protocol.Run {
	return protocol.Run{ID: id, Type: typ, CLI: "claude", Model: model, TimeoutMinutes: 60,
		Project: protocol.ProjectRef{Identifier: "WEB"}, Item: &protocol.ItemRef{Key: key, Title: title}}
}

func newDemo(now time.Time) *demo {
	d := &demo{started: now.Add(-3*time.Hour - 12*time.Minute)}
	home, _ := os.UserHomeDir() // the sandbox of screenshots.sh: the TUI shows it as ~
	start := now.Add(-6*time.Minute - 12*time.Second)
	at := func(s int) time.Time { return start.Add(time.Duration(s) * time.Second) }
	r51 := run("01kfdemo51", protocol.Task, "sonnet", "WEB-51", "Cookie-Banner auf Consent v2 umstellen")
	r51.Thread = &protocol.Thread{Branch: str("agent/WEB-51-cookie-banner-consent-v2"), SessionID: str("4f2c9e1a5b")}
	d.running = executor.Fake(r51, start, "running", "", home+"/.local/share/werkbuch-runner/worktrees/WEB-51", time.Time{},
		protocol.Event{Kind: protocol.KindSystem, Text: "worktree ~/…/worktrees/WEB-51 on agent/WEB-51-cookie-banner-consent-v2, setup: ddev start", At: at(4)},
		protocol.Event{Kind: protocol.KindTool, Text: "Read resources/js/consent/banner.ts", At: at(31)},
		protocol.Event{Kind: protocol.KindText, Text: "Das Banner setzt nur ein Cookie „consent=1“. Consent v2 braucht die vier Signale ad_storage, analytics_storage, ad_user_data und ad_personalization.", At: at(44)},
		protocol.Event{Kind: protocol.KindTool, Text: "Read tests/js/consent.test.ts", At: at(70)},
		protocol.Event{Kind: protocol.KindText, Text: "Ich schreibe zuerst Tests für die vier Signale.", At: at(96)},
		protocol.Event{Kind: protocol.KindTool, Text: "Edit tests/js/consent.test.ts", At: at(120)},
		protocol.Event{Kind: protocol.KindTool, Text: "Bash pnpm vitest run tests/js/consent.test.ts", At: at(158)},
		protocol.Event{Kind: protocol.KindError, Text: "3 failed, 2 passed", At: at(171)},
		protocol.Event{Kind: protocol.KindTool, Text: "Edit resources/js/consent/banner.ts", At: at(205)},
		protocol.Event{Kind: protocol.KindTool, Text: "Edit resources/js/consent/signals.ts", At: at(248)},
		protocol.Event{Kind: protocol.KindTool, Text: "Bash pnpm vitest run tests/js/consent.test.ts", At: at(276)},
		protocol.Event{Kind: protocol.KindResult, Text: "5 passed", At: at(289)},
		protocol.Event{Kind: protocol.KindText, Text: "Die Signale stimmen. Jetzt das Banner im Browser.", At: at(310)},
		protocol.Event{Kind: protocol.KindTool, Text: "playwright browser_navigate https://website.ddev.site", At: at(352)},
	)
	d.next = []protocol.Event{
		{Kind: protocol.KindTool, Text: "playwright browser_snapshot"},
		{Kind: protocol.KindText, Text: "Das Banner zeigt die vier Schalter; „Alle ablehnen“ setzt alle Signale auf denied."},
		{Kind: protocol.KindTool, Text: "Bash git commit -m \"fix(consent): send the four signals of consent v2 (WEB-51)\""},
		{Kind: protocol.KindTool, Text: "Bash git push origin agent/WEB-51-cookie-banner-consent-v2"},
		{Kind: protocol.KindText, Text: "Gepusht. Ich trage den Nachweis in „Lösung“ ein."},
	}
	ended := func(id, typ, model, key, title, result string, from, to time.Duration, text string) *executor.Execution {
		s, e := now.Add(-from), now.Add(-to)
		return executor.Fake(run(id, typ, model, key, title), s, "", result, "", e, protocol.Event{Kind: protocol.KindResult, Text: text, At: e})
	}
	d.recent = []*executor.Execution{
		ended("01kfdemo44", protocol.Review, "opus", "WEB-44", "Footer-Links auf die neue Seitenstruktur", protocol.Succeeded, 31*time.Minute, 20*time.Minute, "changes requested (2 findings)"),
		ended("01kfdemo42", protocol.Comment, "haiku", "WEB-42", "Hero-Bild in WebP", protocol.Succeeded, 38*time.Minute, 36*time.Minute, "answer posted"),
		ended("01kfdemo53", protocol.Task, "haiku", "WEB-53", "Sitemap für die Leistungsseiten", protocol.TimedOut, 119*time.Minute, 59*time.Minute, "60 min limit, nothing pushed"),
		ended("01kfdemo49c", protocol.Correction, "sonnet", "WEB-49", "Kontaktformular mit Spam-Schutz", protocol.Succeeded, 130*time.Minute, 121*time.Minute, "pushed 2 commits"),
		ended("01kfdemo49r", protocol.Review, "opus", "WEB-49", "Kontaktformular mit Spam-Schutz", protocol.Canceled, 140*time.Minute, 138*time.Minute, "canceled from werkbuch"),
	}
	for i := range load.History {
		d.samples = append(d.samples, sample(i))
	}
	return d
}

// sample is a deterministic wave of load, so the screenshots stay alike.
func sample(i int) protocol.Load {
	x := float64(i)
	cpu := 42 + 24*math.Sin(x/5) + 9*math.Sin(x/1.7)
	gpu := 18 + 12*math.Sin(x/3.1)
	return protocol.Load{CPU: math.Round(cpu), GPU: &gpu, RAMUsed: math.Round((37.4+1.2*math.Sin(x/9))*10) / 10, RAMTotal: 64,
		DiskFree: 182, DiskTotal: 994}
}

// feed adds a line to the log of WEB-51 every few seconds and a load sample every 5 s.
func (d *demo) feed(ctx context.Context) {
	lines, samples := time.NewTicker(4*time.Second), time.NewTicker(load.Interval)
	defer lines.Stop()
	defer samples.Stop()
	i := len(d.samples)
	for {
		select {
		case <-ctx.Done():
			return
		case <-lines.C:
			d.mu.Lock()
			if len(d.next) > 0 {
				ev := d.next[0]
				d.next = d.next[1:]
				ev.At = time.Now()
				executor.Feed(d.running, ev)
			}
			d.mu.Unlock()
		case <-samples.C:
			d.mu.Lock()
			d.samples = append(d.samples[1:], sample(i))
			i++
			d.mu.Unlock()
		}
	}
}

func (d *demo) Status() socket.Status {
	d.mu.Lock()
	defer d.mu.Unlock()
	places := &protocol.Places{Total: 2, PerRepo: 1, Light: 2}
	places.Used.Total = 1
	last := d.samples[len(d.samples)-1]
	return socket.Status{
		Instance: instance, System: "darwin/arm64", Version: "0.4.0", ExpectedVersion: "0.4.0", Connected: true,
		LastContact: time.Now().Add(-2 * time.Second), Places: places, Running: 1, Load: &last, Started: d.started,
		CLIs: []protocol.CLI{
			{CLI: "claude", Installed: true, Version: str("2.4.1"), LoggedIn: true, Path: str("/opt/homebrew/bin/claude")},
			{CLI: "codex", Installed: true, Version: str("0.40.0"), Path: str("/opt/homebrew/bin/codex")},
		},
		Equipment: &protocol.Equipment{MCPServers: []string{"werkbuch-mara", "context7"}, Skills: []string{"ops:runbook"},
			Plugins: []string{}, WerkbuchAccess: []string{"werkbuch-mara"}},
	}
}

func (d *demo) Runs() []executor.Summary {
	out := []executor.Summary{d.running.Summary()}
	for _, e := range d.recent {
		out = append(out, e.Summary())
	}
	return out
}

func (d *demo) Execution(id string) *executor.Execution {
	if id == d.running.Run.ID {
		return d.running
	}
	for _, e := range d.recent {
		if e.Run.ID == id {
			return e
		}
	}
	return nil
}

func (d *demo) Load() socket.LoadAnswer {
	d.mu.Lock()
	defer d.mu.Unlock()
	last := d.samples[len(d.samples)-1]
	return socket.LoadAnswer{Last: &last, History: append([]protocol.Load(nil), d.samples...)}
}

func (d *demo) RequestUpdate() string { return "none needed: werkbuch expects 0.4.0" }

func (d *demo) Doctor(ctx context.Context) []socket.Check {
	return []socket.Check{
		{Name: "version", Level: "ok", Detail: "0.4.0"},
		{Name: "config", Level: "ok", Detail: "~/.config/werkbuch-runner/config.yaml: " + instance},
		{Name: "keychain", Level: "ok", Detail: "runner token for " + instance + " (werkbuch-runner)"},
		{Name: "instance", Level: "ok", Detail: instance + " answers"},
		{Name: "token", Level: "ok", Detail: "werkbuch accepts the runner token"},
		{Name: "git", Level: "ok", Detail: "git version 2.47.1"},
		{Name: "claude", Level: "ok", Detail: "/opt/homebrew/bin/claude 2.4.1, signed in"},
		{Name: "codex", Level: "warn", Detail: "/opt/homebrew/bin/codex 0.40.0 is not signed in: run `codex login` once and sign in"},
		{Name: "data", Level: "ok", Detail: "~/.local/share/werkbuch-runner (182 of 994 GB free)"},
		{Name: "equipment", Level: "ok", Detail: "MCP servers: werkbuch-mara, context7; skills: 1; plugins: none"},
		{Name: "werkbuch access", Level: "warn", Detail: "the MCP server werkbuch-mara reaches werkbuch.example.com past the run token: switch it off for the user of the runner"},
		{Name: "daemon", Level: "ok", Detail: fmt.Sprintf("runs since %s, 1 runs now", d.started.Format(time.RFC3339))},
	}
}
