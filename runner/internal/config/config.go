// Package config reads and writes the one file of settings on the runner (spec 8.4): the instance it is paired with.
// Name, places and the commands of projects are set in werkbuch and come with every answer. Until projects have
// repositories (WEBU-24), `repos` maps a project identifier to a local repository for development (A491).
package config

import (
	"errors"
	"fmt"
	"net"
	"net/url"
	"os"
	"path/filepath"
	"strings"

	"gopkg.in/yaml.v3"
)

// Config is config.yaml.
type Config struct {
	// Instance is the base URL of werkbuch (`https://werkbuch.example.com`).
	Instance string `yaml:"instance"`
	// Repos maps a project identifier to a repository (a local path or URL) for projects werkbuch sends no repository
	// for yet (A491, development until WEBU-24).
	Repos map[string]string `yaml:"repos,omitempty"`
}

// ErrMissing says the runner was never paired.
var ErrMissing = errors.New("no config: pair the runner with `werkbuch-runner login <url> --code <code>`")

// Load reads the config at path.
func Load(path string) (Config, error) {
	var c Config
	data, err := os.ReadFile(path)
	if errors.Is(err, os.ErrNotExist) {
		return c, ErrMissing
	}
	if err != nil {
		return c, err
	}
	if err := yaml.Unmarshal(data, &c); err != nil {
		return c, fmt.Errorf("read %s: %w", path, err)
	}
	if c.Instance == "" {
		return c, ErrMissing
	}
	inst, err := NormalizeInstance(c.Instance)
	if err != nil {
		return c, err
	}
	c.Instance = inst
	return c, nil
}

// Save writes the config at path (0600, its folder 0700).
func Save(path string, c Config) error {
	if err := os.MkdirAll(filepath.Dir(path), 0o700); err != nil {
		return err
	}
	data, err := yaml.Marshal(c)
	if err != nil {
		return err
	}
	tmp := path + ".tmp"
	if err := os.WriteFile(tmp, data, 0o600); err != nil {
		return err
	}
	return os.Rename(tmp, path)
}

// NormalizeInstance checks a base URL: https (http only on loopback, spec 6.1), a host, no credentials, query or fragment; the path without
// a trailing slash.
func NormalizeInstance(raw string) (string, error) {
	u, err := url.Parse(strings.TrimSpace(raw))
	if err != nil || (u.Scheme != "https" && u.Scheme != "http") || u.Host == "" {
		return "", fmt.Errorf("instance %q: want an http(s) URL like https://werkbuch.example.com", raw)
	}
	if u.User != nil || u.RawQuery != "" || u.Fragment != "" {
		return "", fmt.Errorf("instance %q: no user, query or fragment", raw)
	}
	if u.Scheme == "http" && !Loopback(u.Hostname()) {
		return "", fmt.Errorf("instance %q: werkbuch is reached over https (http only on this machine)", raw)
	}
	return strings.TrimRight(u.Scheme+"://"+u.Host+u.Path, "/"), nil
}

// Loopback says whether a host is this machine (`localhost`, 127.0.0.0/8, ::1).
func Loopback(host string) bool {
	if host == "localhost" {
		return true
	}
	ip := net.ParseIP(host)
	return ip != nil && ip.IsLoopback()
}

// Host is the host of the instance (without port), to recognize other ways to werkbuch on the machine.
func (c Config) Host() string {
	u, err := url.Parse(c.Instance)
	if err != nil {
		return ""
	}
	return u.Hostname()
}
