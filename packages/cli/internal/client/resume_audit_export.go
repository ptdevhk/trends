package client

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"net/url"
	"strconv"
	"strings"
)

type ExactTaskAuditMetadata struct {
	TaskID                   string `json:"taskId"`
	Status                   string `json:"status"`
	DispatchMode             string `json:"dispatchMode"`
	WorkspaceSlug            string `json:"workspaceSlug"`
	DispatchedAt             int64  `json:"dispatchedAt"`
	CompletedAt              int64  `json:"completedAt"`
	ExpectedJobDescriptionID string `json:"expectedJobDescriptionId"`
	ExpectedPromptVersion    int    `json:"expectedPromptVersion"`
	TargetCount              int    `json:"targetCount"`
}

type ExactTaskAuditCounts struct {
	Scanned  int `json:"scanned"`
	Exported int `json:"exported"`
	Targeted int `json:"targeted"`
	Ready    int `json:"ready"`
}

type ExactTaskAuditRow struct {
	CurrentResumeID          string             `json:"currentResumeId"`
	CanonicalIdentityKey     string             `json:"canonicalIdentityKey"`
	ExternalID               string             `json:"externalId"`
	ProfileResumeID          string             `json:"profileResumeId,omitempty"`
	ProfileURL               string             `json:"profileUrl,omitempty"`
	Source                   string             `json:"source"`
	SourceKey                string             `json:"sourceKey"`
	WorkspaceSlug            string             `json:"workspaceSlug"`
	Name                     string             `json:"name,omitempty"`
	Age                      json.RawMessage    `json:"age,omitempty"`
	Location                 string             `json:"location,omitempty"`
	TaskID                   string             `json:"taskId"`
	TaskStatus               string             `json:"taskStatus"`
	TaskWorkspaceSlug        string             `json:"taskWorkspaceSlug"`
	TaskDispatchedAt         int64              `json:"taskDispatchedAt"`
	TaskCompletedAt          int64              `json:"taskCompletedAt"`
	ExpectedJobDescriptionID string             `json:"expectedJobDescriptionId"`
	ExpectedPromptVersion    int                `json:"expectedPromptVersion"`
	ExpectedAnalysisKey      string             `json:"expectedAnalysisKey"`
	ExactCohortMember        bool               `json:"exactCohortMember"`
	AnalysisState            string             `json:"analysisState"`
	AnalysisReasons          []string           `json:"analysisReasons"`
	CurrentAnalysisKey       string             `json:"currentAnalysisKey,omitempty"`
	CurrentJobDescriptionID  string             `json:"currentJobDescriptionId,omitempty"`
	CurrentPromptVersion     *int               `json:"currentPromptVersion,omitempty"`
	CurrentLocale            string             `json:"currentLocale,omitempty"`
	CurrentQueryLocation     string             `json:"currentQueryLocation,omitempty"`
	CurrentAnalyzedAt        *int64             `json:"currentAnalyzedAt,omitempty"`
	FinalAIScore             *float64           `json:"finalAiScore,omitempty"`
	CurrentRecommendation    string             `json:"currentRecommendation,omitempty"`
	CurrentBreakdown         map[string]float64 `json:"currentBreakdown,omitempty"`
	RelatedExpAuditFactor    *float64           `json:"relatedExpAuditFactor,omitempty"`
	RelatedExpContribution   *float64           `json:"relatedExpContribution,omitempty"`
	IndustryDBContribution   *float64           `json:"industryDbContribution,omitempty"`
	CurrentAISummary         string             `json:"currentAISummary,omitempty"`
	CurrentHighlights        []string           `json:"currentHighlights,omitempty"`
	CurrentConcerns          []string           `json:"currentConcerns,omitempty"`
	CurrentKeyFactors        []map[string]any   `json:"currentKeyFactors,omitempty"`
	EvidenceBandMax          *float64           `json:"evidenceBandMax,omitempty"`
	RelatedExpCoverage       string             `json:"relatedExpCoverage,omitempty"`
	MissingReasons           []string           `json:"missingReasons,omitempty"`
	EffectiveRelatedExp      *float64           `json:"effectiveRelatedExp,omitempty"`
	LLMRelatedExp            *float64           `json:"llmRelatedExp,omitempty"`
	RecommendationMax        *float64           `json:"recommendationMax,omitempty"`
	RelatedExpContextHash    string             `json:"relatedExpContextHash,omitempty"`
	RelatedExpRubricVersion  string             `json:"relatedExpRubricVersion,omitempty"`
	BrandHits                []map[string]any   `json:"brandHits,omitempty"`
	BrandOrigin              string             `json:"brandOrigin,omitempty"`
	ProductClass             string             `json:"productClass,omitempty"`
	CompanyHits              []string           `json:"companyHits,omitempty"`
	RoleSignals              []map[string]any   `json:"roleSignals,omitempty"`
	MatchedWorkEntries       []map[string]any   `json:"matchedWorkEntries,omitempty"`
	EvidenceText             string             `json:"evidenceText,omitempty"`
	Market                   string             `json:"market,omitempty"`
	RuleScores               map[string]float64 `json:"ruleScores,omitempty"`
	RuleScore                *float64           `json:"ruleScore,omitempty"`
}

type ExactTaskAuditPageResponse struct {
	Success        bool                   `json:"success"`
	Task           ExactTaskAuditMetadata `json:"task"`
	Counts         ExactTaskAuditCounts   `json:"counts"`
	Page           []ExactTaskAuditRow    `json:"page"`
	ContinueCursor string                 `json:"continueCursor"`
	IsDone         bool                   `json:"isDone"`
}

func (c *Client) GetExactTaskAuditExportPage(
	ctx context.Context,
	taskID string,
	cursor string,
	limit int,
) (*ExactTaskAuditPageResponse, error) {
	trimmedTaskID := strings.TrimSpace(taskID)
	if trimmedTaskID == "" {
		return nil, fmt.Errorf("analysis task ID is required")
	}
	if limit < 1 || limit > 200 {
		return nil, fmt.Errorf("audit export page limit must be between 1 and 200")
	}

	endpoint := fmt.Sprintf(
		"%s/api/resumes/analysis-tasks/%s/audit-export",
		c.APIURL,
		url.PathEscape(trimmedTaskID),
	)
	values := url.Values{}
	values.Set("limit", strconv.Itoa(limit))
	if cursor != "" {
		values.Set("cursor", cursor)
	}
	endpoint += "?" + values.Encode()

	var response ExactTaskAuditPageResponse
	if err := c.doJSON(ctx, http.MethodGet, endpoint, nil, &response); err != nil {
		return nil, fmt.Errorf("malformed exact task audit export page or request failure: %w", err)
	}
	if !response.Success {
		return nil, fmt.Errorf("exact task audit export page request was not successful")
	}
	return &response, nil
}
