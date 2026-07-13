package cmd

import (
	"bytes"
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
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
	var seenRequest localResumeAIScoreRequest
	runLocalResumeAIScorer = func(ctx context.Context, request localResumeAIScoreRequest) (*localResumeAIScoreResponse, error) {
		seenRequest = request
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
	cmd.SetArgs([]string{"--query", "CNC 销售", "--top-n", "100"})

	if err := cmd.Execute(); err != nil {
		t.Fatalf("resume debug ai-score command failed: %v", err)
	}
	if seenRequest.TopN != 100 {
		t.Fatalf("expected topN=100, got %d", seenRequest.TopN)
	}
	text := output.String()
	if !strings.Contains(text, "Alice") || !strings.Contains(text, "92") {
		t.Fatalf("unexpected command output: %s", text)
	}
}

func TestResumeDebugAIScoreCommandUsesDefaultTopN50(t *testing.T) {
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
	var seenRequest localResumeAIScoreRequest
	runLocalResumeAIScorer = func(ctx context.Context, request localResumeAIScoreRequest) (*localResumeAIScoreResponse, error) {
		seenRequest = request
		return &localResumeAIScoreResponse{
			Success: true,
			Source:  "convex",
			Results: []localResumeAIScoreResult{},
		}, nil
	}

	cmd := newResumeDebugAIScoreCmd()
	var output bytes.Buffer
	cmd.SetOut(&output)
	cmd.SetErr(&output)
	cmd.SetArgs([]string{"--query", "CNC 销售"})

	if err := cmd.Execute(); err != nil {
		t.Fatalf("resume debug ai-score command failed: %v", err)
	}
	if seenRequest.TopN != 50 {
		t.Fatalf("expected default topN=50, got %d", seenRequest.TopN)
	}
	if seenRequest.Limit != 50 {
		t.Fatalf("expected default limit=50, got %d", seenRequest.Limit)
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
		if !request.FieldCoverage {
			t.Fatal("expected field coverage to be enabled")
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
			FieldCoverageBySource: []workflowDatasetFieldCoverageRow{
				{
					SourceKey:     "seek",
					ResumeCount:   1,
					ProfileURLPct: 100,
				},
			},
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
		"--field-coverage",
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
			FieldCoverageBySource: []workflowDatasetFieldCoverageRow{
				{
					SourceKey:                 "job5156",
					ResumeCount:               191,
					ProfileURLPct:             75,
					ResumeIDPct:               90,
					WorkHistoryPct:            60,
					WorkHistoryDescriptionPct: 40,
					ProfileEducationPct:       20,
					JobIntentionPct:           50,
					ExpectedSalaryPct:         35,
					SelfIntroPct:              10,
					SkillsPct:                 5,
				},
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
	cmd.SetArgs([]string{"--query", "CNC Sales", "--field-coverage"})

	if err := cmd.Execute(); err != nil {
		t.Fatalf("resume debug workflow-dataset command failed: %v", err)
	}

	text := output.String()
	if !strings.Contains(text, "Query: CNC Sales | Workspace: dev | Query matches: 6 | Visible after filters: 1") {
		t.Fatalf("unexpected summary output: %s", text)
	}
	if !strings.Contains(text, "Field coverage by source:") || !strings.Contains(text, "75.0%") {
		t.Fatalf("unexpected coverage output: %s", text)
	}
	if !strings.Contains(text, "Yap Kae Wen") || !strings.Contains(text, "seek") || !strings.Contains(text, "86") {
		t.Fatalf("unexpected table output: %s", text)
	}
}

func TestResumeDebugDiagnosticsCommandWritesTable(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/api/resumes/diagnostics" {
			t.Fatalf("unexpected path: %s", r.URL.Path)
		}
		if r.Method != http.MethodGet {
			t.Fatalf("unexpected method: %s", r.Method)
		}
		if got := r.URL.Query().Get("archived"); got != "true" {
			t.Fatalf("expected archived=true, got %q", got)
		}
		if got := r.URL.Query().Get("limit"); got != "5" {
			t.Fatalf("expected limit=5, got %q", got)
		}
		sourceKeys := r.URL.Query()["sourceKey"]
		if len(sourceKeys) != 2 || sourceKeys[0] != "51job-manual" || sourceKeys[1] != "seek" {
			t.Fatalf("unexpected source keys: %+v", sourceKeys)
		}

		_ = json.NewEncoder(w).Encode(client.ResumeDiagnosticsResponse{
			Success: true,
			Data: []client.ResumeDiagnosticsItem{
				{
					ResumeID:     "resume-1",
					ExternalID:   "external-1",
					Name:         "张三",
					JobIntention: "销售工程师",
					Location:     "东莞",
					Source:       "51job-manual",
					SourceKey:    "51job-manual",
					IsArchived:   true,
					ArchivedAt:   1700000000000,
				},
			},
			Summary: client.ResumeDiagnosticsSummary{
				Archived: true,
				Returned: 1,
				Limit:    5,
			},
		})
	}))
	defer server.Close()

	setResumeCLIConfig(t, server.URL, "dev")
	setCLIOutput(t, "table")

	cmd := newResumeDebugDiagnosticsCmd()
	var output bytes.Buffer
	cmd.SetOut(&output)
	cmd.SetErr(&output)
	cmd.SetArgs([]string{
		"--archived",
		"--source-key", "51job-manual",
		"--source-key", "seek",
		"--limit", "5",
	})

	if err := cmd.Execute(); err != nil {
		t.Fatalf("resume debug diagnostics command failed: %v", err)
	}

	text := output.String()
	if !strings.Contains(text, "resume-1") || !strings.Contains(text, "51job-manual") || !strings.Contains(text, "archived=true") {
		t.Fatalf("unexpected diagnostics output: %s", text)
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

func TestParseResumeAnalysisClearBatchParsesConvexObjectLiteral(t *testing.T) {
	result, err := parseResumeAnalysisClearBatch(`{ cleared: 12, hasMore: true, cursor: "cursor-1" }`)
	if err != nil {
		t.Fatalf("parseResumeAnalysisClearBatch returned error: %v", err)
	}
	if result.Cleared != 12 || !result.HasMore {
		t.Fatalf("unexpected batch: %+v", result)
	}
	if result.Cursor == nil || *result.Cursor != "cursor-1" {
		t.Fatalf("unexpected cursor: %+v", result.Cursor)
	}
}

func TestRunResumeAnalysisClearPaginatesFullDataset(t *testing.T) {
	callCount := 0
	var gotArgs [][]string

	response, err := runResumeAnalysisClear(context.Background(), resumeAnalysisClearRequest{
		JobDescriptionID: "lathe-sales",
		BatchSize:        40,
	}, func(ctx context.Context, migration string, extraArgs ...string) (string, error) {
		if migration != "resumes:clearAnalyses" {
			t.Fatalf("unexpected migration: %s", migration)
		}
		gotArgs = append(gotArgs, append([]string(nil), extraArgs...))
		callCount += 1
		switch callCount {
		case 1:
			return `{ cleared: 18, hasMore: true, cursor: "cursor-1" }`, nil
		case 2:
			return `{"cleared":7,"hasMore":false,"cursor":null}`, nil
		default:
			t.Fatalf("unexpected extra invocation %d", callCount)
			return "", nil
		}
	})
	if err != nil {
		t.Fatalf("runResumeAnalysisClear returned error: %v", err)
	}

	if response.Cleared != 25 || response.Batches != 2 || response.Targeted {
		t.Fatalf("unexpected response: %+v", response)
	}
	if response.JobDescriptionID != "lathe-sales" {
		t.Fatalf("unexpected job description id: %+v", response)
	}

	wantArgs := []string{
		`{"batchSize":40,"jobDescriptionId":"lathe-sales"}`,
		`{"batchSize":40,"cursor":"cursor-1","jobDescriptionId":"lathe-sales"}`,
	}
	if len(gotArgs) != len(wantArgs) {
		t.Fatalf("unexpected runner args: got %v want %v", gotArgs, wantArgs)
	}
	for index := range wantArgs {
		if len(gotArgs[index]) != 1 || gotArgs[index][0] != wantArgs[index] {
			t.Fatalf("unexpected runner args: got %v want %v", gotArgs, wantArgs)
		}
	}
}

func TestResumeDebugClearAnalysesCommandWritesJSON(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/api/resumes/clear-analyses" {
			t.Fatalf("unexpected path: %s", r.URL.Path)
		}
		if r.Method != http.MethodPost {
			t.Fatalf("unexpected method: %s", r.Method)
		}
		_ = json.NewEncoder(w).Encode(client.ClearAnalysesAPIResponse{
			Success:          true,
			Cleared:          2,
			Batches:          1,
			Targeted:         true,
			JobDescriptionID: "lathe-sales",
		})
	}))
	defer server.Close()

	setResumeCLIConfig(t, server.URL, "dev")
	setCLIOutput(t, "json")

	cmd := newResumeDebugClearAnalysesCmd()
	var output bytes.Buffer
	cmd.SetOut(&output)
	cmd.SetErr(&output)
	cmd.SetArgs([]string{
		"--job-description", "lathe-sales",
		"--resume-id", "resume-1",
		"--resume-id", " resume-2 ",
		"--resume-id", "resume-1",
	})

	if err := cmd.Execute(); err != nil {
		t.Fatalf("resume debug clear-analyses command failed: %v", err)
	}

	payload := decodeCommandJSON(t, output)
	if payload["cleared"] != float64(2) || payload["targeted"] != true {
		t.Fatalf("unexpected clear-analyses output: %+v", payload)
	}
}

func TestResumeDebugClearAnalysesDryRunCommandWritesJSON(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/api/resumes/clear-analyses" {
			t.Fatalf("unexpected path: %s", r.URL.Path)
		}
		var body map[string]any
		if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
			t.Fatalf("failed to decode body: %v", err)
		}
		if body["dryRun"] != true {
			t.Fatalf("expected dryRun=true, got %v", body["dryRun"])
		}
		_ = json.NewEncoder(w).Encode(client.ClearAnalysesAPIResponse{
			Success:    true,
			DryRun:     true,
			Cleared:    0,
			WouldClear: 15,
			Targeted:   false,
		})
	}))
	defer server.Close()

	setResumeCLIConfig(t, server.URL, "dev")
	setCLIOutput(t, "json")

	cmd := newResumeDebugClearAnalysesCmd()
	var output bytes.Buffer
	cmd.SetOut(&output)
	cmd.SetErr(&output)
	cmd.SetArgs([]string{"--dry-run"})

	if err := cmd.Execute(); err != nil {
		t.Fatalf("resume debug clear-analyses --dry-run command failed: %v", err)
	}

	payload := decodeCommandJSON(t, output)
	if payload["wouldClear"] != float64(15) || payload["dryRun"] != true {
		t.Fatalf("unexpected clear-analyses dry-run output: %+v", payload)
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

func TestResumeDebugHardResetReingestRequiresConfirmation(t *testing.T) {
	cmd := newResumeDebugHardResetReingestCmd()
	cmd.SetArgs([]string{})

	err := cmd.Execute()
	if err == nil {
		t.Fatal("expected confirmation-required error")
	}
	if !strings.Contains(err.Error(), "destructive") {
		t.Fatalf("unexpected error: %v", err)
	}
}

func TestResumeDebugExactReingestRequiresConfirmation(t *testing.T) {
	cmd := newResumeDebugExactReingestCmd()
	cmd.SetArgs([]string{"--resume-id", "current-1"})

	err := cmd.Execute()
	if err == nil {
		t.Fatal("expected confirmation-required error")
	}
	if !strings.Contains(err.Error(), "--yes") || !strings.Contains(err.Error(), "--dry-run") {
		t.Fatalf("unexpected error: %v", err)
	}
}

func TestResumeDebugExactReingestDryRunPreservesRepeatableResumeIDOrder(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/api/resumes/exact-reingest" {
			t.Fatalf("unexpected path: %s", r.URL.Path)
		}
		var request client.ExactReingestRequest
		if err := json.NewDecoder(r.Body).Decode(&request); err != nil {
			t.Fatalf("failed to decode body: %v", err)
		}
		if !request.DryRun {
			t.Fatal("expected dryRun=true")
		}
		if len(request.Targets) != 2 || request.Targets[0].CurrentResumeID != "current-2" || request.Targets[1].CurrentResumeID != "current-1" {
			t.Fatalf("unexpected target order: %+v", request.Targets)
		}

		_ = json.NewEncoder(w).Encode(client.ExactReingestResponse{
			Success:               true,
			DryRun:                true,
			ManifestVersion:       1,
			ExpectedSkillsVersion: 2,
			Requested:             2,
			Resolved:              2,
			ResumeIDs:             []string{"current-2", "current-1"},
			Targets: []client.ExactReingestResolvedTarget{
				{CurrentResumeID: "current-2", CanonicalIdentityKey: "externalId:external-2"},
				{CurrentResumeID: "current-1", CanonicalIdentityKey: "externalId:external-1"},
			},
		})
	}))
	defer server.Close()

	setResumeCLIConfig(t, server.URL, "dev")
	setCLIOutput(t, "json")

	cmd := newResumeDebugExactReingestCmd()
	var output bytes.Buffer
	cmd.SetOut(&output)
	cmd.SetErr(&output)
	cmd.SetArgs([]string{
		"--resume-id", "current-2",
		"--resume-id", "current-1",
		"--dry-run",
	})

	if err := cmd.Execute(); err != nil {
		t.Fatalf("resume debug reingest --dry-run failed: %v", err)
	}
	payload := decodeCommandJSON(t, output)
	if payload["requested"] != float64(2) || payload["resolved"] != float64(2) || payload["dryRun"] != true {
		t.Fatalf("unexpected output: %+v", payload)
	}
}

func TestResumeDebugExactReingestReadsOrderedManifestAndSchedulesWithYes(t *testing.T) {
	manifestPath := filepath.Join(t.TempDir(), "cohort.json")
	manifest := `{
  "version": 1,
  "targets": [
    {"referenceResumeId":"old-2","profileResumeId":"100002","profileUrl":"https://example.com/2"},
    {"referenceResumeId":"old-1","externalId":"external-1"},
    {"referenceResumeId":"old-2-duplicate","currentResumeId":"current-2"}
  ]
}`
	if err := os.WriteFile(manifestPath, []byte(manifest), 0o600); err != nil {
		t.Fatalf("write manifest: %v", err)
	}

	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		var request client.ExactReingestRequest
		if err := json.NewDecoder(r.Body).Decode(&request); err != nil {
			t.Fatalf("failed to decode body: %v", err)
		}
		if request.DryRun {
			t.Fatal("expected live request")
		}
		if got := []string{
			request.Targets[0].ReferenceResumeID,
			request.Targets[1].ReferenceResumeID,
			request.Targets[2].ReferenceResumeID,
		}; strings.Join(got, ",") != "old-2,old-1,old-2-duplicate" {
			t.Fatalf("manifest order was not preserved: %+v", got)
		}

		_ = json.NewEncoder(w).Encode(client.ExactReingestResponse{
			Success:               true,
			ManifestVersion:       1,
			ExpectedSkillsVersion: 2,
			Requested:             3,
			Resolved:              2,
			Scheduled:             2,
			Batches:               1,
			DispatchedAt:          1_750_000_000_000,
			ResumeIDs:             []string{"current-2", "current-1"},
			Targets: []client.ExactReingestResolvedTarget{
				{ReferenceResumeID: "old-2", CurrentResumeID: "current-2", CanonicalIdentityKey: "profileUrl:example.com/2"},
				{ReferenceResumeID: "old-1", CurrentResumeID: "current-1", CanonicalIdentityKey: "externalId:external-1"},
				{ReferenceResumeID: "old-2-duplicate", CurrentResumeID: "current-2", CanonicalIdentityKey: "profileUrl:example.com/2"},
			},
		})
	}))
	defer server.Close()

	setResumeCLIConfig(t, server.URL, "dev")
	setCLIOutput(t, "table")

	cmd := newResumeDebugExactReingestCmd()
	var output bytes.Buffer
	cmd.SetOut(&output)
	cmd.SetErr(&output)
	cmd.SetArgs([]string{"--manifest", manifestPath, "--yes"})

	if err := cmd.Execute(); err != nil {
		t.Fatalf("resume debug reingest --manifest --yes failed: %v", err)
	}
	text := output.String()
	if !strings.Contains(text, "old-2") || !strings.Contains(text, "current-2") || !strings.Contains(text, "old-1") {
		t.Fatalf("unexpected table output: %s", text)
	}
}

func TestResumeDebugExactReingestReturnsAPIConflictAsCommandFailure(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusBadRequest)
		_ = json.NewEncoder(w).Encode(map[string]any{
			"success": false,
			"error":   "Exact re-ingest target 1 selectors conflict",
		})
	}))
	defer server.Close()

	setResumeCLIConfig(t, server.URL, "dev")
	cmd := newResumeDebugExactReingestCmd()
	cmd.SetArgs([]string{"--resume-id", "current-1", "--dry-run"})

	err := cmd.Execute()
	if err == nil {
		t.Fatal("expected API conflict to fail the command")
	}
	if !strings.Contains(err.Error(), "selectors conflict") {
		t.Fatalf("unexpected error: %v", err)
	}
}

func TestResumeDebugExactReingestWaitsForPersistedTargetReadiness(t *testing.T) {
	readinessCalls := 0
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch r.URL.Path {
		case "/api/resumes/exact-reingest":
			_ = json.NewEncoder(w).Encode(client.ExactReingestResponse{
				Success:               true,
				ManifestVersion:       1,
				ExpectedSkillsVersion: 3,
				Requested:             1,
				Resolved:              1,
				Scheduled:             1,
				Batches:               1,
				DispatchedAt:          1_750_000_000_000,
				ResumeIDs:             []string{"current-1"},
				Targets: []client.ExactReingestResolvedTarget{
					{CurrentResumeID: "current-1", ExternalID: "external-1", Source: "51job", CanonicalIdentityKey: "externalId:external-1"},
				},
			})
		case "/api/resumes/exact-reingest/readiness":
			readinessCalls++
			var request client.ExactReingestReadinessRequest
			if err := json.NewDecoder(r.Body).Decode(&request); err != nil {
				t.Fatalf("decode readiness request: %v", err)
			}
			if request.DispatchedAt != 1_750_000_000_000 || request.ExpectedSkillsVersion != 3 {
				t.Fatalf("unexpected readiness request: %+v", request)
			}
			allReady := readinessCalls >= 2
			state := "pending"
			if allReady {
				state = "ready"
			}
			_ = json.NewEncoder(w).Encode(client.ExactReingestReadinessResponse{
				Success:               true,
				AllReady:              allReady,
				Ready:                 map[bool]int{true: 1, false: 0}[allReady],
				Pending:               map[bool]int{true: 0, false: 1}[allReady],
				CheckedAt:             1_750_000_000_100,
				DispatchedAt:          request.DispatchedAt,
				ExpectedSkillsVersion: request.ExpectedSkillsVersion,
				Targets: []client.ExactReingestReadinessTarget{
					{CurrentResumeID: "current-1", State: state},
				},
			})
		default:
			t.Fatalf("unexpected path: %s", r.URL.Path)
		}
	}))
	defer server.Close()

	setResumeCLIConfig(t, server.URL, "dev")
	setCLIOutput(t, "json")
	cmd := newResumeDebugExactReingestCmd()
	var output bytes.Buffer
	cmd.SetOut(&output)
	cmd.SetErr(&output)
	cmd.SetArgs([]string{
		"--resume-id", "current-1",
		"--yes",
		"--wait",
		"--wait-timeout", "1s",
		"--poll-interval", "1ms",
	})

	if err := cmd.Execute(); err != nil {
		t.Fatalf("resume debug reingest --wait failed: %v", err)
	}
	if readinessCalls != 2 {
		t.Fatalf("expected two readiness polls, got %d", readinessCalls)
	}
	payload := decodeCommandJSON(t, output)
	readiness, ok := payload["readiness"].(map[string]any)
	if !ok || readiness["allReady"] != true {
		t.Fatalf("unexpected readiness output: %+v", payload)
	}
}

func TestResumeDebugHardResetReingestDryRunWritesTable(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/api/resumes/hard-reset-reingest" {
			t.Fatalf("unexpected path: %s", r.URL.Path)
		}
		var body map[string]any
		if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
			t.Fatalf("failed to decode body: %v", err)
		}
		if body["dryRun"] != true {
			t.Fatalf("expected dryRun=true, got %v", body["dryRun"])
		}
		_ = json.NewEncoder(w).Encode(client.HardResetReingestResponse{
			Success:    true,
			DryRun:     true,
			WouldClear: 42,
			Phase:      "dry_run",
		})
	}))
	defer server.Close()

	setResumeCLIConfig(t, server.URL, "dev")

	cmd := newResumeDebugHardResetReingestCmd()
	var output bytes.Buffer
	cmd.SetOut(&output)
	cmd.SetErr(&output)
	cmd.SetArgs([]string{"--dry-run"})

	if err := cmd.Execute(); err != nil {
		t.Fatalf("resume debug hard-reset-reingest --dry-run command failed: %v", err)
	}
	text := output.String()
	if !strings.Contains(text, "42") || !strings.Contains(text, "dry_run") {
		t.Fatalf("unexpected hard-reset-reingest dry-run output: %s", text)
	}
}

func TestResumeDebugHardResetReingestWithYesWritesTable(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/api/resumes/hard-reset-reingest" {
			t.Fatalf("unexpected path: %s", r.URL.Path)
		}
		_ = json.NewEncoder(w).Encode(client.HardResetReingestResponse{
			Success:   true,
			Cleared:   30,
			Scheduled: 30,
			Batches:   1,
			Phase:     "scheduled",
		})
	}))
	defer server.Close()

	setResumeCLIConfig(t, server.URL, "dev")

	cmd := newResumeDebugHardResetReingestCmd()
	var output bytes.Buffer
	cmd.SetOut(&output)
	cmd.SetErr(&output)
	cmd.SetArgs([]string{"--yes"})

	if err := cmd.Execute(); err != nil {
		t.Fatalf("resume debug hard-reset-reingest --yes command failed: %v", err)
	}
	text := output.String()
	if !strings.Contains(text, "30") || !strings.Contains(text, "scheduled") {
		t.Fatalf("unexpected hard-reset-reingest --yes output: %s", text)
	}
}

func TestResumeDebugResetDatabaseRequiresConfirmation(t *testing.T) {
	cmd := newResumeDebugResetDatabaseCmd()
	cmd.SetArgs([]string{})

	err := cmd.Execute()
	if err == nil {
		t.Fatal("expected confirmation-required error")
	}
	if !strings.Contains(err.Error(), "destructive") {
		t.Fatalf("unexpected error: %v", err)
	}
}

func TestResumeDebugAnalysisTasksCommandWritesJSON(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/api/resumes/analysis-tasks" {
			t.Fatalf("unexpected path: %s", r.URL.Path)
		}
		_ = json.NewEncoder(w).Encode(client.AnalysisTasksResponse{
			Success: true,
			Tasks: []client.AnalysisTask{
				{
					ID:        "task-1",
					Status:    "completed",
					CreatedAt: 1710000000000,
					Config: &client.AnalysisTaskConfig{
						JobDescriptionTitle: "CNC Sales",
						Keywords:            []string{"CNC"},
						Location:            "Dongguan",
						ResumeCount:         25,
					},
					Results: &client.AnalysisTaskResults{
						Analyzed:       25,
						AvgScore:       82.5,
						HighScoreCount: 5,
					},
				},
				{
					ID:     "task-2",
					Status: "running",
					Config: &client.AnalysisTaskConfig{
						Keywords:    []string{"Sales"},
						ResumeCount: 10,
					},
					Progress: &client.AnalysisTaskProgress{
						Current: 5,
						Total:   10,
					},
				},
				{
					ID:     "task-3",
					Status: "pending",
					Config: nil,
				},
			},
		})
	}))
	defer server.Close()

	setResumeCLIConfig(t, server.URL, "dev")
	setCLIOutput(t, "json")

	cmd := newResumeDebugAnalysisTasksCmd()
	var output bytes.Buffer
	cmd.SetOut(&output)
	cmd.SetErr(&output)

	if err := cmd.Execute(); err != nil {
		t.Fatalf("resume debug analysis-tasks command failed: %v", err)
	}

	payload := decodeCommandJSON(t, output)
	tasks, ok := payload["tasks"].([]any)
	if !ok || len(tasks) != 3 {
		t.Fatalf("unexpected tasks in output: %+v", payload)
	}
}

func TestResumeDebugAnalysisTasksCommandAcceptsFractionalCreationTime(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/api/resumes/analysis-tasks" {
			t.Fatalf("unexpected path: %s", r.URL.Path)
		}
		_ = json.NewEncoder(w).Encode(map[string]any{
			"success": true,
			"tasks": []any{
				map[string]any{
					"_id":           "task-1",
					"status":        "completed",
					"_creationTime": 1776146211690.003,
					"config":        map[string]any{"jobDescriptionTitle": "CNC Sales"},
					"results":       map[string]any{"analyzed": 3, "avgScore": 81.5, "highScoreCount": 1},
					"lastStatus":    "completed",
					"error":         "",
				},
			},
		})
	}))
	defer server.Close()

	setResumeCLIConfig(t, server.URL, "dev")
	setCLIOutput(t, "json")

	cmd := newResumeDebugAnalysisTasksCmd()
	var output bytes.Buffer
	cmd.SetOut(&output)
	cmd.SetErr(&output)

	if err := cmd.Execute(); err != nil {
		t.Fatalf("resume debug analysis-tasks command failed: %v", err)
	}

	text := output.String()
	if !strings.Contains(text, `"task-1"`) || !strings.Contains(text, `"completed"`) {
		t.Fatalf("unexpected analysis-tasks json output: %s", text)
	}
}

func TestResumeDebugAnalysisTasksCommandWritesTable(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/api/resumes/analysis-tasks" {
			t.Fatalf("unexpected path: %s", r.URL.Path)
		}
		_ = json.NewEncoder(w).Encode(client.AnalysisTasksResponse{
			Success: true,
			Tasks: []client.AnalysisTask{
				{
					ID:     "task-1",
					Status: "completed",
					Config: &client.AnalysisTaskConfig{
						JobDescriptionTitle: "CNC Sales",
						Location:            "Dongguan",
						ResumeCount:         25,
					},
					Results: &client.AnalysisTaskResults{
						Analyzed:       25,
						AvgScore:       82.5,
						HighScoreCount: 5,
					},
				},
				{
					ID:     "task-2",
					Status: "running",
					Config: &client.AnalysisTaskConfig{
						Keywords:    []string{"Sales"},
						ResumeCount: 10,
					},
					Progress: &client.AnalysisTaskProgress{
						Current: 5,
						Total:   10,
					},
				},
				{
					ID:     "task-3",
					Status: "pending",
					Config: nil,
				},
			},
		})
	}))
	defer server.Close()

	setResumeCLIConfig(t, server.URL, "dev")
	setCLIOutput(t, "table")

	cmd := newResumeDebugAnalysisTasksCmd()
	var output bytes.Buffer
	cmd.SetOut(&output)
	cmd.SetErr(&output)

	if err := cmd.Execute(); err != nil {
		t.Fatalf("resume debug analysis-tasks command failed: %v", err)
	}

	text := output.String()
	if !strings.Contains(text, "task-1") || !strings.Contains(text, "CNC Sales") {
		t.Fatalf("unexpected analysis-tasks table output: %s", text)
	}
	if !strings.Contains(text, "task-2") || !strings.Contains(text, "running") || !strings.Contains(text, "Sales") {
		t.Fatalf("unexpected analysis-tasks table output (task-2): %s", text)
	}
}

func TestResumeDebugResetDatabaseDryRunWritesTable(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/api/resumes/reset-database" {
			t.Fatalf("unexpected path: %s", r.URL.Path)
		}
		_ = json.NewEncoder(w).Encode(client.ResetDatabaseResponse{
			Success: true,
			DryRun:  true,
			Count:   100,
			WouldDelete: map[string]int{
				"resumes":            80,
				"ai_tagging_results": 20,
			},
		})
	}))
	defer server.Close()

	setResumeCLIConfig(t, server.URL, "dev")

	cmd := newResumeDebugResetDatabaseCmd()
	var output bytes.Buffer
	cmd.SetOut(&output)
	cmd.SetErr(&output)
	cmd.SetArgs([]string{"--dry-run"})

	if err := cmd.Execute(); err != nil {
		t.Fatalf("resume debug reset-database --dry-run command failed: %v", err)
	}
	text := output.String()
	if !strings.Contains(text, "100") {
		t.Fatalf("unexpected reset-database dry-run output: %s", text)
	}
}
