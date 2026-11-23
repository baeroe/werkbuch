// Package keyring keeps the runner token in the keychain of the machine (spec 6.2: never in the config), under the
// service `werkbuch-runner` and the instance URL as account. go-keyring uses `security` on macOS and the Secret
// Service on Linux, without cgo. A Linux server without a Secret Service (headless, no D-Bus session) keeps the token in
// `credentials.json` next to the config instead, readable by the user alone (0600).
package keyring

import (
	"encoding/json"
	"errors"
	"os"
	"path/filepath"
	"runtime"
	"sync"

	gokeyring "github.com/zalando/go-keyring"

	"github.com/baeroe/werkbuch/runner/internal/paths"
)

// Service is the name of the keychain entries of the runner; it touches no other entry.
const Service = "werkbuch-runner"

// ErrNotFound says there is no token for the instance.
var ErrNotFound = errors.New("no runner token in the keychain: pair again with `werkbuch-runner login`")

// Fallback says whether an error of the keychain sends the token to the file (Linux without a Secret Service).
var Fallback = func(err error) bool {
	return runtime.GOOS == "linux" && err != nil && !errors.Is(err, gokeyring.ErrNotFound)
}

var fileMu sync.Mutex

func file() string { return filepath.Join(paths.ConfigDir(), "credentials.json") }

func readFile() map[string]string {
	m := map[string]string{}
	if data, err := os.ReadFile(file()); err == nil {
		json.Unmarshal(data, &m)
	}
	return m
}

func writeFile(m map[string]string) error {
	if err := os.MkdirAll(filepath.Dir(file()), 0o700); err != nil {
		return err
	}
	if len(m) == 0 {
		err := os.Remove(file())
		if errors.Is(err, os.ErrNotExist) {
			return nil
		}
		return err
	}
	data, _ := json.Marshal(m)
	tmp := file() + ".tmp"
	if err := os.WriteFile(tmp, data, 0o600); err != nil {
		return err
	}
	return os.Rename(tmp, file())
}

// Get reads the token of the instance.
func Get(instance string) (string, error) {
	v, err := gokeyring.Get(Service, instance)
	if err == nil {
		return v, nil
	}
	if errors.Is(err, gokeyring.ErrNotFound) || Fallback(err) {
		fileMu.Lock()
		defer fileMu.Unlock()
		if v := readFile()[instance]; v != "" {
			return v, nil
		}
		return "", ErrNotFound
	}
	return "", err
}

// Set stores the token of the instance (in the file when Fallback says so).
func Set(instance, token string) error {
	err := gokeyring.Set(Service, instance, token)
	if err == nil || !Fallback(err) {
		return err
	}
	fileMu.Lock()
	defer fileMu.Unlock()
	m := readFile()
	m[instance] = token
	return writeFile(m)
}

// Delete removes the token of the instance from keychain and file; a missing one is no error.
func Delete(instance string) error {
	err := gokeyring.Delete(Service, instance)
	if err != nil && !errors.Is(err, gokeyring.ErrNotFound) && !Fallback(err) {
		return err
	}
	fileMu.Lock()
	defer fileMu.Unlock()
	m := readFile()
	if _, ok := m[instance]; !ok {
		return nil
	}
	delete(m, instance)
	return writeFile(m)
}

// Mock switches to a keychain in memory (tests).
func Mock() { gokeyring.MockInit() }
