package client

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync/atomic"
	"testing"
)

func TestWorkerFallbackNeverReceivesAPISessionMaterial(t *testing.T) {
	var workerCalls atomic.Int32
	worker := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		workerCalls.Add(1)
		if r.Header.Get("Cookie") != "" || r.Header.Get("X-CSRF-Token") != "" {
			t.Error("worker fallback received API session material")
		}
		_ = json.NewEncoder(w).Encode(WorkerStatus{Running: true})
	}))
	defer worker.Close()

	var loginCalls atomic.Int32
	var proxyCalls atomic.Int32
	api := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path == "/api/auth/login" {
			loginCalls.Add(1)
			writeSessionLoginSuccess(w, "worker-isolation-session", "worker-isolation-cookie", "worker-isolation-token")
			return
		}
		proxyCalls.Add(1)
		http.Error(w, "proxy unavailable", http.StatusBadGateway)
	}))
	defer api.Close()

	c := newWithSessionAuth(api.URL, worker.URL, "dev", "worker-user", true, "worker-password", true)
	c.HTTP = api.Client()
	status, err := c.WorkerStatus(context.Background())
	if err != nil {
		t.Fatalf("worker fallback failed: %v", err)
	}
	if !status.Running {
		t.Fatal("unexpected worker fallback response")
	}
	if loginCalls.Load() != 1 || proxyCalls.Load() != 1 || workerCalls.Load() != 1 {
		t.Fatalf("unexpected call counts login=%d proxy=%d worker=%d", loginCalls.Load(), proxyCalls.Load(), workerCalls.Load())
	}
}

func TestWorkerFallbackRemainsJarlessWhenWorkerURLMatchesAPIOrigin(t *testing.T) {
	var loginCalls atomic.Int32
	var proxyCalls atomic.Int32
	var jarlessWorkerCalls atomic.Int32
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path == "/api/auth/login" {
			loginCalls.Add(1)
			writeSessionLoginSuccess(w, "same-origin-session", "same-origin-cookie", "same-origin-token")
			return
		}
		if r.Header.Get("Cookie") != "" {
			proxyCalls.Add(1)
			http.Error(w, "proxy unavailable", http.StatusBadGateway)
			return
		}
		jarlessWorkerCalls.Add(1)
		if r.Header.Get("X-CSRF-Token") != "" {
			t.Error("same-origin worker fallback received CSRF material")
		}
		_ = json.NewEncoder(w).Encode(WorkerStatus{Running: true})
	}))
	defer server.Close()

	c := newWithSessionAuth(server.URL, server.URL, "dev", "same-origin-user", true, "same-origin-password", true)
	c.HTTP = server.Client()
	status, err := c.WorkerStatus(context.Background())
	if err != nil {
		t.Fatalf("same-origin jarless worker fallback failed: %v", err)
	}
	if !status.Running {
		t.Fatal("unexpected same-origin worker response")
	}
	if loginCalls.Load() != 1 || proxyCalls.Load() != 1 || jarlessWorkerCalls.Load() != 1 {
		t.Fatalf("unexpected same-origin counts login=%d proxy=%d worker=%d", loginCalls.Load(), proxyCalls.Load(), jarlessWorkerCalls.Load())
	}
}

func TestWorkerStatusDoesNotFallbackOnAuthenticationError(t *testing.T) {
	tests := []struct {
		name      string
		status    int
		preflight bool
	}{
		{name: "preflight", preflight: true},
		{name: "login 401", status: -http.StatusUnauthorized},
		{name: "application 401", status: http.StatusUnauthorized},
		{name: "application 403", status: http.StatusForbidden},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			var workerCalls atomic.Int32
			worker := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				workerCalls.Add(1)
				_ = json.NewEncoder(w).Encode(WorkerStatus{})
			}))
			defer worker.Close()

			var apiCalls atomic.Int32
			api := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				if r.URL.Path == "/api/auth/login" {
					apiCalls.Add(1)
					if tt.status < 0 {
						http.Error(w, "login rejected", -tt.status)
						return
					}
					writeSessionLoginSuccess(w, "worker-auth-session", "worker-auth-cookie", "worker-auth-token")
					return
				}
				apiCalls.Add(1)
				http.Error(w, "proxy auth failure", tt.status)
			}))
			defer api.Close()

			var c *Client
			if tt.preflight {
				c = newWithSessionAuth(api.URL, worker.URL, "dev", "partial-user", true, "", false)
			} else {
				c = newWithSessionAuth(api.URL, worker.URL, "dev", "worker-auth-user", true, "worker-auth-password", true)
			}
			c.HTTP = api.Client()
			_, err := c.WorkerStatus(context.Background())
			if err == nil || !isAuthenticationError(err) {
				t.Fatalf("expected typed authentication error, got %v", err)
			}
			if got := workerCalls.Load(); got != 0 {
				t.Fatalf("worker fallback received %d requests", got)
			}
		})
	}
}

func TestWorkerStatusUsesAPIProxyWhenSuccessful(t *testing.T) {
	var proxyCalls int
	proxy := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		proxyCalls++
		if r.URL.Path != "/worker/status" {
			t.Fatalf("unexpected proxy path: %s", r.URL.Path)
		}
		_ = json.NewEncoder(w).Encode(WorkerStatus{
			Running:       true,
			JobsExecuted:  5,
			ScheduleType:  "cron",
			ScheduleValue: "0 9 * * *",
			Jobs: []WorkerJob{{
				ID:      "workspace_summary:dev:daily-ops",
				Name:    "Summary Profile: dev / Daily Ops",
				NextRun: "2026-03-27T09:00:00Z",
				Trigger: "cron[0 9 * * *]",
			}},
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
	if status.ScheduleValue != "0 9 * * *" || len(status.Jobs) != 1 || status.Jobs[0].ID != "workspace_summary:dev:daily-ops" {
		t.Fatalf("expected schedule metadata and jobs to be preserved: %+v", status)
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
			Running:       false,
			JobsExecuted:  9,
			ScheduleType:  "interval",
			ScheduleValue: "30m",
			Jobs: []WorkerJob{{
				ID:      "crawl_analyze",
				Name:    "Crawl & Analyze",
				NextRun: "2026-03-27T00:30:00Z",
				Trigger: "interval[0:30:00]",
			}},
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
	if status.ScheduleType != "interval" || len(status.Jobs) != 1 || status.Jobs[0].ID != "crawl_analyze" {
		t.Fatalf("expected fallback status to include jobs metadata: %+v", status)
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
