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
