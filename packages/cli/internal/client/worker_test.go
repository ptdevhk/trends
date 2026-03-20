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
