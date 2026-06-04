package output

import (
	"strings"
	"testing"
)

func TestNewFormatter(t *testing.T) {
	valid := []string{"table", "json", "csv"}
	for _, name := range valid {
		formatter, err := NewFormatter(name)
		if err != nil {
			t.Fatalf("NewFormatter(%q) returned error: %v", name, err)
		}
		if formatter == nil {
			t.Fatalf("NewFormatter(%q) returned nil formatter", name)
		}
	}

	if _, err := NewFormatter("xml"); err == nil {
		t.Fatal("expected error for unsupported formatter")
	}
}

func TestJSONFormatter(t *testing.T) {
	formatter := &JSONFormatter{}
	output, err := formatter.Format(TabularData{
		Headers: []string{"name", "score"},
		Rows: [][]string{
			{"Alice", "91"},
			{"Bob"},
		},
	})
	if err != nil {
		t.Fatalf("JSON formatter returned error: %v", err)
	}

	text := string(output)
	if !strings.Contains(text, `"name": "Alice"`) {
		t.Fatalf("unexpected JSON output: %s", text)
	}
	if !strings.Contains(text, `"score": ""`) {
		t.Fatalf("expected missing cell to be empty string: %s", text)
	}
}

func TestCSVFormatter(t *testing.T) {
	formatter := &CSVFormatter{}
	output, err := formatter.Format(TabularData{
		Headers: []string{"name", "score"},
		Rows: [][]string{
			{"Alice", "91"},
			{"Bob", "88"},
		},
	})
	if err != nil {
		t.Fatalf("CSV formatter returned error: %v", err)
	}

	text := string(output)
	if !strings.Contains(text, "name,score") || !strings.Contains(text, "Alice,91") {
		t.Fatalf("unexpected CSV output: %s", text)
	}
}

func TestNewFormatterSupportsAgent(t *testing.T) {
	formatter, err := NewFormatter("agent")
	if err != nil {
		t.Fatalf("NewFormatter(agent) returned error: %v", err)
	}
	if formatter == nil {
		t.Fatal("NewFormatter(agent) returned nil formatter")
	}
}

func TestAgentFormatterFormatsKeyValueRows(t *testing.T) {
	formatter := &AgentFormatter{}
	output, err := formatter.Format(TabularData{
		Headers: []string{"Resume ID", "name", "score", "empty"},
		Rows: [][]string{
			{"resume-1", "Alice Chow", "91", ""},
			{"resume-2", "Bob=Ops", "", "x|y"},
		},
	})
	if err != nil {
		t.Fatalf("Agent formatter returned error: %v", err)
	}

	want := strings.Join([]string{
		`resume_id=resume-1 name="Alice Chow" score=91 empty=-`,
		`resume_id=resume-2 name="Bob=Ops" score=- empty="x|y"`,
		"",
	}, "\n")
	if string(output) != want {
		t.Fatalf("unexpected agent output:\nwant=%q\ngot=%q", want, string(output))
	}
}

func TestAgentFormatterHandlesMissingCells(t *testing.T) {
	formatter := &AgentFormatter{}
	output, err := formatter.Format(TabularData{
		Headers: []string{"id", "status"},
		Rows:    [][]string{{"task-1"}},
	})
	if err != nil {
		t.Fatalf("Agent formatter returned error: %v", err)
	}
	if got := string(output); got != "id=task-1 status=-\n" {
		t.Fatalf("unexpected output: %q", got)
	}
}
