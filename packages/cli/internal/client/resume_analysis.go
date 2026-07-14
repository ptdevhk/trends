package client

import (
	"context"
	"fmt"
	"net/http"
	"net/url"
	"strings"
)

type ExactAnalysisExpected struct {
	JobDescriptionID string `json:"jobDescriptionId"`
	PromptVersion    int    `json:"promptVersion"`
}

type ExactAnalysisTargetStatus struct {
	CurrentResumeID          string   `json:"currentResumeId"`
	State                    string   `json:"state"`
	ExpectedAnalysisKey      string   `json:"expectedAnalysisKey"`
	ExpectedJobDescriptionID string   `json:"expectedJobDescriptionId"`
	ExpectedPromptVersion    int      `json:"expectedPromptVersion"`
	ActualJobDescriptionID   string   `json:"actualJobDescriptionId,omitempty"`
	ActualPromptVersion      int      `json:"actualPromptVersion,omitempty"`
	AnalyzedAt               int64    `json:"analyzedAt,omitempty"`
	Reasons                  []string `json:"reasons"`
}

type ExactAnalysisVerification struct {
	AllReady     bool                        `json:"allReady"`
	Ready        int                         `json:"ready"`
	Pending      int                         `json:"pending"`
	Invalid      int                         `json:"invalid"`
	CheckedAt    int64                       `json:"checkedAt"`
	DispatchedAt int64                       `json:"dispatchedAt"`
	Targets      []ExactAnalysisTargetStatus `json:"targets"`
}

type AnalysisTaskDetailResponse struct {
	Success      bool                      `json:"success"`
	Task         AnalysisTask              `json:"task"`
	Verification ExactAnalysisVerification `json:"verification"`
}

func (c *Client) GetAnalysisTask(ctx context.Context, taskID string) (*AnalysisTaskDetailResponse, error) {
	trimmedTaskID := strings.TrimSpace(taskID)
	if trimmedTaskID == "" {
		return nil, fmt.Errorf("analysis task ID is required")
	}

	endpoint := fmt.Sprintf("%s/api/resumes/analysis-tasks/%s", c.APIURL, url.PathEscape(trimmedTaskID))
	var response AnalysisTaskDetailResponse
	if err := c.doJSON(ctx, http.MethodGet, endpoint, nil, &response); err != nil {
		return nil, err
	}
	if !response.Success {
		return nil, fmt.Errorf("get analysis task request was not successful")
	}
	return &response, nil
}
