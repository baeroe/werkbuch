package update

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/baeroe/werkbuch/runner/internal/client"
	"github.com/baeroe/werkbuch/runner/internal/fakewerkbuch"
)

func TestApply(t *testing.T) {
	fake := fakewerkbuch.New()
	defer fake.Close()
	exe := filepath.Join(t.TempDir(), "werkbuch-runner")
	os.WriteFile(exe, []byte("#!/bin/sh\necho 1.0.0\n"), 0o755)
	u := &Updater{Client: client.New(fake.URL, "", "1.0.0"), Exe: exe, OS: "darwin", Arch: "arm64"}
	ctx := context.Background()
	if err := u.Apply(ctx, "1.1.0"); err == nil || !strings.Contains(err.Error(), "https") {
		t.Fatalf("http: %v", err)
	}
	u.AllowHTTP = true

	if err := u.Apply(ctx, "1.1.0"); err == nil {
		t.Fatal("no binary to download")
	}
	fake.Binary = []byte("#!/bin/sh\necho 1.1.0\n")
	fake.Checksum = "0000"
	if err := u.Apply(ctx, "1.1.0"); err == nil {
		t.Fatal("wrong checksum accepted")
	}
	sum := sha256.Sum256(fake.Binary)
	fake.Checksum = hex.EncodeToString(sum[:])
	if err := u.Apply(ctx, "1.2.0"); err == nil {
		t.Fatal("a binary of another version accepted")
	}
	if err := u.Apply(ctx, "1.1"); err == nil {
		t.Fatal("a version that only contains the expected one accepted")
	}
	if data, _ := os.ReadFile(exe); string(data) != "#!/bin/sh\necho 1.0.0\n" {
		t.Fatal("a failed update changed the binary")
	}
	if err := u.Apply(ctx, "1.1.0"); err != nil {
		t.Fatal(err)
	}
	if data, _ := os.ReadFile(exe); string(data) != string(fake.Binary) {
		t.Fatal("not swapped")
	}
	if entries, _ := os.ReadDir(filepath.Dir(exe)); len(entries) != 1 {
		t.Fatalf("left over: %v", entries)
	}
}

func TestCompare(t *testing.T) {
	cases := []struct {
		running, expected string
		want              bool
	}{{"0.3.2", "0.3.2", false}, {"0.3.2", "0.4.0", true}, {"v0.4.0", "0.4.0", false}, {"dev", "0.4.0", false}, {"0.3.2", "", false}}
	for _, c := range cases {
		if Compare(c.running, c.expected) != c.want {
			t.Errorf("%+v", c)
		}
	}
}
