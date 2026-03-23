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

func TestResumeSearchCommandSupportsConvexSource(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/api/resumes" {
			t.Fatalf("unexpected path: %s", r.URL.Path)
		}
		if got := r.URL.Query().Get("source"); got != "convex" {
			t.Fatalf("expected source=convex, got %q", got)
		}
		_ = json.NewEncoder(w).Encode(client.ResumesResponse{
			Success: true,
			Data: []client.ResumeItem{
				{ResumeID: "resume-1", Name: "Alice", Location: "Dongguan", JobIntention: "Sales"},
			},
			Summary: client.ResumesSummary{
				Total:    1,
				Returned: 1,
				Query:    "CNC 销售",
				Source:   "convex",
			},
		})
	}))
	defer server.Close()

	setResumeCLIConfig(t, server.URL, "hr")
	setCLIOutput(t, "table")

	cmd := newResumeSearchCmd()
	var output bytes.Buffer
	cmd.SetOut(&output)
	cmd.SetErr(&output)
	cmd.SetArgs([]string{"CNC 销售", "--limit", "5", "--source", "convex"})

	if err := cmd.Execute(); err != nil {
		t.Fatalf("resume search command failed: %v", err)
	}
	text := output.String()
	if !strings.Contains(text, "Source: convex") || !strings.Contains(text, "Alice") {
		t.Fatalf("unexpected command output: %s", text)
	}
}

func TestResumeMatchCommandWritesJSON(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/api/resumes/match" {
			t.Fatalf("unexpected path: %s", r.URL.Path)
		}
		var payload client.ResumeMatchRequest
		if err := json.NewDecoder(r.Body).Decode(&payload); err != nil {
			t.Fatalf("decode error: %v", err)
		}
		if payload.Source != "convex" {
			t.Fatalf("expected convex source, got %q", payload.Source)
		}
		if payload.Persist == nil || *payload.Persist != false {
			t.Fatalf("expected persist=false, got %+v", payload.Persist)
		}

		_ = json.NewEncoder(w).Encode(client.ResumeMatchResponse{
			Success: true,
			Mode:    "rules_only",
			Results: []client.ResumeMatchResult{
				{ResumeID: "resume-1", Score: 90, Recommendation: "match", MatchedAt: "2026-03-17T00:00:00.000Z"},
			},
			Stats: client.MatchStats{Processed: 1, Matched: 1, AvgScore: 90},
		})
	}))
	defer server.Close()

	setResumeCLIConfig(t, server.URL, "dev")
	setCLIOutput(t, "json")

	cmd := newResumeMatchCmd()
	var output bytes.Buffer
	cmd.SetOut(&output)
	cmd.SetErr(&output)
	cmd.SetArgs([]string{"--query", "CNC 销售"})

	if err := cmd.Execute(); err != nil {
		t.Fatalf("resume match command failed: %v", err)
	}
	if !strings.Contains(output.String(), `"resumeId": "resume-1"`) {
		t.Fatalf("unexpected command output: %s", output.String())
	}
}

func TestResumeManualImportCommandWritesTableSummary(t *testing.T) {
	uploadPath := filepath.Join(t.TempDir(), "51job.rar")
	if err := os.WriteFile(uploadPath, []byte("rar-bytes"), 0o644); err != nil {
		t.Fatalf("failed to write upload file: %v", err)
	}

	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodPost || r.URL.Path != "/api/resumes/manual-import" {
			t.Fatalf("unexpected request %s %s", r.Method, r.URL.Path)
		}
		if err := r.ParseMultipartForm(8 << 20); err != nil {
			t.Fatalf("failed to parse multipart form: %v", err)
		}
		if got := r.FormValue("keyword"); got != "销售工程师" {
			t.Fatalf("unexpected keyword: %q", got)
		}
		if got := r.FormValue("location"); got != "东莞" {
			t.Fatalf("unexpected location: %q", got)
		}
		if got := r.FormValue("limit"); got != "10" {
			t.Fatalf("unexpected limit: %q", got)
		}
		files := r.MultipartForm.File["files"]
		if len(files) != 1 || files[0].Filename != "51job.rar" {
			t.Fatalf("unexpected uploaded files: %+v", files)
		}

		_ = json.NewEncoder(w).Encode(client.ResumeManualImportResponse{
			Success: true,
			Source: client.ResumeManualImportSource{
				Key:   "51job-manual",
				Label: "51job-manual",
			},
			Summary: client.ResumeManualImportSummary{
				UploadedFiles:   1,
				DiscoveredFiles: 1,
				ParsedResumes:   1,
				Imported:        1,
				Inserted:        1,
			},
			Files: []client.ResumeManualImportFileResult{
				{
					UploadName: "51job.rar",
					EntryPath:  "51job_张三(123456).docx",
					Extension:  ".docx",
					Status:     "imported",
					ResumeName: "张三",
					ProfileID:  "123456",
				},
			},
		})
	}))
	defer server.Close()

	setResumeCLIConfig(t, server.URL, "hr")
	setCLIOutput(t, "table")

	cmd := newResumeManualImportCmd()
	var output bytes.Buffer
	cmd.SetOut(&output)
	cmd.SetErr(&output)
	cmd.SetArgs([]string{uploadPath, "--keyword", "销售工程师", "--location", "东莞", "--limit", "10"})

	if err := cmd.Execute(); err != nil {
		t.Fatalf("resume manual import command failed: %v", err)
	}

	text := output.String()
	if !strings.Contains(text, "Source: 51job-manual") || !strings.Contains(text, "张三") || !strings.Contains(text, "123456") {
		t.Fatalf("unexpected command output: %s", text)
	}
}

func TestResumeManualImportCommandRejectsZeroLimitWhenExplicitlySet(t *testing.T) {
	cmd := newResumeManualImportCmd()
	cmd.SetArgs([]string{"sample.rar", "--limit", "0"})

	err := cmd.Execute()
	if err == nil {
		t.Fatal("expected zero limit to fail")
	}
	if !strings.Contains(err.Error(), "--limit must be greater than 0") {
		t.Fatalf("unexpected error: %v", err)
	}
}
