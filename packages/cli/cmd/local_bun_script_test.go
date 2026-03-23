package cmd

import (
	"os"
	"path/filepath"
	"testing"
)

func TestBuildBunScriptArgsIncludesEnvFileWhenPresent(t *testing.T) {
	projectRoot := t.TempDir()
	envFilePath := filepath.Join(projectRoot, ".env")
	if err := os.WriteFile(envFilePath, []byte("OPENAI_API_KEY=test\n"), 0o644); err != nil {
		t.Fatalf("failed to write env file: %v", err)
	}

	args, err := buildBunScriptArgs(projectRoot, "scripts/resume/example.ts", []string{"--count", "20"})
	if err != nil {
		t.Fatalf("buildBunScriptArgs returned error: %v", err)
	}

	expected := []string{"--env-file", envFilePath, "scripts/resume/example.ts", "--count", "20"}
	if len(args) != len(expected) {
		t.Fatalf("unexpected args length: got %d want %d (%v)", len(args), len(expected), args)
	}
	for index, value := range expected {
		if args[index] != value {
			t.Fatalf("unexpected arg at %d: got %q want %q (%v)", index, args[index], value, args)
		}
	}
}

func TestBuildBunScriptArgsOmitsEnvFileWhenMissing(t *testing.T) {
	projectRoot := t.TempDir()

	args, err := buildBunScriptArgs(projectRoot, "scripts/resume/example.ts", []string{"--count", "20"})
	if err != nil {
		t.Fatalf("buildBunScriptArgs returned error: %v", err)
	}

	expected := []string{"scripts/resume/example.ts", "--count", "20"}
	if len(args) != len(expected) {
		t.Fatalf("unexpected args length: got %d want %d (%v)", len(args), len(expected), args)
	}
	for index, value := range expected {
		if args[index] != value {
			t.Fatalf("unexpected arg at %d: got %q want %q (%v)", index, args[index], value, args)
		}
	}
}
