package client

import (
	"context"
	"fmt"
	"net/url"
	"strings"
)

type ResearchSignalEvidence struct {
	NewsItemID string `json:"newsItemId,omitempty"`
	Title      string `json:"title"`
	URL        string `json:"url,omitempty"`
	Platform   string `json:"platform"`
	SeenAt     int64  `json:"seenAt"`
	Snippet    string `json:"snippet,omitempty"`
}

type ResearchSignal struct {
	ID          string                 `json:"_id"`
	CompanyKey  string                 `json:"companyKey"`
	Kind        string                 `json:"kind"`
	Title       string                 `json:"title"`
	Summary     string                 `json:"summary,omitempty"`
	Evidence    ResearchSignalEvidence `json:"evidence"`
	Score       *float64               `json:"score,omitempty"`
	CapturedAt  int64                  `json:"capturedAt"`
	IngestRunID string                 `json:"ingestRunId,omitempty"`
}

type ResearchSignalsResponse struct {
	Success bool              `json:"success"`
	Persona string            `json:"persona"`
	Items   []ResearchSignal  `json:"items"`
}

type ResearchCompanyHit struct {
	CompanyKey  string `json:"companyKey"`
	DisplayName string `json:"displayName"`
	NameCn      string `json:"nameCn,omitempty"`
	NameEn      string `json:"nameEn,omitempty"`
}

type ResearchCompaniesSearchResponse struct {
	Success bool                 `json:"success"`
	Items   []ResearchCompanyHit `json:"items"`
}

type ResearchIngestResponse struct {
	Success    bool   `json:"success"`
	Mode       string `json:"mode"`
	StartedAt  string `json:"started_at,omitempty"`
	FinishedAt string `json:"finished_at,omitempty"`
	Message    string `json:"message"`
}

type ResearchParityResponse struct {
	Success bool        `json:"success"`
	Parity  interface{} `json:"parity"`
}

func (c *Client) ListCompanyResearchSignals(ctx context.Context, companyKey string, persona string) (*ResearchSignalsResponse, error) {
	key := strings.TrimSpace(companyKey)
	if key == "" {
		return nil, fmt.Errorf("companyKey is required")
	}
	q := url.Values{}
	if persona != "" {
		q.Set("persona", persona)
	}
	path := fmt.Sprintf("/api/research/companies/%s/signals", url.PathEscape(key))
	if encoded := q.Encode(); encoded != "" {
		path = path + "?" + encoded
	}
	var out ResearchSignalsResponse
	if err := c.doJSON(ctx, "GET", c.APIURL+path, nil, &out); err != nil {
		return nil, err
	}
	return &out, nil
}

func (c *Client) SearchResearchCompanies(ctx context.Context, query string) (*ResearchCompaniesSearchResponse, error) {
	q := url.Values{}
	if strings.TrimSpace(query) != "" {
		q.Set("q", query)
	}
	path := "/api/research/companies/search"
	if encoded := q.Encode(); encoded != "" {
		path = path + "?" + encoded
	}
	var out ResearchCompaniesSearchResponse
	if err := c.doJSON(ctx, "GET", c.APIURL+path, nil, &out); err != nil {
		return nil, err
	}
	return &out, nil
}

func (c *Client) TriggerResearchIngest(ctx context.Context) (*ResearchIngestResponse, error) {
	var out ResearchIngestResponse
	if err := c.doJSON(ctx, "POST", c.APIURL+"/api/research/ingest/run", map[string]any{}, &out); err != nil {
		return nil, err
	}
	return &out, nil
}

func (c *Client) GetResearchParity(ctx context.Context) (*ResearchParityResponse, error) {
	var out ResearchParityResponse
	if err := c.doJSON(ctx, "GET", c.APIURL+"/api/research/parity", nil, &out); err != nil {
		return nil, err
	}
	return &out, nil
}
