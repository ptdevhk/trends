package cmd

import (
	"context"
	"fmt"
	"os"
	"path/filepath"
	"regexp"
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
		newResumeSearchCmd(),
		newResumeExportCmd(),
	)

	return resumeCmd
}

func newResumeListCmd() *cobra.Command {
	var limit int

	cmd := &cobra.Command{
		Use:   "list",
		Short: "List resumes",
		RunE: func(cmd *cobra.Command, args []string) error {
			response, err := newAPIClient().ListResumes(context.Background(), limit, "")
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

func newResumeSearchCmd() *cobra.Command {
	var limit int

	cmd := &cobra.Command{
		Use:   "search <query>",
		Short: "Search resumes",
		Args:  cobra.ExactArgs(1),
		RunE: func(cmd *cobra.Command, args []string) error {
			response, err := newAPIClient().SearchResumes(context.Background(), args[0], limit)
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

			resumes, err := newAPIClient().ListResumes(context.Background(), limit, query)
			if err != nil {
				return err
			}
			if len(resumes.Data) == 0 {
				return writeMessage(cmd, "No resumes to export")
			}

			entries := make([]client.ResumeExportEntry, 0, len(resumes.Data))
			for index, item := range resumes.Data {
				entries = append(entries, client.ResumeExportEntry{
					Key:    resumeIdentifier(item, index),
					Resume: item,
				})
			}

			payload, disposition, err := newAPIClient().ExportResumes(context.Background(), client.ResumeExportRequest{
				Format:  format,
				Entries: entries,
			})
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

func resumeIdentifier(item client.ResumeItem, index int) string {
	if strings.TrimSpace(item.ResumeID) != "" {
		return item.ResumeID
	}
	if strings.TrimSpace(item.PerUserID) != "" {
		return item.PerUserID
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
