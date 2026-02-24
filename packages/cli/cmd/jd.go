package cmd

import (
	"context"
	"fmt"
	"os"
	"path/filepath"
	"strings"

	"github.com/ptdevhk/trends/packages/cli/internal/client"
	"github.com/spf13/cobra"
)

func newJDCmd() *cobra.Command {
	jdCmd := &cobra.Command{
		Use:   "jd",
		Short: "Job description operations",
	}

	jdCmd.AddCommand(
		newJDListCmd(),
		newJDCreateCmd(),
	)

	return jdCmd
}

func newJDListCmd() *cobra.Command {
	return &cobra.Command{
		Use:   "list",
		Short: "List job descriptions",
		RunE: func(cmd *cobra.Command, args []string) error {
			response, err := newAPIClient().ListJobDescriptions(context.Background())
			if err != nil {
				return err
			}

			headers := []string{"name", "title", "status", "updated_at"}
			rows := make([][]string, 0, len(response.Items))
			for _, item := range response.Items {
				rows = append(rows, []string{item.Name, item.Title, item.Status, item.UpdatedAt})
			}

			return writeOutput(cmd, headers, rows, response)
		},
	}
}

func newJDCreateCmd() *cobra.Command {
	var name string
	var overwrite bool

	cmd := &cobra.Command{
		Use:   "create <file>",
		Short: "Create a job description from a markdown file",
		Args:  cobra.ExactArgs(1),
		RunE: func(cmd *cobra.Command, args []string) error {
			filePath := strings.TrimSpace(args[0])
			content, err := os.ReadFile(filePath)
			if err != nil {
				return fmt.Errorf("read file %s: %w", filePath, err)
			}

			resolvedName := strings.TrimSpace(name)
			if resolvedName == "" {
				resolvedName = strings.TrimSuffix(filepath.Base(filePath), filepath.Ext(filePath))
			}

			response, err := newAPIClient().CreateJobDescription(context.Background(), client.CreateJobDescriptionRequest{
				Name:      resolvedName,
				Content:   string(content),
				Overwrite: overwrite,
			})
			if err != nil {
				return err
			}

			raw := map[string]any{
				"name":   response.Item.Name,
				"title":  response.Item.Title,
				"status": response.Item.Status,
			}
			headers := []string{"name", "title", "status"}
			rows := [][]string{{response.Item.Name, response.Item.Title, response.Item.Status}}
			return writeOutput(cmd, headers, rows, raw)
		},
	}

	cmd.Flags().StringVar(&name, "name", "", "Job description name (defaults to filename)")
	cmd.Flags().BoolVar(&overwrite, "overwrite", false, "Overwrite existing file")
	return cmd
}
