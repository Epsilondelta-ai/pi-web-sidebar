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
	case "create-session":
		result, err = createSession(stringInput(data, "workspaceId"))
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
