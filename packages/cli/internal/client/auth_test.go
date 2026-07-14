package client

import (
	"context"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"reflect"
	"strings"
	"sync"
	"sync/atomic"
	"testing"
	"time"
)

type roundTripFunc func(*http.Request) (*http.Response, error)

func (f roundTripFunc) RoundTrip(req *http.Request) (*http.Response, error) {
	return f(req)
}

func TestSessionAuthDisabledWhenBothEnvironmentVariablesAreUnset(t *testing.T) {
	setSessionAuthEnvironment(t, nil, nil)

	var requests atomic.Int32
	c := NewWithSessionAuthFromEnvironment("https://api.example.test", "https://worker.example.test", "dev")
	c.HTTP = &http.Client{Transport: roundTripFunc(func(req *http.Request) (*http.Response, error) {
		requests.Add(1)
		if req.URL.Path == "/api/auth/login" {
			t.Fatal("authentication-disabled client attempted login")
		}
		if got := req.Header.Get("Cookie"); got != "" {
			t.Fatalf("authentication-disabled request sent Cookie: %q", got)
		}
		if got := req.Header.Get("X-CSRF-Token"); got != "" {
			t.Fatalf("authentication-disabled request sent CSRF token: %q", got)
		}
		return jsonHTTPResponse(req, http.StatusOK, `{}`), nil
	})}

	if err := c.doJSON(context.Background(), http.MethodGet, c.APIURL+"/public", nil, nil); err != nil {
		t.Fatalf("public request failed with authentication disabled: %v", err)
	}
	if got := requests.Load(); got != 1 {
		t.Fatalf("expected one public request and no login, got %d requests", got)
	}
}

func TestSessionAuthRejectsPartialOrEmptyCredentialsBeforeNetwork(t *testing.T) {
	username := "phase-a-user-marker"
	password := "phase-a-password-marker"
	empty := ""

	tests := []struct {
		name     string
		username *string
		password *string
	}{
		{name: "username only", username: &username},
		{name: "password only", password: &password},
		{name: "empty username", username: &empty, password: &password},
		{name: "empty password", username: &username, password: &empty},
		{name: "both explicitly empty", username: &empty, password: &empty},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			setSessionAuthEnvironment(t, tt.username, tt.password)

			var requests atomic.Int32
			c := NewWithSessionAuthFromEnvironment("http://127.0.0.1:3000", "http://127.0.0.1:8000", "dev")
			c.HTTP = &http.Client{Transport: roundTripFunc(func(req *http.Request) (*http.Response, error) {
				requests.Add(1)
				return jsonHTTPResponse(req, http.StatusOK, `{}`), nil
			})}

			err := c.doJSON(context.Background(), http.MethodGet, c.APIURL+"/public", nil, nil)
			if err == nil {
				t.Fatal("expected partial or empty credentials to fail")
			}
			if got := requests.Load(); got != 0 {
				t.Fatalf("expected credential validation before network, got %d requests", got)
			}
			errorText := err.Error()
			for _, envName := range []string{"TRENDS_AUTH_USERNAME", "TRENDS_AUTH_PASSWORD"} {
				if !strings.Contains(errorText, envName) {
					t.Fatalf("expected error to name %s, got %q", envName, errorText)
				}
			}
			for _, secret := range []string{username, password} {
				if strings.Contains(errorText, secret) {
					t.Fatalf("credential value leaked in error: %q", errorText)
				}
			}
		})
	}
}

func TestSessionAuthRequiresNormalizedDevWorkspace(t *testing.T) {
	tests := []struct {
		workspace string
		wantError bool
	}{
		{workspace: ""},
		{workspace: " dev "},
		{workspace: "DEV", wantError: true},
		{workspace: "hr", wantError: true},
		{workspace: "admin", wantError: true},
		{workspace: "development", wantError: true},
	}

	for _, tt := range tests {
		t.Run(tt.workspace, func(t *testing.T) {
			_, err := validateSessionAuthTarget("http://localhost:3000", normalizeWorkspace(tt.workspace))
			if tt.wantError && err == nil {
				t.Fatalf("expected workspace %q to be rejected", tt.workspace)
			}
			if !tt.wantError && err != nil {
				t.Fatalf("expected workspace %q to be accepted: %v", tt.workspace, err)
			}
		})
	}
}

func TestSessionAuthLoopbackEligibility(t *testing.T) {
	tests := []struct {
		name      string
		apiURL    string
		wantError bool
	}{
		{name: "localhost http", apiURL: "http://localhost:3000"},
		{name: "localhost case insensitive", apiURL: "HTTP://LOCALHOST:3000"},
		{name: "ipv4 loopback", apiURL: "http://127.0.0.1:3000"},
		{name: "ipv4 loopback range", apiURL: "https://127.42.0.9"},
		{name: "ipv6 loopback", apiURL: "http://[::1]:3000"},
		{name: "mapped loopback", apiURL: "https://[::ffff:127.0.0.1]:3443"},
		{name: "lookalike suffix", apiURL: "http://localhost.example:3000", wantError: true},
		{name: "lookalike prefix", apiURL: "http://example-localhost:3000", wantError: true},
		{name: "terminal dot", apiURL: "http://localhost.:3000", wantError: true},
		{name: "public dns", apiURL: "https://example.com", wantError: true},
		{name: "public ip", apiURL: "https://203.0.113.10", wantError: true},
		{name: "private lan", apiURL: "http://192.168.1.10", wantError: true},
		{name: "link local", apiURL: "http://169.254.1.10", wantError: true},
		{name: "ipv4 unspecified", apiURL: "http://0.0.0.0:3000", wantError: true},
		{name: "ipv6 unspecified", apiURL: "http://[::]:3000", wantError: true},
		{name: "relative", apiURL: "/api", wantError: true},
		{name: "missing host", apiURL: "http:///api", wantError: true},
		{name: "malformed", apiURL: "://localhost", wantError: true},
		{name: "malformed port", apiURL: "http://localhost:notaport", wantError: true},
		{name: "empty port", apiURL: "http://localhost:", wantError: true},
		{name: "zero port", apiURL: "http://localhost:0", wantError: true},
		{name: "out of range port", apiURL: "http://localhost:65536", wantError: true},
		{name: "non http", apiURL: "ftp://localhost/resource", wantError: true},
		{name: "userinfo", apiURL: "http://embedded-secret@localhost:3000", wantError: true},
		{name: "query", apiURL: "http://localhost:3000?token=embedded-secret", wantError: true},
		{name: "fragment", apiURL: "http://localhost:3000#embedded-secret", wantError: true},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			_, err := validateSessionAuthTarget(tt.apiURL, "dev")
			if tt.wantError && err == nil {
				t.Fatalf("expected %q to be rejected", tt.apiURL)
			}
			if !tt.wantError && err != nil {
				t.Fatalf("expected %q to be accepted: %v", tt.apiURL, err)
			}
			if err != nil && strings.Contains(err.Error(), "embedded-secret") {
				t.Fatalf("rejected URL material leaked in error: %q", err)
			}
		})
	}
}

func TestUnauthenticatedPublicRequestStillAllowsNonLoopbackAPIURL(t *testing.T) {
	setSessionAuthEnvironment(t, nil, nil)

	var requests atomic.Int32
	c := NewWithSessionAuthFromEnvironment("https://public.example.test/base", "https://worker.example.test", "hr")
	c.HTTP = &http.Client{Transport: roundTripFunc(func(req *http.Request) (*http.Response, error) {
		requests.Add(1)
		if req.URL.Host != "public.example.test" || req.URL.Path != "/base/public" {
			t.Fatalf("unexpected unauthenticated public target: %s", req.URL.Redacted())
		}
		return jsonHTTPResponse(req, http.StatusOK, `{}`), nil
	})}

	if err := c.doJSON(context.Background(), http.MethodGet, c.APIURL+"/public", nil, nil); err != nil {
		t.Fatalf("unauthenticated non-loopback request failed: %v", err)
	}
	if got := requests.Load(); got != 1 {
		t.Fatalf("expected one public request, got %d", got)
	}
}

func TestSessionAuthLogsInOnceBeforeFirstAPIRequest(t *testing.T) {
	const (
		username = "login-order-user"
		password = " login-order-password "
	)

	var mu sync.Mutex
	var requestOrder []string
	server := httptest.NewTLSServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		mu.Lock()
		requestOrder = append(requestOrder, r.URL.Path)
		mu.Unlock()

		switch r.URL.Path {
		case "/api/auth/login":
			if r.Method != http.MethodPost {
				t.Errorf("login used method %s", r.Method)
			}
			if got := r.Header.Get("X-Workspace-Slug"); got != "dev" {
				t.Errorf("login workspace header = %q", got)
			}
			var payload map[string]string
			if err := json.NewDecoder(r.Body).Decode(&payload); err != nil {
				t.Errorf("decode login payload: %v", err)
				return
			}
			if len(payload) != 2 || payload["username"] != username || payload["password"] != password {
				t.Error("login payload did not contain exactly the configured username and password")
			}
			writeSessionLoginSuccess(w, "login-order-session", "login-order-csrf-cookie", "login-order-json-csrf")
		case "/api/protected":
			_, _ = w.Write([]byte(`{"ok":true}`))
		default:
			t.Errorf("unexpected request path %q", r.URL.Path)
			http.NotFound(w, r)
		}
	}))
	defer server.Close()

	c := newWithSessionAuth(server.URL, server.URL, "dev", username, true, password, true)
	c.HTTP = server.Client()
	if err := c.doJSON(context.Background(), http.MethodGet, c.APIURL+"/api/protected", nil, nil); err != nil {
		t.Fatalf("authenticated request failed: %v", err)
	}
	if err := c.doJSON(context.Background(), http.MethodGet, c.APIURL+"/api/protected", nil, nil); err != nil {
		t.Fatalf("second authenticated request failed: %v", err)
	}

	mu.Lock()
	gotOrder := append([]string(nil), requestOrder...)
	mu.Unlock()
	wantOrder := []string{"/api/auth/login", "/api/protected", "/api/protected"}
	if !reflect.DeepEqual(gotOrder, wantOrder) {
		t.Fatalf("request order = %v, want %v", gotOrder, wantOrder)
	}
}

func TestSessionAuthStoresLoginCookiesInOneJar(t *testing.T) {
	var loginCalls atomic.Int32
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path == "/api/auth/login" {
			loginCalls.Add(1)
			writeSessionLoginSuccess(w, "jar-session-value", "jar-csrf-cookie-value", "jar-json-csrf")
			return
		}

		sessionCookie, sessionErr := r.Cookie("custom_session")
		csrfCookie, csrfErr := r.Cookie("custom_csrf")
		if sessionErr != nil || csrfErr != nil {
			t.Error("application request did not receive both login cookies")
		} else if sessionCookie.Value != "jar-session-value" || csrfCookie.Value != "jar-csrf-cookie-value" {
			t.Error("application request received unexpected login cookie values")
		}
		_, _ = w.Write([]byte(`{}`))
	}))
	defer server.Close()

	c := newAuthenticatedTestClient(server, "jar-user", "jar-password")
	if err := c.doJSON(context.Background(), http.MethodGet, c.APIURL+"/api/protected", nil, nil); err != nil {
		t.Fatalf("authenticated request failed: %v", err)
	}
	if got := loginCalls.Load(); got != 1 {
		t.Fatalf("expected one login, got %d", got)
	}
}

func TestSessionAuthUsesLoginJSONCSRFToken(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path == "/api/auth/login" {
			writeSessionLoginSuccess(w, "csrf-session", "cookie-token-must-not-be-header", "json-token-must-be-header")
			return
		}
		if got := r.Header.Get("X-CSRF-Token"); got != "json-token-must-be-header" {
			t.Errorf("unsafe request did not use the login JSON CSRF token")
		}
		_, _ = w.Write([]byte(`{}`))
	}))
	defer server.Close()

	c := newAuthenticatedTestClient(server, "csrf-user", "csrf-password")
	if err := c.doJSON(context.Background(), http.MethodPost, c.APIURL+"/api/protected", map[string]bool{"ok": true}, nil); err != nil {
		t.Fatalf("authenticated unsafe request failed: %v", err)
	}
}

func TestSessionAuthCSRFMethodMatrix(t *testing.T) {
	const csrfToken = "method-matrix-json-token"
	methods := []string{http.MethodGet, http.MethodHead, http.MethodOptions, http.MethodPost, http.MethodPut, http.MethodPatch, http.MethodDelete, "PROPFIND"}
	seen := make(map[string]string, len(methods))
	var mu sync.Mutex

	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path == "/api/auth/login" {
			writeSessionLoginSuccess(w, "method-session", "method-cookie-token", csrfToken)
			return
		}
		mu.Lock()
		seen[r.Method] = r.Header.Get("X-CSRF-Token")
		mu.Unlock()
		w.WriteHeader(http.StatusNoContent)
	}))
	defer server.Close()

	c := newAuthenticatedTestClient(server, "method-user", "method-password")
	for _, method := range methods {
		if err := c.doJSON(context.Background(), method, c.APIURL+"/api/method", nil, nil); err != nil {
			t.Fatalf("authenticated %s request failed: %v", method, err)
		}
	}

	for _, method := range methods {
		got := seen[method]
		switch method {
		case http.MethodGet, http.MethodHead, http.MethodOptions:
			if got != "" {
				t.Errorf("%s request unexpectedly received CSRF header", method)
			}
		default:
			if got != csrfToken {
				t.Errorf("%s request did not receive CSRF header", method)
			}
		}
	}
}

func TestLoginRequestHasNoCSRFHeaderOrPriorCookie(t *testing.T) {
	var loginCalls atomic.Int32
	var applicationCalls atomic.Int32
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path == "/api/auth/login" {
			loginCalls.Add(1)
			if r.Header.Get("X-CSRF-Token") != "" {
				t.Error("login request included a CSRF header")
			}
			if r.Header.Get("Cookie") != "" {
				t.Error("login request included a prior cookie")
			}
			writeSessionLoginSuccess(w, "clean-login-session", "clean-login-csrf-cookie", "clean-login-json-csrf")
			return
		}
		applicationCalls.Add(1)
		_, _ = w.Write([]byte(`{}`))
	}))
	defer server.Close()

	c := newAuthenticatedTestClient(server, "clean-login-user", "clean-login-password")
	if err := c.doJSON(context.Background(), http.MethodPost, c.APIURL+"/api/protected", nil, nil); err != nil {
		t.Fatalf("authenticated request failed: %v", err)
	}
	if loginCalls.Load() != 1 || applicationCalls.Load() != 1 {
		t.Fatalf("expected one login followed by one application request, got login=%d application=%d", loginCalls.Load(), applicationCalls.Load())
	}
}

func TestSessionAuthConcurrentRequestsShareOneLogin(t *testing.T) {
	const requestCount = 12
	var loginCalls atomic.Int32
	var applicationCalls atomic.Int32
	loginStarted := make(chan struct{})
	releaseLogin := make(chan struct{})
	var releaseOnce sync.Once

	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path == "/api/auth/login" {
			loginCalls.Add(1)
			releaseOnce.Do(func() { close(loginStarted) })
			<-releaseLogin
			writeSessionLoginSuccess(w, "concurrent-session", "concurrent-csrf-cookie", "concurrent-json-csrf")
			return
		}
		applicationCalls.Add(1)
		cookie, err := r.Cookie("custom_session")
		if err != nil || cookie.Value != "concurrent-session" {
			t.Error("concurrent application request did not share the login session")
		}
		_, _ = w.Write([]byte(`{}`))
	}))
	defer server.Close()

	c := newAuthenticatedTestClient(server, "concurrent-user", "concurrent-password")
	start := make(chan struct{})
	errors := make(chan error, requestCount)
	var wg sync.WaitGroup
	for i := 0; i < requestCount; i++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			<-start
			errors <- c.doJSON(context.Background(), http.MethodGet, c.APIURL+"/api/protected", nil, nil)
		}()
	}
	close(start)
	select {
	case <-loginStarted:
		close(releaseLogin)
	case <-time.After(time.Second):
		close(releaseLogin)
		wg.Wait()
		t.Fatal("concurrent requests did not start a login")
	}
	wg.Wait()
	close(errors)
	for err := range errors {
		if err != nil {
			t.Fatalf("concurrent authenticated request failed: %v", err)
		}
	}
	if got := loginCalls.Load(); got != 1 {
		t.Fatalf("expected one concurrent login, got %d", got)
	}
	if got := applicationCalls.Load(); got != requestCount {
		t.Fatalf("expected %d application requests, got %d", requestCount, got)
	}
}

func TestSessionAuthRejectsRedirectedLogin(t *testing.T) {
	for _, status := range []int{http.StatusTemporaryRedirect, http.StatusPermanentRedirect} {
		t.Run(http.StatusText(status), func(t *testing.T) {
			var redirectTargetCalls atomic.Int32
			redirectTarget := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				redirectTargetCalls.Add(1)
				w.WriteHeader(http.StatusOK)
			}))
			defer redirectTarget.Close()

			var applicationCalls atomic.Int32
			server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				if r.URL.Path == "/api/auth/login" {
					http.Redirect(w, r, redirectTarget.URL+"/capture", status)
					return
				}
				applicationCalls.Add(1)
				_, _ = w.Write([]byte(`{}`))
			}))
			defer server.Close()

			const username = "redirect-user-marker"
			const password = "redirect-password-marker"
			c := newAuthenticatedTestClient(server, username, password)
			err := c.doJSON(context.Background(), http.MethodGet, c.APIURL+"/api/protected", nil, nil)
			if err == nil {
				t.Fatal("expected redirected login to fail")
			}
			if got := redirectTargetCalls.Load(); got != 0 {
				t.Fatalf("redirect target received %d login requests", got)
			}
			if got := applicationCalls.Load(); got != 0 {
				t.Fatalf("application received %d requests after redirected login", got)
			}
			if strings.Contains(err.Error(), username) || strings.Contains(err.Error(), password) {
				t.Fatalf("credential leaked in redirect error")
			}
		})
	}
}

func TestSessionAuthFailsClosedOnMalformedSuccess(t *testing.T) {
	tests := []struct {
		name      string
		body      string
		setCookie bool
	}{
		{name: "invalid json", body: `{invalid`, setCookie: true},
		{name: "success false", body: `{"success":false,"csrfToken":"malformed-token"}`, setCookie: true},
		{name: "empty csrf token", body: `{"success":true,"csrfToken":""}`, setCookie: true},
		{name: "no login cookie", body: `{"success":true,"csrfToken":"malformed-token"}`},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			var applicationCalls atomic.Int32
			server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				if r.URL.Path == "/api/auth/login" {
					if tt.setCookie {
						http.SetCookie(w, &http.Cookie{Name: "custom_session", Value: "malformed-session", Path: "/", HttpOnly: true})
					}
					w.Header().Set("Content-Type", "application/json")
					_, _ = w.Write([]byte(tt.body))
					return
				}
				applicationCalls.Add(1)
				_, _ = w.Write([]byte(`{}`))
			}))
			defer server.Close()

			c := newAuthenticatedTestClient(server, "malformed-user", "malformed-password")
			err := c.doJSON(context.Background(), http.MethodGet, c.APIURL+"/api/protected", nil, nil)
			if err == nil {
				t.Fatal("expected malformed login success to fail closed")
			}
			if got := applicationCalls.Load(); got != 0 {
				t.Fatalf("application received %d requests after malformed login", got)
			}
		})
	}
}

func TestFailedLoginSendsNoApplicationRequestAndIsNotRetried(t *testing.T) {
	var loginCalls atomic.Int32
	var applicationCalls atomic.Int32
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path == "/api/auth/login" {
			loginCalls.Add(1)
			http.Error(w, "invalid credentials", http.StatusUnauthorized)
			return
		}
		applicationCalls.Add(1)
		_, _ = w.Write([]byte(`{}`))
	}))
	defer server.Close()

	c := newAuthenticatedTestClient(server, "failed-login-user", "failed-login-password")
	for attempt := 0; attempt < 2; attempt++ {
		if err := c.doJSON(context.Background(), http.MethodGet, c.APIURL+"/api/protected", nil, nil); err == nil {
			t.Fatal("expected failed login to reject application request")
		}
	}
	if got := loginCalls.Load(); got != 1 {
		t.Fatalf("expected failed login to be cached, got %d login requests", got)
	}
	if got := applicationCalls.Load(); got != 0 {
		t.Fatalf("expected no application requests after failed login, got %d", got)
	}
	if c.auth.password != "" {
		t.Fatal("password field was not cleared after the login attempt")
	}
}

func TestRateLimitedLoginIsNotRetried(t *testing.T) {
	var loginCalls atomic.Int32
	var applicationCalls atomic.Int32
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path == "/api/auth/login" {
			loginCalls.Add(1)
			w.Header().Set("Retry-After", "60")
			http.Error(w, "rate limited", http.StatusTooManyRequests)
			return
		}
		applicationCalls.Add(1)
	}))
	defer server.Close()

	c := newAuthenticatedTestClient(server, "rate-user", "rate-password")
	for attempt := 0; attempt < 2; attempt++ {
		if err := c.doJSON(context.Background(), http.MethodGet, c.APIURL+"/api/protected", nil, nil); err == nil {
			t.Fatal("expected rate-limited login to reject application request")
		}
	}
	if got := loginCalls.Load(); got != 1 {
		t.Fatalf("expected no login retry after 429, got %d", got)
	}
	if got := applicationCalls.Load(); got != 0 {
		t.Fatalf("expected no application request after 429 login, got %d", got)
	}
}

func TestAuthenticated401DoesNotReloginOrReplayGET(t *testing.T) {
	assertAuthenticatedApplicationFailureIsNotReplayed(t, http.MethodGet, http.StatusUnauthorized, `{"error":"session expired"}`)
}

func TestAuthenticated401DoesNotReplayMutation(t *testing.T) {
	assertAuthenticatedApplicationFailureIsNotReplayed(t, http.MethodPost, http.StatusUnauthorized, `{"error":"authentication required"}`)
}

func TestAuthenticated403DoesNotReplayMutation(t *testing.T) {
	tests := []struct {
		name string
		body string
	}{
		{name: "membership or admin", body: `{"error":"workspace access required"}`},
		{name: "csrf", body: `{"error":"CSRF token required"}`},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			assertAuthenticatedApplicationFailureIsNotReplayed(t, http.MethodPost, http.StatusForbidden, tt.body)
		})
	}
}

func TestAuthErrorsAreRedactedAcrossJSONBinaryAndMultipart(t *testing.T) {
	const (
		username      = "redact-username-marker"
		password      = "redact-password-marker"
		sessionCookie = "redact-session-cookie-marker"
		csrfCookie    = "redact-csrf-cookie-marker"
		csrfToken     = "redact-json-csrf-marker"
	)
	reflected := strings.Join([]string{
		username,
		password,
		sessionCookie,
		csrfCookie,
		csrfToken,
		"Cookie: custom_session=" + sessionCookie + "; custom_csrf=" + csrfCookie,
		"Set-Cookie: custom_session=" + sessionCookie + "; Path=/; HttpOnly",
		strings.Repeat("x", 10_000),
	}, " | ")

	tests := []struct {
		name   string
		invoke func(*testing.T, *Client) error
	}{
		{
			name: "json",
			invoke: func(t *testing.T, c *Client) error {
				return c.doJSON(context.Background(), http.MethodGet, c.APIURL+"/api/json-error", nil, nil)
			},
		},
		{
			name: "binary",
			invoke: func(t *testing.T, c *Client) error {
				_, _, err := c.doBinary(context.Background(), http.MethodPost, c.APIURL+"/api/binary-error", map[string]bool{"ok": true})
				return err
			},
		},
		{
			name: "multipart",
			invoke: func(t *testing.T, c *Client) error {
				uploadPath := filepath.Join(t.TempDir(), "resume.json")
				if err := os.WriteFile(uploadPath, []byte(`{"resumeId":"one"}`), 0o600); err != nil {
					t.Fatalf("write multipart fixture: %v", err)
				}
				_, err := c.ImportManualResumes(context.Background(), ResumeManualImportRequest{FilePaths: []string{uploadPath}})
				return err
			},
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			var applicationCalls atomic.Int32
			server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				if r.URL.Path == "/api/auth/login" {
					writeSessionLoginSuccess(w, sessionCookie, csrfCookie, csrfToken)
					return
				}
				applicationCalls.Add(1)
				if strings.Contains(r.URL.Path, "json") {
					w.Header().Set("Content-Type", "application/json")
					w.WriteHeader(http.StatusBadRequest)
					_ = json.NewEncoder(w).Encode(map[string]string{"error": reflected})
					return
				}
				http.Error(w, reflected, http.StatusBadRequest)
			}))
			defer server.Close()

			c := newAuthenticatedTestClient(server, username, password)
			err := tt.invoke(t, c)
			if err == nil {
				t.Fatal("expected reflected application failure")
			}
			errorText := err.Error()
			for _, secret := range []string{username, password, sessionCookie, csrfCookie, csrfToken} {
				if strings.Contains(errorText, secret) {
					t.Fatal("authentication material leaked in application error")
				}
			}
			if !strings.Contains(errorText, "[REDACTED]") {
				t.Fatalf("expected redaction marker in application error: %v", err)
			}
			if len(errorText) > maxErrorMessageBytes {
				t.Fatalf("application error was not bounded: %d bytes", len(errorText))
			}
			if got := applicationCalls.Load(); got != 1 {
				t.Fatalf("expected one application request, got %d", got)
			}
		})
	}
}

func TestSessionExpiryDuringPollStopsWithoutRelogin(t *testing.T) {
	var loginCalls atomic.Int32
	var pollCalls atomic.Int32
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path == "/api/auth/login" {
			loginCalls.Add(1)
			writeSessionLoginSuccess(w, "poll-session", "poll-csrf-cookie", "poll-json-csrf")
			return
		}
		call := pollCalls.Add(1)
		if call == 1 {
			_, _ = w.Write([]byte(`{"ready":false}`))
			return
		}
		http.Error(w, "session expired", http.StatusUnauthorized)
	}))
	defer server.Close()

	c := newAuthenticatedTestClient(server, "poll-user", "poll-password")
	var pollErr error
	for attempt := 0; attempt < 3; attempt++ {
		pollErr = c.doJSON(context.Background(), http.MethodGet, c.APIURL+"/api/poll", nil, nil)
		if pollErr != nil {
			break
		}
	}
	if pollErr == nil {
		t.Fatal("expected session expiry to stop polling")
	}
	var authErr *authenticationError
	if !errors.As(pollErr, &authErr) {
		t.Fatalf("expected session expiry to retain authentication error type, got %T", pollErr)
	}
	if got := loginCalls.Load(); got != 1 {
		t.Fatalf("expected one login during polling, got %d", got)
	}
	if got := pollCalls.Load(); got != 2 {
		t.Fatalf("expected polling to stop after two calls, got %d", got)
	}
}

func TestSessionAuthRejectsRedirectedApplicationRequest(t *testing.T) {
	var redirectTargetCalls atomic.Int32
	redirectTarget := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		redirectTargetCalls.Add(1)
		if r.Header.Get("X-CSRF-Token") != "" || r.Header.Get("Cookie") != "" {
			t.Error("redirect target received API session material")
		}
		w.WriteHeader(http.StatusOK)
	}))
	defer redirectTarget.Close()

	var applicationCalls atomic.Int32
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path == "/api/auth/login" {
			writeSessionLoginSuccess(w, "application-redirect-session", "application-redirect-cookie", "application-redirect-token")
			return
		}
		applicationCalls.Add(1)
		http.Redirect(w, r, redirectTarget.URL+"/capture", http.StatusTemporaryRedirect)
	}))
	defer server.Close()

	c := newAuthenticatedTestClient(server, "application-redirect-user", "application-redirect-password")
	err := c.doJSON(context.Background(), http.MethodPost, c.APIURL+"/api/protected", map[string]bool{"ok": true}, nil)
	if err == nil {
		t.Fatal("expected redirected application request to fail")
	}
	if got := applicationCalls.Load(); got != 1 {
		t.Fatalf("expected one application request, got %d", got)
	}
	if got := redirectTargetCalls.Load(); got != 0 {
		t.Fatalf("redirect target received %d requests", got)
	}
}

func TestAuthenticatedBinaryRequestUsesSessionAndCSRF(t *testing.T) {
	var applicationCalls atomic.Int32
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path == "/api/auth/login" {
			writeSessionLoginSuccess(w, "binary-session", "binary-csrf-cookie", "binary-json-csrf")
			return
		}
		applicationCalls.Add(1)
		cookie, err := r.Cookie("custom_session")
		if err != nil || cookie.Value != "binary-session" {
			t.Error("binary request did not receive API session cookie")
		}
		if r.Header.Get("X-CSRF-Token") != "binary-json-csrf" {
			t.Error("binary request did not receive JSON CSRF token")
		}
		w.Header().Set("Content-Disposition", `attachment; filename="backup.json"`)
		_, _ = w.Write([]byte("binary-payload"))
	}))
	defer server.Close()

	c := newAuthenticatedTestClient(server, "binary-user", "binary-password")
	payload, _, err := c.doBinary(context.Background(), http.MethodPost, c.APIURL+"/api/binary", map[string]bool{"export": true})
	if err != nil {
		t.Fatalf("authenticated binary request failed: %v", err)
	}
	if string(payload) != "binary-payload" {
		t.Fatalf("unexpected binary payload length: %d", len(payload))
	}
	if got := applicationCalls.Load(); got != 1 {
		t.Fatalf("expected one binary request, got %d", got)
	}
}

func assertAuthenticatedApplicationFailureIsNotReplayed(t *testing.T, method string, status int, body string) {
	t.Helper()
	var loginCalls atomic.Int32
	var applicationCalls atomic.Int32
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path == "/api/auth/login" {
			loginCalls.Add(1)
			writeSessionLoginSuccess(w, "failure-session", "failure-csrf-cookie", "failure-json-csrf")
			return
		}
		applicationCalls.Add(1)
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(status)
		_, _ = w.Write([]byte(body))
	}))
	defer server.Close()

	c := newAuthenticatedTestClient(server, "failure-user", "failure-password")
	var requestBody any
	if method != http.MethodGet {
		requestBody = map[string]bool{"mutate": true}
	}
	err := c.doJSON(context.Background(), method, c.APIURL+"/api/protected", requestBody, nil)
	if err == nil {
		t.Fatalf("expected HTTP %d application failure", status)
	}
	var authErr *authenticationError
	if !errors.As(err, &authErr) {
		t.Fatalf("expected HTTP %d to retain authentication error type, got %T", status, err)
	}
	if got := loginCalls.Load(); got != 1 {
		t.Fatalf("expected one login, got %d", got)
	}
	if got := applicationCalls.Load(); got != 1 {
		t.Fatalf("expected exactly one application request, got %d", got)
	}
}

func setSessionAuthEnvironment(t *testing.T, username, password *string) {
	t.Helper()
	setOrUnsetEnvironment(t, "TRENDS_AUTH_USERNAME", username)
	setOrUnsetEnvironment(t, "TRENDS_AUTH_PASSWORD", password)
}

func setOrUnsetEnvironment(t *testing.T, name string, value *string) {
	t.Helper()
	t.Setenv(name, "test-environment-placeholder")
	if value == nil {
		if err := os.Unsetenv(name); err != nil {
			t.Fatalf("unset %s: %v", name, err)
		}
		return
	}
	t.Setenv(name, *value)
}

func jsonHTTPResponse(req *http.Request, status int, body string) *http.Response {
	return &http.Response{
		StatusCode: status,
		Status:     http.StatusText(status),
		Header:     make(http.Header),
		Body:       io.NopCloser(strings.NewReader(body)),
		Request:    req,
	}
}

func newAuthenticatedTestClient(server *httptest.Server, username, password string) *Client {
	c := newWithSessionAuth(server.URL, server.URL, "dev", username, true, password, true)
	c.HTTP = server.Client()
	return c
}

func writeSessionLoginSuccess(w http.ResponseWriter, sessionCookie, csrfCookie, csrfToken string) {
	http.SetCookie(w, &http.Cookie{Name: "custom_session", Value: sessionCookie, Path: "/", HttpOnly: true})
	http.SetCookie(w, &http.Cookie{Name: "custom_csrf", Value: csrfCookie, Path: "/"})
	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(map[string]any{"success": true, "csrfToken": csrfToken})
}
