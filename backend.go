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
	case "delete-workspace-sessions":
		result, err = deleteWorkspaceSessions(stringInput(data, "workspaceId"))
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
		sessions, ok := workspace["sessions"].([]any)
		if workspacePath == "" || !ok || len(sessions) == 0 {
			validated = append(validated, workspace)
			continue
		}

		validSessionIDs := sessionIDsForWorkspacePath(workspacePath)
		if validSessionIDs == nil {
			validated = append(validated, workspace)
			continue
		}

		filteredSessions := make([]any, 0, len(sessions))
		for _, sessionItem := range sessions {
			session, ok := sessionItem.(map[string]any)
			if !ok {
				continue
			}
			if validSessionIDs[stringFromAny(session["id"])] {
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

func sessionIDsForWorkspacePath(workspacePath string) map[string]bool {
	cleanWorkspacePath, err := cleanPath(workspacePath)
	if err != nil {
		return nil
	}

	sessionDir := piSessionDirForCWD(cleanWorkspacePath)
	if sessionDir == "" {
		return nil
	}

	ids := map[string]bool{}
	if err := filepath.WalkDir(sessionDir, func(path string, entry os.DirEntry, err error) error {
		if err != nil || entry.IsDir() || filepath.Ext(path) != ".jsonl" {
			return nil
		}

		id := sessionIDFromFile(path)
		if id != "" {
			ids[id] = true
		}
		return nil
	}); err != nil {
		if errors.Is(err, os.ErrNotExist) {
			return ids
		}
		return nil
	}
	return ids
}

func sessionIDFromFile(path string) string {
	file, err := os.Open(path)
	if err != nil {
		return ""
	}
	defer file.Close()

	decoder := json.NewDecoder(file)
	var header map[string]any
	if err := decoder.Decode(&header); err != nil {
		return ""
	}
	return stringFromAny(header["id"])
}

func workspaceHasLiveSession(sessions []any) bool {
	for _, sessionItem := range sessions {
		session, ok := sessionItem.(map[string]any)
		if ok && (session["live"] == true || session["active"] == true) {
			return true
		}
	}
	return false
}

func saveWorkspaceCache(data request) (request, error) {
	path, err := workspaceCacheFile()
	if err != nil {
		return request{}, err
	}
	if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
		return request{}, err
	}

	payload := request{"workspaces": data["workspaces"]}
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

	deleteSet := map[string]bool{}
	for _, sessionID := range sessionIDs {
		deleteSet[sessionID] = true
	}

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
		return request{}, err
	}

	return request{"deleted": deleted, "workspaceId": workspaceID}, nil
}

func deleteWorkspaceSessions(workspaceID string) (request, error) {
	workspacePath, err := workspacePathFromCache(workspaceID)
	if err != nil {
		return request{}, err
	}

	sessionDir := piSessionDirForCWD(workspacePath)
	if sessionDir == "" {
		return request{}, errors.New("session dir is empty")
	}
	if err := os.RemoveAll(sessionDir); err != nil {
		return request{}, err
	}

	return request{"deleted": true, "path": sessionDir, "workspaceId": workspaceID}, nil
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
	root := defaultPiSessionDir()
	if root == "" {
		return ""
	}

	safePath := "--" + strings.NewReplacer("/", "-", "\\", "-", ":", "-").Replace(strings.TrimLeft(cwd, "/\\")) + "--"
	return filepath.Join(root, safePath)
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
