package cmd

import (
	"context"
	"fmt"
	"os"
	"path/filepath"
	"regexp"
	"strconv"
	"strings"
	"time"

	"github.com/ptdevhk/trends/packages/cli/internal/client"
	"github.com/spf13/cobra"
)

var resumeFilenamePattern = regexp.MustCompile(`filename="?([^\";]+)"?`)

func newResumeCmd() *cobra.Command {
	resumeCmd := &cobra.Command{
		Use:   "resume",
		Short: "Resume operations",
	}

	resumeCmd.AddCommand(
		newResumeListCmd(),
		newResumeShowCmd(),
		newResumeSearchCmd(),
		newResumeMatchCmd(),
		newResumeSnapshotCmd(),
		newResumeManualImportCmd(),
		newResumeBackupCmd(),
		newResumeRestoreCmd(),
		newResumeDeployBackupCmd(),
		newResumeExportCmd(),
		newResumeDebugCmd(),
	)

	return resumeCmd
}

func newResumeListCmd() *cobra.Command {
	var limit int

	cmd := &cobra.Command{
		Use:   "list",
		Short: "List resumes",
		RunE: func(cmd *cobra.Command, args []string) error {
			response, err := newAPIClient().ListResumes(context.Background(), limit, "", "sample")
			if err != nil {
				return err
			}

			headers := []string{"id", "name", "intention", "location", "experience", "education"}
			rows := make([][]string, 0, len(response.Data))
			for index, item := range response.Data {
				rows = append(rows, []string{
					resumeIdentifier(item, index),
					item.Name,
					item.JobIntention,
					item.Location,
					item.Experience,
					item.Education,
				})
			}

			return writeOutput(cmd, headers, rows, response)
		},
	}

	cmd.Flags().IntVar(&limit, "limit", 50, "Maximum resumes to fetch")
	return cmd
}

func newResumeShowCmd() *cobra.Command {
	var sample string
	var source string

	cmd := &cobra.Command{
		Use:   "show <resume-id>",
		Short: "Show one resume with detailed work experience",
		Args:  cobra.ExactArgs(1),
		RunE: func(cmd *cobra.Command, args []string) error {
			response, err := newAPIClient().GetResumeDetail(
				context.Background(),
				args[0],
				sample,
				source,
			)
			if err != nil {
				return err
			}

			if currentOptions().Output == "json" {
				return writeOutput(cmd, nil, nil, response)
			}

			return writeResumeDetailOutput(cmd, response)
		},
	}

	cmd.Flags().StringVar(&sample, "sample", "", "Optional sample name when source=sample")
	cmd.Flags().StringVar(&source, "source", "sample", "Resume source: sample|convex")

	return cmd
}

func newResumeSearchCmd() *cobra.Command {
	var limit int
	var source string

	cmd := &cobra.Command{
		Use:   "search <query>",
		Short: "Search resumes (sample or live Convex-backed retrieval)",
		Args:  cobra.ExactArgs(1),
		RunE: func(cmd *cobra.Command, args []string) error {
			response, err := newAPIClient().SearchResumes(context.Background(), args[0], limit, source)
			if err != nil {
				return err
			}

			options := currentOptions()
			if options.Output != "json" {
				fmt.Fprintf(
					cmd.OutOrStdout(),
					"Query: %s | Source: %s | Total: %d | Returned: %d\n\n",
					response.Summary.Query,
					coalesceString(response.Summary.Source, normalizeResumeSourceFlag(source)),
					response.Summary.Total,
					response.Summary.Returned,
				)
			}

			headers := []string{"id", "name", "intention", "location", "experience", "education"}
			rows := make([][]string, 0, len(response.Data))
			for index, item := range response.Data {
				rows = append(rows, []string{
					resumeIdentifier(item, index),
					item.Name,
					item.JobIntention,
					item.Location,
					item.Experience,
					item.Education,
				})
			}

			return writeOutput(cmd, headers, rows, response)
		},
	}

	cmd.Flags().IntVar(&limit, "limit", 50, "Maximum resumes to fetch")
	cmd.Flags().StringVar(&source, "source", "sample", "Resume source: sample|convex")
	return cmd
}

func newResumeMatchCmd() *cobra.Command {
	var (
		query            string
		location         string
		jobDescriptionID string
		sample           string
		source           string
		persist          bool
		limit            int
		topN             int
		mode             string
	)

	cmd := &cobra.Command{
		Use:   "match",
		Short: "Run resume matching through the API",
		Args:  cobra.NoArgs,
		RunE: func(cmd *cobra.Command, args []string) error {
			keywords := splitQueryKeywords(query)
			if strings.TrimSpace(jobDescriptionID) == "" && len(keywords) == 0 {
				return fmt.Errorf("query or job-description is required")
			}

			request := client.ResumeMatchRequest{
				Sample:           strings.TrimSpace(sample),
				Source:           source,
				JobDescriptionID: strings.TrimSpace(jobDescriptionID),
				Keywords:         keywords,
				Location:         strings.TrimSpace(location),
				Limit:            limit,
				TopN:             topN,
				Mode:             strings.TrimSpace(mode),
			}
			request.Persist = &persist
			if err := validateResumeMatchRequest(request); err != nil {
				return err
			}

			response, err := newAPIClient().MatchResumes(context.Background(), request)
			if err != nil {
				return err
			}
			if currentOptions().Output == "json" {
				return writeOutput(cmd, nil, nil, response)
			}

			displayMap, err := loadResumeDisplayMap(context.Background(), newAPIClient(), strings.Join(keywords, " "), limit, source)
			if err != nil {
				return err
			}
			return writeResumeMatchTable(cmd, response, displayMap)
		},
	}

	cmd.Flags().StringVar(&query, "query", "", "Keyword query to match against resumes")
	cmd.Flags().StringVar(&location, "location", "", "Optional location constraint")
	cmd.Flags().StringVar(&jobDescriptionID, "job-description", "", "Optional job description ID")
	cmd.Flags().StringVar(&sample, "sample", "", "Optional sample name for sample-backed matching")
	cmd.Flags().StringVar(&source, "source", "convex", "Resume source: sample|convex")
	cmd.Flags().BoolVar(&persist, "persist", false, "Persist matches and session state")
	cmd.Flags().IntVar(&limit, "limit", 50, "Maximum resumes to score")
	cmd.Flags().IntVar(&topN, "top-n", 20, "Hybrid/AI candidate cutoff")
	cmd.Flags().StringVar(&mode, "mode", "rules_only", "Match mode: rules_only|hybrid|ai_only")

	return cmd
}

func newResumeExportCmd() *cobra.Command {
	var format string
	var limit int
	var query string
	var outPath string

	cmd := &cobra.Command{
		Use:   "export",
		Short: "Export resumes through API",
		RunE: func(cmd *cobra.Command, args []string) error {
			format = strings.ToLower(strings.TrimSpace(format))
			if format != "csv" && format != "xlsx" {
				return fmt.Errorf("invalid format %q (expected csv|xlsx)", format)
			}

			resumes, err := newAPIClient().ListResumes(context.Background(), limit, query, "sample")
			if err != nil {
				return err
			}
			if len(resumes.Data) == 0 {
				return writeMessage(cmd, "No resumes to export")
			}

			entries := make([]client.ResumeExportEntry, 0, len(resumes.Data))
			for index, item := range resumes.Data {
				entries = append(entries, client.ResumeExportEntry{
					ResumeID: resumeIdentifier(item, index),
				})
			}

			request := client.ResumeExportRequest{
				Format:  format,
				Source:  "sample",
				Entries: entries,
			}
			if resumes.Sample != nil && strings.TrimSpace(resumes.Sample.Name) != "" {
				request.Sample = resumes.Sample.Name
			}

			payload, disposition, err := newAPIClient().ExportResumes(context.Background(), request)
			if err != nil {
				return err
			}

			resolvedPath := strings.TrimSpace(outPath)
			if resolvedPath == "" {
				resolvedPath = extractFilename(disposition)
			}
			if resolvedPath == "" {
				resolvedPath = fmt.Sprintf("resumes-export-%s.%s", time.Now().Format("20060102-150405"), format)
			}

			if err := os.MkdirAll(filepath.Dir(resolvedPath), 0o755); err != nil && filepath.Dir(resolvedPath) != "." {
				return fmt.Errorf("create output directory: %w", err)
			}
			if err := os.WriteFile(resolvedPath, payload, 0o644); err != nil {
				return fmt.Errorf("write export file: %w", err)
			}

			raw := map[string]any{
				"count": len(entries),
				"file":  resolvedPath,
				"bytes": len(payload),
			}
			headers := []string{"count", "file", "bytes"}
			rows := [][]string{{fmt.Sprintf("%d", len(entries)), resolvedPath, fmt.Sprintf("%d", len(payload))}}
			return writeOutput(cmd, headers, rows, raw)
		},
	}

	cmd.Flags().StringVar(&format, "format", "csv", "Export format: csv|xlsx")
	cmd.Flags().IntVar(&limit, "limit", 200, "Maximum resumes to fetch before export")
	cmd.Flags().StringVar(&query, "query", "", "Optional search query before export")
	cmd.Flags().StringVar(&outPath, "out", "", "Output file path")

	return cmd
}

func newResumeManualImportCmd() *cobra.Command {
	var (
		searchProfileID string
		keyword         string
		location        string
		limit           int
	)

	cmd := &cobra.Command{
		Use:   "import-51job <file> [file...]",
		Short: "Import local 51job manual-export archives or documents through the API",
		Args:  cobra.MinimumNArgs(1),
		RunE: func(cmd *cobra.Command, args []string) error {
			if cmd.Flags().Changed("limit") && limit < 1 {
				return fmt.Errorf("--limit must be greater than 0")
			}

			response, err := newAPIClient().ImportManualResumes(context.Background(), client.ResumeManualImportRequest{
				FilePaths:       normalizeStringSlice(args),
				SearchProfileID: strings.TrimSpace(searchProfileID),
				Keyword:         strings.TrimSpace(keyword),
				Location:        strings.TrimSpace(location),
				Limit:           limit,
			})
			if err != nil {
				return err
			}

			if currentOptions().Output != "json" {
				fmt.Fprintf(
					cmd.OutOrStdout(),
					"Source: %s | Uploaded: %d | Discovered: %d | Parsed: %d | Imported: %d | Failed: %d\n\n",
					coalesceString(response.Source.Label, response.Source.Key, "51job-manual"),
					response.Summary.UploadedFiles,
					response.Summary.DiscoveredFiles,
					response.Summary.ParsedResumes,
					response.Summary.Imported,
					response.Summary.Failed,
				)
			}

			output := buildResumeManualImportOutput(response)
			return writeOutput(cmd, output.Headers, output.Rows, response)
		},
	}

	cmd.Flags().StringVar(&searchProfileID, "search-profile", "", "Optional search profile ID to attach to imported resumes")
	cmd.Flags().StringVar(&keyword, "keyword", "", "Optional keyword tag to attach to imported resumes")
	cmd.Flags().StringVar(&location, "location", "", "Optional location tag to attach to imported resumes")
	cmd.Flags().IntVar(&limit, "limit", 0, "Optional maximum number of parsed resumes to import")

	return cmd
}

func buildResumeManualImportOutput(response *client.ResumeManualImportResponse) resumeSummaryOutput {
	headers := []string{
		"upload_name",
		"entry_path",
		"extension",
		"status",
		"resume_name",
		"profile_id",
		"warnings",
		"error",
	}
	rows := make([][]string, 0, len(response.Files))

	for _, file := range response.Files {
		rows = append(rows, []string{
			file.UploadName,
			file.EntryPath,
			file.Extension,
			file.Status,
			file.ResumeName,
			file.ProfileID,
			strings.Join(file.Warnings, " | "),
			file.Error,
		})
	}

	return resumeSummaryOutput{
		Headers: headers,
		Rows:    rows,
	}
}

func writeResumeDetailOutput(cmd *cobra.Command, response *client.ResumeDetailResponse) error {
	item := response.Data
	out := cmd.OutOrStdout()

	if _, err := fmt.Fprintf(
		out,
		"ID: %s\nName: %s\nSource: %s\nIntention: %s\nLocation: %s\nExperience: %s\nEducation: %s\nActivity: %s\nSalary: %s\nProfile: %s\n",
		coalesceString(item.ResumeID, item.PerUserID, item.ProfileID, item.ExternalID),
		fallbackDisplayValue(item.Name),
		fallbackDisplayValue(response.Source),
		fallbackDisplayValue(item.JobIntention),
		fallbackDisplayValue(item.Location),
		fallbackDisplayValue(item.Experience),
		fallbackDisplayValue(item.Education),
		fallbackDisplayValue(item.ActivityStatus),
		fallbackDisplayValue(item.ExpectedSalary),
		fallbackDisplayValue(item.ProfileURL),
	); err != nil {
		return err
	}

	if strings.TrimSpace(item.SelfIntro) != "" {
		if _, err := fmt.Fprintf(out, "\nSelf Intro:\n%s\n", item.SelfIntro); err != nil {
			return err
		}
	}

	if _, err := fmt.Fprintln(out, "\nWork History:"); err != nil {
		return err
	}
	if len(item.WorkHistory) == 0 {
		if _, err := fmt.Fprintln(out, "- --"); err != nil {
			return err
		}
	} else {
		for index, entry := range item.WorkHistory {
			if _, err := fmt.Fprintf(out, "%d. %s\n", index+1, formatResumeWorkHistoryEntry(entry)); err != nil {
				return err
			}
			if description := strings.TrimSpace(entry.Description); description != "" {
				if _, err := fmt.Fprintf(out, "%s\n", indentMultiline(description, "   ")); err != nil {
					return err
				}
			}
		}
	}

	return nil
}

func fallbackDisplayValue(value string) string {
	if strings.TrimSpace(value) == "" {
		return "--"
	}
	return value
}

func formatResumeWorkHistoryEntry(entry client.ResumeWorkHistoryItem) string {
	parts := make([]string, 0, 4)

	dateRange := strings.TrimSpace(strings.Join([]string{
		strings.TrimSpace(entry.StartDate),
		strings.TrimSpace(entry.EndDate),
	}, " ~ "))
	dateRange = strings.TrimSpace(strings.Trim(dateRange, "~ "))
	if dateRange != "" {
		parts = append(parts, dateRange)
	}

	if company := strings.TrimSpace(entry.CompanyName); company != "" {
		parts = append(parts, company)
	}
	if title := strings.TrimSpace(entry.JobTitle); title != "" {
		parts = append(parts, title)
	}
	if len(parts) == 0 && strings.TrimSpace(entry.Raw) != "" {
		return entry.Raw
	}
	if len(parts) == 0 {
		return "--"
	}
	return strings.Join(parts, " | ")
}

func indentMultiline(text string, prefix string) string {
	lines := strings.Split(text, "\n")
	for index, line := range lines {
		lines[index] = prefix + line
	}
	return strings.Join(lines, "\n")
}

type resumeDisplayRow struct {
	Name     string
	Location string
}

func loadResumeDisplayMap(ctx context.Context, apiClient *client.Client, query string, limit int, source string) (map[string]resumeDisplayRow, error) {
	var (
		response *client.ResumesResponse
		err      error
	)
	if strings.TrimSpace(query) != "" {
		response, err = apiClient.SearchResumes(ctx, query, limit, source)
	} else {
		response, err = apiClient.ListResumes(ctx, limit, "", source)
	}
	if err != nil {
		return nil, err
	}

	displayMap := make(map[string]resumeDisplayRow, len(response.Data))
	for index, item := range response.Data {
		displayMap[resumeIdentifier(item, index)] = resumeDisplayRow{
			Name:     item.Name,
			Location: item.Location,
		}
	}
	return displayMap, nil
}

func splitQueryKeywords(query string) []string {
	return strings.Fields(strings.TrimSpace(query))
}

func coalesceString(values ...string) string {
	for _, value := range values {
		trimmed := strings.TrimSpace(value)
		if trimmed != "" {
			return trimmed
		}
	}
	return ""
}

func normalizeResumeSourceFlag(source string) string {
	if strings.EqualFold(strings.TrimSpace(source), "convex") {
		return "convex"
	}
	return "sample"
}

func formatOptionalFloat(value *float64) string {
	if value == nil {
		return ""
	}
	if *value == float64(int(*value)) {
		return strconv.Itoa(int(*value))
	}
	return strconv.FormatFloat(*value, 'f', 2, 64)
}

func formatSalesYears(debug *client.ResumeMatchDebug) string {
	if debug == nil {
		return ""
	}
	for _, signal := range debug.RoleSignals {
		if strings.EqualFold(signal.Type, "sales") {
			if signal.IndustryVerifiedRelevantYears != nil {
				return formatOptionalFloat(signal.IndustryVerifiedRelevantYears)
			}
			if signal.RoleRelevantYears != nil {
				return formatOptionalFloat(signal.RoleRelevantYears)
			}
			value := signal.IndustryVerifiedYears
			return formatOptionalFloat(&value)
		}
	}
	return ""
}

func debugPrimaryRuleScore(debug *client.ResumeMatchDebug) *float64 {
	if debug == nil {
		return nil
	}
	return debug.PrimaryRuleScore
}

func debugCompanyHits(debug *client.ResumeMatchDebug) []string {
	if debug == nil {
		return nil
	}
	return debug.CompanyHits
}

func resumeIdentifier(item client.ResumeItem, index int) string {
	if strings.TrimSpace(item.ResumeID) != "" {
		return item.ResumeID
	}
	if strings.TrimSpace(item.PerUserID) != "" {
		return item.PerUserID
	}
	if strings.TrimSpace(item.ProfileID) != "" {
		return item.ProfileID
	}
	if strings.TrimSpace(item.ExternalID) != "" {
		return item.ExternalID
	}
	return fmt.Sprintf("resume-%d", index+1)
}

func extractFilename(contentDisposition string) string {
	if strings.TrimSpace(contentDisposition) == "" {
		return ""
	}
	matches := resumeFilenamePattern.FindStringSubmatch(contentDisposition)
	if len(matches) < 2 {
		return ""
	}
	return strings.TrimSpace(matches[1])
}
