package client

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
)

func TestGetExactTaskAuditExportPageEscapesTaskIDAndCursor(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodGet {
			t.Fatalf("expected GET, got %s", r.Method)
		}
		if got := r.URL.EscapedPath(); got != "/api/resumes/analysis-tasks/task%2Fwith%20space/audit-export" {
			t.Fatalf("unexpected escaped path: %s", got)
		}
		if got := r.URL.Query().Get("cursor"); got != "cursor/with +" {
			t.Fatalf("unexpected cursor: %q", got)
		}
		if got := r.URL.Query().Get("limit"); got != "37" {
			t.Fatalf("unexpected limit: %q", got)
		}
		if got := r.Header.Get("X-Workspace-Slug"); got != "hr" {
			t.Fatalf("expected workspace header hr, got %q", got)
		}

		_ = json.NewEncoder(w).Encode(map[string]any{
			"success": true,
			"task": map[string]any{
				"taskId": "task/with space", "status": "completed", "dispatchMode": "exact",
				"workspaceSlug": "hr", "dispatchedAt": 1, "completedAt": 2,
				"expectedJobDescriptionId": "jd-exact", "expectedPromptVersion": 42, "targetCount": 1,
			},
			"counts": map[string]any{"scanned": 0, "exported": 0, "targeted": 0, "ready": 0},
			"page":   []any{}, "continueCursor": "", "isDone": true,
		})
	}))
	defer server.Close()

	c := New(server.URL, server.URL, "hr")
	c.HTTP = server.Client()
	response, err := c.GetExactTaskAuditExportPage(
		context.Background(),
		" task/with space ",
		"cursor/with +",
		37,
	)
	if err != nil {
		t.Fatalf("GetExactTaskAuditExportPage returned error: %v", err)
	}
	if !response.Success || response.Task.TaskID != "task/with space" {
		t.Fatalf("unexpected response: %+v", response)
	}
}
