package config

import (
	"errors"
	"os"
	"path/filepath"
	"testing"
)

func TestSaveLoad(t *testing.T) {
	path := filepath.Join(t.TempDir(), "sub", "config.yaml")
	if _, err := Load(path); !errors.Is(err, ErrMissing) {
		t.Fatalf("missing: %v", err)
	}
	if err := Save(path, Config{Instance: "https://werkbuch.example.com", Repos: map[string]string{"WEB": "/tmp/repo"}}); err != nil {
		t.Fatal(err)
	}
	info, _ := os.Stat(path)
	if info.Mode().Perm() != 0o600 {
		t.Errorf("mode %v", info.Mode())
	}
	c, err := Load(path)
	if err != nil || c.Instance != "https://werkbuch.example.com" || c.Repos["WEB"] != "/tmp/repo" || c.Host() != "werkbuch.example.com" {
		t.Fatalf("got %+v %v", c, err)
	}
}

func TestNormalize(t *testing.T) {
	ok := map[string]string{
		"https://werkbuch.example.com/": "https://werkbuch.example.com",
		" http://localhost:8080 ":       "http://localhost:8080",
		"https://example.com/werkbuch/": "https://example.com/werkbuch",
	}
	for in, want := range ok {
		if got, err := NormalizeInstance(in); err != nil || got != want {
			t.Errorf("%q: %q %v", in, got, err)
		}
	}
	for _, bad := range []string{"", "werkbuch.example.com", "ftp://x", "https://u:p@x", "https://x?a=1", "https://x#f", "http://werkbuch.example.com", "http://10.0.0.5"} {
		if _, err := NormalizeInstance(bad); err == nil {
			t.Errorf("%q accepted", bad)
		}
	}
}

func TestLoadBroken(t *testing.T) {
	path := filepath.Join(t.TempDir(), "config.yaml")
	os.WriteFile(path, []byte("instance: [\n"), 0o600)
	if _, err := Load(path); err == nil {
		t.Fatal("broken yaml accepted")
	}
	os.WriteFile(path, []byte("instance: nope\n"), 0o600)
	if _, err := Load(path); err == nil {
		t.Fatal("bad instance accepted")
	}
}
