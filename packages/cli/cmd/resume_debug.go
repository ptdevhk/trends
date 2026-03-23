package cmd

import (
	"context"
	"encoding/json"
	"fmt"
	"path/filepath"
	"strconv"
	"strings"

	"github.com/ptdevhk/trends/packages/cli/internal/client"
	"github.com/spf13/cobra"
)

type localResumeAIScoreRequest struct {
	APIURL           string   `json:"apiUrl"`
	Workspace        string   `json:"workspace"`
	Source           string   `json:"source"`
	Query            string   `json:"query,omitempty"`
	Location         string   `json:"location,omitempty"`
	JobDescriptionID string   `json:"jobDescriptionId,omitempty"`
	ResumeIDs        []string `json:"resumeIds,omitempty"`
	Limit            int      `json:"limit"`
	TopN             int      `json:"topN"`
}

type localResumeAIScoreStats struct {
	Processed  int     `json:"processed"`
	RuleAvg    float64 `json:"ruleAvg"`
	AIScoreAvg float64 `json:"aiScoreAvg"`
}

type localResumeAIScoreResult struct {
	ResumeID       string   `json:"resumeId"`
	Name           string   `json:"name"`
	Location       string   `json:"location"`
	ProfileURL     string   `json:"profileUrl,omitempty"`
	RuleScore      int      `json:"ruleScore"`
	AIScore        int      `json:"aiScore"`
	Recommendation string   `json:"recommendation"`
	Summary        string   `json:"summary"`
	Highlights     []string `json:"highlights,omitempty"`
	Concerns       []string `json:"concerns,omitempty"`
	RawResponse    string   `json:"rawResponse,omitempty"`
}

type localResumeAIScoreResponse struct {
	Success          bool                       `json:"success"`
	Source           string                     `json:"source"`
	JobDescriptionID string                     `json:"jobDescriptionId"`
	Results          []localResumeAIScoreResult `json:"results"`
	Stats            localResumeAIScoreStats    `json:"stats"`
}

type workflowDatasetVerificationRequest struct {
	APIBaseURL       string
	ConvexURL        string
	Workspace        string
	Query            string
	Location         string
	SourceKey        string
	Limit            int
	Top              int
	JobDescriptionID string
}

type workflowDatasetSourceCountRow struct {
	Key   string `json:"key"`
	Count int    `json:"count"`
}

type workflowDatasetVisibleResumeRow struct {
	ResumeID         string `json:"resumeId"`
	SourceHost       string `json:"sourceHost"`
	SourceKey        string `json:"sourceKey,omitempty"`
	Name             string `json:"name"`
	Location         string `json:"location"`
	PrimaryRuleScore *int   `json:"primaryRuleScore"`
	JobRuleScore     *int   `json:"jobRuleScore"`
	ProfileURL       string `json:"profileUrl,omitempty"`
}

type workflowDatasetVerificationReport struct {
	Query                    string                            `json:"query"`
	Location                 string                            `json:"location,omitempty"`
	SourceKey                string                            `json:"sourceKey,omitempty"`
	Workspace                string                            `json:"workspace"`
	TotalResumeCount         int                               `json:"totalResumeCount"`
	ScannedResumeCount       int                               `json:"scannedResumeCount"`
	DatasetBySourceHost      []workflowDatasetSourceCountRow   `json:"datasetBySourceHost"`
	DatasetBySourceKey       []workflowDatasetSourceCountRow   `json:"datasetBySourceKey"`
	KeywordExpansion         map[string]any                    `json:"keywordExpansion"`
	QueryMatchCount          int                               `json:"queryMatchCount"`
	QueryMatchesBySourceHost []workflowDatasetSourceCountRow   `json:"queryMatchesBySourceHost"`
	QueryMatchesBySourceKey  []workflowDatasetSourceCountRow   `json:"queryMatchesBySourceKey"`
	VisibleCount             int                               `json:"visibleCount"`
	VisibleBySourceHost      []workflowDatasetSourceCountRow   `json:"visibleBySourceHost"`
	VisibleBySourceKey       []workflowDatasetSourceCountRow   `json:"visibleBySourceKey"`
	VisibleResumes           []workflowDatasetVisibleResumeRow `json:"visibleResumes"`
}

type workspaceDemoResumeCleanupRequest struct {
	ConvexURL string
}

type workspaceDemoResumeCleanupResponse struct {
	Success   bool   `json:"success"`
	ConvexURL string `json:"convexUrl"`
	Deleted   int    `json:"deleted"`
	Tag       string `json:"tag"`
}

var runLocalResumeAIScorer = func(ctx context.Context, request localResumeAIScoreRequest) (*localResumeAIScoreResponse, error) {
	projectRoot, err := findProjectRoot()
	if err != nil {
		return nil, err
	}

	input, err := json.Marshal(request)
	if err != nil {
		return nil, fmt.Errorf("marshal local AI scorer request: %w", err)
	}

	scriptPath := filepath.Join(projectRoot, "scripts", "resume", "debug-ai-score.ts")
	stdout, stderr, err := runBunScript(ctx, projectRoot, scriptPath, nil, input)
	if err != nil {
		return nil, fmt.Errorf("run local AI scorer: %w\n%s", err, commandErrorOutput(stdout, stderr))
	}

	var response localResumeAIScoreResponse
	if err := json.Unmarshal([]byte(stdout), &response); err != nil {
		return nil, fmt.Errorf("decode local AI scorer response: %w", err)
	}
	if !response.Success {
		return nil, fmt.Errorf("local AI scorer did not succeed")
	}
	return &response, nil
}

var runWorkspaceDemoResumeCleanup = func(ctx context.Context, request workspaceDemoResumeCleanupRequest) (*workspaceDemoResumeCleanupResponse, error) {
	projectRoot, err := findProjectRoot()
	if err != nil {
		return nil, err
	}

	scriptPath := filepath.Join(projectRoot, "scripts", "resume", "clear-workspace-demo-resumes.ts")
	args := []string{"--json"}
	if value := normalizeBaseURL(request.ConvexURL); value != "" {
		args = append(args, "--convex-url", value)
	}

	stdout, stderr, err := runBunScript(ctx, projectRoot, scriptPath, args, nil)
	if err != nil {
		return nil, fmt.Errorf("run workspace-demo resume cleanup: %w\n%s", err, commandErrorOutput(stdout, stderr))
	}

	var response workspaceDemoResumeCleanupResponse
	if err := json.Unmarshal([]byte(stdout), &response); err != nil {
		return nil, fmt.Errorf("decode workspace-demo resume cleanup response: %w", err)
	}
	return &response, nil
}

var runWorkflowDatasetVerifier = func(ctx context.Context, request workflowDatasetVerificationRequest) (*workflowDatasetVerificationReport, error) {
	projectRoot, err := findProjectRoot()
	if err != nil {
		return nil, err
	}

	scriptPath := filepath.Join(projectRoot, "scripts", "resume", "verify-workflow-dataset.ts")
	args := []string{
		"--query", strings.TrimSpace(request.Query),
		"--workspace", normalizeWorkspace(request.Workspace),
		"--api-base-url", normalizeBaseURL(request.APIBaseURL),
		"--limit", strconv.Itoa(request.Limit),
		"--top", strconv.Itoa(request.Top),
		"--json",
	}
	if value := normalizeBaseURL(request.ConvexURL); value != "" {
		args = append(args, "--convex-url", value)
	}
	if value := strings.TrimSpace(request.Location); value != "" {
		args = append(args, "--location", value)
	}
	if value := strings.ToLower(strings.TrimSpace(request.SourceKey)); value != "" {
		args = append(args, "--source-key", value)
	}
	if value := strings.TrimSpace(request.JobDescriptionID); value != "" {
		args = append(args, "--job-description", value)
	}

	stdout, stderr, err := runBunScript(ctx, projectRoot, scriptPath, args, nil)
	if err != nil {
		return nil, fmt.Errorf("run workflow dataset verifier: %w\n%s", err, commandErrorOutput(stdout, stderr))
	}

	var response workflowDatasetVerificationReport
	if err := json.Unmarshal([]byte(stdout), &response); err != nil {
		return nil, fmt.Errorf("decode workflow dataset verifier response: %w", err)
	}
	return &response, nil
}

func newResumeDebugCmd() *cobra.Command {
	debugCmd := &cobra.Command{
		Use:   "debug",
		Short: "Resume debug and dev-cycle operations",
	}

	debugCmd.AddCommand(
		newResumeDebugMatchesCmd(),
		newResumeDebugMatchRunsCmd(),
		newResumeDebugClearMatchesCmd(),
		newResumeDebugRescoreCmd(),
		newResumeDebugSkillsVersionCmd(),
		newResumeDebugTriggerReingestCmd(),
		newResumeDebugAIScoreCmd(),
		newResumeDebugWorkflowDatasetCmd(),
		newResumeDebugClearDemoResumesCmd(),
	)

	return debugCmd
}

func newResumeDebugMatchesCmd() *cobra.Command {
	var (
		sessionID        string
		jobDescriptionID string
	)

	cmd := &cobra.Command{
		Use:   "matches",
		Short: "Show cached resume matches",
		RunE: func(cmd *cobra.Command, args []string) error {
			if strings.TrimSpace(sessionID) == "" && strings.TrimSpace(jobDescriptionID) == "" {
				return fmt.Errorf("session-id or job-description is required")
			}

			response, err := newAPIClient().ListResumeMatches(context.Background(), sessionID, jobDescriptionID)
			if err != nil {
				return err
			}

			headers := []string{"resume_id", "score", "source", "recommendation", "matched_at", "session_id"}
			rows := make([][]string, 0, len(response.Results))
			for _, result := range response.Results {
				rows = append(rows, []string{
					result.ResumeID,
					strconv.Itoa(result.Score),
					result.ScoreSource,
					result.Recommendation,
					result.MatchedAt,
					result.SessionID,
				})
			}

			return writeOutput(cmd, headers, rows, response)
		},
	}

	cmd.Flags().StringVar(&sessionID, "session-id", "", "Optional session ID")
	cmd.Flags().StringVar(&jobDescriptionID, "job-description", "", "Optional job description ID")
	return cmd
}

func newResumeDebugMatchRunsCmd() *cobra.Command {
	var (
		sessionID        string
		jobDescriptionID string
		limit            int
	)

	cmd := &cobra.Command{
		Use:   "match-runs",
		Short: "Show recent resume match runs",
		RunE: func(cmd *cobra.Command, args []string) error {
			response, err := newAPIClient().ListResumeMatchRuns(context.Background(), client.MatchRunsQuery{
				SessionID:        sessionID,
				JobDescriptionID: jobDescriptionID,
				Limit:            limit,
			})
			if err != nil {
				return err
			}

			headers := []string{"id", "mode", "status", "processed", "total", "failed", "matched", "avg_score"}
			rows := make([][]string, 0, len(response.Runs))
			for _, run := range response.Runs {
				rows = append(rows, []string{
					run.ID,
					run.Mode,
					run.Status,
					strconv.Itoa(run.ProcessedCount),
					strconv.Itoa(run.TotalCount),
					strconv.Itoa(run.FailedCount),
					intPointerString(run.MatchedCount),
					formatOptionalFloat(run.AvgScore),
				})
			}

			return writeOutput(cmd, headers, rows, response)
		},
	}

	cmd.Flags().StringVar(&sessionID, "session-id", "", "Optional session ID")
	cmd.Flags().StringVar(&jobDescriptionID, "job-description", "", "Optional job description ID")
	cmd.Flags().IntVar(&limit, "limit", 20, "Maximum runs to fetch")
	return cmd
}

func newResumeDebugClearMatchesCmd() *cobra.Command {
	var jobDescriptionID string

	cmd := &cobra.Command{
		Use:   "clear-matches",
		Short: "Clear cached resume matches",
		RunE: func(cmd *cobra.Command, args []string) error {
			response, err := newAPIClient().ClearResumeMatches(context.Background(), jobDescriptionID)
			if err != nil {
				return err
			}

			headers := []string{"deleted", "job_description"}
			rows := [][]string{{
				strconv.Itoa(response.Deleted),
				response.JobDescriptionID,
			}}
			return writeOutput(cmd, headers, rows, response)
		},
	}

	cmd.Flags().StringVar(&jobDescriptionID, "job-description", "", "Optional job description ID to clear only one cache scope")
	return cmd
}

func newResumeDebugRescoreCmd() *cobra.Command {
	var (
		query            string
		location         string
		jobDescriptionID string
		sample           string
		source           string
		limit            int
		resumeIDs        []string
	)

	cmd := &cobra.Command{
		Use:   "rescore",
		Short: "Re-score cached/sample matches with the rule engine",
		RunE: func(cmd *cobra.Command, args []string) error {
			keywords := splitQueryKeywords(query)
			if strings.TrimSpace(jobDescriptionID) == "" && len(keywords) == 0 {
				return fmt.Errorf("query or job-description is required")
			}
			if normalizeResumeSourceFlag(source) == "convex" {
				return fmt.Errorf("resume debug rescore only supports --source sample")
			}

			persist := true
			response, err := newAPIClient().RescoreResumeMatches(context.Background(), client.ResumeRescoreRequest{
				Sample:           strings.TrimSpace(sample),
				Source:           source,
				Persist:          &persist,
				JobDescriptionID: strings.TrimSpace(jobDescriptionID),
				Keywords:         keywords,
				Location:         strings.TrimSpace(location),
				ResumeIDs:        resumeIDs,
				Limit:            limit,
			})
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
	cmd.Flags().StringVar(&sample, "sample", "", "Optional sample name")
	cmd.Flags().StringVar(&source, "source", "sample", "Resume source: sample")
	cmd.Flags().IntVar(&limit, "limit", 50, "Maximum resumes to score")
	cmd.Flags().StringSliceVar(&resumeIDs, "resume-id", nil, "Optional specific resume IDs to rescore")
	return cmd
}

func newResumeDebugSkillsVersionCmd() *cobra.Command {
	return &cobra.Command{
		Use:   "skills-version",
		Short: "Show the current resume skills/config version",
		RunE: func(cmd *cobra.Command, args []string) error {
			response, err := newAPIClient().GetResumeSkillsVersion(context.Background())
			if err != nil {
				return err
			}

			headers := []string{"version"}
			rows := [][]string{{strconv.Itoa(response.Version)}}
			return writeOutput(cmd, headers, rows, response)
		},
	}
}

func newResumeDebugTriggerReingestCmd() *cobra.Command {
	var limit int

	cmd := &cobra.Command{
		Use:   "trigger-reingest",
		Short: "Trigger stale-skills-version resume reingest",
		RunE: func(cmd *cobra.Command, args []string) error {
			response, err := newAPIClient().TriggerResumeReingest(context.Background(), limit)
			if err != nil {
				return err
			}

			headers := []string{"scheduled", "batches", "current_version", "has_more"}
			rows := [][]string{{
				strconv.Itoa(response.Scheduled),
				strconv.Itoa(response.Batches),
				strconv.Itoa(response.CurrentVersion),
				fmt.Sprintf("%t", response.HasMore),
			}}
			return writeOutput(cmd, headers, rows, response)
		},
	}

	cmd.Flags().IntVar(&limit, "limit", 200, "Maximum stale resumes to schedule")
	return cmd
}

func newResumeDebugAIScoreCmd() *cobra.Command {
	var (
		query            string
		location         string
		jobDescriptionID string
		source           string
		limit            int
		topN             int
		resumeIDs        []string
	)

	cmd := &cobra.Command{
		Use:   "ai-score",
		Short: "Locally AI-score live Convex candidates for debug work",
		RunE: func(cmd *cobra.Command, args []string) error {
			if normalizeResumeSourceFlag(source) != "convex" {
				return fmt.Errorf("resume debug ai-score only supports --source convex")
			}
			if strings.TrimSpace(jobDescriptionID) == "" && len(splitQueryKeywords(query)) == 0 {
				return fmt.Errorf("query or job-description is required")
			}
			if topN <= 0 {
				topN = limit
			}

			options := currentOptions()
			response, err := runLocalResumeAIScorer(context.Background(), localResumeAIScoreRequest{
				APIURL:           options.APIURL,
				Workspace:        options.Workspace,
				Source:           source,
				Query:            strings.TrimSpace(query),
				Location:         strings.TrimSpace(location),
				JobDescriptionID: strings.TrimSpace(jobDescriptionID),
				ResumeIDs:        resumeIDs,
				Limit:            limit,
				TopN:             topN,
			})
			if err != nil {
				return err
			}

			headers := []string{"resume_id", "ai_score", "rule_score", "recommendation", "name", "location"}
			rows := make([][]string, 0, len(response.Results))
			for _, result := range response.Results {
				rows = append(rows, []string{
					result.ResumeID,
					strconv.Itoa(result.AIScore),
					strconv.Itoa(result.RuleScore),
					result.Recommendation,
					result.Name,
					result.Location,
				})
			}
			return writeOutput(cmd, headers, rows, response)
		},
	}

	cmd.Flags().StringVar(&query, "query", "", "Keyword query used to build the AI scoring prompt")
	cmd.Flags().StringVar(&location, "location", "", "Optional location constraint")
	cmd.Flags().StringVar(&jobDescriptionID, "job-description", "", "Optional job description ID")
	cmd.Flags().StringVar(&source, "source", "convex", "Resume source: convex")
	cmd.Flags().IntVar(&limit, "limit", 50, "Maximum candidates to consider before local AI scoring")
	cmd.Flags().IntVar(&topN, "top-n", 10, "Number of top rule-ranked candidates to AI-score locally")
	cmd.Flags().StringSliceVar(&resumeIDs, "resume-id", nil, "Optional specific Convex resume IDs to AI-score")
	return cmd
}

func newResumeDebugWorkflowDatasetCmd() *cobra.Command {
	var (
		query            string
		location         string
		sourceKey        string
		convexURL        string
		jobDescriptionID string
		limit            int
		top              int
	)

	cmd := &cobra.Command{
		Use:   "workflow-dataset",
		Short: "Verify source mix, query matches, and visible results for a workflow dataset",
		RunE: func(cmd *cobra.Command, args []string) error {
			if strings.TrimSpace(query) == "" {
				return fmt.Errorf("query is required")
			}
			if limit <= 0 {
				return fmt.Errorf("limit must be greater than 0")
			}
			if top <= 0 {
				return fmt.Errorf("top must be greater than 0")
			}

			options := currentOptions()
			report, err := runWorkflowDatasetVerifier(context.Background(), workflowDatasetVerificationRequest{
				APIBaseURL:       options.APIURL,
				ConvexURL:        convexURL,
				Workspace:        options.Workspace,
				Query:            strings.TrimSpace(query),
				Location:         strings.TrimSpace(location),
				SourceKey:        strings.TrimSpace(sourceKey),
				Limit:            limit,
				Top:              top,
				JobDescriptionID: strings.TrimSpace(jobDescriptionID),
			})
			if err != nil {
				return err
			}

			if options.Output == "json" {
				return writeOutput(cmd, nil, nil, report)
			}

			headers := []string{"resume_id", "source_key", "primary_score", "job_score", "name", "location", "source_host"}
			rows := make([][]string, 0, len(report.VisibleResumes))
			for _, resume := range report.VisibleResumes {
				rows = append(rows, []string{
					resume.ResumeID,
					resume.SourceKey,
					intPointerString(resume.PrimaryRuleScore),
					intPointerString(resume.JobRuleScore),
					resume.Name,
					resume.Location,
					resume.SourceHost,
				})
			}

			if options.Output == "table" {
				fmt.Fprintf(
					cmd.OutOrStdout(),
					"Query: %s | Workspace: %s | Query matches: %d | Visible after filters: %d\n",
					report.Query,
					report.Workspace,
					report.QueryMatchCount,
					report.VisibleCount,
				)
				fmt.Fprintf(
					cmd.OutOrStdout(),
					"Dataset by source key: %s\n",
					formatWorkflowDatasetCounts(report.DatasetBySourceKey),
				)
				fmt.Fprintf(
					cmd.OutOrStdout(),
					"Visible by source key: %s\n\n",
					formatWorkflowDatasetCounts(report.VisibleBySourceKey),
				)
			}

			if len(rows) == 0 && options.Output == "table" {
				return writeMessage(cmd, "No visible resumes after workflow filters")
			}
			return writeOutput(cmd, headers, rows, report)
		},
	}

	cmd.Flags().StringVar(&query, "query", "", "Keyword query used by the workflow")
	cmd.Flags().StringVar(&location, "location", "", "Optional location filter")
	cmd.Flags().StringVar(&sourceKey, "source-key", "", "Optional source key filter (for example seek or job5156)")
	cmd.Flags().StringVar(&convexURL, "convex-url", "", "Optional Convex URL override for the verifier")
	cmd.Flags().StringVar(&jobDescriptionID, "job-description", "", "Optional job description ID for score display")
	cmd.Flags().IntVar(&limit, "limit", 200, "Maximum resumes to scan")
	cmd.Flags().IntVar(&top, "top", 10, "Maximum visible resumes to print")
	return cmd
}

func newResumeDebugClearDemoResumesCmd() *cobra.Command {
	var convexURL string

	cmd := &cobra.Command{
		Use:   "clear-demo-resumes",
		Short: "Delete resumes tagged workspace-demo from the target Convex deployment",
		RunE: func(cmd *cobra.Command, args []string) error {
			response, err := runWorkspaceDemoResumeCleanup(context.Background(), workspaceDemoResumeCleanupRequest{
				ConvexURL: convexURL,
			})
			if err != nil {
				return err
			}

			headers := []string{"deleted", "tag", "convex_url"}
			rows := [][]string{{
				strconv.Itoa(response.Deleted),
				response.Tag,
				response.ConvexURL,
			}}
			return writeOutput(cmd, headers, rows, response)
		},
	}

	cmd.Flags().StringVar(&convexURL, "convex-url", "", "Optional Convex URL override for workspace-demo resume cleanup")
	return cmd
}

func formatWorkflowDatasetCounts(rows []workflowDatasetSourceCountRow) string {
	if len(rows) == 0 {
		return "none"
	}

	parts := make([]string, 0, len(rows))
	for _, row := range rows {
		parts = append(parts, fmt.Sprintf("%s:%d", row.Key, row.Count))
	}
	return strings.Join(parts, ", ")
}

func writeResumeMatchTable(cmd *cobra.Command, response *client.ResumeMatchResponse, displayMap map[string]resumeDisplayRow) error {
	if currentOptions().Output == "json" {
		return writeOutput(cmd, nil, nil, response)
	}

	headers := []string{"resume_id", "score", "recommendation", "primary_rule", "sales_years", "company_hits", "name", "location"}
	rows := make([][]string, 0, len(response.Results))
	for _, result := range response.Results {
		display := displayMap[result.ResumeID]
		rows = append(rows, []string{
			result.ResumeID,
			strconv.Itoa(result.Score),
			result.Recommendation,
			formatOptionalFloat(debugPrimaryRuleScore(result.Debug)),
			formatSalesYears(result.Debug),
			strings.Join(debugCompanyHits(result.Debug), ", "),
			display.Name,
			display.Location,
		})
	}

	return writeOutput(cmd, headers, rows, response)
}

func validateResumeMatchRequest(request client.ResumeMatchRequest) error {
	mode := strings.TrimSpace(request.Mode)
	if mode == "" {
		mode = "rules_only"
	}

	if normalizeResumeSourceFlag(request.Source) == "convex" && mode != "rules_only" {
		return fmt.Errorf(
			"source=convex with --mode %s is blocked by /api/resumes/match; use `trends resume debug ai-score ...` for local AI scoring or keep --mode rules_only",
			mode,
		)
	}

	persist := true
	if request.Persist != nil {
		persist = *request.Persist
	}

	if !persist && mode != "rules_only" {
		return fmt.Errorf("mode=%s requires --persist; the API only allows --persist=false with --mode rules_only", mode)
	}
	if normalizeResumeSourceFlag(request.Source) == "convex" && persist {
		return fmt.Errorf("source=convex only supports --persist=false")
	}

	return nil
}
