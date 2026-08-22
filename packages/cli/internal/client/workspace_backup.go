package client

import (
	"context"
	"fmt"
	"net/http"
	"net/url"
)

// Workspace snapshot types mirror the BFF workspace export/import envelope
// (apps/api/src/routes/workspace-snapshots.ts). Table rows are opaque JSON
// objects as stored by Convex.
type WorkspaceSnapshotTables struct {
	CandidateStatus []map[string]any `json:"candidateStatus"`
	CandidateBlocks []map[string]any `json:"candidateBlocks"`
	SearchProfiles  []map[string]any `json:"searchProfiles"`
	WorkspaceConfig []map[string]any `json:"workspaceConfig"`
}

type WorkspaceSnapshotCounts struct {
	CandidateStatus int `json:"candidateStatus"`
	CandidateBlocks int `json:"candidateBlocks"`
	SearchProfiles  int `json:"searchProfiles"`
	WorkspaceConfig int `json:"workspaceConfig"`
}

type WorkspaceSnapshotExportResponse struct {
	Success       bool                    `json:"success"`
	SchemaVersion int                     `json:"schemaVersion"`
	Profile       string                  `json:"profile"`
	WorkspaceSlug string                  `json:"workspaceSlug"`
	ExportedAt    int64                   `json:"exportedAt"`
	Tables        WorkspaceSnapshotTables `json:"tables"`
}

type WorkspaceSnapshotImportRequest struct {
	SchemaVersion int                     `json:"schemaVersion,omitempty"`
	Profile       string                  `json:"profile"`
	Mode          string                  `json:"mode"`
	Tables        WorkspaceSnapshotTables `json:"tables"`
}

type WorkspaceSnapshotImportResult struct {
	Success       bool                    `json:"success"`
	SchemaVersion int                     `json:"schemaVersion"`
	Profile       string                  `json:"profile"`
	WorkspaceSlug string                  `json:"workspaceSlug"`
	Mode          string                  `json:"mode"`
	Applied       WorkspaceSnapshotCounts `json:"applied"`
	Deleted       WorkspaceSnapshotCounts `json:"deleted"`
}

func (c *Client) ExportWorkspaceSnapshot(ctx context.Context, profile string) (*WorkspaceSnapshotExportResponse, error) {
	endpoint := fmt.Sprintf("%s/api/workspace/export?profile=%s", c.APIURL, url.QueryEscape(profile))

	var response WorkspaceSnapshotExportResponse
	if err := c.doJSON(ctx, http.MethodGet, endpoint, nil, &response); err != nil {
		return nil, err
	}
	if !response.Success {
		return nil, fmt.Errorf("workspace export request was not successful")
	}
	return &response, nil
}

func (c *Client) ImportWorkspaceSnapshot(ctx context.Context, request WorkspaceSnapshotImportRequest) (*WorkspaceSnapshotImportResult, error) {
	endpoint := fmt.Sprintf("%s/api/workspace/import", c.APIURL)

	var response WorkspaceSnapshotImportResult
	if err := c.doJSON(ctx, http.MethodPost, endpoint, request, &response); err != nil {
		return nil, err
	}
	if !response.Success {
		return nil, fmt.Errorf("workspace import request was not successful")
	}
	return &response, nil
}
