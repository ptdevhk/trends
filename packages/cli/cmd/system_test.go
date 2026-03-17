package cmd

import (
	"bytes"
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/ptdevhk/trends/packages/cli/internal/client"
	"github.com/spf13/viper"
)

func TestSystemClientEndpoints(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch r.URL.Path {
		case "/api/config/system-metadata":
			_ = json.NewEncoder(w).Encode(map[string]any{
				"success": true,
				"metadata": map[string]any{
					"identity": map[string]any{
						"appName":            "Trends",
						"homeTitle":          "Trends",
						"systemTitle":        "System Admin",
						"settingsTitle":      "Workspace Settings",
						"adminBadgeLabel":    "ADMIN",
						"settingsBadgeLabel": "SETTINGS",
						"appVersion":         "1.0.0",
						"apiVersion":         "1.1.0",
						"webVersion":         "1.2.0",
					},
					"navigation": map[string]any{
						"system":         []map[string]any{{"id": "home", "titleKey": "home", "defaultTitle": "Home", "hrefSuffix": "/system", "matchesSuffixes": []string{"/system"}}},
						"settings":       []map[string]any{{"id": "blocks", "titleKey": "blocks", "defaultTitle": "Blocks", "hrefSuffix": "/settings/blocks", "matchesSuffixes": []string{"/settings/blocks"}}},
						"systemSettings": []map[string]any{{"id": "overview", "titleKey": "overview", "defaultTitle": "Overview", "hrefSuffix": "/system/settings", "matchesSuffixes": []string{"/system/settings"}}},
						"debugPage":      []map[string]any{{"id": "all", "titleKey": "all", "defaultTitle": "All", "hrefSuffix": "", "matchesSuffixes": []string{""}}},
					},
					"labels": map[string]any{
						"aiBreakdown":        []map[string]any{{"key": "skills", "labelKey": "skills", "defaultLabel": "Skills", "aliases": []string{"skills"}}},
						"ingestBrandSource":  []map[string]any{{"value": "manual", "labelKey": "manual", "defaultLabel": "Manual"}},
						"ingestBrandContext": []map[string]any{{"value": "resume", "labelKey": "resume", "defaultLabel": "Resume"}},
						"ingestBrandRole":    []map[string]any{{"value": "operator", "labelKey": "operator", "defaultLabel": "Operator"}},
					},
					"prompt": map[string]any{
						"keywordVariantTitle": "Keyword Variant",
						"keywordVariantBody":  "Body",
					},
					"capabilities": []map[string]any{{"id": "cli-system-inspect", "title": "CLI inspect", "description": "Inspect metadata", "category": "cli", "audience": "developer"}},
				},
			})
		case "/api/config/source-groups":
			_ = json.NewEncoder(w).Encode(map[string]any{
				"success": true,
				"groups": []map[string]any{{
					"key":         "prompt",
					"label":       "Prompt Sources",
					"description": "Prompt files",
					"audience":    "developer",
					"sources": []map[string]any{{
						"key":          "resume-ai-prompts-active",
						"label":        "Resume AI prompts (active locale)",
						"relativePath": "config/resume/ai-prompts.md",
						"type":         "markdown",
						"group":        "prompt",
						"audience":     "developer",
						"readOnly":     true,
					}},
				}},
			})
		case "/api/config/sources/resume-ai-prompts-active":
			_ = json.NewEncoder(w).Encode(map[string]any{
				"success": true,
				"source": map[string]any{
					"key":           "resume-ai-prompts-active",
					"label":         "Resume AI prompts (active locale)",
					"relativePath":  "config/resume/ai-prompts.md",
					"type":          "markdown",
					"group":         "prompt",
					"audience":      "developer",
					"readOnly":      true,
					"rawSource":     "## Prompt",
					"parsedPreview": map[string]any{"sections": 1},
					"metadata":      map[string]any{"requestedLocale": "en"},
				},
			})
		default:
			t.Fatalf("unexpected path: %s", r.URL.Path)
		}
	}))
	defer server.Close()

	apiClient := client.New(server.URL, server.URL, "hr")
	apiClient.HTTP = server.Client()

	metadata, err := apiClient.GetSystemMetadata(context.Background())
	if err != nil {
		t.Fatalf("GetSystemMetadata returned error: %v", err)
	}
	if metadata.Metadata.Identity.AppName != "Trends" {
		t.Fatalf("unexpected app name: %+v", metadata.Metadata.Identity)
	}

	groups, err := apiClient.ListSourceGroups(context.Background())
	if err != nil {
		t.Fatalf("ListSourceGroups returned error: %v", err)
	}
	if len(groups.Groups) != 1 || groups.Groups[0].Key != "prompt" {
		t.Fatalf("unexpected groups: %+v", groups.Groups)
	}

	detail, err := apiClient.GetSourceDetail(context.Background(), "resume-ai-prompts-active")
	if err != nil {
		t.Fatalf("GetSourceDetail returned error: %v", err)
	}
	if detail.Source.Group != "prompt" || detail.Source.RawSource == "" {
		t.Fatalf("unexpected source detail: %+v", detail.Source)
	}
}

func TestSystemMetadataCommandWritesTable(t *testing.T) {
	originalClientFactory := apiClientFactory
	apiClientFactory = func() *client.Client {
		return &client.Client{}
	}
	defer func() {
		apiClientFactory = originalClientFactory
	}()

	originalGetSystemMetadata := getSystemMetadata
	getSystemMetadata = func(ctx context.Context, apiClient *client.Client) (*client.SystemMetadataResponse, error) {
		return &client.SystemMetadataResponse{
			Success: true,
		Metadata: struct {
			Identity   client.SystemMetadataIdentity `json:"identity"`
			Navigation struct {
				System         []client.SystemNavItem `json:"system"`
				Settings       []client.SystemNavItem `json:"settings"`
				SystemSettings []client.SystemNavItem `json:"systemSettings"`
				DebugPage      []client.SystemNavItem `json:"debugPage"`
			} `json:"navigation"`
				Labels struct {
					AIBreakdown        []client.SystemLabelDescriptor `json:"aiBreakdown"`
					IngestBrandSource  []client.SystemLabelDescriptor `json:"ingestBrandSource"`
					IngestBrandContext []client.SystemLabelDescriptor `json:"ingestBrandContext"`
					IngestBrandRole    []client.SystemLabelDescriptor `json:"ingestBrandRole"`
				} `json:"labels"`
				Prompt struct {
					KeywordVariantTitle string `json:"keywordVariantTitle"`
					KeywordVariantBody  string `json:"keywordVariantBody"`
				} `json:"prompt"`
				Capabilities []client.SystemCapabilityDescriptor `json:"capabilities"`
			}{
				Identity: client.SystemMetadataIdentity{AppName: "Trends", SystemTitle: "System Admin", SettingsTitle: "Workspace Settings", AppVersion: "1.0.0", APIVersion: "1.1.0", WebVersion: "1.2.0"},
				Navigation: struct {
					System         []client.SystemNavItem `json:"system"`
					Settings       []client.SystemNavItem `json:"settings"`
					SystemSettings []client.SystemNavItem `json:"systemSettings"`
					DebugPage      []client.SystemNavItem `json:"debugPage"`
				}{
					System:         []client.SystemNavItem{{ID: "home"}},
					Settings:       []client.SystemNavItem{{ID: "blocks"}},
					SystemSettings: []client.SystemNavItem{{ID: "overview"}},
					DebugPage:      []client.SystemNavItem{{ID: "all"}},
				},
				Capabilities: []client.SystemCapabilityDescriptor{{ID: "cli-system-inspect"}},
			},
		}, nil
	}
	defer func() {
		getSystemMetadata = originalGetSystemMetadata
	}()

	originalOutput := viper.GetString("output")
	viper.Set("output", "table")
	defer viper.Set("output", originalOutput)

	cmd := newSystemMetadataCmd()
	var output bytes.Buffer
	cmd.SetOut(&output)
	cmd.SetErr(&output)

	if err := cmd.RunE(cmd, nil); err != nil {
		t.Fatalf("metadata command failed: %v", err)
	}
	text := output.String()
	if !strings.Contains(text, "cli-system-inspect") || !strings.Contains(text, "Trends") || !strings.Contains(text, "system_settings_nav") || !strings.Contains(text, "dev") {
		t.Fatalf("unexpected command output: %s", text)
	}
}
