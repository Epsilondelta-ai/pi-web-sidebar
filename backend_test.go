package main

import "testing"

func TestRequestDataAcceptsNestedBackendEnvelope(t *testing.T) {
	input := request{"data": map[string]any{"path": "/workspace"}}
	data := requestData(input)

	if got := stringInput(data, "path"); got != "/workspace" {
		t.Fatalf("path = %q, want /workspace", got)
	}
}

func TestRequestDataAcceptsTopLevelInput(t *testing.T) {
	input := request{"path": "/workspace"}
	data := requestData(input)

	if got := stringInput(data, "path"); got != "/workspace" {
		t.Fatalf("path = %q, want /workspace", got)
	}
}

func TestRepoNameFromURL(t *testing.T) {
	if got := repoNameFromURL("https://example.com/team/repo.git"); got != "repo" {
		t.Fatalf("repoNameFromURL = %q, want repo", got)
	}
}
