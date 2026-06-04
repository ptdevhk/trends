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

func TestResumeShowCommandWritesDetailedWorkHistory(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/api/resumes/resume-1" {
			t.Fatalf("unexpected path: %s", r.URL.Path)
		}
		if got := r.URL.Query().Get("source"); got != "convex" {
			t.Fatalf("expected source=convex, got %q", got)
		}
		_ = json.NewEncoder(w).Encode(client.ResumeDetailResponse{
			Success: true,
			Source:  "convex",
			Data: client.ResumeItem{
				ResumeID:       "resume-1",
				Name:           "Alice",
				JobIntention:   "Sales",
				Location:       "Dongguan",
				Experience:     "8 years",
				Education:      "Bachelor",
				ActivityStatus: "Active today",
				ExpectedSalary: "20K",
				ProfileURL:     "https://example.com/alice",
				SelfIntro:      "Strong CNC sales background.",
				WorkHistory: []client.ResumeWorkHistoryItem{
					{
						Raw:         "2021-03 ~ 至今 Example Co. Sales Manager",
						CompanyName: "Example Co.",
						JobTitle:    "Sales Manager",
						Description: "Managed CNC machine accounts.\nClosed key projects.",
						StartDate:   "2021-03",
						EndDate:     "至今",
					},
				},
			},
		})
	}))
	defer server.Close()

	setResumeCLIConfig(t, server.URL, "hr")
	setCLIOutput(t, "table")

	cmd := newResumeShowCmd()
	var output bytes.Buffer
	cmd.SetOut(&output)
	cmd.SetErr(&output)
	cmd.SetArgs([]string{"resume-1", "--source", "convex"})

	if err := cmd.Execute(); err != nil {
		t.Fatalf("resume show command failed: %v", err)
	}

	text := output.String()
	if !strings.Contains(text, "Work History:") ||
		!strings.Contains(text, "Example Co. | Sales Manager") ||
		!strings.Contains(text, "Managed CNC machine accounts.") {
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

func TestResumeAnalyzeCommandRequiresQueryOrJD(t *testing.T) {
	cmd := newResumeAnalyzeCmd()
	cmd.SetArgs([]string{})

	err := cmd.Execute()
	if err == nil {
		t.Fatal("expected query or job-description required error")
	}
	if !strings.Contains(err.Error(), "query or job-description is required") {
		t.Fatalf("unexpected error: %v", err)
	}
}

func TestResumeAnalyzeCommandDryRunWritesJSON(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/api/resumes/analyze" {
			t.Fatalf("unexpected path: %s", r.URL.Path)
		}
		if r.Method != http.MethodPost {
			t.Fatalf("unexpected method: %s", r.Method)
		}
		var body map[string]any
		if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
			t.Fatalf("failed to decode body: %v", err)
		}
		if body["roleFilterType"] != "sales" {
			t.Fatalf("expected roleFilterType=sales, got %v", body["roleFilterType"])
		}
		if body["minRoleYears"] != float64(1) {
			t.Fatalf("expected minRoleYears=1, got %v", body["minRoleYears"])
		}
		if body["market"] != "CN" {
			t.Fatalf("expected market=CN, got %v", body["market"])
		}
		_ = json.NewEncoder(w).Encode(client.AnalyzeResponse{
			Success:      true,
			DryRun:        true,
			ResumeCount:   42,
			SkippedCount:  5,
			Config: &client.AnalyzeConfig{
				Keywords: []string{"CNC", "销售"},
				Location: "Dongguan",
			},
		})
	}))
	defer server.Close()

	setResumeCLIConfig(t, server.URL, "dev")
	setCLIOutput(t, "json")

	cmd := newResumeAnalyzeCmd()
	var output bytes.Buffer
	cmd.SetOut(&output)
	cmd.SetErr(&output)
	cmd.SetArgs([]string{
		"--query", "CNC 销售",
		"--location", "Dongguan",
		"--role-type", "sales",
		"--min-role-years", "1",
		"--market", "CN",
		"--dry-run",
	})

	if err := cmd.Execute(); err != nil {
		t.Fatalf("resume analyze command failed: %v", err)
	}

	payload := decodeCommandJSON(t, output)
	if payload["resumeCount"] != float64(42) || payload["dryRun"] != true {
		t.Fatalf("unexpected analyze output: %+v", payload)
	}
}

func TestResumeAnalyzeCommandWithJDWritesTable(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/api/resumes/analyze" {
			t.Fatalf("unexpected path: %s", r.URL.Path)
		}
		var body map[string]any
		if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
			t.Fatalf("failed to decode body: %v", err)
		}
		if body["jobDescriptionId"] != "cnc-sales" {
			t.Fatalf("expected jobDescriptionId=cnc-sales, got %v", body["jobDescriptionId"])
		}
		_ = json.NewEncoder(w).Encode(client.AnalyzeResponse{
			Success:      true,
			TaskID:       "task-abc",
			ResumeCount:  30,
			SkippedCount: 2,
			Config: &client.AnalyzeConfig{
				JobDescriptionID: "cnc-sales",
			},
		})
	}))
	defer server.Close()

	setResumeCLIConfig(t, server.URL, "dev")
	setCLIOutput(t, "table")

	cmd := newResumeAnalyzeCmd()
	var output bytes.Buffer
	cmd.SetOut(&output)
	cmd.SetErr(&output)
	cmd.SetArgs([]string{"--job-description", "cnc-sales"})

	if err := cmd.Execute(); err != nil {
		t.Fatalf("resume analyze command failed: %v", err)
	}

	text := output.String()
	if !strings.Contains(text, "30") || !strings.Contains(text, "task-abc") || !strings.Contains(text, "cnc-sales") {
		t.Fatalf("unexpected analyze table output: %s", text)
	}
}

func TestResumeSearchCommandDefaultsToAgentOutput(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		_ = json.NewEncoder(w).Encode(client.ResumesResponse{
			Success: true,
			Data: []client.ResumeItem{
				{ResumeID: "resume-1", Name: "Alice Chow", Location: "Dongguan", JobIntention: "Sales"},
			},
			Summary: client.ResumesSummary{Total: 1, Returned: 1, Query: "CNC sales", Source: "convex"},
		})
	}))
	defer server.Close()

	setResumeCLIConfig(t, server.URL, "hr")
	setCLIOutput(t, "agent")

	cmd := newResumeSearchCmd()
	var output bytes.Buffer
	cmd.SetOut(&output)
	cmd.SetErr(&output)
	cmd.SetArgs([]string{"CNC sales", "--limit", "5", "--source", "convex"})

	if err := cmd.Execute(); err != nil {
		t.Fatalf("resume search command failed: %v", err)
	}

	text := output.String()
	if !strings.Contains(text, `kind=summary query="CNC sales" source=convex total=1 returned=1`) {
		t.Fatalf("missing compact summary: %s", text)
	}
	if !strings.Contains(text, `id=resume-1 name="Alice Chow" intention=Sales location=Dongguan`) {
		t.Fatalf("missing compact row: %s", text)
	}
	if strings.Contains(text, "Query:") || strings.Contains(text, "+---") {
		t.Fatalf("agent output contains human formatting: %s", text)
	}
}

func TestResumeAnalyzeCommandDefaultsToAgentOutput(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		_ = json.NewEncoder(w).Encode(client.AnalyzeResponse{
			Success:     true,
			TaskID:      "task-1",
			ResumeCount: 42,
			DryRun:      false,
			Config: &client.AnalyzeConfig{
				Keywords: []string{"CNC", "sales"},
				Location: "Dongguan",
			},
		})
	}))
	defer server.Close()

	setResumeCLIConfig(t, server.URL, "hr")
	setCLIOutput(t, "agent")

	cmd := newResumeAnalyzeCmd()
	var output bytes.Buffer
	cmd.SetOut(&output)
	cmd.SetErr(&output)
	cmd.SetArgs([]string{"--query", "CNC sales", "--location", "Dongguan"})

	if err := cmd.Execute(); err != nil {
		t.Fatalf("resume analyze command failed: %v", err)
	}

	text := output.String()
	if !strings.Contains(text, `kind=analysis candidates=42 dry_run=false task_id=task-1`) {
		t.Fatalf("unexpected agent output: %s", text)
	}
	if strings.Contains(text, "Candidates:") || strings.Contains(text, "Task ID:") {
		t.Fatalf("agent output contains human prose: %s", text)
	}
}

func TestResumeManualImportCommandAgentOutput(t *testing.T) {
	uploadPath := filepath.Join(t.TempDir(), "51job.rar")
	if err := os.WriteFile(uploadPath, []byte("rar-bytes"), 0o644); err != nil {
		t.Fatalf("failed to write upload file: %v", err)
	}

	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if err := r.ParseMultipartForm(8 << 20); err != nil {
			t.Fatalf("failed to parse multipart form: %v", err)
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
	setCLIOutput(t, "agent")

	cmd := newResumeManualImportCmd()
	var output bytes.Buffer
	cmd.SetOut(&output)
	cmd.SetErr(&output)
	cmd.SetArgs([]string{uploadPath})

	if err := cmd.Execute(); err != nil {
		t.Fatalf("resume manual import command failed: %v", err)
	}

	text := output.String()
	if !strings.Contains(text, `kind=summary source=51job-manual uploaded=1 discovered=1 parsed=1 imported=1 failed=0`) {
		t.Fatalf("missing agent summary: %s", text)
	}
	if !strings.Contains(text, `extension=.docx status=imported resume_name=张三 profile_id=123456`) {
		t.Fatalf("missing agent row: %s", text)
	}
}

func TestResumeShowCommandAgentOutput(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		_ = json.NewEncoder(w).Encode(client.ResumeDetailResponse{
			Success: true,
			Source:  "convex",
			Data: client.ResumeItem{
				ResumeID:       "resume-1",
				Name:           "Alice",
				JobIntention:   "Sales",
				Location:       "Dongguan",
				Experience:     "8 years",
				Education:      "Bachelor",
				ActivityStatus: "Active today",
				ExpectedSalary: "20K",
				ProfileURL:     "https://example.com/alice",
				SelfIntro:      "Strong CNC sales background.",
				WorkHistory: []client.ResumeWorkHistoryItem{
					{Raw: "2021-03 ~ Example Co. Sales Manager"},
				},
			},
		})
	}))
	defer server.Close()

	setResumeCLIConfig(t, server.URL, "hr")
	setCLIOutput(t, "agent")

	cmd := newResumeShowCmd()
	var output bytes.Buffer
	cmd.SetOut(&output)
	cmd.SetErr(&output)
	cmd.SetArgs([]string{"resume-1", "--source", "convex"})

	if err := cmd.Execute(); err != nil {
		t.Fatalf("resume show command failed: %v", err)
	}

	text := output.String()
	if !strings.Contains(text, `kind=resume_detail id=resume-1 name=Alice source=convex intention=Sales location=Dongguan experience="8 years" education=Bachelor`) {
		t.Fatalf("missing agent resume detail: %s", text)
	}
	if !strings.Contains(text, `detail="use --output json for full resume"`) {
		t.Fatalf("missing json hint: %s", text)
	}
	if strings.Contains(text, "Self Intro:") || strings.Contains(text, "Work History:") {
		t.Fatalf("agent output contains human prose: %s", text)
	}
}

func TestResumeSearchCommandCSVHasNoProse(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		_ = json.NewEncoder(w).Encode(client.ResumesResponse{
			Success: true,
			Data: []client.ResumeItem{
				{ResumeID: "resume-1", Name: "Alice", Location: "Dongguan", JobIntention: "Sales"},
			},
			Summary: client.ResumesSummary{Total: 1, Returned: 1, Query: "CNC sales", Source: "convex"},
		})
	}))
	defer server.Close()

	setResumeCLIConfig(t, server.URL, "hr")
	setCLIOutput(t, "csv")

	cmd := newResumeSearchCmd()
	var output bytes.Buffer
	cmd.SetOut(&output)
	cmd.SetErr(&output)
	cmd.SetArgs([]string{"CNC sales", "--limit", "5", "--source", "convex"})

	if err := cmd.Execute(); err != nil {
		t.Fatalf("resume search command failed: %v", err)
	}

	text := output.String()
	if strings.Contains(text, "Query:") || strings.Contains(text, "Source:") {
		t.Fatalf("csv output contains prose prelude: %s", text)
	}
	if !strings.HasPrefix(text, "id,name,intention,location,experience,education") {
		t.Fatalf("csv output missing header: %s", text)
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
