package cmd

import (
	"bytes"
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/ptdevhk/trends/packages/cli/internal/client"
	"github.com/spf13/viper"
)

func TestValidateResumeMatchRequestRejectsConvexHybrid(t *testing.T) {
	persist := false
	err := validateResumeMatchRequest(client.ResumeMatchRequest{
		Source:  "convex",
		Persist: &persist,
		Mode:    "hybrid",
	})
	if err == nil {
		t.Fatal("expected convex hybrid validation error")
	}
	if !strings.Contains(err.Error(), "resume debug ai-score") {
		t.Fatalf("unexpected error: %v", err)
	}
}

func TestResumeDebugMatchesCommandWritesTable(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/api/resumes/matches" {
			t.Fatalf("unexpected path: %s", r.URL.Path)
		}
		if got := r.URL.Query().Get("jobDescriptionId"); got != "lathe-sales" {
			t.Fatalf("expected jobDescriptionId=lathe-sales, got %q", got)
		}
		_ = json.NewEncoder(w).Encode(client.ResumeMatchesResponse{
			Success: true,
			Results: []client.ResumeMatchResult{
				{ResumeID: "resume-1", Score: 91, ScoreSource: "ai", Recommendation: "strong_match", MatchedAt: "2026-03-17T00:00:00.000Z"},
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
	viper.Set("workspace", "dev")
	viper.Set("output", "table")

	cmd := newResumeDebugMatchesCmd()
	var output bytes.Buffer
	cmd.SetOut(&output)
	cmd.SetErr(&output)
	cmd.SetArgs([]string{"--job-description", "lathe-sales"})

	if err := cmd.Execute(); err != nil {
		t.Fatalf("resume debug matches command failed: %v", err)
	}
	text := output.String()
	if !strings.Contains(text, "resume-1") || !strings.Contains(text, "strong_match") {
		t.Fatalf("unexpected command output: %s", text)
	}
}

func TestResumeDebugAIScoreCommandWritesTable(t *testing.T) {
	originalOutput := viper.GetString("output")
	originalAPIURL := viper.GetString("api_url")
	originalWorkspace := viper.GetString("workspace")
	originalRunner := runLocalResumeAIScorer
	t.Cleanup(func() {
		viper.Set("output", originalOutput)
		viper.Set("api_url", originalAPIURL)
		viper.Set("workspace", originalWorkspace)
		runLocalResumeAIScorer = originalRunner
	})

	viper.Set("output", "table")
	viper.Set("api_url", "http://localhost:3000")
	viper.Set("workspace", "dev")
	runLocalResumeAIScorer = func(ctx context.Context, request localResumeAIScoreRequest) (*localResumeAIScoreResponse, error) {
		if request.Source != "convex" {
			t.Fatalf("expected convex source, got %q", request.Source)
		}
		return &localResumeAIScoreResponse{
			Success: true,
			Source:  "convex",
			Results: []localResumeAIScoreResult{
				{
					ResumeID:       "resume-1",
					Name:           "Alice",
					Location:       "Dongguan",
					RuleScore:      78,
					AIScore:        92,
					Recommendation: "strong_match",
				},
			},
		}, nil
	}

	cmd := newResumeDebugAIScoreCmd()
	var output bytes.Buffer
	cmd.SetOut(&output)
	cmd.SetErr(&output)
	cmd.SetArgs([]string{"--query", "CNC 销售", "--top-n", "1"})

	if err := cmd.Execute(); err != nil {
		t.Fatalf("resume debug ai-score command failed: %v", err)
	}
	text := output.String()
	if !strings.Contains(text, "Alice") || !strings.Contains(text, "92") {
		t.Fatalf("unexpected command output: %s", text)
	}
}

func TestResumeDebugWorkflowDatasetCommandWritesJSON(t *testing.T) {
	setResumeCLIConfig(t, "http://localhost:3000", "ops")
	setCLIOutput(t, "json")

	originalRunner := runWorkflowDatasetVerifier
	t.Cleanup(func() {
		runWorkflowDatasetVerifier = originalRunner
	})

	runWorkflowDatasetVerifier = func(ctx context.Context, request workflowDatasetVerificationRequest) (*workflowDatasetVerificationReport, error) {
		if request.APIBaseURL != "http://localhost:3000" {
			t.Fatalf("unexpected api base url: %q", request.APIBaseURL)
		}
		if request.Workspace != "ops" {
			t.Fatalf("unexpected workspace: %q", request.Workspace)
		}
		if request.Query != "CNC Sales" {
			t.Fatalf("unexpected query: %q", request.Query)
		}
		if request.Location != "Kuala Lumpur MY" {
			t.Fatalf("unexpected location: %q", request.Location)
		}
		if request.SourceKey != "seek" {
			t.Fatalf("unexpected source key: %q", request.SourceKey)
		}
		if request.ConvexURL != "http://127.0.0.1:3210" {
			t.Fatalf("unexpected convex url: %q", request.ConvexURL)
		}
		if request.JobDescriptionID != "seek-malaysia-sales" {
			t.Fatalf("unexpected job description: %q", request.JobDescriptionID)
		}
		if request.Limit != 250 || request.Top != 5 {
			t.Fatalf("unexpected scan config: limit=%d top=%d", request.Limit, request.Top)
		}

		return &workflowDatasetVerificationReport{
			Query:              request.Query,
			Location:           request.Location,
			SourceKey:          request.SourceKey,
			Workspace:          request.Workspace,
			TotalResumeCount:   192,
			ScannedResumeCount: 192,
			DatasetBySourceKey: []workflowDatasetSourceCountRow{
				{Key: "job5156", Count: 191},
				{Key: "seek", Count: 1},
			},
			QueryMatchCount: 6,
			VisibleCount:    1,
			VisibleBySourceKey: []workflowDatasetSourceCountRow{
				{Key: "seek", Count: 1},
			},
			VisibleResumes: []workflowDatasetVisibleResumeRow{
				{
					ResumeID:   "resume-1",
					SourceHost: "my.employer.seek.com",
					SourceKey:  "seek",
					Name:       "Yap Kae Wen",
					Location:   "Kuala Lumpur, Malaysia",
				},
			},
		}, nil
	}

	cmd := newResumeDebugWorkflowDatasetCmd()
	var output bytes.Buffer
	cmd.SetOut(&output)
	cmd.SetErr(&output)
	cmd.SetArgs([]string{
		"--query", "CNC Sales",
		"--location", "Kuala Lumpur MY",
		"--source-key", "seek",
		"--convex-url", "http://127.0.0.1:3210",
		"--job-description", "seek-malaysia-sales",
		"--limit", "250",
		"--top", "5",
	})

	if err := cmd.Execute(); err != nil {
		t.Fatalf("resume debug workflow-dataset command failed: %v", err)
	}

	payload := decodeCommandJSON(t, output)
	if payload["query"] != "CNC Sales" {
		t.Fatalf("unexpected query in output: %+v", payload)
	}
	if payload["visibleCount"] != float64(1) {
		t.Fatalf("unexpected visible count in output: %+v", payload)
	}
}

func TestResumeDebugWorkflowDatasetCommandWritesTable(t *testing.T) {
	setResumeCLIConfig(t, "http://localhost:3000", "dev")
	setCLIOutput(t, "table")

	originalRunner := runWorkflowDatasetVerifier
	t.Cleanup(func() {
		runWorkflowDatasetVerifier = originalRunner
	})

	primaryScore := 86
	runWorkflowDatasetVerifier = func(ctx context.Context, request workflowDatasetVerificationRequest) (*workflowDatasetVerificationReport, error) {
		return &workflowDatasetVerificationReport{
			Query:           request.Query,
			Workspace:       request.Workspace,
			QueryMatchCount: 6,
			VisibleCount:    1,
			DatasetBySourceKey: []workflowDatasetSourceCountRow{
				{Key: "job5156", Count: 191},
				{Key: "seek", Count: 1},
			},
			VisibleBySourceKey: []workflowDatasetSourceCountRow{
				{Key: "seek", Count: 1},
			},
			VisibleResumes: []workflowDatasetVisibleResumeRow{
				{
					ResumeID:         "resume-1",
					SourceHost:       "my.employer.seek.com",
					SourceKey:        "seek",
					Name:             "Yap Kae Wen",
					Location:         "Kuala Lumpur, Malaysia",
					PrimaryRuleScore: &primaryScore,
				},
			},
		}, nil
	}

	cmd := newResumeDebugWorkflowDatasetCmd()
	var output bytes.Buffer
	cmd.SetOut(&output)
	cmd.SetErr(&output)
	cmd.SetArgs([]string{"--query", "CNC Sales"})

	if err := cmd.Execute(); err != nil {
		t.Fatalf("resume debug workflow-dataset command failed: %v", err)
	}

	text := output.String()
	if !strings.Contains(text, "Query: CNC Sales | Workspace: dev | Query matches: 6 | Visible after filters: 1") {
		t.Fatalf("unexpected summary output: %s", text)
	}
	if !strings.Contains(text, "Yap Kae Wen") || !strings.Contains(text, "seek") || !strings.Contains(text, "86") {
		t.Fatalf("unexpected table output: %s", text)
	}
}

func TestResumeDebugClearDemoResumesCommandWritesJSON(t *testing.T) {
	setCLIOutput(t, "json")

	originalRunner := runWorkspaceDemoResumeCleanup
	t.Cleanup(func() {
		runWorkspaceDemoResumeCleanup = originalRunner
	})

	runWorkspaceDemoResumeCleanup = func(ctx context.Context, request workspaceDemoResumeCleanupRequest) (*workspaceDemoResumeCleanupResponse, error) {
		if request.ConvexURL != "https://demo.example.convex.cloud" {
			t.Fatalf("unexpected convex url: %q", request.ConvexURL)
		}

		return &workspaceDemoResumeCleanupResponse{
			Success:   true,
			ConvexURL: request.ConvexURL,
			Deleted:   1,
			Tag:       "workspace-demo",
		}, nil
	}

	cmd := newResumeDebugClearDemoResumesCmd()
	var output bytes.Buffer
	cmd.SetOut(&output)
	cmd.SetErr(&output)
	cmd.SetArgs([]string{"--convex-url", "https://demo.example.convex.cloud"})

	if err := cmd.Execute(); err != nil {
		t.Fatalf("resume debug clear-demo-resumes command failed: %v", err)
	}

	payload := decodeCommandJSON(t, output)
	if payload["deleted"] != float64(1) || payload["tag"] != "workspace-demo" {
		t.Fatalf("unexpected cleanup output: %+v", payload)
	}
}

func TestResumeDebugClearDemoResumesCommandWritesTable(t *testing.T) {
	setCLIOutput(t, "table")

	originalRunner := runWorkspaceDemoResumeCleanup
	t.Cleanup(func() {
		runWorkspaceDemoResumeCleanup = originalRunner
	})

	runWorkspaceDemoResumeCleanup = func(ctx context.Context, request workspaceDemoResumeCleanupRequest) (*workspaceDemoResumeCleanupResponse, error) {
		return &workspaceDemoResumeCleanupResponse{
			Success:   true,
			ConvexURL: "http://127.0.0.1:3210",
			Deleted:   2,
			Tag:       "workspace-demo",
		}, nil
	}

	cmd := newResumeDebugClearDemoResumesCmd()
	var output bytes.Buffer
	cmd.SetOut(&output)
	cmd.SetErr(&output)

	if err := cmd.Execute(); err != nil {
		t.Fatalf("resume debug clear-demo-resumes command failed: %v", err)
	}

	text := output.String()
	if !strings.Contains(text, "workspace-demo") || !strings.Contains(text, "2") || !strings.Contains(text, "127.0.0.1:3210") {
		t.Fatalf("unexpected cleanup table output: %s", text)
	}
}

func TestResumeDebugRescoreRejectsConvex(t *testing.T) {
	cmd := newResumeDebugRescoreCmd()
	cmd.SetArgs([]string{"--query", "CNC 销售", "--source", "convex"})

	err := cmd.Execute()
	if err == nil {
		t.Fatal("expected convex rescore error")
	}
	if !strings.Contains(err.Error(), "only supports --source sample") {
		t.Fatalf("unexpected error: %v", err)
	}
}
