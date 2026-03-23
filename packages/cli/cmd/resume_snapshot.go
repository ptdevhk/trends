package cmd

import (
	"context"
	"encoding/json"
	"fmt"
	"path/filepath"
	"strconv"
	"strings"

	"github.com/spf13/cobra"
)

type resumeSnapshotRequest struct {
	APIURL      string
	Workspace   string
	Count       int
	MaxPages    int
	OutDir      string
	Sources     []string
	Job5156URL  string
	SeekURL     string
	ManualFile  string
	CDPEndpoint string
}

type resumeSnapshotManualImportSummary struct {
	UploadedFiles   *int `json:"uploadedFiles,omitempty"`
	DiscoveredFiles *int `json:"discoveredFiles,omitempty"`
	ParsedResumes   *int `json:"parsedResumes,omitempty"`
	Imported        *int `json:"imported,omitempty"`
	Inserted        *int `json:"inserted,omitempty"`
	Updated         *int `json:"updated,omitempty"`
	Unchanged       *int `json:"unchanged,omitempty"`
	Deduped         *int `json:"deduped,omitempty"`
	Skipped         *int `json:"skipped,omitempty"`
	Failed          *int `json:"failed,omitempty"`
}

type resumeSnapshotSourceResult struct {
	Alias               string                             `json:"alias"`
	SourceHost          string                             `json:"sourceHost"`
	File                string                             `json:"file"`
	Count               int                                `json:"count"`
	LaunchURL           string                             `json:"launchUrl,omitempty"`
	ManualFile          string                             `json:"manualFile,omitempty"`
	ResetCount          int                                `json:"resetCount"`
	ResetPartial        bool                               `json:"resetPartial"`
	ObservedCount       int                                `json:"observedCount"`
	ManualImportSummary *resumeSnapshotManualImportSummary `json:"manualImportSummary,omitempty"`
}

type resumeSnapshotResult struct {
	Success        bool                         `json:"success"`
	APIURL         string                       `json:"apiUrl"`
	Workspace      string                       `json:"workspace"`
	RepoRoot       string                       `json:"repoRoot"`
	RunStamp       string                       `json:"runStamp"`
	OutputDir      string                       `json:"outputDir"`
	CountPerSource int                          `json:"countPerSource"`
	Sources        []resumeSnapshotSourceResult `json:"sources"`
}

var runResumeSnapshot = func(ctx context.Context, request resumeSnapshotRequest) (*resumeSnapshotResult, error) {
	projectRoot, err := findProjectRoot()
	if err != nil {
		return nil, err
	}

	scriptPath := filepath.Join(projectRoot, "scripts", "resume", "snapshot-source-backups.ts")
	stdout, stderr, err := runBunScript(
		ctx,
		projectRoot,
		scriptPath,
		buildResumeSnapshotScriptArgs(request),
		nil,
	)
	if err != nil {
		return nil, fmt.Errorf("run resume snapshot: %w\n%s", err, commandErrorOutput(stdout, stderr))
	}

	var response resumeSnapshotResult
	if err := json.Unmarshal([]byte(stdout), &response); err != nil {
		return nil, fmt.Errorf("decode resume snapshot response: %w", err)
	}
	if !response.Success {
		return nil, fmt.Errorf("resume snapshot did not succeed")
	}
	return &response, nil
}

func buildResumeSnapshotScriptArgs(request resumeSnapshotRequest) []string {
	args := []string{
		"--api-url", normalizeBaseURL(request.APIURL),
		"--workspace", normalizeWorkspace(request.Workspace),
	}

	if request.Count > 0 {
		args = append(args, "--count", strconv.Itoa(request.Count))
	}
	if request.MaxPages > 0 {
		args = append(args, "--max-pages", strconv.Itoa(request.MaxPages))
	}

	for _, source := range normalizeStringSlice(request.Sources) {
		args = append(args, "--source", source)
	}

	if value := strings.TrimSpace(request.OutDir); value != "" {
		args = append(args, "--out-dir", value)
	}
	if value := strings.TrimSpace(request.Job5156URL); value != "" {
		args = append(args, "--job5156-url", value)
	}
	if value := strings.TrimSpace(request.SeekURL); value != "" {
		args = append(args, "--seek-url", value)
	}
	if value := strings.TrimSpace(request.ManualFile); value != "" {
		args = append(args, "--manual-file", value)
	}
	if value := strings.TrimSpace(request.CDPEndpoint); value != "" {
		args = append(args, "--cdp-endpoint", value)
	}

	return args
}

func buildResumeSnapshotOutput(result *resumeSnapshotResult) resumeSummaryOutput {
	headers := []string{
		"source",
		"source_host",
		"count",
		"observed",
		"file",
		"launch_url",
		"manual_file",
		"manual_parsed",
		"manual_imported",
		"manual_skipped",
		"manual_failed",
	}
	rows := make([][]string, 0, len(result.Sources))

	for _, source := range result.Sources {
		manualParsed := ""
		manualImported := ""
		manualSkipped := ""
		manualFailed := ""
		if source.ManualImportSummary != nil {
			manualParsed = intPointerString(source.ManualImportSummary.ParsedResumes)
			manualImported = intPointerString(source.ManualImportSummary.Imported)
			manualSkipped = intPointerString(source.ManualImportSummary.Skipped)
			manualFailed = intPointerString(source.ManualImportSummary.Failed)
		}

		rows = append(rows, []string{
			source.Alias,
			source.SourceHost,
			strconv.Itoa(source.Count),
			strconv.Itoa(source.ObservedCount),
			source.File,
			source.LaunchURL,
			source.ManualFile,
			manualParsed,
			manualImported,
			manualSkipped,
			manualFailed,
		})
	}

	return resumeSummaryOutput{
		Headers: headers,
		Rows:    rows,
	}
}

func newResumeSnapshotCmd() *cobra.Command {
	var (
		count       int
		maxPages    int
		outDir      string
		sources     []string
		job5156URL  string
		seekURL     string
		manualFile  string
		cdpEndpoint string
	)

	cmd := &cobra.Command{
		Use:   "snapshot",
		Short: "Capture restore-compatible resume snapshots via the extension/CDP pipeline",
		Args:  cobra.NoArgs,
		RunE: func(cmd *cobra.Command, args []string) error {
			if cmd.Flags().Changed("count") && count < 1 {
				return fmt.Errorf("--count must be greater than 0")
			}
			if cmd.Flags().Changed("max-pages") && maxPages < 1 {
				return fmt.Errorf("--max-pages must be greater than 0")
			}

			options := currentOptions()
			response, err := runResumeSnapshot(context.Background(), resumeSnapshotRequest{
				APIURL:      options.APIURL,
				Workspace:   options.Workspace,
				Count:       count,
				MaxPages:    maxPages,
				OutDir:      outDir,
				Sources:     sources,
				Job5156URL:  job5156URL,
				SeekURL:     seekURL,
				ManualFile:  manualFile,
				CDPEndpoint: cdpEndpoint,
			})
			if err != nil {
				return err
			}

			output := buildResumeSnapshotOutput(response)
			return writeOutput(cmd, output.Headers, output.Rows, response)
		},
	}

	cmd.Flags().StringArrayVar(&sources, "source", nil, "Snapshot source alias (repeatable): job5156|seek|51job-manual")
	cmd.Flags().IntVar(&count, "count", 0, "Resumes per source (default: snapshot script default)")
	cmd.Flags().IntVar(&maxPages, "max-pages", 0, "Browser pages per source collection (default: snapshot script default)")
	cmd.Flags().StringVar(&outDir, "out-dir", "", "Output directory (default: snapshot script default)")
	cmd.Flags().StringVar(&job5156URL, "job5156-url", "", "Override the Job5156 source URL")
	cmd.Flags().StringVar(&seekURL, "seek-url", "", "Override the SEEK source URL")
	cmd.Flags().StringVar(&manualFile, "manual-file", "", "Override the manual 51job archive path")
	cmd.Flags().StringVar(&cdpEndpoint, "cdp-endpoint", "", "Override the Chrome DevTools endpoint or port")

	return cmd
}
