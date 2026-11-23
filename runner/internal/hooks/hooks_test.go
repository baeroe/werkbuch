package hooks

import (
	"context"
	"os"
	"path/filepath"
	"testing"
)

func TestRun(t *testing.T) {
	dir := t.TempDir()
	out, err := Run(context.Background(), dir, `echo "$X" > done; echo ok`, []string{"X=hello"})
	data, _ := os.ReadFile(filepath.Join(dir, "done"))
	if err != nil || out != "ok" || string(data) != "hello\n" {
		t.Fatalf("%q %v %q", out, err, data)
	}
	if _, err := Run(context.Background(), dir, "echo broken; exit 3", nil); err == nil {
		t.Fatal("exit 3 is an error")
	}
}
