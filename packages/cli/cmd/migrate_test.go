package cmd

import (
	"bytes"
	"context"
	"testing"
)

func TestRunLimitedMigrationPassesNormalizedLimit(t *testing.T) {
	var gotMigration string
	var gotArgs []string

	runner := func(ctx context.Context, migration string, extraArgs ...string) (string, error) {
		gotMigration = migration
		gotArgs = append([]string(nil), extraArgs...)
		return `{"ok":true}`, nil
	}

	output, err := runLimitedMigration(context.Background(), runner, backfillManual51jobMigration, manual51jobMigrationLimitArgKey, 0)
	if err != nil {
		t.Fatalf("runLimitedMigration returned error: %v", err)
	}
	if gotMigration != backfillManual51jobMigration {
		t.Fatalf("unexpected migration: %q", gotMigration)
	}
	if len(gotArgs) != 1 || gotArgs[0] != `{"batchSize":1}` {
		t.Fatalf("unexpected migration args: %+v", gotArgs)
	}
	if output != `{"ok":true}` {
		t.Fatalf("unexpected output: %s", output)
	}
}

func TestRunLimitedMigrationKeepsLimitPayloadForOtherMigrations(t *testing.T) {
	var gotArgs []string

	runner := func(ctx context.Context, migration string, extraArgs ...string) (string, error) {
		gotArgs = append([]string(nil), extraArgs...)
		return `{"ok":true}`, nil
	}

	if _, err := runLimitedMigration(context.Background(), runner, backfillIngestMigration, defaultMigrationLimitArgKey, 2); err != nil {
		t.Fatalf("runLimitedMigration returned error: %v", err)
	}
	if len(gotArgs) != 1 || gotArgs[0] != `{"limit":2}` {
		t.Fatalf("unexpected migration args: %+v", gotArgs)
	}
}

func TestNewLimitedMigrationCmdForRunnerWritesOutput(t *testing.T) {
	runner := func(ctx context.Context, migration string, extraArgs ...string) (string, error) {
		if migration != backfillManual51jobMigration {
			t.Fatalf("unexpected migration: %q", migration)
		}
		if len(extraArgs) != 1 || extraArgs[0] != `{"batchSize":100}` {
			t.Fatalf("unexpected migration args: %+v", extraArgs)
		}
		return `{"updatedResumes":4}`, nil
	}

	setCLIOutput(t, "json")
	cmd := newLimitedMigrationCmdForRunner(
		"backfill-manual-51job",
		"Run migrations:backfillManual51jobStructuredContent",
		backfillManual51jobMigration,
		"Maximum resumes to scan per invocation",
		manual51jobMigrationLimitArgKey,
		runner,
	)
	var output bytes.Buffer
	cmd.SetOut(&output)
	cmd.SetErr(&output)
	cmd.SetArgs([]string{"--limit", "100"})

	if err := cmd.Execute(); err != nil {
		t.Fatalf("limited migration command failed: %v", err)
	}

	payload := decodeCommandJSON(t, output)
	if payload["migration"] != backfillManual51jobMigration {
		t.Fatalf("unexpected migration output: %+v", payload)
	}
	text, ok := payload["output"].(string)
	if !ok || text != `{"updatedResumes":4}` {
		t.Fatalf("unexpected command output payload: %+v", payload)
	}
}

func TestNewMigrateBackfillManual51jobCmdConfig(t *testing.T) {
	cmd := newMigrateBackfillManual51jobCmd()
	if cmd.Use != "backfill-manual-51job" {
		t.Fatalf("unexpected use value: %q", cmd.Use)
	}
	limitFlag := cmd.Flags().Lookup("limit")
	if limitFlag == nil {
		t.Fatal("expected limit flag")
	}
	if limitFlag.DefValue != "100" {
		t.Fatalf("unexpected limit default: %q", limitFlag.DefValue)
	}
}
