package cmd

import (
	"bytes"
	"context"
	"reflect"
	"testing"
)

func stubConvexExecutor(t *testing.T, executor func(ctx context.Context, args []string) (string, error)) {
	t.Helper()

	originalExecutor := runConvexCommandExecutor
	runConvexCommandExecutor = executor
	t.Cleanup(func() {
		runConvexCommandExecutor = originalExecutor
	})
}

func TestMigrateReindexCommandWritesJSON(t *testing.T) {
	setCLIOutput(t, "json")

	var gotArgs []string
	stubConvexExecutor(t, func(ctx context.Context, args []string) (string, error) {
		gotArgs = append([]string(nil), args...)
		return "reindex complete", nil
	})

	cmd := newMigrateReindexCmd()
	var output bytes.Buffer
	cmd.SetOut(&output)
	cmd.SetErr(&output)

	if err := cmd.Execute(); err != nil {
		t.Fatalf("reindex command failed: %v", err)
	}

	wantArgs := []string{"convex", "run", migrationReindexSearchText}
	if !reflect.DeepEqual(gotArgs, wantArgs) {
		t.Fatalf("unexpected args: got %v want %v", gotArgs, wantArgs)
	}

	payload := decodeCommandJSON(t, output)
	if payload["migration"] != migrationReindexSearchText {
		t.Fatalf("unexpected migration payload: %#v", payload)
	}
	if payload["output"] != "reindex complete" {
		t.Fatalf("unexpected output payload: %#v", payload)
	}
}

func TestMigrateBackfillIngestCommandPassesLimit(t *testing.T) {
	setCLIOutput(t, "json")

	var gotArgs []string
	stubConvexExecutor(t, func(ctx context.Context, args []string) (string, error) {
		gotArgs = append([]string(nil), args...)
		return "backfill complete", nil
	})

	cmd := newMigrateBackfillIngestCmd()
	var output bytes.Buffer
	cmd.SetOut(&output)
	cmd.SetErr(&output)
	cmd.SetArgs([]string{"--limit", "42"})

	if err := cmd.Execute(); err != nil {
		t.Fatalf("backfill-ingest command failed: %v", err)
	}

	wantArgs := []string{"convex", "run", migrationBackfillIngestData, backfillIngestPayload(42)}
	if !reflect.DeepEqual(gotArgs, wantArgs) {
		t.Fatalf("unexpected args: got %v want %v", gotArgs, wantArgs)
	}

	payload := decodeCommandJSON(t, output)
	if payload["migration"] != migrationBackfillIngestData {
		t.Fatalf("unexpected migration payload: %#v", payload)
	}
	if payload["output"] != "backfill complete" {
		t.Fatalf("unexpected output payload: %#v", payload)
	}
}

func TestMigrateBackfillScoreCommandWritesJSON(t *testing.T) {
	setCLIOutput(t, "json")

	var gotArgs []string
	stubConvexExecutor(t, func(ctx context.Context, args []string) (string, error) {
		gotArgs = append([]string(nil), args...)
		return "score backfill complete", nil
	})

	cmd := newMigrateBackfillScoreCmd()
	var output bytes.Buffer
	cmd.SetOut(&output)
	cmd.SetErr(&output)

	if err := cmd.Execute(); err != nil {
		t.Fatalf("backfill-score command failed: %v", err)
	}

	wantArgs := []string{"convex", "run", migrationBackfillPrimaryScore}
	if !reflect.DeepEqual(gotArgs, wantArgs) {
		t.Fatalf("unexpected args: got %v want %v", gotArgs, wantArgs)
	}

	payload := decodeCommandJSON(t, output)
	if payload["migration"] != migrationBackfillPrimaryScore {
		t.Fatalf("unexpected migration payload: %#v", payload)
	}
	if payload["output"] != "score backfill complete" {
		t.Fatalf("unexpected output payload: %#v", payload)
	}
}

func TestRunMCPToolMigrateReindexSearch(t *testing.T) {
	var gotArgs []string
	stubConvexExecutor(t, func(ctx context.Context, args []string) (string, error) {
		gotArgs = append([]string(nil), args...)
		return "mcp reindex complete", nil
	})

	text, err := runMCPTool(context.Background(), "migrate_reindex_search", nil)
	if err != nil {
		t.Fatalf("runMCPTool returned error: %v", err)
	}
	if text != "mcp reindex complete" {
		t.Fatalf("unexpected tool text: %q", text)
	}

	wantArgs := []string{"convex", "run", migrationReindexSearchText}
	if !reflect.DeepEqual(gotArgs, wantArgs) {
		t.Fatalf("unexpected args: got %v want %v", gotArgs, wantArgs)
	}
}

func TestRunMCPToolMigrateBackfillIngestPassesLimit(t *testing.T) {
	var gotArgs []string
	stubConvexExecutor(t, func(ctx context.Context, args []string) (string, error) {
		gotArgs = append([]string(nil), args...)
		return "mcp ingest complete", nil
	})

	text, err := runMCPTool(context.Background(), "migrate_backfill_ingest", map[string]interface{}{"limit": float64(7)})
	if err != nil {
		t.Fatalf("runMCPTool returned error: %v", err)
	}
	if text != "mcp ingest complete" {
		t.Fatalf("unexpected tool text: %q", text)
	}

	wantArgs := []string{"convex", "run", migrationBackfillIngestData, backfillIngestPayload(7)}
	if !reflect.DeepEqual(gotArgs, wantArgs) {
		t.Fatalf("unexpected args: got %v want %v", gotArgs, wantArgs)
	}
}

func TestRunMCPToolMigrateBackfillScore(t *testing.T) {
	var gotArgs []string
	stubConvexExecutor(t, func(ctx context.Context, args []string) (string, error) {
		gotArgs = append([]string(nil), args...)
		return "mcp score complete", nil
	})

	text, err := runMCPTool(context.Background(), "migrate_backfill_score", nil)
	if err != nil {
		t.Fatalf("runMCPTool returned error: %v", err)
	}
	if text != "mcp score complete" {
		t.Fatalf("unexpected tool text: %q", text)
	}

	wantArgs := []string{"convex", "run", migrationBackfillPrimaryScore}
	if !reflect.DeepEqual(gotArgs, wantArgs) {
		t.Fatalf("unexpected args: got %v want %v", gotArgs, wantArgs)
	}
}
