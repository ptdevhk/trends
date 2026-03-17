package client

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"
)

func TestNewNormalizesURLs(t *testing.T) {
	c := New("http://api.local/", "http://worker.local///", " hr ")
	if c.APIURL != "http://api.local" {
		t.Fatalf("expected normalized APIURL, got %q", c.APIURL)
	}
	if c.WorkerURL != "http://worker.local" {
		t.Fatalf("expected normalized WorkerURL, got %q", c.WorkerURL)
	}
	if c.Workspace != "hr" {
		t.Fatalf("expected normalized workspace, got %q", c.Workspace)
	}
}

func TestDoJSONSuccess(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodPost {
			t.Fatalf("expected POST, got %s", r.Method)
		}
		if got := r.Header.Get("Content-Type"); got != "application/json" {
			t.Fatalf("expected Content-Type application/json, got %q", got)
		}
		if got := r.Header.Get("X-Workspace-Slug"); got != "hr" {
			t.Fatalf("expected workspace header hr, got %q", got)
		}
		_ = json.NewEncoder(w).Encode(map[string]any{"ok": true, "value": 42})
	}))
	defer server.Close()

	c := New(server.URL, server.URL, "hr")
	c.HTTP = server.Client()

	var target struct {
		OK    bool `json:"ok"`
		Value int  `json:"value"`
	}
	err := c.doJSON(context.Background(), http.MethodPost, server.URL, map[string]string{"a": "b"}, &target)
	if err != nil {
		t.Fatalf("doJSON returned error: %v", err)
	}
	if !target.OK || target.Value != 42 {
		t.Fatalf("unexpected decoded response: %+v", target)
	}
}

func TestDoJSONHTTPError(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		http.Error(w, "boom", http.StatusBadRequest)
	}))
	defer server.Close()

	c := New(server.URL, server.URL, "dev")
	c.HTTP = server.Client()

	err := c.doJSON(context.Background(), http.MethodGet, server.URL, nil, nil)
	if err == nil {
		t.Fatal("expected error for HTTP 400")
	}
	if !strings.Contains(err.Error(), "400") || !strings.Contains(err.Error(), "boom") {
		t.Fatalf("unexpected error: %v", err)
	}
}

func TestDoJSONInvalidJSON(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		_, _ = w.Write([]byte("{invalid"))
	}))
	defer server.Close()

	c := New(server.URL, server.URL, "dev")
	c.HTTP = server.Client()

	var target map[string]any
	err := c.doJSON(context.Background(), http.MethodGet, server.URL, nil, &target)
	if err == nil {
		t.Fatal("expected decode error")
	}
	if !strings.Contains(err.Error(), "decode response") {
		t.Fatalf("unexpected error: %v", err)
	}
}

func TestDoJSONTimeout(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		time.Sleep(100 * time.Millisecond)
		_, _ = w.Write([]byte(`{"ok":true}`))
	}))
	defer server.Close()

	c := New(server.URL, server.URL, "dev")
	c.HTTP = server.Client()

	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Millisecond)
	defer cancel()

	var target map[string]any
	err := c.doJSON(ctx, http.MethodGet, server.URL, nil, &target)
	if err == nil {
		t.Fatal("expected timeout error")
	}
	if !strings.Contains(err.Error(), "perform request") {
		t.Fatalf("unexpected timeout error: %v", err)
	}
}

func TestDoBinarySuccess(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if got := r.Header.Get("X-Workspace-Slug"); got != "hr" {
			t.Fatalf("expected workspace header hr, got %q", got)
		}
		w.Header().Set("Content-Disposition", `attachment; filename="x.csv"`)
		_, _ = w.Write([]byte("a,b\n1,2\n"))
	}))
	defer server.Close()

	c := New(server.URL, server.URL, "hr")
	c.HTTP = server.Client()

	payload, headers, err := c.doBinary(context.Background(), http.MethodPost, server.URL, map[string]string{"format": "csv"})
	if err != nil {
		t.Fatalf("doBinary returned error: %v", err)
	}
	if string(payload) != "a,b\n1,2\n" {
		t.Fatalf("unexpected binary payload: %q", string(payload))
	}
	if headers.Get("Content-Disposition") == "" {
		t.Fatal("expected Content-Disposition header")
	}
}
