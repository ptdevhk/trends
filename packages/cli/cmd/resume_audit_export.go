package cmd

import (
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/csv"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"strconv"

	"github.com/ptdevhk/trends/packages/cli/internal/client"
	"github.com/spf13/cobra"
)

const exactTaskAuditPageSize = 200

var exactTaskAuditCSVHeaders = []string{
	"Current Convex Resume ID",
	"Canonical Identity Key",
	"External ID",
	"Profile Resume ID",
	"Profile URL",
	"Source",
	"Source Key",
	"Workspace",
	"Name",
	"Age",
	"Location",
	"Analysis Task ID",
	"Analysis Task Status",
	"Analysis Task Workspace",
	"Analysis Task Dispatched At",
	"Analysis Task Completed At",
	"Expected Analysis ID",
	"Expected Prompt Version",
	"Expected Analysis Key",
	"Exact Cohort Member",
	"Analysis State",
	"Analysis Reasons",
	"Current Analysis Key",
	"Current Job Description ID",
	"Current Prompt Version",
	"Current Analysis Locale",
	"Current Query Location",
	"Current Analyzed At",
	"Final AI Score",
	"Current Recommendation",
	"Current Breakdown",
	"Related Exp Audit Factor",
	"Related Exp Contribution",
	"Industry DB",
	"Current AI Summary",
	"Current Highlights",
	"Current Concerns",
	"Current Key Factors",
	"Evidence Band Max",
	"Related Exp Coverage",
	"Missing Reasons",
	"Effective Related Exp",
	"LLM Related Exp",
	"Recommendation Max",
	"Related Exp Context Hash",
	"Related Exp Rubric Version",
	"Brand Hits",
	"Brand Origin",
	"Product Class",
	"Company Hits",
	"Role Evidence",
	"Matched Work Entries",
	"Evidence Text",
	"Market",
	"Rule Scores",
	"Rule Score",
}

var exactTaskAuditStates = map[string]struct{}{
	"ready":                    {},
	"not_targeted":             {},
	"cold_row_missing":         {},
	"analysis_map_missing":     {},
	"analysis_key_missing":     {},
	"job_description_mismatch": {},
	"prompt_version_mismatch":  {},
	"timestamp_missing":        {},
	"not_newer_than_dispatch":  {},
}

type exactTaskAuditExportResult struct {
	Count         int
	File          string
	Bytes         int
	SHA256        string
	Mode          string
	Task          client.ExactTaskAuditMetadata
	CohortMembers int
	Ready         int
}

func exactTaskAuditMetadataEqual(left, right client.ExactTaskAuditMetadata) bool {
	return left == right
}

func validateExactTaskAuditMetadata(
	metadata client.ExactTaskAuditMetadata,
	requestedTaskID string,
	workspaceSlug string,
) error {
	if metadata.TaskID != requestedTaskID ||
		metadata.Status != "completed" ||
		metadata.DispatchMode != "exact" ||
		metadata.WorkspaceSlug != workspaceSlug ||
		metadata.DispatchedAt == 0 ||
		metadata.CompletedAt == 0 ||
		metadata.ExpectedJobDescriptionID == "" ||
		metadata.ExpectedPromptVersion < 1 ||
		metadata.TargetCount < 1 {
		return fmt.Errorf("malformed exact task audit export page: invalid task metadata")
	}
	return nil
}

func hasExactTaskAuditScoreEvidence(row client.ExactTaskAuditRow) bool {
	return row.FinalAIScore != nil ||
		row.CurrentRecommendation != "" ||
		row.CurrentBreakdown != nil ||
		row.RelatedExpAuditFactor != nil ||
		row.RelatedExpContribution != nil ||
		row.IndustryDBContribution != nil ||
		row.CurrentAISummary != "" ||
		row.CurrentHighlights != nil ||
		row.CurrentConcerns != nil ||
		row.CurrentKeyFactors != nil ||
		row.EvidenceBandMax != nil ||
		row.RelatedExpCoverage != "" ||
		row.MissingReasons != nil ||
		row.EffectiveRelatedExp != nil ||
		row.LLMRelatedExp != nil ||
		row.RecommendationMax != nil ||
		row.RelatedExpContextHash != "" ||
		row.RelatedExpRubricVersion != ""
}

func hasExactTaskAuditReasonStateConsistency(row client.ExactTaskAuditRow) bool {
	if row.AnalysisState == "ready" {
		return len(row.AnalysisReasons) == 0
	}
	if row.AnalysisState == "not_targeted" {
		return len(row.AnalysisReasons) == 1 && row.AnalysisReasons[0] == "not_targeted"
	}
	if len(row.AnalysisReasons) == 0 || row.AnalysisReasons[0] != row.AnalysisState {
		return false
	}
	for _, reason := range row.AnalysisReasons {
		if reason == "ready" || reason == "not_targeted" {
			return false
		}
	}
	return true
}

func validateExactTaskAuditPage(
	page *client.ExactTaskAuditPageResponse,
	metadata client.ExactTaskAuditMetadata,
	seenResumeIDs map[string]struct{},
) error {
	if page == nil || !page.Success {
		return fmt.Errorf("malformed exact task audit export page: unsuccessful response")
	}
	if !exactTaskAuditMetadataEqual(page.Task, metadata) {
		return fmt.Errorf("exact task audit export task metadata changed between pages")
	}
	if page.Counts.Scanned < 0 ||
		page.Counts.Exported < 0 ||
		page.Counts.Targeted < 0 ||
		page.Counts.Ready < 0 ||
		page.Counts.Scanned < page.Counts.Exported ||
		page.Counts.Exported != len(page.Page) {
		return fmt.Errorf("malformed exact task audit export page: count mismatch")
	}

	targeted := 0
	ready := 0
	pageResumeIDs := make(map[string]struct{}, len(page.Page))
	for _, row := range page.Page {
		if row.CurrentResumeID == "" || row.CanonicalIdentityKey == "" || row.Source == "" || row.SourceKey == "" {
			return fmt.Errorf("malformed exact task audit export page: incomplete resume identity")
		}
		if _, known := exactTaskAuditStates[row.AnalysisState]; !known {
			return fmt.Errorf("malformed exact task audit export page: unknown analysis state %q", row.AnalysisState)
		}
		if !hasExactTaskAuditReasonStateConsistency(row) {
			return fmt.Errorf("malformed exact task audit export page: analysis reason/state mismatch")
		}
		if row.TaskID != metadata.TaskID ||
			row.TaskStatus != metadata.Status ||
			row.TaskWorkspaceSlug != metadata.WorkspaceSlug ||
			row.WorkspaceSlug != metadata.WorkspaceSlug ||
			row.TaskDispatchedAt != metadata.DispatchedAt ||
			row.TaskCompletedAt != metadata.CompletedAt ||
			row.ExpectedJobDescriptionID != metadata.ExpectedJobDescriptionID ||
			row.ExpectedPromptVersion != metadata.ExpectedPromptVersion ||
			row.ExpectedAnalysisKey == "" {
			return fmt.Errorf("malformed exact task audit export page: row task provenance mismatch")
		}
		if row.ExactCohortMember {
			targeted++
			if row.AnalysisState == "not_targeted" {
				return fmt.Errorf("malformed exact task audit export page: targeted row marked not_targeted")
			}
		} else if row.AnalysisState != "not_targeted" {
			return fmt.Errorf("malformed exact task audit export page: non-target row has task analysis state")
		}
		if row.AnalysisState != "ready" && hasExactTaskAuditScoreEvidence(row) {
			return fmt.Errorf("malformed exact task audit export page: non-ready row includes score evidence")
		}
		if row.AnalysisState == "ready" {
			ready++
			if !row.ExactCohortMember ||
				row.CurrentAnalysisKey != row.ExpectedAnalysisKey ||
				row.CurrentJobDescriptionID != metadata.ExpectedJobDescriptionID ||
				row.CurrentPromptVersion == nil || *row.CurrentPromptVersion != metadata.ExpectedPromptVersion ||
				row.CurrentAnalyzedAt == nil || *row.CurrentAnalyzedAt <= metadata.DispatchedAt ||
				row.FinalAIScore == nil ||
				len(row.AnalysisReasons) != 0 {
				return fmt.Errorf("malformed exact task audit export page: ready row provenance mismatch")
			}
		}
		if _, duplicate := pageResumeIDs[row.CurrentResumeID]; duplicate {
			return fmt.Errorf("duplicate resume ID %q within audit export page", row.CurrentResumeID)
		}
		if _, duplicate := seenResumeIDs[row.CurrentResumeID]; duplicate {
			return fmt.Errorf("duplicate resume ID %q across audit export pages", row.CurrentResumeID)
		}
		pageResumeIDs[row.CurrentResumeID] = struct{}{}
	}
	if targeted != page.Counts.Targeted || ready != page.Counts.Ready {
		return fmt.Errorf("malformed exact task audit export page: cohort count mismatch")
	}
	for resumeID := range pageResumeIDs {
		seenResumeIDs[resumeID] = struct{}{}
	}
	return nil
}

func collectExactTaskAuditRows(
	ctx context.Context,
	apiClient *client.Client,
	taskID string,
) ([]client.ExactTaskAuditRow, client.ExactTaskAuditMetadata, int, int, error) {
	var metadata client.ExactTaskAuditMetadata
	rows := make([]client.ExactTaskAuditRow, 0)
	seenResumeIDs := make(map[string]struct{})
	seenCursors := make(map[string]struct{})
	cursor := ""
	cohortMembers := 0
	ready := 0
	firstPage := true

	for {
		page, err := apiClient.GetExactTaskAuditExportPage(ctx, taskID, cursor, exactTaskAuditPageSize)
		if err != nil {
			return nil, metadata, 0, 0, err
		}
		if firstPage {
			metadata = page.Task
			if err := validateExactTaskAuditMetadata(metadata, taskID, apiClient.Workspace); err != nil {
				return nil, metadata, 0, 0, err
			}
			firstPage = false
		}
		if err := validateExactTaskAuditPage(page, metadata, seenResumeIDs); err != nil {
			return nil, metadata, 0, 0, err
		}
		rows = append(rows, page.Page...)
		cohortMembers += page.Counts.Targeted
		ready += page.Counts.Ready

		if page.IsDone {
			break
		}
		nextCursor := page.ContinueCursor
		if nextCursor == "" {
			return nil, metadata, 0, 0, fmt.Errorf("malformed exact task audit export page: missing continuation cursor")
		}
		if nextCursor == cursor {
			return nil, metadata, 0, 0, fmt.Errorf("repeated cursor %q in exact task audit export", nextCursor)
		}
		if _, repeated := seenCursors[nextCursor]; repeated {
			return nil, metadata, 0, 0, fmt.Errorf("repeated cursor %q in exact task audit export", nextCursor)
		}
		seenCursors[nextCursor] = struct{}{}
		cursor = nextCursor
	}

	if len(rows) == 0 {
		return nil, metadata, 0, 0, fmt.Errorf(
			"completed exact task audit export contains no active workspace resumes; server did not explicitly prove zero active rows",
		)
	}

	return rows, metadata, cohortMembers, ready, nil
}

func auditJSONCell(value any) (string, error) {
	encoded, err := json.Marshal(value)
	if err != nil {
		return "", err
	}
	if bytes.Equal(encoded, []byte("null")) {
		return "", nil
	}
	return string(encoded), nil
}

func auditRawScalarCell(value json.RawMessage) (string, error) {
	if len(value) == 0 || bytes.Equal(value, []byte("null")) {
		return "", nil
	}
	var text string
	if err := json.Unmarshal(value, &text); err == nil {
		return text, nil
	}
	var number json.Number
	if err := json.Unmarshal(value, &number); err == nil {
		return number.String(), nil
	}
	return "", fmt.Errorf("unsupported audit scalar: %s", string(value))
}

func auditFloatCell(value *float64) string {
	if value == nil {
		return ""
	}
	return strconv.FormatFloat(*value, 'g', -1, 64)
}

func auditIntCell(value *int) string {
	if value == nil {
		return ""
	}
	return strconv.Itoa(*value)
}

func auditInt64Cell(value *int64) string {
	if value == nil {
		return ""
	}
	return strconv.FormatInt(*value, 10)
}

func exactTaskAuditCSVRecord(row client.ExactTaskAuditRow) ([]string, error) {
	age, err := auditRawScalarCell(row.Age)
	if err != nil {
		return nil, err
	}
	analysisReasons, err := auditJSONCell(row.AnalysisReasons)
	if err != nil {
		return nil, err
	}
	breakdown, err := auditJSONCell(row.CurrentBreakdown)
	if err != nil {
		return nil, err
	}
	highlights, err := auditJSONCell(row.CurrentHighlights)
	if err != nil {
		return nil, err
	}
	concerns, err := auditJSONCell(row.CurrentConcerns)
	if err != nil {
		return nil, err
	}
	keyFactors, err := auditJSONCell(row.CurrentKeyFactors)
	if err != nil {
		return nil, err
	}
	missingReasons, err := auditJSONCell(row.MissingReasons)
	if err != nil {
		return nil, err
	}
	brandHits, err := auditJSONCell(row.BrandHits)
	if err != nil {
		return nil, err
	}
	companyHits, err := auditJSONCell(row.CompanyHits)
	if err != nil {
		return nil, err
	}
	roleSignals, err := auditJSONCell(row.RoleSignals)
	if err != nil {
		return nil, err
	}
	matchedWorkEntries, err := auditJSONCell(row.MatchedWorkEntries)
	if err != nil {
		return nil, err
	}
	ruleScores, err := auditJSONCell(row.RuleScores)
	if err != nil {
		return nil, err
	}

	return []string{
		row.CurrentResumeID,
		row.CanonicalIdentityKey,
		row.ExternalID,
		row.ProfileResumeID,
		row.ProfileURL,
		row.Source,
		row.SourceKey,
		row.WorkspaceSlug,
		row.Name,
		age,
		row.Location,
		row.TaskID,
		row.TaskStatus,
		row.TaskWorkspaceSlug,
		strconv.FormatInt(row.TaskDispatchedAt, 10),
		strconv.FormatInt(row.TaskCompletedAt, 10),
		row.ExpectedJobDescriptionID,
		strconv.Itoa(row.ExpectedPromptVersion),
		row.ExpectedAnalysisKey,
		strconv.FormatBool(row.ExactCohortMember),
		row.AnalysisState,
		analysisReasons,
		row.CurrentAnalysisKey,
		row.CurrentJobDescriptionID,
		auditIntCell(row.CurrentPromptVersion),
		row.CurrentLocale,
		row.CurrentQueryLocation,
		auditInt64Cell(row.CurrentAnalyzedAt),
		auditFloatCell(row.FinalAIScore),
		row.CurrentRecommendation,
		breakdown,
		auditFloatCell(row.RelatedExpAuditFactor),
		auditFloatCell(row.RelatedExpContribution),
		auditFloatCell(row.IndustryDBContribution),
		row.CurrentAISummary,
		highlights,
		concerns,
		keyFactors,
		auditFloatCell(row.EvidenceBandMax),
		row.RelatedExpCoverage,
		missingReasons,
		auditFloatCell(row.EffectiveRelatedExp),
		auditFloatCell(row.LLMRelatedExp),
		auditFloatCell(row.RecommendationMax),
		row.RelatedExpContextHash,
		row.RelatedExpRubricVersion,
		brandHits,
		row.BrandOrigin,
		row.ProductClass,
		companyHits,
		roleSignals,
		matchedWorkEntries,
		row.EvidenceText,
		row.Market,
		ruleScores,
		auditFloatCell(row.RuleScore),
	}, nil
}

func encodeExactTaskAuditCSV(rows []client.ExactTaskAuditRow) ([]byte, error) {
	var payload bytes.Buffer
	writer := csv.NewWriter(&payload)
	if err := writer.Write(exactTaskAuditCSVHeaders); err != nil {
		return nil, fmt.Errorf("write audit export CSV header: %w", err)
	}
	for _, row := range rows {
		record, err := exactTaskAuditCSVRecord(row)
		if err != nil {
			return nil, fmt.Errorf("encode audit export row %s: %w", row.CurrentResumeID, err)
		}
		if err := writer.Write(record); err != nil {
			return nil, fmt.Errorf("write audit export row %s: %w", row.CurrentResumeID, err)
		}
	}
	writer.Flush()
	if err := writer.Error(); err != nil {
		return nil, fmt.Errorf("flush audit export CSV: %w", err)
	}
	return payload.Bytes(), nil
}

func installPrivateAtomicFile(path string, payload []byte) error {
	directory := filepath.Dir(path)
	if err := os.MkdirAll(directory, 0o755); err != nil {
		return fmt.Errorf("create audit export directory: %w", err)
	}
	temporary, err := os.CreateTemp(directory, "."+filepath.Base(path)+".*.tmp")
	if err != nil {
		return fmt.Errorf("create audit export temporary file: %w", err)
	}
	temporaryPath := temporary.Name()
	closed := false
	defer func() {
		if !closed {
			_ = temporary.Close()
		}
		_ = os.Remove(temporaryPath)
	}()

	if err := temporary.Chmod(0o600); err != nil {
		return fmt.Errorf("protect audit export temporary file: %w", err)
	}
	if _, err := temporary.Write(payload); err != nil {
		return fmt.Errorf("write audit export temporary file: %w", err)
	}
	if err := temporary.Sync(); err != nil {
		return fmt.Errorf("sync audit export temporary file: %w", err)
	}
	if err := temporary.Close(); err != nil {
		closed = true
		return fmt.Errorf("close audit export temporary file: %w", err)
	}
	closed = true
	if err := os.Rename(temporaryPath, path); err != nil {
		return fmt.Errorf("atomically install audit export: %w", err)
	}
	return nil
}

func runExactTaskAuditExport(
	ctx context.Context,
	apiClient *client.Client,
	taskID string,
	outPath string,
) (exactTaskAuditExportResult, error) {
	resolvedPath, err := filepath.Abs(filepath.Clean(outPath))
	if err != nil {
		return exactTaskAuditExportResult{}, fmt.Errorf("resolve audit export path: %w", err)
	}
	rows, metadata, cohortMembers, ready, err := collectExactTaskAuditRows(ctx, apiClient, taskID)
	if err != nil {
		return exactTaskAuditExportResult{}, err
	}
	payload, err := encodeExactTaskAuditCSV(rows)
	if err != nil {
		return exactTaskAuditExportResult{}, err
	}
	if err := installPrivateAtomicFile(resolvedPath, payload); err != nil {
		return exactTaskAuditExportResult{}, err
	}
	digest := sha256.Sum256(payload)
	return exactTaskAuditExportResult{
		Count:         len(rows),
		File:          resolvedPath,
		Bytes:         len(payload),
		SHA256:        hex.EncodeToString(digest[:]),
		Mode:          "0600",
		Task:          metadata,
		CohortMembers: cohortMembers,
		Ready:         ready,
	}, nil
}

func writeExactTaskAuditExportResult(cmd *cobra.Command, result exactTaskAuditExportResult) error {
	raw := map[string]any{
		"count":         result.Count,
		"file":          result.File,
		"bytes":         result.Bytes,
		"sha256":        result.SHA256,
		"mode":          result.Mode,
		"taskId":        result.Task.TaskID,
		"dispatchedAt":  result.Task.DispatchedAt,
		"completedAt":   result.Task.CompletedAt,
		"cohortMembers": result.CohortMembers,
		"ready":         result.Ready,
	}
	headers := []string{
		"count", "file", "bytes", "sha256", "mode", "task_id", "dispatched_at", "completed_at", "cohort_members", "ready",
	}
	rows := [][]string{{
		strconv.Itoa(result.Count),
		result.File,
		strconv.Itoa(result.Bytes),
		result.SHA256,
		result.Mode,
		result.Task.TaskID,
		strconv.FormatInt(result.Task.DispatchedAt, 10),
		strconv.FormatInt(result.Task.CompletedAt, 10),
		strconv.Itoa(result.CohortMembers),
		strconv.Itoa(result.Ready),
	}}
	return writeOutput(cmd, headers, rows, raw)
}
