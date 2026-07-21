package cmd

import (
	"bytes"
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync/atomic"
	"testing"
)

func TestResearchCommandRegistered(t *testing.T) {
	found := false
	for _, c := range rootCmd.Commands() {
		if c.Name() == "research" {
			found = true
			subs := map[string]bool{}
			for _, sub := range c.Commands() {
				subs[sub.Name()] = true
			}
			if !subs["company"] || !subs["ingest"] || !subs["parity"] {
				t.Fatalf("research subcommands incomplete: %v", subs)
			}
		}
	}
	if !found {
		t.Fatal("expected research command on root")
	}
}

func TestResearchCompanyUsesPersonaAndSignalsPath(t *testing.T) {
	setCommandSessionAuthEnvironment(t)
	setCLIOutput(t, "json")

	var paths []string
	var loginCalls atomic.Int32
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if handleCommandSessionLogin(t, w, r, &loginCalls) {
			return
		}
		assertCommandSessionRequest(t, r, r.Method != http.MethodGet)
		paths = append(paths, r.URL.Path+"?"+r.URL.RawQuery)
		switch {
		case strings.HasPrefix(r.URL.Path, "/api/research/companies/search"):
			w.Header().Set("Content-Type", "application/json")
			_ = json.NewEncoder(w).Encode(map[string]any{
				"success": true,
				"items": []map[string]string{
					{"companyKey": "pro-technic-machinery", "displayName": "宝力机械"},
				},
			})
		case strings.Contains(r.URL.Path, "/signals"):
			if r.URL.Query().Get("persona") != "sales" {
				t.Fatalf("expected persona=sales, got %q", r.URL.Query().Get("persona"))
			}
			w.Header().Set("Content-Type", "application/json")
			_ = json.NewEncoder(w).Encode(map[string]any{
				"success": true,
				"persona": "sales",
				"items": []map[string]any{
					{
						"_id":        "1",
						"companyKey": "pro-technic-machinery",
						"kind":       "sales_trigger",
						"title":      "t",
						"evidence":   map[string]any{"title": "t", "platform": "weibo", "seenAt": 1},
						"capturedAt": 1,
					},
				},
			})
		default:
			http.NotFound(w, r)
		}
	}))
	defer server.Close()
	setResumeCLIConfig(t, server.URL, "dev")

	cmd := newResearchCompanyCmd()
	buf := &bytes.Buffer{}
	cmd.SetOut(buf)
	cmd.SetErr(buf)
	cmd.SetArgs([]string{"宝力机械", "--persona", "sales"})
	if err := cmd.Execute(); err != nil {
		t.Fatalf("execute: %v\n%s", err, buf.String())
	}
	joined := strings.Join(paths, "\n")
	if !strings.Contains(joined, "/api/research/companies/search") {
		t.Fatalf("expected search path, got %s", joined)
	}
	if !strings.Contains(joined, "/api/research/companies/pro-technic-machinery/signals") {
		t.Fatalf("expected signals path, got %s", joined)
	}
}

func TestResearchIngestPostsRunPath(t *testing.T) {
	setCommandSessionAuthEnvironment(t)
	setCLIOutput(t, "json")

	var method, path string
	var loginCalls atomic.Int32
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if handleCommandSessionLogin(t, w, r, &loginCalls) {
			return
		}
		assertCommandSessionRequest(t, r, true)
		method = r.Method
		path = r.URL.Path
		_, _ = io.Copy(io.Discard, r.Body)
		w.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(w).Encode(map[string]any{
			"success": true,
			"mode":    "research-ingest",
			"message": "ok",
		})
	}))
	defer server.Close()
	setResumeCLIConfig(t, server.URL, "dev")

	cmd := newResearchIngestCmd()
	buf := &bytes.Buffer{}
	cmd.SetOut(buf)
	cmd.SetArgs([]string{"--once"})
	if err := cmd.Execute(); err != nil {
		t.Fatalf("execute: %v", err)
	}
	if method != http.MethodPost || path != "/api/research/ingest/run" {
		t.Fatalf("unexpected call %s %s", method, path)
	}
}
