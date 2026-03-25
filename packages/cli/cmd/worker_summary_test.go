package cmd

import (
	"bytes"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
)

func TestWorkerSummaryRunCommandWritesJSON(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/api/summaries/run" {
			t.Fatalf("unexpected path: %s", r.URL.Path)
		}
		if r.Method != http.MethodPost {
			t.Fatalf("unexpected method: %s", r.Method)
		}

		var request map[string]any
		if err := json.NewDecoder(r.Body).Decode(&request); err != nil {
			t.Fatalf("decode request: %v", err)
		}
		if request["workspaceSlug"] != "ops" || request["period"] != "daily" {
			t.Fatalf("unexpected request: %#v", request)
		}
		if request["triggerSource"] != "api_manual" {
			t.Fatalf("unexpected request: %#v", request)
		}

		_ = json.NewEncoder(w).Encode(map[string]any{
			"success":    true,
			"channel":    "telegram",
			"dryRun":     true,
			"templateId": "summary-daily",
			"run": map[string]any{
				"id":            "run-1",
				"status":        "dry_run",
				"triggerSource": "api_manual",
				"windowEnd":     "2026-03-26T12:00:00Z",
			},
		})
	}))
	defer server.Close()

	setResumeCLIConfig(t, server.URL, "ops")
	setCLIOutput(t, "json")

	cmd := newWorkerSummaryRunCmd()
	var output bytes.Buffer
	cmd.SetOut(&output)
	cmd.SetErr(&output)
	cmd.SetArgs([]string{"--dry-run"})

	if err := cmd.Execute(); err != nil {
		t.Fatalf("worker summary run command failed: %v", err)
	}

	payload := decodeCommandJSON(t, output)
	run, ok := payload["run"].(map[string]any)
	if !ok {
		t.Fatalf("missing run payload: %#v", payload)
	}
	if run["id"] != "run-1" || run["status"] != "dry_run" {
		t.Fatalf("unexpected output payload: %#v", payload)
	}
}

func TestWorkerSummaryRunViaWorkerCommandWritesJSON(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/worker/summary" {
			t.Fatalf("unexpected path: %s", r.URL.Path)
		}
		if r.Method != http.MethodPost {
			t.Fatalf("unexpected method: %s", r.Method)
		}

		var request map[string]any
		if err := json.NewDecoder(r.Body).Decode(&request); err != nil {
			t.Fatalf("decode request: %v", err)
		}
		if request["workspaceSlug"] != "ops" || request["period"] != "daily" {
			t.Fatalf("unexpected request: %#v", request)
		}

		_ = json.NewEncoder(w).Encode(map[string]any{
			"success":     true,
			"mode":        "summary",
			"started_at":  "2026-03-26T12:00:00Z",
			"finished_at": "2026-03-26T12:00:02Z",
			"message":     "Summary task completed for ops",
		})
	}))
	defer server.Close()

	setResumeCLIConfig(t, server.URL, "ops")
	setCLIOutput(t, "json")

	cmd := newWorkerSummaryRunCmd()
	var output bytes.Buffer
	cmd.SetOut(&output)
	cmd.SetErr(&output)
	cmd.SetArgs([]string{"--via-worker", "--dry-run"})

	if err := cmd.Execute(); err != nil {
		t.Fatalf("worker summary via-worker command failed: %v", err)
	}

	payload := decodeCommandJSON(t, output)
	if payload["mode"] != "summary" {
		t.Fatalf("unexpected output payload: %#v", payload)
	}
}

func TestWorkerSummaryHistoryCommandWritesJSON(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/api/summaries/runs" {
			t.Fatalf("unexpected path: %s", r.URL.Path)
		}
		if got := r.URL.Query().Get("limit"); got != "5" {
			t.Fatalf("expected limit=5, got %q", got)
		}

		_ = json.NewEncoder(w).Encode(map[string]any{
			"success": true,
			"items": []map[string]any{{
				"id":            "run-1",
				"status":        "sent",
				"triggerSource": "worker_schedule",
			}},
		})
	}))
	defer server.Close()

	setResumeCLIConfig(t, server.URL, "ops")
	setCLIOutput(t, "json")

	cmd := newWorkerSummaryHistoryCmd()
	var output bytes.Buffer
	cmd.SetOut(&output)
	cmd.SetErr(&output)
	cmd.SetArgs([]string{"--limit", "5"})

	if err := cmd.Execute(); err != nil {
		t.Fatalf("worker summary history command failed: %v", err)
	}

	payload := decodeCommandJSON(t, output)
	items, ok := payload["items"].([]any)
	if !ok || len(items) != 1 {
		t.Fatalf("unexpected output payload: %#v", payload)
	}
	item, ok := items[0].(map[string]any)
	if !ok || item["triggerSource"] != "worker_schedule" {
		t.Fatalf("unexpected item payload: %#v", payload)
	}
}

func TestWorkerSummaryShowCommandWritesJSON(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/api/summaries/runs/run-7" {
			t.Fatalf("unexpected path: %s", r.URL.Path)
		}

		_ = json.NewEncoder(w).Encode(map[string]any{
			"success": true,
			"item": map[string]any{
				"id":            "run-7",
				"status":        "failed",
				"triggerSource": "api_manual",
				"error":         "boom",
			},
		})
	}))
	defer server.Close()

	setResumeCLIConfig(t, server.URL, "ops")
	setCLIOutput(t, "json")

	cmd := newWorkerSummaryShowCmd()
	var output bytes.Buffer
	cmd.SetOut(&output)
	cmd.SetErr(&output)
	cmd.SetArgs([]string{"run-7"})

	if err := cmd.Execute(); err != nil {
		t.Fatalf("worker summary show command failed: %v", err)
	}

	payload := decodeCommandJSON(t, output)
	item, ok := payload["item"].(map[string]any)
	if !ok {
		t.Fatalf("unexpected output payload: %#v", payload)
	}
	if item["id"] != "run-7" || item["error"] != "boom" {
		t.Fatalf("unexpected item payload: %#v", payload)
	}
}
