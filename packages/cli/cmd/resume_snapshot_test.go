package cmd

import (
	"bytes"
	"context"
	"strings"
	"testing"
)

func TestResumeSnapshotCommandPassesFlagsAndWritesJSON(t *testing.T) {
	setResumeCLIConfig(t, "http://localhost:3000", "ops")
	setCLIOutput(t, "json")

	originalRunner := runResumeSnapshot
	t.Cleanup(func() {
		runResumeSnapshot = originalRunner
	})

	runResumeSnapshot = func(ctx context.Context, request resumeSnapshotRequest) (*resumeSnapshotResult, error) {
		if request.APIURL != "http://localhost:3000" {
			t.Fatalf("unexpected api url: %q", request.APIURL)
		}
		if request.Workspace != "ops" {
			t.Fatalf("unexpected workspace: %q", request.Workspace)
		}
		if request.Count != 250 {
			t.Fatalf("unexpected count: %d", request.Count)
		}
		if request.MaxPages != 8 {
			t.Fatalf("unexpected max pages: %d", request.MaxPages)
		}
		if len(request.Sources) != 3 || request.Sources[0] != "job5156" || request.Sources[1] != "51job" || request.Sources[2] != "51job-manual" {
			t.Fatalf("unexpected sources: %+v", request.Sources)
		}
		if request.OutDir != "output/resume-backups/custom" {
			t.Fatalf("unexpected out dir: %q", request.OutDir)
		}
		if request.Job51URL != "https://ehire.51job.com/Revision/talent/search" {
			t.Fatalf("unexpected 51job url: %q", request.Job51URL)
		}
		if request.ManualFile != "~/Downloads/51job.rar" {
			t.Fatalf("unexpected manual file: %q", request.ManualFile)
		}
		if request.CDPEndpoint != "http://127.0.0.1:9333" {
			t.Fatalf("unexpected cdp endpoint: %q", request.CDPEndpoint)
		}
		if !request.UnsafeLimits {
			t.Fatal("expected unsafe limits to be enabled")
		}

		return &resumeSnapshotResult{
			Success:        true,
			APIURL:         request.APIURL,
			Workspace:      request.Workspace,
			RepoRoot:       "/repo",
			RunStamp:       "20260323-010203",
			OutputDir:      "output/resume-backups/20260323-010203",
			CountPerSource: 250,
			Sources: []resumeSnapshotSourceResult{
				{
					Alias:         "job5156",
					SourceHost:    "hr.job5156.com",
					File:          "output/resume-backups/20260323-010203/resume-backup-job5156-top250-20260323-010203.json",
					Count:         250,
					ObservedCount: 250,
					LaunchURL:     "https://hr.job5156.com/search",
				},
			},
		}, nil
	}

	cmd := newResumeSnapshotCmd()
	var output bytes.Buffer
	cmd.SetOut(&output)
	cmd.SetErr(&output)
	cmd.SetArgs([]string{
		"--source", "job5156",
		"--source", "51job",
		"--source", "51job-manual",
		"--count", "250",
		"--max-pages", "8",
		"--out-dir", "output/resume-backups/custom",
		"--51job-url", "https://ehire.51job.com/Revision/talent/search",
		"--manual-file", "~/Downloads/51job.rar",
		"--cdp-endpoint", "http://127.0.0.1:9333",
		"--unsafe-limits",
	})

	if err := cmd.Execute(); err != nil {
		t.Fatalf("resume snapshot command failed: %v", err)
	}

	payload := decodeCommandJSON(t, output)
	if payload["runStamp"] != "20260323-010203" {
		t.Fatalf("unexpected runStamp in output: %+v", payload)
	}
	if payload["workspace"] != "ops" {
		t.Fatalf("unexpected workspace in output: %+v", payload)
	}
}

func TestResumeSnapshotCommandWritesTable(t *testing.T) {
	setResumeCLIConfig(t, "http://localhost:3000", "dev")
	setCLIOutput(t, "table")

	originalRunner := runResumeSnapshot
	t.Cleanup(func() {
		runResumeSnapshot = originalRunner
	})

	runResumeSnapshot = func(ctx context.Context, request resumeSnapshotRequest) (*resumeSnapshotResult, error) {
		return &resumeSnapshotResult{
			Success:   true,
			APIURL:    request.APIURL,
			Workspace: request.Workspace,
			Sources: []resumeSnapshotSourceResult{
				{
					Alias:         "51job-manual",
					SourceHost:    "51job-manual",
					File:          "output/resume-backups/20260323-010203/resume-backup-51job-manual-top20-20260323-010203.json",
					Count:         20,
					ObservedCount: 20,
					ManualFile:    "/tmp/51job.rar",
					ManualImportSummary: &resumeSnapshotManualImportSummary{
						ParsedResumes: intPointer(20),
						Imported:      intPointer(20),
					},
				},
			},
		}, nil
	}

	cmd := newResumeSnapshotCmd()
	var output bytes.Buffer
	cmd.SetOut(&output)
	cmd.SetErr(&output)

	if err := cmd.Execute(); err != nil {
		t.Fatalf("resume snapshot command failed: %v", err)
	}

	text := output.String()
	if !strings.Contains(text, "51job-manual") || !strings.Contains(text, "/tmp/51job.rar") {
		t.Fatalf("unexpected command output: %s", text)
	}
}

func TestResumeSnapshotCommandRejectsZeroCountWhenExplicitlySet(t *testing.T) {
	cmd := newResumeSnapshotCmd()
	cmd.SetArgs([]string{"--count", "0"})

	err := cmd.Execute()
	if err == nil {
		t.Fatal("expected zero count to fail")
	}
	if !strings.Contains(err.Error(), "--count must be greater than 0") {
		t.Fatalf("unexpected error: %v", err)
	}
}

func intPointer(value int) *int {
	return &value
}
