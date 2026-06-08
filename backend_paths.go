package main

import (
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"strings"
)

func workspacePathFromCache(workspaceID string) (string, error) {
	if strings.TrimSpace(workspaceID) == "" {
		return "", errors.New("workspace id is required")
	}

	cache, err := loadWorkspaceCache()
	if err != nil {
		return "", err
	}

	workspaces, _ := cache["workspaces"].([]any)
	for _, item := range workspaces {
		workspace, ok := item.(map[string]any)
		if !ok || stringFromAny(workspace["id"]) != workspaceID {
			continue
		}

		workspacePath := strings.TrimSpace(stringFromAny(workspace["path"]))
		if workspacePath == "" {
			return "", fmt.Errorf("workspace %s has no path", workspaceID)
		}
		return cleanPath(workspacePath)
	}

	return "", fmt.Errorf("workspace not found: %s", workspaceID)
}

func stringFromAny(value any) string {
	text, _ := value.(string)
	return text
}

func piSessionDirForCWD(cwd string) string {
	if root := os.Getenv("PI_CODING_AGENT_SESSION_DIR"); root != "" {
		return cwdScopedSessionDir(root, cwd)
	}

	if sessionDir := projectSessionDir(cwd); sessionDir != "" {
		return sessionDir
	}

	root := defaultPiSessionDir()
	if root == "" {
		return ""
	}

	return cwdScopedSessionDir(root, cwd)
}

func cwdScopedSessionDir(root string, cwd string) string {
	safePath := "--" + strings.NewReplacer("/", "-", "\\", "-", ":", "-").Replace(strings.TrimLeft(cwd, "/\\")) + "--"
	return filepath.Join(root, safePath)
}

func projectSessionDir(cwd string) string {
	settingsPath := filepath.Join(cwd, ".pi", "settings.json")
	data, err := os.ReadFile(settingsPath)
	if err != nil {
		return ""
	}

	var settings map[string]any
	if err := json.Unmarshal(data, &settings); err != nil {
		return ""
	}

	sessionDir := strings.TrimSpace(stringFromAny(settings["sessionDir"]))
	if sessionDir == "" {
		return ""
	}
	if sessionDir == "~" || strings.HasPrefix(sessionDir, "~/") {
		home, err := os.UserHomeDir()
		if err != nil || home == "" {
			return ""
		}
		if sessionDir == "~" {
			return filepath.Clean(home)
		}
		return filepath.Clean(filepath.Join(home, strings.TrimPrefix(sessionDir, "~/")))
	}
	if filepath.IsAbs(sessionDir) {
		return filepath.Clean(sessionDir)
	}
	return filepath.Clean(filepath.Join(cwd, sessionDir))
}

func defaultPiSessionDir() string {
	if value := os.Getenv("PI_CODING_AGENT_SESSION_DIR"); value != "" {
		return value
	}
	if home, err := os.UserHomeDir(); err == nil {
		return filepath.Join(home, ".pi", "agent", "sessions")
	}
	return ""
}

func defaultPiTeamsDir() string {
	if value := strings.TrimSpace(os.Getenv("PI_TEAMS_ROOT_DIR")); value != "" {
		if filepath.IsAbs(value) {
			return filepath.Clean(value)
		}

		if home, err := os.UserHomeDir(); err == nil {
			return filepath.Join(home, ".pi", "agent", value)
		}
		return filepath.Clean(value)
	}
	if home, err := os.UserHomeDir(); err == nil {
		return filepath.Join(home, ".pi", "agent", "teams")
	}
	return ""
}

func workspaceCacheFile() (string, error) {
	home, err := os.UserHomeDir()
	if err != nil || home == "" {
		return "", errors.New("home directory not found")
	}
	return filepath.Join(home, workspaceCachePath), nil
}

func repoNameFromURL(value string) string {
	clean := strings.TrimSuffix(strings.TrimSpace(value), "/")
	base := filepath.Base(clean)
	base = strings.TrimSuffix(base, ".git")
	if base == "." || base == string(os.PathSeparator) || base == "" {
		return ""
	}
	return base
}

func cleanPath(value string) (string, error) {
	path := strings.TrimSpace(value)
	if path == "" || path == "~" {
		home, err := os.UserHomeDir()
		if err != nil || home == "" {
			return "", errors.New("home directory not found")
		}
		path = home
	} else if strings.HasPrefix(path, "~/") {
		home, err := os.UserHomeDir()
		if err != nil || home == "" {
			return "", errors.New("home directory not found")
		}
		path = filepath.Join(home, strings.TrimPrefix(path, "~/"))
	}
	abs, err := filepath.Abs(path)
	if err != nil {
		return "", err
	}
	real, err := filepath.EvalSymlinks(abs)
	if err != nil {
		return "", err
	}
	info, err := os.Stat(real)
	if err != nil {
		return "", err
	}
	if !info.IsDir() {
		return "", fmt.Errorf("not a directory: %s", real)
	}
	return real, nil
}

func displayPath(path string) string {
	home, err := os.UserHomeDir()
	if err != nil || home == "" {
		return path
	}
	if path == home {
		return "~"
	}
	prefix := home + string(os.PathSeparator)
	if strings.HasPrefix(path, prefix) {
		return "~/" + strings.TrimPrefix(path, prefix)
	}
	return path
}

func parentPath(path string) string {
	parent := filepath.Dir(path)
	if parent == path {
		return path
	}
	return parent
}

func shouldHide(name string) bool {
	switch name {
	case ".git", "node_modules", ".Trash":
		return true
	default:
		return false
	}
}

func fail(err error) {
	fmt.Fprintln(os.Stderr, err)
	os.Exit(1)
}
