package client

import (
	"context"
	"fmt"
	"net/http"
)

type WorkerStatus struct {
	JobsExecuted int    `json:"jobs_executed"`
	JobsFailed   int    `json:"jobs_failed"`
	JobsMissed   int    `json:"jobs_missed"`
	LastRun      string `json:"last_run"`
	LastSuccess  string `json:"last_success"`
	LastFailure  string `json:"last_failure"`
	Running      bool   `json:"running"`
}

type WorkerTriggerResponse struct {
	Success    bool   `json:"success"`
	Mode       string `json:"mode"`
	StartedAt  string `json:"started_at"`
	FinishedAt string `json:"finished_at"`
	Message    string `json:"message"`
}

type SummaryRun struct {
	ID            string         `json:"id"`
	WorkspaceSlug string         `json:"workspaceSlug"`
	Period        string         `json:"period"`
	TriggerSource string         `json:"triggerSource"`
	Status        string         `json:"status"`
	Channel       string         `json:"channel,omitempty"`
	TemplateID    string         `json:"templateId,omitempty"`
	DryRun        bool           `json:"dryRun"`
	WindowStart   string         `json:"windowStart"`
	WindowEnd     string         `json:"windowEnd"`
	StartedAt     string         `json:"startedAt"`
	FinishedAt    string         `json:"finishedAt,omitempty"`
	Report        map[string]any `json:"report"`
	Content       string         `json:"content,omitempty"`
	Delivery      map[string]any `json:"delivery,omitempty"`
	Error         string         `json:"error,omitempty"`
}

type SummaryRunRequest struct {
	WorkspaceSlug string `json:"workspaceSlug,omitempty"`
	Period        string `json:"period,omitempty"`
	Channel       string `json:"channel"`
	DryRun        bool   `json:"dryRun"`
	TriggerSource string `json:"triggerSource,omitempty"`
	TemplateID    string `json:"templateId,omitempty"`
	EndAt         string `json:"endAt,omitempty"`
	To            string `json:"to,omitempty"`
	Subject       string `json:"subject,omitempty"`
	WebhookURL    string `json:"webhookUrl,omitempty"`
	BotToken      string `json:"botToken,omitempty"`
	ChatID        string `json:"chatId,omitempty"`
}

type SummaryRunInvocationResponse struct {
	Success    bool           `json:"success"`
	Channel    string         `json:"channel"`
	DryRun     bool           `json:"dryRun"`
	TemplateID string         `json:"templateId"`
	Subject    string         `json:"subject,omitempty"`
	Report     map[string]any `json:"report"`
	Content    string         `json:"content"`
	Delivery   map[string]any `json:"delivery,omitempty"`
	Run        SummaryRun     `json:"run"`
}

type SummaryRunListResponse struct {
	Success bool         `json:"success"`
	Items   []SummaryRun `json:"items"`
}

type SummaryRunDetailResponse struct {
	Success bool       `json:"success"`
	Item    SummaryRun `json:"item"`
}

func (c *Client) normalizeSummaryRunRequest(request SummaryRunRequest) SummaryRunRequest {
	if request.WorkspaceSlug == "" {
		request.WorkspaceSlug = c.Workspace
	}
	if request.Period == "" {
		request.Period = "daily"
	}
	return request
}

func (c *Client) WorkerStatus(ctx context.Context) (*WorkerStatus, error) {
	var response WorkerStatus

	proxyEndpoint := fmt.Sprintf("%s/worker/status", c.APIURL)
	if err := c.doJSON(ctx, http.MethodGet, proxyEndpoint, nil, &response); err == nil {
		return &response, nil
	}

	workerEndpoint := fmt.Sprintf("%s/worker/status", c.WorkerURL)
	if err := c.doJSON(ctx, http.MethodGet, workerEndpoint, nil, &response); err != nil {
		return nil, err
	}
	return &response, nil
}

func (c *Client) TriggerCrawl(ctx context.Context) (*WorkerTriggerResponse, error) {
	endpoint := fmt.Sprintf("%s/worker/crawl", c.APIURL)
	var response WorkerTriggerResponse
	if err := c.doJSON(ctx, http.MethodPost, endpoint, nil, &response); err != nil {
		return nil, err
	}
	if !response.Success {
		return nil, fmt.Errorf("crawl trigger request was not successful")
	}
	return &response, nil
}

func (c *Client) RunWorker(ctx context.Context, once bool) (*WorkerTriggerResponse, error) {
	endpoint := fmt.Sprintf("%s/worker/run?once=%t", c.APIURL, once)
	var response WorkerTriggerResponse
	if err := c.doJSON(ctx, http.MethodPost, endpoint, nil, &response); err != nil {
		return nil, err
	}
	if !response.Success {
		return nil, fmt.Errorf("worker run request was not successful")
	}
	return &response, nil
}

func (c *Client) RunWorkspaceSummary(ctx context.Context, request SummaryRunRequest) (*SummaryRunInvocationResponse, error) {
	endpoint := fmt.Sprintf("%s/api/summaries/run", c.APIURL)
	var response SummaryRunInvocationResponse
	if err := c.doJSON(ctx, http.MethodPost, endpoint, c.normalizeSummaryRunRequest(request), &response); err != nil {
		return nil, err
	}
	if !response.Success {
		return nil, fmt.Errorf("workspace summary request was not successful")
	}
	return &response, nil
}

func (c *Client) ListWorkspaceSummaryRuns(ctx context.Context, limit int) (*SummaryRunListResponse, error) {
	endpoint := fmt.Sprintf("%s/api/summaries/runs?limit=%d", c.APIURL, limit)
	var response SummaryRunListResponse
	if err := c.doJSON(ctx, http.MethodGet, endpoint, nil, &response); err != nil {
		return nil, err
	}
	return &response, nil
}

func (c *Client) GetWorkspaceSummaryRun(ctx context.Context, runID string) (*SummaryRunDetailResponse, error) {
	endpoint := fmt.Sprintf("%s/api/summaries/runs/%s", c.APIURL, runID)
	var response SummaryRunDetailResponse
	if err := c.doJSON(ctx, http.MethodGet, endpoint, nil, &response); err != nil {
		return nil, err
	}
	return &response, nil
}

func (c *Client) TriggerWorkerSummary(ctx context.Context, request SummaryRunRequest) (*WorkerTriggerResponse, error) {
	endpoint := fmt.Sprintf("%s/worker/summary", c.APIURL)
	var response WorkerTriggerResponse
	if err := c.doJSON(ctx, http.MethodPost, endpoint, c.normalizeSummaryRunRequest(request), &response); err != nil {
		return nil, err
	}
	if !response.Success {
		return nil, fmt.Errorf("worker summary request was not successful")
	}
	return &response, nil
}
