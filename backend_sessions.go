package main

import (
	"encoding/base64"
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
	tail := latestSessionTailState(path)
	if tail.liveKnown {
		if tail.live {
			header["live"] = true
			header["status"] = "streaming"
		} else {
			delete(header, "live")
			header["status"] = "idle"
		}
	}
	mergeSessionName(header, firstChatName)
	if tail.renameName != "" {
		header["name"] = tail.renameName
	}
	if metadataName := sessionRenameMetadataName(filepath.Dir(path), stringFromAny(header["id"])); metadataName != "" {
		header["name"] = metadataName
	}
	normalizeSessionRecord(header)
	return header
}

func mergeCachedSessionRecord(cached map[string]any, valid map[string]any, preserveSessionState bool) map[string]any {
	if validName := sessionName(valid); validName != "" {
		cached["name"] = validName
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
	if !preserveSessionState {
		delete(cached, "live")
		delete(cached, "status")
	}
	if status := strings.TrimSpace(stringFromAny(valid["status"])); status != "" {
		cached["status"] = status
		if inactiveStatus(strings.ToLower(status)) || completedStatus(strings.ToLower(status)) {
			delete(cached, "live")
		}
	}
	if valid["live"] == true {
		cached["live"] = true
	}
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
	currentName := strings.TrimSpace(stringFromAny(session["name"]))
	if name != "" && (currentName == "" || sessionNameIsPlaceholder(currentName)) {
		session["name"] = name
	}
}

func sessionNameIsPlaceholder(name string) bool {
	return strings.EqualFold(strings.TrimSpace(name), "New chat")
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

func writeSessionRenameMetadata(sessionDir, sessionID, name string) error {
	path := sessionRenameMetadataPath(sessionDir, sessionID)
	if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
		return err
	}

	payload, err := json.Marshal(request{"name": name})
	if err != nil {
		return err
	}
	tempPath := path + ".tmp"
	if err := os.WriteFile(tempPath, append(payload, '\n'), 0o600); err != nil {
		return err
	}
	return os.Rename(tempPath, path)
}

func sessionRenameMetadataName(sessionDir, sessionID string) string {
	if sessionID == "" {
		return ""
	}
	data, err := os.ReadFile(sessionRenameMetadataPath(sessionDir, sessionID))
	if err != nil {
		return ""
	}
	var metadata request
	if err := json.Unmarshal(data, &metadata); err != nil {
		return ""
	}
	return strings.TrimSpace(stringFromAny(metadata["name"]))
}

func sessionRenameMetadataPath(sessionDir, sessionID string) string {
	name := base64.RawURLEncoding.EncodeToString([]byte(sessionID)) + ".json"
	return filepath.Join(sessionDir, ".pi-web-sidebar-renames", name)
}

type sessionTailState struct {
	liveKnown  bool
	live       bool
	renameName string
}

func latestSessionTailState(path string) sessionTailState {
	data, err := readSessionTail(path)
	if err != nil {
		return sessionTailState{}
	}

	state := sessionTailState{}
	lines := strings.Split(strings.TrimSpace(string(data)), "\n")
	for i := len(lines) - 1; i >= 0; i-- {
		line := strings.TrimSpace(lines[i])
		if line == "" || !strings.HasPrefix(line, "{") {
			continue
		}

		var event map[string]any
		if err := json.Unmarshal([]byte(line), &event); err != nil {
			continue
		}
		if state.renameName == "" && event["type"] == "session_rename" {
			state.renameName = strings.TrimSpace(stringFromAny(event["name"]))
		}
		if !state.liveKnown {
			state.liveKnown, state.live = sessionRecordLiveState(event)
		}
		if state.liveKnown && state.renameName != "" {
			return state
		}
	}
	return state
}

func readSessionTail(path string) ([]byte, error) {
	file, err := os.Open(path)
	if err != nil {
		return nil, err
	}
	defer file.Close()

	info, err := file.Stat()
	if err != nil {
		return nil, err
	}

	const maxTailBytes int64 = 64 * 1024
	size := info.Size()
	start := int64(0)
	if size > maxTailBytes {
		start = size - maxTailBytes
	}

	data := make([]byte, size-start)
	_, err = file.ReadAt(data, start)
	if err != nil {
		return nil, err
	}
	if start > 0 {
		if index := strings.IndexByte(string(data), '\n'); index >= 0 && index+1 < len(data) {
			data = data[index+1:]
		}
	}
	return data, nil
}

func sessionRecordLiveState(value any) (bool, bool) {
	item, ok := value.(map[string]any)
	if !ok {
		return false, false
	}

	status := strings.ToLower(strings.TrimSpace(stringFromAny(item["status"])))
	if completedStatus(status) || inactiveStatus(status) || status == "ok" {
		return true, false
	}
	if activeStatus(status) || status == "streaming" {
		return true, true
	}

	role := strings.ToLower(strings.TrimSpace(stringFromAny(item["role"])))
	stopReason := strings.ToLower(strings.TrimSpace(stringFromAny(item["stopReason"])))
	if role == "user" || role == "toolresult" || stopReason == "tooluse" {
		return true, true
	}
	if role == "assistant" && (stopReason == "stop" || stopReason == "error" || stopReason == "aborted" || stopReason == "length") {
		return true, false
	}

	known := false
	live := false
	for _, child := range item {
		switch typedChild := child.(type) {
		case map[string]any:
			if childKnown, childLive := sessionRecordLiveState(typedChild); childKnown {
				known = true
				if !childLive {
					return true, false
				}
				live = true
			}
		case []any:
			for _, listItem := range typedChild {
				if childKnown, childLive := sessionRecordLiveState(listItem); childKnown {
					known = true
					if !childLive {
						return true, false
					}
					live = true
				}
			}
		}
	}
	return known, live
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
	if sidebarSessionID(base) {
		return base
	}

	index := strings.LastIndex(base, "_")
	if index < 0 || index == len(base)-1 {
		return ""
	}
	return base[index+1:]
}

func sidebarSessionID(id string) bool {
	return strings.HasPrefix(id, "sidebar-") && len(id) > len("sidebar-")
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
