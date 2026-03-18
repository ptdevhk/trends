package client

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
)

type ResumeBackupRequest struct {
	ResumeIDs   []string `json:"resumeIds,omitempty"`
	SourceHosts []string `json:"sourceHosts,omitempty"`
	Limit       int      `json:"limit,omitempty"`
}

type ResumeSubmitSummary struct {
	Success   bool `json:"success"`
	Submitted int  `json:"submitted"`
	Inserted  int  `json:"inserted"`
	Updated   int  `json:"updated"`
	Unchanged int  `json:"unchanged"`
	Deduped   int  `json:"deduped"`
}

type ResumeResetResponse struct {
	Success bool           `json:"success"`
	Count   int            `json:"count"`
	Partial bool           `json:"partial"`
	Deleted map[string]int `json:"deleted"`
}

func (c *Client) BackupResumes(ctx context.Context, request ResumeBackupRequest) ([]byte, string, error) {
	endpoint := fmt.Sprintf("%s/api/resumes/backup", c.APIURL)
	payload, headers, err := c.doBinary(ctx, http.MethodPost, endpoint, request)
	if err != nil {
		return nil, "", err
	}
	return payload, headers.Get("Content-Disposition"), nil
}

func (c *Client) ImportResumeBackup(ctx context.Context, payload json.RawMessage) (*ResumeSubmitSummary, error) {
	endpoint := fmt.Sprintf("%s/api/resumes/import", c.APIURL)

	var response ResumeSubmitSummary
	if err := c.doJSON(ctx, http.MethodPost, endpoint, payload, &response); err != nil {
		return nil, err
	}
	if !response.Success {
		return nil, fmt.Errorf("resume import request was not successful")
	}
	return &response, nil
}

func (c *Client) ResetResumes(ctx context.Context) (*ResumeResetResponse, error) {
	endpoint := fmt.Sprintf("%s/api/resumes/reset", c.APIURL)

	var response ResumeResetResponse
	if err := c.doJSON(ctx, http.MethodPost, endpoint, nil, &response); err != nil {
		return nil, err
	}
	if !response.Success {
		return nil, fmt.Errorf("resume reset request was not successful")
	}
	return &response, nil
}
