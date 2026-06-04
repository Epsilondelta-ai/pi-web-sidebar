package main

import (
	"bytes"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"os"
	"os/exec"
	"path/filepath"
	"sort"
	"strings"
)

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

func main() {
	method := arg(1)
	input, err := readInput(os.Stdin)
	if err != nil {
		fail(err)
	}

	var result any
	switch method {
	case "list-folders":
		result, err = listFolders(stringInput(input, "path"))
	case "create-folder":
		result, err = createFolder(stringInput(input, "parent"), stringInput(input, "name"))
	case "clone-workspace":
		result, err = cloneWorkspace(stringInput(input, "parent"), stringInput(input, "gitUrl"), stringInput(input, "name"))
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

func stringInput(input request, key string) string {
	value, _ := input[key].(string)
	return value
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
	cmd := exec.Command("git", args...)
	cmd.Dir = root
	output, err := cmd.CombinedOutput()
	if err != nil {
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
