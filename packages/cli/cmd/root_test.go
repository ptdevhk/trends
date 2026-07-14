package cmd

import (
	"bytes"
	"context"
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"os"
	"strings"
	"sync/atomic"
	"testing"

	"github.com/spf13/viper"
)

type rootRoundTripFunc func(*http.Request) (*http.Response, error)

func (f rootRoundTripFunc) RoundTrip(req *http.Request) (*http.Response, error) {
	return f(req)
}

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

func TestDefaultOutputIsAgent(t *testing.T) {
	if got := defaultOutput; got != "agent" {
		t.Fatalf("expected default output agent, got %q", got)
	}
}

func TestRootDefinesNoCredentialOrPasswordFlag(t *testing.T) {
	for _, name := range []string{"username", "password", "auth-username", "auth-password", "auth-secret"} {
		if flag := rootCmd.PersistentFlags().Lookup(name); flag != nil {
			t.Fatalf("root command must not define credential flag --%s", name)
		}
		if flag := rootCmd.Flags().Lookup(name); flag != nil {
			t.Fatalf("root command must not define credential flag --%s", name)
		}
	}
}

func TestRootAPIClientFactoryUsesSessionAuthEnvironment(t *testing.T) {
	originalAPIURL := viper.GetString("api_url")
	originalWorkerURL := viper.GetString("worker_url")
	originalWorkspace := viper.GetString("workspace")
	t.Cleanup(func() {
		viper.Set("api_url", originalAPIURL)
		viper.Set("worker_url", originalWorkerURL)
		viper.Set("workspace", originalWorkspace)
	})
	viper.Set("api_url", "http://127.0.0.1:3000")
	viper.Set("worker_url", "http://127.0.0.1:8000")
	viper.Set("workspace", "dev")

	t.Setenv("TRENDS_AUTH_USERNAME", "root-factory-user-marker")
	t.Setenv("TRENDS_AUTH_PASSWORD", "test-environment-placeholder")
	if err := os.Unsetenv("TRENDS_AUTH_PASSWORD"); err != nil {
		t.Fatalf("unset TRENDS_AUTH_PASSWORD: %v", err)
	}

	var requests atomic.Int32
	apiClient := newAPIClient()
	apiClient.HTTP = &http.Client{Transport: rootRoundTripFunc(func(req *http.Request) (*http.Response, error) {
		requests.Add(1)
		return &http.Response{
			StatusCode: http.StatusOK,
			Status:     http.StatusText(http.StatusOK),
			Header:     make(http.Header),
			Body:       io.NopCloser(strings.NewReader(`{}`)),
			Request:    req,
		}, nil
	})}

	_, err := apiClient.GetSystemMetadata(context.Background())
	if err == nil {
		t.Fatal("expected partial authentication environment to fail")
	}
	if got := requests.Load(); got != 0 {
		t.Fatalf("expected authentication configuration failure before network, got %d requests", got)
	}
	if !strings.Contains(err.Error(), "TRENDS_AUTH_USERNAME") || !strings.Contains(err.Error(), "TRENDS_AUTH_PASSWORD") {
		t.Fatalf("unexpected authentication error: %v", err)
	}
	if strings.Contains(err.Error(), "root-factory-user-marker") {
		t.Fatalf("credential leaked in authentication error: %v", err)
	}
}

func TestCobraPublicErrorSinkBoundsAndRedactsAuthenticationError(t *testing.T) {
	setCommandSessionAuthEnvironment(t)
	var loginCalls atomic.Int32
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if handleCommandSessionLogin(t, w, r, &loginCalls) {
			return
		}
		assertCommandSessionRequest(t, r, true)
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusBadRequest)
		_ = json.NewEncoder(w).Encode(map[string]string{
			"error": strings.Join([]string{
				commandAuthUsername,
				commandAuthPassword,
				commandSessionCookie,
				commandCSRFToken,
				strings.Repeat("cobra-long-reflection-", 500),
			}, " "),
		})
	}))
	defer server.Close()
	setResumeCLIConfig(t, server.URL, "dev")

	cmd := newResumeArchiveCmd()
	cmd.SilenceErrors = true
	cmd.SilenceUsage = true
	var output bytes.Buffer
	cmd.SetOut(&output)
	cmd.SetErr(&output)
	cmd.SetArgs([]string{"resume-1"})
	err := executeCobraCommand(cmd)
	if err == nil {
		t.Fatal("expected bounded Cobra authentication error")
	}
	publicText := err.Error()
	if len(publicText) > 2048 {
		t.Fatalf("Cobra public error exceeded 2048 bytes: %d", len(publicText))
	}
	for _, secret := range []string{commandAuthUsername, commandAuthPassword, commandSessionCookie, commandCSRFToken} {
		if strings.Contains(publicText, secret) {
			t.Fatal("authentication material leaked from Cobra public error")
		}
	}
	if !strings.Contains(publicText, "archive resumes:") || !strings.Contains(publicText, "[REDACTED]") {
		t.Fatalf("useful Cobra error context was lost: %v", err)
	}
	if got := loginCalls.Load(); got != 1 {
		t.Fatalf("expected one Cobra login, got %d", got)
	}
}

func TestCobraPublicErrorSinkPreservesUsefulShortError(t *testing.T) {
	cmd := newResumeMatchCmd()
	cmd.SilenceErrors = true
	cmd.SilenceUsage = true
	err := executeCobraCommand(cmd)
	if err == nil {
		t.Fatal("expected resume-match validation error")
	}
	if got, want := err.Error(), "query or job-description is required"; got != want {
		t.Fatalf("short Cobra error changed: got %q want %q", got, want)
	}
}

func TestPersistentPreRunEValidatesAgentOutput(t *testing.T) {
	originalOutput := viper.GetString("output")
	defer viper.Set("output", originalOutput)

	valid := []string{"agent", "table", "json", "csv", " AGENT "}
	for _, format := range valid {
		viper.Set("output", format)
		if err := rootCmd.PersistentPreRunE(rootCmd, nil); err != nil {
			t.Fatalf("expected valid output format %q, got error: %v", format, err)
		}
	}

	viper.Set("output", "xml")
	err := rootCmd.PersistentPreRunE(rootCmd, nil)
	if err == nil {
		t.Fatal("expected invalid output format error")
	}
	if !strings.Contains(err.Error(), "agent|table|json|csv") {
		t.Fatalf("expected error to list valid formats, got %q", err.Error())
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
