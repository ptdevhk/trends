package client

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"strings"
	"time"
)

type Client struct {
	APIURL    string
	WorkerURL string
	Workspace string
	HTTP      *http.Client
}

func New(apiURL, workerURL, workspace string) *Client {
	return &Client{
		APIURL:    strings.TrimRight(apiURL, "/"),
		WorkerURL: strings.TrimRight(workerURL, "/"),
		Workspace: normalizeWorkspace(workspace),
		HTTP: &http.Client{
			Timeout: 90 * time.Second,
		},
	}
}

func normalizeWorkspace(value string) string {
	trimmed := strings.TrimSpace(value)
	if trimmed == "" {
		return "dev"
	}
	return trimmed
}

func (c *Client) doJSON(ctx context.Context, method string, url string, body any, target any) error {
	var payload io.Reader
	if body != nil {
		encoded, err := json.Marshal(body)
		if err != nil {
			return fmt.Errorf("marshal request body: %w", err)
		}
		payload = bytes.NewReader(encoded)
	}

	req, err := http.NewRequestWithContext(ctx, method, url, payload)
	if err != nil {
		return fmt.Errorf("create request: %w", err)
	}
	req.Header.Set("X-Workspace-Slug", c.Workspace)
	if body != nil {
		req.Header.Set("Content-Type", "application/json")
	}

	res, err := c.HTTP.Do(req)
	if err != nil {
		return fmt.Errorf("perform request: %w", err)
	}
	defer res.Body.Close()

	responseBody, err := io.ReadAll(res.Body)
	if err != nil {
		return fmt.Errorf("read response body: %w", err)
	}

	if res.StatusCode >= 400 {
		return fmt.Errorf("request %s %s failed: %d %s", method, url, res.StatusCode, strings.TrimSpace(string(responseBody)))
	}

	if target == nil || len(responseBody) == 0 {
		return nil
	}

	if err := json.Unmarshal(responseBody, target); err != nil {
		return fmt.Errorf("decode response: %w", err)
	}

	return nil
}

func (c *Client) doBinary(ctx context.Context, method string, url string, body any) ([]byte, http.Header, error) {
	var payload io.Reader
	if body != nil {
		encoded, err := json.Marshal(body)
		if err != nil {
			return nil, nil, fmt.Errorf("marshal request body: %w", err)
		}
		payload = bytes.NewReader(encoded)
	}

	req, err := http.NewRequestWithContext(ctx, method, url, payload)
	if err != nil {
		return nil, nil, fmt.Errorf("create request: %w", err)
	}
	req.Header.Set("X-Workspace-Slug", c.Workspace)
	if body != nil {
		req.Header.Set("Content-Type", "application/json")
	}

	res, err := c.HTTP.Do(req)
	if err != nil {
		return nil, nil, fmt.Errorf("perform request: %w", err)
	}
	defer res.Body.Close()

	responseBody, err := io.ReadAll(res.Body)
	if err != nil {
		return nil, nil, fmt.Errorf("read response body: %w", err)
	}

	if res.StatusCode >= 400 {
		return nil, nil, fmt.Errorf("request %s %s failed: %d %s", method, url, res.StatusCode, strings.TrimSpace(string(responseBody)))
	}

	return responseBody, res.Header, nil
}
