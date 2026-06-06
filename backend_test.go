package main

import (
	"os"
	"path/filepath"
	"testing"
)

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

func TestCheckPiStatusUsesDirectPiExecutable(t *testing.T) {
	fakePi := fakeExecutable(t, "pi test")
	t.Setenv("PI_BIN", fakePi)
	status, err := checkPiStatus()
	if err != nil {
		t.Fatalf("checkPiStatus error = %v", err)
	}
	if !status.Available {
		t.Fatalf("status.Available = false, error = %q", status.Error)
	}
	if status.Executable != fakePi {
		t.Fatalf("status.Executable = %q, want %q", status.Executable, fakePi)
	}
	if status.Version != "pi test" {
		t.Fatalf("status.Version = %q, want pi test", status.Version)
	}
	if status.CheckedAt == "" {
		t.Fatal("status.CheckedAt is empty")
	}
}

func TestCheckPiStatusReturnsUnavailableWhenPiMissing(t *testing.T) {
	t.Setenv("PI_BIN", "")
	t.Setenv("PATH", "")
	status, err := checkPiStatus()
	if err != nil {
		t.Fatalf("checkPiStatus error = %v", err)
	}
	if status.Available {
		t.Fatal("status.Available = true, want false")
	}
	if status.Error != "pi executable not found" {
		t.Fatalf("status.Error = %q, want pi executable not found", status.Error)
	}
}

func TestFirstOutputLine(t *testing.T) {
	if got := firstOutputLine([]byte("\npi 1.2.3\nextra")); got != "pi 1.2.3" {
		t.Fatalf("firstOutputLine = %q, want pi 1.2.3", got)
	}
}

func TestResolvePiExecutableHonorsEnv(t *testing.T) {
	t.Setenv("PI_BIN", "/custom/pi")
	executable, err := resolvePiExecutable()
	if err != nil {
		t.Fatalf("resolvePiExecutable error = %v", err)
	}
	if executable != "/custom/pi" {
		t.Fatalf("executable = %q, want /custom/pi", executable)
	}
}

func TestResolvePiExecutableFindsPath(t *testing.T) {
	fakePi := fakeExecutable(t, "pi test")
	t.Setenv("PI_BIN", "")
	t.Setenv("PATH", filepath.Dir(fakePi))
	executable, err := resolvePiExecutable()
	if err != nil {
		t.Fatalf("resolvePiExecutable error = %v", err)
	}
	if executable != fakePi {
		t.Fatalf("executable = %q, want %q", executable, fakePi)
	}
}

func fakeExecutable(t *testing.T, output string) string {
	t.Helper()
	path := filepath.Join(t.TempDir(), "pi")
	content := "#!/bin/sh\necho '" + output + "'\n"
	if err := os.WriteFile(path, []byte(content), 0o755); err != nil {
		t.Fatalf("write fake executable: %v", err)
	}
	return path
}
