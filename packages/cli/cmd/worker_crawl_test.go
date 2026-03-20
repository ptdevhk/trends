package cmd

import (
	"bytes"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/ptdevhk/trends/packages/cli/internal/client"
)

func TestWorkerStatusCommandWritesJSON(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/worker/status" {
			t.Fatalf("unexpected path: %s", r.URL.Path)
		}
		if r.Method != http.MethodGet {
			t.Fatalf("unexpected method: %s", r.Method)
		}
		_ = json.NewEncoder(w).Encode(client.WorkerStatus{
			Running:      true,
			JobsExecuted: 12,
			JobsFailed:   1,
			JobsMissed:   0,
			LastRun:      "2026-03-20T10:00:00Z",
			LastSuccess:  "2026-03-20T09:59:00Z",
			LastFailure:  "2026-03-19T20:00:00Z",
		})
	}))
	defer server.Close()

	setResumeCLIConfig(t, server.URL, "ops")
	setCLIOutput(t, "json")

	cmd := newWorkerStatusCmd()
	var output bytes.Buffer
	cmd.SetOut(&output)
	cmd.SetErr(&output)

	if err := cmd.Execute(); err != nil {
		t.Fatalf("worker status command failed: %v", err)
	}

	payload := decodeCommandJSON(t, output)
	if payload["jobs_executed"] != float64(12) || payload["running"] != true {
		t.Fatalf("unexpected output payload: %#v", payload)
	}
}

func TestWorkerRunCommandPassesOnceFlag(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/worker/run" {
			t.Fatalf("unexpected path: %s", r.URL.Path)
		}
		if r.Method != http.MethodPost {
			t.Fatalf("unexpected method: %s", r.Method)
		}
		if got := r.URL.Query().Get("once"); got != "false" {
			t.Fatalf("expected once=false, got %q", got)
		}
		_ = json.NewEncoder(w).Encode(client.WorkerTriggerResponse{
			Success:    true,
			Mode:       "scheduled",
			StartedAt:  "2026-03-20T10:10:00Z",
			FinishedAt: "2026-03-20T10:10:05Z",
			Message:    "worker queued",
		})
	}))
	defer server.Close()

	setResumeCLIConfig(t, server.URL, "ops")
	setCLIOutput(t, "table")

	cmd := newWorkerRunCmd()
	var output bytes.Buffer
	cmd.SetOut(&output)
	cmd.SetErr(&output)
	cmd.SetArgs([]string{"--once=false"})

	if err := cmd.Execute(); err != nil {
		t.Fatalf("worker run command failed: %v", err)
	}

	text := output.String()
	if !strings.Contains(text, "scheduled") || !strings.Contains(text, "worker queued") {
		t.Fatalf("unexpected command output: %s", text)
	}
}

func TestCrawlCommandWritesJSON(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/worker/crawl" {
			t.Fatalf("unexpected path: %s", r.URL.Path)
		}
		if r.Method != http.MethodPost {
			t.Fatalf("unexpected method: %s", r.Method)
		}
		_ = json.NewEncoder(w).Encode(client.WorkerTriggerResponse{
			Success:    true,
			Mode:       "crawl",
			StartedAt:  "2026-03-20T10:20:00Z",
			FinishedAt: "2026-03-20T10:20:10Z",
			Message:    "crawl triggered",
		})
	}))
	defer server.Close()

	setResumeCLIConfig(t, server.URL, "ops")
	setCLIOutput(t, "json")

	cmd := newCrawlCmd()
	var output bytes.Buffer
	cmd.SetOut(&output)
	cmd.SetErr(&output)

	if err := cmd.Execute(); err != nil {
		t.Fatalf("crawl command failed: %v", err)
	}

	payload := decodeCommandJSON(t, output)
	if payload["mode"] != "crawl" || payload["message"] != "crawl triggered" {
		t.Fatalf("unexpected output payload: %#v", payload)
	}
}
