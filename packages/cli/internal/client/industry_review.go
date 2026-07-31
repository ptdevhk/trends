package client

import (
	"context"
	"fmt"
	"net/http"
	"net/url"
	"strconv"
	"strings"
)

// IndustryReviewProposal mirrors the proposal portion of industry-review.v1.
// Keep this contract read-only: the CLI can prepare a human review packet, but
// approval remains an authenticated admin UI/API action.
type IndustryReviewProposal struct {
	ID                         string                    `json:"_id"`
	ProposalID                 string                    `json:"proposalId"`
	CompanyKey                 string                    `json:"companyKey,omitempty"`
	NormalizedEmployerSurface  string                    `json:"normalizedEmployerSurface,omitempty"`
	TriggerReasons             []string                  `json:"triggerReasons"`
	Priority                   int                       `json:"priority"`
	CurrentRevisionID          string                    `json:"currentRevisionId,omitempty"`
	SuggestedIndustryClass     string                    `json:"suggestedIndustryClass,omitempty"`
	SuggestedVerificationLevel string                    `json:"suggestedVerificationLevel,omitempty"`
	MaterialChangeSummary      string                    `json:"materialChangeSummary,omitempty"`
	Status                     string                    `json:"status"`
	RequestedBy                string                    `json:"requestedBy,omitempty"`
	ResearchStartedAt          int64                     `json:"researchStartedAt,omitempty"`
	ReadyForReviewAt           int64                     `json:"readyForReviewAt,omitempty"`
	ReviewedAt                 int64                     `json:"reviewedAt,omitempty"`
	ReviewedBy                 string                    `json:"reviewedBy,omitempty"`
	ReviewNote                 string                    `json:"reviewNote,omitempty"`
	ApprovedRevisionID         string                    `json:"approvedRevisionId,omitempty"`
	RecomputeRunID             string                    `json:"recomputeRunId,omitempty"`
	ApplicationState           string                    `json:"applicationState,omitempty"`
	AppliedRevisionID          string                    `json:"appliedRevisionId,omitempty"`
	AppliedAt                  int64                     `json:"appliedAt,omitempty"`
	CreatedAt                  int64                     `json:"createdAt"`
	UpdatedAt                  int64                     `json:"updatedAt"`
	SampleReferences           []IndustryReviewSampleRef `json:"sampleReferences,omitempty"`
}

type IndustryReviewSampleRef struct {
	WorkspaceSlug        string `json:"workspaceSlug"`
	ResumeIdentity       string `json:"resumeIdentity"`
	WorkEntryFingerprint string `json:"workEntryFingerprint,omitempty"`
}

type IndustryReviewSource struct {
	ID                     string  `json:"_id"`
	SourceID               string  `json:"sourceId"`
	CompanyKey             string  `json:"companyKey,omitempty"`
	ProposalID             string  `json:"proposalId,omitempty"`
	URL                    string  `json:"url"`
	SourceDomain           string  `json:"sourceDomain"`
	SourceType             string  `json:"sourceType"`
	TrustTier              string  `json:"trustTier"`
	Title                  string  `json:"title,omitempty"`
	EvidenceExcerpt        string  `json:"evidenceExcerpt,omitempty"`
	FetchedAt              int64   `json:"fetchedAt,omitempty"`
	LastSuccessfulFetchAt  int64   `json:"lastSuccessfulFetchAt,omitempty"`
	ContentFingerprint     string  `json:"contentFingerprint,omitempty"`
	FetchStatus            string  `json:"fetchStatus"`
	SuggestedIndustryClass string  `json:"suggestedIndustryClass,omitempty"`
	WorkerConfidence       float64 `json:"workerConfidence,omitempty"`
	ReviewStatus           string  `json:"reviewStatus"`
	ReviewedAt             int64   `json:"reviewedAt,omitempty"`
	ReviewedBy             string  `json:"reviewedBy,omitempty"`
	ReviewerNote           string  `json:"reviewerNote,omitempty"`
	SourceState            string  `json:"sourceState"`
	SupersededBySourceID   string  `json:"supersededBySourceId,omitempty"`
	CreatedAt              int64   `json:"createdAt"`
	UpdatedAt              int64   `json:"updatedAt"`
}

type IndustryReviewSourceDecision struct {
	SourceID     string   `json:"sourceId"`
	ApprovalSafe bool     `json:"approvalSafe"`
	Recommended  bool     `json:"recommended"`
	ReasonCodes  []string `json:"reasonCodes"`
}

type IndustryReviewRecommendation struct {
	ProposalID                   string                         `json:"proposalId"`
	ProposalStatus               string                         `json:"proposalStatus"`
	RecommendedAction            string                         `json:"recommendedAction"`
	RecommendedVerificationLevel string                         `json:"recommendedVerificationLevel"`
	RecommendedIndustryClass     string                         `json:"recommendedIndustryClass"`
	RecommendedSourceIDs         []string                       `json:"recommendedSourceIds"`
	SourceDecisions              []IndustryReviewSourceDecision `json:"sourceDecisions"`
	ConfidenceBand               string                         `json:"confidenceBand"`
	RiskFlags                    []string                       `json:"riskFlags"`
	Reasons                      []string                       `json:"reasons"`
	ExcludedSourceReasons        map[string]string              `json:"excludedSourceReasons"`
	EvidenceSummaryDraft         string                         `json:"evidenceSummaryDraft"`
	DecisionReasonDraft          string                         `json:"decisionReasonDraft"`
	RequiresHumanReview          bool                           `json:"requiresHumanReview"`
}

type IndustryReviewWarning struct {
	Code    string `json:"code"`
	Message string `json:"message"`
	Action  string `json:"action,omitempty"`
}

type IndustryReviewDataset struct {
	Revision          string                        `json:"revision"`
	InputFingerprint  string                        `json:"inputFingerprint"`
	GeneratedAt       int64                         `json:"generatedAt"`
	ProposalUpdatedAt int64                         `json:"proposalUpdatedAt"`
	SourceVersions    []IndustryReviewSourceVersion `json:"sourceVersions"`
	GitSHA            string                        `json:"gitSha,omitempty"`
}

type IndustryReviewSourceVersion struct {
	SourceID  string `json:"sourceId"`
	UpdatedAt int64  `json:"updatedAt"`
}

type IndustryReviewOperation struct {
	ID    string `json:"id"`
	Kind  string `json:"kind"`
	State string `json:"state"`
}

type IndustryReviewMaintenanceContext struct {
	Latest     map[string]any `json:"latest"`
	LastFailed map[string]any `json:"lastFailed"`
}

type IndustryReviewQueueItem struct {
	Proposal       IndustryReviewProposal       `json:"proposal"`
	Recommendation IndustryReviewRecommendation `json:"recommendation"`
	SourceCount    int                          `json:"sourceCount"`
}

type IndustryReviewQueueResponse struct {
	Success       bool                             `json:"success"`
	OK            bool                             `json:"ok"`
	SchemaVersion string                           `json:"schemaVersion"`
	Items         []IndustryReviewQueueItem        `json:"items"`
	Maintenance   IndustryReviewMaintenanceContext `json:"maintenance"`
}

type IndustryReviewPacket struct {
	Success        bool                             `json:"success"`
	OK             bool                             `json:"ok"`
	SchemaVersion  string                           `json:"schemaVersion"`
	Operation      IndustryReviewOperation          `json:"operation"`
	Dataset        IndustryReviewDataset            `json:"dataset"`
	Recommendation IndustryReviewRecommendation     `json:"recommendation"`
	Warnings       []IndustryReviewWarning          `json:"warnings"`
	Proposal       IndustryReviewProposal           `json:"proposal"`
	Sources        []IndustryReviewSource           `json:"sources"`
	Bundle         any                              `json:"bundle"`
	RecomputeRuns  []any                            `json:"recomputeRuns"`
	Maintenance    IndustryReviewMaintenanceContext `json:"maintenance"`
}

type IndustryReviewRecommendationEnvelope struct {
	Success        bool                         `json:"success"`
	OK             bool                         `json:"ok"`
	SchemaVersion  string                       `json:"schemaVersion"`
	Operation      IndustryReviewOperation      `json:"operation"`
	Dataset        IndustryReviewDataset        `json:"dataset"`
	Recommendation IndustryReviewRecommendation `json:"recommendation"`
	Warnings       []IndustryReviewWarning      `json:"warnings"`
}

type IndustryReviewOpenLink struct {
	ProposalID string `json:"proposalId"`
	URL        string `json:"url"`
	Action     string `json:"action"`
}

func validateIndustryReviewResponse(success bool, ok bool, resource string) error {
	if !success || !ok {
		return fmt.Errorf("industry review %s request was not successful", resource)
	}
	return nil
}

func (c *Client) ListIndustryReviewQueue(ctx context.Context, status string, limit int) (*IndustryReviewQueueResponse, error) {
	query := url.Values{}
	if trimmed := strings.TrimSpace(status); trimmed != "" {
		query.Set("status", trimmed)
	}
	if limit > 0 {
		query.Set("limit", strconv.Itoa(limit))
	}
	endpoint := c.APIURL + "/api/company-industry-proposals/review-queue"
	if encoded := query.Encode(); encoded != "" {
		endpoint += "?" + encoded
	}
	var response IndustryReviewQueueResponse
	if err := c.doJSON(ctx, http.MethodGet, endpoint, nil, &response); err != nil {
		return nil, err
	}
	if err := validateIndustryReviewResponse(response.Success, response.OK, "queue"); err != nil {
		return nil, err
	}
	return &response, nil
}

func (c *Client) GetIndustryReviewPacket(ctx context.Context, proposalID string) (*IndustryReviewPacket, error) {
	trimmed := strings.TrimSpace(proposalID)
	if trimmed == "" {
		return nil, fmt.Errorf("proposal ID is required")
	}
	endpoint := fmt.Sprintf(
		"%s/api/company-industry-proposals/%s/review-packet",
		c.APIURL,
		url.PathEscape(trimmed),
	)
	var response IndustryReviewPacket
	if err := c.doJSON(ctx, http.MethodGet, endpoint, nil, &response); err != nil {
		return nil, err
	}
	if err := validateIndustryReviewResponse(response.Success, response.OK, "packet"); err != nil {
		return nil, err
	}
	return &response, nil
}
