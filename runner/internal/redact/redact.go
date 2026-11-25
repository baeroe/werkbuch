// Package redact blanks tokens in text the runner writes or sends: the patterns of werkbuch's App\Support\Secrets
// (personal access tokens, runner tokens, GitHub tokens) and any secret the runner holds right now. Every log line goes
// through it (Handler), so a token never reaches a log (spec 2, anti-goal).
package redact

import (
	"context"
	"log/slog"
	"regexp"
	"strings"
	"sync"
)

// Blank stands where a token was, as werkbuch writes it.
const Blank = "[token]"

var patterns = []*regexp.Regexp{
	regexp.MustCompile(`\b[0-9A-Za-z]{26}\|wb_[A-Za-z0-9]{20,}`),
	regexp.MustCompile(`\bwb_[A-Za-z0-9]{20,}`),
	regexp.MustCompile(`\bwbr_[A-Za-z0-9]{20,}`),
	// GitHub tokens whole, also the installation tokens of 2026 (`ghs_<app>_<JWT>`, A730): the segments of the JWT go
	// with their dots, a dot that ends a sentence stays
	regexp.MustCompile(`\bgh[pousr]_[A-Za-z0-9_-]{20,}(?:\.[A-Za-z0-9_-]+)*`),
	regexp.MustCompile(`\bgithub_pat_[A-Za-z0-9_-]{20,}(?:\.[A-Za-z0-9_-]+)*`),
	regexp.MustCompile(`(?i)(authorization:\s*bearer\s+)\S+`),
}

var (
	mu      sync.RWMutex
	secrets = map[string]int{}
)

// Hold names a secret the runner holds (a run token, a git token): until Release, every text it appears in is blanked,
// whatever its form.
func Hold(secret string) {
	if len(secret) < 8 {
		return
	}
	mu.Lock()
	secrets[secret]++
	mu.Unlock()
}

// Release forgets a secret once its run ended.
func Release(secret string) {
	mu.Lock()
	if secrets[secret] <= 1 {
		delete(secrets, secret)
	} else {
		secrets[secret]--
	}
	mu.Unlock()
}

// String blanks every token in s.
func String(s string) string {
	mu.RLock()
	for secret := range secrets {
		s = strings.ReplaceAll(s, secret, Blank)
	}
	mu.RUnlock()
	for i, p := range patterns {
		if i == len(patterns)-1 {
			s = p.ReplaceAllString(s, "${1}"+Blank)
			continue
		}
		s = p.ReplaceAllString(s, Blank)
	}
	return s
}

// Handler wraps a slog handler: message and every string attribute are blanked.
type Handler struct{ Next slog.Handler }

func (h Handler) Enabled(ctx context.Context, l slog.Level) bool { return h.Next.Enabled(ctx, l) }

func (h Handler) Handle(ctx context.Context, r slog.Record) error {
	out := slog.NewRecord(r.Time, r.Level, String(r.Message), r.PC)
	r.Attrs(func(a slog.Attr) bool {
		out.AddAttrs(clean(a))
		return true
	})
	return h.Next.Handle(ctx, out)
}

func (h Handler) WithAttrs(attrs []slog.Attr) slog.Handler {
	cleaned := make([]slog.Attr, len(attrs))
	for i, a := range attrs {
		cleaned[i] = clean(a)
	}
	return Handler{h.Next.WithAttrs(cleaned)}
}

func (h Handler) WithGroup(name string) slog.Handler { return Handler{h.Next.WithGroup(name)} }

func clean(a slog.Attr) slog.Attr {
	v := a.Value.Resolve()
	switch v.Kind() {
	case slog.KindString:
		return slog.String(a.Key, String(v.String()))
	case slog.KindGroup:
		group := v.Group()
		out := make([]any, len(group))
		for i, g := range group {
			out[i] = clean(g)
		}
		return slog.Group(a.Key, out...)
	case slog.KindAny:
		if err, ok := v.Any().(error); ok {
			return slog.String(a.Key, String(err.Error()))
		}
		return slog.String(a.Key, String(v.String()))
	}
	return a
}
