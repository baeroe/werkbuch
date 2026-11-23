// Package paths names the files of the runner: config, state (logs, socket) and data (repositories, worktrees), like
// skilltri and tussh (XDG with defaults below the home directory). Each can be moved by an environment variable,
// which the tests use.
package paths

import (
	"os"
	"path/filepath"
)

const app = "werkbuch-runner"

func dir(override, xdg, fallback string) string {
	if v := os.Getenv(override); v != "" {
		return v
	}
	if v := os.Getenv(xdg); v != "" {
		return filepath.Join(v, app)
	}
	home, err := os.UserHomeDir()
	if err != nil {
		home = "."
	}
	return filepath.Join(home, fallback, app)
}

// ConfigDir holds config.yaml.
func ConfigDir() string { return dir("WERKBUCH_RUNNER_CONFIG_DIR", "XDG_CONFIG_HOME", ".config") }

// StateDir holds the log, the socket and the state of runs.
func StateDir() string { return dir("WERKBUCH_RUNNER_STATE_DIR", "XDG_STATE_HOME", ".local/state") }

// DataDir holds the repositories, worktrees and working folders.
func DataDir() string { return dir("WERKBUCH_RUNNER_DATA_DIR", "XDG_DATA_HOME", ".local/share") }

// ConfigFile is the one file of settings on the machine (spec 8.4: the instance; everything else is set in werkbuch).
func ConfigFile() string { return filepath.Join(ConfigDir(), "config.yaml") }

// Socket is where the daemon listens for the TUI and the commands.
func Socket() string {
	if v := os.Getenv("WERKBUCH_RUNNER_SOCKET"); v != "" {
		return v
	}
	return filepath.Join(StateDir(), "runner.sock")
}
