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
	"time"

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
			DryRun:       true,
			ResumeCount:  42,
			SkippedCount: 5,
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

func TestResumeAnalyzeExactDryRunPreservesManifestOrder(t *testing.T) {
	manifestPath := filepath.Join(t.TempDir(), "cohort.json")
	manifest := `{"version":1,"targets":[{"referenceResumeId":"old-2","externalId":"external-2"},{"referenceResumeId":"old-1","profileResumeId":"100001"}]}`
	if err := os.WriteFile(manifestPath, []byte(manifest), 0o600); err != nil {
		t.Fatalf("write manifest: %v", err)
	}

	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/api/resumes/analyze" || r.Method != http.MethodPost {
			t.Fatalf("unexpected request %s %s", r.Method, r.URL.Path)
		}
		var body map[string]any
		if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
			t.Fatalf("decode analyze request: %v", err)
		}
		targets, ok := body["targets"].([]any)
		if !ok || len(targets) != 2 {
			t.Fatalf("unexpected targets: %+v", body["targets"])
		}
		first := targets[0].(map[string]any)
		second := targets[1].(map[string]any)
		if first["referenceResumeId"] != "old-2" || second["referenceResumeId"] != "old-1" {
			t.Fatalf("manifest order changed: %+v", targets)
		}
		_ = json.NewEncoder(w).Encode(map[string]any{
			"success":        true,
			"mode":           "exact",
			"dryRun":         true,
			"resumeCount":    2,
			"requestedCount": 2,
			"resolvedCount":  2,
			"resumeIds":      []string{"current-2", "current-1"},
			"targets": []map[string]any{
				{"referenceResumeId": "old-2", "currentResumeId": "current-2", "externalId": "external-2", "source": "seek", "canonicalIdentityKey": "externalId:external-2", "outcome": "resolved", "selectors": []map[string]string{{"kind": "externalId", "value": "external-2"}}},
				{"referenceResumeId": "old-1", "currentResumeId": "current-1", "externalId": "external-1", "source": "51job", "canonicalIdentityKey": "externalId:external-1", "outcome": "resolved", "selectors": []map[string]string{{"kind": "profileResumeId", "value": "100001"}}},
			},
			"expectedAnalysis": map[string]any{"jobDescriptionId": "keyword-search:2:test", "promptVersion": 42},
		})
	}))
	defer server.Close()

	setResumeCLIConfig(t, server.URL, "dev")
	setCLIOutput(t, "json")
	cmd := newResumeAnalyzeCmd()
	var output bytes.Buffer
	cmd.SetOut(&output)
	cmd.SetErr(&output)
	cmd.SetArgs([]string{"--manifest", manifestPath, "--query", "CNC 销售", "--dry-run"})

	if err := cmd.Execute(); err != nil {
		t.Fatalf("exact analyze dry run failed: %v", err)
	}
	payload := decodeCommandJSON(t, output)
	if payload["mode"] != "exact" || payload["resolvedCount"] != float64(2) {
		t.Fatalf("unexpected exact dry-run evidence: %+v", payload)
	}
	resolved := payload["targets"].([]any)
	if resolved[0].(map[string]any)["referenceResumeId"] != "old-2" {
		t.Fatalf("resolution evidence order changed: %+v", resolved)
	}
}

func TestResumeAnalyzeExactDryRunPreservesRepeatableResumeIDs(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		var body map[string]any
		if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
			t.Fatalf("decode analyze request: %v", err)
		}
		resumeIDs, ok := body["resumeIds"].([]any)
		if !ok || len(resumeIDs) != 2 || resumeIDs[0] != "current-2" || resumeIDs[1] != "current-1" {
			t.Fatalf("repeatable resume ID order changed: %+v", body["resumeIds"])
		}
		_ = json.NewEncoder(w).Encode(map[string]any{
			"success": true, "mode": "exact", "dryRun": true,
			"resumeCount": 2, "requestedCount": 2, "resolvedCount": 2,
			"resumeIds": []string{"current-2", "current-1"}, "targets": []any{},
			"expectedAnalysis": map[string]any{"jobDescriptionId": "keyword-search:2:test", "promptVersion": 42},
		})
	}))
	defer server.Close()

	setResumeCLIConfig(t, server.URL, "dev")
	setCLIOutput(t, "json")
	cmd := newResumeAnalyzeCmd()
	cmd.SetOut(&bytes.Buffer{})
	cmd.SetErr(&bytes.Buffer{})
	cmd.SetArgs([]string{"--query", "CNC 销售", "--resume-id", "current-2", "--resume-id", "current-1", "--dry-run"})
	if err := cmd.Execute(); err != nil {
		t.Fatalf("repeatable exact resume IDs failed: %v", err)
	}
}

func TestResumeAnalyzeExactLiveRequiresConfirmation(t *testing.T) {
	cmd := newResumeAnalyzeCmd()
	cmd.SetArgs([]string{"--query", "CNC 销售", "--resume-id", "current-1"})
	err := cmd.Execute()
	if err == nil || !strings.Contains(err.Error(), "live exact analysis requires --yes") {
		t.Fatalf("unexpected confirmation error: %v", err)
	}
}

func TestResumeAnalyzeExactRejectsWaitWithDryRun(t *testing.T) {
	cmd := newResumeAnalyzeCmd()
	cmd.SetArgs([]string{"--query", "CNC 销售", "--resume-id", "current-1", "--dry-run", "--wait"})
	err := cmd.Execute()
	if err == nil || !strings.Contains(err.Error(), "--wait requires a live exact analysis") {
		t.Fatalf("unexpected dry-run wait error: %v", err)
	}
}

func TestResumeAnalyzeExactRejectsNonPositiveWaitDurationsBeforeDispatch(t *testing.T) {
	for _, testCase := range []struct {
		name string
		flag string
	}{
		{name: "wait timeout", flag: "--wait-timeout"},
		{name: "poll interval", flag: "--poll-interval"},
	} {
		t.Run(testCase.name, func(t *testing.T) {
			var requests atomic.Int32
			server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				requests.Add(1)
				_ = json.NewEncoder(w).Encode(map[string]any{
					"success": true, "mode": "exact", "taskId": "task-should-not-dispatch",
					"dispatchedAt": 1750000000001, "resumeCount": 1,
					"expectedAnalysis": map[string]any{"jobDescriptionId": "keyword-search:2:test", "promptVersion": 42},
				})
			}))
			defer server.Close()

			setResumeCLIConfig(t, server.URL, "dev")
			setCLIOutput(t, "json")
			cmd := newResumeAnalyzeCmd()
			cmd.SetOut(&bytes.Buffer{})
			cmd.SetErr(&bytes.Buffer{})
			cmd.SetArgs([]string{
				"--query", "CNC 销售",
				"--resume-id", "current-1",
				"--yes",
				"--wait",
				testCase.flag, "0s",
			})

			err := cmd.Execute()
			if err == nil || !strings.Contains(err.Error(), "wait-timeout and poll-interval must be positive") {
				t.Fatalf("unexpected duration validation error: %v", err)
			}
			if got := requests.Load(); got != 0 {
				t.Fatalf("expected invalid wait flags to prevent dispatch, got %d requests", got)
			}
		})
	}
}

func TestResumeAnalyzeExactWaitsUntilCompletedAndAllReady(t *testing.T) {
	pollCount := 0
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch {
		case r.Method == http.MethodPost && r.URL.Path == "/api/resumes/analyze":
			_ = json.NewEncoder(w).Encode(map[string]any{
				"success": true, "mode": "exact", "dryRun": false,
				"taskId": "task-exact-1", "dispatchedAt": 1750000000001, "reused": false,
				"resumeCount": 1, "requestedCount": 1, "resolvedCount": 1,
				"resumeIds": []string{"current-1"}, "targets": []any{},
				"expectedAnalysis": map[string]any{"jobDescriptionId": "keyword-search:2:test", "promptVersion": 42},
			})
		case r.Method == http.MethodGet && r.URL.Path == "/api/resumes/analysis-tasks/task-exact-1":
			pollCount++
			completed := pollCount >= 2
			status := "processing"
			state := "pending"
			ready := 0
			pending := 1
			if completed {
				status, state, ready, pending = "completed", "ready", 1, 0
			}
			_ = json.NewEncoder(w).Encode(map[string]any{
				"success": true,
				"task":    map[string]any{"_id": "task-exact-1", "status": status, "_creationTime": 1750000000000, "dispatchedAt": 1750000000001},
				"verification": map[string]any{
					"allReady": completed, "ready": ready, "pending": pending, "invalid": 0,
					"checkedAt": 1750000000100, "dispatchedAt": 1750000000001,
					"targets": []map[string]any{{"currentResumeId": "current-1", "state": state, "expectedAnalysisKey": "source:seek|locale:en|analysis:keyword-search:2:test", "expectedJobDescriptionId": "keyword-search:2:test", "expectedPromptVersion": 42, "reasons": []string{}}},
				},
			})
		default:
			t.Fatalf("unexpected request %s %s", r.Method, r.URL.Path)
		}
	}))
	defer server.Close()

	setResumeCLIConfig(t, server.URL, "dev")
	setCLIOutput(t, "json")
	cmd := newResumeAnalyzeCmd()
	var output bytes.Buffer
	cmd.SetOut(&output)
	cmd.SetErr(&output)
	cmd.SetArgs([]string{"--query", "CNC 销售", "--resume-id", "current-1", "--yes", "--wait", "--poll-interval", "1ms", "--wait-timeout", "1s"})
	if err := cmd.Execute(); err != nil {
		t.Fatalf("exact analysis wait failed: %v", err)
	}
	if pollCount != 2 {
		t.Fatalf("expected two exact task polls, got %d", pollCount)
	}
	payload := decodeCommandJSON(t, output)
	verification := payload["verification"].(map[string]any)
	if verification["allReady"] != true || verification["ready"] != float64(1) {
		t.Fatalf("missing final verification evidence: %+v", payload)
	}
}

func TestResumeAnalyzeExactWaitReturnsTaskFailure(t *testing.T) {
	server := newExactAnalyzeWaitServer(t, "failed", map[string]any{
		"allReady": false, "ready": 0, "pending": 0, "invalid": 1,
		"targets": []map[string]any{{"currentResumeId": "current-1", "state": "invalid", "reasons": []string{"task_failed"}}},
	})
	defer server.Close()

	err := executeExactAnalyzeWait(t, server.URL, 100*time.Millisecond)
	if err == nil || !strings.Contains(err.Error(), "task-exact-1") || !strings.Contains(err.Error(), "failed") {
		t.Fatalf("unexpected failed-task error: %v", err)
	}
}

func TestResumeAnalyzeExactWaitReturnsInvalidVerification(t *testing.T) {
	server := newExactAnalyzeWaitServer(t, "completed", map[string]any{
		"allReady": false, "ready": 0, "pending": 0, "invalid": 1,
		"targets": []map[string]any{{"currentResumeId": "current-1", "state": "invalid", "reasons": []string{"analysis_prompt_version_mismatch"}}},
	})
	defer server.Close()

	err := executeExactAnalyzeWait(t, server.URL, 100*time.Millisecond)
	if err == nil || !strings.Contains(err.Error(), "1 invalid") || !strings.Contains(err.Error(), "analysis_prompt_version_mismatch") {
		t.Fatalf("unexpected invalid-verification error: %v", err)
	}
}

func TestResumeAnalyzeExactWaitTimesOut(t *testing.T) {
	server := newExactAnalyzeWaitServer(t, "processing", map[string]any{
		"allReady": false, "ready": 0, "pending": 1, "invalid": 0,
		"targets": []map[string]any{{"currentResumeId": "current-1", "state": "pending", "reasons": []string{"task_processing"}}},
	})
	defer server.Close()

	err := executeExactAnalyzeWait(t, server.URL, 20*time.Millisecond)
	if err == nil || !strings.Contains(err.Error(), "task-exact-1") || !strings.Contains(err.Error(), "timed out") {
		t.Fatalf("unexpected timeout error: %v", err)
	}
}

func newExactAnalyzeWaitServer(t *testing.T, taskStatus string, verification map[string]any) *httptest.Server {
	t.Helper()
	return httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch {
		case r.Method == http.MethodPost && r.URL.Path == "/api/resumes/analyze":
			_ = json.NewEncoder(w).Encode(map[string]any{
				"success": true, "mode": "exact", "taskId": "task-exact-1", "dispatchedAt": 1750000000001,
				"resumeCount": 1, "requestedCount": 1, "resolvedCount": 1,
				"resumeIds": []string{"current-1"}, "targets": []any{},
				"expectedAnalysis": map[string]any{"jobDescriptionId": "keyword-search:2:test", "promptVersion": 42},
			})
		case r.Method == http.MethodGet && r.URL.Path == "/api/resumes/analysis-tasks/task-exact-1":
			verification["checkedAt"] = 1750000000100
			verification["dispatchedAt"] = 1750000000001
			for _, rawTarget := range verification["targets"].([]map[string]any) {
				rawTarget["expectedAnalysisKey"] = "source:seek|locale:en|analysis:keyword-search:2:test"
				rawTarget["expectedJobDescriptionId"] = "keyword-search:2:test"
				rawTarget["expectedPromptVersion"] = 42
			}
			_ = json.NewEncoder(w).Encode(map[string]any{
				"success":      true,
				"task":         map[string]any{"_id": "task-exact-1", "status": taskStatus, "_creationTime": 1750000000000, "dispatchedAt": 1750000000001},
				"verification": verification,
			})
		default:
			t.Fatalf("unexpected request %s %s", r.Method, r.URL.Path)
		}
	}))
}

func executeExactAnalyzeWait(t *testing.T, apiURL string, timeout time.Duration) error {
	t.Helper()
	setResumeCLIConfig(t, apiURL, "dev")
	setCLIOutput(t, "json")
	cmd := newResumeAnalyzeCmd()
	cmd.SetOut(&bytes.Buffer{})
	cmd.SetErr(&bytes.Buffer{})
	cmd.SetArgs([]string{"--query", "CNC 销售", "--resume-id", "current-1", "--yes", "--wait", "--poll-interval", "1ms", "--wait-timeout", timeout.String()})
	return cmd.Execute()
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
