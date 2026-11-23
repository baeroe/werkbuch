package client

import (
	"context"
	"strings"
	"testing"

	"github.com/baeroe/werkbuch/runner/internal/fakewerkbuch"
	"github.com/baeroe/werkbuch/runner/internal/protocol"
)

func TestPairAndHeaders(t *testing.T) {
	fake := fakewerkbuch.New()
	defer fake.Close()
	c := New(fake.URL+"/", "", "0.3.2")

	_, err := c.Pair(context.Background(), protocol.PairRequest{Code: "NOPE-NOPE", Name: "mac", OS: "darwin", Arch: "arm64", Version: "0.3.2"})
	if !Reason(err, 422, "validation_failed") || !strings.Contains(err.Error(), "unknown") {
		t.Fatalf("unknown code: %v", err)
	}
	a, err := c.Pair(context.Background(), protocol.PairRequest{Code: fakewerkbuch.Code, Name: "mac", OS: "darwin", Arch: "arm64", Version: "0.3.2"})
	if err != nil || a.Token != fakewerkbuch.Token || a.Runner.Name != "mac" || a.Places.Total != 2 || a.HeartbeatSeconds != 15 {
		t.Fatalf("pair: %+v %v", a, err)
	}
	h := fake.Headers[len(fake.Headers)-1]
	if h.Get("X-Werkbuch-Runner-Version") != "0.3.2" || h.Get("X-Werkbuch-Protocol") != "1" || h.Get("Authorization") != "" {
		t.Fatalf("headers %v", h)
	}
}

func TestClaimHeartbeatEventsResult(t *testing.T) {
	fake := fakewerkbuch.New()
	defer fake.Close()
	ctx := context.Background()
	c := New(fake.URL, fakewerkbuch.Token, "0.3.2")

	a, err := c.Claim(ctx, protocol.Report{Load: &protocol.Load{CPU: 12}})
	if err != nil || a.Run != nil || a.Version != "1.0.0" {
		t.Fatalf("empty claim: %+v %v", a, err)
	}
	fake.Queue(protocol.Run{ID: "01run", Type: "task"})
	a, err = c.Claim(ctx, protocol.Report{})
	if err != nil || a.Run == nil || a.Run.ID != "01run" || a.Run.Attempt != 1 {
		t.Fatalf("claim: %+v %v", a, err)
	}
	if fake.Headers[len(fake.Headers)-1].Get("Authorization") != "Bearer "+fakewerkbuch.Token {
		t.Fatal("no bearer")
	}
	hb, err := c.Heartbeat(ctx, "01run", 1, protocol.Report{})
	if err != nil || hb.Cancel {
		t.Fatalf("heartbeat: %+v %v", hb, err)
	}
	if err := c.Events(ctx, "01run", 1, []protocol.Event{{Kind: "text", Text: "hi"}}); err != nil {
		t.Fatal(err)
	}
	fake.Replace("01run")
	if err := c.Events(ctx, "01run", 1, []protocol.Event{{Kind: "text", Text: "late"}}); !Replaced(err) {
		t.Fatalf("replaced: %v", err)
	}
	if err := c.Result(ctx, "01run", protocol.Result{Attempt: 2, Status: "succeeded"}); err != nil {
		t.Fatal(err)
	}
	if st := fake.State("01run"); st.Status != "succeeded" || len(st.Events) != 1 {
		t.Fatalf("state %+v", st)
	}
}

func TestProbeAndUnauthorized(t *testing.T) {
	fake := fakewerkbuch.New()
	defer fake.Close()
	ctx := context.Background()
	if err := New(fake.URL, fakewerkbuch.Token, "1").Probe(ctx); err != nil {
		t.Fatalf("probe: %v", err)
	}
	err := New(fake.URL, "wbr_wrongwrongwrongwrongwrongwrong", "1").Probe(ctx)
	if !Unauthorized(err) {
		t.Fatalf("wrong token: %v", err)
	}
	if strings.Contains(err.Error(), "wbr_") {
		t.Fatalf("token in error: %v", err)
	}
	if _, err := New("http://127.0.0.1:1", fakewerkbuch.Token, "1").Claim(ctx, protocol.Report{}); err == nil || strings.Contains(err.Error(), fakewerkbuch.Token) {
		t.Fatalf("network error: %v", err)
	}
}

func TestDownload(t *testing.T) {
	fake := fakewerkbuch.New()
	defer fake.Close()
	c := New(fake.URL, "", "1")
	if _, err := c.Download(context.Background(), "/runner/download/darwin/arm64", 10); err == nil {
		t.Fatal("missing binary")
	}
	fake.Binary = []byte("0123456789abc")
	if _, err := c.Download(context.Background(), "/runner/download/darwin/arm64", 10); err == nil {
		t.Fatal("over the limit")
	}
	if got, err := c.Download(context.Background(), "/runner/download/darwin/arm64", 100); err != nil || string(got) != "0123456789abc" {
		t.Fatalf("%q %v", got, err)
	}
}
