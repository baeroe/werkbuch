package procs

import (
	"os"
	"os/exec"
	"path/filepath"
	"syscall"
	"testing"
	"time"
)

func start(t *testing.T, script string) *exec.Cmd {
	cmd := exec.Command("sh", "-c", script)
	cmd.SysProcAttr = &syscall.SysProcAttr{Setpgid: true}
	if err := cmd.Start(); err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { syscall.Kill(-cmd.Process.Pid, syscall.SIGKILL); cmd.Wait() })
	return cmd
}

func alive(pid int) bool { return syscall.Kill(pid, 0) == nil }

func TestReapEndsAnOrphanedGroup(t *testing.T) {
	dir := t.TempDir()
	cmd := start(t, "trap '' TERM; sleep 600 & wait")
	done := make(chan struct{})
	go func() { cmd.Wait(); close(done) }()
	if err := Note(dir, "01run", cmd.Process.Pid); err != nil {
		t.Fatal(err)
	}
	// a record whose PID belongs to another process now stays untouched
	os.WriteFile(filepath.Join(dir, "other.json"), []byte(`{"pid":1,"start":"Thu Jan  1 00:00:00 1970"}`), 0o600)
	ended := Reap(dir, 300*time.Millisecond)
	select {
	case <-done:
	case <-time.After(5 * time.Second):
		t.Fatal("the group lives on")
	}
	if len(ended) != 1 || ended[0] != cmd.Process.Pid {
		t.Fatalf("ended %v", ended)
	}
	if left, _ := filepath.Glob(filepath.Join(dir, "*.json")); len(left) != 0 {
		t.Fatalf("records stay: %v", left)
	}
}

func TestStopEndsDescendantsOutsideTheGroup(t *testing.T) {
	pidFile := filepath.Join(t.TempDir(), "pid")
	// the grandchild leaves the group of the CLI (its own group, like `setsid`)
	cmd := start(t, "perl -e 'setpgrp(0,0); sleep 600' & echo $! > "+pidFile+"; wait")
	var escaped int
	for i := 0; i < 100 && escaped == 0; i++ {
		data, _ := os.ReadFile(pidFile)
		if len(data) > 0 {
			escaped = atoi(string(data))
		}
		time.Sleep(20 * time.Millisecond)
	}
	time.Sleep(200 * time.Millisecond)
	if escaped == 0 || !alive(escaped) {
		t.Fatal("no grandchild")
	}
	done := make(chan struct{})
	go func() { cmd.Wait(); close(done) }()
	Stop(cmd.Process.Pid, 2*time.Second, func() bool {
		select {
		case <-done:
			return true
		default:
			return false
		}
	})
	time.Sleep(200 * time.Millisecond)
	if alive(escaped) {
		syscall.Kill(escaped, syscall.SIGKILL)
		t.Fatal("the grandchild outside the group lives on")
	}
}

func atoi(s string) int {
	n := 0
	for _, c := range s {
		if c >= '0' && c <= '9' {
			n = n*10 + int(c-'0')
		}
	}
	return n
}

func TestCleanTemp(t *testing.T) {
	dir := t.TempDir()
	os.MkdirAll(filepath.Join(dir, "werkbuch-run-123"), 0o700)
	os.MkdirAll(filepath.Join(dir, "keep-me"), 0o700)
	if got := CleanTemp(dir); len(got) != 1 {
		t.Fatal(got)
	}
	if _, err := os.Stat(filepath.Join(dir, "keep-me")); err != nil {
		t.Fatal("removed too much")
	}
	Note("", "x", 1)
	Forget("", "x")
}
