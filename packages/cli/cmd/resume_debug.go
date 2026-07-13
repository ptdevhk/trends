package cmd

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
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
	FieldCoverage    bool
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

type workflowDatasetFieldCoverageRow struct {
	SourceKey                 string  `json:"sourceKey"`
	ResumeCount               int     `json:"resumeCount"`
	ProfileURLPct             float64 `json:"profileUrlPct"`
	ResumeIDPct               float64 `json:"resumeIdPct"`
	WorkHistoryPct            float64 `json:"workHistoryPct"`
	WorkHistoryDescriptionPct float64 `json:"workHistoryDescriptionPct"`
	ProfileEducationPct       float64 `json:"profileEducationPct"`
	JobIntentionPct           float64 `json:"jobIntentionPct"`
	ExpectedSalaryPct         float64 `json:"expectedSalaryPct"`
	SelfIntroPct              float64 `json:"selfIntroPct"`
	SkillsPct                 float64 `json:"skillsPct"`
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
	FieldCoverageBySource    []workflowDatasetFieldCoverageRow `json:"fieldCoverageBySource,omitempty"`
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

type resumeAnalysisClearRequest struct {
	JobDescriptionID string   `json:"jobDescriptionId,omitempty"`
	ResumeIDs        []string `json:"resumeIds,omitempty"`
	BatchSize        int      `json:"batchSize,omitempty"`
}

type resumeAnalysisClearResponse struct {
	Cleared          int      `json:"cleared"`
	Batches          int      `json:"batches"`
	JobDescriptionID string   `json:"jobDescriptionId,omitempty"`
	ResumeIDs        []string `json:"resumeIds,omitempty"`
	Targeted         bool     `json:"targeted"`
}

type paginatedAnalysisClearBatchResult struct {
	Cleared int
	HasMore bool
	Cursor  *string
}

var clearedFieldPattern = regexp.MustCompile(`(?m)["']?cleared["']?\s*:\s*([0-9]+)`)

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

var runResumeAnalysisClearer = func(ctx context.Context, request resumeAnalysisClearRequest) (*resumeAnalysisClearResponse, error) {
	return runResumeAnalysisClear(ctx, request, runConvexCommand)
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
	if request.FieldCoverage {
		args = append(args, "--field-coverage")
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
		newResumeDebugClearAnalysesCmd(),
		newResumeDebugRescoreCmd(),
		newResumeDebugSkillsVersionCmd(),
		newResumeDebugTriggerReingestCmd(),
		newResumeDebugExactReingestCmd(),
		newResumeDebugAIScoreCmd(),
		newResumeDebugWorkflowDatasetCmd(),
		newResumeDebugDiagnosticsCmd(),
		newResumeDebugClearDemoResumesCmd(),
		newResumeDebugHardResetReingestCmd(),
		newResumeDebugResetDatabaseCmd(),
		newResumeDebugAnalysisTasksCmd(),
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

func newResumeDebugClearAnalysesCmd() *cobra.Command {
	var (
		jobDescriptionID string
		resumeIDs        []string
		dryRun           bool
	)

	cmd := &cobra.Command{
		Use:   "clear-analyses",
		Short: "Clear resume AI analyses",
		RunE: func(cmd *cobra.Command, args []string) error {
			response, err := newAPIClient().ClearAnalysesViaAPI(context.Background(), client.ClearAnalysesAPIRequest{
				JobDescriptionID: strings.TrimSpace(jobDescriptionID),
				ResumeIDs:        normalizeResumeIDList(resumeIDs),
				DryRun:           dryRun,
			})
			if err != nil {
				return err
			}

			if dryRun {
				headers := []string{"would_clear", "targeted", "job_description"}
				rows := [][]string{{
					strconv.Itoa(response.WouldClear),
					fmt.Sprintf("%t", response.Targeted),
					response.JobDescriptionID,
				}}
				return writeOutput(cmd, headers, rows, response)
			}

			headers := []string{"cleared", "batches", "targeted", "job_description"}
			rows := [][]string{{
				strconv.Itoa(response.Cleared),
				strconv.Itoa(response.Batches),
				fmt.Sprintf("%t", response.Targeted),
				response.JobDescriptionID,
			}}
			return writeOutput(cmd, headers, rows, response)
		},
	}

	cmd.Flags().StringVar(&jobDescriptionID, "job-description", "", "Optional job description ID to clear only one analysis scope")
	cmd.Flags().StringSliceVar(&resumeIDs, "resume-id", nil, "Optional specific Convex resume IDs to clear")
	cmd.Flags().BoolVar(&dryRun, "dry-run", false, "Preview the number of analyses that would be cleared without mutating")
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

type exactReingestManifest struct {
	Version int                          `json:"version"`
	Targets []client.ExactReingestTarget `json:"targets"`
}

func hasExactReingestSelector(target client.ExactReingestTarget) bool {
	return strings.TrimSpace(target.CurrentResumeID) != "" ||
		strings.TrimSpace(target.ProfileResumeID) != "" ||
		strings.TrimSpace(target.ProfileURL) != "" ||
		strings.TrimSpace(target.ExternalID) != "" ||
		strings.TrimSpace(target.IdentityKey) != ""
}

func isPlaceholderExactReingestExternalIdentity(value string) bool {
	normalized := strings.ToLower(strings.TrimSpace(value))
	return normalized == "unknown" || normalized == "externalid:unknown"
}

func validateExactReingestTarget(target client.ExactReingestTarget, index int) error {
	if isPlaceholderExactReingestExternalIdentity(target.ExternalID) {
		return fmt.Errorf("exact reingest manifest target %d has a placeholder external ID", index+1)
	}
	if isPlaceholderExactReingestExternalIdentity(target.IdentityKey) {
		return fmt.Errorf("exact reingest manifest target %d has a placeholder external identity key", index+1)
	}
	if !hasExactReingestSelector(target) {
		return fmt.Errorf("exact reingest manifest target %d is missing a stable selector or current resume ID", index+1)
	}
	return nil
}

func decodeStrictExactReingestJSON(content []byte, destination any) error {
	decoder := json.NewDecoder(bytes.NewReader(content))
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(destination); err != nil {
		return err
	}
	if err := decoder.Decode(&struct{}{}); err != io.EOF {
		if err == nil {
			return fmt.Errorf("multiple JSON values are not allowed")
		}
		return err
	}
	return nil
}

func readExactReingestManifest(path string) ([]client.ExactReingestTarget, error) {
	resolvedPath, err := filepath.Abs(strings.TrimSpace(path))
	if err != nil {
		return nil, fmt.Errorf("resolve exact reingest manifest path: %w", err)
	}
	content, err := os.ReadFile(resolvedPath)
	if err != nil {
		return nil, fmt.Errorf("read exact reingest manifest: %w", err)
	}

	trimmed := bytes.TrimSpace(content)
	if len(trimmed) == 0 {
		return nil, fmt.Errorf("decode exact reingest manifest: empty document")
	}

	var manifest exactReingestManifest
	if trimmed[0] == '[' {
		var targets []client.ExactReingestTarget
		if err := decodeStrictExactReingestJSON(trimmed, &targets); err != nil {
			return nil, fmt.Errorf("decode exact reingest manifest: %w", err)
		}
		manifest = exactReingestManifest{Version: 1, Targets: targets}
	} else if err := decodeStrictExactReingestJSON(trimmed, &manifest); err != nil {
		return nil, fmt.Errorf("decode exact reingest manifest: %w", err)
	}
	if manifest.Version != 1 {
		return nil, fmt.Errorf("unsupported exact reingest manifest version %d", manifest.Version)
	}
	if len(manifest.Targets) == 0 {
		return nil, fmt.Errorf("exact reingest manifest contains no targets")
	}
	for index, target := range manifest.Targets {
		if err := validateExactReingestTarget(target, index); err != nil {
			return nil, err
		}
	}
	return manifest.Targets, nil
}

func waitForExactReingestReadiness(
	ctx context.Context,
	apiClient *client.Client,
	response *client.ExactReingestResponse,
	timeout time.Duration,
	pollInterval time.Duration,
) (*client.ExactReingestReadinessResponse, error) {
	if response.DispatchedAt <= 0 {
		return nil, fmt.Errorf("exact reingest response is missing dispatchedAt")
	}
	if timeout <= 0 || pollInterval <= 0 {
		return nil, fmt.Errorf("wait-timeout and poll-interval must be positive")
	}

	waitCtx, cancel := context.WithTimeout(ctx, timeout)
	defer cancel()
	request := client.ExactReingestReadinessRequest{
		ResumeIDs:             response.ResumeIDs,
		DispatchedAt:          response.DispatchedAt,
		ExpectedSkillsVersion: response.ExpectedSkillsVersion,
	}
	for {
		readiness, err := apiClient.GetExactResumeReingestReadiness(waitCtx, request)
		if err != nil {
			return nil, err
		}
		if readiness.Invalid > 0 {
			return nil, fmt.Errorf("exact reingest readiness found %d invalid targets", readiness.Invalid)
		}
		if readiness.AllReady {
			return readiness, nil
		}

		timer := time.NewTimer(pollInterval)
		select {
		case <-waitCtx.Done():
			timer.Stop()
			return nil, fmt.Errorf(
				"exact reingest readiness timed out with %d ready and %d pending targets: %w",
				readiness.Ready,
				readiness.Pending,
				waitCtx.Err(),
			)
		case <-timer.C:
		}
	}
}

func newResumeDebugExactReingestCmd() *cobra.Command {
	var (
		resumeIDs    []string
		manifestPath string
		yes          bool
		dryRun       bool
		wait         bool
		waitTimeout  time.Duration
		pollInterval time.Duration
	)

	cmd := &cobra.Command{
		Use:   "reingest",
		Short: "Resolve and re-ingest an exact resume cohort",
		RunE: func(cmd *cobra.Command, args []string) error {
			if !yes && !dryRun {
				return fmt.Errorf("live exact reingest requires --yes; use --dry-run to resolve and preview")
			}
			if wait && dryRun {
				return fmt.Errorf("--wait requires a live exact reingest; it cannot be used with --dry-run")
			}

			targets := make([]client.ExactReingestTarget, 0, len(resumeIDs))
			if strings.TrimSpace(manifestPath) != "" {
				manifestTargets, err := readExactReingestManifest(manifestPath)
				if err != nil {
					return err
				}
				targets = append(targets, manifestTargets...)
			}
			for _, resumeID := range resumeIDs {
				trimmed := strings.TrimSpace(resumeID)
				if trimmed != "" {
					targets = append(targets, client.ExactReingestTarget{CurrentResumeID: trimmed})
				}
			}
			if len(targets) == 0 {
				return fmt.Errorf("exact reingest requires --manifest and/or at least one --resume-id")
			}

			apiClient := newAPIClient()
			response, err := apiClient.ExactResumeReingest(cmd.Context(), client.ExactReingestRequest{
				Targets: targets,
				DryRun:  dryRun,
			})
			if err != nil {
				return err
			}
			if wait {
				readiness, err := waitForExactReingestReadiness(
					cmd.Context(),
					apiClient,
					response,
					waitTimeout,
					pollInterval,
				)
				if err != nil {
					return err
				}
				response.Readiness = readiness
			}

			headers := []string{
				"reference_id",
				"current_id",
				"profile_resume_id",
				"external_id",
				"identity_key",
				"scheduled",
				"batches",
				"skills_version",
				"readiness",
			}
			readinessByResumeID := make(map[string]string)
			if response.Readiness != nil {
				for _, target := range response.Readiness.Targets {
					readinessByResumeID[target.CurrentResumeID] = target.State
				}
			}
			rows := make([][]string, 0, len(response.Targets))
			for _, target := range response.Targets {
				rows = append(rows, []string{
					target.ReferenceResumeID,
					target.CurrentResumeID,
					target.ProfileResumeID,
					target.ExternalID,
					target.CanonicalIdentityKey,
					strconv.Itoa(response.Scheduled),
					strconv.Itoa(response.Batches),
					strconv.Itoa(response.ExpectedSkillsVersion),
					readinessByResumeID[target.CurrentResumeID],
				})
			}
			return writeOutput(cmd, headers, rows, response)
		},
	}

	cmd.Flags().StringArrayVar(&resumeIDs, "resume-id", nil, "Current Convex resume ID to include (repeatable)")
	cmd.Flags().StringVar(&manifestPath, "manifest", "", "Path to a version-1 exact reingest JSON manifest")
	cmd.Flags().BoolVar(&yes, "yes", false, "Confirm live exact reingest scheduling")
	cmd.Flags().BoolVar(&dryRun, "dry-run", false, "Resolve and preview targets without scheduling")
	cmd.Flags().BoolVar(&wait, "wait", false, "Wait for every scheduled target to persist the expected ingest evidence")
	cmd.Flags().DurationVar(&waitTimeout, "wait-timeout", 10*time.Minute, "Maximum time to wait for target readiness")
	cmd.Flags().DurationVar(&pollInterval, "poll-interval", 2*time.Second, "Interval between target readiness checks")
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
	cmd.Flags().IntVar(&topN, "top-n", 50, "Number of top rule-ranked candidates to AI-score locally")
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
		fieldCoverage    bool
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
				FieldCoverage:    fieldCoverage,
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

			switch options.Output {
			case "table":
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
			case "agent":
				if err := writeAgentSummary(cmd, []output.Field{
					{Key: "query", Value: report.Query},
					{Key: "workspace", Value: report.Workspace},
					{Key: "query_matches", Value: strconv.Itoa(report.QueryMatchCount)},
					{Key: "visible", Value: strconv.Itoa(report.VisibleCount)},
				}); err != nil {
					return err
				}
				if err := writeAgentFields(cmd, []output.Field{
					{Key: "kind", Value: "dataset_counts"},
					{Key: "scope", Value: "dataset"},
					{Key: "counts", Value: formatWorkflowDatasetCounts(report.DatasetBySourceKey)},
				}); err != nil {
					return err
				}
				if err := writeAgentFields(cmd, []output.Field{
					{Key: "kind", Value: "dataset_counts"},
					{Key: "scope", Value: "visible"},
					{Key: "counts", Value: formatWorkflowDatasetCounts(report.VisibleBySourceKey)},
				}); err != nil {
					return err
				}
			}

			if fieldCoverage && len(report.FieldCoverageBySource) > 0 {
				coverageHeaders := []string{
					"source_key",
					"count",
					"profile_url",
					"resume_id",
					"work_history",
					"work_history_desc",
					"profile_education",
					"job_intention",
					"expected_salary",
					"self_intro",
					"skills",
				}
				coverageRows := make([][]string, 0, len(report.FieldCoverageBySource))
				for _, row := range report.FieldCoverageBySource {
					coverageRows = append(coverageRows, []string{
						row.SourceKey,
						strconv.Itoa(row.ResumeCount),
						formatWorkflowDatasetCoveragePercent(row.ProfileURLPct),
						formatWorkflowDatasetCoveragePercent(row.ResumeIDPct),
						formatWorkflowDatasetCoveragePercent(row.WorkHistoryPct),
						formatWorkflowDatasetCoveragePercent(row.WorkHistoryDescriptionPct),
						formatWorkflowDatasetCoveragePercent(row.ProfileEducationPct),
						formatWorkflowDatasetCoveragePercent(row.JobIntentionPct),
						formatWorkflowDatasetCoveragePercent(row.ExpectedSalaryPct),
						formatWorkflowDatasetCoveragePercent(row.SelfIntroPct),
						formatWorkflowDatasetCoveragePercent(row.SkillsPct),
					})
				}

				if options.Output == "agent" {
					coverageHeaders = append([]string{"kind"}, coverageHeaders...)
					for i := range coverageRows {
						coverageRows[i] = append([]string{"field_coverage"}, coverageRows[i]...)
					}
				} else if options.Output == "table" {
					fmt.Fprintln(cmd.OutOrStdout(), "Field coverage by source:")
				}

				if err := writeOutput(cmd, coverageHeaders, coverageRows, report.FieldCoverageBySource); err != nil {
					return err
				}
				if options.Output == "table" {
					fmt.Fprintln(cmd.OutOrStdout())
				}
			}

			if len(rows) == 0 && (options.Output == "table" || options.Output == "agent") {
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
	cmd.Flags().BoolVar(&fieldCoverage, "field-coverage", false, "Include source-level field coverage percentages")
	return cmd
}

func newResumeDebugDiagnosticsCmd() *cobra.Command {
	var (
		archived   bool
		sourceKeys []string
		limit      int
	)

	cmd := &cobra.Command{
		Use:   "diagnostics",
		Short: "List ingest/archive diagnostics rows with optional source-key filters",
		RunE: func(cmd *cobra.Command, args []string) error {
			response, err := newAPIClient().ListResumeDiagnostics(context.Background(), client.ResumeDiagnosticsQuery{
				Archived:   archived,
				SourceKeys: sourceKeys,
				Limit:      limit,
			})
			if err != nil {
				return err
			}

			headers := []string{"resume_id", "source_key", "source_host", "name", "intention", "location", "archived"}
			rows := make([][]string, 0, len(response.Data))
			for _, item := range response.Data {
				rows = append(rows, []string{
					item.ResumeID,
					item.SourceKey,
					item.Source,
					item.Name,
					item.JobIntention,
					item.Location,
					strconv.FormatBool(item.IsArchived),
				})
			}

			if currentOptions().Output == "table" {
				fmt.Fprintf(
					cmd.OutOrStdout(),
					"Diagnostics summary: archived=%t sourceKeys=%s returned=%d limit=%d\n\n",
					response.Summary.Archived,
					strings.Join(response.Summary.SourceKeys, ","),
					response.Summary.Returned,
					response.Summary.Limit,
				)
			}

			return writeOutput(cmd, headers, rows, response)
		},
	}

	cmd.Flags().BoolVar(&archived, "archived", false, "List archived resumes instead of active ingest rows")
	cmd.Flags().StringArrayVar(&sourceKeys, "source-key", nil, "Source key filter (repeatable): job5156|51job|seek|51job-manual|unknown")
	cmd.Flags().IntVar(&limit, "limit", 100, "Maximum diagnostics rows to return")
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

func newResumeDebugHardResetReingestCmd() *cobra.Command {
	var (
		yes    bool
		dryRun bool
	)

	cmd := &cobra.Command{
		Use:   "hard-reset-reingest",
		Short: "Clear all computed ingest and AI analysis data, then schedule a full background re-ingest",
		RunE: func(cmd *cobra.Command, args []string) error {
			if !yes && !dryRun {
				return fmt.Errorf("this operation is destructive and irreversible; use --yes to confirm or --dry-run to preview")
			}

			response, err := newAPIClient().HardResetReingest(context.Background(), client.HardResetReingestRequest{
				DryRun: dryRun,
			})
			if err != nil {
				return err
			}

			if dryRun {
				headers := []string{"would_clear", "phase"}
				rows := [][]string{{
					strconv.Itoa(response.WouldClear),
					response.Phase,
				}}
				return writeOutput(cmd, headers, rows, response)
			}

			headers := []string{"cleared", "scheduled", "batches", "phase"}
			rows := [][]string{{
				strconv.Itoa(response.Cleared),
				strconv.Itoa(response.Scheduled),
				strconv.Itoa(response.Batches),
				response.Phase,
			}}
			return writeOutput(cmd, headers, rows, response)
		},
	}

	cmd.Flags().BoolVar(&yes, "yes", false, "Confirm the destructive operation")
	cmd.Flags().BoolVar(&dryRun, "dry-run", false, "Preview the number of resumes that would be affected without mutating")
	return cmd
}

func newResumeDebugResetDatabaseCmd() *cobra.Command {
	var (
		yes    bool
		dryRun bool
	)

	cmd := &cobra.Command{
		Use:   "reset-database",
		Short: "Delete ALL resume, JD, search profile, and screening data from the database",
		RunE: func(cmd *cobra.Command, args []string) error {
			if !yes && !dryRun {
				return fmt.Errorf("this operation is destructive and irreversible; use --yes to confirm or --dry-run to preview")
			}

			response, err := newAPIClient().ResetDatabase(context.Background(), client.ResetDatabaseRequest{
				DryRun: dryRun,
			})
			if err != nil {
				return err
			}

			if dryRun {
				var tableParts []string
				for table, count := range response.WouldDelete {
					tableParts = append(tableParts, fmt.Sprintf("%s:%d", table, count))
				}
				headers := []string{"would_delete_total", "tables"}
				rows := [][]string{{
					strconv.Itoa(response.Count),
					strings.Join(tableParts, ", "),
				}}
				return writeOutput(cmd, headers, rows, response)
			}

			var tableParts []string
			for table, count := range response.Deleted {
				tableParts = append(tableParts, fmt.Sprintf("%s:%d", table, count))
			}
			headers := []string{"deleted_total", "partial", "tables"}
			rows := [][]string{{
				strconv.Itoa(response.Count),
				fmt.Sprintf("%t", response.Partial),
				strings.Join(tableParts, ", "),
			}}
			return writeOutput(cmd, headers, rows, response)
		},
	}

	cmd.Flags().BoolVar(&yes, "yes", false, "Confirm the destructive operation")
	cmd.Flags().BoolVar(&dryRun, "dry-run", false, "Preview the table counts that would be deleted without mutating")
	return cmd
}

func runResumeAnalysisClear(ctx context.Context, request resumeAnalysisClearRequest, runner convexRunner) (*resumeAnalysisClearResponse, error) {
	normalizedResumeIDs := normalizeResumeIDList(request.ResumeIDs)
	normalizedJobDescriptionID := strings.TrimSpace(request.JobDescriptionID)

	if len(normalizedResumeIDs) > 0 {
		payload, err := buildResumeAnalysisClearPayload(normalizedJobDescriptionID, normalizedResumeIDs, request.BatchSize, nil)
		if err != nil {
			return nil, err
		}

		output, err := runner(ctx, "resumes:clearAnalyses", payload)
		if err != nil {
			return nil, err
		}

		batch, err := parseResumeAnalysisClearBatch(output)
		if err != nil {
			return nil, err
		}

		return &resumeAnalysisClearResponse{
			Cleared:          batch.Cleared,
			Batches:          1,
			JobDescriptionID: normalizedJobDescriptionID,
			ResumeIDs:        normalizedResumeIDs,
			Targeted:         true,
		}, nil
	}

	totalCleared := 0
	batches := 0
	cursor := (*string)(nil)

	for iteration := 0; iteration < maxPaginatedMigrationIterations; iteration += 1 {
		payload, err := buildResumeAnalysisClearPayload(normalizedJobDescriptionID, nil, request.BatchSize, cursor)
		if err != nil {
			return nil, err
		}

		output, err := runner(ctx, "resumes:clearAnalyses", payload)
		if err != nil {
			return nil, err
		}

		batch, err := parseResumeAnalysisClearBatch(output)
		if err != nil {
			return nil, err
		}

		totalCleared += batch.Cleared
		batches += 1

		if !batch.HasMore {
			return &resumeAnalysisClearResponse{
				Cleared:          totalCleared,
				Batches:          batches,
				JobDescriptionID: normalizedJobDescriptionID,
				Targeted:         false,
			}, nil
		}

		if batch.Cursor == nil || strings.TrimSpace(*batch.Cursor) == "" {
			return nil, fmt.Errorf("resumes:clearAnalyses returned hasMore without a follow-up cursor")
		}
		cursor = batch.Cursor
	}

	return nil, fmt.Errorf("resumes:clearAnalyses exceeded maximum pagination iterations (%d)", maxPaginatedMigrationIterations)
}

func buildResumeAnalysisClearPayload(jobDescriptionID string, resumeIDs []string, batchSize int, cursor *string) (string, error) {
	payload := map[string]any{}
	if trimmed := strings.TrimSpace(jobDescriptionID); trimmed != "" {
		payload["jobDescriptionId"] = trimmed
	}
	if len(resumeIDs) > 0 {
		payload["resumeIds"] = resumeIDs
	} else {
		payload["batchSize"] = normalizeMigrationLimit(batchSize)
		if cursor != nil && strings.TrimSpace(*cursor) != "" {
			payload["cursor"] = *cursor
		}
	}

	encoded, err := json.Marshal(payload)
	if err != nil {
		return "", err
	}
	return string(encoded), nil
}

func parseResumeAnalysisClearBatch(output string) (paginatedAnalysisClearBatchResult, error) {
	trimmed := strings.TrimSpace(output)
	if trimmed == "" {
		return paginatedAnalysisClearBatchResult{}, fmt.Errorf("empty resume analysis clear output")
	}

	var decoded struct {
		Cleared int     `json:"cleared"`
		HasMore bool    `json:"hasMore"`
		Cursor  *string `json:"cursor"`
	}
	if err := json.Unmarshal([]byte(trimmed), &decoded); err == nil {
		return paginatedAnalysisClearBatchResult{
			Cleared: decoded.Cleared,
			HasMore: decoded.HasMore,
			Cursor:  decoded.Cursor,
		}, nil
	}

	cleared, ok := extractRegexInt(trimmed, clearedFieldPattern)
	if !ok {
		return paginatedAnalysisClearBatchResult{}, fmt.Errorf("unable to parse cleared from %q", trimmed)
	}
	hasMore, ok := extractRegexBool(trimmed, hasMoreFieldPattern)
	if !ok {
		return paginatedAnalysisClearBatchResult{}, fmt.Errorf("unable to parse hasMore from %q", trimmed)
	}
	cursor, ok := extractRegexNullableString(trimmed, cursorFieldPattern)
	if !ok && hasMore {
		return paginatedAnalysisClearBatchResult{}, fmt.Errorf("unable to parse cursor from %q", trimmed)
	}

	return paginatedAnalysisClearBatchResult{
		Cleared: cleared,
		HasMore: hasMore,
		Cursor:  cursor,
	}, nil
}

func normalizeResumeIDList(values []string) []string {
	seen := make(map[string]struct{}, len(values))
	normalized := make([]string, 0, len(values))
	for _, value := range values {
		trimmed := strings.TrimSpace(value)
		if trimmed == "" {
			continue
		}
		if _, exists := seen[trimmed]; exists {
			continue
		}
		seen[trimmed] = struct{}{}
		normalized = append(normalized, trimmed)
	}
	return normalized
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

func formatWorkflowDatasetCoveragePercent(value float64) string {
	return fmt.Sprintf("%.1f%%", value)
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

func newResumeDebugAnalysisTasksCmd() *cobra.Command {
	cmd := &cobra.Command{
		Use:   "analysis-tasks",
		Short: "List recent AI analysis tasks and their status",
		Args:  cobra.NoArgs,
		RunE: func(cmd *cobra.Command, args []string) error {
			response, err := newAPIClient().ListAnalysisTasks(context.Background())
			if err != nil {
				return err
			}

			if currentOptions().Output == "json" {
				return writeOutput(cmd, nil, nil, response)
			}

			return writeAnalysisTasksTable(cmd, response)
		},
	}

	return cmd
}

func writeAnalysisTasksTable(cmd *cobra.Command, response *client.AnalysisTasksResponse) error {
	if len(response.Tasks) == 0 {
		return writeMessage(cmd, "No analysis tasks found.")
	}

	headers := []string{"task_id", "status", "progress_current", "progress_total", "skipped", "label", "location", "analyzed", "avg_score", "error"}
	rows := make([][]string, 0, len(response.Tasks))
	for _, task := range response.Tasks {
		label := analysisTaskLabel(task)
		progressCurrent := ""
		progressTotal := ""
		skipped := "0"
		if task.Progress != nil {
			progressCurrent = strconv.Itoa(task.Progress.Current)
			progressTotal = strconv.Itoa(task.Progress.Total)
			skipped = strconv.Itoa(task.Progress.Skipped)
		}
		analyzed := ""
		avgScore := ""
		if task.Results != nil && task.Status == "completed" {
			analyzed = strconv.Itoa(task.Results.Analyzed)
			avgScore = strconv.FormatFloat(task.Results.AvgScore, 'f', 0, 64)
		}
		location := ""
		if task.Config != nil {
			location = task.Config.Location
		}
		rows = append(rows, []string{
			task.ID,
			task.Status,
			progressCurrent,
			progressTotal,
			skipped,
			label,
			location,
			analyzed,
			avgScore,
			task.Error,
		})
	}
	return writeOutput(cmd, headers, rows, response)
}

func analysisTaskLabel(task client.AnalysisTask) string {
	if task.Config == nil {
		return task.ID
	}
	if task.Config.JobDescriptionTitle != "" {
		return task.Config.JobDescriptionTitle
	}
	if len(task.Config.Keywords) > 0 {
		return strings.Join(task.Config.Keywords, ", ")
	}
	if task.Config.JobDescriptionID != "" {
		return task.Config.JobDescriptionID
	}
	return task.ID
}
