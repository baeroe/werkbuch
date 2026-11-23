package keyring

import (
	"errors"
	"os"
	"path/filepath"
	"testing"

	gokeyring "github.com/zalando/go-keyring"
)

func TestRoundTrip(t *testing.T) {
	t.Setenv("WERKBUCH_RUNNER_CONFIG_DIR", t.TempDir())
	Mock()
	if _, err := Get("https://a.example.com"); !errors.Is(err, ErrNotFound) {
		t.Fatalf("missing: %v", err)
	}
	if err := Set("https://a.example.com", "wbr_x"); err != nil {
		t.Fatal(err)
	}
	if v, err := Get("https://a.example.com"); err != nil || v != "wbr_x" {
		t.Fatalf("%q %v", v, err)
	}
	if err := Delete("https://a.example.com"); err != nil {
		t.Fatal(err)
	}
	if err := Delete("https://a.example.com"); err != nil {
		t.Fatalf("delete missing: %v", err)
	}
}

func TestFileWithoutSecretService(t *testing.T) {
	dir := t.TempDir()
	t.Setenv("WERKBUCH_RUNNER_CONFIG_DIR", dir)
	gokeyring.MockInitWithError(errors.New("org.freedesktop.secrets was not provided"))
	defer Mock()
	old := Fallback
	defer func() { Fallback = old }()

	Fallback = func(error) bool { return false }
	if err := Set("https://a.example.com", "wbr_x"); err == nil {
		t.Fatal("without the fallback the error stays")
	}
	Fallback = func(err error) bool { return err != nil && !errors.Is(err, gokeyring.ErrNotFound) }
	if err := Set("https://a.example.com", "wbr_x"); err != nil {
		t.Fatal(err)
	}
	info, err := os.Stat(filepath.Join(dir, "credentials.json"))
	if err != nil || info.Mode().Perm() != 0o600 {
		t.Fatalf("file %v %v", info, err)
	}
	if v, err := Get("https://a.example.com"); err != nil || v != "wbr_x" {
		t.Fatalf("%q %v", v, err)
	}
	if _, err := Get("https://b.example.com"); !errors.Is(err, ErrNotFound) {
		t.Fatal(err)
	}
	if err := Delete("https://a.example.com"); err != nil {
		t.Fatal(err)
	}
	if _, err := os.Stat(filepath.Join(dir, "credentials.json")); !os.IsNotExist(err) {
		t.Fatal("the empty file stays")
	}
}
