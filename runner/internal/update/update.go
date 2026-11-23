// Package update replaces the runner with the binary of its instance (spec 8.3): when werkbuch names another version,
// the daemon fetches `/runner/download/<os>/<arch>` and its `.sha256`, checks the sum and that the new binary names
// the expected version, swaps it in atomically and starts again once no run is left. A failed update keeps the old
// binary running.
package update

import (
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/hex"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"strings"
	"syscall"

	"github.com/baeroe/werkbuch/runner/internal/client"
)

// MaxBinary bounds a download.
const MaxBinary = 256 << 20

// Updater updates one executable.
type Updater struct {
	Client *client.Client
	// Exe is the binary to replace (os.Executable).
	Exe  string
	OS   string
	Arch string
}

// New updates the running binary.
func New(c *client.Client) (*Updater, error) {
	exe, err := os.Executable()
	if err != nil {
		return nil, err
	}
	if resolved, err := filepath.EvalSymlinks(exe); err == nil {
		exe = resolved
	}
	return &Updater{Client: c, Exe: exe, OS: runtime.GOOS, Arch: runtime.GOARCH}, nil
}

// Apply downloads, checks and swaps in the binary of version.
func (u *Updater) Apply(ctx context.Context, version string) error {
	base := "/runner/download/" + u.OS + "/" + u.Arch
	bin, err := u.Client.Download(ctx, base, MaxBinary)
	if err != nil {
		return err
	}
	sumFile, err := u.Client.Download(ctx, base+".sha256", 4096)
	if err != nil {
		return err
	}
	fields := strings.Fields(string(sumFile))
	sum := sha256.Sum256(bin)
	if len(fields) == 0 || !strings.EqualFold(fields[0], hex.EncodeToString(sum[:])) {
		return fmt.Errorf("checksum of the download does not match")
	}
	tmp, err := os.CreateTemp(filepath.Dir(u.Exe), ".werkbuch-runner-update-*")
	if err != nil {
		return err
	}
	defer os.Remove(tmp.Name())
	if _, err := tmp.Write(bin); err != nil {
		tmp.Close()
		return err
	}
	if err := tmp.Close(); err != nil {
		return err
	}
	if err := os.Chmod(tmp.Name(), 0o755); err != nil {
		return err
	}
	out, err := exec.CommandContext(ctx, tmp.Name(), "version").Output()
	if err != nil {
		return fmt.Errorf("the new binary does not start: %v", err)
	}
	if got := strings.TrimSpace(string(out)); !strings.Contains(got, version) {
		return fmt.Errorf("the new binary is %q, not %s", got, version)
	}
	return os.Rename(tmp.Name(), u.Exe)
}

// Restart replaces the process with the (new) binary and the same arguments.
func (u *Updater) Restart() error {
	return syscall.Exec(u.Exe, os.Args, os.Environ())
}

// Compare says whether the version werkbuch expects differs from the running one; a development build never updates.
func Compare(running, expected string) bool {
	if expected == "" || running == "" || running == "dev" {
		return false
	}
	return !bytes.Equal([]byte(strings.TrimPrefix(running, "v")), []byte(strings.TrimPrefix(expected, "v")))
}
