package main

import (
	"encoding/json"
	"errors"
	"os"
	"strings"
)

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

	return result, nil
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
			validSession := validSessions[sessionID]
			if validSession == nil {
				continue
			}

			filteredSessions = append(filteredSessions, mergeCachedSessionRecord(session, validSession))
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
