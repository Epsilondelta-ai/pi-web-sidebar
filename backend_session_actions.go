package main

import (
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"time"
)

func validateWorkspaces(data request) (request, error) {
	return validateWorkspaceCache(request{
		"preserveSessionState": data["preserveSessionState"],
		"workspaces":           data["workspaces"],
	}), nil
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

func createSession(workspaceID string) (request, error) {
	workspacePath, err := workspacePathFromCache(workspaceID)
	if err != nil {
		return request{}, err
	}

	sessionDir := piSessionDirForCWD(workspacePath)
	if sessionDir == "" {
		return request{}, errors.New("session dir is empty")
	}

	if err := os.MkdirAll(sessionDir, 0o755); err != nil {
		return request{}, err
	}

	sessionID := newSessionID()
	sessionPath := filepath.Join(sessionDir, sessionID+".jsonl")
	header := request{
		"cwd":       workspacePath,
		"id":        sessionID,
		"name":      "New chat",
		"timestamp": time.Now().Format(time.RFC3339Nano),
		"type":      "session",
	}
	payload, err := json.Marshal(header)
	if err != nil {
		return request{}, err
	}

	if err := os.WriteFile(sessionPath, append(payload, '\n'), 0o600); err != nil {
		return request{}, err
	}

	return request{"session": header, "sessionId": sessionID, "path": sessionPath, "workspaceId": workspaceID}, nil
}

func newSessionID() string {
	return fmt.Sprintf("sidebar-%d", time.Now().UnixNano())
}

func renameSession(workspaceID, sessionID, name string) (request, error) {
	workspacePath, err := workspacePathFromCache(workspaceID)
	if err != nil {
		return request{}, err
	}
	cleanName := strings.TrimSpace(name)
	if sessionID == "" || cleanName == "" {
		return request{}, errors.New("session id and name are required")
	}

	sessionDir := piSessionDirForCWD(workspacePath)
	if sessionDir == "" {
		return request{}, errors.New("session dir is empty")
	}

	sessionPath, err := sessionFilePathForID(sessionDir, sessionID)
	if err != nil && !errors.Is(err, os.ErrNotExist) {
		return request{}, err
	}
	if sessionPath == "" {
		sessionPath = teamSessionFileForWorkspace(workspacePath, sessionID)
	}
	if sessionPath == "" {
		return request{}, errors.New("session not found")
	}
	if err := writeSessionRenameMetadata(filepath.Dir(sessionPath), sessionID, cleanName); err != nil {
		return request{}, err
	}

	return request{"session": request{"id": sessionID, "name": cleanName}, "sessionId": sessionID, "workspaceId": workspaceID}, nil
}

func sessionFilePathForID(sessionDir, sessionID string) (string, error) {
	foundPath := ""
	err := filepath.WalkDir(sessionDir, func(path string, entry os.DirEntry, err error) error {
		if err != nil {
			return err
		}
		if entry.IsDir() || filepath.Ext(path) != ".jsonl" || foundPath != "" {
			return nil
		}
		if sessionIDFromFile(path) == sessionID {
			foundPath = path
			return filepath.SkipAll
		}
		return nil
	})
	return foundPath, err
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
	teamDeleted, err := removeTeamSessionsForWorkspace(workspacePath, deleteSet, false)
	if err != nil {
		return request{}, err
	}
	deleted = sortedCombinedDeletedSessionIDs(deleted, teamDeleted)

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
		teamDeleted, err := removeTeamSessionsForWorkspace(workspacePath, deleteSet, false)
		if err != nil {
			return request{}, err
		}
		deleted = sortedCombinedDeletedSessionIDs(deleted, teamDeleted)
		return request{"deleted": deleted, "path": sessionDir, "workspaceId": workspaceID}, nil
	}

	if err := os.RemoveAll(sessionDir); err != nil {
		return request{}, err
	}
	if _, err := removeTeamSessionsForWorkspace(workspacePath, nil, true); err != nil {
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
		return nil
	}); err != nil && !errors.Is(err, os.ErrNotExist) {
		return nil, err
	}

	if err := removeSyntheticSessionDirs(sessionDir, deleteSet); err != nil {
		return nil, err
	}
	if err := removeSessionRenameMetadataFiles(sessionDir, deleteSet); err != nil {
		return nil, err
	}

	return sortedDeletedSessionIDs(deleteSet), nil
}

func removeSyntheticSessionDirs(sessionDir string, deleteSet map[string]bool) error {
	entries, err := os.ReadDir(sessionDir)
	if errors.Is(err, os.ErrNotExist) {
		return nil
	}
	if err != nil {
		return err
	}

	for _, entry := range entries {
		if !entry.IsDir() {
			continue
		}

		id := sessionIDFromSessionFileName(entry.Name())
		if id == "" || !deleteSet[id] {
			continue
		}
		if err := os.RemoveAll(filepath.Join(sessionDir, entry.Name())); err != nil {
			return err
		}
	}
	return nil
}

func removeSessionRenameMetadataFiles(sessionDir string, deleteSet map[string]bool) error {
	for sessionID := range deleteSet {
		if err := os.Remove(sessionRenameMetadataPath(sessionDir, sessionID)); err != nil && !errors.Is(err, os.ErrNotExist) {
			return err
		}
	}
	return nil
}

func sortedDeletedSessionIDs(deleteSet map[string]bool) []string {
	ids := make([]string, 0, len(deleteSet))
	for id := range deleteSet {
		ids = append(ids, id)
	}
	sort.Strings(ids)
	return ids
}

func sortedCombinedDeletedSessionIDs(left []string, right []string) []string {
	deleteSet := map[string]bool{}
	for _, id := range left {
		deleteSet[id] = true
	}
	for _, id := range right {
		deleteSet[id] = true
	}
	return sortedDeletedSessionIDs(deleteSet)
}

func sessionRecordsForSessionDir(sessionDir string) []map[string]any {
	sessions := []map[string]any{}
	if err := filepath.WalkDir(sessionDir, func(path string, entry os.DirEntry, err error) error {
		if err != nil || entry.IsDir() || filepath.Ext(path) != ".jsonl" {
			return nil
		}

		session := sessionRecordFromFile(path)
		decorateSessionRecord(session, path, sessionDir)
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
	return status == "active" || status == "live" || status == "pending" || status == "running" || status == "streaming" || status == "thinking"
}

func inactiveStatus(status string) bool {
	return status == "idle" || status == "inactive" || status == "waiting"
}
