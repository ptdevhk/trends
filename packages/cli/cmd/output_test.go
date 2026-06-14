package cmd

import (
	"bytes"
	"strings"
	"testing"

	"github.com/spf13/cobra"
)

func TestWriteOutputJSON(t *testing.T) {
	setCLIOutput(t, "json")

	cmd := &cobra.Command{}
	var out bytes.Buffer
	cmd.SetOut(&out)

	payload := map[string]string{"hello": "world"}
	if err := writeOutput(cmd, []string{"k"}, [][]string{{"v"}}, payload); err != nil {
		t.Fatalf("writeOutput json failed: %v", err)
	}

	decoded := decodeCommandJSON(t, out)
	if decoded["hello"] != "world" {
		t.Fatalf("unexpected json output: %s", out.String())
	}
}

func TestWriteOutputTable(t *testing.T) {
	setCLIOutput(t, "table")

	cmd := &cobra.Command{}
	var out bytes.Buffer
	cmd.SetOut(&out)

	if err := writeOutput(cmd, []string{"col1", "col2"}, [][]string{{"a", "b"}}, map[string]string{"raw": "ignored"}); err != nil {
		t.Fatalf("writeOutput table failed: %v", err)
	}

	text := out.String()
	if !strings.Contains(text, "COL1") || !strings.Contains(text, "COL2") {
		t.Fatalf("missing headers in table output: %s", text)
	}
	if !strings.Contains(text, "a") || !strings.Contains(text, "b") {
		t.Fatalf("missing row values in table output: %s", text)
	}
	if !strings.HasSuffix(text, "\n") {
		t.Fatalf("table output should end with newline: %q", text)
	}
}

func TestWriteOutputInvalidFormatter(t *testing.T) {
	setCLIOutput(t, "invalid-format")

	cmd := &cobra.Command{}
	var out bytes.Buffer
	cmd.SetOut(&out)

	if err := writeOutput(cmd, nil, nil, struct{}{}); err == nil {
		t.Fatalf("writeOutput with invalid formatter should error")
	}
}

func TestWriteMessageDefault(t *testing.T) {
	setCLIOutput(t, "")

	cmd := &cobra.Command{}
	var out bytes.Buffer
	cmd.SetOut(&out)

	if err := writeMessage(cmd, "hello there"); err != nil {
		t.Fatalf("writeMessage failed: %v", err)
	}
	if got := strings.TrimRight(out.String(), "\n"); got != "hello there" {
		t.Fatalf("writeMessage default = %q, want %q", got, "hello there")
	}
}

func TestWriteMessageJSON(t *testing.T) {
	setCLIOutput(t, "json")

	cmd := &cobra.Command{}
	var out bytes.Buffer
	cmd.SetOut(&out)

	if err := writeMessage(cmd, "ok"); err != nil {
		t.Fatalf("writeMessage json failed: %v", err)
	}
	decoded := decodeCommandJSON(t, out)
	if decoded["message"] != "ok" {
		t.Fatalf("unexpected json output: %s", out.String())
	}
}

func TestWriteMessageAgent(t *testing.T) {
	setCLIOutput(t, "agent")

	cmd := &cobra.Command{}
	var out bytes.Buffer
	cmd.SetOut(&out)

	if err := writeMessage(cmd, "done"); err != nil {
		t.Fatalf("writeMessage agent failed: %v", err)
	}
	text := strings.TrimRight(out.String(), "\n")
	if !strings.Contains(text, "kind=message") || !strings.Contains(text, "message=done") {
		t.Fatalf("writeMessage agent output missing expected fields: %s", text)
	}
}

func TestWriteAgentSummary(t *testing.T) {
	setCLIOutput(t, "agent")

	cmd := &cobra.Command{}
	var out bytes.Buffer
	cmd.SetOut(&out)

	if err := writeAgentSummary(cmd, nil); err != nil {
		t.Fatalf("writeAgentSummary with nil fields failed: %v", err)
	}
	text := strings.TrimRight(out.String(), "\n")
	if !strings.Contains(text, "kind=summary") {
		t.Fatalf("writeAgentSummary should emit kind=summary: %s", text)
	}
}
