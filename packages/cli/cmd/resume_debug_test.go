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
