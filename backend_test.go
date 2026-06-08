package main

import (
	"encoding/json"
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

func loadValidatedWorkspaceCacheForTest(t *testing.T) request {
	t.Helper()
	cached, err := loadWorkspaceCache()
	if err != nil {
		t.Fatalf("loadWorkspaceCache error = %v", err)
	}

	result, err := validateWorkspaces(request{"workspaces": cached["workspaces"]})
	if err != nil {
		t.Fatalf("validateWorkspaces error = %v", err)
	}
	return result
}

func TestLoadWorkspaceCacheReturnsRawFileBeforeSessionValidation(t *testing.T) {
	home := t.TempDir()
	cacheDir := filepath.Join(home, ".pi-web", "pi-web-sidebar")
	if err := os.MkdirAll(cacheDir, 0o755); err != nil {
		t.Fatalf("create cache dir: %v", err)
	}
	cache := `{"workspaces":[{"id":"w1","path":"/missing","live":true,"sessions":[{"id":"stale"}]}]}`
	if err := os.WriteFile(filepath.Join(cacheDir, "workspaces.json"), []byte(cache), 0o600); err != nil {
		t.Fatalf("write cache: %v", err)
	}
	t.Setenv("HOME", home)

	result, err := loadWorkspaceCache()
	if err != nil {
		t.Fatalf("loadWorkspaceCache error = %v", err)
	}

	workspaceCache := result["workspaces"].([]any)[0].(map[string]any)
	if len(workspaceCache["sessions"].([]any)) != 1 || workspaceCache["live"] != true {
		t.Fatalf("workspaceCache = %v, want raw file contents", workspaceCache)
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

	result := loadValidatedWorkspaceCacheForTest(t)
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

func TestCreateSessionWritesPrivatePiSessionFile(t *testing.T) {
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
	cache := `{"workspaces":[{"id":"w1","path":"` + workspace + `","sessions":[]}]}`
	if err := os.WriteFile(filepath.Join(cacheDir, "workspaces.json"), []byte(cache), 0o600); err != nil {
		t.Fatalf("write cache: %v", err)
	}
	t.Setenv("HOME", home)
	t.Setenv("PI_CODING_AGENT_SESSION_DIR", sessionRoot)

	result, err := createSession("w1")
	if err != nil {
		t.Fatalf("createSession error = %v", err)
	}
	sessionID := stringFromAny(result["sessionId"])
	if sessionID == "" {
		t.Fatal("sessionId is empty")
	}

	sessionPath := stringFromAny(result["path"])
	data, err := os.ReadFile(sessionPath)
	if err != nil {
		t.Fatalf("read session file: %v", err)
	}
	if !strings.Contains(string(data), `"id":"`+sessionID+`"`) || !strings.Contains(string(data), `"type":"session"`) {
		t.Fatalf("session file = %s, want session header with id", data)
	}
	info, err := os.Stat(sessionPath)
	if err != nil {
		t.Fatalf("stat session file: %v", err)
	}
	if got := info.Mode().Perm(); got != 0o600 {
		t.Fatalf("session file mode = %v, want 0600", got)
	}

	validated := loadValidatedWorkspaceCacheForTest(t)
	sessions := validated["workspaces"].([]any)[0].(map[string]any)["sessions"].([]any)
	if len(sessions) != 1 || sessions[0].(map[string]any)["id"] != sessionID {
		t.Fatalf("validated sessions = %v, want created session %s", sessions, sessionID)
	}
}

func TestLoadWorkspaceCacheDecoratesSubagentChildSessions(t *testing.T) {
	home := t.TempDir()
	workspace := filepath.Join(home, "workspace")
	sessionDir := filepath.Join(workspace, ".pi", "sessions")
	parentID := "019-parent"
	parentName := "2026-06-08T00-00-00Z_" + parentID + ".jsonl"
	childDir := filepath.Join(sessionDir, parentName, "abcd1234", "run-0")
	if err := os.MkdirAll(childDir, 0o755); err != nil {
		t.Fatalf("create child dir: %v", err)
	}
	if err := os.WriteFile(filepath.Join(workspace, ".pi", "settings.json"), []byte(`{"sessionDir":".pi/sessions"}`), 0o600); err != nil {
		t.Fatalf("write settings: %v", err)
	}
	child := []byte(`{"type":"session","id":"child"}` + "\n" + `{"type":"session_info","name":"subagent-reviewer-abcd1234-1"}` + "\n")
	if err := os.WriteFile(filepath.Join(childDir, "session.jsonl"), child, 0o600); err != nil {
		t.Fatalf("write child session: %v", err)
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

	result := loadValidatedWorkspaceCacheForTest(t)
	sessions := result["workspaces"].([]any)[0].(map[string]any)["sessions"].([]any)
	var childSession map[string]any
	for _, item := range sessions {
		session := item.(map[string]any)
		if session["id"] == "child" {
			childSession = session
		}
	}
	if childSession == nil {
		t.Fatalf("sessions = %v, want child", sessions)
	}
	if childSession["parentId"] != parentID || childSession["kind"] != "subagent" || childSession["name"] != "subagent-reviewer-abcd1234-1" {
		t.Fatalf("childSession = %v, want decorated subagent child", childSession)
	}
	if _, ok := childSession["title"]; ok {
		t.Fatalf("childSession = %v, want no legacy title", childSession)
	}
}

func TestLoadWorkspaceCacheDecoratesTeamAgentSessions(t *testing.T) {
	home := t.TempDir()
	workspace := filepath.Join(home, "workspace")
	if err := os.MkdirAll(filepath.Join(workspace, ".pi", "sessions"), 0o755); err != nil {
		t.Fatalf("create project sessions: %v", err)
	}
	if err := os.WriteFile(filepath.Join(workspace, ".pi", "settings.json"), []byte(`{"sessionDir":".pi/sessions"}`), 0o600); err != nil {
		t.Fatalf("write settings: %v", err)
	}

	teamID := "019-team"
	teamsRoot := filepath.Join(home, ".pi", "agent", "custom-teams")
	teamDir := filepath.Join(teamsRoot, teamID)
	teamSessionPath := filepath.Join(teamDir, "sessions", "worker.jsonl")
	if err := os.MkdirAll(filepath.Dir(teamSessionPath), 0o755); err != nil {
		t.Fatalf("create team session dir: %v", err)
	}
	teamSession := []byte(`{"type":"session","id":"team-child"}` + "\n")
	if err := os.WriteFile(teamSessionPath, teamSession, 0o600); err != nil {
		t.Fatalf("write team session: %v", err)
	}
	config := map[string]any{
		"members": []any{
			map[string]any{"name": "team-lead", "role": "lead"},
			map[string]any{
				"name":        "Emilia",
				"role":        "worker",
				"cwd":         workspace,
				"sessionFile": teamSessionPath,
				"meta":        map[string]any{"sessionName": "pi agent teams - teammate Emilia"},
			},
		},
	}
	configData, err := json.Marshal(config)
	if err != nil {
		t.Fatalf("marshal config: %v", err)
	}
	if err := os.WriteFile(filepath.Join(teamDir, "config.json"), configData, 0o600); err != nil {
		t.Fatalf("write team config: %v", err)
	}
	if err := os.MkdirAll(filepath.Join(teamsRoot, "missing-config"), 0o755); err != nil {
		t.Fatalf("create missing config team: %v", err)
	}
	badConfigDir := filepath.Join(teamsRoot, "bad-config")
	if err := os.MkdirAll(badConfigDir, 0o755); err != nil {
		t.Fatalf("create bad config team: %v", err)
	}
	if err := os.WriteFile(filepath.Join(badConfigDir, "config.json"), []byte(`{"members":`), 0o600); err != nil {
		t.Fatalf("write bad team config: %v", err)
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
	t.Setenv("PI_TEAMS_ROOT_DIR", " custom-teams ")

	result := loadValidatedWorkspaceCacheForTest(t)
	sessions := result["workspaces"].([]any)[0].(map[string]any)["sessions"].([]any)
	var teamSessionRecord map[string]any
	for _, item := range sessions {
		session := item.(map[string]any)
		if session["id"] == "team-child" {
			teamSessionRecord = session
		}
	}
	if teamSessionRecord == nil {
		t.Fatalf("sessions = %v, want team child", sessions)
	}
	if teamSessionRecord["parentId"] != teamID || teamSessionRecord["kind"] != "team agent" {
		t.Fatalf("teamSessionRecord = %v, want decorated team agent child", teamSessionRecord)
	}
	if teamSessionRecord["name"] != "pi agent teams - teammate Emilia" {
		t.Fatalf("teamSessionRecord name = %v, want teammate session name", teamSessionRecord["name"])
	}
}

func TestLoadWorkspaceCacheDoesNotInferKindFromWorkspacePath(t *testing.T) {
	home := t.TempDir()
	workspace := filepath.Join(home, "team-workspace")
	sessionDir := filepath.Join(workspace, ".pi", "sessions")
	if err := os.MkdirAll(sessionDir, 0o755); err != nil {
		t.Fatalf("create project sessions: %v", err)
	}
	if err := os.WriteFile(filepath.Join(workspace, ".pi", "settings.json"), []byte(`{"sessionDir":".pi/sessions"}`), 0o600); err != nil {
		t.Fatalf("write settings: %v", err)
	}
	projectSession := []byte(`{"id":"regular-session","name":"regular chat"}` + "\n")
	if err := os.WriteFile(filepath.Join(sessionDir, "regular.jsonl"), projectSession, 0o600); err != nil {
		t.Fatalf("write project session: %v", err)
	}
	promptSession := []byte(
		`{"id":"prompt-session"}` + "\n" +
			`{"message":{"role":"user","content":"please check whether subagent labels are wrong"}}` + "\n",
	)
	if err := os.WriteFile(filepath.Join(sessionDir, "prompt.jsonl"), promptSession, 0o600); err != nil {
		t.Fatalf("write prompt session: %v", err)
	}

	cacheDir := filepath.Join(home, ".pi-web", "pi-web-sidebar")
	if err := os.MkdirAll(cacheDir, 0o755); err != nil {
		t.Fatalf("create cache dir: %v", err)
	}
	cache := `{"workspaces":[{"id":"w1","path":"` + workspace + `","sessions":[{"id":"prompt-session","kind":"subagent","__sessionInfoName":"subagent cached"}]}]}`
	if err := os.WriteFile(filepath.Join(cacheDir, "workspaces.json"), []byte(cache), 0o600); err != nil {
		t.Fatalf("write cache: %v", err)
	}
	t.Setenv("HOME", home)

	result := loadValidatedWorkspaceCacheForTest(t)
	sessions := result["workspaces"].([]any)[0].(map[string]any)["sessions"].([]any)
	if len(sessions) != 2 {
		t.Fatalf("sessions = %v, want regular sessions", sessions)
	}
	for _, item := range sessions {
		session := item.(map[string]any)
		if _, ok := session["kind"]; ok {
			t.Fatalf("session = %v, want no inferred kind", item)
		}
		if _, ok := session["__sessionInfoName"]; ok {
			t.Fatalf("session = %v, want no internal session info name", item)
		}
	}
}

func TestLoadWorkspaceCacheUsesProjectSessionDirSetting(t *testing.T) {
	home := t.TempDir()
	workspace := filepath.Join(home, "workspace")
	if err := os.MkdirAll(filepath.Join(workspace, ".pi", "sessions"), 0o755); err != nil {
		t.Fatalf("create project sessions: %v", err)
	}
	settings := []byte(`{"sessionDir":".pi/sessions"}`)
	if err := os.WriteFile(filepath.Join(workspace, ".pi", "settings.json"), settings, 0o600); err != nil {
		t.Fatalf("write settings: %v", err)
	}
	projectSession := []byte(`{"id":"project-session","title":"project chat"}` + "\n")
	if err := os.WriteFile(filepath.Join(workspace, ".pi", "sessions", "project.jsonl"), projectSession, 0o600); err != nil {
		t.Fatalf("write project session: %v", err)
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

	result := loadValidatedWorkspaceCacheForTest(t)
	workspaceCache := result["workspaces"].([]any)[0].(map[string]any)
	sessions := workspaceCache["sessions"].([]any)
	if len(sessions) != 1 {
		t.Fatalf("sessions length = %d, want 1", len(sessions))
	}
	if sessions[0].(map[string]any)["id"] != "project-session" {
		t.Fatalf("session id = %v, want project-session", sessions[0].(map[string]any)["id"])
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

	result := loadValidatedWorkspaceCacheForTest(t)
	workspaceCache := result["workspaces"].([]any)[0].(map[string]any)
	sessions := workspaceCache["sessions"].([]any)
	if len(sessions) != 1 {
		t.Fatalf("sessions length = %d, want 1", len(sessions))
	}
	session := sessions[0].(map[string]any)
	if session["id"] != "external" || session["name"] != "external chat" || session["parentId"] != "parent" {
		t.Fatalf("session = %v, want external metadata", session)
	}
	if _, ok := session["title"]; ok {
		t.Fatalf("session = %v, want no legacy title", session)
	}
	if workspaceCache["sessionCount"] != 1 {
		t.Fatalf("sessionCount = %v, want 1", workspaceCache["sessionCount"])
	}
}

func TestLoadWorkspaceCacheNamesUncachedSessionFromFirstChat(t *testing.T) {
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
	uncachedSession := []byte(
		`{"id":"uncached"}` + "\n" +
			`{"type":"message","message":{"role":"user","content":[{"type":"text","text":"첫 채팅 제목"}]}}` + "\n",
	)
	if err := os.WriteFile(filepath.Join(sessionDir, "uncached.jsonl"), uncachedSession, 0o600); err != nil {
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

	result := loadValidatedWorkspaceCacheForTest(t)
	sessions := result["workspaces"].([]any)[0].(map[string]any)["sessions"].([]any)
	session := sessions[0].(map[string]any)
	if session["name"] != "첫 채팅 제목" {
		t.Fatalf("session = %v, want first chat name", session)
	}
	if _, ok := session["title"]; ok {
		t.Fatalf("session = %v, want no legacy title", session)
	}
}

func TestLoadWorkspaceCacheUpdatesCachedSessionMissingName(t *testing.T) {
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
	sessionData := []byte(
		`{"id":"cached"}` + "\n" +
			`{"type":"message","message":{"role":"user","content":"캐시 보정"}}` + "\n",
	)
	if err := os.WriteFile(filepath.Join(sessionDir, "cached.jsonl"), sessionData, 0o600); err != nil {
		t.Fatalf("write session file: %v", err)
	}

	cacheDir := filepath.Join(home, ".pi-web", "pi-web-sidebar")
	if err := os.MkdirAll(cacheDir, 0o755); err != nil {
		t.Fatalf("create cache dir: %v", err)
	}
	cache := `{"workspaces":[{"id":"w1","path":"` + workspace + `","sessions":[{"id":"cached","active":true}]}]}`
	if err := os.WriteFile(filepath.Join(cacheDir, "workspaces.json"), []byte(cache), 0o600); err != nil {
		t.Fatalf("write cache: %v", err)
	}
	t.Setenv("HOME", home)
	t.Setenv("PI_CODING_AGENT_SESSION_DIR", sessionRoot)

	result := loadValidatedWorkspaceCacheForTest(t)
	session := result["workspaces"].([]any)[0].(map[string]any)["sessions"].([]any)[0].(map[string]any)
	if session["name"] != "캐시 보정" || session["active"] != true {
		t.Fatalf("session = %v, want cached session updated with disk name", session)
	}
	if _, ok := session["title"]; ok {
		t.Fatalf("session = %v, want no legacy title", session)
	}
	if _, err := saveWorkspaceCache(result); err != nil {
		t.Fatalf("saveWorkspaceCache error = %v", err)
	}

	data, err := os.ReadFile(filepath.Join(cacheDir, "workspaces.json"))
	if err != nil {
		t.Fatalf("read cache: %v", err)
	}
	text := string(data)
	if !strings.Contains(text, `"name": "캐시 보정"`) || strings.Contains(text, `"title"`) {
		t.Fatalf("cache = %s, want updated name without title", text)
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

	result := loadValidatedWorkspaceCacheForTest(t)
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

func TestDeleteSessionsRemovesChildSessionFiles(t *testing.T) {
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
	parentFile := filepath.Join(sessionDir, "parent.jsonl")
	childFile := filepath.Join(sessionDir, "child.jsonl")
	grandchildFile := filepath.Join(sessionDir, "grandchild.jsonl")
	keepFile := filepath.Join(sessionDir, "keep.jsonl")
	if err := os.WriteFile(parentFile, []byte(`{"id":"parent"}`+"\n"), 0o600); err != nil {
		t.Fatalf("write parent file: %v", err)
	}
	if err := os.WriteFile(childFile, []byte(`{"id":"child","parentId":"parent"}`+"\n"), 0o600); err != nil {
		t.Fatalf("write child file: %v", err)
	}
	if err := os.WriteFile(grandchildFile, []byte(`{"id":"grandchild","parentId":"child"}`+"\n"), 0o600); err != nil {
		t.Fatalf("write grandchild file: %v", err)
	}
	if err := os.WriteFile(keepFile, []byte(`{"id":"keep"}`+"\n"), 0o600); err != nil {
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

	result, err := deleteSessions("w1", []string{"parent"})
	if err != nil {
		t.Fatalf("deleteSessions error = %v", err)
	}
	deleted := result["deleted"].([]string)
	if len(deleted) != 3 {
		t.Fatalf("deleted = %v, want parent child grandchild", deleted)
	}
	for _, path := range []string{parentFile, childFile, grandchildFile} {
		if _, err := os.Stat(path); !os.IsNotExist(err) {
			t.Fatalf("deleted file still exists or unexpected error for %s: %v", path, err)
		}
	}
	if _, err := os.Stat(keepFile); err != nil {
		t.Fatalf("keep file missing: %v", err)
	}
}

func TestDeleteSessionsRemovesDiscoveredNestedChildSessionFiles(t *testing.T) {
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
	parentDir := filepath.Join(sessionDir, "2026-06-08_parent")
	childDir := filepath.Join(parentDir, "abcd1234", "run-0")
	if err := os.MkdirAll(childDir, 0o700); err != nil {
		t.Fatalf("create child dir: %v", err)
	}
	childFile := filepath.Join(childDir, "session.jsonl")
	keepFile := filepath.Join(sessionDir, "keep.jsonl")
	if err := os.WriteFile(childFile, []byte(`{"id":"child"}`+"\n"), 0o600); err != nil {
		t.Fatalf("write child file: %v", err)
	}
	if err := os.WriteFile(keepFile, []byte(`{"id":"keep"}`+"\n"), 0o600); err != nil {
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

	result, err := deleteSessions("w1", []string{"parent"})
	if err != nil {
		t.Fatalf("deleteSessions error = %v", err)
	}
	deleted := result["deleted"].([]string)
	if len(deleted) != 2 || deleted[0] != "child" || deleted[1] != "parent" {
		t.Fatalf("deleted = %v, want child parent", deleted)
	}
	if _, err := os.Stat(parentDir); !os.IsNotExist(err) {
		t.Fatalf("parent dir still exists or unexpected error: %v", err)
	}
	if _, err := os.Stat(keepFile); err != nil {
		t.Fatalf("keep file missing: %v", err)
	}
}

func TestDeleteWorkspaceSessionsWithListRemovesOnlyListedSessionsAndChildren(t *testing.T) {
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
	parentFile := filepath.Join(sessionDir, "parent.jsonl")
	childFile := filepath.Join(sessionDir, "child.jsonl")
	keepFile := filepath.Join(sessionDir, "keep.jsonl")
	if err := os.WriteFile(parentFile, []byte(`{"id":"parent"}`+"\n"), 0o600); err != nil {
		t.Fatalf("write parent file: %v", err)
	}
	if err := os.WriteFile(childFile, []byte(`{"id":"child","parentId":"parent"}`+"\n"), 0o600); err != nil {
		t.Fatalf("write child file: %v", err)
	}
	if err := os.WriteFile(keepFile, []byte(`{"id":"keep"}`+"\n"), 0o600); err != nil {
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

	result, err := deleteWorkspaceSessions("w1", []string{"parent"})
	if err != nil {
		t.Fatalf("deleteWorkspaceSessions error = %v", err)
	}
	deleted := result["deleted"].([]string)
	if len(deleted) != 2 {
		t.Fatalf("deleted = %v, want parent child", deleted)
	}
	for _, path := range []string{parentFile, childFile} {
		if _, err := os.Stat(path); !os.IsNotExist(err) {
			t.Fatalf("deleted file still exists or unexpected error for %s: %v", path, err)
		}
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

	result, err := deleteWorkspaceSessions("w1", nil)
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

	if _, err := deleteWorkspaceSessions("missing", nil); err == nil {
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
