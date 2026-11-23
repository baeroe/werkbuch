package paths

import "testing"

func TestOverrides(t *testing.T) {
	t.Setenv("WERKBUCH_RUNNER_CONFIG_DIR", "/c")
	t.Setenv("WERKBUCH_RUNNER_STATE_DIR", "/s")
	t.Setenv("WERKBUCH_RUNNER_DATA_DIR", "/d")
	t.Setenv("WERKBUCH_RUNNER_SOCKET", "")
	if ConfigFile() != "/c/config.yaml" || StateDir() != "/s" || DataDir() != "/d" || Socket() != "/s/runner.sock" {
		t.Fatalf("got %s %s %s %s", ConfigFile(), StateDir(), DataDir(), Socket())
	}
}

func TestDefaults(t *testing.T) {
	for _, k := range []string{"WERKBUCH_RUNNER_CONFIG_DIR", "WERKBUCH_RUNNER_STATE_DIR", "WERKBUCH_RUNNER_DATA_DIR", "XDG_CONFIG_HOME", "XDG_STATE_HOME", "XDG_DATA_HOME"} {
		t.Setenv(k, "")
	}
	t.Setenv("HOME", "/home/demo")
	want := map[string]string{
		ConfigDir(): "/home/demo/.config/werkbuch-runner",
		StateDir():  "/home/demo/.local/state/werkbuch-runner",
		DataDir():   "/home/demo/.local/share/werkbuch-runner",
	}
	for got, w := range want {
		if got != w {
			t.Errorf("got %q, want %q", got, w)
		}
	}
	t.Setenv("XDG_STATE_HOME", "/x")
	if StateDir() != "/x/werkbuch-runner" {
		t.Errorf("xdg: %s", StateDir())
	}
}
