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

	"github.com/spf13/viper"
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

	originalAPIURL := viper.GetString("api_url")
	originalWorkerURL := viper.GetString("worker_url")
	originalWorkspace := viper.GetString("workspace")
	originalOutput := viper.GetString("output")
	t.Cleanup(func() {
		viper.Set("api_url", originalAPIURL)
		viper.Set("worker_url", originalWorkerURL)
		viper.Set("workspace", originalWorkspace)
		viper.Set("output", originalOutput)
	})
	viper.Set("api_url", server.URL)
	viper.Set("worker_url", server.URL)
	viper.Set("workspace", "hr")
	viper.Set("output", "json")

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

	originalAPIURL := viper.GetString("api_url")
	originalWorkerURL := viper.GetString("worker_url")
	originalWorkspace := viper.GetString("workspace")
	originalOutput := viper.GetString("output")
	t.Cleanup(func() {
		viper.Set("api_url", originalAPIURL)
		viper.Set("worker_url", originalWorkerURL)
		viper.Set("workspace", originalWorkspace)
		viper.Set("output", originalOutput)
	})
	viper.Set("api_url", server.URL)
	viper.Set("worker_url", server.URL)
	viper.Set("workspace", "dev")
	viper.Set("output", "json")

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

	originalAPIURL := viper.GetString("api_url")
	originalWorkerURL := viper.GetString("worker_url")
	originalWorkspace := viper.GetString("workspace")
	originalOutput := viper.GetString("output")
	t.Cleanup(func() {
		viper.Set("api_url", originalAPIURL)
		viper.Set("worker_url", originalWorkerURL)
		viper.Set("workspace", originalWorkspace)
		viper.Set("output", originalOutput)
	})
	viper.Set("api_url", server.URL)
	viper.Set("worker_url", server.URL)
	viper.Set("workspace", "dev")
	viper.Set("output", "json")

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
