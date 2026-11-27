package usage

import (
	"context"
	"errors"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"sync/atomic"
	"testing"
	"time"
)

const answer = `{"five_hour":{"utilization":42.5,"resets_at":"2026-11-27T19:00:00.5+00:00"},"seven_day":{"utilization":65.0,"resets_at":"2026-12-01T04:00:00.239514+00:00"},"seven_day_opus":null}`

func TestParse(t *testing.T) {
	u, err := Parse(strings.NewReader(answer))
	if err != nil {
		t.Fatal(err)
	}
	if u.Session == nil || u.Session.Percent != 42.5 || *u.Session.ResetsAt != "2026-11-27T19:00:00Z" {
		t.Fatalf("session %+v", u.Session)
	}
	if u.Week == nil || u.Week.Percent != 65 || *u.Week.ResetsAt != "2026-12-01T04:00:00Z" {
		t.Fatalf("week %+v", u.Week)
	}
	// a window without a reading (no session open) is unknown; percents stay within 0 to 100
	u, _ = Parse(strings.NewReader(`{"five_hour":null,"seven_day":{"utilization":140,"resets_at":null}}`))
	if u.Session != nil || u.Week.Percent != 100 || u.Week.ResetsAt != nil {
		t.Fatalf("%+v %+v", u.Session, u.Week)
	}
	if _, err := Parse(strings.NewReader("<html>")); err == nil {
		t.Fatal("no error for a page that is no JSON")
	}
}

func TestCurrentAsksOncePerCacheAndSendsTheToken(t *testing.T) {
	var asked atomic.Int32
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		asked.Add(1)
		if r.Header.Get("Authorization") != "Bearer tok" || r.Header.Get("anthropic-beta") == "" {
			w.WriteHeader(http.StatusUnauthorized)
			return
		}
		_, _ = w.Write([]byte(answer))
	}))
	defer srv.Close()
	r := &Reader{URL: srv.URL, tokens: func(context.Context) (string, error) { return "tok", nil }}
	for range 3 {
		if u := r.Current(context.Background()); u.Week == nil || u.Week.Percent != 65 {
			t.Fatalf("%+v", u)
		}
	}
	if asked.Load() != 1 {
		t.Fatalf("asked %d times", asked.Load())
	}
}

func TestCurrentKeepsAReadingForAWhileThenKnowsNothing(t *testing.T) {
	fail := false
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		if fail {
			w.WriteHeader(http.StatusTooManyRequests)
			return
		}
		_, _ = w.Write([]byte(answer))
	}))
	defer srv.Close()
	r := &Reader{URL: srv.URL, tokens: func(context.Context) (string, error) { return "tok", nil }}
	r.Current(context.Background())
	fail = true
	r.asked = time.Now().Add(-CacheFor)
	if u := r.Current(context.Background()); u.Week == nil {
		t.Fatal("the last reading went with one failure")
	}
	r.asked, r.read = time.Now().Add(-CacheFor), time.Now().Add(-KeepFor)
	if u := r.Current(context.Background()); u.Session != nil || u.Week != nil {
		t.Fatalf("an old reading stayed: %+v", u)
	}
	// without a sign-in nothing is known
	r = &Reader{URL: srv.URL, tokens: func(context.Context) (string, error) { return "", errors.New("none") }}
	if u := r.Current(context.Background()); u == nil || u.Week != nil {
		t.Fatalf("%+v", u)
	}
}

func TestTokenFromTheKeychainOrTheFile(t *testing.T) {
	future := time.Now().Add(time.Hour).UnixMilli()
	creds := func(token string, exp int64) string {
		return `{"claudeAiOauth":{"accessToken":"` + token + `","expiresAt":` + strconv.FormatInt(exp, 10) + `}}`
	}
	var args []string
	r := &Reader{GOOS: "darwin", ClaudeDir: t.TempDir(), Run: func(_ context.Context, name string, a ...string) ([]byte, error) {
		args = append([]string{name}, a...)
		return []byte(creds("from-keychain", future) + "\n"), nil
	}}
	if tok, err := r.token(context.Background()); err != nil || tok != "from-keychain" {
		t.Fatalf("%q %v", tok, err)
	}
	if strings.Join(args, " ") != "security find-generic-password -s "+Keychain+" -w" {
		t.Fatalf("%v", args)
	}

	dir := t.TempDir()
	r = &Reader{GOOS: "linux", ClaudeDir: dir}
	if _, err := r.token(context.Background()); err == nil {
		t.Fatal("a token without a file")
	}
	_ = os.WriteFile(filepath.Join(dir, ".credentials.json"), []byte(creds("from-file", future)), 0o600)
	if tok, _ := r.token(context.Background()); tok != "from-file" {
		t.Fatalf("%q", tok)
	}
	_ = os.WriteFile(filepath.Join(dir, ".credentials.json"), []byte(creds("old", time.Now().Add(-time.Minute).UnixMilli())), 0o600)
	if _, err := r.token(context.Background()); err == nil {
		t.Fatal("an expired token")
	}
	_ = os.WriteFile(filepath.Join(dir, ".credentials.json"), []byte(`{}`), 0o600)
	if _, err := r.token(context.Background()); err == nil {
		t.Fatal("a token out of nothing")
	}
}
