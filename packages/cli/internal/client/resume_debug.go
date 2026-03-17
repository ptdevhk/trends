package client

import (
	"context"
	"fmt"
	"net/http"
	"net/url"
	"strconv"
	"strings"
)

type ResumeMatchesResponse struct {
	Success bool                `json:"success"`
	Results []ResumeMatchResult `json:"results"`
}

type MatchRun struct {
	ID               string   `json:"id"`
	SessionID        string   `json:"sessionId,omitempty"`
	JobDescriptionID string   `json:"jobDescriptionId"`
	SampleName       string   `json:"sampleName,omitempty"`
	Mode             string   `json:"mode"`
	Status           string   `json:"status"`
	TotalCount       int      `json:"totalCount"`
	ProcessedCount   int      `json:"processedCount"`
	FailedCount      int      `json:"failedCount"`
	MatchedCount     *int     `json:"matchedCount,omitempty"`
	AvgScore         *float64 `json:"avgScore,omitempty"`
	StartedAt        string   `json:"startedAt"`
	CompletedAt      string   `json:"completedAt,omitempty"`
	Error            string   `json:"error,omitempty"`
}

type MatchRunsQuery struct {
	SessionID        string
	JobDescriptionID string
	Limit            int
}

type MatchRunsResponse struct {
	Success bool       `json:"success"`
	Runs    []MatchRun `json:"runs"`
}

type ClearResumeMatchesResponse struct {
	Success          bool   `json:"success"`
	Deleted          int    `json:"deleted"`
	JobDescriptionID string `json:"jobDescriptionId,omitempty"`
}

type ResumeRescoreRequest struct {
	SessionID        string   `json:"sessionId,omitempty"`
	Sample           string   `json:"sample,omitempty"`
	Source           string   `json:"source,omitempty"`
	Persist          *bool    `json:"persist,omitempty"`
	JobDescriptionID string   `json:"jobDescriptionId,omitempty"`
	Keywords         []string `json:"keywords,omitempty"`
	Location         string   `json:"location,omitempty"`
	ResumeIDs        []string `json:"resumeIds,omitempty"`
	Limit            int      `json:"limit,omitempty"`
}

type ResumeSkillsVersionResponse struct {
	Success bool `json:"success"`
	Version int  `json:"version"`
}

type ResumeTriggerReingestResponse struct {
	Success        bool `json:"success"`
	Scheduled      int  `json:"scheduled"`
	Batches        int  `json:"batches"`
	CurrentVersion int  `json:"currentVersion"`
	HasMore        bool `json:"hasMore"`
}

func (c *Client) ListResumeMatches(ctx context.Context, sessionID, jobDescriptionID string) (*ResumeMatchesResponse, error) {
	values := url.Values{}
	if strings.TrimSpace(sessionID) != "" {
		values.Set("sessionId", strings.TrimSpace(sessionID))
	}
	if strings.TrimSpace(jobDescriptionID) != "" {
		values.Set("jobDescriptionId", strings.TrimSpace(jobDescriptionID))
	}

	endpoint := fmt.Sprintf("%s/api/resumes/matches", c.APIURL)
	if encoded := values.Encode(); encoded != "" {
		endpoint = fmt.Sprintf("%s?%s", endpoint, encoded)
	}

	var response ResumeMatchesResponse
	if err := c.doJSON(ctx, http.MethodGet, endpoint, nil, &response); err != nil {
		return nil, err
	}
	if !response.Success {
		return nil, fmt.Errorf("resume matches request was not successful")
	}
	return &response, nil
}

func (c *Client) ListResumeMatchRuns(ctx context.Context, query MatchRunsQuery) (*MatchRunsResponse, error) {
	values := url.Values{}
	if strings.TrimSpace(query.SessionID) != "" {
		values.Set("sessionId", strings.TrimSpace(query.SessionID))
	}
	if strings.TrimSpace(query.JobDescriptionID) != "" {
		values.Set("jobDescriptionId", strings.TrimSpace(query.JobDescriptionID))
	}
	if query.Limit > 0 {
		values.Set("limit", strconv.Itoa(query.Limit))
	}

	endpoint := fmt.Sprintf("%s/api/resumes/match-runs", c.APIURL)
	if encoded := values.Encode(); encoded != "" {
		endpoint = fmt.Sprintf("%s?%s", endpoint, encoded)
	}

	var response MatchRunsResponse
	if err := c.doJSON(ctx, http.MethodGet, endpoint, nil, &response); err != nil {
		return nil, err
	}
	if !response.Success {
		return nil, fmt.Errorf("resume match runs request was not successful")
	}
	return &response, nil
}

func (c *Client) ClearResumeMatches(ctx context.Context, jobDescriptionID string) (*ClearResumeMatchesResponse, error) {
	endpoint := fmt.Sprintf("%s/api/resumes/matches", c.APIURL)
	if trimmed := strings.TrimSpace(jobDescriptionID); trimmed != "" {
		endpoint = fmt.Sprintf("%s?jobDescriptionId=%s", endpoint, url.QueryEscape(trimmed))
	}

	var response ClearResumeMatchesResponse
	if err := c.doJSON(ctx, http.MethodDelete, endpoint, nil, &response); err != nil {
		return nil, err
	}
	if !response.Success {
		return nil, fmt.Errorf("clear resume matches request was not successful")
	}
	return &response, nil
}

func (c *Client) RescoreResumeMatches(ctx context.Context, request ResumeRescoreRequest) (*ResumeMatchResponse, error) {
	if strings.TrimSpace(request.Source) == "" {
		request.Source = "sample"
	}
	request.Source = normalizeResumeSource(request.Source)
	if request.Persist == nil {
		persist := true
		request.Persist = &persist
	}

	endpoint := fmt.Sprintf("%s/api/resumes/matches/rescore", c.APIURL)
	var response ResumeMatchResponse
	if err := c.doJSON(ctx, http.MethodPost, endpoint, request, &response); err != nil {
		return nil, err
	}
	if !response.Success {
		return nil, fmt.Errorf("resume match rescore request was not successful")
	}
	return &response, nil
}

func (c *Client) GetResumeSkillsVersion(ctx context.Context) (*ResumeSkillsVersionResponse, error) {
	endpoint := fmt.Sprintf("%s/api/resumes/skills-version", c.APIURL)
	var response ResumeSkillsVersionResponse
	if err := c.doJSON(ctx, http.MethodGet, endpoint, nil, &response); err != nil {
		return nil, err
	}
	if !response.Success {
		return nil, fmt.Errorf("resume skills version request was not successful")
	}
	return &response, nil
}

func (c *Client) TriggerResumeReingest(ctx context.Context, limit int) (*ResumeTriggerReingestResponse, error) {
	payload := map[string]int{}
	if limit > 0 {
		payload["limit"] = limit
	}

	endpoint := fmt.Sprintf("%s/api/resumes/trigger-reingest", c.APIURL)
	var response ResumeTriggerReingestResponse
	if err := c.doJSON(ctx, http.MethodPost, endpoint, payload, &response); err != nil {
		return nil, err
	}
	if !response.Success {
		return nil, fmt.Errorf("resume trigger reingest request was not successful")
	}
	return &response, nil
}
