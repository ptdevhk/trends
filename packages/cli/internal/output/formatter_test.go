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
