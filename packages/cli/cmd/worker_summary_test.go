package cmd

import (
	"bytes"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
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
		if request["workspaceSlug"] != "ops" || request["period"] != "weekly" {
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
				"period":        "weekly",
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
	cmd.SetArgs([]string{"--dry-run", "--period", "weekly"})

	if err := cmd.Execute(); err != nil {
		t.Fatalf("worker summary run command failed: %v", err)
	}

	payload := decodeCommandJSON(t, output)
	run, ok := payload["run"].(map[string]any)
	if !ok {
		t.Fatalf("missing run payload: %#v", payload)
	}
	if run["id"] != "run-1" || run["status"] != "dry_run" || run["period"] != "weekly" {
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
		if request["workspaceSlug"] != "ops" || request["period"] != "weekly" {
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
	cmd.SetArgs([]string{"--via-worker", "--dry-run", "--period", "weekly"})

	if err := cmd.Execute(); err != nil {
		t.Fatalf("worker summary via-worker command failed: %v", err)
	}

	payload := decodeCommandJSON(t, output)
	if payload["mode"] != "summary" {
		t.Fatalf("unexpected output payload: %#v", payload)
	}
}

func TestWorkerSummaryRunCommandRejectsInvalidPeriod(t *testing.T) {
	setResumeCLIConfig(t, "http://127.0.0.1:1", "ops")
	setCLIOutput(t, "json")

	cmd := newWorkerSummaryRunCmd()
	var output bytes.Buffer
	cmd.SetOut(&output)
	cmd.SetErr(&output)
	cmd.SetArgs([]string{"--period", "monthly"})

	err := cmd.Execute()
	if err == nil {
		t.Fatal("expected invalid period error")
	}
	if !strings.Contains(err.Error(), "expected daily or weekly") {
		t.Fatalf("unexpected error: %v", err)
	}
}

func TestWorkerSummaryRunCommandWritesTableDeliverySummary(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		_ = json.NewEncoder(w).Encode(map[string]any{
			"success":    true,
			"channel":    "telegram",
			"dryRun":     false,
			"templateId": "summary-daily",
			"delivery": map[string]any{
				"channel":              "telegram",
				"ok":                   true,
				"accountsConfigured":   1,
				"accountsSelected":     1,
				"accountsAttempted":    1,
				"accountsSent":         1,
				"batchCountPerAccount": 2,
				"totalBatches":         2,
			},
			"run": map[string]any{
				"id":            "run-2",
				"period":        "weekly",
				"status":        "sent",
				"triggerSource": "api_manual",
				"windowEnd":     "2026-03-26T12:00:00Z",
			},
		})
	}))
	defer server.Close()

	setResumeCLIConfig(t, server.URL, "ops")
	setCLIOutput(t, "table")

	cmd := newWorkerSummaryRunCmd()
	var output bytes.Buffer
	cmd.SetOut(&output)
	cmd.SetErr(&output)

	if err := cmd.Execute(); err != nil {
		t.Fatalf("worker summary run command failed: %v", err)
	}

	text := output.String()
	if !strings.Contains(text, "weekly") || !strings.Contains(text, "1/1 sent, 2 batches") {
		t.Fatalf("expected delivery summary in table output, got: %s", text)
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
				"period":        "weekly",
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
	if !ok || item["triggerSource"] != "worker_schedule" || item["period"] != "weekly" {
		t.Fatalf("unexpected item payload: %#v", payload)
	}
}

func TestWorkerSummaryHistoryCommandWritesTableDeliverySummary(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		_ = json.NewEncoder(w).Encode(map[string]any{
			"success": true,
			"items": []map[string]any{{
				"id":            "run-3",
				"period":        "weekly",
				"status":        "sent",
				"triggerSource": "worker_schedule",
				"delivery": map[string]any{
					"channel":           "telegram",
					"accountsAttempted": 1,
					"accountsSent":      1,
					"totalBatches":      3,
				},
			}},
		})
	}))
	defer server.Close()

	setResumeCLIConfig(t, server.URL, "ops")
	setCLIOutput(t, "table")

	cmd := newWorkerSummaryHistoryCmd()
	var output bytes.Buffer
	cmd.SetOut(&output)
	cmd.SetErr(&output)

	if err := cmd.Execute(); err != nil {
		t.Fatalf("worker summary history command failed: %v", err)
	}

	text := output.String()
	if !strings.Contains(text, "weekly") || !strings.Contains(text, "1/1 sent, 3 batches") {
		t.Fatalf("expected delivery summary in history table output, got: %s", text)
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
				"period":        "weekly",
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
	if item["id"] != "run-7" || item["error"] != "boom" || item["period"] != "weekly" {
		t.Fatalf("unexpected item payload: %#v", payload)
	}
}

func TestWorkerSummaryShowCommandWritesTableDeliveryDetails(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		_ = json.NewEncoder(w).Encode(map[string]any{
			"success": true,
			"item": map[string]any{
				"id":            "run-8",
				"period":        "weekly",
				"status":        "sent",
				"channel":       "telegram",
				"triggerSource": "api_manual",
				"error":         "",
				"delivery": map[string]any{
					"channel":              "telegram",
					"ok":                   true,
					"accountsConfigured":   2,
					"accountsSelected":     2,
					"accountsAttempted":    1,
					"accountsSent":         1,
					"batchCountPerAccount": 2,
					"totalBatches":         2,
					"usedOverrideChatId":   true,
					"accounts": []map[string]any{
						{
							"index":          1,
							"chatIdHint":     "***1234",
							"attempted":      true,
							"sent":           true,
							"batchesPlanned": 2,
						},
						{
							"index":          2,
							"chatIdHint":     "***5678",
							"attempted":      false,
							"sent":           false,
							"batchesPlanned": 0,
							"skippedReason":  "missing token or chat_id",
						},
					},
				},
			},
		})
	}))
	defer server.Close()

	setResumeCLIConfig(t, server.URL, "ops")
	setCLIOutput(t, "table")

	cmd := newWorkerSummaryShowCmd()
	var output bytes.Buffer
	cmd.SetOut(&output)
	cmd.SetErr(&output)
	cmd.SetArgs([]string{"run-8"})

	if err := cmd.Execute(); err != nil {
		t.Fatalf("worker summary show command failed: %v", err)
	}

	text := output.String()
	if !strings.Contains(text, "weekly") || !strings.Contains(text, "1/1 sent, 2 batches, override") {
		t.Fatalf("expected delivery summary in show table output, got: %s", text)
	}
	if !strings.Contains(text, "1:***1234:sent(2b), 2:***5678:skipped") {
		t.Fatalf("expected account detail summary in show table output, got: %s", text)
	}
}
