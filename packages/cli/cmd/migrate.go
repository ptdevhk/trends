package cmd

import (
	"context"
	"encoding/json"
	"fmt"
	"os/exec"
	"strings"

	"github.com/spf13/cobra"
)

type convexRunner func(ctx context.Context, migration string, extraArgs ...string) (string, error)

const (
	defaultMigrationLimitArgKey     = "limit"
	manual51jobMigrationLimitArgKey = "batchSize"
	reindexSearchMigration          = "migrations:reindexSearchText"
	backfillIngestMigration         = "migrations:backfillIngestData"
	backfillManual51jobMigration    = "migrations:backfillManual51jobStructuredContent"
	backfillScoreMigration          = "migrations:backfillPrimaryRuleScore"
)

func newMigrateCmd() *cobra.Command {
	migrateCmd := &cobra.Command{
		Use:   "migrate",
		Short: "Convex migration wrappers",
	}

	migrateCmd.AddCommand(
		newMigrateReindexCmd(),
		newMigrateBackfillIngestCmd(),
		newMigrateBackfillManual51jobCmd(),
		newMigrateBackfillScoreCmd(),
	)

	return migrateCmd
}

func newMigrateReindexCmd() *cobra.Command {
	return newMigrationCmd(
		"reindex-search",
		"Run migrations:reindexSearchText",
		reindexSearchMigration,
	)
}

func newMigrateBackfillIngestCmd() *cobra.Command {
	return newLimitedMigrationCmd(
		"backfill-ingest",
		"Run migrations:backfillIngestData",
		backfillIngestMigration,
		"Batch limit",
		migrationLimitArgKey(backfillIngestMigration),
	)
}

func newMigrateBackfillManual51jobCmd() *cobra.Command {
	return newLimitedMigrationCmd(
		"backfill-manual-51job",
		"Run migrations:backfillManual51jobStructuredContent",
		backfillManual51jobMigration,
		"Maximum resumes to scan per invocation",
		migrationLimitArgKey(backfillManual51jobMigration),
	)
}

func newMigrateBackfillScoreCmd() *cobra.Command {
	return newMigrationCmd(
		"backfill-score",
		"Run migrations:backfillPrimaryRuleScore",
		backfillScoreMigration,
	)
}

func migrationLimitArgKey(migration string) string {
	switch migration {
	case backfillManual51jobMigration:
		return manual51jobMigrationLimitArgKey
	default:
		return defaultMigrationLimitArgKey
	}
}

func newMigrationCmd(use string, short string, migration string) *cobra.Command {
	return newMigrationCmdForRunner(use, short, migration, runConvexCommand)
}

func newMigrationCmdForRunner(use string, short string, migration string, runner convexRunner) *cobra.Command {
	return &cobra.Command{
		Use:   use,
		Short: short,
		RunE: func(cmd *cobra.Command, args []string) error {
			output, err := runner(context.Background(), migration)
			if err != nil {
				return err
			}
			return writeMigrationOutput(cmd, migration, output)
		},
	}
}

func newLimitedMigrationCmd(use string, short string, migration string, limitDescription string, limitArgKey string) *cobra.Command {
	return newLimitedMigrationCmdForRunner(use, short, migration, limitDescription, limitArgKey, runConvexCommand)
}

func newLimitedMigrationCmdForRunner(use string, short string, migration string, limitDescription string, limitArgKey string, runner convexRunner) *cobra.Command {
	var limit int

	cmd := &cobra.Command{
		Use:   use,
		Short: short,
		RunE: func(cmd *cobra.Command, args []string) error {
			output, err := runLimitedMigration(context.Background(), runner, migration, limitArgKey, limit)
			if err != nil {
				return err
			}
			return writeMigrationOutput(cmd, migration, output)
		},
	}

	cmd.Flags().IntVar(&limit, "limit", 100, limitDescription)
	return cmd
}

func runConvexCommand(ctx context.Context, migration string, extraArgs ...string) (string, error) {
	projectRoot, err := findProjectRoot()
	if err != nil {
		return "", err
	}

	args := []string{"--workspace", "@trends/convex", "exec", "convex", "run", migration}
	args = append(args, extraArgs...)

	command := exec.CommandContext(ctx, "npm", args...)
	command.Dir = projectRoot
	result, err := command.CombinedOutput()
	output := strings.TrimSpace(string(result))
	if err != nil {
		return output, fmt.Errorf("run npm %s: %w\n%s", strings.Join(args, " "), err, output)
	}
	return output, nil
}

func runLimitedMigration(ctx context.Context, runner convexRunner, migration string, limitArgKey string, limit int) (string, error) {
	payload, err := json.Marshal(map[string]int{
		normalizeMigrationLimitArgKey(limitArgKey): normalizeMigrationLimit(limit),
	})
	if err != nil {
		return "", err
	}
	return runner(ctx, migration, string(payload))
}

func normalizeMigrationLimitArgKey(limitArgKey string) string {
	trimmed := strings.TrimSpace(limitArgKey)
	if trimmed == "" {
		return defaultMigrationLimitArgKey
	}
	return trimmed
}

func normalizeMigrationLimit(limit int) int {
	if limit < 1 {
		return 1
	}
	return limit
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
