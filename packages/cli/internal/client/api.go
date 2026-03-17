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
	ResumeID       string `json:"resumeId"`
	PerUserID      string `json:"perUserId"`
	ProfileID      string `json:"profileId"`
	ExternalID     string `json:"externalId"`
	Name           string `json:"name"`
	JobIntention   string `json:"jobIntention"`
	Location       string `json:"location"`
	Experience     string `json:"experience"`
	Education      string `json:"education"`
	ExpectedSalary string `json:"expectedSalary"`
}

type ResumeSample struct {
	Name      string `json:"name"`
	Filename  string `json:"filename"`
	UpdatedAt string `json:"updatedAt"`
	Size      int64  `json:"size"`
}

type ResumesSummary struct {
	Total    int    `json:"total"`
	Returned int    `json:"returned"`
	Query    string `json:"query"`
}

type ResumesResponse struct {
	Success bool           `json:"success"`
	Data    []ResumeItem   `json:"data"`
	Sample  *ResumeSample  `json:"sample,omitempty"`
	Summary ResumesSummary `json:"summary"`
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

func (c *Client) ListResumes(ctx context.Context, limit int, query string) (*ResumesResponse, error) {
	values := url.Values{}
	if limit > 0 {
		values.Set("limit", strconv.Itoa(limit))
	}
	if strings.TrimSpace(query) != "" {
		values.Set("q", query)
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

func (c *Client) SearchResumes(ctx context.Context, query string, limit int) (*ResumesResponse, error) {
	return c.ListResumes(ctx, limit, query)
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
