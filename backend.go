package main

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"os"
	"os/exec"
	"path/filepath"
	"sort"
	"strings"
	"time"
)

const gitCloneTimeout = 5 * time.Minute
const piStatusTimeout = 5 * time.Second
const workspaceCachePath = ".pi-web/pi-web-sidebar/workspaces.json"

type request map[string]any

type folderListing struct {
	Path        string       `json:"path"`
	DisplayPath string       `json:"displayPath"`
	Parent      string       `json:"parent"`
	Folders     []folderInfo `json:"folders"`
}

type folderInfo struct {
	Name        string `json:"name"`
	Path        string `json:"path"`
	DisplayPath string `json:"displayPath"`
}

type piStatus struct {
	Available  bool   `json:"available"`
	CheckedAt  string `json:"checkedAt"`
	Executable string `json:"executable,omitempty"`
	Version    string `json:"version,omitempty"`
	Error      string `json:"error,omitempty"`
}

func main() {
	method := arg(1)
	input, err := readInput(os.Stdin)
	if err != nil {
		fail(err)
	}

	data := requestData(input)

	var result any
	switch method {
	case "list-folders":
		result, err = listFolders(stringInput(data, "path"))
	case "create-folder":
		result, err = createFolder(stringInput(data, "parent"), stringInput(data, "name"))
	case "clone-workspace":
		result, err = cloneWorkspace(stringInput(data, "parent"), stringInput(data, "gitUrl"), stringInput(data, "name"))
	case "load-workspace-cache":
		result, err = loadWorkspaceCache()
	case "save-workspace-cache":
		result, err = saveWorkspaceCache(data)
	case "validate-workspaces":
		result, err = validateWorkspaces(data)
	case "delete-workspace-sessions":
		result, err = deleteWorkspaceSessions(stringInput(data, "workspaceId"), stringListInput(data, "sessionIds"))
	case "delete-sessions":
		result, err = deleteSessions(stringInput(data, "workspaceId"), stringListInput(data, "sessionIds"))
	case "pi-status":
		result, err = checkPiStatus()
	default:
		err = fmt.Errorf("unknown method: %s", method)
	}
	if err != nil {
		fail(err)
	}

	if err := json.NewEncoder(os.Stdout).Encode(result); err != nil {
		fail(err)
	}
}

func arg(index int) string {
	if len(os.Args) <= index {
		return ""
	}
	return os.Args[index]
}

func readInput(reader io.Reader) (request, error) {
	data, err := io.ReadAll(reader)
	if err != nil {
		return nil, err
	}
	if len(bytes.TrimSpace(data)) == 0 {
		return request{}, nil
	}
	var input request
	return input, json.Unmarshal(data, &input)
}

func requestData(input request) request {
	data, ok := input["data"].(map[string]any)
	if !ok {
		return input
	}
	return request(data)
}

func stringInput(input request, key string) string {
	value, _ := input[key].(string)
	return value
}

func stringListInput(input request, key string) []string {
	items, _ := input[key].([]any)
	values := make([]string, 0, len(items))
	for _, item := range items {
		value, _ := item.(string)
		if strings.TrimSpace(value) != "" {
			values = append(values, value)
		}
	}
	return values
}

func listFolders(path string) (folderListing, error) {
	root, err := cleanPath(path)
	if err != nil {
		return folderListing{}, err
	}
	entries, err := os.ReadDir(root)
	if err != nil {
		return folderListing{}, err
	}

	folders := make([]folderInfo, 0, len(entries))
	for _, entry := range entries {
		if !entry.IsDir() || shouldHide(entry.Name()) {
			continue
		}
		abs := filepath.Join(root, entry.Name())
		folders = append(folders, folderInfo{Name: entry.Name(), Path: abs, DisplayPath: displayPath(abs)})
	}
	sort.Slice(folders, func(i, j int) bool {
		return strings.ToLower(folders[i].Name) < strings.ToLower(folders[j].Name)
	})

	return folderListing{Path: root, DisplayPath: displayPath(root), Parent: parentPath(root), Folders: folders}, nil
}

func createFolder(parent, name string) (folderInfo, error) {
	root, err := cleanPath(parent)
	if err != nil {
		return folderInfo{}, err
	}
	cleanName := strings.TrimSpace(name)
	if cleanName == "" || cleanName == "." || cleanName == ".." || strings.ContainsAny(cleanName, `/\\`) {
		return folderInfo{}, errors.New("invalid folder name")
	}
	path := filepath.Join(root, cleanName)
	if err := os.Mkdir(path, 0o755); err != nil {
		return folderInfo{}, err
	}
	return folderInfo{Name: cleanName, Path: path, DisplayPath: displayPath(path)}, nil
}

func cloneWorkspace(parent, gitURL, name string) (folderInfo, error) {
	root, err := cleanPath(parent)
	if err != nil {
		return folderInfo{}, err
	}
	url := strings.TrimSpace(gitURL)
	if url == "" {
		return folderInfo{}, errors.New("git url is required")
	}
	args := []string{"clone", "--", url}
	cleanName := strings.TrimSpace(name)
	if cleanName != "" {
		if cleanName == "." || cleanName == ".." || strings.ContainsAny(cleanName, `/\\`) {
			return folderInfo{}, errors.New("invalid folder name")
		}
		args = append(args, cleanName)
	}
	ctx, cancel := context.WithTimeout(context.Background(), gitCloneTimeout)
	defer cancel()

	cmd := exec.CommandContext(ctx, "git", args...)
	cmd.Dir = root
	output, err := cmd.CombinedOutput()
	if err != nil {
		if errors.Is(ctx.Err(), context.DeadlineExceeded) {
			return folderInfo{}, fmt.Errorf("git clone timed out after %s", gitCloneTimeout)
		}

		message := strings.TrimSpace(string(output))
		if message == "" {
			message = err.Error()
		}
		return folderInfo{}, errors.New(message)
	}

	createdName := cleanName
	if createdName == "" {
		createdName = repoNameFromURL(url)
	}
	path := filepath.Join(root, createdName)
	if _, err := os.Stat(path); err != nil {
		return folderInfo{}, err
	}
	return folderInfo{Name: createdName, Path: path, DisplayPath: displayPath(path)}, nil
}

func checkPiStatus() (piStatus, error) {
	checkedAt := time.Now().UTC().Format(time.RFC3339Nano)
	executable, err := resolvePiExecutable()
	if err != nil {
		return piStatus{Available: false, CheckedAt: checkedAt, Error: err.Error()}, nil
	}

	ctx, cancel := context.WithTimeout(context.Background(), piStatusTimeout)
	defer cancel()

	cmd := exec.CommandContext(ctx, executable, "--version")
	output, err := cmd.CombinedOutput()
	version := firstOutputLine(output)
	if err != nil {
		if errors.Is(ctx.Err(), context.DeadlineExceeded) {
			return piStatus{Available: false, CheckedAt: checkedAt, Executable: executable, Error: "pi --version timed out"}, nil
		}

		message := strings.TrimSpace(string(output))
		if message == "" {
			message = err.Error()
		}
		return piStatus{Available: false, CheckedAt: checkedAt, Executable: executable, Version: version, Error: message}, nil
	}

	return piStatus{Available: true, CheckedAt: checkedAt, Executable: executable, Version: version}, nil
}

func resolvePiExecutable() (string, error) {
	configured := strings.TrimSpace(os.Getenv("PI_BIN"))
	if configured != "" {
		return configured, nil
	}

	executable, err := exec.LookPath("pi")
	if err != nil {
		return "", errors.New("pi executable not found")
	}
	return executable, nil
}

func firstOutputLine(output []byte) string {
	for _, line := range strings.Split(strings.TrimSpace(string(output)), "\n") {
		clean := strings.TrimSpace(line)
		if clean != "" {
			return clean
		}
	}
	return ""
}

func loadWorkspaceCache() (request, error) {
	path, err := workspaceCacheFile()
	if err != nil {
		return request{}, err
	}

	data, err := os.ReadFile(path)
	if errors.Is(err, os.ErrNotExist) {
		return request{"workspaces": []any{}}, nil
	}
	if err != nil {
		return request{}, err
	}

	var result request
	if err := json.Unmarshal(data, &result); err != nil {
		return request{}, err
	}
	return validateWorkspaceCache(result), nil
}

func validateWorkspaceCache(cache request) request {
	workspaces, ok := cache["workspaces"].([]any)
	if !ok {
		return cache
	}

	validated := make([]any, 0, len(workspaces))
	for _, item := range workspaces {
		workspace, ok := item.(map[string]any)
		if !ok {
			validated = append(validated, item)
			continue
		}

		workspacePath := strings.TrimSpace(stringFromAny(workspace["path"]))
		if workspacePath == "" {
			validated = append(validated, workspace)
			continue
		}

		validSessions := sessionRecordsForWorkspacePath(workspacePath)
		if validSessions == nil {
			validated = append(validated, workspace)
			continue
		}

		sessions, _ := workspace["sessions"].([]any)
		filteredSessions := make([]any, 0, len(sessions)+len(validSessions))
		seenIDs := map[string]bool{}
		for _, sessionItem := range sessions {
			session, ok := sessionItem.(map[string]any)
			if !ok {
				continue
			}

			sessionID := stringFromAny(session["id"])
			if validSessions[sessionID] == nil {
				continue
			}

			filteredSessions = append(filteredSessions, session)
			seenIDs[sessionID] = true
		}

		for _, session := range sortedSessionRecords(validSessions) {
			sessionID := stringFromAny(session["id"])
			if !seenIDs[sessionID] {
				filteredSessions = append(filteredSessions, session)
			}
		}

		workspace["sessions"] = filteredSessions
		workspace["sessionCount"] = len(filteredSessions)
		workspace["live"] = workspaceHasLiveSession(filteredSessions)
		validated = append(validated, workspace)
	}

	cache["workspaces"] = validated
	return cache
}

func sessionRecordsForWorkspacePath(workspacePath string) map[string]map[string]any {
	cleanWorkspacePath, err := cleanPath(workspacePath)
	if err != nil {
		return nil
	}

	sessionDir := piSessionDirForCWD(cleanWorkspacePath)
	if sessionDir == "" {
		return nil
	}

	sessions := syntheticParentSessions(sessionDir)
	if err := filepath.WalkDir(sessionDir, func(path string, entry os.DirEntry, err error) error {
		if err != nil || entry.IsDir() || filepath.Ext(path) != ".jsonl" {
			return nil
		}

		session := sessionRecordFromFile(path)
		decorateSessionRecord(session, path, sessionDir)
		id := stringFromAny(session["id"])
		if id != "" {
			sessions[id] = session
		}
		return nil
	}); err != nil {
		if errors.Is(err, os.ErrNotExist) {
			return sessions
		}
		return nil
	}
	return sessions
}

func syntheticParentSessions(sessionDir string) map[string]map[string]any {
	sessions := map[string]map[string]any{}
	entries, err := os.ReadDir(sessionDir)
	if err != nil {
		return sessions
	}

	for _, entry := range entries {
		if !entry.IsDir() {
			continue
		}

		id := sessionIDFromSessionFileName(entry.Name())
		if id != "" {
			sessions[id] = map[string]any{"id": id, "title": id}
		}
	}
	return sessions
}

func sortedSessionRecords(sessions map[string]map[string]any) []map[string]any {
	ids := make([]string, 0, len(sessions))
	for id := range sessions {
		ids = append(ids, id)
	}
	sort.Strings(ids)

	records := make([]map[string]any, 0, len(ids))
	for _, id := range ids {
		records = append(records, sessions[id])
	}
	return records
}

func sessionIDFromFile(path string) string {
	return stringFromAny(sessionRecordFromFile(path)["id"])
}

func sessionRecordFromFile(path string) map[string]any {
	file, err := os.Open(path)
	if err != nil {
		return map[string]any{}
	}
	defer file.Close()

	decoder := json.NewDecoder(file)
	var header map[string]any
	if err := decoder.Decode(&header); err != nil {
		return map[string]any{}
	}

	for i := 0; i < 12; i++ {
		var event map[string]any
		if err := decoder.Decode(&event); err != nil {
			break
		}
		if event["type"] == "session_info" {
			mergeSessionInfo(header, event)
		}
	}
	return header
}

func mergeSessionInfo(session map[string]any, info map[string]any) {
	name := strings.TrimSpace(stringFromAny(info["name"]))
	if name != "" && strings.TrimSpace(stringFromAny(session["title"])) == "" {
		session["title"] = name
	}
	if name != "" && strings.TrimSpace(stringFromAny(session["name"])) == "" {
		session["name"] = name
	}
}

func decorateSessionRecord(session map[string]any, path string, sessionDir string) {
	relativePath, err := filepath.Rel(sessionDir, path)
	if err == nil {
		parts := strings.Split(filepath.ToSlash(relativePath), "/")
		if len(parts) > 1 {
			parentID := sessionIDFromSessionFileName(parts[0])
			if parentID != "" {
				session["parentId"] = parentID
			}
		}
	}

	kind := sessionKind(session, path)
	if kind != "" {
		session["kind"] = kind
	}
}

func sessionIDFromSessionFileName(name string) string {
	base := strings.TrimSuffix(filepath.Base(name), filepath.Ext(name))
	index := strings.LastIndex(base, "_")
	if index < 0 || index == len(base)-1 {
		return ""
	}
	return base[index+1:]
}

func sessionKind(session map[string]any, path string) string {
	text := strings.ToLower(strings.Join([]string{
		path,
		stringFromAny(session["kind"]),
		stringFromAny(session["title"]),
		stringFromAny(session["name"]),
		stringFromAny(session["agent"]),
		stringFromAny(session["agentName"]),
		stringFromAny(session["teammate"]),
		stringFromAny(session["role"]),
		stringFromAny(session["source"]),
	}, " "))
	if strings.Contains(text, "team") || strings.Contains(text, "teammate") {
		return "team agent"
	}
	if strings.Contains(text, "subagent") || strings.Contains(filepath.ToSlash(path), "/run-") {
		return "subagent"
	}
	return ""
}

func workspaceHasLiveSession(sessions []any) bool {
	for _, sessionItem := range sessions {
		session, ok := sessionItem.(map[string]any)
		if !ok {
			continue
		}

		status := strings.ToLower(strings.TrimSpace(stringFromAny(session["status"])))
		if session["unreadCompleted"] == true || completedStatus(status) {
			continue
		}
		if session["live"] == true || activeStatus(status) {
			return true
		}
	}
	return false
}

func validateWorkspaces(data request) (request, error) {
	return validateWorkspaceCache(request{"workspaces": data["workspaces"]}), nil
}

func saveWorkspaceCache(data request) (request, error) {
	path, err := workspaceCacheFile()
	if err != nil {
		return request{}, err
	}
	if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
		return request{}, err
	}

	payload := validateWorkspaceCache(request{"workspaces": data["workspaces"]})
	encoded, err := json.MarshalIndent(payload, "", "  ")
	if err != nil {
		return request{}, err
	}
	encoded = append(encoded, '\n')

	if err := os.WriteFile(path, encoded, 0o600); err != nil {
		return request{}, err
	}
	return request{"path": path}, nil
}

func deleteSessions(workspaceID string, sessionIDs []string) (request, error) {
	workspacePath, err := workspacePathFromCache(workspaceID)
	if err != nil {
		return request{}, err
	}
	if len(sessionIDs) == 0 {
		return request{"deleted": []string{}, "workspaceId": workspaceID}, nil
	}

	sessionDir := piSessionDirForCWD(workspacePath)
	if sessionDir == "" {
		return request{}, errors.New("session dir is empty")
	}

	deleteSet := expandSessionDeleteSet(sessionDir, sessionIDs)
	deleted, err := removeSessionFiles(sessionDir, deleteSet)
	if err != nil {
		return request{}, err
	}

	return request{"deleted": deleted, "workspaceId": workspaceID}, nil
}

func deleteWorkspaceSessions(workspaceID string, sessionIDs []string) (request, error) {
	workspacePath, err := workspacePathFromCache(workspaceID)
	if err != nil {
		return request{}, err
	}

	sessionDir := piSessionDirForCWD(workspacePath)
	if sessionDir == "" {
		return request{}, errors.New("session dir is empty")
	}

	if len(sessionIDs) > 0 {
		deleteSet := expandSessionDeleteSet(sessionDir, sessionIDs)
		deleted, err := removeSessionFiles(sessionDir, deleteSet)
		if err != nil {
			return request{}, err
		}
		return request{"deleted": deleted, "path": sessionDir, "workspaceId": workspaceID}, nil
	}

	if err := os.RemoveAll(sessionDir); err != nil {
		return request{}, err
	}

	return request{"deleted": true, "path": sessionDir, "workspaceId": workspaceID}, nil
}

func expandSessionDeleteSet(sessionDir string, sessionIDs []string) map[string]bool {
	deleteSet := map[string]bool{}
	for _, sessionID := range sessionIDs {
		deleteSet[sessionID] = true
	}

	for {
		added := false
		for _, session := range sessionRecordsForSessionDir(sessionDir) {
			id := stringFromAny(session["id"])
			parentID := stringFromAny(session["parentId"])
			if id == "" || parentID == "" || !deleteSet[parentID] || deleteSet[id] {
				continue
			}
			deleteSet[id] = true
			added = true
		}
		if !added {
			return deleteSet
		}
	}
}

func removeSessionFiles(sessionDir string, deleteSet map[string]bool) ([]string, error) {
	deleted := []string{}
	if err := filepath.WalkDir(sessionDir, func(path string, entry os.DirEntry, err error) error {
		if err != nil || entry.IsDir() || filepath.Ext(path) != ".jsonl" {
			return nil
		}

		id := sessionIDFromFile(path)
		if !deleteSet[id] {
			return nil
		}

		if err := os.Remove(path); err != nil {
			return err
		}
		deleted = append(deleted, id)
		return nil
	}); err != nil && !errors.Is(err, os.ErrNotExist) {
		return nil, err
	}

	return deleted, nil
}

func sessionRecordsForSessionDir(sessionDir string) []map[string]any {
	sessions := []map[string]any{}
	if err := filepath.WalkDir(sessionDir, func(path string, entry os.DirEntry, err error) error {
		if err != nil || entry.IsDir() || filepath.Ext(path) != ".jsonl" {
			return nil
		}

		session := sessionRecordFromFile(path)
		if stringFromAny(session["id"]) != "" {
			sessions = append(sessions, session)
		}
		return nil
	}); err != nil {
		return []map[string]any{}
	}
	return sessions
}

func completedStatus(status string) bool {
	return status == "complete" || status == "completed" || status == "done" || status == "failed" || status == "success"
}

func activeStatus(status string) bool {
	return status == "active" || status == "live" || status == "running" || status == "thinking"
}

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
