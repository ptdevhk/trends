package cmd

import (
	"context"
	"fmt"
	"os/exec"
	"strings"

	"github.com/spf13/cobra"
)

func newMigrateCmd() *cobra.Command {
	migrateCmd := &cobra.Command{
		Use:   "migrate",
		Short: "Convex migration wrappers",
	}

	migrateCmd.AddCommand(
		newMigrateReindexCmd(),
		newMigrateBackfillIngestCmd(),
		newMigrateBackfillScoreCmd(),
	)

	return migrateCmd
}

func newMigrateReindexCmd() *cobra.Command {
	return &cobra.Command{
		Use:   "reindex-search",
		Short: "Run migrations:reindexSearchText",
		RunE: func(cmd *cobra.Command, args []string) error {
			output, err := runConvexCommand(context.Background(), "migrations:reindexSearchText")
			if err != nil {
				return err
			}
			return writeMigrationOutput(cmd, "migrations:reindexSearchText", output)
		},
	}
}

func newMigrateBackfillIngestCmd() *cobra.Command {
	var limit int

	cmd := &cobra.Command{
		Use:   "backfill-ingest",
		Short: "Run migrations:backfillIngestData",
		RunE: func(cmd *cobra.Command, args []string) error {
			argument := fmt.Sprintf(`{"limit":%d}`, limit)
			output, err := runConvexCommand(context.Background(), "migrations:backfillIngestData", argument)
			if err != nil {
				return err
			}
			return writeMigrationOutput(cmd, "migrations:backfillIngestData", output)
		},
	}

	cmd.Flags().IntVar(&limit, "limit", 100, "Batch limit")
	return cmd
}

func newMigrateBackfillScoreCmd() *cobra.Command {
	return &cobra.Command{
		Use:   "backfill-score",
		Short: "Run migrations:backfillPrimaryRuleScore",
		RunE: func(cmd *cobra.Command, args []string) error {
			output, err := runConvexCommand(context.Background(), "migrations:backfillPrimaryRuleScore")
			if err != nil {
				return err
			}
			return writeMigrationOutput(cmd, "migrations:backfillPrimaryRuleScore", output)
		},
	}
}

func runConvexCommand(ctx context.Context, migration string, extraArgs ...string) (string, error) {
	args := []string{"convex", "run", migration}
	args = append(args, extraArgs...)

	command := exec.CommandContext(ctx, "npx", args...)
	result, err := command.CombinedOutput()
	output := strings.TrimSpace(string(result))
	if err != nil {
		return output, fmt.Errorf("run npx %s: %w\n%s", strings.Join(args, " "), err, output)
	}
	return output, nil
}

func writeMigrationOutput(cmd *cobra.Command, migration string, output string) error {
	raw := map[string]string{
		"migration": migration,
		"output":    output,
	}
	headers := []string{"migration", "output"}
	rows := [][]string{{migration, output}}
	return writeOutput(cmd, headers, rows, raw)
}
