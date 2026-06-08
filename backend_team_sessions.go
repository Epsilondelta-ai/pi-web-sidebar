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
			if sessionFile == "" {
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
