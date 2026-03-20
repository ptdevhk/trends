package cmd

import (
	"context"
	"fmt"
	"os/exec"
	"strings"

	"github.com/spf13/cobra"
)

const (
	migrationReindexSearchText    = "migrations:reindexSearchText"
	migrationBackfillIngestData   = "migrations:backfillIngestData"
	migrationBackfillPrimaryScore = "migrations:backfillPrimaryRuleScore"
)

func backfillIngestPayload(limit int) string {
	return fmt.Sprintf(`{"limit":%d}`, limit)
}

var runConvexCommandExecutor = func(ctx context.Context, args []string) (string, error) {
	command := exec.CommandContext(ctx, "npx", args...)
	result, err := command.CombinedOutput()
	output := strings.TrimSpace(string(result))
	if err != nil {
		return output, fmt.Errorf("run npx %s: %w\n%s", strings.Join(args, " "), err, output)
	}
	return output, nil
}

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
			output, err := runConvexCommand(context.Background(), migrationReindexSearchText)
			if err != nil {
				return err
			}
			return writeMigrationOutput(cmd, migrationReindexSearchText, output)
		},
	}
}

func newMigrateBackfillIngestCmd() *cobra.Command {
	var limit int

	cmd := &cobra.Command{
		Use:   "backfill-ingest",
		Short: "Run migrations:backfillIngestData",
		RunE: func(cmd *cobra.Command, args []string) error {
			argument := backfillIngestPayload(limit)
			output, err := runConvexCommand(context.Background(), migrationBackfillIngestData, argument)
			if err != nil {
				return err
			}
			return writeMigrationOutput(cmd, migrationBackfillIngestData, output)
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
			output, err := runConvexCommand(context.Background(), migrationBackfillPrimaryScore)
			if err != nil {
				return err
			}
			return writeMigrationOutput(cmd, migrationBackfillPrimaryScore, output)
		},
	}
}

func runConvexCommand(ctx context.Context, migration string, extraArgs ...string) (string, error) {
	args := []string{"convex", "run", migration}
	args = append(args, extraArgs...)
	return runConvexCommandExecutor(ctx, args)
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
