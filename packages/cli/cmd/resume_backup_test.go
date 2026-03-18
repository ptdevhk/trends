package cmd

import (
	"bytes"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestResumeBackupCommandWritesBackupFile(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodPost || r.URL.Path != "/api/resumes/backup" {
			t.Fatalf("unexpected request %s %s", r.Method, r.URL.Path)
		}

		var payload map[string]any
		if err := json.NewDecoder(r.Body).Decode(&payload); err != nil {
			t.Fatalf("failed to decode request body: %v", err)
		}
		if resumeIDs, ok := payload["resumeIds"].([]any); !ok || len(resumeIDs) != 1 || resumeIDs[0] != "r1" {
			t.Fatalf("unexpected resumeIds payload: %+v", payload)
		}
		if sourceHosts, ok := payload["sourceHosts"].([]any); !ok || len(sourceHosts) != 1 || sourceHosts[0] != "hr.job5156.com" {
			t.Fatalf("unexpected sourceHosts payload: %+v", payload)
		}
		if limit, ok := payload["limit"].(float64); !ok || int(limit) != 2 {
			t.Fatalf("unexpected limit payload: %+v", payload)
		}

		w.Header().Set("Content-Disposition", `attachment; filename="resume-backup-server.json"`)
		_ = json.NewEncoder(w).Encode(map[string]any{
			"metadata": map[string]any{
				"generatedBy": "trends-api backup",
			},
			"resumes": []map[string]any{
				{"resumeId": "r1", "name": "Alice"},
			},
		})
	}))
	defer server.Close()

	setResumeCLIConfig(t, server.URL, "hr")
	setCLIOutput(t, "json")

	outPath := filepath.Join(t.TempDir(), "backups", "resume-backup.json")
	cmd := newResumeBackupCmd()
	var output bytes.Buffer
	cmd.SetOut(&output)
	cmd.SetErr(&output)
	cmd.SetArgs([]string{
		"--out", outPath,
		"--resume-id", "r1",
		"--source-host", "hr.job5156.com",
		"--limit", "2",
	})

	if err := cmd.Execute(); err != nil {
		t.Fatalf("resume backup command failed: %v", err)
	}

	written, err := os.ReadFile(outPath)
	if err != nil {
		t.Fatalf("failed to read backup file: %v", err)
	}
	if !strings.Contains(string(written), `"generatedBy": "trends-api backup"`) {
		t.Fatalf("unexpected backup file contents: %s", string(written))
	}
	if !strings.Contains(output.String(), `"count": 1`) {
		t.Fatalf("unexpected command output: %s", output.String())
	}
}

func TestResumeDeployBackupWriteCreatesRunDirAndWorkspaceFile(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodPost || r.URL.Path != "/api/resumes/backup" {
			t.Fatalf("unexpected request %s %s", r.Method, r.URL.Path)
		}
		if got := r.Header.Get("X-Workspace-Slug"); got != "dev" {
			t.Fatalf("unexpected workspace header: %q", got)
		}

		_ = json.NewEncoder(w).Encode(map[string]any{
			"metadata": map[string]any{
				"generatedBy": "trends-api backup",
			},
			"resumes": []map[string]any{
				{"resumeId": "r1", "name": "Alice"},
				{"resumeId": "r2", "name": "Bob"},
			},
		})
	}))
	defer server.Close()

	setResumeCLIConfig(t, server.URL, "dev")
	setCLIOutput(t, "json")

	baseDir := filepath.Join(t.TempDir(), "deploy")
	cmd := newResumeDeployBackupWriteCmd()
	var output bytes.Buffer
	cmd.SetOut(&output)
	cmd.SetErr(&output)
	cmd.SetArgs([]string{"--base-dir", baseDir})

	if err := cmd.Execute(); err != nil {
		t.Fatalf("resume deploy-backup write command failed: %v", err)
	}

	entries, err := os.ReadDir(baseDir)
	if err != nil {
		t.Fatalf("failed to read deploy backup base dir: %v", err)
	}
	if len(entries) != 1 || !entries[0].IsDir() || !strings.HasPrefix(entries[0].Name(), "deploy-") {
		t.Fatalf("unexpected deploy backup entries: %+v", entries)
	}

	runDir := filepath.Join(baseDir, entries[0].Name())
	backupPath := filepath.Join(runDir, "resumes-dev.json")
	written, err := os.ReadFile(backupPath)
	if err != nil {
		t.Fatalf("failed to read deploy backup file: %v", err)
	}
	if !strings.Contains(string(written), `"resumeId": "r1"`) {
		t.Fatalf("unexpected deploy backup file contents: %s", string(written))
	}

	payload := decodeCommandJSON(t, output)
	if payload["workspace"] != "dev" {
		t.Fatalf("unexpected workspace in output: %+v", payload)
	}
	if payload["runDir"] != runDir {
		t.Fatalf("unexpected runDir in output: %+v", payload)
	}
	if payload["file"] != backupPath {
		t.Fatalf("unexpected file path in output: %+v", payload)
	}
}

func TestResumeRestoreCommandReplaceModeCallsResetThenImport(t *testing.T) {
	backupFile := filepath.Join(t.TempDir(), "resume-backup.json")
	if err := os.WriteFile(backupFile, []byte(`{
  "metadata": {
    "sourceUrl": "https://example.com/api/resumes/backup",
    "generatedBy": "trends-api backup"
  },
  "resumes": [
    {
      "resumeId": "r1",
      "name": "Alice"
    }
  ]
}`), 0o644); err != nil {
		t.Fatalf("failed to write backup file: %v", err)
	}

	var callOrder []string
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		callOrder = append(callOrder, r.URL.Path)

		switch r.URL.Path {
		case "/api/resumes/reset":
			_ = json.NewEncoder(w).Encode(map[string]any{
				"success": true,
				"count":   1,
				"partial": false,
				"deleted": map[string]int{"resumes": 1},
			})
		case "/api/resumes/import":
			var payload map[string]any
			if err := json.NewDecoder(r.Body).Decode(&payload); err != nil {
				t.Fatalf("failed to decode import payload: %v", err)
			}
			if _, ok := payload["metadata"].(map[string]any); !ok {
				t.Fatalf("expected metadata object: %+v", payload)
			}
			_ = json.NewEncoder(w).Encode(map[string]any{
				"success":   true,
				"submitted": 1,
				"inserted":  1,
				"updated":   0,
				"unchanged": 0,
				"deduped":   0,
			})
		default:
			t.Fatalf("unexpected request %s %s", r.Method, r.URL.Path)
		}
	}))
	defer server.Close()

	setResumeCLIConfig(t, server.URL, "dev")
	setCLIOutput(t, "json")

	cmd := newResumeRestoreCmd()
	var output bytes.Buffer
	cmd.SetOut(&output)
	cmd.SetErr(&output)
	cmd.SetArgs([]string{
		backupFile,
		"--mode", "replace",
		"--yes",
	})

	if err := cmd.Execute(); err != nil {
		t.Fatalf("resume restore command failed: %v", err)
	}

	if len(callOrder) != 2 || callOrder[0] != "/api/resumes/reset" || callOrder[1] != "/api/resumes/import" {
		t.Fatalf("unexpected call order: %+v", callOrder)
	}
	if !strings.Contains(output.String(), `"mode": "replace"`) {
		t.Fatalf("unexpected command output: %s", output.String())
	}
}

func TestResumeDeployBackupRestoreUsesLatestRunDir(t *testing.T) {
	baseDir := filepath.Join(t.TempDir(), "deploy")
	olderDir := filepath.Join(baseDir, "deploy-20260101T000000Z-100")
	latestDir := filepath.Join(baseDir, "deploy-20260102T000000Z-200")
	for _, dir := range []string{olderDir, latestDir} {
		if err := os.MkdirAll(dir, 0o755); err != nil {
			t.Fatalf("failed to create deploy backup dir %s: %v", dir, err)
		}
	}
	if err := os.WriteFile(filepath.Join(latestDir, "resumes-dev.json"), []byte(`{
  "metadata": {
    "generatedBy": "trends-api backup"
  },
  "resumes": [
    {
      "resumeId": "r-latest",
      "name": "Latest"
    }
  ]
}`), 0o644); err != nil {
		t.Fatalf("failed to write latest deploy backup file: %v", err)
	}

	var callOrder []string
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		callOrder = append(callOrder, r.URL.Path)

		switch r.URL.Path {
		case "/api/resumes/reset":
			_ = json.NewEncoder(w).Encode(map[string]any{
				"success": true,
				"count":   4,
				"partial": false,
				"deleted": map[string]int{"resumes": 4},
			})
		case "/api/resumes/import":
			var payload map[string]any
			if err := json.NewDecoder(r.Body).Decode(&payload); err != nil {
				t.Fatalf("failed to decode import payload: %v", err)
			}
			resumes, ok := payload["resumes"].([]any)
			if !ok || len(resumes) != 1 {
				t.Fatalf("unexpected import payload: %+v", payload)
			}
			resume, ok := resumes[0].(map[string]any)
			if !ok || resume["resumeId"] != "r-latest" {
				t.Fatalf("unexpected imported resume payload: %+v", payload)
			}
			_ = json.NewEncoder(w).Encode(map[string]any{
				"success":   true,
				"submitted": 1,
				"inserted":  1,
				"updated":   0,
				"unchanged": 0,
				"deduped":   0,
			})
		default:
			t.Fatalf("unexpected request %s %s", r.Method, r.URL.Path)
		}
	}))
	defer server.Close()

	setResumeCLIConfig(t, server.URL, "dev")
	setCLIOutput(t, "json")

	cmd := newResumeDeployBackupRestoreCmd()
	var output bytes.Buffer
	cmd.SetOut(&output)
	cmd.SetErr(&output)
	cmd.SetArgs([]string{
		"--base-dir", baseDir,
		"--mode", "replace",
		"--yes",
	})

	if err := cmd.Execute(); err != nil {
		t.Fatalf("resume deploy-backup restore command failed: %v", err)
	}

	if len(callOrder) != 2 || callOrder[0] != "/api/resumes/reset" || callOrder[1] != "/api/resumes/import" {
		t.Fatalf("unexpected call order: %+v", callOrder)
	}

	payload := decodeCommandJSON(t, output)
	if payload["runDir"] != latestDir {
		t.Fatalf("unexpected runDir in output: %+v", payload)
	}
	if payload["file"] != filepath.Join(latestDir, "resumes-dev.json") {
		t.Fatalf("unexpected file path in output: %+v", payload)
	}
	if payload["mode"] != "replace" {
		t.Fatalf("unexpected mode in output: %+v", payload)
	}
}

func TestResumeRestoreCommandRequiresYesForReplace(t *testing.T) {
	backupFile := filepath.Join(t.TempDir(), "resume-backup.json")
	if err := os.WriteFile(backupFile, []byte(`{
  "metadata": {
    "sourceUrl": "https://example.com/api/resumes/backup",
    "generatedBy": "trends-api backup"
  },
  "resumes": [
    {
      "resumeId": "r1",
      "name": "Alice"
    }
  ]
}`), 0o644); err != nil {
		t.Fatalf("failed to write backup file: %v", err)
	}

	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		t.Fatalf("unexpected request %s %s", r.Method, r.URL.Path)
	}))
	defer server.Close()

	setResumeCLIConfig(t, server.URL, "dev")
	setCLIOutput(t, "json")

	cmd := newResumeRestoreCmd()
	var output bytes.Buffer
	cmd.SetOut(&output)
	cmd.SetErr(&output)
	cmd.SetArgs([]string{
		backupFile,
		"--mode", "replace",
	})

	if err := cmd.Execute(); err == nil {
		t.Fatal("expected replace restore without --yes to fail")
	} else if !strings.Contains(err.Error(), "requires --yes") {
		t.Fatalf("unexpected error: %v", err)
	}
}
