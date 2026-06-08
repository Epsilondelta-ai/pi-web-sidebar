package main

import (
	"encoding/json"
	"os"
	"path/filepath"
	"strings"
)

func teamSessionRecords(workspacePath string) map[string]map[string]any {
	sessions := map[string]map[string]any{}
	teamsDir := defaultPiTeamsDir()
	entries, err := os.ReadDir(teamsDir)
	if err != nil {
		return sessions
	}

	for _, entry := range entries {
		if !entry.IsDir() {
			continue
		}

		teamID := entry.Name()
		configPath := filepath.Join(teamsDir, teamID, "config.json")
		for _, member := range teamMembersForWorkspace(configPath, workspacePath) {
			sessionFile := strings.TrimSpace(stringFromAny(member["sessionFile"]))
			if sessionFile == "" || !regularFileExists(sessionFile) {
				continue
			}

			session := sessionRecordFromFile(sessionFile)
			id := stringFromAny(session["id"])
			if id == "" {
				continue
			}

			if strings.TrimSpace(sessionName(session)) == "" {
				session["name"] = teamMemberSessionName(member)
			}
			session["parentId"] = teamID
			session["kind"] = "team agent"
			delete(session, "__sessionInfoName")
			sessions[id] = session
		}
	}
	return sessions
}

func teamMembersForWorkspace(configPath string, workspacePath string) []map[string]any {
	data, err := os.ReadFile(configPath)
	if err != nil {
		return nil
	}

	var config map[string]any
	if err := json.Unmarshal(data, &config); err != nil {
		return nil
	}

	items, ok := config["members"].([]any)
	if !ok {
		return nil
	}

	members := []map[string]any{}
	for _, item := range items {
		member, ok := item.(map[string]any)
		if !ok || stringFromAny(member["role"]) != "worker" {
			continue
		}

		memberCWD, err := cleanPath(stringFromAny(member["cwd"]))
		if err != nil || memberCWD != workspacePath {
			continue
		}
		members = append(members, member)
	}
	return members
}

func teamMemberSessionName(member map[string]any) string {
	meta, _ := member["meta"].(map[string]any)
	if name := strings.TrimSpace(stringFromAny(meta["sessionName"])); name != "" {
		return name
	}
	if name := strings.TrimSpace(stringFromAny(member["name"])); name != "" {
		return name
	}
	return "team agent"
}

func removeTeamSessionsForWorkspace(workspacePath string, deleteSet map[string]bool, deleteAll bool) ([]string, error) {
	deletedSet := map[string]bool{}
	teamsDir := defaultPiTeamsDir()
	entries, err := os.ReadDir(teamsDir)
	if err != nil {
		return nil, nil
	}

	for _, entry := range entries {
		if !entry.IsDir() {
			continue
		}

		configPath := filepath.Join(teamsDir, entry.Name(), "config.json")
		deleted, err := removeTeamSessionsFromConfig(configPath, workspacePath, deleteSet, deleteAll)
		if err != nil {
			return nil, err
		}
		for _, id := range deleted {
			deletedSet[id] = true
		}
	}
	return sortedDeletedSessionIDs(deletedSet), nil
}

func removeTeamSessionsFromConfig(configPath string, workspacePath string, deleteSet map[string]bool, deleteAll bool) ([]string, error) {
	data, err := os.ReadFile(configPath)
	if err != nil {
		return nil, nil
	}

	var config map[string]any
	if err := json.Unmarshal(data, &config); err != nil {
		return nil, nil
	}

	items, ok := config["members"].([]any)
	if !ok {
		return nil, nil
	}

	changed := false
	deletedSet := map[string]bool{}
	remaining := make([]any, 0, len(items))
	for _, item := range items {
		member, ok := item.(map[string]any)
		if !ok || stringFromAny(member["role"]) != "worker" || !teamMemberMatchesWorkspace(member, workspacePath) {
			remaining = append(remaining, item)
			continue
		}

		sessionFile := strings.TrimSpace(stringFromAny(member["sessionFile"]))
		sessionID := ""
		if sessionFile != "" && regularFileExists(sessionFile) {
			sessionID = sessionIDFromFile(sessionFile)
		}

		shouldDelete := deleteAll || (sessionID != "" && deleteSet[sessionID])
		if !shouldDelete {
			remaining = append(remaining, item)
			continue
		}

		changed = true
		if sessionID != "" {
			deletedSet[sessionID] = true
		}
		if sessionFile != "" && regularFileExists(sessionFile) {
			if err := os.Remove(sessionFile); err != nil {
				return nil, err
			}
		}
	}

	if changed {
		config["members"] = remaining
		encoded, err := json.MarshalIndent(config, "", "  ")
		if err != nil {
			return nil, err
		}
		encoded = append(encoded, '\n')
		if err := os.WriteFile(configPath, encoded, 0o600); err != nil {
			return nil, err
		}
	}
	return sortedDeletedSessionIDs(deletedSet), nil
}

func teamMemberMatchesWorkspace(member map[string]any, workspacePath string) bool {
	memberCWD, err := cleanPath(stringFromAny(member["cwd"]))
	return err == nil && memberCWD == workspacePath
}

func regularFileExists(path string) bool {
	info, err := os.Stat(path)
	return err == nil && !info.IsDir()
}
