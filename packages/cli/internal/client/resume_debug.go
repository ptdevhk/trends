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
	Success             bool `json:"success"`
	Version             int  `json:"version"`
	IngestComputeEpoch  int  `json:"ingestComputeEpoch,omitempty"`
}

type ResumeTriggerReingestResponse struct {
	Success                   bool   `json:"success"`
	Scheduled                 int    `json:"scheduled"`
	Batches                   int    `json:"batches"`
	CurrentVersion            int    `json:"currentVersion"`
	CurrentIngestComputeEpoch int    `json:"currentIngestComputeEpoch,omitempty"`
	HasMore                   bool   `json:"hasMore"`
	Mode                      string `json:"mode,omitempty"`
	DryRun                    bool   `json:"dryRun,omitempty"`
	SkillsStaleCount          int    `json:"skillsStaleCount,omitempty"`
	ComputeStaleCount         int    `json:"computeStaleCount,omitempty"`
	MatchedCount              int    `json:"matchedCount,omitempty"`
}

type ResumeSearchFreshnessResponse struct {
	Success                    bool   `json:"success"`
	CurrentSkillsVersion       int    `json:"currentSkillsVersion"`
	CurrentIngestComputeEpoch  int    `json:"currentIngestComputeEpoch"`
	APIReachable               bool   `json:"apiReachable"`
	ExitCodeHint               int    `json:"exitCodeHint"`
	Messages                   []string `json:"messages,omitempty"`
	Lag                        struct {
		Scanned       int  `json:"scanned"`
		WithIngestData int `json:"withIngestData"`
		SkillsStale   int  `json:"skillsStale"`
		ComputeStale  int  `json:"computeStale"`
		MissingEpoch  int  `json:"missingEpoch"`
		CurrentEpoch  int  `json:"currentEpoch"`
		ScanComplete  bool `json:"scanComplete"`
	} `json:"lag"`
	GoldenQueries []struct {
		ID            string  `json:"id"`
		Location      string  `json:"location"`
		Q             string  `json:"q"`
		MinRoleYears  int     `json:"minRoleYears"`
		RoleType      string  `json:"roleType,omitempty"`
		MinTotalFloor int     `json:"minTotalFloor"`
		Total         *int    `json:"total"`
		OK            *bool   `json:"ok"`
		Error         string  `json:"error,omitempty"`
	} `json:"goldenQueries"`
}

type ExactReingestTarget struct {
	ReferenceResumeID string `json:"referenceResumeId,omitempty"`
	CurrentResumeID   string `json:"currentResumeId,omitempty"`
	ProfileResumeID   string `json:"profileResumeId,omitempty"`
	ProfileURL        string `json:"profileUrl,omitempty"`
	ExternalID        string `json:"externalId,omitempty"`
	IdentityKey       string `json:"identityKey,omitempty"`
	Source            string `json:"source,omitempty"`
}

type ExactReingestRequest struct {
	Targets []ExactReingestTarget `json:"targets"`
	DryRun  bool                  `json:"dryRun"`
}

type ExactReingestResolvedSelector struct {
	Kind  string `json:"kind"`
	Value string `json:"value"`
}

type ExactReingestResolvedTarget struct {
	ReferenceResumeID    string                          `json:"referenceResumeId,omitempty"`
	CurrentResumeID      string                          `json:"currentResumeId"`
	ProfileResumeID      string                          `json:"profileResumeId,omitempty"`
	ProfileURL           string                          `json:"profileUrl,omitempty"`
	ExternalID           string                          `json:"externalId"`
	Source               string                          `json:"source"`
	CanonicalIdentityKey string                          `json:"canonicalIdentityKey"`
	Outcome              string                          `json:"outcome"`
	Selectors            []ExactReingestResolvedSelector `json:"selectors"`
}

type ExactReingestResponse struct {
	Success               bool                            `json:"success"`
	DryRun                bool                            `json:"dryRun"`
	ManifestVersion       int                             `json:"manifestVersion"`
	ExpectedSkillsVersion int                             `json:"expectedSkillsVersion"`
	Requested             int                             `json:"requested"`
	Resolved              int                             `json:"resolved"`
	Scheduled             int                             `json:"scheduled"`
	Batches               int                             `json:"batches"`
	DispatchedAt          int64                           `json:"dispatchedAt,omitempty"`
	ResumeIDs             []string                        `json:"resumeIds"`
	Targets               []ExactReingestResolvedTarget   `json:"targets"`
	Readiness             *ExactReingestReadinessResponse `json:"readiness,omitempty"`
}

type ExactReingestReadinessRequest struct {
	ResumeIDs             []string `json:"resumeIds"`
	DispatchedAt          int64    `json:"dispatchedAt"`
	ExpectedSkillsVersion int      `json:"expectedSkillsVersion"`
}

type ExactReingestReadinessTarget struct {
	CurrentResumeID     string   `json:"currentResumeId"`
	State               string   `json:"state"`
	ComputedAt          int64    `json:"computedAt,omitempty"`
	SkillsVersion       int      `json:"skillsVersion,omitempty"`
	Phase2FieldsPresent bool     `json:"phase2FieldsPresent"`
	Reasons             []string `json:"reasons"`
}

type ExactReingestReadinessResponse struct {
	Success               bool                           `json:"success"`
	AllReady              bool                           `json:"allReady"`
	Ready                 int                            `json:"ready"`
	Pending               int                            `json:"pending"`
	Invalid               int                            `json:"invalid"`
	CheckedAt             int64                          `json:"checkedAt"`
	DispatchedAt          int64                          `json:"dispatchedAt"`
	ExpectedSkillsVersion int                            `json:"expectedSkillsVersion"`
	Targets               []ExactReingestReadinessTarget `json:"targets"`
}

type ResumeDiagnosticsQuery struct {
	Archived   bool
	SourceKeys []string
	Limit      int
}

type ResumeDiagnosticsSummary struct {
	Archived   bool     `json:"archived"`
	SourceKeys []string `json:"sourceKeys,omitempty"`
	Returned   int      `json:"returned"`
	Limit      int      `json:"limit"`
}

type ResumeDiagnosticsItem struct {
	ResumeID     string `json:"resumeId"`
	ExternalID   string `json:"externalId"`
	Source       string `json:"source"`
	SourceKey    string `json:"sourceKey"`
	Name         string `json:"name"`
	JobIntention string `json:"jobIntention"`
	Location     string `json:"location"`
	IsArchived   bool   `json:"isArchived,omitempty"`
	ArchivedAt   int64  `json:"archivedAt,omitempty"`
}

type ResumeDiagnosticsResponse struct {
	Success bool                     `json:"success"`
	Summary ResumeDiagnosticsSummary `json:"summary"`
	Data    []ResumeDiagnosticsItem  `json:"data"`
}

func normalizeSourceKeys(values []string) []string {
	normalized := make([]string, 0, len(values))
	seen := make(map[string]struct{}, len(values))
	for _, value := range values {
		trimmed := strings.ToLower(strings.TrimSpace(value))
		if trimmed == "" {
			continue
		}
		if _, exists := seen[trimmed]; exists {
			continue
		}
		seen[trimmed] = struct{}{}
		normalized = append(normalized, trimmed)
	}
	return normalized
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
	return c.TriggerResumeReingestWithOptions(ctx, limit, "any", false)
}

func (c *Client) TriggerResumeReingestWithOptions(
	ctx context.Context,
	limit int,
	mode string,
	dryRun bool,
) (*ResumeTriggerReingestResponse, error) {
	payload := map[string]any{}
	if limit > 0 {
		payload["limit"] = limit
	}
	if strings.TrimSpace(mode) != "" {
		payload["mode"] = strings.TrimSpace(mode)
	}
	if dryRun {
		payload["dryRun"] = true
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

func (c *Client) GetResumeSearchFreshness(ctx context.Context, scanLimit int, skipGolden bool) (*ResumeSearchFreshnessResponse, error) {
	values := url.Values{}
	if scanLimit > 0 {
		values.Set("scanLimit", strconv.Itoa(scanLimit))
	}
	if skipGolden {
		values.Set("skipGolden", "true")
	}
	endpoint := fmt.Sprintf("%s/api/resumes/search-freshness", c.APIURL)
	if encoded := values.Encode(); encoded != "" {
		endpoint = endpoint + "?" + encoded
	}
	var response ResumeSearchFreshnessResponse
	if err := c.doJSON(ctx, http.MethodGet, endpoint, nil, &response); err != nil {
		return nil, err
	}
	if !response.Success {
		return nil, fmt.Errorf("resume search freshness request was not successful")
	}
	return &response, nil
}

func (c *Client) ExactResumeReingest(ctx context.Context, request ExactReingestRequest) (*ExactReingestResponse, error) {
	endpoint := fmt.Sprintf("%s/api/resumes/exact-reingest", c.APIURL)
	var response ExactReingestResponse
	if err := c.doJSON(ctx, http.MethodPost, endpoint, request, &response); err != nil {
		return nil, err
	}
	if !response.Success {
		return nil, fmt.Errorf("exact resume reingest request was not successful")
	}
	return &response, nil
}

func (c *Client) GetExactResumeReingestReadiness(
	ctx context.Context,
	request ExactReingestReadinessRequest,
) (*ExactReingestReadinessResponse, error) {
	endpoint := fmt.Sprintf("%s/api/resumes/exact-reingest/readiness", c.APIURL)
	var response ExactReingestReadinessResponse
	if err := c.doJSON(ctx, http.MethodPost, endpoint, request, &response); err != nil {
		return nil, err
	}
	if !response.Success {
		return nil, fmt.Errorf("exact resume reingest readiness request was not successful")
	}
	return &response, nil
}

func (c *Client) ListResumeDiagnostics(ctx context.Context, query ResumeDiagnosticsQuery) (*ResumeDiagnosticsResponse, error) {
	values := url.Values{}
	values.Set("archived", strconv.FormatBool(query.Archived))
	if query.Limit > 0 {
		values.Set("limit", strconv.Itoa(query.Limit))
	}
	for _, sourceKey := range normalizeSourceKeys(query.SourceKeys) {
		values.Add("sourceKey", sourceKey)
	}

	endpoint := fmt.Sprintf("%s/api/resumes/diagnostics", c.APIURL)
	if encoded := values.Encode(); encoded != "" {
		endpoint = fmt.Sprintf("%s?%s", endpoint, encoded)
	}

	var response ResumeDiagnosticsResponse
	if err := c.doJSON(ctx, http.MethodGet, endpoint, nil, &response); err != nil {
		return nil, err
	}
	if !response.Success {
		return nil, fmt.Errorf("resume diagnostics request was not successful")
	}
	return &response, nil
}
