package main

import (
	"encoding/json"
	"errors"
	"os"
	"path/filepath"
	"sort"
	"strings"
)

func sessionRecordsForWorkspacePath(workspacePath string) map[string]map[string]any {
	cleanWorkspacePath, err := cleanPath(workspacePath)
	if err != nil {
		return nil
	}

	sessions := map[string]map[string]any{}
	sessionDir := piSessionDirForCWD(cleanWorkspacePath)
	if sessionDir != "" {
		for id, session := range projectSessionRecords(sessionDir) {
			sessions[id] = session
		}
	}
	for id, session := range teamSessionRecords(cleanWorkspacePath) {
		sessions[id] = session
	}
	return sessions
}

func projectSessionRecords(sessionDir string) map[string]map[string]any {
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
		return map[string]map[string]any{}
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
			sessions[id] = map[string]any{"id": id, "name": id}
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

	firstChatName := ""
	for i := 0; i < 12; i++ {
		var event map[string]any
		if err := decoder.Decode(&event); err != nil {
			break
		}
		if event["type"] == "session_info" {
			mergeSessionInfo(header, event)
		}
		if firstChatName == "" {
			firstChatName = firstUserChatText(event)
		}
	}
	mergeSessionName(header, firstChatName)
	normalizeSessionRecord(header)
	return header
}

func mergeCachedSessionRecord(cached map[string]any, valid map[string]any) map[string]any {
	if strings.TrimSpace(stringFromAny(cached["name"])) == "" {
		cached["name"] = sessionName(valid)
	}
	if kind := strings.TrimSpace(stringFromAny(valid["kind"])); kind != "" {
		cached["kind"] = kind
	} else {
		delete(cached, "kind")
	}
	if parentID := strings.TrimSpace(stringFromAny(valid["parentId"])); parentID != "" {
		cached["parentId"] = parentID
	} else {
		delete(cached, "parentId")
	}
	delete(cached, "__sessionInfoName")
	delete(cached, "live")
	delete(cached, "status")
	normalizeSessionRecord(cached)
	return cached
}

func mergeSessionInfo(session map[string]any, info map[string]any) {
	name := strings.TrimSpace(stringFromAny(info["name"]))
	if name != "" {
		session["__sessionInfoName"] = name
	}
	mergeSessionName(session, name)
}

func mergeSessionName(session map[string]any, name string) {
	if name != "" && strings.TrimSpace(stringFromAny(session["name"])) == "" {
		session["name"] = name
	}
}

func normalizeSessionRecord(session map[string]any) {
	mergeSessionName(session, sessionName(session))
	delete(session, "title")
}

func sessionName(session map[string]any) string {
	if name := strings.TrimSpace(stringFromAny(session["name"])); name != "" {
		return name
	}
	return strings.TrimSpace(stringFromAny(session["title"]))
}

func firstUserChatText(event map[string]any) string {
	message, ok := event["message"].(map[string]any)
	if !ok || stringFromAny(message["role"]) != "user" {
		return ""
	}
	return firstTextContent(message["content"])
}

func firstTextContent(content any) string {
	if text := strings.TrimSpace(stringFromAny(content)); text != "" {
		return text
	}

	items, ok := content.([]any)
	if !ok {
		return ""
	}

	for _, item := range items {
		part, ok := item.(map[string]any)
		if !ok || stringFromAny(part["type"]) != "text" {
			continue
		}

		if text := strings.TrimSpace(stringFromAny(part["text"])); text != "" {
			return text
		}
	}
	return ""
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
	delete(session, "__sessionInfoName")
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
		stringFromAny(session["kind"]),
		stringFromAny(session["__sessionInfoName"]),
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
		if session["unreadCompleted"] == true || completedStatus(status) || inactiveStatus(status) {
			continue
		}
		if session["live"] == true || activeStatus(status) {
			return true
		}
	}
	return false
}
