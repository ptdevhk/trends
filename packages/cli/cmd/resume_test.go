package cmd

import (
	"bytes"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/ptdevhk/trends/packages/cli/internal/client"
	"github.com/spf13/viper"
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
	viper.Set("output", "table")

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
