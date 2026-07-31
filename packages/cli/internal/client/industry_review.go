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
	RiskDecision                 IndustryReviewRiskDecision     `json:"riskDecision"`
	EvidenceSummaryDraft         string                         `json:"evidenceSummaryDraft"`
	DecisionReasonDraft          string                         `json:"decisionReasonDraft"`
	RequiresHumanReview          bool                           `json:"requiresHumanReview"`
}

type IndustryReviewRiskDecision struct {
	RequiresAcknowledgement    bool     `json:"requiresAcknowledgement"`
	NonOverridableRiskFlags    []string `json:"nonOverridableRiskFlags"`
	CanApproveWithRiskOverride bool     `json:"canApproveWithRiskOverride"`
}

type IndustryReviewAttestation struct {
	SchemaVersion           string   `json:"schemaVersion"`
	InputFingerprint        string   `json:"inputFingerprint"`
	DecisionMode            string   `json:"decisionMode"`
	AcknowledgedRiskFlags   []string `json:"acknowledgedRiskFlags"`
	CNCEvidenceAcknowledged bool     `json:"cncEvidenceAcknowledged"`
	AcknowledgementReason   string   `json:"acknowledgementReason"`
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
	Latest     *IndustryReviewMaintenanceRun `json:"latest"`
	LastFailed *IndustryReviewMaintenanceRun `json:"lastFailed"`
}

type IndustryReviewMaintenanceRun struct {
	RunID           string                          `json:"runId"`
	Status          string                          `json:"status,omitempty"`
	TriggerSource   string                          `json:"triggerSource,omitempty"`
	TriggerContext  string                          `json:"triggerContext,omitempty"`
	OperatorSummary string                          `json:"operatorSummary,omitempty"`
	FailureMessage  string                          `json:"failureMessage,omitempty"`
	StartedAt       int64                           `json:"startedAt,omitempty"`
	FinishedAt      int64                           `json:"finishedAt,omitempty"`
	Counts          IndustryReviewMaintenanceCounts `json:"counts"`
}

type IndustryReviewMaintenanceCounts struct {
	ProposalsResearched int `json:"proposalsResearched"`
	ReadyCreated        int `json:"readyCreated"`
	SourcesDemoted      int `json:"sourcesDemoted"`
	FreshnessChecked    int `json:"freshnessChecked"`
	FreshnessRefreshed  int `json:"freshnessRefreshed"`
	Errors              int `json:"errors"`
}

type IndustryReviewProfile struct {
	ID                 string `json:"_id"`
	CompanyKey         string `json:"companyKey"`
	IndustryClass      string `json:"industryClass"`
	VerificationLevel  string `json:"verificationLevel"`
	OfficialDomain     string `json:"officialDomain,omitempty"`
	EvidenceSource     string `json:"evidenceSource"`
	Summary            string `json:"summary,omitempty"`
	SourceURL          string `json:"sourceUrl,omitempty"`
	SourceDomain       string `json:"sourceDomain,omitempty"`
	SourceType         string `json:"sourceType,omitempty"`
	MSICCode           string `json:"msicCode,omitempty"`
	MSICDescription    string `json:"msicDescription,omitempty"`
	FetchedAt          int64  `json:"fetchedAt,omitempty"`
	CurrentRevisionID  string `json:"currentRevisionId,omitempty"`
	ReviewedAt         int64  `json:"reviewedAt,omitempty"`
	ReviewedBy         string `json:"reviewedBy,omitempty"`
	SourceCount        int    `json:"sourceCount,omitempty"`
	FreshnessState     string `json:"freshnessState,omitempty"`
	NextReviewAt       int64  `json:"nextReviewAt,omitempty"`
	CatalogVersion     int    `json:"catalogVersion,omitempty"`
	CompatibilityState string `json:"compatibilityState,omitempty"`
	UpdatedAt          int64  `json:"updatedAt"`
	UpdatedBy          string `json:"updatedBy,omitempty"`
}

type IndustryReviewRevision struct {
	ID                   string                     `json:"_id"`
	RevisionID           string                     `json:"revisionId"`
	CompanyKey           string                     `json:"companyKey"`
	IndustryClass        string                     `json:"industryClass"`
	VerificationLevel    string                     `json:"verificationLevel"`
	ApprovedSourceIDs    []string                   `json:"approvedSourceIds"`
	EvidenceSummary      string                     `json:"evidenceSummary"`
	ReviewedBy           string                     `json:"reviewedBy"`
	ReviewedAt           int64                      `json:"reviewedAt"`
	DecisionReason       string                     `json:"decisionReason"`
	TaxonomyVersion      string                     `json:"taxonomyVersion"`
	RuleVersion          string                     `json:"ruleVersion,omitempty"`
	ReviewAttestation    *IndustryReviewAttestation `json:"reviewAttestation,omitempty"`
	SupersedesRevisionID string                     `json:"supersedesRevisionId,omitempty"`
	ProposalID           string                     `json:"proposalId,omitempty"`
	CreatedAt            int64                      `json:"createdAt"`
}

type IndustryReviewContext struct {
	Profile   *IndustryReviewProfile   `json:"profile"`
	Revisions []IndustryReviewRevision `json:"revisions"`
}

type IndustryReviewRecomputeFailure struct {
	ResumeID   string `json:"resumeId,omitempty"`
	Stage      string `json:"stage"`
	Message    string `json:"message"`
	OccurredAt int64  `json:"occurredAt"`
}

type IndustryReviewRecomputeRun struct {
	RunID                  string                           `json:"runId"`
	WorkspaceSlug          string                           `json:"workspaceSlug"`
	CompanyKey             string                           `json:"companyKey"`
	TargetRevisionID       string                           `json:"targetRevisionId"`
	ProposalID             string                           `json:"proposalId,omitempty"`
	RequestedBy            string                           `json:"requestedBy,omitempty"`
	Status                 string                           `json:"status"`
	Attempt                int                              `json:"attempt"`
	Cursor                 string                           `json:"cursor,omitempty"`
	SourceDone             bool                             `json:"sourceDone"`
	PageCount              int                              `json:"pageCount"`
	AffectedCount          int                              `json:"affectedCount"`
	AlreadyCurrentCount    int                              `json:"alreadyCurrentCount"`
	ScheduledCount         int                              `json:"scheduledCount"`
	ReadyCount             int                              `json:"readyCount"`
	FailureCount           int                              `json:"failureCount"`
	BatchCount             int                              `json:"batchCount"`
	Failures               []IndustryReviewRecomputeFailure `json:"failures"`
	LastError              string                           `json:"lastError,omitempty"`
	SupersededByRevisionID string                           `json:"supersededByRevisionId,omitempty"`
	CreatedAt              int64                            `json:"createdAt"`
	StartedAt              int64                            `json:"startedAt,omitempty"`
	CompletedAt            int64                            `json:"completedAt,omitempty"`
	UpdatedAt              int64                            `json:"updatedAt"`
	OperatorSummary        string                           `json:"operatorSummary"`
}

type IndustryReviewQueueItem struct {
	Proposal         IndustryReviewProposal       `json:"proposal"`
	Recommendation   IndustryReviewRecommendation `json:"recommendation"`
	InputFingerprint string                       `json:"inputFingerprint"`
	SourceCount      int                          `json:"sourceCount"`
}

type IndustryReviewQueueResponse struct {
	Success       bool                             `json:"success"`
	OK            bool                             `json:"ok"`
	SchemaVersion string                           `json:"schemaVersion"`
	Items         []IndustryReviewQueueItem        `json:"items"`
	Maintenance   IndustryReviewMaintenanceContext `json:"maintenance"`
	NextCursor    string                           `json:"nextCursor,omitempty"`
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
	ReviewContext  IndustryReviewContext            `json:"reviewContext"`
	RecomputeRuns  []IndustryReviewRecomputeRun     `json:"recomputeRuns"`
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
	return c.ListIndustryReviewQueuePage(ctx, status, limit, "", "", "", "")
}

func (c *Client) ListIndustryReviewQueuePage(
	ctx context.Context,
	status string,
	limit int,
	cursor string,
	riskFlag string,
	confidenceBand string,
	recommendedAction string,
) (*IndustryReviewQueueResponse, error) {
	query := url.Values{}
	if trimmed := strings.TrimSpace(status); trimmed != "" {
		query.Set("status", trimmed)
	}
	if limit > 0 {
		query.Set("limit", strconv.Itoa(limit))
	}
	if trimmed := strings.TrimSpace(cursor); trimmed != "" {
		query.Set("cursor", trimmed)
	}
	if trimmed := strings.TrimSpace(riskFlag); trimmed != "" {
		query.Set("riskFlag", trimmed)
	}
	if trimmed := strings.TrimSpace(confidenceBand); trimmed != "" {
		query.Set("confidenceBand", trimmed)
	}
	if trimmed := strings.TrimSpace(recommendedAction); trimmed != "" {
		query.Set("recommendedAction", trimmed)
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

func (c *Client) GetIndustryReviewRecommendation(ctx context.Context, proposalID string) (*IndustryReviewRecommendationEnvelope, error) {
	trimmed := strings.TrimSpace(proposalID)
	if trimmed == "" {
		return nil, fmt.Errorf("proposal ID is required")
	}
	endpoint := fmt.Sprintf(
		"%s/api/company-industry-proposals/%s/recommendation",
		c.APIURL,
		url.PathEscape(trimmed),
	)
	var response IndustryReviewRecommendationEnvelope
	if err := c.doJSON(ctx, http.MethodGet, endpoint, nil, &response); err != nil {
		return nil, err
	}
	if err := validateIndustryReviewResponse(response.Success, response.OK, "recommendation"); err != nil {
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
