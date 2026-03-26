package client

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

func TestWorkerStatusUsesAPIProxyWhenSuccessful(t *testing.T) {
	var proxyCalls int
	proxy := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		proxyCalls++
		if r.URL.Path != "/worker/status" {
			t.Fatalf("unexpected proxy path: %s", r.URL.Path)
		}
		_ = json.NewEncoder(w).Encode(WorkerStatus{
			Running:      true,
			JobsExecuted: 5,
		})
	}))
	defer proxy.Close()

	workerCalls := 0
	worker := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		workerCalls++
		t.Fatalf("worker fallback should not be called")
	}))
	defer worker.Close()

	c := New(proxy.URL, worker.URL, "dev")
	c.HTTP = proxy.Client()

	status, err := c.WorkerStatus(context.Background())
	if err != nil {
		t.Fatalf("WorkerStatus returned error: %v", err)
	}
	if status.JobsExecuted != 5 || !status.Running {
		t.Fatalf("unexpected status: %+v", status)
	}
	if proxyCalls != 1 || workerCalls != 0 {
		t.Fatalf("unexpected call counts: proxy=%d worker=%d", proxyCalls, workerCalls)
	}
}

func TestWorkerStatusFallsBackToWorkerURL(t *testing.T) {
	var proxyCalls int
	proxy := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		proxyCalls++
		http.Error(w, "proxy unavailable", http.StatusBadGateway)
	}))
	defer proxy.Close()

	var workerCalls int
	worker := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		workerCalls++
		if r.URL.Path != "/worker/status" {
			t.Fatalf("unexpected worker path: %s", r.URL.Path)
		}
		_ = json.NewEncoder(w).Encode(WorkerStatus{
			Running:      false,
			JobsExecuted: 9,
		})
	}))
	defer worker.Close()

	c := New(proxy.URL, worker.URL, "dev")
	c.HTTP = proxy.Client()

	status, err := c.WorkerStatus(context.Background())
	if err != nil {
		t.Fatalf("WorkerStatus returned error: %v", err)
	}
	if status.JobsExecuted != 9 || status.Running {
		t.Fatalf("unexpected status: %+v", status)
	}
	if proxyCalls != 1 || workerCalls != 1 {
		t.Fatalf("unexpected call counts: proxy=%d worker=%d", proxyCalls, workerCalls)
	}
}

func TestWorkerStatusReturnsWorkerErrorWhenFallbackFails(t *testing.T) {
	proxy := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		http.Error(w, "proxy unavailable", http.StatusBadGateway)
	}))
	defer proxy.Close()

	worker := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		http.Error(w, "worker unavailable", http.StatusServiceUnavailable)
	}))
	defer worker.Close()

	c := New(proxy.URL, worker.URL, "dev")
	c.HTTP = proxy.Client()

	_, err := c.WorkerStatus(context.Background())
	if err == nil {
		t.Fatal("expected worker fallback error")
	}
	if !strings.Contains(err.Error(), "503") || !strings.Contains(err.Error(), "worker unavailable") {
		t.Fatalf("unexpected error: %v", err)
	}
}

func TestTriggerCrawlFailsWhenResponseNotSuccessful(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/worker/crawl" {
			t.Fatalf("unexpected path: %s", r.URL.Path)
		}
		_ = json.NewEncoder(w).Encode(WorkerTriggerResponse{
			Success: false,
			Mode:    "crawl",
		})
	}))
	defer server.Close()

	c := New(server.URL, server.URL, "dev")
	c.HTTP = server.Client()

	_, err := c.TriggerCrawl(context.Background())
	if err == nil {
		t.Fatal("expected unsuccessful crawl trigger error")
	}
	if !strings.Contains(err.Error(), "not successful") {
		t.Fatalf("unexpected error: %v", err)
	}
}

func TestRunWorkerFailsWhenResponseNotSuccessful(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/worker/run" {
			t.Fatalf("unexpected path: %s", r.URL.Path)
		}
		if got := r.URL.Query().Get("once"); got != "true" {
			t.Fatalf("expected once=true, got %q", got)
		}
		_ = json.NewEncoder(w).Encode(WorkerTriggerResponse{
			Success: false,
			Mode:    "once",
		})
	}))
	defer server.Close()

	c := New(server.URL, server.URL, "dev")
	c.HTTP = server.Client()

	_, err := c.RunWorker(context.Background(), true)
	if err == nil {
		t.Fatal("expected unsuccessful worker run error")
	}
	if !strings.Contains(err.Error(), "not successful") {
		t.Fatalf("unexpected error: %v", err)
	}
}

func TestRunWorkspaceSummaryPostsRunRequest(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/api/summaries/run" {
			t.Fatalf("unexpected path: %s", r.URL.Path)
		}
		if r.Method != http.MethodPost {
			t.Fatalf("unexpected method: %s", r.Method)
		}
		if got := r.Header.Get("X-Workspace-Slug"); got != "ops" {
			t.Fatalf("expected workspace header, got %q", got)
		}

		var request SummaryRunRequest
		if err := json.NewDecoder(r.Body).Decode(&request); err != nil {
			t.Fatalf("decode request: %v", err)
		}
		if request.WorkspaceSlug != "ops" || request.Period != "weekly" {
			t.Fatalf("unexpected workspace request: %+v", request)
		}
		if request.TriggerSource != "api_manual" || request.Channel != "telegram" {
			t.Fatalf("unexpected request: %+v", request)
		}

		_ = json.NewEncoder(w).Encode(SummaryRunInvocationResponse{
			Success:    true,
			Channel:    "telegram",
			DryRun:     true,
			TemplateID: "summary-daily",
			Run: SummaryRun{
				ID:            "run-1",
				Status:        "dry_run",
				TriggerSource: "api_manual",
			},
		})
	}))
	defer server.Close()

	c := New(server.URL, server.URL, "ops")
	c.HTTP = server.Client()

	response, err := c.RunWorkspaceSummary(context.Background(), SummaryRunRequest{
		Channel:       "telegram",
		Period:        "weekly",
		DryRun:        true,
		TriggerSource: "api_manual",
	})
	if err != nil {
		t.Fatalf("RunWorkspaceSummary returned error: %v", err)
	}
	if response.Run.ID != "run-1" || response.Run.Status != "dry_run" {
		t.Fatalf("unexpected response: %+v", response)
	}
}

func TestListWorkspaceSummaryRunsFetchesHistory(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/api/summaries/runs" {
			t.Fatalf("unexpected path: %s", r.URL.Path)
		}
		if got := r.URL.Query().Get("limit"); got != "5" {
			t.Fatalf("expected limit=5, got %q", got)
		}
		_ = json.NewEncoder(w).Encode(SummaryRunListResponse{
			Success: true,
			Items: []SummaryRun{{
				ID:            "run-1",
				Status:        "sent",
				TriggerSource: "worker_schedule",
			}},
		})
	}))
	defer server.Close()

	c := New(server.URL, server.URL, "ops")
	c.HTTP = server.Client()

	response, err := c.ListWorkspaceSummaryRuns(context.Background(), 5)
	if err != nil {
		t.Fatalf("ListWorkspaceSummaryRuns returned error: %v", err)
	}
	if len(response.Items) != 1 || response.Items[0].TriggerSource != "worker_schedule" {
		t.Fatalf("unexpected response: %+v", response)
	}
}

func TestGetWorkspaceSummaryRunFetchesDetail(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/api/summaries/runs/run-42" {
			t.Fatalf("unexpected path: %s", r.URL.Path)
		}
		_ = json.NewEncoder(w).Encode(SummaryRunDetailResponse{
			Success: true,
			Item: SummaryRun{
				ID:            "run-42",
				Status:        "failed",
				TriggerSource: "api_manual",
				Error:         "boom",
			},
		})
	}))
	defer server.Close()

	c := New(server.URL, server.URL, "ops")
	c.HTTP = server.Client()

	response, err := c.GetWorkspaceSummaryRun(context.Background(), "run-42")
	if err != nil {
		t.Fatalf("GetWorkspaceSummaryRun returned error: %v", err)
	}
	if response.Item.Error != "boom" || response.Item.ID != "run-42" {
		t.Fatalf("unexpected response: %+v", response)
	}
}

func TestTriggerWorkerSummaryPostsWorkerSummaryRequest(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/worker/summary" {
			t.Fatalf("unexpected path: %s", r.URL.Path)
		}
		if r.Method != http.MethodPost {
			t.Fatalf("unexpected method: %s", r.Method)
		}
		if got := r.Header.Get("X-Workspace-Slug"); got != "ops" {
			t.Fatalf("expected workspace header, got %q", got)
		}

		var request SummaryRunRequest
		if err := json.NewDecoder(r.Body).Decode(&request); err != nil {
			t.Fatalf("decode request: %v", err)
		}
		if request.WorkspaceSlug != "ops" || request.Period != "weekly" {
			t.Fatalf("unexpected workspace request: %+v", request)
		}
		if request.Channel != "telegram" || !request.DryRun {
			t.Fatalf("unexpected request: %+v", request)
		}

		_ = json.NewEncoder(w).Encode(WorkerTriggerResponse{
			Success: true,
			Mode:    "summary",
			Message: "Summary task completed",
		})
	}))
	defer server.Close()

	c := New(server.URL, server.URL, "ops")
	c.HTTP = server.Client()

	response, err := c.TriggerWorkerSummary(context.Background(), SummaryRunRequest{
		Channel: "telegram",
		Period:  "weekly",
		DryRun:  true,
	})
	if err != nil {
		t.Fatalf("TriggerWorkerSummary returned error: %v", err)
	}
	if response.Mode != "summary" {
		t.Fatalf("unexpected response: %+v", response)
	}
}
