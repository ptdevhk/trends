package cmd

import (
	"bytes"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"sync/atomic"
	"testing"
)

func TestWorkspaceBackupCommandWritesSnapshotFile(t *testing.T) {
	setCommandSessionAuthEnvironment(t)
	var loginCalls atomic.Int32
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if handleCommandSessionLogin(t, w, r, &loginCalls) {
			return
		}
		assertCommandSessionRequest(t, r, false)
		if r.Method != http.MethodGet || r.URL.Path != "/api/workspace/export" {
			t.Fatalf("unexpected request %s %s", r.Method, r.URL.Path)
		}
		if got := r.URL.Query().Get("profile"); got != "hr-ops" {
			t.Fatalf("unexpected profile query: %q", got)
		}
		if got := r.Header.Get("X-Workspace-Slug"); got != "dev" {
			t.Fatalf("unexpected workspace header: %q", got)
		}
		_ = json.NewEncoder(w).Encode(map[string]any{
			"success":       true,
			"schemaVersion": 1,
			"profile":       "hr-ops",
			"workspaceSlug": "dev",
			"exportedAt":    1750000000000,
			"tables": map[string]any{
				"candidateStatus": []map[string]any{{"_id": "cs1", "resumeId": "r1", "status": "shortlisted"}},
				"candidateBlocks": []any{},
				"searchProfiles":  []any{},
				"workspaceConfig": []any{},
			},
		})
	}))
	defer server.Close()

	setResumeCLIConfig(t, server.URL, "dev")
	setCLIOutput(t, "json")

	outPath := filepath.Join(t.TempDir(), "snapshots", "workspace-backup.json")
	cmd := newWorkspaceBackupCmd()
	var output bytes.Buffer
	cmd.SetOut(&output)
	cmd.SetErr(&output)
	cmd.SetArgs([]string{"--out", outPath})

	if err := cmd.Execute(); err != nil {
		t.Fatalf("workspace backup command failed: %v", err)
	}

	written, err := os.ReadFile(outPath)
	if err != nil {
		t.Fatalf("failed to read snapshot file: %v", err)
	}
	if !strings.Contains(string(written), `"profile": "hr-ops"`) || !strings.Contains(string(written), `"candidateStatus"`) {
		t.Fatalf("unexpected snapshot file contents: %s", string(written))
	}
	if loginCalls.Load() != 1 {
		t.Fatalf("expected exactly one login, got %d", loginCalls.Load())
	}

	payload := decodeCommandJSON(t, output)
	if payload["profile"] != "hr-ops" || payload["workspace"] != "dev" || payload["file"] != outPath {
		t.Fatalf("unexpected command output: %+v", payload)
	}
}

func TestWorkspaceBackupCommandFullProfileWritesTarGz(t *testing.T) {
	setCommandSessionAuthEnvironment(t)
	var loginCalls atomic.Int32
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if handleCommandSessionLogin(t, w, r, &loginCalls) {
			return
		}
		assertCommandSessionRequest(t, r, false)
		if r.URL.Path != "/api/workspace/export" || r.URL.Query().Get("profile") != "full" {
			t.Fatalf("unexpected export request: %s %s", r.Method, r.URL)
		}
		_ = json.NewEncoder(w).Encode(map[string]any{
			"success":       true,
			"schemaVersion": 1,
			"profile":       "full",
			"workspaceSlug": "dev",
			"exportedAt":    1750000000000,
			"tables": map[string]any{
				"candidateStatus": []any{},
				"candidateBlocks": []any{},
				"searchProfiles":  []map[string]any{{"_id": "sp1", "name": "default"}},
				"workspaceConfig": []map[string]any{{"configKey": "research.hotlist.api", "configValue": "https://example.com"}},
			},
		})
	}))
	defer server.Close()

	setResumeCLIConfig(t, server.URL, "dev")
	setCLIOutput(t, "json")

	outPath := filepath.Join(t.TempDir(), "workspace-backup.tar.gz")
	cmd := newWorkspaceBackupCmd()
	var output bytes.Buffer
	cmd.SetOut(&output)
	cmd.SetErr(&output)
	cmd.SetArgs([]string{"--profile", "full", "--out", outPath})

	if err := cmd.Execute(); err != nil {
		t.Fatalf("workspace backup command failed: %v", err)
	}

	written, err := os.ReadFile(outPath)
	if err != nil {
		t.Fatalf("failed to read snapshot file: %v", err)
	}
	if len(written) < 2 || written[0] != 0x1f || written[1] != 0x8b {
		t.Fatalf("expected gzip-compressed snapshot, got prefix %x", written[:2])
	}

	payload, err := readPortableBackupFile(outPath)
	if err != nil {
		t.Fatalf("failed to read compressed snapshot: %v", err)
	}
	if !strings.Contains(string(payload), `"searchProfiles"`) || !strings.Contains(string(payload), `"workspaceConfig"`) {
		t.Fatalf("unexpected snapshot file contents: %s", string(payload))
	}

	commandPayload := decodeCommandJSON(t, output)
	if commandPayload["profile"] != "full" {
		t.Fatalf("unexpected command output: %+v", commandPayload)
	}
}

func TestWorkspaceRestoreCommandMergeModeImportsSnapshot(t *testing.T) {
	setCommandSessionAuthEnvironment(t)
	var loginCalls atomic.Int32

	snapshotFile := filepath.Join(t.TempDir(), "workspace-backup.json")
	writeTestPortableBackupFile(t, snapshotFile, map[string]any{
		"schemaVersion": 1,
		"profile":       "hr-ops",
		"workspaceSlug": "dev",
		"exportedAt":    1750000000000,
		"tables": map[string]any{
			"candidateStatus": []map[string]any{{"_id": "cs1", "resumeId": "r1", "status": "shortlisted"}},
			"candidateBlocks": []any{},
			"searchProfiles":  []any{},
			"workspaceConfig": []any{},
		},
	})

	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if handleCommandSessionLogin(t, w, r, &loginCalls) {
			return
		}
		assertCommandSessionRequest(t, r, true)
		if r.Method != http.MethodPost || r.URL.Path != "/api/workspace/import" {
			t.Fatalf("unexpected request %s %s", r.Method, r.URL.Path)
		}
		if got := r.Header.Get("X-Workspace-Slug"); got != "dev" {
			t.Fatalf("unexpected workspace header: %q", got)
		}

		var payload map[string]any
		if err := json.NewDecoder(r.Body).Decode(&payload); err != nil {
			t.Fatalf("failed to decode import body: %v", err)
		}
		if payload["schemaVersion"] != float64(1) {
			t.Fatalf("unexpected schemaVersion: %+v", payload)
		}
		if payload["profile"] != "hr-ops" || payload["mode"] != "merge" {
			t.Fatalf("unexpected import payload: %+v", payload)
		}
		tables, ok := payload["tables"].(map[string]any)
		if !ok {
			t.Fatalf("expected tables object: %+v", payload)
		}
		candidateStatus, ok := tables["candidateStatus"].([]any)
		if !ok || len(candidateStatus) != 1 {
			t.Fatalf("unexpected candidateStatus payload: %+v", tables)
		}

		_ = json.NewEncoder(w).Encode(map[string]any{
			"success":       true,
			"schemaVersion": 1,
			"profile":       "hr-ops",
			"workspaceSlug": "dev",
			"mode":          "merge",
			"applied": map[string]any{
				"candidateStatus": 1,
				"candidateBlocks": 0,
				"searchProfiles":  0,
				"workspaceConfig": 0,
			},
			"deleted": map[string]any{
				"candidateStatus": 0,
				"candidateBlocks": 0,
				"searchProfiles":  0,
				"workspaceConfig": 0,
			},
		})
	}))
	defer server.Close()

	setResumeCLIConfig(t, server.URL, "dev")
	setCLIOutput(t, "json")

	cmd := newWorkspaceRestoreCmd()
	var output bytes.Buffer
	cmd.SetOut(&output)
	cmd.SetErr(&output)
	cmd.SetArgs([]string{snapshotFile, "--mode", "merge"})

	if err := cmd.Execute(); err != nil {
		t.Fatalf("workspace restore command failed: %v", err)
	}
	if loginCalls.Load() != 1 {
		t.Fatalf("expected exactly one login, got %d", loginCalls.Load())
	}

	payload := decodeCommandJSON(t, output)
	if payload["mode"] != "merge" || payload["inputPath"] != snapshotFile {
		t.Fatalf("unexpected command output: %+v", payload)
	}
	applied, ok := payload["applied"].(map[string]any)
	if !ok || applied["candidateStatus"] != float64(1) {
		t.Fatalf("unexpected applied counts: %+v", payload)
	}
}

func TestWorkspaceRestoreCommandReplaceModeWithYes(t *testing.T) {
	setCommandSessionAuthEnvironment(t)
	var loginCalls atomic.Int32

	snapshotFile := filepath.Join(t.TempDir(), "workspace-backup.json")
	writeTestPortableBackupFile(t, snapshotFile, map[string]any{
		"schemaVersion": 1,
		"profile":       "full",
		"workspaceSlug": "dev",
		"exportedAt":    1750000000000,
		"tables": map[string]any{
			"candidateStatus": []any{},
			"candidateBlocks": []any{},
			"searchProfiles":  []map[string]any{{"_id": "sp1", "name": "default"}},
			"workspaceConfig": []map[string]any{{"configKey": "research.hotlist.api", "configValue": "https://example.com"}},
		},
	})

	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if handleCommandSessionLogin(t, w, r, &loginCalls) {
			return
		}
		assertCommandSessionRequest(t, r, true)
		if r.Method != http.MethodPost || r.URL.Path != "/api/workspace/import" {
			t.Fatalf("unexpected request %s %s", r.Method, r.URL.Path)
		}

		var payload map[string]any
		if err := json.NewDecoder(r.Body).Decode(&payload); err != nil {
			t.Fatalf("failed to decode import body: %v", err)
		}
		if payload["profile"] != "full" || payload["mode"] != "replace" {
			t.Fatalf("unexpected import payload: %+v", payload)
		}

		_ = json.NewEncoder(w).Encode(map[string]any{
			"success":       true,
			"schemaVersion": 1,
			"profile":       "full",
			"workspaceSlug": "dev",
			"mode":          "replace",
			"applied": map[string]any{
				"candidateStatus": 0,
				"candidateBlocks": 0,
				"searchProfiles":  1,
				"workspaceConfig": 1,
			},
			"deleted": map[string]any{
				"candidateStatus": 3,
				"candidateBlocks": 2,
				"searchProfiles":  1,
				"workspaceConfig": 2,
			},
		})
	}))
	defer server.Close()

	setResumeCLIConfig(t, server.URL, "dev")
	setCLIOutput(t, "json")

	cmd := newWorkspaceRestoreCmd()
	var output bytes.Buffer
	cmd.SetOut(&output)
	cmd.SetErr(&output)
	cmd.SetArgs([]string{snapshotFile, "--mode", "replace", "--yes"})

	if err := cmd.Execute(); err != nil {
		t.Fatalf("workspace restore command failed: %v", err)
	}

	payload := decodeCommandJSON(t, output)
	if payload["mode"] != "replace" || payload["profile"] != "full" {
		t.Fatalf("unexpected command output: %+v", payload)
	}
	deleted, ok := payload["deleted"].(map[string]any)
	if !ok || deleted["candidateStatus"] != float64(3) {
		t.Fatalf("unexpected deleted counts: %+v", payload)
	}
}

func TestWorkspaceRestoreCommandRequiresYesForReplace(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		t.Fatalf("unexpected request %s %s", r.Method, r.URL.Path)
	}))
	defer server.Close()

	setResumeCLIConfig(t, server.URL, "dev")
	setCLIOutput(t, "json")

	cmd := newWorkspaceRestoreCmd()
	var output bytes.Buffer
	cmd.SetOut(&output)
	cmd.SetErr(&output)
	cmd.SetArgs([]string{filepath.Join(t.TempDir(), "missing.json"), "--mode", "replace"})

	if err := cmd.Execute(); err == nil {
		t.Fatal("expected replace restore without --yes to fail")
	} else if !strings.Contains(err.Error(), "requires --yes") {
		t.Fatalf("unexpected error: %v", err)
	}
}

func TestWorkspaceRestoreCommandRejectsUnsupportedSchemaVersion(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		t.Fatalf("unexpected request %s %s", r.Method, r.URL.Path)
	}))
	defer server.Close()

	snapshotFile := filepath.Join(t.TempDir(), "workspace-backup.json")
	writeTestPortableBackupFile(t, snapshotFile, map[string]any{
		"schemaVersion": 99,
		"profile":       "hr-ops",
		"tables": map[string]any{
			"candidateStatus": []any{},
			"candidateBlocks": []any{},
			"searchProfiles":  []any{},
			"workspaceConfig": []any{},
		},
	})

	setResumeCLIConfig(t, server.URL, "dev")
	setCLIOutput(t, "json")

	cmd := newWorkspaceRestoreCmd()
	var output bytes.Buffer
	cmd.SetOut(&output)
	cmd.SetErr(&output)
	cmd.SetArgs([]string{snapshotFile, "--mode", "merge"})

	if err := cmd.Execute(); err == nil {
		t.Fatal("expected unsupported schemaVersion to fail")
	} else if !strings.Contains(err.Error(), "unsupported workspace snapshot schemaVersion 99") {
		t.Fatalf("unexpected error: %v", err)
	}
}
