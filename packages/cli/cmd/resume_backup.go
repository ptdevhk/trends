package cmd

import (
	"archive/tar"
	"bytes"
	"compress/gzip"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"time"

	"github.com/ptdevhk/trends/packages/cli/internal/client"
	"github.com/spf13/cobra"
)

const defaultResumeDeployBackupDir = "/var/backups/trends/deploy"

type resumeBackupEnvelope struct {
	Metadata         json.RawMessage   `json:"metadata"`
	Resumes          []json.RawMessage `json:"resumes"`
	Data             []json.RawMessage `json:"data"`
	CandidateActions json.RawMessage   `json:"candidateActions,omitempty"`
	CandidateStatus  json.RawMessage   `json:"candidateStatus,omitempty"`
}

type resumeBackupResult struct {
	FilePath string
	Count    int
	Bytes    int
}

type resumeRestoreResult struct {
	Workspace       string                    `json:"workspace,omitempty"`
	RunDir          string                    `json:"runDir,omitempty"`
	InputPath       string                    `json:"inputPath"`
	FilePath        string                    `json:"file,omitempty"`
	Mode            string                    `json:"mode"`
	Reset           bool                      `json:"reset"`
	ResetCount      int                       `json:"resetCount"`
	ResetPartial    bool                      `json:"resetPartial"`
	AutoBackupPath  string                    `json:"autoBackupPath,omitempty"`
	Submitted       int                       `json:"submitted"`
	Inserted        int                       `json:"inserted"`
	Updated         int                       `json:"updated"`
	Unchanged       int                       `json:"unchanged"`
	Deduped         int                       `json:"deduped"`
	StatusReplayed  int                       `json:"statusReplayed"`
	ActionsReplayed int                       `json:"actionsReplayed"`
	ActionsDeduped  int                       `json:"actionsDeduped"`
	Files           []resumeRestoreFileResult `json:"files"`
}

type resumeRestoreFileResult struct {
	FilePath        string `json:"file"`
	Count           int    `json:"count"`
	Submitted       int    `json:"submitted"`
	Inserted        int    `json:"inserted"`
	Updated         int    `json:"updated"`
	Unchanged       int    `json:"unchanged"`
	Deduped         int    `json:"deduped"`
	StatusReplayed  int    `json:"statusReplayed"`
	ActionsReplayed int    `json:"actionsReplayed"`
	ActionsDeduped  int    `json:"actionsDeduped"`
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

	return filepath.Join("output", "resume-backups", fmt.Sprintf("resume-backup-%s.json", time.Now().Format("20060102-150405")))
}

func normalizeResumeRestoreMode(mode string) (string, error) {
	normalizedMode := strings.ToLower(strings.TrimSpace(mode))
	if normalizedMode == "" {
		normalizedMode = "replace"
	}
	if normalizedMode == "upsert" {
		normalizedMode = "merge"
	}
	if normalizedMode != "merge" && normalizedMode != "replace" {
		return "", fmt.Errorf("invalid mode %q (expected replace|merge; upsert is an alias for merge)", mode)
	}
	return normalizedMode, nil
}

func isTarGzPath(filePath string) bool {
	return strings.HasSuffix(strings.ToLower(strings.TrimSpace(filePath)), ".tar.gz")
}

func formatJSONPayload(payload []byte) []byte {
	var formatted bytes.Buffer
	if err := json.Indent(&formatted, payload, "", "  "); err == nil {
		formatted.WriteByte('\n')
		return formatted.Bytes()
	}

	return append([]byte(nil), payload...)
}

func resolveArchiveEntryName(filePath string) string {
	fileName := filepath.Base(strings.TrimSpace(filePath))
	if fileName == "" {
		return "resume-backup.json"
	}

	if strings.HasSuffix(strings.ToLower(fileName), ".tar.gz") {
		fileName = fileName[:len(fileName)-len(".tar.gz")]
	}
	if !strings.HasSuffix(strings.ToLower(fileName), ".json") {
		fileName += ".json"
	}
	if len(fileName) > 100 {
		return "resume-backup.json"
	}

	return fileName
}

func buildPortableBackupArchive(filePath string, content []byte) ([]byte, error) {
	var archive bytes.Buffer
	gzipWriter := gzip.NewWriter(&archive)
	tarWriter := tar.NewWriter(gzipWriter)

	header := &tar.Header{
		Name:     resolveArchiveEntryName(filePath),
		Mode:     0o644,
		Size:     int64(len(content)),
		ModTime:  time.Now().UTC(),
		Typeflag: tar.TypeReg,
		Format:   tar.FormatUSTAR,
	}

	if err := tarWriter.WriteHeader(header); err != nil {
		_ = tarWriter.Close()
		_ = gzipWriter.Close()
		return nil, fmt.Errorf("create backup archive: %w", err)
	}
	if _, err := tarWriter.Write(content); err != nil {
		_ = tarWriter.Close()
		_ = gzipWriter.Close()
		return nil, fmt.Errorf("write backup archive content: %w", err)
	}
	if err := tarWriter.Close(); err != nil {
		_ = gzipWriter.Close()
		return nil, fmt.Errorf("close backup archive: %w", err)
	}
	if err := gzipWriter.Close(); err != nil {
		return nil, fmt.Errorf("compress backup archive: %w", err)
	}

	return archive.Bytes(), nil
}

func writePortableBackupFile(filePath string, payload []byte) (int, error) {
	resolvedPath := strings.TrimSpace(filePath)
	if resolvedPath == "" {
		return 0, fmt.Errorf("output file path is required")
	}

	dir := filepath.Dir(resolvedPath)
	if dir != "." {
		if err := os.MkdirAll(dir, 0o755); err != nil {
			return 0, fmt.Errorf("create output directory: %w", err)
		}
	}

	content := formatJSONPayload(payload)
	if !isTarGzPath(resolvedPath) {
		if err := os.WriteFile(resolvedPath, content, 0o644); err != nil {
			return 0, fmt.Errorf("write backup file: %w", err)
		}
		return len(content), nil
	}

	archive, err := buildPortableBackupArchive(resolvedPath, content)
	if err != nil {
		return 0, err
	}
	if err := os.WriteFile(resolvedPath, archive, 0o644); err != nil {
		return 0, fmt.Errorf("write backup file: %w", err)
	}

	return len(archive), nil
}

func extractTarEntryContent(reader io.Reader) ([]byte, error) {
	tarReader := tar.NewReader(reader)
	var jsonEntry []byte
	var fallbackFile []byte
	fileEntryCount := 0

	for {
		header, err := tarReader.Next()
		if err == io.EOF {
			break
		}
		if err != nil {
			return nil, fmt.Errorf("read backup archive: %w", err)
		}
		if header.Typeflag != tar.TypeReg && header.Typeflag != tar.TypeRegA {
			continue
		}

		name := strings.TrimSpace(filepath.Base(header.Name))
		if name == "" || strings.HasPrefix(name, "._") {
			continue
		}

		content, err := io.ReadAll(tarReader)
		if err != nil {
			return nil, fmt.Errorf("read backup archive content: %w", err)
		}

		fileEntryCount++
		if strings.HasSuffix(strings.ToLower(name), ".json") {
			if jsonEntry != nil {
				return nil, fmt.Errorf("invalid backup archive: multiple JSON entries found")
			}
			jsonEntry = content
			continue
		}

		if fallbackFile == nil {
			fallbackFile = content
		}
	}

	if jsonEntry != nil {
		return jsonEntry, nil
	}
	if fileEntryCount == 1 && fallbackFile != nil {
		return fallbackFile, nil
	}
	if fileEntryCount > 1 {
		return nil, fmt.Errorf("invalid backup archive: expected exactly one JSON payload")
	}

	return nil, fmt.Errorf("invalid backup archive: no file entries found")
}

func readPortableBackupFile(filePath string) ([]byte, error) {
	resolvedPath := strings.TrimSpace(filePath)
	if resolvedPath == "" {
		return nil, fmt.Errorf("backup file path is required")
	}

	content, err := os.ReadFile(resolvedPath)
	if err != nil {
		return nil, fmt.Errorf("read backup file: %w", err)
	}
	if len(content) < 2 || content[0] != 0x1f || content[1] != 0x8b {
		return content, nil
	}

	gzipReader, err := gzip.NewReader(bytes.NewReader(content))
	if err != nil {
		return nil, fmt.Errorf("read backup archive: %w", err)
	}
	defer gzipReader.Close()

	archivePayload, err := extractTarEntryContent(gzipReader)
	if err != nil {
		return nil, err
	}

	return archivePayload, nil
}

func validateResumeBackupEnvelope(payload []byte, envelope resumeBackupEnvelope) ([]byte, resumeBackupEnvelope, error) {
	if !isJSONObject(envelope.Metadata) {
		return nil, resumeBackupEnvelope{}, fmt.Errorf("invalid backup file: missing metadata")
	}
	if resumeBackupCount(envelope) == 0 {
		return nil, resumeBackupEnvelope{}, fmt.Errorf("invalid backup file: missing resumes or data array")
	}

	return payload, envelope, nil
}

func readResumeBackupFile(filePath string) ([]byte, resumeBackupEnvelope, error) {
	payload, err := readPortableBackupFile(filePath)
	if err != nil {
		return nil, resumeBackupEnvelope{}, err
	}

	envelope, err := unmarshalResumeBackupEnvelope(payload)
	if err != nil {
		return nil, resumeBackupEnvelope{}, fmt.Errorf("invalid backup file: %w", err)
	}

	return validateResumeBackupEnvelope(payload, envelope)
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
	bytesWritten, err := writePortableBackupFile(resolvedPath, payload)
	if err != nil {
		return nil, err
	}

	return &resumeBackupResult{
		FilePath: resolvedPath,
		Count:    resumeBackupCount(envelope),
		Bytes:    bytesWritten,
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
		"inputPath":    result.InputPath,
		"mode":         result.Mode,
		"reset":        result.Reset,
		"resetCount":   result.ResetCount,
		"resetPartial": result.ResetPartial,
		"submitted":    result.Submitted,
		"inserted":     result.Inserted,
		"updated":      result.Updated,
		"unchanged":    result.Unchanged,
		"deduped":      result.Deduped,
	}
	if result.FilePath != "" {
		summary["file"] = result.FilePath
	}
	headers := make([]string, 0, 12)
	row := make([]string, 0, 12)
	headers, row = appendResumeOutputExtras(summary, headers, row, extras)
	headers = append(headers, "mode", "input_path", "reset", "reset_count", "reset_partial", "file", "count", "submitted", "inserted", "updated", "unchanged", "deduped")

	rows := make([][]string, 0, len(result.Files))
	for _, file := range result.Files {
		fileRow := append([]string{}, row...)
		fileRow = append(
			fileRow,
			result.Mode,
			result.InputPath,
			fmt.Sprintf("%t", result.Reset),
			fmt.Sprintf("%d", result.ResetCount),
			fmt.Sprintf("%t", result.ResetPartial),
			file.FilePath,
			fmt.Sprintf("%d", file.Count),
			fmt.Sprintf("%d", file.Submitted),
			fmt.Sprintf("%d", file.Inserted),
			fmt.Sprintf("%d", file.Updated),
			fmt.Sprintf("%d", file.Unchanged),
			fmt.Sprintf("%d", file.Deduped),
		)
		rows = append(rows, fileRow)
	}

	return resumeSummaryOutput{
		Summary: summary,
		Headers: headers,
		Rows:    rows,
	}
}

func isSupportedResumeRestorePath(fileName string) bool {
	normalized := strings.TrimSpace(strings.ToLower(fileName))
	return strings.HasSuffix(normalized, ".json") || strings.HasSuffix(normalized, ".tar.gz")
}

func readResumeRestoreOrder(filePath string) int {
	fileName := filepath.Base(strings.TrimSpace(filePath))
	sources := []string{"job5156", "seek", "51job-manual"}
	for index, source := range sources {
		if strings.HasPrefix(fileName, fmt.Sprintf("resume-backup-%s-", source)) {
			return index
		}
	}
	return len(sources)
}

func compareResumeRestorePaths(left string, right string) int {
	orderDiff := readResumeRestoreOrder(left) - readResumeRestoreOrder(right)
	if orderDiff != 0 {
		return orderDiff
	}
	return strings.Compare(filepath.Base(left), filepath.Base(right))
}

func resolveResumeRestorePaths(inputPath string) ([]string, error) {
	resolvedInputPath := strings.TrimSpace(inputPath)
	if resolvedInputPath == "" {
		return nil, fmt.Errorf("backup file path is required")
	}

	info, err := os.Stat(resolvedInputPath)
	if err != nil {
		return nil, fmt.Errorf("stat restore path: %w", err)
	}
	if !info.IsDir() {
		return []string{resolvedInputPath}, nil
	}

	entries, err := os.ReadDir(resolvedInputPath)
	if err != nil {
		return nil, fmt.Errorf("read restore directory: %w", err)
	}

	files := make([]string, 0, len(entries))
	for _, entry := range entries {
		if entry.IsDir() || !isSupportedResumeRestorePath(entry.Name()) {
			continue
		}
		files = append(files, filepath.Join(resolvedInputPath, entry.Name()))
	}
	if len(files) == 0 {
		return nil, fmt.Errorf("no restore backup files found in directory %s", resolvedInputPath)
	}

	sort.Slice(files, func(i int, j int) bool {
		return compareResumeRestorePaths(files[i], files[j]) < 0
	})
	return files, nil
}

func resetResumesFully(ctx context.Context, apiClient *client.Client) (int, error) {
	totalResetCount := 0

	for {
		resetResponse, err := apiClient.ResetResumes(ctx)
		if err != nil {
			return 0, err
		}

		totalResetCount += resetResponse.Count
		if !resetResponse.Partial {
			return totalResetCount, nil
		}
	}
}

func restoreResumeBackupPath(ctx context.Context, apiClient *client.Client, inputPath string, mode string, yes bool, noAutoBackup bool) (*resumeRestoreResult, error) {
	normalizedMode, err := normalizeResumeRestoreMode(mode)
	if err != nil {
		return nil, err
	}
	if normalizedMode == "replace" && !yes {
		return nil, fmt.Errorf("restore mode replace requires --yes")
	}

	restorePaths, err := resolveResumeRestorePaths(inputPath)
	if err != nil {
		return nil, err
	}

	var autoBackupPath string
	resetCount := 0
	resetPartial := false
	if normalizedMode == "replace" {
		if !noAutoBackup {
			autoBackupPath, err = autoBackupBeforeReplace(ctx, apiClient)
			if err != nil {
				return nil, fmt.Errorf("auto-backup before replace failed: %w (use --no-auto-backup to skip)", err)
			}
		}

		resetCount, err = resetResumesFully(ctx, apiClient)
		if err != nil {
			return nil, err
		}

		_, err = apiClient.ResetCandidateActions(ctx, currentOptions().Workspace)
		if err != nil {
			return nil, fmt.Errorf("reset candidate actions failed: %w", err)
		}
	}

	result := &resumeRestoreResult{
		InputPath:      inputPath,
		Mode:           normalizedMode,
		Reset:          normalizedMode == "replace",
		ResetCount:     resetCount,
		ResetPartial:   resetPartial,
		AutoBackupPath: autoBackupPath,
		Files:          make([]resumeRestoreFileResult, 0, len(restorePaths)),
	}
	if len(restorePaths) == 1 {
		result.FilePath = restorePaths[0]
	}

	for _, restorePath := range restorePaths {
		payload, envelope, err := readResumeBackupFile(restorePath)
		if err != nil {
			return nil, err
		}

		response, err := apiClient.ImportResumeBackup(ctx, json.RawMessage(payload))
		if err != nil {
			return nil, err
		}

		fileResult := resumeRestoreFileResult{
			FilePath:        restorePath,
			Count:           resumeBackupCount(envelope),
			Submitted:       response.Submitted,
			Inserted:        response.Inserted,
			Updated:         response.Updated,
			Unchanged:       response.Unchanged,
			Deduped:         response.Deduped,
			StatusReplayed:  response.StatusReplayed,
			ActionsReplayed: response.ActionsReplayed,
			ActionsDeduped:  response.ActionsDeduped,
		}
		result.Files = append(result.Files, fileResult)
		result.Submitted += fileResult.Submitted
		result.Inserted += fileResult.Inserted
		result.Updated += fileResult.Updated
		result.Unchanged += fileResult.Unchanged
		result.Deduped += fileResult.Deduped
		result.StatusReplayed += fileResult.StatusReplayed
		result.ActionsReplayed += fileResult.ActionsReplayed
		result.ActionsDeduped += fileResult.ActionsDeduped
	}

	return result, nil
}

func autoBackupBeforeReplace(ctx context.Context, apiClient *client.Client) (string, error) {
	backupResult, err := backupResumesToFile(ctx, apiClient, client.ResumeBackupRequest{}, "")
	if err != nil {
		return "", err
	}
	return backupResult.FilePath, nil
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
		Short: "Backup resumes from $API_URL (defaults to local) to a portable file",
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
		mode         string
		yes          bool
		noAutoBackup bool
	)

	cmd := &cobra.Command{
		Use:   "restore <path>",
		Short: "Restore a backup file into $API_URL (defaults to local)",
		Args:  cobra.ExactArgs(1),
		RunE: func(cmd *cobra.Command, args []string) error {
			inputPath := strings.TrimSpace(args[0])
			if inputPath == "" {
				return fmt.Errorf("backup file path is required")
			}

			result, err := restoreResumeBackupPath(context.Background(), newAPIClient(), inputPath, mode, yes, noAutoBackup)
			if err != nil {
				return err
			}

			output := buildResumeRestoreOutput(result, resumeOutputExtras{})
			return writeOutput(cmd, output.Headers, output.Rows, result)
		},
	}

	cmd.Flags().StringVar(&mode, "mode", "replace", "Restore mode: replace|merge (upsert is an alias for merge)")
	cmd.Flags().BoolVar(&yes, "yes", false, "Confirm destructive replace mode")
	cmd.Flags().BoolVar(&noAutoBackup, "no-auto-backup", false, "Skip auto-backup before replace reset")

	return cmd
}

func newResumeFullRestoreCmd() *cobra.Command {
	cmd := &cobra.Command{
		Use:   "full-restore <path>",
		Short: "Replace all local data from backup file (--mode replace --yes with auto-backup)",
		Args:  cobra.ExactArgs(1),
		RunE: func(cmd *cobra.Command, args []string) error {
			inputPath := strings.TrimSpace(args[0])
			if inputPath == "" {
				return fmt.Errorf("backup file path is required")
			}

			result, err := restoreResumeBackupPath(context.Background(), newAPIClient(), inputPath, "replace", true, false)
			if err != nil {
				return err
			}

			output := buildResumeRestoreOutput(result, resumeOutputExtras{})
			return writeOutput(cmd, output.Headers, output.Rows, result)
		},
	}

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
		Short: "Write a resume backup into a deploy backup run directory (.tar.gz by default)",
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
		Short: "Restore from deploy backup run directory (.tar.gz preferred) into $API_URL",
		Args:  cobra.MaximumNArgs(1),
		RunE: func(cmd *cobra.Command, args []string) error {
			runDir, err := resolveDeployBackupRunDir(baseDir, args)
			if err != nil {
				return err
			}

			filePath, err := resolveDeployResumeBackupFilePath(runDir, currentOptions().Workspace)
			if err != nil {
				return err
			}
			result, err := restoreResumeBackupPath(context.Background(), newAPIClient(), filePath, mode, yes, false)
			if err != nil {
				return err
			}
			result.Workspace = currentOptions().Workspace
			result.RunDir = runDir

			output := buildResumeRestoreOutput(result, resumeOutputExtras{
				Workspace: currentOptions().Workspace,
				RunDir:    runDir,
			})
			return writeOutput(cmd, output.Headers, output.Rows, result)
		},
	}

	cmd.Flags().StringVar(&baseDir, "base-dir", defaultResumeDeployBackupDir, "Base deploy backup directory")
	cmd.Flags().StringVar(&mode, "mode", "replace", "Restore mode: replace|merge (upsert is an alias for merge)")
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
	return filepath.Join(runDir, fmt.Sprintf("resumes-%s.tar.gz", normalizeWorkspace(workspace)))
}

func deployResumeBackupFilePaths(runDir string, workspace string) []string {
	normalizedWorkspace := normalizeWorkspace(workspace)
	return []string{
		filepath.Join(runDir, fmt.Sprintf("resumes-%s.tar.gz", normalizedWorkspace)),
		filepath.Join(runDir, fmt.Sprintf("resumes-%s.json", normalizedWorkspace)),
	}
}

func resolveDeployResumeBackupFilePath(runDir string, workspace string) (string, error) {
	candidates := deployResumeBackupFilePaths(runDir, workspace)
	for _, candidate := range candidates {
		info, err := os.Stat(candidate)
		if err == nil {
			if info.IsDir() {
				continue
			}
			return candidate, nil
		}
		if !os.IsNotExist(err) {
			return "", fmt.Errorf("stat deploy backup file %s: %w", candidate, err)
		}
	}

	return "", fmt.Errorf("no deploy resume backup found in %s for workspace %s", runDir, normalizeWorkspace(workspace))
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
