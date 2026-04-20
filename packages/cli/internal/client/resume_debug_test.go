package client

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
)

func TestResumeDebugClientEndpoints(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch {
		case r.Method == http.MethodGet && r.URL.Path == "/api/resumes/matches":
			if got := r.URL.Query().Get("jobDescriptionId"); got != "lathe-sales" {
				t.Fatalf("expected jobDescriptionId=lathe-sales, got %q", got)
			}
			_ = json.NewEncoder(w).Encode(ResumeMatchesResponse{
				Success: true,
				Results: []ResumeMatchResult{
					{ResumeID: "resume-1", Score: 88, ScoreSource: "ai", Recommendation: "match", MatchedAt: "2026-03-17T00:00:00.000Z"},
				},
			})
		case r.Method == http.MethodGet && r.URL.Path == "/api/resumes/match-runs":
			if got := r.URL.Query().Get("limit"); got != "5" {
				t.Fatalf("expected limit=5, got %q", got)
			}
			_ = json.NewEncoder(w).Encode(MatchRunsResponse{
				Success: true,
				Runs: []MatchRun{
					{ID: "run-1", Mode: "hybrid", Status: "completed", TotalCount: 10, ProcessedCount: 10, FailedCount: 0},
				},
			})
		case r.Method == http.MethodDelete && r.URL.Path == "/api/resumes/matches":
			if got := r.URL.Query().Get("jobDescriptionId"); got != "lathe-sales" {
				t.Fatalf("expected jobDescriptionId=lathe-sales, got %q", got)
			}
			_ = json.NewEncoder(w).Encode(ClearResumeMatchesResponse{
				Success:          true,
				Deleted:          3,
				JobDescriptionID: "lathe-sales",
			})
		case r.Method == http.MethodPost && r.URL.Path == "/api/resumes/matches/rescore":
			var payload ResumeRescoreRequest
			if err := json.NewDecoder(r.Body).Decode(&payload); err != nil {
				t.Fatalf("failed to decode request body: %v", err)
			}
			if payload.Source != "sample" {
				t.Fatalf("expected sample source, got %q", payload.Source)
			}
			if payload.Persist == nil || !*payload.Persist {
				t.Fatalf("expected persist=true, got %+v", payload.Persist)
			}
			_ = json.NewEncoder(w).Encode(ResumeMatchResponse{
				Success: true,
				Mode:    "rules_only",
				Results: []ResumeMatchResult{{ResumeID: "resume-1", Score: 75, Recommendation: "potential"}},
				Stats:   MatchStats{Processed: 1, Matched: 1, AvgScore: 75},
			})
		case r.Method == http.MethodGet && r.URL.Path == "/api/resumes/skills-version":
			_ = json.NewEncoder(w).Encode(ResumeSkillsVersionResponse{
				Success: true,
				Version: 42,
			})
		case r.Method == http.MethodPost && r.URL.Path == "/api/resumes/trigger-reingest":
			var payload map[string]int
			if err := json.NewDecoder(r.Body).Decode(&payload); err != nil {
				t.Fatalf("failed to decode trigger-reingest body: %v", err)
			}
			if got := payload["limit"]; got != 150 {
				t.Fatalf("expected limit=150, got %d", got)
			}
			_ = json.NewEncoder(w).Encode(ResumeTriggerReingestResponse{
				Success:        true,
				Scheduled:      150,
				Batches:        3,
				CurrentVersion: 9,
				HasMore:        true,
			})
		case r.Method == http.MethodGet && r.URL.Path == "/api/resumes/diagnostics":
			if got := r.URL.Query().Get("archived"); got != "true" {
				t.Fatalf("expected archived=true, got %q", got)
			}
			if got := r.URL.Query().Get("limit"); got != "10" {
				t.Fatalf("expected limit=10, got %q", got)
			}
			sourceKeys := r.URL.Query()["sourceKey"]
			if len(sourceKeys) != 2 || sourceKeys[0] != "51job-manual" || sourceKeys[1] != "seek" {
				t.Fatalf("unexpected source keys: %+v", sourceKeys)
			}
			_ = json.NewEncoder(w).Encode(ResumeDiagnosticsResponse{
				Success: true,
				Data: []ResumeDiagnosticsItem{
					{
						ResumeID:    "resume-1",
						ExternalID:  "external-1",
						Name:        "张三",
						JobIntention:"销售工程师",
						Location:    "东莞",
						Source:      "51job-manual",
						SourceKey:   "51job-manual",
						IsArchived:  true,
						ArchivedAt:  1700000000000,
					},
				},
				Summary: ResumeDiagnosticsSummary{
					Archived: true,
					Returned: 1,
					Limit:    10,
				},
			})
		default:
			t.Fatalf("unexpected request %s %s", r.Method, r.URL.Path)
		}
	}))
	defer server.Close()

	c := New(server.URL, server.URL, "dev")
	c.HTTP = server.Client()

	matches, err := c.ListResumeMatches(context.Background(), "", "lathe-sales")
	if err != nil {
		t.Fatalf("ListResumeMatches returned error: %v", err)
	}
	if len(matches.Results) != 1 || matches.Results[0].ResumeID != "resume-1" {
		t.Fatalf("unexpected matches response: %+v", matches)
	}

	runs, err := c.ListResumeMatchRuns(context.Background(), MatchRunsQuery{Limit: 5})
	if err != nil {
		t.Fatalf("ListResumeMatchRuns returned error: %v", err)
	}
	if len(runs.Runs) != 1 || runs.Runs[0].ID != "run-1" {
		t.Fatalf("unexpected match-runs response: %+v", runs)
	}

	cleared, err := c.ClearResumeMatches(context.Background(), "lathe-sales")
	if err != nil {
		t.Fatalf("ClearResumeMatches returned error: %v", err)
	}
	if cleared.Deleted != 3 {
		t.Fatalf("unexpected clear response: %+v", cleared)
	}

	persist := true
	rescored, err := c.RescoreResumeMatches(context.Background(), ResumeRescoreRequest{
		Source:  "sample",
		Persist: &persist,
		Keywords: []string{
			"CNC",
			"销售",
		},
	})
	if err != nil {
		t.Fatalf("RescoreResumeMatches returned error: %v", err)
	}
	if len(rescored.Results) != 1 || rescored.Results[0].Score != 75 {
		t.Fatalf("unexpected rescore response: %+v", rescored)
	}

	version, err := c.GetResumeSkillsVersion(context.Background())
	if err != nil {
		t.Fatalf("GetResumeSkillsVersion returned error: %v", err)
	}
	if version.Version != 42 {
		t.Fatalf("unexpected version response: %+v", version)
	}

	reingest, err := c.TriggerResumeReingest(context.Background(), 150)
	if err != nil {
		t.Fatalf("TriggerResumeReingest returned error: %v", err)
	}
	if reingest.Scheduled != 150 || !reingest.HasMore {
		t.Fatalf("unexpected reingest response: %+v", reingest)
	}

	diagnostics, err := c.ListResumeDiagnostics(context.Background(), ResumeDiagnosticsQuery{
		Archived:   true,
		SourceKeys: []string{"51job-manual", "seek"},
		Limit:      10,
	})
	if err != nil {
		t.Fatalf("ListResumeDiagnostics returned error: %v", err)
	}
	if diagnostics.Summary.Returned != 1 || len(diagnostics.Data) != 1 {
		t.Fatalf("unexpected diagnostics response: %+v", diagnostics)
	}
}
