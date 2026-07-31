package cmd

import (
	"bytes"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync/atomic"
	"testing"
)

func TestIndustryCommandTreeIsReadOnly(t *testing.T) {
	cmd := newIndustryCmd()
	seen := map[string]bool{}
	for _, child := range cmd.Commands() {
		seen[child.Name()] = true
		if strings.Contains(child.Name(), "approve") {
			t.Fatalf("industry command must not expose approval: %s", child.Name())
		}
	}
	for _, name := range []string{"review", "inspect", "recommend", "review-packet", "open"} {
		if !seen[name] {
			t.Fatalf("missing industry subcommand %q", name)
		}
	}
}

func TestIndustryReviewCommandUsesReadyQueueByDefault(t *testing.T) {
	setCommandSessionAuthEnvironment(t)
	setCLIOutput(t, "json")
	var loginCalls atomic.Int32
	var gotPath string
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if handleCommandSessionLogin(t, w, r, &loginCalls) {
			return
		}
		assertCommandSessionRequest(t, r, false)
		gotPath = r.URL.RequestURI()
		w.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(w).Encode(map[string]any{
			"success": true, "ok": true, "schemaVersion": "industry-review.v1",
			"items": []map[string]any{{
				"proposal":       map[string]any{"proposalId": "p-1", "companyKey": "acme-cnc", "status": "ready_for_review"},
				"recommendation": map[string]any{"proposalId": "p-1", "recommendedAction": "approve", "confidenceBand": "high", "recommendedIndustryClass": "cnc", "riskFlags": []string{}},
				"sourceCount":    1,
			}},
		})
	}))
	defer server.Close()
	setResumeCLIConfig(t, server.URL, "dev")

	cmd := newIndustryReviewCmd()
	var output bytes.Buffer
	cmd.SetOut(&output)
	if err := cmd.Execute(); err != nil {
		t.Fatalf("execute: %v", err)
	}
	if gotPath != "/api/company-industry-proposals/review-queue?limit=20&status=ready_for_review" {
		t.Fatalf("unexpected queue path: %s", gotPath)
	}
	if payload := decodeCommandJSON(t, output); payload["schemaVersion"] != "industry-review.v1" {
		t.Fatalf("unexpected output: %v", payload)
	}
}

func TestIndustryOpenCommandPrintsHumanApprovalLink(t *testing.T) {
	setCLIOutput(t, "json")
	original := currentOptions().WebURL
	t.Cleanup(func() { setCLIOutput(t, "agent"); _ = original })
	// The persistent flag is backed by Viper, so use the same configuration path
	// as callers of the CLI instead of reaching into command-local state.
	setResumeCLIConfig(t, "http://localhost:3000", "dev")
	// setResumeCLIConfig intentionally leaves the web URL at its configured default.
	cmd := newIndustryOpenCmd()
	var output bytes.Buffer
	cmd.SetOut(&output)
	cmd.SetArgs([]string{"proposal/1"})
	if err := cmd.Execute(); err != nil {
		t.Fatalf("execute: %v", err)
	}
	payload := decodeCommandJSON(t, output)
	if !strings.Contains(payload["url"].(string), "proposalId=proposal%2F1") {
		t.Fatalf("unexpected open link: %v", payload)
	}
	if !strings.Contains(payload["action"].(string), "human approval") {
		t.Fatalf("open link did not preserve human approval boundary: %v", payload)
	}
}
