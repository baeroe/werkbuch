package protocol

import (
	"testing"
	"time"
)

func TestDeadline(t *testing.T) {
	started := time.Date(2026, 11, 24, 9, 0, 0, 0, time.UTC)
	given := started.Add(45 * time.Minute)

	cases := []struct {
		name string
		run  Run
		want time.Time
	}{
		{"werkbuch's deadline wins", Run{TimeoutMinutes: 120, DeadlineAt: &given}, given},
		{"start plus the limit", Run{TimeoutMinutes: 30}, started.Add(30 * time.Minute)},
		{"120 minutes without a limit", Run{}, started.Add(120 * time.Minute)},
	}
	for _, c := range cases {
		if got := c.run.Deadline(started); !got.Equal(c.want) {
			t.Errorf("%s: got %v, want %v", c.name, got, c.want)
		}
	}
}
