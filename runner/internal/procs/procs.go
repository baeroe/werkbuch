// Package procs keeps the CLIs of runs from outliving the runner: every run notes the process group of its CLI under
// the state folder (`runs/<run>.json`, with the start time of the process against a reused PID), and a daemon that
// starts after a crash ends the groups still there. Stopping a run ends its group and every descendant that left it.
// Left-over MCP folders (`werkbuch-run-*` in the temporary folder) go at the start, too.
package procs

import (
	"context"
	"encoding/json"
	"os"
	"os/exec"
	"path/filepath"
	"strconv"
	"strings"
	"syscall"
	"time"
)

// Record is one CLI on the machine.
type Record struct {
	PID   int    `json:"pid"`
	Start string `json:"start"`
}

// StartTime is the start of a process as `ps` tells it ("" when there is none).
func StartTime(pid int) string {
	out, err := exec.Command("ps", "-o", "lstart=", "-p", strconv.Itoa(pid)).Output()
	if err != nil {
		return ""
	}
	return strings.TrimSpace(string(out))
}

// Note writes the record of a run's CLI (its PID is the ID of its group).
func Note(dir, run string, pid int) error {
	if dir == "" {
		return nil
	}
	if err := os.MkdirAll(dir, 0o700); err != nil {
		return err
	}
	data, _ := json.Marshal(Record{PID: pid, Start: StartTime(pid)})
	return os.WriteFile(filepath.Join(dir, run+".json"), data, 0o600)
}

// Forget removes the record of a run.
func Forget(dir, run string) {
	if dir != "" {
		os.Remove(filepath.Join(dir, run+".json"))
	}
}

// Reap ends the process groups of records left by an earlier runner and removes the records; it returns the PIDs it
// ended. A PID that now belongs to another process (other start time) is left alone.
func Reap(dir string, grace time.Duration) []int {
	files, _ := filepath.Glob(filepath.Join(dir, "*.json"))
	var ended []int
	for _, f := range files {
		var r Record
		data, err := os.ReadFile(f)
		os.Remove(f)
		if err != nil || json.Unmarshal(data, &r) != nil || r.PID <= 1 || r.Start == "" {
			continue
		}
		groupAlive := func() bool { return syscall.Kill(-r.PID, 0) == nil }
		switch start := StartTime(r.PID); {
		case start == r.Start:
		case start == "" && groupAlive():
			// the CLI is gone, what it started lives on in its group (a group ID is not reused while the group lives)
		default:
			continue
		}
		Stop(r.PID, grace, func() bool { return !groupAlive() })
		ended = append(ended, r.PID)
	}
	return ended
}

// Descendants lists every process below pid (children, their children, …), also those in other groups.
func Descendants(pid int) []int {
	out, err := exec.Command("ps", "-A", "-o", "pid=,ppid=").Output()
	if err != nil {
		return nil
	}
	children := map[int][]int{}
	for _, line := range strings.Split(string(out), "\n") {
		f := strings.Fields(line)
		if len(f) != 2 {
			continue
		}
		p, _ := strconv.Atoi(f[0])
		pp, _ := strconv.Atoi(f[1])
		children[pp] = append(children[pp], p)
	}
	var all []int
	queue := []int{pid}
	seen := map[int]bool{pid: true}
	for len(queue) > 0 {
		p := queue[0]
		queue = queue[1:]
		for _, c := range children[p] {
			if !seen[c] {
				seen[c] = true
				all = append(all, c)
				queue = append(queue, c)
			}
		}
	}
	return all
}

// Stop sends SIGTERM to the group of pid and to every descendant, waits up to grace for gone to say so, then SIGKILLs
// the group and every descendant it knows of (spec 6.4: SIGTERM, after 10 s SIGKILL).
func Stop(pid int, grace time.Duration, gone func() bool) {
	known := map[int]string{} // descendant → its start time: a PID reused meanwhile is never signaled
	signal := func(sig syscall.Signal) {
		for _, d := range Descendants(pid) {
			if _, ok := known[d]; !ok {
				known[d] = StartTime(d)
			}
		}
		syscall.Kill(-pid, sig)
		for d, start := range known {
			if start != "" && StartTime(d) == start {
				syscall.Kill(d, sig)
			}
		}
	}
	signal(syscall.SIGTERM)
	ctx, cancel := context.WithTimeout(context.Background(), grace)
	defer cancel()
	for !gone() {
		select {
		case <-ctx.Done():
			signal(syscall.SIGKILL)
			return
		case <-time.After(50 * time.Millisecond):
		}
	}
	// the CLI ended; descendants that left its group still go, if they are still the processes they were
	for d, start := range known {
		if start != "" && StartTime(d) == start {
			syscall.Kill(d, syscall.SIGKILL)
		}
	}
}

// CleanTemp removes left-over private folders of runs (MCP config, system prompt) in dir.
func CleanTemp(dir string) []string {
	matches, _ := filepath.Glob(filepath.Join(dir, "werkbuch-run-*"))
	for _, m := range matches {
		os.RemoveAll(m)
	}
	return matches
}
