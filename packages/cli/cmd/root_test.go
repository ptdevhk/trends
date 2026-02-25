package cmd

import (
	"testing"

	"github.com/spf13/viper"
)

func TestNormalizeBaseURL(t *testing.T) {
	tests := []struct {
		name  string
		input string
		want  string
	}{
		{name: "trim and strip slashes", input: "  http://localhost:3000///  ", want: "http://localhost:3000"},
		{name: "empty", input: "   ", want: ""},
		{name: "already clean", input: "https://example.com", want: "https://example.com"},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			if got := normalizeBaseURL(tt.input); got != tt.want {
				t.Fatalf("normalizeBaseURL(%q) = %q, want %q", tt.input, got, tt.want)
			}
		})
	}
}

func TestPersistentPreRunEValidatesOutput(t *testing.T) {
	originalOutput := viper.GetString("output")
	defer viper.Set("output", originalOutput)

	viper.Set("output", " JSON ")
	if err := rootCmd.PersistentPreRunE(rootCmd, nil); err != nil {
		t.Fatalf("expected valid output format, got error: %v", err)
	}
	if got := viper.GetString("output"); got != "json" {
		t.Fatalf("expected normalized output json, got %q", got)
	}

	viper.Set("output", "xml")
	if err := rootCmd.PersistentPreRunE(rootCmd, nil); err == nil {
		t.Fatal("expected invalid output format error")
	}
}

func TestSetVersion(t *testing.T) {
	SetVersion("2.3.4")
	if got := currentVersion(); got != "2.3.4" {
		t.Fatalf("expected version 2.3.4, got %q", got)
	}
	if rootCmd.Version != "2.3.4" {
		t.Fatalf("expected rootCmd.Version 2.3.4, got %q", rootCmd.Version)
	}
}
