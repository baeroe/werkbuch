// Package keyring keeps the runner token in the keychain of the machine (spec 6.2: never in the config), under the
// service `werkbuch-runner` and the instance URL as account. go-keyring uses `security` on macOS and the Secret
// Service on Linux, without cgo.
package keyring

import (
	"errors"

	gokeyring "github.com/zalando/go-keyring"
)

// Service is the name of the keychain entries of the runner; it touches no other entry.
const Service = "werkbuch-runner"

// ErrNotFound says there is no token for the instance.
var ErrNotFound = errors.New("no runner token in the keychain: pair again with `werkbuch-runner login`")

// Get reads the token of the instance.
func Get(instance string) (string, error) {
	v, err := gokeyring.Get(Service, instance)
	if errors.Is(err, gokeyring.ErrNotFound) {
		return "", ErrNotFound
	}
	return v, err
}

// Set stores the token of the instance.
func Set(instance, token string) error { return gokeyring.Set(Service, instance, token) }

// Delete removes the token of the instance; a missing one is no error.
func Delete(instance string) error {
	err := gokeyring.Delete(Service, instance)
	if errors.Is(err, gokeyring.ErrNotFound) {
		return nil
	}
	return err
}

// Mock switches to a keychain in memory (tests).
func Mock() { gokeyring.MockInit() }
