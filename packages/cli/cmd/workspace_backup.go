package cmd

import (
	"context"
	"encoding/json"
	"fmt"
	"path/filepath"
	"strings"
	"time"

	"github.com/ptdevhk/trends/packages/cli/internal/client"
	"github.com/spf13/cobra"
)

// Snapshot envelope schema version; must stay in lockstep with
// apps/api/src/routes/workspace-snapshots.ts and
// packages/convex/convex/workspace_snapshots.ts (SNAPSHOT_SCHEMA_VERSION).
const workspaceSnapshotSchemaVersion = 1

type workspaceSnapshotEnvelope struct {
	SchemaVersion int                             `json:"schemaVersion"`
	Profile       string                          `json:"profile"`
	Tables        client.WorkspaceSnapshotTables `json:"tables"`
}

type workspaceRestoreResult struct {
	InputPath string `json:"inputPath"`
	client.WorkspaceSnapshotImportResult
}

func normalizeWorkspaceSnapshotProfile(profile string) (string, error) {
	normalizedProfile := strings.ToLower(strings.TrimSpace(profile))
	if normalizedProfile == "" {
		normalizedProfile = "hr-ops"
	}
	if normalizedProfile != "hr-ops" && normalizedProfile != "full" {
		return "", fmt.Errorf("invalid profile %q (expected hr-ops|full)", profile)
	}
	return normalizedProfile, nil
}

func defaultWorkspaceBackupOutputPath() string {
	return filepath.Join("output", "workspace-backups", fmt.Sprintf("workspace-backup-%s.json", time.Now().Format("20060102-150405")))
}

func readWorkspaceSnapshotFile(filePath string) (*workspaceSnapshotEnvelope, error) {
	payload, err := readPortableBackupFile(filePath)
	if err != nil {
		return nil, err
	}

	var envelope workspaceSnapshotEnvelope
	if err := json.Unmarshal(payload, &envelope); err != nil {
		return nil, fmt.Errorf("invalid workspace snapshot file: %w", err)
	}
	if envelope.SchemaVersion != workspaceSnapshotSchemaVersion {
		return nil, fmt.Errorf("unsupported workspace snapshot schemaVersion %d (expected %d)", envelope.SchemaVersion, workspaceSnapshotSchemaVersion)
	}
	if envelope.Profile == "" {
		return nil, fmt.Errorf("invalid workspace snapshot file: missing profile")
	}
	return &envelope, nil
}

func newWorkspaceCmd() *cobra.Command {
	workspaceCmd := &cobra.Command{
		Use:   "workspace",
		Short: "Export and import workspace snapshots (admin)",
	}

	workspaceCmd.AddCommand(
		newWorkspaceBackupCmd(),
		newWorkspaceRestoreCmd(),
	)

	return workspaceCmd
}

func newWorkspaceBackupCmd() *cobra.Command {
	var (
		profile string
		outPath string
	)

	cmd := &cobra.Command{
		Use:   "backup",
		Short: "Back up workspace state to a portable snapshot file",
		RunE: func(cmd *cobra.Command, args []string) error {
			normalizedProfile, err := normalizeWorkspaceSnapshotProfile(profile)
			if err != nil {
				return err
			}

			result, err := newAPIClient().ExportWorkspaceSnapshot(context.Background(), normalizedProfile)
			if err != nil {
				return err
			}

			payload, err := json.Marshal(result)
			if err != nil {
				return fmt.Errorf("marshal workspace snapshot: %w", err)
			}

			resolvedPath := strings.TrimSpace(outPath)
			if resolvedPath == "" {
				resolvedPath = defaultWorkspaceBackupOutputPath()
			}
			bytesWritten, err := writePortableBackupFile(resolvedPath, payload)
			if err != nil {
				return err
			}

			summary := map[string]any{
				"profile":   result.Profile,
				"workspace": result.WorkspaceSlug,
				"file":      resolvedPath,
				"bytes":     bytesWritten,
			}
			headers := []string{"workspace", "profile", "file", "bytes"}
			row := []string{result.WorkspaceSlug, result.Profile, resolvedPath, fmt.Sprintf("%d", bytesWritten)}
			return writeOutput(cmd, headers, [][]string{row}, summary)
		},
	}

	cmd.Flags().StringVar(&profile, "profile", "hr-ops", "Snapshot profile: hr-ops|full")
	cmd.Flags().StringVar(&outPath, "out", "", "Output file path")

	return cmd
}

func newWorkspaceRestoreCmd() *cobra.Command {
	var (
		mode string
		yes  bool
	)

	cmd := &cobra.Command{
		Use:   "restore <path>",
		Short: "Restore a workspace snapshot file into the target workspace (replace wipes the workspace tables)",
		Args:  cobra.ExactArgs(1),
		RunE: func(cmd *cobra.Command, args []string) error {
			normalizedMode, err := normalizeResumeRestoreMode(mode)
			if err != nil {
				return err
			}
			if normalizedMode == "replace" && !yes {
				return fmt.Errorf("restore mode replace requires --yes")
			}

			inputPath := strings.TrimSpace(args[0])
			envelope, err := readWorkspaceSnapshotFile(inputPath)
			if err != nil {
				return err
			}

			result, err := newAPIClient().ImportWorkspaceSnapshot(context.Background(), client.WorkspaceSnapshotImportRequest{
				SchemaVersion: envelope.SchemaVersion,
				Profile:       envelope.Profile,
				Mode:          normalizedMode,
				Tables:        envelope.Tables,
			})
			if err != nil {
				return err
			}

			headers := []string{
				"workspace", "profile", "mode", "input_path",
				"applied_candidate_status", "applied_candidate_blocks", "applied_search_profiles", "applied_workspace_config",
				"deleted_candidate_status", "deleted_candidate_blocks", "deleted_search_profiles", "deleted_workspace_config",
			}
			row := []string{
				result.WorkspaceSlug, result.Profile, result.Mode, inputPath,
				fmt.Sprintf("%d", result.Applied.CandidateStatus),
				fmt.Sprintf("%d", result.Applied.CandidateBlocks),
				fmt.Sprintf("%d", result.Applied.SearchProfiles),
				fmt.Sprintf("%d", result.Applied.WorkspaceConfig),
				fmt.Sprintf("%d", result.Deleted.CandidateStatus),
				fmt.Sprintf("%d", result.Deleted.CandidateBlocks),
				fmt.Sprintf("%d", result.Deleted.SearchProfiles),
				fmt.Sprintf("%d", result.Deleted.WorkspaceConfig),
			}
			return writeOutput(cmd, headers, [][]string{row}, workspaceRestoreResult{
				InputPath:                     inputPath,
				WorkspaceSnapshotImportResult: *result,
			})
		},
	}

	cmd.Flags().StringVar(&mode, "mode", "replace", "Restore mode: replace|merge (upsert is an alias for merge)")
	cmd.Flags().BoolVar(&yes, "yes", false, "Confirm destructive replace mode")

	return cmd
}
