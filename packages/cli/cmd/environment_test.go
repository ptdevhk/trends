package cmd

import (
	"bytes"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"os"
	"os/exec"
	"strings"
	"sync/atomic"
	"testing"

	"github.com/ptdevhk/trends/packages/cli/internal/client"
)

const (
	commandTestParentAuthHelper = "TRENDS_TEST_PARENT_AUTH_HELPER"
	commandTestAuthUsername     = "TRENDS_AUTH_USERNAME"
	commandTestAuthPassword     = "TRENDS_AUTH_PASSWORD"
)

func TestMain(m *testing.M) {
	for _, name := range []string{commandTestAuthUsername, commandTestAuthPassword} {
		if err := os.Unsetenv(name); err != nil {
			_, _ = fmt.Fprintf(os.Stderr, "clear %s before command tests: %v\n", name, err)
			os.Exit(1)
		}
	}
	os.Exit(m.Run())
}

func TestCommandSuiteClearsAmbientSessionAuth(t *testing.T) {
	if os.Getenv(commandTestParentAuthHelper) == "1" {
		assertCommandSuiteRunsWithoutAmbientSessionAuth(t)
		return
	}

	child := exec.Command(os.Args[0], "-test.run=^TestCommandSuiteClearsAmbientSessionAuth$")
	child.Env = append(
		environmentWithoutKeys(os.Environ(), commandTestAuthUsername, commandTestAuthPassword, commandTestParentAuthHelper),
		commandTestParentAuthHelper+"=1",
		commandTestAuthUsername+"=simulated-parent-user",
		commandTestAuthPassword+"=simulated-parent-password",
	)
	output, err := child.CombinedOutput()
	if err != nil {
		t.Fatalf("command suite child failed: %v\n%s", err, output)
	}
}

func assertCommandSuiteRunsWithoutAmbientSessionAuth(t *testing.T) {
	t.Helper()
	for _, name := range []string{commandTestAuthUsername, commandTestAuthPassword} {
		if _, present := os.LookupEnv(name); present {
			t.Fatalf("expected %s to be absent before command tests run", name)
		}
	}

	var loginCalls atomic.Int32
	var applicationCalls atomic.Int32
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path == "/api/auth/login" {
			loginCalls.Add(1)
			http.Error(w, "unexpected login", http.StatusInternalServerError)
			return
		}
		if r.Method != http.MethodGet || r.URL.Path != "/api/resumes" {
			t.Errorf("unexpected request %s %s", r.Method, r.URL.Path)
			http.Error(w, "unexpected request", http.StatusNotFound)
			return
		}
		applicationCalls.Add(1)
		if r.Header.Get("Cookie") != "" || r.Header.Get("X-CSRF-Token") != "" {
			t.Error("ordinary command request carried session authentication material")
		}
		w.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(w).Encode(client.ResumesResponse{Success: true})
	}))
	defer server.Close()

	setResumeCLIConfig(t, server.URL, "hr")
	setCLIOutput(t, "json")
	cmd := newResumeListCmd()
	var output bytes.Buffer
	cmd.SetOut(&output)
	cmd.SetErr(&output)
	if err := cmd.Execute(); err != nil {
		t.Fatalf("ordinary resume list command failed: %v", err)
	}
	if got := loginCalls.Load(); got != 0 {
		t.Fatalf("expected no login request, got %d", got)
	}
	if got := applicationCalls.Load(); got != 1 {
		t.Fatalf("expected one application request, got %d", got)
	}
}

func environmentWithoutKeys(environment []string, keys ...string) []string {
	excluded := make(map[string]struct{}, len(keys))
	for _, key := range keys {
		excluded[key] = struct{}{}
	}

	filtered := make([]string, 0, len(environment))
	for _, entry := range environment {
		name, _, _ := strings.Cut(entry, "=")
		if _, remove := excluded[name]; !remove {
			filtered = append(filtered, entry)
		}
	}
	return filtered
}
