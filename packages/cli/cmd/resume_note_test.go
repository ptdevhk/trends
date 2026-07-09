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
)

func TestParseResumeNoteRowsSupportsTabCommaHeaderAndQuotedComments(t *testing.T) {
	input := strings.Join([]string{
		"id,name,comments",
		`r1,Alice,"半导体, industry mismatch"`,
		"r2,Bob,宝力离职销售",
	}, "\n")

	rows, err := parseResumeNoteRows(strings.NewReader(input), resumeNoteDelimiterComma)
	if err != nil {
		t.Fatalf("parse rows failed: %v", err)
	}

	if len(rows) != 2 {
		t.Fatalf("expected 2 rows, got %d: %+v", len(rows), rows)
	}
	if rows[0].ResumeID != "r1" || rows[0].Name != "Alice" || rows[0].Comments != "半导体, industry mismatch" {
		t.Fatalf("unexpected first row: %+v", rows[0])
	}
	if rows[1].ResumeID != "r2" || rows[1].Name != "Bob" || rows[1].Comments != "宝力离职销售" {
		t.Fatalf("unexpected second row: %+v", rows[1])
	}
}

func TestParseResumeNoteRowsAutoDetectsTabWithoutHeader(t *testing.T) {
	input := "r1\tAlice\t半导体，行业不匹配\nr2\tBob\t宝力离职销售\n"

	rows, err := parseResumeNoteRows(strings.NewReader(input), resumeNoteDelimiterAuto)
	if err != nil {
		t.Fatalf("parse rows failed: %v", err)
	}

	if len(rows) != 2 {
		t.Fatalf("expected 2 rows, got %d: %+v", len(rows), rows)
	}
	if rows[0].ResumeID != "r1" || rows[0].Name != "Alice" || rows[0].Comments != "半导体，行业不匹配" {
		t.Fatalf("unexpected first row: %+v", rows[0])
	}
}

func TestResumeNoteCommandDryRunDoesNotPost(t *testing.T) {
	called := false
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		called = true
		t.Fatalf("dry-run should not call API")
	}))
	defer server.Close()

	setResumeCLIConfig(t, server.URL, "hr")
	setCLIOutput(t, "json")

	filePath := filepath.Join(t.TempDir(), "feedback.tsv")
	if err := os.WriteFile(filePath, []byte("r1\tAlice\t半导体，行业不匹配\n"), 0o600); err != nil {
		t.Fatalf("write feedback file: %v", err)
	}

	cmd := newResumeNoteCmd()
	var output bytes.Buffer
	cmd.SetOut(&output)
	cmd.SetErr(&output)
	cmd.SetArgs([]string{"--from-file", filePath, "--dry-run"})

	if err := cmd.Execute(); err != nil {
		t.Fatalf("resume note dry-run failed: %v", err)
	}
	if called {
		t.Fatalf("dry-run called API")
	}

	var payload map[string]any
	if err := json.Unmarshal(output.Bytes(), &payload); err != nil {
		t.Fatalf("failed to decode output: %v\n%s", err, output.String())
	}
	if payload["dryRun"] != true || int(payload["total"].(float64)) != 1 {
		t.Fatalf("unexpected dry-run output: %+v", payload)
	}
}

func TestResumeNoteCommandPostsRowsAndSurfacesNotFound(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodPost || r.URL.Path != "/api/resumes/feedback-batch" {
			t.Fatalf("unexpected request %s %s", r.Method, r.URL.Path)
		}
		if got := r.Header.Get("X-Workspace-Slug"); got != "hr" {
			t.Fatalf("unexpected workspace header: %q", got)
		}

		var payload map[string][]map[string]string
		if err := json.NewDecoder(r.Body).Decode(&payload); err != nil {
			t.Fatalf("decode request body: %v", err)
		}
		if len(payload["items"]) != 2 || payload["items"][0]["resumeId"] != "r1" || payload["items"][1]["resumeId"] != "missing" {
			t.Fatalf("unexpected request payload: %+v", payload)
		}

		_ = json.NewEncoder(w).Encode(map[string]any{
			"success":  true,
			"total":    2,
			"imported": 1,
			"skipped":  0,
			"notFound": []string{"missing"},
			"results": []map[string]string{
				{"resumeId": "r1", "name": "Alice", "comments": "Good", "status": "imported"},
				{"resumeId": "missing", "name": "Missing", "comments": "Bad id", "status": "notFound"},
			},
		})
	}))
	defer server.Close()

	setResumeCLIConfig(t, server.URL, "hr")
	setCLIOutput(t, "json")

	filePath := filepath.Join(t.TempDir(), "feedback.tsv")
	if err := os.WriteFile(filePath, []byte("r1\tAlice\tGood\nmissing\tMissing\tBad id\n"), 0o600); err != nil {
		t.Fatalf("write feedback file: %v", err)
	}

	cmd := newResumeNoteCmd()
	var output bytes.Buffer
	cmd.SetOut(&output)
	cmd.SetErr(&output)
	cmd.SetArgs([]string{"--from-file", filePath})

	if err := cmd.Execute(); err != nil {
		t.Fatalf("resume note command failed: %v", err)
	}

	var payload map[string]any
	if err := json.Unmarshal(output.Bytes(), &payload); err != nil {
		t.Fatalf("failed to decode output: %v\n%s", err, output.String())
	}
	if int(payload["imported"].(float64)) != 1 || int(payload["notFoundCount"].(float64)) != 1 {
		t.Fatalf("unexpected command output: %+v", payload)
	}
}
