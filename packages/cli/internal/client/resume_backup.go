package client

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"mime/multipart"
	"net/http"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"time"
)

const fullResumeBackupRequestTimeout = 5 * time.Minute

type ResumeBackupRequest struct {
	ResumeIDs   []string `json:"resumeIds,omitempty"`
	SourceHosts []string `json:"sourceHosts,omitempty"`
	Limit       int      `json:"limit,omitempty"`
}

type ResumeSubmitSummary struct {
	Success         bool `json:"success"`
	Submitted       int  `json:"submitted"`
	Inserted        int  `json:"inserted"`
	Updated         int  `json:"updated"`
	Unchanged       int  `json:"unchanged"`
	Deduped         int  `json:"deduped"`
	StatusReplayed  int  `json:"statusReplayed"`
	ActionsReplayed int  `json:"actionsReplayed"`
	ActionsDeduped  int  `json:"actionsDeduped"`
}

type ResumeResetResponse struct {
	Success bool           `json:"success"`
	Count   int            `json:"count"`
	Partial bool           `json:"partial"`
	Deleted map[string]int `json:"deleted"`
}

type ResumeManualImportRequest struct {
	FilePaths       []string
	SearchProfileID string
	Keyword         string
	Location        string
	Limit           int
}

type ResumeManualImportSource struct {
	Key   string `json:"key"`
	Label string `json:"label"`
}

type ResumeManualImportFileResult struct {
	UploadName string   `json:"uploadName"`
	EntryPath  string   `json:"entryPath"`
	Extension  string   `json:"extension"`
	Status     string   `json:"status"`
	ResumeName string   `json:"resumeName,omitempty"`
	ProfileID  string   `json:"profileId,omitempty"`
	Warnings   []string `json:"warnings,omitempty"`
	Error      string   `json:"error,omitempty"`
}

type ResumeManualImportSummary struct {
	UploadedFiles   int `json:"uploadedFiles"`
	DiscoveredFiles int `json:"discoveredFiles"`
	ParsedResumes   int `json:"parsedResumes"`
	Imported        int `json:"imported"`
	Inserted        int `json:"inserted"`
	Updated         int `json:"updated"`
	Unchanged       int `json:"unchanged"`
	Deduped         int `json:"deduped"`
	Skipped         int `json:"skipped"`
	Failed          int `json:"failed"`
}

type ResumeManualImportResponse struct {
	Success  bool                           `json:"success"`
	Source   ResumeManualImportSource       `json:"source"`
	Summary  ResumeManualImportSummary      `json:"summary"`
	Files    []ResumeManualImportFileResult `json:"files"`
	Warnings []string                       `json:"warnings,omitempty"`
}

func (c *Client) BackupResumes(ctx context.Context, request ResumeBackupRequest) ([]byte, string, error) {
	endpoint := fmt.Sprintf("%s/api/resumes/backup", c.APIURL)
	minimumTimeout := time.Duration(0)
	if len(request.ResumeIDs) == 0 && len(request.SourceHosts) == 0 && request.Limit <= 0 {
		minimumTimeout = fullResumeBackupRequestTimeout
	}
	payload, headers, err := c.doBinaryWithRequestTimeout(
		ctx,
		http.MethodPost,
		endpoint,
		request,
		minimumTimeout,
	)
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

type ResetCandidateActionsResponse struct {
	Success bool `json:"success"`
	Deleted int  `json:"deleted"`
}

func (c *Client) ResetCandidateActions(ctx context.Context, workspaceSlug string) (*ResetCandidateActionsResponse, error) {
	endpoint := fmt.Sprintf("%s/api/resumes/candidate-actions/reset", c.APIURL)

	request := map[string]string{"workspaceSlug": workspaceSlug}

	var response ResetCandidateActionsResponse
	if err := c.doJSON(ctx, http.MethodPost, endpoint, request, &response); err != nil {
		return nil, err
	}
	if !response.Success {
		return nil, fmt.Errorf("candidate actions reset request was not successful")
	}
	return &response, nil
}

func (c *Client) ImportManualResumes(ctx context.Context, request ResumeManualImportRequest) (*ResumeManualImportResponse, error) {
	filePaths := normalizeManualImportFilePaths(request.FilePaths)
	if len(filePaths) == 0 {
		return nil, fmt.Errorf("at least one file path is required")
	}

	var body bytes.Buffer
	writer := multipart.NewWriter(&body)

	for _, filePath := range filePaths {
		if err := appendManualImportFile(writer, filePath); err != nil {
			_ = writer.Close()
			return nil, err
		}
	}
	if err := writeManualImportField(writer, "searchProfileId", request.SearchProfileID); err != nil {
		_ = writer.Close()
		return nil, err
	}
	if err := writeManualImportField(writer, "keyword", request.Keyword); err != nil {
		_ = writer.Close()
		return nil, err
	}
	if err := writeManualImportField(writer, "location", request.Location); err != nil {
		_ = writer.Close()
		return nil, err
	}
	if request.Limit > 0 {
		if err := writeManualImportField(writer, "limit", strconv.Itoa(request.Limit)); err != nil {
			_ = writer.Close()
			return nil, err
		}
	}
	if err := writer.Close(); err != nil {
		return nil, fmt.Errorf("finalize multipart request: %w", err)
	}

	endpoint := fmt.Sprintf("%s/api/resumes/manual-import", c.APIURL)
	res, err := c.sendRequest(ctx, http.MethodPost, endpoint, &body, writer.FormDataContentType())
	if err != nil {
		return nil, err
	}
	defer res.Body.Close()
	if res.StatusCode < http.StatusOK || res.StatusCode >= http.StatusMultipleChoices {
		return nil, c.responseError(res, http.MethodPost)
	}

	responseBody, err := io.ReadAll(res.Body)
	if err != nil {
		return nil, fmt.Errorf("read response body: %w", err)
	}
	var response ResumeManualImportResponse
	if err := json.Unmarshal(responseBody, &response); err != nil {
		return nil, fmt.Errorf("decode response: %w", err)
	}
	if !response.Success {
		return nil, fmt.Errorf("manual resume import request was not successful")
	}
	return &response, nil
}

func normalizeManualImportFilePaths(filePaths []string) []string {
	normalized := make([]string, 0, len(filePaths))
	for _, filePath := range filePaths {
		trimmed := strings.TrimSpace(filePath)
		if trimmed != "" {
			normalized = append(normalized, trimmed)
		}
	}
	return normalized
}

func appendManualImportFile(writer *multipart.Writer, filePath string) error {
	file, err := os.Open(filePath)
	if err != nil {
		return fmt.Errorf("open upload file %s: %w", filePath, err)
	}
	defer file.Close()

	info, err := file.Stat()
	if err != nil {
		return fmt.Errorf("stat upload file %s: %w", filePath, err)
	}
	if info.IsDir() {
		return fmt.Errorf("upload path %s is a directory", filePath)
	}

	part, err := writer.CreateFormFile("files", filepath.Base(filePath))
	if err != nil {
		return fmt.Errorf("create multipart file for %s: %w", filePath, err)
	}
	if _, err := io.Copy(part, file); err != nil {
		return fmt.Errorf("copy upload file %s: %w", filePath, err)
	}
	return nil
}

func writeManualImportField(writer *multipart.Writer, key string, value string) error {
	trimmed := strings.TrimSpace(value)
	if trimmed == "" {
		return nil
	}
	if err := writer.WriteField(key, trimmed); err != nil {
		return fmt.Errorf("write multipart field %s: %w", key, err)
	}
	return nil
}
