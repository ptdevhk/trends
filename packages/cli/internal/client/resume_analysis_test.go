package client

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
)

func TestGetAnalysisTaskEscapesTaskIDAndPreservesWorkspaceHeader(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodGet {
			t.Fatalf("expected GET, got %s", r.Method)
		}
		if got := r.URL.EscapedPath(); got != "/api/resumes/analysis-tasks/task%2Fwith%20space" {
			t.Fatalf("unexpected escaped path: %s", got)
		}
		if got := r.Header.Get("X-Workspace-Slug"); got != "hr" {
			t.Fatalf("expected workspace header hr, got %q", got)
		}

		_ = json.NewEncoder(w).Encode(map[string]any{
			"success": true,
			"task": map[string]any{
				"_id":           "task/with space",
				"status":        "completed",
				"_creationTime": 1750000000000,
				"dispatchMode":  "exact",
				"workspaceSlug": "hr",
				"dispatchedAt":  1750000000001,
			},
			"verification": map[string]any{
				"allReady":     true,
				"ready":        1,
				"pending":      0,
				"invalid":      0,
				"checkedAt":    1750000000100,
				"dispatchedAt": 1750000000001,
				"targets": []map[string]any{{
					"currentResumeId":          "resume-1",
					"state":                    "ready",
					"expectedAnalysisKey":      "source:seek|locale:en|analysis:keyword-search:2:test",
					"expectedJobDescriptionId": "keyword-search:2:test",
					"expectedPromptVersion":    42,
					"actualJobDescriptionId":   "keyword-search:2:test",
					"actualPromptVersion":      42,
					"analyzedAt":               1750000000002,
					"reasons":                  []string{},
				}},
			},
		})
	}))
	defer server.Close()

	c := New(server.URL, server.URL, "hr")
	c.HTTP = server.Client()

	response, err := c.GetAnalysisTask(context.Background(), " task/with space ")
	if err != nil {
		t.Fatalf("GetAnalysisTask returned error: %v", err)
	}
	if response.Task.ID != "task/with space" || response.Task.Status != "completed" {
		t.Fatalf("unexpected task response: %+v", response.Task)
	}
	if !response.Verification.AllReady || response.Verification.Ready != 1 {
		t.Fatalf("unexpected verification response: %+v", response.Verification)
	}
}
