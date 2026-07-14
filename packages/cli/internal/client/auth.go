package client

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net"
	"net/http"
	"net/http/cookiejar"
	"net/url"
	"os"
	"regexp"
	"sort"
	"strconv"
	"strings"
	"sync"
	"unicode/utf8"
)

const (
	sessionAuthUsernameEnv = "TRENDS_AUTH_USERNAME"
	sessionAuthPasswordEnv = "TRENDS_AUTH_PASSWORD"
)

type sessionAuth struct {
	once         sync.Once
	username     string
	password     string
	csrfToken    string
	apiURL       *url.URL
	jar          http.CookieJar
	http         *http.Client
	redactions   *redactionRegistry
	preflightErr error
	loginErr     error
}

type redactionRegistry struct {
	mu     sync.RWMutex
	values map[string]struct{}
}

func newRedactionRegistry(values ...string) *redactionRegistry {
	registry := &redactionRegistry{values: make(map[string]struct{}, len(values))}
	registry.register(values...)
	return registry
}

func (r *redactionRegistry) register(values ...string) {
	if r == nil {
		return
	}
	r.mu.Lock()
	defer r.mu.Unlock()
	for _, value := range values {
		if value != "" {
			r.values[value] = struct{}{}
		}
	}
}

func (r *redactionRegistry) snapshot() []string {
	if r == nil {
		return nil
	}
	r.mu.RLock()
	defer r.mu.RUnlock()
	values := make([]string, 0, len(r.values))
	for value := range r.values {
		values = append(values, value)
	}
	return values
}

type cookieCapturingTransport struct {
	base       http.RoundTripper
	redactions *redactionRegistry
}

func (t *cookieCapturingTransport) RoundTrip(req *http.Request) (*http.Response, error) {
	for _, cookie := range req.Cookies() {
		t.redactions.register(cookie.Value)
	}
	return t.base.RoundTrip(req)
}

type authenticationError struct {
	message string
}

func (e *authenticationError) Error() string {
	return e.message
}

func newWithSessionAuth(
	apiURL string,
	workerURL string,
	workspace string,
	username string,
	usernameSet bool,
	password string,
	passwordSet bool,
) *Client {
	c := New(apiURL, workerURL, workspace)
	if !usernameSet && !passwordSet {
		return c
	}

	auth := &sessionAuth{}
	c.auth = auth
	if !usernameSet || !passwordSet || username == "" || password == "" {
		auth.preflightErr = &authenticationError{message: fmt.Sprintf(
			"%s and %s must both be set to non-empty values for CLI authentication",
			sessionAuthUsernameEnv,
			sessionAuthPasswordEnv,
		)}
		return c
	}

	parsedAPIURL, err := validateSessionAuthTarget(c.APIURL, c.Workspace)
	if err != nil {
		auth.preflightErr = err
		return c
	}
	parsedAPIURL.Scheme = strings.ToLower(parsedAPIURL.Scheme)
	c.APIURL = strings.TrimRight(parsedAPIURL.String(), "/")
	jar, err := cookiejar.New(nil)
	if err != nil {
		auth.preflightErr = &authenticationError{message: "CLI authentication could not initialize an in-memory session"}
		return c
	}

	auth.username = username
	auth.password = password
	auth.apiURL = parsedAPIURL
	auth.jar = jar
	auth.redactions = newRedactionRegistry(username, password)
	return c
}

func validateSessionAuthTarget(apiURL string, workspace string) (*url.URL, error) {
	parsed, err := url.Parse(apiURL)
	if err != nil || !parsed.IsAbs() || parsed.Host == "" || parsed.User != nil {
		return nil, sessionAuthTargetError()
	}

	if scheme := strings.ToLower(parsed.Scheme); scheme != "http" && scheme != "https" {
		return nil, sessionAuthTargetError()
	}
	if parsed.ForceQuery || parsed.RawQuery != "" || parsed.Fragment != "" || strings.Contains(apiURL, "#") {
		return nil, sessionAuthTargetError()
	}
	if !validSessionAuthPort(parsed) {
		return nil, sessionAuthTargetError()
	}
	if workspace != "dev" {
		return nil, sessionAuthTargetError()
	}

	hostname := parsed.Hostname()
	if hostname == "" {
		return nil, sessionAuthTargetError()
	}
	if !strings.EqualFold(hostname, "localhost") {
		ip := net.ParseIP(hostname)
		if ip == nil || !ip.IsLoopback() {
			return nil, sessionAuthTargetError()
		}
	}

	return parsed, nil
}

func validSessionAuthPort(parsed *url.URL) bool {
	if strings.HasSuffix(parsed.Host, ":") {
		return false
	}
	port := parsed.Port()
	if port == "" {
		return true
	}
	numericPort, err := strconv.Atoi(port)
	return err == nil && numericPort >= 1 && numericPort <= 65535
}

func sessionAuthTargetError() error {
	return &authenticationError{message: "CLI authentication requires an http(s) loopback API URL without userinfo and workspace dev"}
}

func (c *Client) ensureAuthenticated(ctx context.Context) error {
	if c.auth == nil {
		return nil
	}
	if c.auth.preflightErr != nil {
		return c.auth.preflightErr
	}

	c.auth.once.Do(func() {
		baseClient := c.HTTP
		if baseClient == nil {
			baseClient = http.DefaultClient
		}
		authenticatedClient := *baseClient
		authenticatedClient.Jar = c.auth.jar
		baseTransport := authenticatedClient.Transport
		if baseTransport == nil {
			baseTransport = http.DefaultTransport
		}
		authenticatedClient.Transport = &cookieCapturingTransport{
			base:       baseTransport,
			redactions: c.auth.redactions,
		}
		authenticatedClient.CheckRedirect = func(*http.Request, []*http.Request) error {
			return http.ErrUseLastResponse
		}
		c.auth.http = &authenticatedClient

		password := c.auth.password
		c.auth.loginErr = c.login(ctx, password)
		c.auth.password = ""
	})
	return c.auth.loginErr
}

func (c *Client) login(ctx context.Context, password string) error {
	payload, err := json.Marshal(struct {
		Username string `json:"username"`
		Password string `json:"password"`
	}{
		Username: c.auth.username,
		Password: password,
	})
	if err != nil {
		return &authenticationError{message: "CLI authentication failed while preparing the login request"}
	}

	loginURL := c.APIURL + "/api/auth/login"
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, loginURL, bytes.NewReader(payload))
	if err != nil {
		return &authenticationError{message: "CLI authentication failed while preparing the login request"}
	}
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("X-Workspace-Slug", c.Workspace)

	res, err := c.auth.http.Do(req)
	if err != nil {
		if ctxErr := ctx.Err(); ctxErr != nil {
			return &authenticationError{message: fmt.Sprintf("CLI authentication failed: %s", ctxErr)}
		}
		return &authenticationError{message: "CLI authentication failed: login request could not be completed"}
	}
	defer res.Body.Close()
	c.registerResponseCookieValues(res, req.URL)

	if res.StatusCode != http.StatusOK {
		return &authenticationError{message: fmt.Sprintf("CLI authentication failed: login returned HTTP %d", res.StatusCode)}
	}
	responseBody, err := io.ReadAll(io.LimitReader(res.Body, maxLoginResponseBytes+1))
	if err != nil || len(responseBody) > maxLoginResponseBytes {
		return &authenticationError{message: "CLI authentication failed: invalid login response"}
	}
	var response struct {
		Success   bool   `json:"success"`
		CSRFToken string `json:"csrfToken"`
	}
	if err := json.Unmarshal(responseBody, &response); err != nil || !response.Success || response.CSRFToken == "" {
		return &authenticationError{message: "CLI authentication failed: invalid login response"}
	}

	representativeApplicationURL, err := url.Parse(c.APIURL + "/api/resumes")
	if err != nil || len(c.auth.jar.Cookies(representativeApplicationURL)) == 0 {
		return &authenticationError{message: "CLI authentication failed: login response did not establish a session"}
	}
	c.auth.csrfToken = response.CSRFToken
	c.auth.redactions.register(response.CSRFToken)
	return nil
}

const maxLoginResponseBytes = 64 << 10

func (c *Client) sendRequest(
	ctx context.Context,
	method string,
	requestURL string,
	body io.Reader,
	contentType string,
) (*http.Response, error) {
	httpClient, authenticated, err := c.httpClientForRequest(ctx, requestURL)
	if err != nil {
		return nil, err
	}

	req, err := http.NewRequestWithContext(ctx, method, requestURL, body)
	if err != nil {
		return nil, fmt.Errorf("create request: %w", err)
	}
	req.Header.Set("X-Workspace-Slug", c.Workspace)
	if contentType != "" {
		req.Header.Set("Content-Type", contentType)
	}
	if authenticated && requiresCSRF(method) {
		req.Header.Set("X-CSRF-Token", c.auth.csrfToken)
	}
	if authenticated {
		c.registerJarCookieValues(req.URL)
	}

	res, err := httpClient.Do(req)
	if err != nil {
		return nil, c.requestTransportError(err, parsedRequestURLOrNil(requestURL))
	}
	if authenticated {
		c.registerResponseCookieValues(res, req.URL)
	}
	return res, nil
}

func (c *Client) registerJarCookieValues(cookieURL *url.URL) {
	if c == nil || c.auth == nil || c.auth.jar == nil || cookieURL == nil {
		return
	}
	for _, cookie := range c.auth.jar.Cookies(cookieURL) {
		c.auth.redactions.register(cookie.Value)
	}
}

func (c *Client) registerResponseCookieValues(res *http.Response, requestURL *url.URL) {
	if c == nil || c.auth == nil || res == nil {
		return
	}
	for _, cookie := range res.Cookies() {
		c.auth.redactions.register(cookie.Value)
	}
	c.registerJarCookieValues(requestURL)
}

func (c *Client) httpClientForRequest(ctx context.Context, requestURL string) (*http.Client, bool, error) {
	if c.auth == nil {
		return c.HTTP, false, nil
	}
	if c.auth.preflightErr != nil {
		return nil, false, c.auth.preflightErr
	}

	parsedRequestURL, err := url.Parse(requestURL)
	if err != nil {
		return nil, false, fmt.Errorf("create request: invalid URL")
	}
	if !sameOrigin(c.auth.apiURL, parsedRequestURL) {
		return c.HTTP, false, nil
	}
	if err := c.ensureAuthenticated(ctx); err != nil {
		return nil, false, err
	}
	return c.auth.http, true, nil
}

func sameOrigin(left, right *url.URL) bool {
	if left == nil || right == nil || !strings.EqualFold(left.Scheme, right.Scheme) || !strings.EqualFold(left.Hostname(), right.Hostname()) {
		return false
	}
	return effectivePort(left) == effectivePort(right)
}

func effectivePort(value *url.URL) string {
	if port := value.Port(); port != "" {
		if numericPort, err := strconv.Atoi(port); err == nil {
			return strconv.Itoa(numericPort)
		}
		return port
	}
	switch strings.ToLower(value.Scheme) {
	case "http":
		return "80"
	case "https":
		return "443"
	default:
		return ""
	}
}

func requiresCSRF(method string) bool {
	switch strings.ToUpper(method) {
	case http.MethodGet, http.MethodHead, http.MethodOptions:
		return false
	default:
		return true
	}
}

const (
	maxErrorResponseReadBytes = 64 << 10
	maxErrorMessageBytes      = 2 << 10
)

var sensitiveHeaderPattern = regexp.MustCompile(`(?i)\b(set-cookie|cookie)\s*:\s*[^\r\n]*`)

func (c *Client) responseError(res *http.Response, method string) error {
	message := fmt.Sprintf("request %s failed: HTTP %d", method, res.StatusCode)
	body, err := io.ReadAll(io.LimitReader(res.Body, maxErrorResponseReadBytes+1))
	if err == nil {
		truncated := len(body) > maxErrorResponseReadBytes
		if truncated {
			body = body[:maxErrorResponseReadBytes]
		}
		if detail := applicationErrorDetail(body); detail != "" {
			message += ": " + detail
		}
		if truncated {
			message += " [truncated]"
		}
	}

	var requestURL *url.URL
	if res.Request != nil {
		requestURL = res.Request.URL
	}
	message = c.redactAndBound(message, requestURL)
	if res.StatusCode == http.StatusUnauthorized || res.StatusCode == http.StatusForbidden {
		return &authenticationError{message: message}
	}
	return fmt.Errorf("%s", message)
}

func applicationErrorDetail(body []byte) string {
	trimmed := strings.TrimSpace(string(body))
	if trimmed == "" {
		return ""
	}

	var envelope map[string]json.RawMessage
	if json.Unmarshal(body, &envelope) == nil {
		for _, key := range []string{"error", "message"} {
			raw, ok := envelope[key]
			if !ok {
				continue
			}
			var value string
			if json.Unmarshal(raw, &value) == nil && strings.TrimSpace(value) != "" {
				return strings.TrimSpace(value)
			}
		}
	}
	return trimmed
}

func (c *Client) requestTransportError(err error, requestURL *url.URL) error {
	if err == nil {
		return nil
	}
	return fmt.Errorf("%s", c.redactAndBound("perform request: "+err.Error(), requestURL))
}

func (c *Client) redactAndBound(message string, requestURLs ...*url.URL) string {
	redacted := sensitiveHeaderPattern.ReplaceAllString(message, "$1: [REDACTED]")
	secrets := c.authenticationSecrets(requestURLs...)
	sort.Slice(secrets, func(i, j int) bool {
		return len(secrets[i]) > len(secrets[j])
	})
	for _, secret := range secrets {
		for _, variant := range secretVariants(secret) {
			if variant != "" {
				redacted = strings.ReplaceAll(redacted, variant, "[REDACTED]")
			}
		}
	}
	return truncateErrorMessage(strings.TrimSpace(redacted), maxErrorMessageBytes)
}

func (c *Client) authenticationSecrets(requestURLs ...*url.URL) []string {
	if c == nil || c.auth == nil {
		return nil
	}

	seen := make(map[string]struct{})
	registered := c.auth.redactions.snapshot()
	secrets := make([]string, 0, len(registered)+1)
	add := func(value string) {
		if value == "" {
			return
		}
		if _, ok := seen[value]; ok {
			return
		}
		seen[value] = struct{}{}
		secrets = append(secrets, value)
	}
	for _, secret := range registered {
		add(secret)
	}
	add(c.auth.csrfToken)

	if c.auth.jar != nil {
		urls := append([]*url.URL{c.auth.apiURL}, requestURLs...)
		if loginURL, err := url.Parse(c.APIURL + "/api/auth/login"); err == nil {
			urls = append(urls, loginURL)
		}
		for _, cookieURL := range urls {
			if cookieURL == nil {
				continue
			}
			for _, cookie := range c.auth.jar.Cookies(cookieURL) {
				add(cookie.Value)
			}
		}
	}
	return secrets
}

func secretVariants(secret string) []string {
	variants := []string{secret, url.QueryEscape(secret)}
	if encoded, err := json.Marshal(secret); err == nil && len(encoded) >= 2 {
		variants = append(variants, string(encoded[1:len(encoded)-1]))
	}
	return variants
}

func truncateErrorMessage(message string, limit int) string {
	if len(message) <= limit {
		return message
	}
	const suffix = "…"
	cut := limit - len(suffix)
	if cut < 0 {
		cut = 0
	}
	for cut > 0 && !utf8.RuneStart(message[cut]) {
		cut--
	}
	return strings.TrimSpace(message[:cut]) + suffix
}

func parsedRequestURLOrNil(value string) *url.URL {
	parsed, err := url.Parse(value)
	if err != nil {
		return nil
	}
	return parsed
}

func isAuthenticationError(err error) bool {
	var target *authenticationError
	return errors.As(err, &target)
}

func loadSessionAuthEnvironment() (username string, usernameSet bool, password string, passwordSet bool) {
	username, usernameSet = os.LookupEnv(sessionAuthUsernameEnv)
	password, passwordSet = os.LookupEnv(sessionAuthPasswordEnv)
	return username, usernameSet, password, passwordSet
}
