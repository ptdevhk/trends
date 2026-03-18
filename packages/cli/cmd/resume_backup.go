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

type resumeBackupEnvelope struct {
	Metadata json.RawMessage   `json:"metadata"`
	Resumes  []json.RawMessage `json:"resumes"`
	Data     []json.RawMessage `json:"data"`
}

func isJSONObject(raw json.RawMessage) bool {
	if len(raw) == 0 {
		return false
	}

	var value map[string]any
	return json.Unmarshal(raw, &value) == nil
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

			payload, disposition, err := newAPIClient().BackupResumes(context.Background(), request)
			if err != nil {
				return err
			}

			var envelope resumeBackupEnvelope
			if err := json.Unmarshal(payload, &envelope); err != nil {
				return fmt.Errorf("decode backup payload: %w", err)
			}
			if !isJSONObject(envelope.Metadata) {
				return fmt.Errorf("backup payload is missing metadata")
			}

			resolvedPath := strings.TrimSpace(outPath)
			if resolvedPath == "" {
				resolvedPath = extractFilename(disposition)
			}
			if resolvedPath == "" {
				resolvedPath = fmt.Sprintf("resume-backup-%s.json", time.Now().Format("20060102-150405"))
			}

			if err := writeJSONFile(resolvedPath, payload); err != nil {
				return err
			}

			total := len(envelope.Resumes)
			if total == 0 {
				total = len(envelope.Data)
			}

			summary := map[string]any{
				"count": total,
				"file":  resolvedPath,
				"bytes": len(payload),
			}
			headers := []string{"count", "file", "bytes"}
			rows := [][]string{{
				fmt.Sprintf("%d", total),
				resolvedPath,
				fmt.Sprintf("%d", len(payload)),
			}}
			return writeOutput(cmd, headers, rows, summary)
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

			payload, err := os.ReadFile(filePath)
			if err != nil {
				return fmt.Errorf("read backup file: %w", err)
			}

			var envelope resumeBackupEnvelope
			if err := json.Unmarshal(payload, &envelope); err != nil {
				return fmt.Errorf("invalid backup file: %w", err)
			}
			if !isJSONObject(envelope.Metadata) {
				return fmt.Errorf("invalid backup file: missing metadata")
			}
			if len(envelope.Resumes) == 0 && len(envelope.Data) == 0 {
				return fmt.Errorf("invalid backup file: missing resumes or data array")
			}

			normalizedMode := strings.ToLower(strings.TrimSpace(mode))
			if normalizedMode == "" {
				normalizedMode = "upsert"
			}
			if normalizedMode != "upsert" && normalizedMode != "replace" {
				return fmt.Errorf("invalid mode %q (expected upsert|replace)", mode)
			}
			if normalizedMode == "replace" && !yes {
				return fmt.Errorf("restore mode replace requires --yes")
			}

			resetCount := 0
			resetPartial := false
			if normalizedMode == "replace" {
				resetResponse, err := newAPIClient().ResetResumes(context.Background())
				if err != nil {
					return err
				}
				resetCount = resetResponse.Count
				resetPartial = resetResponse.Partial
			}

			response, err := newAPIClient().ImportResumeBackup(context.Background(), json.RawMessage(payload))
			if err != nil {
				return err
			}

			summary := map[string]any{
				"mode":         normalizedMode,
				"file":         filePath,
				"reset":        normalizedMode == "replace",
				"resetCount":   resetCount,
				"resetPartial": resetPartial,
				"submitted":    response.Submitted,
				"inserted":     response.Inserted,
				"updated":      response.Updated,
				"unchanged":    response.Unchanged,
				"deduped":      response.Deduped,
			}
			headers := []string{"mode", "file", "reset", "reset_count", "reset_partial", "submitted", "inserted", "updated", "unchanged", "deduped"}
			rows := [][]string{{
				normalizedMode,
				filePath,
				fmt.Sprintf("%t", normalizedMode == "replace"),
				fmt.Sprintf("%d", resetCount),
				fmt.Sprintf("%t", resetPartial),
				fmt.Sprintf("%d", response.Submitted),
				fmt.Sprintf("%d", response.Inserted),
				fmt.Sprintf("%d", response.Updated),
				fmt.Sprintf("%d", response.Unchanged),
				fmt.Sprintf("%d", response.Deduped),
			}}
			return writeOutput(cmd, headers, rows, summary)
		},
	}

	cmd.Flags().StringVar(&mode, "mode", "upsert", "Restore mode: upsert|replace")
	cmd.Flags().BoolVar(&yes, "yes", false, "Confirm destructive replace mode")

	return cmd
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
