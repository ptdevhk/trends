package cmd

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"time"

	"github.com/ptdevhk/trends/packages/cli/internal/client"
	"github.com/spf13/cobra"
)

const defaultResumeDeployBackupDir = "/var/backups/trends/deploy"

type resumeBackupEnvelope struct {
	Metadata json.RawMessage   `json:"metadata"`
	Resumes  []json.RawMessage `json:"resumes"`
	Data     []json.RawMessage `json:"data"`
}

type resumeBackupResult struct {
	FilePath string
	Count    int
	Bytes    int
}

type resumeRestoreResult struct {
	FilePath     string
	Mode         string
	Reset        bool
	ResetCount   int
	ResetPartial bool
	Submitted    int
	Inserted     int
	Updated      int
	Unchanged    int
	Deduped      int
}

type resumeSummaryOutput struct {
	Summary map[string]any
	Headers []string
	Rows    [][]string
}

type resumeOutputExtras struct {
	Workspace string
	RunDir    string
}

func isJSONObject(raw json.RawMessage) bool {
	if len(raw) == 0 {
		return false
	}

	var value map[string]any
	return json.Unmarshal(raw, &value) == nil
}

func unmarshalResumeBackupEnvelope(payload []byte) (resumeBackupEnvelope, error) {
	var envelope resumeBackupEnvelope
	if err := json.Unmarshal(payload, &envelope); err != nil {
		return resumeBackupEnvelope{}, err
	}
	return envelope, nil
}

func resumeBackupCount(envelope resumeBackupEnvelope) int {
	if len(envelope.Resumes) > 0 {
		return len(envelope.Resumes)
	}
	return len(envelope.Data)
}

func normalizeResumeBackupOutputPath(outPath string, disposition string) string {
	resolvedPath := strings.TrimSpace(outPath)
	if resolvedPath != "" {
		return resolvedPath
	}

	resolvedPath = extractFilename(disposition)
	if resolvedPath != "" {
		return resolvedPath
	}

	return fmt.Sprintf("resume-backup-%s.json", time.Now().Format("20060102-150405"))
}

func readResumeBackupFile(filePath string) ([]byte, resumeBackupEnvelope, error) {
	payload, err := os.ReadFile(filePath)
	if err != nil {
		return nil, resumeBackupEnvelope{}, fmt.Errorf("read backup file: %w", err)
	}

	envelope, err := unmarshalResumeBackupEnvelope(payload)
	if err != nil {
		return nil, resumeBackupEnvelope{}, fmt.Errorf("invalid backup file: %w", err)
	}
	if !isJSONObject(envelope.Metadata) {
		return nil, resumeBackupEnvelope{}, fmt.Errorf("invalid backup file: missing metadata")
	}
	if resumeBackupCount(envelope) == 0 {
		return nil, resumeBackupEnvelope{}, fmt.Errorf("invalid backup file: missing resumes or data array")
	}

	return payload, envelope, nil
}

func normalizeResumeRestoreMode(mode string) (string, error) {
	normalizedMode := strings.ToLower(strings.TrimSpace(mode))
	if normalizedMode == "" {
		normalizedMode = "upsert"
	}
	if normalizedMode != "upsert" && normalizedMode != "replace" {
		return "", fmt.Errorf("invalid mode %q (expected upsert|replace)", mode)
	}
	return normalizedMode, nil
}

func backupResumesToFile(ctx context.Context, apiClient *client.Client, request client.ResumeBackupRequest, outPath string) (*resumeBackupResult, error) {
	payload, disposition, err := apiClient.BackupResumes(ctx, request)
	if err != nil {
		return nil, err
	}

	envelope, err := unmarshalResumeBackupEnvelope(payload)
	if err != nil {
		return nil, fmt.Errorf("decode backup payload: %w", err)
	}
	if !isJSONObject(envelope.Metadata) {
		return nil, fmt.Errorf("backup payload is missing metadata")
	}

	resolvedPath := normalizeResumeBackupOutputPath(outPath, disposition)
	if err := writeJSONFile(resolvedPath, payload); err != nil {
		return nil, err
	}

	return &resumeBackupResult{
		FilePath: resolvedPath,
		Count:    resumeBackupCount(envelope),
		Bytes:    len(payload),
	}, nil
}

func appendResumeOutputExtras(summary map[string]any, headers []string, row []string, extras resumeOutputExtras) ([]string, []string) {
	if extras.Workspace != "" {
		summary["workspace"] = extras.Workspace
		headers = append(headers, "workspace")
		row = append(row, extras.Workspace)
	}
	if extras.RunDir != "" {
		summary["runDir"] = extras.RunDir
		headers = append(headers, "run_dir")
		row = append(row, extras.RunDir)
	}
	return headers, row
}

func buildResumeBackupOutput(result *resumeBackupResult, extras resumeOutputExtras) resumeSummaryOutput {
	summary := map[string]any{
		"count": result.Count,
		"file":  result.FilePath,
		"bytes": result.Bytes,
	}
	headers := make([]string, 0, 5)
	row := make([]string, 0, 5)
	headers, row = appendResumeOutputExtras(summary, headers, row, extras)
	headers = append(headers, "file", "count", "bytes")
	row = append(row, result.FilePath, fmt.Sprintf("%d", result.Count), fmt.Sprintf("%d", result.Bytes))

	return resumeSummaryOutput{
		Summary: summary,
		Headers: headers,
		Rows:    [][]string{row},
	}
}

func buildResumeRestoreOutput(result *resumeRestoreResult, extras resumeOutputExtras) resumeSummaryOutput {
	summary := map[string]any{
		"mode":         result.Mode,
		"file":         result.FilePath,
		"reset":        result.Reset,
		"resetCount":   result.ResetCount,
		"resetPartial": result.ResetPartial,
		"submitted":    result.Submitted,
		"inserted":     result.Inserted,
		"updated":      result.Updated,
		"unchanged":    result.Unchanged,
		"deduped":      result.Deduped,
	}
	headers := make([]string, 0, 12)
	row := make([]string, 0, 12)
	headers, row = appendResumeOutputExtras(summary, headers, row, extras)
	headers = append(headers, "mode", "file", "reset", "reset_count", "reset_partial", "submitted", "inserted", "updated", "unchanged", "deduped")
	row = append(
		row,
		result.Mode,
		result.FilePath,
		fmt.Sprintf("%t", result.Reset),
		fmt.Sprintf("%d", result.ResetCount),
		fmt.Sprintf("%t", result.ResetPartial),
		fmt.Sprintf("%d", result.Submitted),
		fmt.Sprintf("%d", result.Inserted),
		fmt.Sprintf("%d", result.Updated),
		fmt.Sprintf("%d", result.Unchanged),
		fmt.Sprintf("%d", result.Deduped),
	)

	return resumeSummaryOutput{
		Summary: summary,
		Headers: headers,
		Rows:    [][]string{row},
	}
}

func restoreResumeBackupFile(ctx context.Context, apiClient *client.Client, filePath string, mode string, yes bool) (*resumeRestoreResult, error) {
	payload, _, err := readResumeBackupFile(filePath)
	if err != nil {
		return nil, err
	}

	normalizedMode, err := normalizeResumeRestoreMode(mode)
	if err != nil {
		return nil, err
	}
	if normalizedMode == "replace" && !yes {
		return nil, fmt.Errorf("restore mode replace requires --yes")
	}

	resetCount := 0
	resetPartial := false
	if normalizedMode == "replace" {
		resetResponse, err := apiClient.ResetResumes(ctx)
		if err != nil {
			return nil, err
		}
		resetCount = resetResponse.Count
		resetPartial = resetResponse.Partial
	}

	response, err := apiClient.ImportResumeBackup(ctx, json.RawMessage(payload))
	if err != nil {
		return nil, err
	}

	return &resumeRestoreResult{
		FilePath:     filePath,
		Mode:         normalizedMode,
		Reset:        normalizedMode == "replace",
		ResetCount:   resetCount,
		ResetPartial: resetPartial,
		Submitted:    response.Submitted,
		Inserted:     response.Inserted,
		Updated:      response.Updated,
		Unchanged:    response.Unchanged,
		Deduped:      response.Deduped,
	}, nil
}

func newResumeBackupCmd() *cobra.Command {
	var (
		outPath     string
		limit       int
		resumeIDs   []string
		sourceHosts []string
	)

	cmd := &cobra.Command{
		Use:   "backup",
		Short: "Backup live resume records to a portable JSON file",
		RunE: func(cmd *cobra.Command, args []string) error {
			request := client.ResumeBackupRequest{
				ResumeIDs:   normalizeStringSlice(resumeIDs),
				SourceHosts: normalizeStringSlice(sourceHosts),
			}
			if limit > 0 {
				request.Limit = limit
			}

			result, err := backupResumesToFile(context.Background(), newAPIClient(), request, outPath)
			if err != nil {
				return err
			}

			output := buildResumeBackupOutput(result, resumeOutputExtras{})
			return writeOutput(cmd, output.Headers, output.Rows, output.Summary)
		},
	}

	cmd.Flags().StringVar(&outPath, "out", "", "Output file path")
	cmd.Flags().IntVar(&limit, "limit", 0, "Maximum resumes to include")
	cmd.Flags().StringArrayVar(&resumeIDs, "resume-id", nil, "Resume identifier to include (repeatable)")
	cmd.Flags().StringArrayVar(&sourceHosts, "source-host", nil, "Source host to include (repeatable)")

	return cmd
}

func newResumeRestoreCmd() *cobra.Command {
	var (
		mode string
		yes  bool
	)

	cmd := &cobra.Command{
		Use:   "restore <file>",
		Short: "Restore resume records from a portable JSON backup",
		Args:  cobra.ExactArgs(1),
		RunE: func(cmd *cobra.Command, args []string) error {
			filePath := strings.TrimSpace(args[0])
			if filePath == "" {
				return fmt.Errorf("backup file path is required")
			}

			result, err := restoreResumeBackupFile(context.Background(), newAPIClient(), filePath, mode, yes)
			if err != nil {
				return err
			}

			output := buildResumeRestoreOutput(result, resumeOutputExtras{})
			return writeOutput(cmd, output.Headers, output.Rows, output.Summary)
		},
	}

	cmd.Flags().StringVar(&mode, "mode", "upsert", "Restore mode: upsert|replace")
	cmd.Flags().BoolVar(&yes, "yes", false, "Confirm destructive replace mode")

	return cmd
}

func newResumeDeployBackupCmd() *cobra.Command {
	deployBackupCmd := &cobra.Command{
		Use:   "deploy-backup",
		Short: "Read and write resume backups in the standard deploy backup layout",
	}

	deployBackupCmd.AddCommand(
		newResumeDeployBackupWriteCmd(),
		newResumeDeployBackupRestoreCmd(),
	)

	return deployBackupCmd
}

func newResumeDeployBackupWriteCmd() *cobra.Command {
	var (
		baseDir     string
		limit       int
		resumeIDs   []string
		sourceHosts []string
	)

	cmd := &cobra.Command{
		Use:   "write [run-dir]",
		Short: "Write a resume backup JSON file into a deploy backup run directory",
		Args:  cobra.MaximumNArgs(1),
		RunE: func(cmd *cobra.Command, args []string) error {
			runDir, err := resolveOrCreateDeployBackupRunDir(baseDir, args)
			if err != nil {
				return err
			}

			request := client.ResumeBackupRequest{
				ResumeIDs:   normalizeStringSlice(resumeIDs),
				SourceHosts: normalizeStringSlice(sourceHosts),
			}
			if limit > 0 {
				request.Limit = limit
			}

			filePath := deployResumeBackupFilePath(runDir, currentOptions().Workspace)
			result, err := backupResumesToFile(context.Background(), newAPIClient(), request, filePath)
			if err != nil {
				return err
			}

			output := buildResumeBackupOutput(result, resumeOutputExtras{
				Workspace: currentOptions().Workspace,
				RunDir:    runDir,
			})
			return writeOutput(cmd, output.Headers, output.Rows, output.Summary)
		},
	}

	cmd.Flags().StringVar(&baseDir, "base-dir", defaultResumeDeployBackupDir, "Base deploy backup directory")
	cmd.Flags().IntVar(&limit, "limit", 0, "Maximum resumes to include")
	cmd.Flags().StringArrayVar(&resumeIDs, "resume-id", nil, "Resume identifier to include (repeatable)")
	cmd.Flags().StringArrayVar(&sourceHosts, "source-host", nil, "Source host to include (repeatable)")

	return cmd
}

func newResumeDeployBackupRestoreCmd() *cobra.Command {
	var (
		baseDir string
		mode    string
		yes     bool
	)

	cmd := &cobra.Command{
		Use:   "restore [run-dir]",
		Short: "Restore resume records from a deploy backup run directory",
		Args:  cobra.MaximumNArgs(1),
		RunE: func(cmd *cobra.Command, args []string) error {
			runDir, err := resolveDeployBackupRunDir(baseDir, args)
			if err != nil {
				return err
			}

			filePath := deployResumeBackupFilePath(runDir, currentOptions().Workspace)
			result, err := restoreResumeBackupFile(context.Background(), newAPIClient(), filePath, mode, yes)
			if err != nil {
				return err
			}

			output := buildResumeRestoreOutput(result, resumeOutputExtras{
				Workspace: currentOptions().Workspace,
				RunDir:    runDir,
			})
			return writeOutput(cmd, output.Headers, output.Rows, output.Summary)
		},
	}

	cmd.Flags().StringVar(&baseDir, "base-dir", defaultResumeDeployBackupDir, "Base deploy backup directory")
	cmd.Flags().StringVar(&mode, "mode", "upsert", "Restore mode: upsert|replace")
	cmd.Flags().BoolVar(&yes, "yes", false, "Confirm destructive replace mode")

	return cmd
}

func resolveOrCreateDeployBackupRunDir(baseDir string, args []string) (string, error) {
	if len(args) > 0 {
		runDir := strings.TrimSpace(args[0])
		if runDir == "" {
			return "", fmt.Errorf("deploy backup run directory path is required")
		}
		if err := os.MkdirAll(runDir, 0o755); err != nil {
			return "", fmt.Errorf("create deploy backup run directory: %w", err)
		}
		return runDir, nil
	}

	resolvedBaseDir := strings.TrimSpace(baseDir)
	if resolvedBaseDir == "" {
		resolvedBaseDir = defaultResumeDeployBackupDir
	}
	if err := os.MkdirAll(resolvedBaseDir, 0o755); err != nil {
		return "", fmt.Errorf("create deploy backup base directory: %w", err)
	}

	runDir := filepath.Join(
		resolvedBaseDir,
		fmt.Sprintf("deploy-%s-%d", time.Now().UTC().Format("20060102T150405Z"), os.Getpid()),
	)
	if err := os.MkdirAll(runDir, 0o755); err != nil {
		return "", fmt.Errorf("create deploy backup run directory: %w", err)
	}
	return runDir, nil
}

func resolveDeployBackupRunDir(baseDir string, args []string) (string, error) {
	if len(args) > 0 {
		runDir := strings.TrimSpace(args[0])
		if runDir == "" {
			return "", fmt.Errorf("deploy backup run directory path is required")
		}
		return runDir, nil
	}
	return latestDeployBackupRunDir(baseDir)
}

func latestDeployBackupRunDir(baseDir string) (string, error) {
	resolvedBaseDir := strings.TrimSpace(baseDir)
	if resolvedBaseDir == "" {
		resolvedBaseDir = defaultResumeDeployBackupDir
	}

	entries, err := os.ReadDir(resolvedBaseDir)
	if err != nil {
		return "", fmt.Errorf("read deploy backup base directory: %w", err)
	}

	latestName := ""
	for _, entry := range entries {
		if !entry.IsDir() || !strings.HasPrefix(entry.Name(), "deploy-") {
			continue
		}
		if latestName == "" || entry.Name() > latestName {
			latestName = entry.Name()
		}
	}
	if latestName == "" {
		return "", fmt.Errorf("no deploy backup run directories found in %s", resolvedBaseDir)
	}

	return filepath.Join(resolvedBaseDir, latestName), nil
}

func deployResumeBackupFilePath(runDir string, workspace string) string {
	return filepath.Join(runDir, fmt.Sprintf("resumes-%s.json", normalizeWorkspace(workspace)))
}

func normalizeStringSlice(values []string) []string {
	normalized := make([]string, 0, len(values))
	for _, value := range values {
		trimmed := strings.TrimSpace(value)
		if trimmed != "" {
			normalized = append(normalized, trimmed)
		}
	}
	return normalized
}

func writeJSONFile(filePath string, payload []byte) error {
	resolvedPath := strings.TrimSpace(filePath)
	if resolvedPath == "" {
		return fmt.Errorf("output file path is required")
	}

	dir := filepath.Dir(resolvedPath)
	if dir != "." {
		if err := os.MkdirAll(dir, 0o755); err != nil {
			return fmt.Errorf("create output directory: %w", err)
		}
	}

	var formatted bytes.Buffer
	if err := json.Indent(&formatted, payload, "", "  "); err == nil {
		formatted.WriteByte('\n')
		if err := os.WriteFile(resolvedPath, formatted.Bytes(), 0o644); err != nil {
			return fmt.Errorf("write backup file: %w", err)
		}
		return nil
	}

	if err := os.WriteFile(resolvedPath, payload, 0o644); err != nil {
		return fmt.Errorf("write backup file: %w", err)
	}
	return nil
}
