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
	"github.com/ptdevhk/trends/packages/cli/internal/output"
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
		newResumeAnalyzeCmd(),
		newResumeSnapshotCmd(),
		newResumeManualImportCmd(),
		newResumeBackupCmd(),
		newResumeRestoreCmd(),
		newResumeFullRestoreCmd(),
		newResumeDeployBackupCmd(),
		newResumeExportCmd(),
		newResumeDebugCmd(),
		newResumeNoteCmd(),
		newResumeArchiveCmd(),
		newResumeUnarchiveCmd(),
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
	var minRoleYears int
	var roleType string
	var minAge int
	var maxAge int
	var sourcesFlag string

	cmd := &cobra.Command{
		Use:   "search <query>",
		Short: "Search resumes (sample or live Convex-backed retrieval)",
		Args:  cobra.ExactArgs(1),
		RunE: func(cmd *cobra.Command, args []string) error {
			var filterParams client.ResumeFilterParams
			filterParams.MinRoleYears = minRoleYears
			filterParams.RoleType = roleType
			filterParams.MinAge = minAge
			filterParams.MaxAge = maxAge
			if strings.TrimSpace(sourcesFlag) != "" {
				filterParams.Sources = strings.Split(sourcesFlag, ",")
			}

			response, err := newAPIClient().SearchResumes(context.Background(), args[0], limit, source, filterParams)
			if err != nil {
				return err
			}

			options := currentOptions()
			switch options.Output {
			case "table":
				fmt.Fprintf(
					cmd.OutOrStdout(),
					"Query: %s | Source: %s | Total: %d | Returned: %d\n\n",
					response.Summary.Query,
					coalesceString(response.Summary.Source, normalizeResumeSourceFlag(source)),
					response.Summary.Total,
					response.Summary.Returned,
				)
			case "agent":
				if err := writeAgentSummary(cmd, []output.Field{
					{Key: "query", Value: response.Summary.Query},
					{Key: "source", Value: coalesceString(response.Summary.Source, normalizeResumeSourceFlag(source))},
					{Key: "total", Value: strconv.Itoa(response.Summary.Total)},
					{Key: "returned", Value: strconv.Itoa(response.Summary.Returned)},
				}); err != nil {
					return err
				}
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
	cmd.Flags().IntVar(&minRoleYears, "min-role-years", 0, "Minimum role years filter")
	cmd.Flags().StringVar(&roleType, "role-type", "", "Role filter type (e.g. sales)")
	cmd.Flags().IntVar(&minAge, "min-age", 0, "Minimum age filter")
	cmd.Flags().IntVar(&maxAge, "max-age", 0, "Maximum age filter")
	cmd.Flags().StringVar(&sourcesFlag, "sources", "", "Comma-separated source filter")
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

			apiClient := newAPIClient()
			response, err := apiClient.MatchResumes(context.Background(), request)
			if err != nil {
				return err
			}
			if currentOptions().Output == "json" {
				return writeOutput(cmd, nil, nil, response)
			}

			displayMap, err := loadResumeDisplayMap(context.Background(), apiClient, strings.Join(keywords, " "), limit, source)
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

func newResumeAnalyzeCmd() *cobra.Command {
	var (
		query            string
		jobDescriptionID string
		location         string
		locationFilters  string
		minExperience    int
		maxExperience    int
		education        string
		skills           string
		requiredKeywords string
		minSalary        int
		maxSalary        int
		limit            int
		dryRun           bool
		roleType         string
		minRoleYears     int
		market           string
		manifestPath     string
		resumeIDs        []string
		yes              bool
		wait             bool
		waitTimeout      time.Duration
		pollInterval     time.Duration
	)

	cmd := &cobra.Command{
		Use:   "analyze",
		Short: "Dispatch AI analysis for resumes matching search criteria",
		Args:  cobra.NoArgs,
		RunE: func(cmd *cobra.Command, args []string) error {
			if strings.TrimSpace(query) == "" && strings.TrimSpace(jobDescriptionID) == "" {
				return fmt.Errorf("query or job-description is required")
			}
			if !wait && (cmd.Flags().Changed("wait-timeout") || cmd.Flags().Changed("poll-interval")) {
				return fmt.Errorf("--wait-timeout and --poll-interval require --wait")
			}

			exactMode := cmd.Flags().Changed("manifest") || cmd.Flags().Changed("resume-id")
			if exactMode && minExperience > 0 {
				return fmt.Errorf("--min-experience is not supported in exact mode")
			}
			if exactMode && !dryRun && !yes {
				return fmt.Errorf("live exact analysis requires --yes; use --dry-run to resolve and preview")
			}
			if exactMode && wait && dryRun {
				return fmt.Errorf("--wait requires a live exact analysis; it cannot be used with --dry-run")
			}
			if exactMode && wait && (waitTimeout <= 0 || pollInterval <= 0) {
				return fmt.Errorf("wait-timeout and poll-interval must be positive")
			}
			if !exactMode && wait {
				return fmt.Errorf("--wait requires exact analysis selected by --manifest and/or --resume-id")
			}

			var targets []client.ExactReingestTarget
			if exactMode && cmd.Flags().Changed("manifest") {
				if strings.TrimSpace(manifestPath) == "" {
					return fmt.Errorf("--manifest requires a path")
				}
				manifestTargets, err := readExactReingestManifest(manifestPath)
				if err != nil {
					return err
				}
				targets = manifestTargets
			}
			normalizedResumeIDs := make([]string, 0, len(resumeIDs))
			for _, resumeID := range resumeIDs {
				trimmed := strings.TrimSpace(resumeID)
				if trimmed == "" {
					return fmt.Errorf("--resume-id cannot be empty")
				}
				normalizedResumeIDs = append(normalizedResumeIDs, trimmed)
			}
			if exactMode && len(targets)+len(normalizedResumeIDs) == 0 {
				return fmt.Errorf("exact analysis requires --manifest and/or at least one --resume-id")
			}

			var educationSlice []string
			if strings.TrimSpace(education) != "" {
				educationSlice = splitCSV(education)
			}
			var skillsSlice []string
			if strings.TrimSpace(skills) != "" {
				skillsSlice = splitCSV(skills)
			}
			var requiredKeywordsSlice []string
			if strings.TrimSpace(requiredKeywords) != "" {
				requiredKeywordsSlice = splitCSV(requiredKeywords)
			}
			var locationsSlice []string
			if strings.TrimSpace(locationFilters) != "" {
				locationsSlice = splitCSV(locationFilters)
			}

			request := client.AnalyzeRequest{
				Query:            strings.TrimSpace(query),
				JobDescriptionID: strings.TrimSpace(jobDescriptionID),
				Location:         strings.TrimSpace(location),
				MinExperience:    minExperience,
				MaxExperience:    maxExperience,
				Education:        educationSlice,
				Skills:           skillsSlice,
				RequiredKeywords: requiredKeywordsSlice,
				Locations:        locationsSlice,
				MinSalary:        minSalary,
				MaxSalary:        maxSalary,
				Limit:            limit,
				DryRun:           dryRun,
				RoleFilterType:   strings.TrimSpace(roleType),
				MinRoleYears:     minRoleYears,
				Market:           strings.TrimSpace(market),
				Targets:          targets,
				ResumeIDs:        normalizedResumeIDs,
			}

			apiClient := newAPIClient()
			response, err := apiClient.AnalyzeResumes(cmd.Context(), request)
			if err != nil {
				return err
			}
			if wait {
				verification, err := waitForExactAnalysis(
					cmd.Context(),
					apiClient,
					response,
					waitTimeout,
					pollInterval,
				)
				if err != nil {
					return err
				}
				response.Verification = verification
			}

			if currentOptions().Output == "json" {
				return writeOutput(cmd, nil, nil, response)
			}

			return writeAnalyzeTable(cmd, response)
		},
	}

	cmd.Flags().StringVarP(&query, "query", "q", "", "Keyword search query")
	cmd.Flags().StringVar(&jobDescriptionID, "job-description", "", "Job description ID")
	cmd.Flags().StringVar(&location, "location", "", "Location filter")
	cmd.Flags().StringVar(&locationFilters, "locations", "", "Location filter (CSV for multiple)")
	cmd.Flags().IntVar(&minExperience, "min-experience", 0, "Min years experience")
	cmd.Flags().IntVar(&maxExperience, "max-experience", 0, "Max years experience")
	cmd.Flags().StringVar(&education, "education", "", "Education filter (CSV: bachelor,master)")
	cmd.Flags().StringVar(&skills, "skills", "", "Skills filter (CSV)")
	cmd.Flags().StringVar(&requiredKeywords, "required-keywords", "", "Required keywords AND filter (CSV)")
	cmd.Flags().IntVar(&minSalary, "min-salary", 0, "Min salary")
	cmd.Flags().IntVar(&maxSalary, "max-salary", 0, "Max salary")
	cmd.Flags().IntVar(&limit, "limit", 50, "Max candidates to analyze (1-500)")
	cmd.Flags().BoolVar(&dryRun, "dry-run", false, "Preview candidate count without dispatching")
	cmd.Flags().StringVar(&roleType, "role-type", "", "Role filter type for related experience evidence (e.g. sales)")
	cmd.Flags().IntVar(&minRoleYears, "min-role-years", 0, "Minimum role years for related experience evidence")
	cmd.Flags().StringVar(&market, "market", "", "Market context for related experience evidence (e.g. CN, MY)")
	cmd.Flags().StringVar(&manifestPath, "manifest", "", "Path to a version-1 exact resume manifest")
	cmd.Flags().StringArrayVar(&resumeIDs, "resume-id", nil, "Current Convex resume ID to analyze (repeatable)")
	cmd.Flags().BoolVar(&yes, "yes", false, "Confirm live exact analysis dispatch")
	cmd.Flags().BoolVar(&wait, "wait", false, "Wait for every exact target analysis to become authoritative")
	cmd.Flags().DurationVar(&waitTimeout, "wait-timeout", 10*time.Minute, "Maximum time to wait for exact analysis readiness")
	cmd.Flags().DurationVar(&pollInterval, "poll-interval", 2*time.Second, "Interval between exact analysis task checks")

	return cmd
}

func waitForExactAnalysis(
	ctx context.Context,
	apiClient *client.Client,
	response *client.AnalyzeResponse,
	timeout time.Duration,
	pollInterval time.Duration,
) (*client.ExactAnalysisVerification, error) {
	taskID := strings.TrimSpace(response.TaskID)
	if taskID == "" {
		return nil, fmt.Errorf("exact analysis response is missing taskId")
	}
	if timeout <= 0 || pollInterval <= 0 {
		return nil, fmt.Errorf("wait-timeout and poll-interval must be positive")
	}

	waitCtx, cancel := context.WithTimeout(ctx, timeout)
	defer cancel()
	for {
		if waitCtx.Err() != nil {
			return nil, exactAnalysisTimeoutError(taskID, timeout)
		}

		detail, err := apiClient.GetAnalysisTask(waitCtx, taskID)
		if err != nil {
			if waitCtx.Err() != nil {
				return nil, exactAnalysisTimeoutError(taskID, timeout)
			}
			return nil, err
		}

		switch detail.Task.Status {
		case "failed", "cancelled":
			return nil, fmt.Errorf("exact analysis task %s %s", taskID, detail.Task.Status)
		case "completed", "pending", "processing":
		case "":
			return nil, fmt.Errorf("exact analysis task %s response is missing status", taskID)
		default:
			return nil, fmt.Errorf("exact analysis task %s has unknown status %q", taskID, detail.Task.Status)
		}

		if detail.Verification.Invalid > 0 {
			return nil, exactAnalysisInvalidError(taskID, detail.Verification)
		}
		if detail.Task.Status == "completed" && detail.Verification.AllReady {
			return &detail.Verification, nil
		}

		timer := time.NewTimer(pollInterval)
		select {
		case <-waitCtx.Done():
			if !timer.Stop() {
				<-timer.C
			}
			return nil, exactAnalysisTimeoutError(taskID, timeout)
		case <-timer.C:
		}
	}
}

func exactAnalysisInvalidError(taskID string, verification client.ExactAnalysisVerification) error {
	reasons := make([]string, 0)
	seen := make(map[string]struct{})
	for _, target := range verification.Targets {
		for _, reason := range target.Reasons {
			trimmed := strings.TrimSpace(reason)
			if trimmed == "" {
				continue
			}
			if _, exists := seen[trimmed]; exists {
				continue
			}
			seen[trimmed] = struct{}{}
			reasons = append(reasons, trimmed)
		}
	}
	if len(reasons) == 0 {
		reasons = append(reasons, "no reasons reported")
	}
	return fmt.Errorf(
		"exact analysis task %s has %d invalid targets: %s",
		taskID,
		verification.Invalid,
		strings.Join(reasons, ", "),
	)
}

func exactAnalysisTimeoutError(taskID string, timeout time.Duration) error {
	return fmt.Errorf("exact analysis task %s timed out after %s", taskID, timeout)
}

func splitCSV(input string) []string {
	parts := strings.Split(input, ",")
	result := make([]string, 0, len(parts))
	for _, part := range parts {
		trimmed := strings.TrimSpace(part)
		if trimmed != "" {
			result = append(result, trimmed)
		}
	}
	return result
}

func writeAnalyzeTable(cmd *cobra.Command, response *client.AnalyzeResponse) error {
	if currentOptions().Output == "agent" {
		fields := []output.Field{
			{Key: "kind", Value: "analysis"},
			{Key: "candidates", Value: strconv.Itoa(response.ResumeCount)},
			{Key: "dry_run", Value: strconv.FormatBool(response.DryRun)},
			{Key: "task_id", Value: response.TaskID},
		}
		if response.Config != nil {
			fields = append(fields,
				output.Field{Key: "job_description_id", Value: response.Config.JobDescriptionID},
				output.Field{Key: "keywords", Value: strings.Join(response.Config.Keywords, ",")},
				output.Field{Key: "location", Value: response.Config.Location},
			)
		}
		return writeAgentFields(cmd, fields)
	}

	fmt.Fprintf(cmd.OutOrStdout(), "Candidates: %d\n", response.ResumeCount)
	if response.DryRun {
		fmt.Fprintf(cmd.OutOrStdout(), "Mode: dry-run (no analysis dispatched)\n")
	} else if response.TaskID != "" {
		fmt.Fprintf(cmd.OutOrStdout(), "Task ID: %s\n", response.TaskID)
	}
	if response.Config != nil {
		if response.Config.JobDescriptionID != "" {
			fmt.Fprintf(cmd.OutOrStdout(), "Job Description: %s\n", response.Config.JobDescriptionID)
		}
		if len(response.Config.Keywords) > 0 {
			fmt.Fprintf(cmd.OutOrStdout(), "Keywords: %s\n", strings.Join(response.Config.Keywords, ", "))
		}
		if response.Config.Location != "" {
			fmt.Fprintf(cmd.OutOrStdout(), "Location: %s\n", response.Config.Location)
		}
	}
	return nil
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

			apiClient := newAPIClient()
			resumes, err := apiClient.ListResumes(context.Background(), limit, query, "sample")
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

			payload, disposition, err := apiClient.ExportResumes(context.Background(), request)
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

			switch currentOptions().Output {
			case "table":
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
			case "agent":
				if err := writeAgentSummary(cmd, []output.Field{
					{Key: "source", Value: coalesceString(response.Source.Label, response.Source.Key, "51job-manual")},
					{Key: "uploaded", Value: strconv.Itoa(response.Summary.UploadedFiles)},
					{Key: "discovered", Value: strconv.Itoa(response.Summary.DiscoveredFiles)},
					{Key: "parsed", Value: strconv.Itoa(response.Summary.ParsedResumes)},
					{Key: "imported", Value: strconv.Itoa(response.Summary.Imported)},
					{Key: "failed", Value: strconv.Itoa(response.Summary.Failed)},
				}); err != nil {
					return err
				}
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

	if currentOptions().Output == "agent" {
		return writeAgentFields(cmd, []output.Field{
			{Key: "kind", Value: "resume_detail"},
			{Key: "id", Value: coalesceString(item.ResumeID, item.PerUserID, item.ProfileID, item.ExternalID)},
			{Key: "name", Value: item.Name},
			{Key: "source", Value: response.Source},
			{Key: "intention", Value: item.JobIntention},
			{Key: "location", Value: item.Location},
			{Key: "experience", Value: item.Experience},
			{Key: "education", Value: item.Education},
			{Key: "activity", Value: item.ActivityStatus},
			{Key: "salary", Value: item.ExpectedSalary},
			{Key: "profile", Value: item.ProfileURL},
			{Key: "self_intro", Value: strconv.FormatBool(strings.TrimSpace(item.SelfIntro) != "")},
			{Key: "work_history", Value: strconv.Itoa(len(item.WorkHistory))},
			{Key: "detail", Value: "use --output json for full resume"},
		})
	}

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

func newResumeArchiveCmd() *cobra.Command {
	cmd := &cobra.Command{
		Use:   "archive <id> [<id>...]",
		Short: "Archive one or more resumes (soft-delete)",
		Args:  cobra.MinimumNArgs(1),
		RunE: func(cmd *cobra.Command, args []string) error {
			response, err := newAPIClient().ArchiveResumes(context.Background(), args)
			if err != nil {
				return fmt.Errorf("archive resumes: %w", err)
			}
			return writeOutput(cmd,
				[]string{"requested", "archived", "already_archived", "missing"},
				[][]string{{
					strconv.Itoa(response.Requested),
					strconv.Itoa(response.Archived),
					strconv.Itoa(response.AlreadyArchived),
					strings.Join(response.MissingIDs, ", "),
				}},
				response,
			)
		},
	}
	return cmd
}

func newResumeUnarchiveCmd() *cobra.Command {
	cmd := &cobra.Command{
		Use:   "unarchive <id> [<id>...]",
		Short: "Restore one or more archived resumes",
		Args:  cobra.MinimumNArgs(1),
		RunE: func(cmd *cobra.Command, args []string) error {
			response, err := newAPIClient().UnarchiveResumes(context.Background(), args)
			if err != nil {
				return fmt.Errorf("unarchive resumes: %w", err)
			}
			return writeOutput(cmd,
				[]string{"requested", "unarchived", "not_archived", "missing"},
				[][]string{{
					strconv.Itoa(response.Requested),
					strconv.Itoa(response.Unarchived),
					strconv.Itoa(response.NotArchived),
					strings.Join(response.MissingIDs, ", "),
				}},
				response,
			)
		},
	}
	return cmd
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
