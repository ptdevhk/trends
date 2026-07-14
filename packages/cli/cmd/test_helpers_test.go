package cmd

import (
	"bytes"
	"encoding/json"
	"net/http"
	"sync/atomic"
	"testing"

	"github.com/spf13/viper"
)

const (
	commandAuthUsername  = "command-auth-user"
	commandAuthPassword  = "command-auth-password"
	commandSessionCookie = "command-session-cookie"
	commandCSRFToken     = "command-json-csrf-token"
)

func setCommandSessionAuthEnvironment(t *testing.T) {
	t.Helper()
	t.Setenv("TRENDS_AUTH_USERNAME", commandAuthUsername)
	t.Setenv("TRENDS_AUTH_PASSWORD", commandAuthPassword)
}

func handleCommandSessionLogin(t *testing.T, w http.ResponseWriter, r *http.Request, loginCalls *atomic.Int32) bool {
	t.Helper()
	if r.URL.Path != "/api/auth/login" {
		return false
	}
	loginCalls.Add(1)
	if r.Header.Get("Cookie") != "" || r.Header.Get("X-CSRF-Token") != "" {
		t.Error("command login request carried prior session material")
	}
	http.SetCookie(w, &http.Cookie{Name: "command_session", Value: commandSessionCookie, Path: "/", HttpOnly: true})
	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(map[string]any{"success": true, "csrfToken": commandCSRFToken})
	return true
}

func assertCommandSessionRequest(t *testing.T, r *http.Request, wantCSRF bool) {
	t.Helper()
	cookie, err := r.Cookie("command_session")
	if err != nil || cookie.Value != commandSessionCookie {
		t.Error("command application request did not carry the shared session cookie")
	}
	csrf := r.Header.Get("X-CSRF-Token")
	if wantCSRF && csrf != commandCSRFToken {
		t.Error("command unsafe request did not carry the shared JSON CSRF token")
	}
	if !wantCSRF && csrf != "" {
		t.Error("command safe request unexpectedly carried a CSRF token")
	}
}

func setResumeCLIConfig(t *testing.T, apiURL string, workspace string) {
	t.Helper()
	setResumeCLIConfigURLs(t, apiURL, apiURL, workspace)
}

func setResumeCLIConfigURLs(t *testing.T, apiURL string, workerURL string, workspace string) {
	t.Helper()

	originalAPIURL := viper.GetString("api_url")
	originalWorkerURL := viper.GetString("worker_url")
	originalWorkspace := viper.GetString("workspace")
	t.Cleanup(func() {
		viper.Set("api_url", originalAPIURL)
		viper.Set("worker_url", originalWorkerURL)
		viper.Set("workspace", originalWorkspace)
	})

	viper.Set("api_url", apiURL)
	viper.Set("worker_url", workerURL)
	viper.Set("workspace", workspace)
}

func setCLIOutput(t *testing.T, output string) {
	t.Helper()

	originalOutput := viper.GetString("output")
	t.Cleanup(func() {
		viper.Set("output", originalOutput)
	})
	viper.Set("output", output)
}

func decodeCommandJSON(t *testing.T, output bytes.Buffer) map[string]any {
	t.Helper()

	var payload map[string]any
	if err := json.Unmarshal(output.Bytes(), &payload); err != nil {
		t.Fatalf("failed to decode command output: %v\noutput=%s", err, output.String())
	}
	return payload
}
