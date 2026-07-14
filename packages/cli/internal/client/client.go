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
	auth      *sessionAuth
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

func NewWithSessionAuthFromEnvironment(apiURL, workerURL, workspace string) *Client {
	username, usernameSet, password, passwordSet := loadSessionAuthEnvironment()
	return newWithSessionAuth(apiURL, workerURL, workspace, username, usernameSet, password, passwordSet)
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
	contentType := ""
	if body != nil {
		encoded, err := json.Marshal(body)
		if err != nil {
			return fmt.Errorf("marshal request body: %w", err)
		}
		payload = bytes.NewReader(encoded)
		contentType = "application/json"
	}

	res, err := c.sendRequest(ctx, method, url, payload, contentType)
	if err != nil {
		return err
	}
	defer res.Body.Close()
	if res.StatusCode < http.StatusOK || res.StatusCode >= http.StatusMultipleChoices {
		return c.responseError(res, method)
	}

	responseBody, err := io.ReadAll(res.Body)
	if err != nil {
		return fmt.Errorf("read response body: %w", err)
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
	contentType := ""
	if body != nil {
		encoded, err := json.Marshal(body)
		if err != nil {
			return nil, nil, fmt.Errorf("marshal request body: %w", err)
		}
		payload = bytes.NewReader(encoded)
		contentType = "application/json"
	}

	res, err := c.sendRequest(ctx, method, url, payload, contentType)
	if err != nil {
		return nil, nil, err
	}
	defer res.Body.Close()
	if res.StatusCode < http.StatusOK || res.StatusCode >= http.StatusMultipleChoices {
		return nil, nil, c.responseError(res, method)
	}

	responseBody, err := io.ReadAll(res.Body)
	if err != nil {
		return nil, nil, fmt.Errorf("read response body: %w", err)
	}

	return responseBody, res.Header, nil
}

func (c *Client) doWorkerJSON(ctx context.Context, method string, url string, target any) error {
	req, err := http.NewRequestWithContext(ctx, method, url, nil)
	if err != nil {
		return fmt.Errorf("create request: %w", err)
	}
	req.Header.Set("X-Workspace-Slug", c.Workspace)

	res, err := c.HTTP.Do(req)
	if err != nil {
		return c.requestTransportError(err, req.URL)
	}
	defer res.Body.Close()
	if res.StatusCode < http.StatusOK || res.StatusCode >= http.StatusMultipleChoices {
		return c.responseError(res, method)
	}

	responseBody, err := io.ReadAll(res.Body)
	if err != nil {
		return fmt.Errorf("read response body: %w", err)
	}
	if target == nil || len(responseBody) == 0 {
		return nil
	}
	if err := json.Unmarshal(responseBody, target); err != nil {
		return fmt.Errorf("decode response: %w", err)
	}
	return nil
}
