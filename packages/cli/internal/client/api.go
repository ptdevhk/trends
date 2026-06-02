package client

import (
	"context"
	"fmt"
	"net/http"
	"net/url"
	"strconv"
	"strings"
)

type ResumeItem struct {
	ResumeID          string                       `json:"resumeId"`
	PerUserID         string                       `json:"perUserId"`
	ProfileID         string                       `json:"profileId"`
	ExternalID        string                       `json:"externalId"`
	Name              string                       `json:"name"`
	JobIntention      string                       `json:"jobIntention"`
	Location          string                       `json:"location"`
	Experience        string                       `json:"experience"`
	Education         string                       `json:"education"`
	ExpectedSalary    string                       `json:"expectedSalary"`
	ProfileURL        string                       `json:"profileUrl"`
	Source            string                       `json:"source"`
	ActivityStatus    string                       `json:"activityStatus"`
	SelfIntro         string                       `json:"selfIntro"`
	WorkHistory       []ResumeWorkHistoryItem      `json:"workHistory"`
	ProjectExperience []ResumeWorkHistoryItem      `json:"projectExperience,omitempty"`
	ProfileEducation  []ResumeProfileEducationItem `json:"profileEducation,omitempty"`
	ExtractedAt       string                       `json:"extractedAt"`
}

type ResumeWorkHistoryItem struct {
	Raw         string `json:"raw"`
	CompanyName string `json:"companyName,omitempty"`
	JobTitle    string `json:"jobTitle,omitempty"`
	Description string `json:"description,omitempty"`
	StartDate   string `json:"startDate,omitempty"`
	EndDate     string `json:"endDate,omitempty"`
}

type ResumeProfileEducationItem struct {
	Institution   string `json:"institution,omitempty"`
	Qualification string `json:"qualification,omitempty"`
	FieldOfStudy  string `json:"fieldOfStudy,omitempty"`
	Description   string `json:"description,omitempty"`
	StartDate     string `json:"startDate,omitempty"`
	EndDate       string `json:"endDate,omitempty"`
}

type ResumeSample struct {
	Name      string `json:"name"`
	Filename  string `json:"filename"`
	UpdatedAt string `json:"updatedAt"`
	Size      int64  `json:"size"`
}

type ResumesSummary struct {
	Total    int      `json:"total"`
	Returned int      `json:"returned"`
	Query    string   `json:"query"`
	Source   string   `json:"source,omitempty"`
	Expanded []string `json:"expandedTo,omitempty"`
}

type ResumesResponse struct {
	Success bool           `json:"success"`
	Data    []ResumeItem   `json:"data"`
	Sample  *ResumeSample  `json:"sample,omitempty"`
	Summary ResumesSummary `json:"summary"`
}

type ResumeDetailResponse struct {
	Success bool          `json:"success"`
	Source  string        `json:"source"`
	Sample  *ResumeSample `json:"sample,omitempty"`
	Data    ResumeItem    `json:"data"`
}

type JobDescriptionFile struct {
	Name      string `json:"name"`
	Filename  string `json:"filename"`
	Title     string `json:"title"`
	Status    string `json:"status"`
	UpdatedAt string `json:"updatedAt"`
}

type JobDescriptionsResponse struct {
	Success bool                 `json:"success"`
	Items   []JobDescriptionFile `json:"items"`
}

type CreateJobDescriptionRequest struct {
	Name      string `json:"name"`
	Content   string `json:"content"`
	Overwrite bool   `json:"overwrite,omitempty"`
}

type CreateJobDescriptionResponse struct {
	Success bool               `json:"success"`
	Item    JobDescriptionFile `json:"item"`
	Content string             `json:"content"`
}

type InspectableSourceMetadata struct {
	Version              *int   `json:"version,omitempty"`
	UpdatedAt            string `json:"updatedAt,omitempty"`
	Description          string `json:"description,omitempty"`
	Locale               string `json:"locale,omitempty"`
	RequestedLocale      string `json:"requestedLocale,omitempty"`
	ResolvedSourceLocale string `json:"resolvedSourceLocale,omitempty"`
	FallbackToZhHans     *bool  `json:"fallbackToZhHans,omitempty"`
}

type InspectableSourceSummary struct {
	Key          string                     `json:"key"`
	Label        string                     `json:"label"`
	RelativePath string                     `json:"relativePath"`
	Type         string                     `json:"type"`
	Group        string                     `json:"group"`
	Audience     string                     `json:"audience"`
	ReadOnly     bool                       `json:"readOnly"`
	Metadata     *InspectableSourceMetadata `json:"metadata,omitempty"`
	ParseError   string                     `json:"parseError,omitempty"`
}

type InspectableSourceGroup struct {
	Key         string                     `json:"key"`
	Label       string                     `json:"label"`
	Description string                     `json:"description"`
	Audience    string                     `json:"audience"`
	Sources     []InspectableSourceSummary `json:"sources"`
}

type InspectableSourceDetail struct {
	InspectableSourceSummary
	RawSource     string `json:"rawSource"`
	ParsedPreview any    `json:"parsedPreview"`
}

type SystemNavItem struct {
	ID              string   `json:"id"`
	TitleKey        string   `json:"titleKey"`
	DefaultTitle    string   `json:"defaultTitle"`
	HrefSuffix      string   `json:"hrefSuffix"`
	MatchesSuffixes []string `json:"matchesSuffixes,omitempty"`
}

type SystemLabelDescriptor struct {
	Value        string `json:"value,omitempty"`
	Key          string `json:"key,omitempty"`
	LabelKey     string `json:"labelKey"`
	DefaultLabel string `json:"defaultLabel"`
}

type SystemCapabilityDescriptor struct {
	ID                  string   `json:"id"`
	Title               string   `json:"title"`
	Description         string   `json:"description"`
	Category            string   `json:"category"`
	Audience            string   `json:"audience"`
	RelatedSourceGroups []string `json:"relatedSourceGroups,omitempty"`
}

type SystemMetadataIdentity struct {
	AppName            string `json:"appName"`
	HomeTitle          string `json:"homeTitle"`
	SystemTitle        string `json:"systemTitle"`
	SettingsTitle      string `json:"settingsTitle"`
	AdminBadgeLabel    string `json:"adminBadgeLabel"`
	SettingsBadgeLabel string `json:"settingsBadgeLabel"`
	AppVersion         string `json:"appVersion"`
	APIVersion         string `json:"apiVersion"`
	WebVersion         string `json:"webVersion"`
}

type SystemMetadataResponse struct {
	Success  bool `json:"success"`
	Metadata struct {
		Identity   SystemMetadataIdentity `json:"identity"`
		Navigation struct {
			System         []SystemNavItem `json:"system"`
			Settings       []SystemNavItem `json:"settings"`
			SystemSettings []SystemNavItem `json:"systemSettings"`
			DebugPage      []SystemNavItem `json:"debugPage"`
		} `json:"navigation"`
		Labels struct {
			AIBreakdown        []SystemLabelDescriptor `json:"aiBreakdown"`
			IngestBrandSource  []SystemLabelDescriptor `json:"ingestBrandSource"`
			IngestBrandContext []SystemLabelDescriptor `json:"ingestBrandContext"`
			IngestBrandRole    []SystemLabelDescriptor `json:"ingestBrandRole"`
		} `json:"labels"`
		Prompt struct {
			KeywordVariantTitle string `json:"keywordVariantTitle"`
			KeywordVariantBody  string `json:"keywordVariantBody"`
		} `json:"prompt"`
		Capabilities []SystemCapabilityDescriptor `json:"capabilities"`
	} `json:"metadata"`
}

type SourceGroupsResponse struct {
	Success bool                     `json:"success"`
	Groups  []InspectableSourceGroup `json:"groups"`
}

type SourceDetailResponse struct {
	Success bool                    `json:"success"`
	Source  InspectableSourceDetail `json:"source"`
}

type ResumeExportEntry struct {
	ResumeID  string   `json:"resumeId"`
	RuleScore *float64 `json:"ruleScore,omitempty"`
}

type ResumeExportRequest struct {
	Format  string              `json:"format"`
	Source  string              `json:"source"`
	Sample  string              `json:"sample,omitempty"`
	Entries []ResumeExportEntry `json:"entries"`
}

type MatchQueryRequiredRole struct {
	Type     string   `json:"type"`
	Signals  []string `json:"signals"`
	VerifyIn string   `json:"verifyIn"`
	MinYears *int     `json:"minYears,omitempty"`
}

type MatchQueryKeywordGroup struct {
	Original string   `json:"original"`
	Variants []string `json:"variants"`
}

type MatchQueryMetadata struct {
	Source                string                   `json:"source,omitempty"`
	Persisted             bool                     `json:"persisted"`
	KeywordGroups         []MatchQueryKeywordGroup `json:"keywordGroups,omitempty"`
	ExpandedTo            []string                 `json:"expandedTo,omitempty"`
	SourceMapping         map[string]string        `json:"sourceMapping,omitempty"`
	InferredRequiredRoles []MatchQueryRequiredRole `json:"inferredRequiredRoles,omitempty"`
}

type ResumeMatchDebugProvenance struct {
	Term         string `json:"term"`
	Source       string `json:"source"`
	ExpandedFrom string `json:"expandedFrom,omitempty"`
}

type ResumeMatchDebugRoleSignal struct {
	Type                          string   `json:"type"`
	MatchedSignals                []string `json:"matchedSignals"`
	SignalCount                   int      `json:"signalCount"`
	Occurrences                   int      `json:"occurrences"`
	Years                         float64  `json:"years"`
	IndustryVerifiedYears         float64  `json:"industryVerifiedYears"`
	RoleRelevantYears             *float64 `json:"roleRelevantYears,omitempty"`
	IndustryVerifiedRelevantYears *float64 `json:"industryVerifiedRelevantYears,omitempty"`
	VerifyIn                      string   `json:"verifyIn"`
}

type ResumeMatchDebugBrandHit struct {
	Brand   string `json:"brand"`
	Role    string `json:"role"`
	Source  string `json:"source"`
	Context string `json:"context"`
}

type ResumeMatchDebug struct {
	PrimaryRuleScore *float64                     `json:"primaryRuleScore,omitempty"`
	Provenance       []ResumeMatchDebugProvenance `json:"provenance,omitempty"`
	RoleSignals      []ResumeMatchDebugRoleSignal `json:"roleSignals,omitempty"`
	CompanyHits      []string                     `json:"companyHits,omitempty"`
	BrandHits        []ResumeMatchDebugBrandHit   `json:"brandHits,omitempty"`
}

type MatchStats struct {
	Processed        int     `json:"processed"`
	Matched          int     `json:"matched"`
	AvgScore         float64 `json:"avgScore"`
	ProcessingTimeMS int     `json:"processingTimeMs,omitempty"`
	PendingAI        int     `json:"pendingAi,omitempty"`
}

type ResumeMatchResult struct {
	ResumeID         string            `json:"resumeId"`
	JobDescriptionID string            `json:"jobDescriptionId"`
	Score            int               `json:"score"`
	Recommendation   string            `json:"recommendation"`
	Highlights       []string          `json:"highlights"`
	Concerns         []string          `json:"concerns"`
	Summary          string            `json:"summary"`
	Breakdown        map[string]int    `json:"breakdown,omitempty"`
	ScoreSource      string            `json:"scoreSource,omitempty"`
	MatchedAt        string            `json:"matchedAt"`
	SessionID        string            `json:"sessionId,omitempty"`
	UserID           string            `json:"userId,omitempty"`
	Debug            *ResumeMatchDebug `json:"debug,omitempty"`
}

type ResumeMatchRequest struct {
	SessionID        string   `json:"sessionId,omitempty"`
	Sample           string   `json:"sample,omitempty"`
	Source           string   `json:"source,omitempty"`
	Persist          *bool    `json:"persist,omitempty"`
	JobDescriptionID string   `json:"jobDescriptionId,omitempty"`
	Keywords         []string `json:"keywords,omitempty"`
	Location         string   `json:"location,omitempty"`
	ResumeIDs        []string `json:"resumeIds,omitempty"`
	Limit            int      `json:"limit,omitempty"`
	TopN             int      `json:"topN,omitempty"`
	Mode             string   `json:"mode,omitempty"`
}

type ResumeMatchResponse struct {
	Success        bool                `json:"success"`
	Mode           string              `json:"mode,omitempty"`
	StreamPath     string              `json:"streamPath,omitempty"`
	PendingAICount int                 `json:"pendingAiCount,omitempty"`
	Query          *MatchQueryMetadata `json:"query,omitempty"`
	Results        []ResumeMatchResult `json:"results"`
	Stats          MatchStats          `json:"stats"`
}

func normalizeResumeSource(source string) string {
	normalized := strings.ToLower(strings.TrimSpace(source))
	if normalized == "convex" {
		return "convex"
	}
	return "sample"
}

type ResumeFilterParams struct {
	MinRoleYears int
	RoleType     string
	MinAge       int
	MaxAge       int
	Sources      []string
}

func (c *Client) ListResumes(ctx context.Context, limit int, query string, source string, filters ...ResumeFilterParams) (*ResumesResponse, error) {
	values := url.Values{}
	if limit > 0 {
		values.Set("limit", strconv.Itoa(limit))
	}
	if strings.TrimSpace(query) != "" {
		values.Set("q", query)
	}
	values.Set("source", normalizeResumeSource(source))

	if len(filters) > 0 {
		f := filters[0]
		if f.MinRoleYears > 0 {
			values.Set("minRoleYears", strconv.Itoa(f.MinRoleYears))
		}
		if strings.TrimSpace(f.RoleType) != "" {
			values.Set("roleFilterType", strings.TrimSpace(f.RoleType))
		}
		if f.MinAge > 0 {
			values.Set("minAge", strconv.Itoa(f.MinAge))
		}
		if f.MaxAge > 0 {
			values.Set("maxAge", strconv.Itoa(f.MaxAge))
		}
		if len(f.Sources) > 0 {
			values.Set("sources", strings.Join(f.Sources, ","))
		}
	}

	endpoint := fmt.Sprintf("%s/api/resumes", c.APIURL)
	if encoded := values.Encode(); encoded != "" {
		endpoint = fmt.Sprintf("%s?%s", endpoint, encoded)
	}

	var response ResumesResponse
	if err := c.doJSON(ctx, http.MethodGet, endpoint, nil, &response); err != nil {
		return nil, err
	}
	if !response.Success {
		return nil, fmt.Errorf("resume list request was not successful")
	}
	return &response, nil
}

func (c *Client) SearchResumes(ctx context.Context, query string, limit int, source string, filters ...ResumeFilterParams) (*ResumesResponse, error) {
	return c.ListResumes(ctx, limit, query, source, filters...)
}

func (c *Client) GetResumeDetail(ctx context.Context, resumeID string, sample string, source string) (*ResumeDetailResponse, error) {
	values := url.Values{}
	if strings.TrimSpace(sample) != "" {
		values.Set("sample", strings.TrimSpace(sample))
	}
	values.Set("source", normalizeResumeSource(source))

	endpoint := fmt.Sprintf("%s/api/resumes/%s", c.APIURL, url.PathEscape(strings.TrimSpace(resumeID)))
	if encoded := values.Encode(); encoded != "" {
		endpoint = fmt.Sprintf("%s?%s", endpoint, encoded)
	}

	var response ResumeDetailResponse
	if err := c.doJSON(ctx, http.MethodGet, endpoint, nil, &response); err != nil {
		return nil, err
	}
	if !response.Success {
		return nil, fmt.Errorf("resume detail request was not successful")
	}
	return &response, nil
}

func (c *Client) MatchResumes(ctx context.Context, request ResumeMatchRequest) (*ResumeMatchResponse, error) {
	if strings.TrimSpace(request.Source) == "" {
		request.Source = "sample"
	}
	request.Source = normalizeResumeSource(request.Source)
	if request.Persist == nil {
		persist := true
		request.Persist = &persist
	}
	endpoint := fmt.Sprintf("%s/api/resumes/match", c.APIURL)
	var response ResumeMatchResponse
	if err := c.doJSON(ctx, http.MethodPost, endpoint, request, &response); err != nil {
		return nil, err
	}
	if !response.Success {
		return nil, fmt.Errorf("resume match request was not successful")
	}
	return &response, nil
}

func (c *Client) ExportResumes(ctx context.Context, request ResumeExportRequest) ([]byte, string, error) {
	if request.Format == "" {
		request.Format = "csv"
	}
	endpoint := fmt.Sprintf("%s/api/resumes/export", c.APIURL)
	payload, headers, err := c.doBinary(ctx, http.MethodPost, endpoint, request)
	if err != nil {
		return nil, "", err
	}
	return payload, headers.Get("Content-Disposition"), nil
}

func (c *Client) ListJobDescriptions(ctx context.Context) (*JobDescriptionsResponse, error) {
	endpoint := fmt.Sprintf("%s/api/job-descriptions", c.APIURL)
	var response JobDescriptionsResponse
	if err := c.doJSON(ctx, http.MethodGet, endpoint, nil, &response); err != nil {
		return nil, err
	}
	if !response.Success {
		return nil, fmt.Errorf("job description list request was not successful")
	}
	return &response, nil
}

func (c *Client) CreateJobDescription(ctx context.Context, request CreateJobDescriptionRequest) (*CreateJobDescriptionResponse, error) {
	endpoint := fmt.Sprintf("%s/api/job-descriptions", c.APIURL)
	var response CreateJobDescriptionResponse
	if err := c.doJSON(ctx, http.MethodPost, endpoint, request, &response); err != nil {
		return nil, err
	}
	if !response.Success {
		return nil, fmt.Errorf("job description create request was not successful")
	}
	return &response, nil
}

func (c *Client) GetSystemMetadata(ctx context.Context) (*SystemMetadataResponse, error) {
	endpoint := fmt.Sprintf("%s/api/config/system-metadata", c.APIURL)
	var response SystemMetadataResponse
	if err := c.doJSON(ctx, http.MethodGet, endpoint, nil, &response); err != nil {
		return nil, err
	}
	if !response.Success {
		return nil, fmt.Errorf("system metadata request was not successful")
	}
	return &response, nil
}

func (c *Client) ListSourceGroups(ctx context.Context) (*SourceGroupsResponse, error) {
	endpoint := fmt.Sprintf("%s/api/config/source-groups", c.APIURL)
	var response SourceGroupsResponse
	if err := c.doJSON(ctx, http.MethodGet, endpoint, nil, &response); err != nil {
		return nil, err
	}
	if !response.Success {
		return nil, fmt.Errorf("source groups request was not successful")
	}
	return &response, nil
}

func (c *Client) GetSourceDetail(ctx context.Context, key string) (*SourceDetailResponse, error) {
	endpoint := fmt.Sprintf("%s/api/config/sources/%s", c.APIURL, url.PathEscape(strings.TrimSpace(key)))
	var response SourceDetailResponse
	if err := c.doJSON(ctx, http.MethodGet, endpoint, nil, &response); err != nil {
		return nil, err
	}
	if !response.Success {
		return nil, fmt.Errorf("source detail request was not successful")
	}
	return &response, nil
}

type HardResetReingestRequest struct {
	DryRun bool `json:"dryRun,omitempty"`
}

type HardResetReingestResponse struct {
	Success    bool   `json:"success"`
	DryRun     bool   `json:"dryRun,omitempty"`
	Cleared    int    `json:"cleared,omitempty"`
	WouldClear int    `json:"wouldClear,omitempty"`
	Scheduled  int    `json:"scheduled,omitempty"`
	Batches    int    `json:"batches,omitempty"`
	Phase      string `json:"phase,omitempty"`
	Error      string `json:"error,omitempty"`
}

func (c *Client) HardResetReingest(ctx context.Context, request HardResetReingestRequest) (*HardResetReingestResponse, error) {
	endpoint := fmt.Sprintf("%s/api/resumes/hard-reset-reingest", c.APIURL)
	var response HardResetReingestResponse
	if err := c.doJSON(ctx, http.MethodPost, endpoint, request, &response); err != nil {
		return nil, err
	}
	if !response.Success {
		return nil, fmt.Errorf("hard reset reingest request was not successful")
	}
	return &response, nil
}

type ClearAnalysesAPIRequest struct {
	JobDescriptionID string   `json:"jobDescriptionId,omitempty"`
	ResumeIDs        []string `json:"resumeIds,omitempty"`
	BatchSize        int      `json:"batchSize,omitempty"`
	DryRun           bool     `json:"dryRun,omitempty"`
}

type ClearAnalysesAPIResponse struct {
	Success         bool     `json:"success"`
	DryRun          bool     `json:"dryRun,omitempty"`
	Cleared         int      `json:"cleared"`
	WouldClear      int      `json:"wouldClear,omitempty"`
	Batches         int      `json:"batches,omitempty"`
	Targeted        bool     `json:"targeted"`
	JobDescriptionID string  `json:"jobDescriptionId,omitempty"`
	ResumeIDs       []string `json:"resumeIds,omitempty"`
}

func (c *Client) ClearAnalysesViaAPI(ctx context.Context, request ClearAnalysesAPIRequest) (*ClearAnalysesAPIResponse, error) {
	endpoint := fmt.Sprintf("%s/api/resumes/clear-analyses", c.APIURL)
	var response ClearAnalysesAPIResponse
	if err := c.doJSON(ctx, http.MethodPost, endpoint, request, &response); err != nil {
		return nil, err
	}
	if !response.Success {
		return nil, fmt.Errorf("clear analyses request was not successful")
	}
	return &response, nil
}

type ResetDatabaseRequest struct {
	DryRun bool `json:"dryRun,omitempty"`
}

type ResetDatabaseResponse struct {
	Success    bool              `json:"success"`
	DryRun     bool              `json:"dryRun,omitempty"`
	Count      int               `json:"count,omitempty"`
	WouldDelete map[string]int   `json:"wouldDelete,omitempty"`
	Partial    bool              `json:"partial,omitempty"`
	Deleted    map[string]int    `json:"deleted,omitempty"`
}

func (c *Client) ResetDatabase(ctx context.Context, request ResetDatabaseRequest) (*ResetDatabaseResponse, error) {
	endpoint := fmt.Sprintf("%s/api/resumes/reset-database", c.APIURL)
	var response ResetDatabaseResponse
	if err := c.doJSON(ctx, http.MethodPost, endpoint, request, &response); err != nil {
		return nil, err
	}
	if !response.Success {
		return nil, fmt.Errorf("reset database request was not successful")
	}
	return &response, nil
}

type ArchiveResumesRequest struct {
	ResumeIDs []string `json:"resumeIds"`
	Action    string   `json:"action"`
}

type ArchiveResumesResponse struct {
	Success        bool     `json:"success"`
	Requested      int      `json:"requested"`
	Archived       int      `json:"archived,omitempty"`
	AlreadyArchived int     `json:"alreadyArchived,omitempty"`
	Unarchived     int      `json:"unarchived,omitempty"`
	NotArchived    int      `json:"notArchived,omitempty"`
	MissingIDs     []string `json:"missingResumeIds,omitempty"`
}

func (c *Client) ArchiveResumes(ctx context.Context, resumeIDs []string) (*ArchiveResumesResponse, error) {
	endpoint := fmt.Sprintf("%s/api/resumes/archive", c.APIURL)
	var response ArchiveResumesResponse
	if err := c.doJSON(ctx, http.MethodPost, endpoint, ArchiveResumesRequest{ResumeIDs: resumeIDs, Action: "archive"}, &response); err != nil {
		return nil, err
	}
	return &response, nil
}

func (c *Client) UnarchiveResumes(ctx context.Context, resumeIDs []string) (*ArchiveResumesResponse, error) {
	endpoint := fmt.Sprintf("%s/api/resumes/archive", c.APIURL)
	var response ArchiveResumesResponse
	if err := c.doJSON(ctx, http.MethodPost, endpoint, ArchiveResumesRequest{ResumeIDs: resumeIDs, Action: "unarchive"}, &response); err != nil {
		return nil, err
	}
	return &response, nil
}

type AnalyzeRequest struct {
	Query            string   `json:"query,omitempty"`
	JobDescriptionID string   `json:"jobDescriptionId,omitempty"`
	Location         string   `json:"location,omitempty"`
	MinExperience    int      `json:"minExperience,omitempty"`
	MaxExperience    int      `json:"maxExperience,omitempty"`
	Education        []string `json:"education,omitempty"`
	Skills           []string `json:"skills,omitempty"`
	RequiredKeywords []string `json:"requiredKeywords,omitempty"`
	Locations       []string `json:"locations,omitempty"`
	MinSalary        int      `json:"minSalary,omitempty"`
	MaxSalary        int      `json:"maxSalary,omitempty"`
	Limit            int      `json:"limit,omitempty"`
	DryRun           bool     `json:"dryRun,omitempty"`
	RoleFilterType   string   `json:"roleFilterType,omitempty"`
	MinRoleYears     int      `json:"minRoleYears,omitempty"`
	Market           string   `json:"market,omitempty"`
}

type AnalyzeConfig struct {
	JobDescriptionID string   `json:"jobDescriptionId,omitempty"`
	Keywords         []string `json:"keywords,omitempty"`
	Location         string   `json:"location,omitempty"`
}

type AnalyzeResponse struct {
	Success      bool          `json:"success"`
	DryRun       bool          `json:"dryRun,omitempty"`
	TaskID       string        `json:"taskId,omitempty"`
	ResumeCount  int           `json:"resumeCount"`
	SkippedCount int           `json:"skippedCount,omitempty"`
	Config       *AnalyzeConfig `json:"config,omitempty"`
}

func (c *Client) AnalyzeResumes(ctx context.Context, request AnalyzeRequest) (*AnalyzeResponse, error) {
	endpoint := fmt.Sprintf("%s/api/resumes/analyze", c.APIURL)
	var response AnalyzeResponse
	if err := c.doJSON(ctx, http.MethodPost, endpoint, request, &response); err != nil {
		return nil, err
	}
	if !response.Success {
		return nil, fmt.Errorf("analyze request was not successful")
	}
	return &response, nil
}

type AnalysisTaskProgress struct {
	Current int `json:"current,omitempty"`
	Total   int `json:"total,omitempty"`
	Skipped int `json:"skipped,omitempty"`
}

type AnalysisTaskResults struct {
	Analyzed      int     `json:"analyzed,omitempty"`
	Failed       int     `json:"failed,omitempty"`
	AvgScore      float64 `json:"avgScore,omitempty"`
	HighScoreCount int    `json:"highScoreCount,omitempty"`
}

type AnalysisTaskConfig struct {
	JobDescriptionID    string   `json:"jobDescriptionId,omitempty"`
	JobDescriptionTitle string   `json:"jobDescriptionTitle,omitempty"`
	Keywords            []string `json:"keywords,omitempty"`
	Location            string   `json:"location,omitempty"`
	PromptVersion       int      `json:"promptVersion,omitempty"`
	ResumeCount         int      `json:"resumeCount,omitempty"`
}

type AnalysisTask struct {
	ID           string               `json:"_id"`
	Status       string               `json:"status"`
	CreatedAt    float64              `json:"_creationTime"`
	Config       *AnalysisTaskConfig  `json:"config,omitempty"`
	Progress     *AnalysisTaskProgress `json:"progress,omitempty"`
	Results      *AnalysisTaskResults  `json:"results,omitempty"`
	LastStatus   string               `json:"lastStatus,omitempty"`
	Error        string               `json:"error,omitempty"`
}

type AnalysisTasksResponse struct {
	Success bool           `json:"success"`
	Tasks   []AnalysisTask `json:"tasks"`
}

func (c *Client) ListAnalysisTasks(ctx context.Context) (*AnalysisTasksResponse, error) {
	endpoint := fmt.Sprintf("%s/api/resumes/analysis-tasks", c.APIURL)
	var response AnalysisTasksResponse
	if err := c.doJSON(ctx, http.MethodGet, endpoint, nil, &response); err != nil {
		return nil, err
	}
	if !response.Success {
		return nil, fmt.Errorf("list analysis tasks request was not successful")
	}
	return &response, nil
}
