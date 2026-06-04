package cmd

import (
	"context"
	"encoding/json"
	"fmt"
	"os/exec"
	"regexp"
	"strconv"
	"strings"

	"github.com/spf13/cobra"
)

type convexRunner func(ctx context.Context, migration string, extraArgs ...string) (string, error)

const (
	defaultMigrationLimitArgKey     = "limit"
	manual51jobMigrationLimitArgKey = "batchSize"
	reindexBatchSizeArgKey          = "batchSize"
	defaultReindexBatchSize         = 100
	maxPaginatedMigrationIterations = 10000

	migrationReindexSearchText    = "migrations:reindexSearchText"
	migrationBackfillIngestData   = "migrations:backfillIngestData"
	backfillManual51jobMigration  = "migrations:backfillManual51jobStructuredContent"
	migrationBackfillPrimaryScore = "migrations:backfillPrimaryRuleScore"
	migrationBackfillVerifiedRoleYears = "migrations:backfillVerifiedRoleYears"
	migrationValidateConsistency    = "migrations:validateDataConsistency"
)

type paginatedMigrationBatchResult struct {
	ScannedResumes int
	UpdatedResumes int
	HasMore        bool
	Cursor         *string
}

type paginatedMigrationSummary struct {
	Batches        int `json:"batches"`
	ScannedResumes int `json:"scannedResumes"`
	UpdatedResumes int `json:"updatedResumes"`
}

var (
	scannedResumesFieldPattern = regexp.MustCompile(`(?m)["']?scannedResumes["']?\s*:\s*([0-9]+)`)
	updatedResumesFieldPattern = regexp.MustCompile(`(?m)["']?updatedResumes["']?\s*:\s*([0-9]+)`)
	hasMoreFieldPattern        = regexp.MustCompile(`(?m)["']?hasMore["']?\s*:\s*(true|false)`)
	cursorFieldPattern         = regexp.MustCompile(`(?m)["']?cursor["']?\s*:\s*(null|"([^"\\]|\\.)*"|'([^'\\]|\\.)*')`)
)

var runConvexCommandExecutor = func(ctx context.Context, args []string) (string, error) {
	projectRoot, err := findProjectRoot()
	if err != nil {
		return "", err
	}

	commandArgs := []string{"--workspace", "@trends/convex", "exec"}
	commandArgs = append(commandArgs, args...)

	command := exec.CommandContext(ctx, "npm", commandArgs...)
	command.Dir = projectRoot
	result, err := command.CombinedOutput()
	output := strings.TrimSpace(string(result))
	if err != nil {
		return output, fmt.Errorf("run npm %s: %w\n%s", strings.Join(commandArgs, " "), err, output)
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
		newMigrateBackfillManual51jobCmd(),
		newMigrateBackfillScoreCmd(),
		newMigrateBackfillVerifiedRoleYearsCmd(),
		newMigrateValidateConsistencyCmd(),
	)

	return migrateCmd
}

func newMigrateReindexCmd() *cobra.Command {
	return newPaginatedMigrationCmd(
		"reindex-search",
		"Run migrations:reindexSearchText until complete",
		migrationReindexSearchText,
		"Batch size",
		defaultReindexBatchSize,
	)
}

func newMigrateBackfillIngestCmd() *cobra.Command {
	return newLimitedMigrationCmd(
		"backfill-ingest",
		"Run migrations:backfillIngestData",
		migrationBackfillIngestData,
		"Batch limit",
		migrationLimitArgKey(migrationBackfillIngestData),
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
		migrationBackfillPrimaryScore,
	)
}

func newMigrateBackfillVerifiedRoleYearsCmd() *cobra.Command {
	return newPaginatedMigrationCmd(
		"backfill-verified-role-years",
		"Run migrations:backfillVerifiedRoleYears until complete",
		migrationBackfillVerifiedRoleYears,
		"Batch size",
		defaultReindexBatchSize,
	)
}

func newMigrateValidateConsistencyCmd() *cobra.Command {
	var forceFlag bool

	cmd := &cobra.Command{
		Use:   "validate-consistency",
		Short: "Run full data consistency validation and repair (searchText + verifiedRoleYears + resume digests)",
		RunE: func(cmd *cobra.Command, args []string) error {
			var extraArgs []string
			if forceFlag {
				payload, err := json.Marshal(map[string]bool{"force": true})
				if err != nil {
					return err
				}
				extraArgs = append(extraArgs, string(payload))
			}
			output, err := runConvexCommand(context.Background(), migrationValidateConsistency, extraArgs...)
			if err != nil {
				return err
			}
			return writeMigrationOutput(cmd, migrationValidateConsistency, output)
		},
	}

	cmd.Flags().BoolVar(&forceFlag, "force", false, "Force reindex all documents (refreshes search index even when searchText is unchanged)")
	return cmd
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

func newPaginatedMigrationCmd(use string, short string, migration string, batchSizeDescription string, defaultBatchSize int) *cobra.Command {
	return newPaginatedMigrationCmdForRunner(use, short, migration, batchSizeDescription, defaultBatchSize, runConvexCommand)
}

func newPaginatedMigrationCmdForRunner(use string, short string, migration string, batchSizeDescription string, defaultBatchSize int, runner convexRunner) *cobra.Command {
	batchSize := defaultBatchSize

	cmd := &cobra.Command{
		Use:   use,
		Short: short,
		RunE: func(cmd *cobra.Command, args []string) error {
			output, err := runPaginatedMigration(context.Background(), runner, migration, batchSize)
			if err != nil {
				return err
			}
			return writeMigrationOutput(cmd, migration, output)
		},
	}

	cmd.Flags().IntVar(&batchSize, "batch-size", defaultBatchSize, batchSizeDescription)
	return cmd
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
	args := []string{"convex", "run", migration}
	args = append(args, extraArgs...)
	return runConvexCommandExecutor(ctx, args)
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

func runPaginatedMigration(ctx context.Context, runner convexRunner, migration string, batchSize int) (string, error) {
	cursor := (*string)(nil)
	summary := paginatedMigrationSummary{}

	for iteration := 0; iteration < maxPaginatedMigrationIterations; iteration += 1 {
		payload, err := buildPaginatedMigrationPayload(batchSize, cursor)
		if err != nil {
			return "", err
		}

		output, err := runner(ctx, migration, payload)
		if err != nil {
			return "", err
		}

		batch, err := parsePaginatedMigrationBatch(output)
		if err != nil {
			return "", err
		}

		summary.Batches += 1
		summary.ScannedResumes += batch.ScannedResumes
		summary.UpdatedResumes += batch.UpdatedResumes

		if !batch.HasMore {
			encoded, err := json.Marshal(summary)
			if err != nil {
				return "", err
			}
			return string(encoded), nil
		}

		cursor = batch.Cursor
	}

	return "", fmt.Errorf("%s exceeded maximum pagination iterations (%d)", migration, maxPaginatedMigrationIterations)
}

func buildPaginatedMigrationPayload(batchSize int, cursor *string) (string, error) {
	payload := map[string]interface{}{
		reindexBatchSizeArgKey: normalizeMigrationLimit(batchSize),
	}
	if cursor != nil && strings.TrimSpace(*cursor) != "" {
		payload["cursor"] = *cursor
	}

	encoded, err := json.Marshal(payload)
	if err != nil {
		return "", err
	}
	return string(encoded), nil
}

func parsePaginatedMigrationBatch(output string) (paginatedMigrationBatchResult, error) {
	trimmed := strings.TrimSpace(output)
	if trimmed == "" {
		return paginatedMigrationBatchResult{}, fmt.Errorf("empty paginated migration output")
	}

	var decoded struct {
		ScannedResumes int     `json:"scannedResumes"`
		UpdatedResumes int     `json:"updatedResumes"`
		HasMore        bool    `json:"hasMore"`
		Cursor         *string `json:"cursor"`
	}
	if err := json.Unmarshal([]byte(trimmed), &decoded); err == nil {
		return paginatedMigrationBatchResult{
			ScannedResumes: decoded.ScannedResumes,
			UpdatedResumes: decoded.UpdatedResumes,
			HasMore:        decoded.HasMore,
			Cursor:         decoded.Cursor,
		}, nil
	}

	scannedResumes, ok := extractRegexInt(trimmed, scannedResumesFieldPattern)
	if !ok {
		return paginatedMigrationBatchResult{}, fmt.Errorf("unable to parse scannedResumes from %q", trimmed)
	}
	updatedResumes, ok := extractRegexInt(trimmed, updatedResumesFieldPattern)
	if !ok {
		return paginatedMigrationBatchResult{}, fmt.Errorf("unable to parse updatedResumes from %q", trimmed)
	}
	hasMore, ok := extractRegexBool(trimmed, hasMoreFieldPattern)
	if !ok {
		return paginatedMigrationBatchResult{}, fmt.Errorf("unable to parse hasMore from %q", trimmed)
	}
	cursor, ok := extractRegexNullableString(trimmed, cursorFieldPattern)
	if !ok && hasMore {
		return paginatedMigrationBatchResult{}, fmt.Errorf("unable to parse cursor from %q", trimmed)
	}

	return paginatedMigrationBatchResult{
		ScannedResumes: scannedResumes,
		UpdatedResumes: updatedResumes,
		HasMore:        hasMore,
		Cursor:         cursor,
	}, nil
}

func extractRegexInt(input string, pattern *regexp.Regexp) (int, bool) {
	match := pattern.FindStringSubmatch(input)
	if len(match) < 2 {
		return 0, false
	}
	value, err := strconv.Atoi(match[1])
	if err != nil {
		return 0, false
	}
	return value, true
}

func extractRegexBool(input string, pattern *regexp.Regexp) (bool, bool) {
	match := pattern.FindStringSubmatch(input)
	if len(match) < 2 {
		return false, false
	}
	switch match[1] {
	case "true":
		return true, true
	case "false":
		return false, true
	default:
		return false, false
	}
}

func extractRegexNullableString(input string, pattern *regexp.Regexp) (*string, bool) {
	match := pattern.FindStringSubmatch(input)
	if len(match) < 2 {
		return nil, false
	}
	rawValue := match[1]
	if rawValue == "null" {
		return nil, true
	}

	decoded, err := strconv.Unquote(rawValue)
	if err != nil {
		return nil, false
	}
	return &decoded, true
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
