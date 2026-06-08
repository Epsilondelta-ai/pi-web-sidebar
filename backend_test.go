package main

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestRequestDataAcceptsNestedBackendEnvelope(t *testing.T) {
	input := request{"data": map[string]any{"path": "/workspace"}}
	data := requestData(input)

	if got := stringInput(data, "path"); got != "/workspace" {
		t.Fatalf("path = %q, want /workspace", got)
	}
}

func TestRequestDataAcceptsTopLevelInput(t *testing.T) {
	input := request{"path": "/workspace"}
	data := requestData(input)

	if got := stringInput(data, "path"); got != "/workspace" {
		t.Fatalf("path = %q, want /workspace", got)
	}
}

func TestRepoNameFromURL(t *testing.T) {
	if got := repoNameFromURL("https://example.com/team/repo.git"); got != "repo" {
		t.Fatalf("repoNameFromURL = %q, want repo", got)
	}
}

func TestCheckPiStatusUsesDirectPiExecutable(t *testing.T) {
	fakePi := fakeExecutable(t, "pi test")
	t.Setenv("PI_BIN", fakePi)
	status, err := checkPiStatus()
	if err != nil {
		t.Fatalf("checkPiStatus error = %v", err)
	}
	if !status.Available {
		t.Fatalf("status.Available = false, error = %q", status.Error)
	}
	if status.Executable != fakePi {
		t.Fatalf("status.Executable = %q, want %q", status.Executable, fakePi)
	}
	if status.Version != "pi test" {
		t.Fatalf("status.Version = %q, want pi test", status.Version)
	}
	if status.CheckedAt == "" {
		t.Fatal("status.CheckedAt is empty")
	}
}

func TestCheckPiStatusReturnsUnavailableWhenPiMissing(t *testing.T) {
	t.Setenv("PI_BIN", "")
	t.Setenv("PATH", "")
	status, err := checkPiStatus()
	if err != nil {
		t.Fatalf("checkPiStatus error = %v", err)
	}
	if status.Available {
		t.Fatal("status.Available = true, want false")
	}
	if status.Error != "pi executable not found" {
		t.Fatalf("status.Error = %q, want pi executable not found", status.Error)
	}
}

func TestLoadWorkspaceCachePrunesMissingSessions(t *testing.T) {
	home := t.TempDir()
	workspace := filepath.Join(home, "workspace")
	sessionRoot := filepath.Join(home, "sessions")
	if err := os.MkdirAll(workspace, 0o755); err != nil {
		t.Fatalf("create workspace: %v", err)
	}
	cleanWorkspace, err := cleanPath(workspace)
	if err != nil {
		t.Fatalf("clean workspace: %v", err)
	}
	sessionDir := piSessionDirForCWDWithRoot(sessionRoot, cleanWorkspace)
	if err := os.MkdirAll(sessionDir, 0o700); err != nil {
		t.Fatalf("create session dir: %v", err)
	}
	if err := os.WriteFile(filepath.Join(sessionDir, "real.jsonl"), []byte(`{"id":"real"}`+"\n"), 0o600); err != nil {
		t.Fatalf("write session file: %v", err)
	}

	cacheDir := filepath.Join(home, ".pi-web", "pi-web-sidebar")
	if err := os.MkdirAll(cacheDir, 0o755); err != nil {
		t.Fatalf("create cache dir: %v", err)
	}
	cache := `{"workspaces":[{"id":"w1","path":"` + workspace + `","live":true,"sessions":[{"id":"real","active":true},{"id":"stale","active":true}]}]}`
	if err := os.WriteFile(filepath.Join(cacheDir, "workspaces.json"), []byte(cache), 0o600); err != nil {
		t.Fatalf("write cache: %v", err)
	}
	t.Setenv("HOME", home)
	t.Setenv("PI_CODING_AGENT_SESSION_DIR", sessionRoot)

	result, err := loadWorkspaceCache()
	if err != nil {
		t.Fatalf("loadWorkspaceCache error = %v", err)
	}
	workspaces := result["workspaces"].([]any)
	workspaceCache := workspaces[0].(map[string]any)
	sessions := workspaceCache["sessions"].([]any)
	if len(sessions) != 1 {
		t.Fatalf("sessions length = %d, want 1", len(sessions))
	}
	if sessions[0].(map[string]any)["id"] != "real" {
		t.Fatalf("session id = %v, want real", sessions[0].(map[string]any)["id"])
	}
	if workspaceCache["sessionCount"] != 1 {
		t.Fatalf("sessionCount = %v, want 1", workspaceCache["sessionCount"])
	}
}

func TestLoadWorkspaceCacheAddsUncachedExistingSessions(t *testing.T) {
	home := t.TempDir()
	workspace := filepath.Join(home, "workspace")
	sessionRoot := filepath.Join(home, "sessions")
	if err := os.MkdirAll(workspace, 0o755); err != nil {
		t.Fatalf("create workspace: %v", err)
	}
	cleanWorkspace, err := cleanPath(workspace)
	if err != nil {
		t.Fatalf("clean workspace: %v", err)
	}
	sessionDir := piSessionDirForCWDWithRoot(sessionRoot, cleanWorkspace)
	if err := os.MkdirAll(sessionDir, 0o700); err != nil {
		t.Fatalf("create session dir: %v", err)
	}
	externalSession := []byte(`{"id":"external","title":"external chat","parentId":"parent"}` + "\n")
	if err := os.WriteFile(filepath.Join(sessionDir, "external.jsonl"), externalSession, 0o600); err != nil {
		t.Fatalf("write session file: %v", err)
	}

	cacheDir := filepath.Join(home, ".pi-web", "pi-web-sidebar")
	if err := os.MkdirAll(cacheDir, 0o755); err != nil {
		t.Fatalf("create cache dir: %v", err)
	}
	cache := `{"workspaces":[{"id":"w1","path":"` + workspace + `","sessions":[]}]}`
	if err := os.WriteFile(filepath.Join(cacheDir, "workspaces.json"), []byte(cache), 0o600); err != nil {
		t.Fatalf("write cache: %v", err)
	}
	t.Setenv("HOME", home)
	t.Setenv("PI_CODING_AGENT_SESSION_DIR", sessionRoot)

	result, err := loadWorkspaceCache()
	if err != nil {
		t.Fatalf("loadWorkspaceCache error = %v", err)
	}
	workspaceCache := result["workspaces"].([]any)[0].(map[string]any)
	sessions := workspaceCache["sessions"].([]any)
	if len(sessions) != 1 {
		t.Fatalf("sessions length = %d, want 1", len(sessions))
	}
	session := sessions[0].(map[string]any)
	if session["id"] != "external" || session["title"] != "external chat" || session["parentId"] != "parent" {
		t.Fatalf("session = %v, want external metadata", session)
	}
	if workspaceCache["sessionCount"] != 1 {
		t.Fatalf("sessionCount = %v, want 1", workspaceCache["sessionCount"])
	}
}

func TestSaveWorkspaceCachePrunesMissingSessionsBeforeWriting(t *testing.T) {
	home := t.TempDir()
	workspace := filepath.Join(home, "workspace")
	sessionRoot := filepath.Join(home, "sessions")
	if err := os.MkdirAll(workspace, 0o755); err != nil {
		t.Fatalf("create workspace: %v", err)
	}
	cleanWorkspace, err := cleanPath(workspace)
	if err != nil {
		t.Fatalf("clean workspace: %v", err)
	}
	sessionDir := piSessionDirForCWDWithRoot(sessionRoot, cleanWorkspace)
	if err := os.MkdirAll(sessionDir, 0o700); err != nil {
		t.Fatalf("create session dir: %v", err)
	}
	if err := os.WriteFile(filepath.Join(sessionDir, "real.jsonl"), []byte(`{"id":"real"}`+"\n"), 0o600); err != nil {
		t.Fatalf("write session file: %v", err)
	}
	t.Setenv("HOME", home)
	t.Setenv("PI_CODING_AGENT_SESSION_DIR", sessionRoot)

	_, err = saveWorkspaceCache(request{"workspaces": []any{map[string]any{
		"id":       "w1",
		"path":     workspace,
		"live":     true,
		"sessions": []any{map[string]any{"id": "real"}, map[string]any{"id": "stale", "active": true}},
	}}})
	if err != nil {
		t.Fatalf("saveWorkspaceCache error = %v", err)
	}

	data, err := os.ReadFile(filepath.Join(home, ".pi-web", "pi-web-sidebar", "workspaces.json"))
	if err != nil {
		t.Fatalf("read cache: %v", err)
	}
	text := string(data)
	if !strings.Contains(text, "real") {
		t.Fatalf("cache = %s, want real", text)
	}
	if strings.Contains(text, "stale") {
		t.Fatalf("cache = %s, want stale pruned", text)
	}
}

func TestLoadWorkspaceCacheClearsLiveWhenNoRealSessionsRemain(t *testing.T) {
	home := t.TempDir()
	workspace := filepath.Join(home, "workspace")
	if err := os.MkdirAll(workspace, 0o755); err != nil {
		t.Fatalf("create workspace: %v", err)
	}
	cacheDir := filepath.Join(home, ".pi-web", "pi-web-sidebar")
	if err := os.MkdirAll(cacheDir, 0o755); err != nil {
		t.Fatalf("create cache dir: %v", err)
	}
	cache := `{"workspaces":[{"id":"w1","path":"` + workspace + `","live":true,"sessions":[{"id":"stale","active":true}]}]}`
	if err := os.WriteFile(filepath.Join(cacheDir, "workspaces.json"), []byte(cache), 0o600); err != nil {
		t.Fatalf("write cache: %v", err)
	}
	t.Setenv("HOME", home)
	t.Setenv("PI_CODING_AGENT_SESSION_DIR", filepath.Join(home, "sessions"))

	result, err := loadWorkspaceCache()
	if err != nil {
		t.Fatalf("loadWorkspaceCache error = %v", err)
	}
	workspaceCache := result["workspaces"].([]any)[0].(map[string]any)
	if len(workspaceCache["sessions"].([]any)) != 0 {
		t.Fatalf("sessions = %v, want empty", workspaceCache["sessions"])
	}
	if workspaceCache["sessionCount"] != 0 {
		t.Fatalf("sessionCount = %v, want 0", workspaceCache["sessionCount"])
	}
	if workspaceCache["live"] != false {
		t.Fatalf("live = %v, want false", workspaceCache["live"])
	}
}

func piSessionDirForCWDWithRoot(root string, cwd string) string {
	safePath := "--" + strings.NewReplacer("/", "-", "\\", "-", ":", "-").Replace(strings.TrimLeft(cwd, "/\\")) + "--"
	return filepath.Join(root, safePath)
}

func TestDeleteSessionsRemovesSelectedSessionFiles(t *testing.T) {
	home := t.TempDir()
	workspace := filepath.Join(home, "workspace")
	sessionRoot := filepath.Join(home, "sessions")
	if err := os.MkdirAll(workspace, 0o755); err != nil {
		t.Fatalf("create workspace: %v", err)
	}
	cleanWorkspace, err := cleanPath(workspace)
	if err != nil {
		t.Fatalf("clean workspace: %v", err)
	}
	sessionDir := piSessionDirForCWDWithRoot(sessionRoot, cleanWorkspace)
	if err := os.MkdirAll(sessionDir, 0o700); err != nil {
		t.Fatalf("create session dir: %v", err)
	}
	deleteFile := filepath.Join(sessionDir, "delete.jsonl")
	keepFile := filepath.Join(sessionDir, "keep.jsonl")
	if err := os.WriteFile(deleteFile, []byte(`{"id":"delete-me"}`+"\n"), 0o600); err != nil {
		t.Fatalf("write delete file: %v", err)
	}
	if err := os.WriteFile(keepFile, []byte(`{"id":"keep-me"}`+"\n"), 0o600); err != nil {
		t.Fatalf("write keep file: %v", err)
	}
	cacheDir := filepath.Join(home, ".pi-web", "pi-web-sidebar")
	if err := os.MkdirAll(cacheDir, 0o755); err != nil {
		t.Fatalf("create cache dir: %v", err)
	}
	cache := `{"workspaces":[{"id":"w1","path":"` + workspace + `"}]}`
	if err := os.WriteFile(filepath.Join(cacheDir, "workspaces.json"), []byte(cache), 0o600); err != nil {
		t.Fatalf("write cache: %v", err)
	}
	t.Setenv("HOME", home)
	t.Setenv("PI_CODING_AGENT_SESSION_DIR", sessionRoot)

	result, err := deleteSessions("w1", []string{"delete-me"})
	if err != nil {
		t.Fatalf("deleteSessions error = %v", err)
	}
	deleted := result["deleted"].([]string)
	if len(deleted) != 1 || deleted[0] != "delete-me" {
		t.Fatalf("deleted = %v, want delete-me", deleted)
	}
	if _, err := os.Stat(deleteFile); !os.IsNotExist(err) {
		t.Fatalf("delete file still exists or unexpected error: %v", err)
	}
	if _, err := os.Stat(keepFile); err != nil {
		t.Fatalf("keep file missing: %v", err)
	}
}

func TestDeleteWorkspaceSessionsRemovesWorkspaceSessionDir(t *testing.T) {
	home := t.TempDir()
	workspace := filepath.Join(home, "workspace")
	sessionRoot := filepath.Join(home, "sessions")
	if err := os.MkdirAll(workspace, 0o755); err != nil {
		t.Fatalf("create workspace: %v", err)
	}
	cacheDir := filepath.Join(home, ".pi-web", "pi-web-sidebar")
	if err := os.MkdirAll(cacheDir, 0o755); err != nil {
		t.Fatalf("create cache dir: %v", err)
	}
	cache := `{"workspaces":[{"id":"w1","path":"` + workspace + `"}]}`
	if err := os.WriteFile(filepath.Join(cacheDir, "workspaces.json"), []byte(cache), 0o600); err != nil {
		t.Fatalf("write cache: %v", err)
	}
	t.Setenv("HOME", home)
	t.Setenv("PI_CODING_AGENT_SESSION_DIR", sessionRoot)

	cleanWorkspace, err := cleanPath(workspace)
	if err != nil {
		t.Fatalf("clean workspace: %v", err)
	}
	sessionDir := piSessionDirForCWD(cleanWorkspace)
	if err := os.MkdirAll(sessionDir, 0o700); err != nil {
		t.Fatalf("create session dir: %v", err)
	}
	if err := os.WriteFile(filepath.Join(sessionDir, "session.jsonl"), []byte("{}\n"), 0o600); err != nil {
		t.Fatalf("write session file: %v", err)
	}

	result, err := deleteWorkspaceSessions("w1")
	if err != nil {
		t.Fatalf("deleteWorkspaceSessions error = %v", err)
	}
	if result["deleted"] != true {
		t.Fatalf("deleted = %v, want true", result["deleted"])
	}
	if _, err := os.Stat(sessionDir); !os.IsNotExist(err) {
		t.Fatalf("session dir still exists or unexpected error: %v", err)
	}
}

func TestDeleteWorkspaceSessionsRequiresKnownWorkspace(t *testing.T) {
	home := t.TempDir()
	cacheDir := filepath.Join(home, ".pi-web", "pi-web-sidebar")
	if err := os.MkdirAll(cacheDir, 0o755); err != nil {
		t.Fatalf("create cache dir: %v", err)
	}
	if err := os.WriteFile(filepath.Join(cacheDir, "workspaces.json"), []byte(`{"workspaces":[]}`), 0o600); err != nil {
		t.Fatalf("write cache: %v", err)
	}
	t.Setenv("HOME", home)

	if _, err := deleteWorkspaceSessions("missing"); err == nil {
		t.Fatal("deleteWorkspaceSessions error = nil, want error")
	}
}

func TestFirstOutputLine(t *testing.T) {
	if got := firstOutputLine([]byte("\npi 1.2.3\nextra")); got != "pi 1.2.3" {
		t.Fatalf("firstOutputLine = %q, want pi 1.2.3", got)
	}
}

func TestResolvePiExecutableHonorsEnv(t *testing.T) {
	t.Setenv("PI_BIN", "/custom/pi")
	executable, err := resolvePiExecutable()
	if err != nil {
		t.Fatalf("resolvePiExecutable error = %v", err)
	}
	if executable != "/custom/pi" {
		t.Fatalf("executable = %q, want /custom/pi", executable)
	}
}

func TestResolvePiExecutableFindsPath(t *testing.T) {
	fakePi := fakeExecutable(t, "pi test")
	t.Setenv("PI_BIN", "")
	t.Setenv("PATH", filepath.Dir(fakePi))
	executable, err := resolvePiExecutable()
	if err != nil {
		t.Fatalf("resolvePiExecutable error = %v", err)
	}
	if executable != fakePi {
		t.Fatalf("executable = %q, want %q", executable, fakePi)
	}
}

func fakeExecutable(t *testing.T, output string) string {
	t.Helper()
	path := filepath.Join(t.TempDir(), "pi")
	content := "#!/bin/sh\necho '" + output + "'\n"
	if err := os.WriteFile(path, []byte(content), 0o755); err != nil {
		t.Fatalf("write fake executable: %v", err)
	}
	return path
}
