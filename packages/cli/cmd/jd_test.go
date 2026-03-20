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

	"github.com/ptdevhk/trends/packages/cli/internal/client"
)

func TestJDListCommandWritesJSON(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/api/job-descriptions" {
			t.Fatalf("unexpected path: %s", r.URL.Path)
		}
		if r.Method != http.MethodGet {
			t.Fatalf("unexpected method: %s", r.Method)
		}
		_ = json.NewEncoder(w).Encode(client.JobDescriptionsResponse{
			Success: true,
			Items: []client.JobDescriptionFile{{
				Name:      "cnc-sales",
				Title:     "CNC Sales",
				Status:    "active",
				UpdatedAt: "2026-03-20T08:00:00Z",
			}},
		})
	}))
	defer server.Close()

	setResumeCLIConfig(t, server.URL, "hr")
	setCLIOutput(t, "json")

	cmd := newJDListCmd()
	var output bytes.Buffer
	cmd.SetOut(&output)
	cmd.SetErr(&output)

	if err := cmd.Execute(); err != nil {
		t.Fatalf("jd list command failed: %v", err)
	}

	payload := decodeCommandJSON(t, output)
	items, ok := payload["items"].([]interface{})
	if !ok || len(items) != 1 {
		t.Fatalf("unexpected output payload: %#v", payload)
	}
}

func TestJDCreateCommandUsesFilenameAndWritesTable(t *testing.T) {
	tempDir := t.TempDir()
	filePath := filepath.Join(tempDir, "field-sales.md")
	content := "# Field Sales\n\nNeed CNC sales experience.\n"
	if err := os.WriteFile(filePath, []byte(content), 0o644); err != nil {
		t.Fatalf("write temp file: %v", err)
	}

	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/api/job-descriptions" {
			t.Fatalf("unexpected path: %s", r.URL.Path)
		}
		if r.Method != http.MethodPost {
			t.Fatalf("unexpected method: %s", r.Method)
		}

		var payload client.CreateJobDescriptionRequest
		if err := json.NewDecoder(r.Body).Decode(&payload); err != nil {
			t.Fatalf("decode payload: %v", err)
		}
		if payload.Name != "field-sales" {
			t.Fatalf("expected derived name field-sales, got %q", payload.Name)
		}
		if payload.Content != content {
			t.Fatalf("unexpected content: %q", payload.Content)
		}
		if payload.Overwrite {
			t.Fatal("expected overwrite=false by default")
		}

		_ = json.NewEncoder(w).Encode(client.CreateJobDescriptionResponse{
			Success: true,
			Item: client.JobDescriptionFile{
				Name:   payload.Name,
				Title:  "Field Sales",
				Status: "draft",
			},
		})
	}))
	defer server.Close()

	setResumeCLIConfig(t, server.URL, "hr")
	setCLIOutput(t, "table")

	cmd := newJDCreateCmd()
	var output bytes.Buffer
	cmd.SetOut(&output)
	cmd.SetErr(&output)
	cmd.SetArgs([]string{filePath})

	if err := cmd.Execute(); err != nil {
		t.Fatalf("jd create command failed: %v", err)
	}

	text := output.String()
	if !strings.Contains(text, "field-sales") || !strings.Contains(text, "Field Sales") || !strings.Contains(text, "draft") {
		t.Fatalf("unexpected command output: %s", text)
	}
}

func TestJDCreateCommandHonorsExplicitNameAndOverwrite(t *testing.T) {
	tempDir := t.TempDir()
	filePath := filepath.Join(tempDir, "ignored-name.md")
	content := "# Replacement\n"
	if err := os.WriteFile(filePath, []byte(content), 0o644); err != nil {
		t.Fatalf("write temp file: %v", err)
	}

	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		var payload client.CreateJobDescriptionRequest
		if err := json.NewDecoder(r.Body).Decode(&payload); err != nil {
			t.Fatalf("decode payload: %v", err)
		}
		if payload.Name != "custom-jd" {
			t.Fatalf("expected explicit name custom-jd, got %q", payload.Name)
		}
		if !payload.Overwrite {
			t.Fatal("expected overwrite=true")
		}
		_ = json.NewEncoder(w).Encode(client.CreateJobDescriptionResponse{
			Success: true,
			Item: client.JobDescriptionFile{
				Name:   payload.Name,
				Title:  "Replacement",
				Status: "active",
			},
		})
	}))
	defer server.Close()

	setResumeCLIConfig(t, server.URL, "hr")
	setCLIOutput(t, "json")

	cmd := newJDCreateCmd()
	var output bytes.Buffer
	cmd.SetOut(&output)
	cmd.SetErr(&output)
	cmd.SetArgs([]string{filePath, "--name", "custom-jd", "--overwrite"})

	if err := cmd.Execute(); err != nil {
		t.Fatalf("jd create command failed: %v", err)
	}

	payload := decodeCommandJSON(t, output)
	if payload["name"] != "custom-jd" || payload["status"] != "active" {
		t.Fatalf("unexpected output payload: %#v", payload)
	}
}
