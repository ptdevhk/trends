package client

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

func TestWorkspaceSnapshotClientEndpoints(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch {
		case r.Method == http.MethodGet && r.URL.Path == "/api/workspace/export":
			if got := r.URL.Query().Get("profile"); got != "hr-ops" {
				t.Fatalf("unexpected profile query: %q", got)
			}
			if got := r.Header.Get("X-Workspace-Slug"); got != "hr" {
				t.Fatalf("expected workspace header hr, got %q", got)
			}
			_ = json.NewEncoder(w).Encode(map[string]any{
				"success":       true,
				"schemaVersion": 1,
				"profile":       "hr-ops",
				"workspaceSlug": "hr",
				"exportedAt":    1750000000000,
				"tables": map[string]any{
					"candidateStatus": []map[string]any{{"_id": "cs1", "status": "shortlisted"}},
					"candidateBlocks": []any{},
					"searchProfiles":  []any{},
					"workspaceConfig": []any{},
				},
			})
		case r.Method == http.MethodPost && r.URL.Path == "/api/workspace/import":
			if got := r.Header.Get("Content-Type"); got != "application/json" {
				t.Fatalf("expected JSON content type, got %q", got)
			}
			var payload WorkspaceSnapshotImportRequest
			if err := json.NewDecoder(r.Body).Decode(&payload); err != nil {
				t.Fatalf("failed to decode import body: %v", err)
			}
			if payload.SchemaVersion != 1 || payload.Profile != "hr-ops" || payload.Mode != "merge" {
				t.Fatalf("unexpected import payload: %+v", payload)
			}
			if len(payload.Tables.CandidateStatus) != 1 {
				t.Fatalf("unexpected candidateStatus rows: %+v", payload.Tables)
			}
			_ = json.NewEncoder(w).Encode(WorkspaceSnapshotImportResult{
				Success:       true,
				SchemaVersion: 1,
				Profile:       "hr-ops",
				WorkspaceSlug: "hr",
				Mode:          "merge",
				Applied:       WorkspaceSnapshotCounts{CandidateStatus: 1},
			})
		default:
			t.Fatalf("unexpected request %s %s", r.Method, r.URL.Path)
		}
	}))
	defer server.Close()

	c := New(server.URL, server.URL, "hr")

	exported, err := c.ExportWorkspaceSnapshot(context.Background(), "hr-ops")
	if err != nil {
		t.Fatalf("export failed: %v", err)
	}
	if exported.Profile != "hr-ops" || exported.WorkspaceSlug != "hr" || len(exported.Tables.CandidateStatus) != 1 {
		t.Fatalf("unexpected export response: %+v", exported)
	}

	imported, err := c.ImportWorkspaceSnapshot(context.Background(), WorkspaceSnapshotImportRequest{
		SchemaVersion: 1,
		Profile:       "hr-ops",
		Mode:          "merge",
		Tables: WorkspaceSnapshotTables{
			CandidateStatus: []map[string]any{{"_id": "cs1", "status": "shortlisted"}},
		},
	})
	if err != nil {
		t.Fatalf("import failed: %v", err)
	}
	if imported.Mode != "merge" || imported.Applied.CandidateStatus != 1 {
		t.Fatalf("unexpected import response: %+v", imported)
	}
}

func TestWorkspaceSnapshotImportSurfacesRejectionMessage(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodPost || r.URL.Path != "/api/workspace/import" {
			t.Fatalf("unexpected request %s %s", r.Method, r.URL.Path)
		}
		w.WriteHeader(http.StatusBadRequest)
		_ = json.NewEncoder(w).Encode(map[string]any{
			"success": false,
			"error":   "Unsupported snapshot schemaVersion 99 (expected 1)",
		})
	}))
	defer server.Close()

	c := New(server.URL, server.URL, "hr")
	_, err := c.ImportWorkspaceSnapshot(context.Background(), WorkspaceSnapshotImportRequest{
		SchemaVersion: 99,
		Profile:       "hr-ops",
		Mode:          "merge",
	})
	if err == nil {
		t.Fatal("expected import rejection to fail")
	}
	if !strings.Contains(err.Error(), "Unsupported snapshot schemaVersion 99") {
		t.Fatalf("unexpected error: %v", err)
	}
}
