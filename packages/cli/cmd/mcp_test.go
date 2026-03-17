package cmd

import (
	"bufio"
	"bytes"
	"context"
	"encoding/json"
	"strconv"
	"strings"
	"testing"
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

func TestMCPToolsIncludeResumeDebugReadOnlyTools(t *testing.T) {
	tools := mcpTools()
	names := make(map[string]bool, len(tools))
	for _, tool := range tools {
		name, _ := tool["name"].(string)
		names[name] = true
	}

	for _, required := range []string{"resume_matches", "resume_match_runs", "resume_skills_version"} {
		if !names[required] {
			t.Fatalf("missing MCP tool %q", required)
		}
	}
}
