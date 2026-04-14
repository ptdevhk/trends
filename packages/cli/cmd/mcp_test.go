package cmd

import (
	"bufio"
	"bytes"
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strconv"
	"strings"
	"testing"

	"github.com/ptdevhk/trends/packages/cli/internal/client"
)

func TestReadMCPMessage(t *testing.T) {
	payload := `{"jsonrpc":"2.0","id":1,"method":"ping"}`
	message := "Content-Length: " + strconv.Itoa(len(payload)) + "\r\n\r\n" + payload
	reader := bufio.NewReader(strings.NewReader(message))

	raw, err := readMCPMessage(reader)
	if err != nil {
		t.Fatalf("readMCPMessage returned error: %v", err)
	}
	if string(raw) != payload {
		t.Fatalf("unexpected payload: %s", string(raw))
	}
}

func TestReadMCPMessageMissingHeader(t *testing.T) {
	reader := bufio.NewReader(strings.NewReader("\r\n{}"))
	_, err := readMCPMessage(reader)
	if err == nil {
		t.Fatal("expected error for missing Content-Length")
	}
}

func TestWriteMCPResult(t *testing.T) {
	var buffer bytes.Buffer
	writer := bufio.NewWriter(&buffer)

	if err := writeMCPResult(writer, json.RawMessage("1"), map[string]any{"ok": true}); err != nil {
		t.Fatalf("writeMCPResult returned error: %v", err)
	}

	output := buffer.String()
	if !strings.Contains(output, "Content-Length:") {
		t.Fatalf("missing Content-Length header: %q", output)
	}
	if !strings.Contains(output, `"jsonrpc":"2.0"`) {
		t.Fatalf("missing jsonrpc payload: %q", output)
	}
	if !strings.Contains(output, `"result":{"ok":true}`) {
		t.Fatalf("missing result payload: %q", output)
	}
}

func TestHandleMCPRequestInitialize(t *testing.T) {
	SetVersion("1.2.3")

	response, err := handleMCPRequest(context.Background(), mcpRequest{
		Method: "initialize",
	})
	if err != nil {
		t.Fatalf("handleMCPRequest returned error: %v", err)
	}

	payload, ok := response.(map[string]any)
	if !ok {
		t.Fatalf("expected map response, got %T", response)
	}
	serverInfo, ok := payload["serverInfo"].(map[string]any)
	if !ok {
		t.Fatalf("missing serverInfo: %#v", payload)
	}
	if serverInfo["version"] != "1.2.3" {
		t.Fatalf("unexpected server version: %#v", serverInfo["version"])
	}
}

func TestHandleMCPRequestToolsCallUnknownTool(t *testing.T) {
	params, err := json.Marshal(mcpToolCallParams{
		Name:      "unknown_tool",
		Arguments: map[string]interface{}{},
	})
	if err != nil {
		t.Fatalf("json marshal failed: %v", err)
	}

	response, err := handleMCPRequest(context.Background(), mcpRequest{
		Method: "tools/call",
		Params: params,
	})
	if err != nil {
		t.Fatalf("handleMCPRequest returned error: %v", err)
	}

	payload, ok := response.(map[string]any)
	if !ok {
		t.Fatalf("expected map response, got %T", response)
	}
	if payload["isError"] != true {
		t.Fatalf("expected isError=true, got %#v", payload["isError"])
	}
}

func TestHandleMCPRequestUnknownMethod(t *testing.T) {
	_, err := handleMCPRequest(context.Background(), mcpRequest{Method: "unknown"})
	if err == nil {
		t.Fatal("expected method not found error")
	}
}

func TestArgumentHelpers(t *testing.T) {
	args := map[string]interface{}{
		"intFloat":   float64(12),
		"intString":  "9",
		"text":       "hello",
		"boolRaw":    true,
		"boolString": "false",
	}

	if got := intArg(args, "intFloat", 0); got != 12 {
		t.Fatalf("intArg float64 expected 12, got %d", got)
	}
	if got := intArg(args, "intString", 0); got != 9 {
		t.Fatalf("intArg string expected 9, got %d", got)
	}
	if got := intArg(args, "missing", 3); got != 3 {
		t.Fatalf("intArg default expected 3, got %d", got)
	}

	if got := stringArg(args, "text", "x"); got != "hello" {
		t.Fatalf("stringArg expected hello, got %q", got)
	}
	if got := stringArg(args, "missing", "fallback"); got != "fallback" {
		t.Fatalf("stringArg default expected fallback, got %q", got)
	}

	if got := boolArg(args, "boolRaw", false); got != true {
		t.Fatalf("boolArg raw expected true, got %v", got)
	}
	if got := boolArg(args, "boolString", true); got != false {
		t.Fatalf("boolArg string expected false, got %v", got)
	}
	if got := boolArg(args, "missing", true); got != true {
		t.Fatalf("boolArg default expected true, got %v", got)
	}
}

func TestRunMCPMigrationWithLimitForRunnerUsesManual51jobBatchSize(t *testing.T) {
	var gotArgs []string

	runner := func(ctx context.Context, migration string, extraArgs ...string) (string, error) {
		gotArgs = append([]string(nil), extraArgs...)
		return `{"ok":true}`, nil
	}

	if _, err := runMCPMigrationWithLimitForRunner(context.Background(), map[string]interface{}{"limit": float64(3)}, backfillManual51jobMigration, runner); err != nil {
		t.Fatalf("runMCPMigrationWithLimitForRunner returned error: %v", err)
	}
	if len(gotArgs) != 1 || gotArgs[0] != `{"batchSize":3}` {
		t.Fatalf("unexpected migration args: %+v", gotArgs)
	}
}

func TestMCPToolsIncludeResumeDebugReadOnlyTools(t *testing.T) {
	tools := mcpTools()
	names := make(map[string]bool, len(tools))
	for _, tool := range tools {
		name, _ := tool["name"].(string)
		names[name] = true
	}

	for _, required := range []string{"resume_matches", "resume_match_runs", "resume_skills_version", "resume_clear_analyses", "migrate_backfill_manual_51job"} {
		if !names[required] {
			t.Fatalf("missing MCP tool %q", required)
		}
	}
}

func TestRunMCPToolResumeClearAnalyses(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/api/resumes/clear-analyses" {
			t.Fatalf("unexpected path: %s", r.URL.Path)
		}
		_ = json.NewEncoder(w).Encode(client.ClearAnalysesAPIResponse{
			Success:         true,
			Cleared:         2,
			Batches:         1,
			Targeted:        true,
			JobDescriptionID: "lathe-sales",
		})
	}))
	defer server.Close()

	setResumeCLIConfig(t, server.URL, "dev")

	text, err := runMCPTool(context.Background(), "resume_clear_analyses", map[string]interface{}{
		"jobDescriptionId": "lathe-sales",
		"resumeIds":        []interface{}{"resume-1", "resume-2"},
	})
	if err != nil {
		t.Fatalf("runMCPTool returned error: %v", err)
	}
	if !strings.Contains(text, `"cleared": 2`) || !strings.Contains(text, `"targeted": true`) {
		t.Fatalf("unexpected MCP tool output: %s", text)
	}
}

func TestRunMCPToolJDList(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/api/job-descriptions" {
			t.Fatalf("unexpected path: %s", r.URL.Path)
		}
		_ = json.NewEncoder(w).Encode(client.JobDescriptionsResponse{
			Success: true,
			Items: []client.JobDescriptionFile{{
				Name:   "cnc-sales",
				Title:  "CNC Sales",
				Status: "active",
			}},
		})
	}))
	defer server.Close()

	setResumeCLIConfig(t, server.URL, "hr")

	text, err := runMCPTool(context.Background(), "jd_list", nil)
	if err != nil {
		t.Fatalf("runMCPTool returned error: %v", err)
	}
	if !strings.Contains(text, "cnc-sales") || !strings.Contains(text, "CNC Sales") {
		t.Fatalf("unexpected MCP tool output: %s", text)
	}
}

func TestRunMCPToolWorkerStatus(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/worker/status" {
			t.Fatalf("unexpected path: %s", r.URL.Path)
		}
		_ = json.NewEncoder(w).Encode(client.WorkerStatus{
			Running:       true,
			JobsExecuted:  4,
			ScheduleType:  "cron",
			ScheduleValue: "0 9 * * *",
			Jobs: []client.WorkerJob{{
				ID:      "workspace_summary:dev:daily-ops",
				Name:    "Summary Profile: dev / Daily Ops",
				NextRun: "2026-03-27T09:00:00Z",
				Trigger: "cron[0 9 * * *]",
			}},
		})
	}))
	defer server.Close()

	setResumeCLIConfig(t, server.URL, "ops")

	text, err := runMCPTool(context.Background(), "worker_status", nil)
	if err != nil {
		t.Fatalf("runMCPTool returned error: %v", err)
	}
	if !strings.Contains(text, `"jobs_executed": 4`) || !strings.Contains(text, `"running": true`) {
		t.Fatalf("unexpected MCP tool output: %s", text)
	}
	if !strings.Contains(text, `"schedule_value": "0 9 * * *"`) || !strings.Contains(text, `"id": "workspace_summary:dev:daily-ops"`) {
		t.Fatalf("unexpected MCP tool output: %s", text)
	}
}

func TestRunMCPToolCrawlTrigger(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/worker/crawl" {
			t.Fatalf("unexpected path: %s", r.URL.Path)
		}
		if r.Method != http.MethodPost {
			t.Fatalf("unexpected method: %s", r.Method)
		}
		_ = json.NewEncoder(w).Encode(client.WorkerTriggerResponse{
			Success: true,
			Mode:    "crawl",
			Message: "crawl started",
		})
	}))
	defer server.Close()

	setResumeCLIConfig(t, server.URL, "ops")

	text, err := runMCPTool(context.Background(), "crawl_trigger", nil)
	if err != nil {
		t.Fatalf("runMCPTool returned error: %v", err)
	}
	if !strings.Contains(text, `"mode": "crawl"`) || !strings.Contains(text, `"message": "crawl started"`) {
		t.Fatalf("unexpected MCP tool output: %s", text)
	}
}

func TestRunMCPToolWorkerRunPassesOnceFlag(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/worker/run" {
			t.Fatalf("unexpected path: %s", r.URL.Path)
		}
		if got := r.URL.Query().Get("once"); got != "false" {
			t.Fatalf("expected once=false, got %q", got)
		}
		_ = json.NewEncoder(w).Encode(client.WorkerTriggerResponse{
			Success: true,
			Mode:    "scheduled",
			Message: "worker queued",
		})
	}))
	defer server.Close()

	setResumeCLIConfig(t, server.URL, "ops")

	text, err := runMCPTool(context.Background(), "worker_run", map[string]interface{}{"once": false})
	if err != nil {
		t.Fatalf("runMCPTool returned error: %v", err)
	}
	if !strings.Contains(text, `"mode": "scheduled"`) || !strings.Contains(text, `"message": "worker queued"`) {
		t.Fatalf("unexpected MCP tool output: %s", text)
	}
}

func TestRunMCPToolWorkerStatusFallsBackToWorkerURL(t *testing.T) {
	proxy := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		http.Error(w, "proxy unavailable", http.StatusBadGateway)
	}))
	defer proxy.Close()

	worker := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/worker/status" {
			t.Fatalf("unexpected path: %s", r.URL.Path)
		}
		_ = json.NewEncoder(w).Encode(client.WorkerStatus{
			Running:       false,
			JobsExecuted:  9,
			ScheduleType:  "interval",
			ScheduleValue: "30m",
			Jobs: []client.WorkerJob{{
				ID:      "crawl_analyze",
				Name:    "Crawl & Analyze",
				NextRun: "2026-03-27T00:30:00Z",
				Trigger: "interval[0:30:00]",
			}},
		})
	}))
	defer worker.Close()

	setResumeCLIConfigURLs(t, proxy.URL, worker.URL, "ops")

	text, err := runMCPTool(context.Background(), "worker_status", nil)
	if err != nil {
		t.Fatalf("runMCPTool returned error: %v", err)
	}
	if !strings.Contains(text, `"jobs_executed": 9`) || !strings.Contains(text, `"running": false`) {
		t.Fatalf("unexpected MCP tool output: %s", text)
	}
	if !strings.Contains(text, `"schedule_type": "interval"`) || !strings.Contains(text, `"id": "crawl_analyze"`) {
		t.Fatalf("unexpected MCP tool output: %s", text)
	}
}

func TestRunMCPToolCrawlTriggerRejectsUnsuccessfulResponse(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		_ = json.NewEncoder(w).Encode(client.WorkerTriggerResponse{
			Success: false,
			Mode:    "crawl",
		})
	}))
	defer server.Close()

	setResumeCLIConfig(t, server.URL, "ops")

	_, err := runMCPTool(context.Background(), "crawl_trigger", nil)
	if err == nil {
		t.Fatal("expected unsuccessful crawl trigger error")
	}
	if !strings.Contains(err.Error(), "not successful") {
		t.Fatalf("unexpected error: %v", err)
	}
}

func TestRunMCPToolWorkerRunRejectsUnsuccessfulResponse(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		_ = json.NewEncoder(w).Encode(client.WorkerTriggerResponse{
			Success: false,
			Mode:    "once",
		})
	}))
	defer server.Close()

	setResumeCLIConfig(t, server.URL, "ops")

	_, err := runMCPTool(context.Background(), "worker_run", map[string]interface{}{"once": true})
	if err == nil {
		t.Fatal("expected unsuccessful worker run error")
	}
	if !strings.Contains(err.Error(), "not successful") {
		t.Fatalf("unexpected error: %v", err)
	}
}

func TestRunMCPToolResumeHardResetReingest(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/api/resumes/hard-reset-reingest" {
			t.Fatalf("unexpected path: %s", r.URL.Path)
		}
		_ = json.NewEncoder(w).Encode(client.HardResetReingestResponse{
			Success:   true,
			Cleared:   25,
			Scheduled: 25,
			Batches:   1,
			Phase:     "scheduled",
		})
	}))
	defer server.Close()

	setResumeCLIConfig(t, server.URL, "dev")

	text, err := runMCPTool(context.Background(), "resume_hard_reset_reingest", map[string]interface{}{})
	if err != nil {
		t.Fatalf("runMCPTool returned error: %v", err)
	}
	if !strings.Contains(text, `"cleared": 25`) || !strings.Contains(text, `"phase": "scheduled"`) {
		t.Fatalf("unexpected MCP tool output: %s", text)
	}
}

func TestRunMCPToolResumeResetDatabase(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/api/resumes/reset-database" {
			t.Fatalf("unexpected path: %s", r.URL.Path)
		}
		_ = json.NewEncoder(w).Encode(client.ResetDatabaseResponse{
			Success: true,
			Count:   50,
			Partial: false,
			Deleted: map[string]int{"resumes": 50},
		})
	}))
	defer server.Close()

	setResumeCLIConfig(t, server.URL, "dev")

	text, err := runMCPTool(context.Background(), "resume_reset_database", map[string]interface{}{})
	if err != nil {
		t.Fatalf("runMCPTool returned error: %v", err)
	}
	if !strings.Contains(text, `"count": 50`) || !strings.Contains(text, `"resumes": 50`) {
		t.Fatalf("unexpected MCP tool output: %s", text)
	}
}
