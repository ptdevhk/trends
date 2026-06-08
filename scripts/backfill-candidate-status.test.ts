import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

type BackfillModule = typeof import("./backfill-candidate-status.ts");

async function loadModule(): Promise<BackfillModule> {
  return await import("./backfill-candidate-status.ts");
}

describe("candidate status backfill helpers", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    process.exitCode = undefined;
  });

  it("is import-safe and exposes pure planning helpers", async () => {
    const module = await loadModule();

    expect(process.exitCode).toBeUndefined();
    expect(module.createBackfillPlan).toBeTypeOf("function");
    expect(module.writeBackfillReport).toBeTypeOf("function");
    expect(module.runCandidateStatusWrites).toBeTypeOf("function");
  });

  it("keeps only the latest supported action per resume", async () => {
    const { createBackfillPlan } = await loadModule();

    const plan = createBackfillPlan([
      { resume_id: "r1", action_type: "shortlist", created_at: "2026-01-01T00:00:00.000Z" },
      { resume_id: "r1", action_type: "reject", created_at: "2026-02-01T00:00:00.000Z" },
      { resume_id: "r2", action_type: "star", created_at: "2026-01-15T00:00:00.000Z" },
      { resume_id: "r3", action_type: "note", created_at: "2026-01-20T00:00:00.000Z" },
      { resume_id: "   ", action_type: "reject", created_at: "2026-01-22T00:00:00.000Z" },
    ], { maxRows: 10 });

    expect(plan.intended).toBe(2);
    expect(plan.skipped).toEqual({ unsupportedAction: 1, missingResumeId: 1 });
    expect(plan.byAction).toEqual({ reject: 1, star: 1 });
    expect(plan.byStatus).toEqual({ rejected: 1, new: 1 });
    expect(plan.candidates).toEqual([
      {
        identityKey: "r1",
        actionType: "reject",
        status: "rejected",
        actedAt: "2026-02-01T00:00:00.000Z",
      },
      {
        identityKey: "r2",
        actionType: "star",
        status: "new",
        actedAt: "2026-01-15T00:00:00.000Z",
      },
    ]);
  });

  it("rejects plans above the max-row sanity limit", async () => {
    const { createBackfillPlan } = await loadModule();

    expect(() =>
      createBackfillPlan([
        { resume_id: "r1", action_type: "shortlist", created_at: "2026-01-01T00:00:00.000Z" },
        { resume_id: "r2", action_type: "reject", created_at: "2026-01-02T00:00:00.000Z" },
      ], { maxRows: 1 }),
    ).toThrow(/max rows/i);
  });

  it("writes a JSON dry-run report", async () => {
    const { createBackfillPlan, writeBackfillReport } = await loadModule();
    const root = mkdtempSync(path.join(tmpdir(), "trends-candidate-status-backfill-"));

    try {
      const plan = createBackfillPlan([
        { resume_id: "r1", action_type: "shortlist", created_at: "2026-01-01T00:00:00.000Z" },
      ], { maxRows: 10 });

      const report = writeBackfillReport({
        outputDir: root,
        timestamp: "2026-06-08T06:00:00.000Z",
        dryRun: true,
        workspaceSlug: "dev",
        plan,
        writes: 0,
        errors: 0,
      });

      const payload = JSON.parse(readFileSync(report.path, "utf8"));
      expect(payload).toMatchObject({
        dryRun: true,
        workspaceSlug: "dev",
        intended: 1,
        writes: 0,
        errors: 0,
        byAction: { shortlist: 1 },
        byStatus: { shortlisted: 1 },
      });
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("writes candidates in chunks and passes the Convex write secret", async () => {
    const { runCandidateStatusWrites } = await loadModule();
    const mutate = vi.fn().mockResolvedValue("ok");
    const sleep = vi.fn().mockResolvedValue(undefined);

    const result = await runCandidateStatusWrites({
      candidates: [
        { identityKey: "r1", actionType: "shortlist", status: "shortlisted", actedAt: "2026-01-01T00:00:00.000Z" },
        { identityKey: "r2", actionType: "reject", status: "rejected", actedAt: "2026-01-02T00:00:00.000Z" },
        { identityKey: "r3", actionType: "star", status: "new", actedAt: "2026-01-03T00:00:00.000Z" },
      ],
      workspaceSlug: "hr",
      writeSecret: "secret-1",
      batchSize: 2,
      sleepMs: 100,
      mutate,
      sleep,
    });

    expect(result).toEqual({ writes: 3, errors: 0, skippedExisting: 0 });
    expect(mutate).toHaveBeenCalledTimes(3);
    expect(mutate).toHaveBeenCalledWith({
      workspaceSlug: "hr",
      identityKey: "r1",
      status: "shortlisted",
      updatedBy: "backfill-script",
      writeSecret: "secret-1",
    });
    expect(sleep).toHaveBeenCalledOnce();
    expect(sleep).toHaveBeenCalledWith(100);
  });

  it("skips live writes when the Convex status is newer than the SQLite action", async () => {
    const { runCandidateStatusWrites } = await loadModule();
    const mutate = vi.fn().mockResolvedValue("ok");
    const getExistingStatus = vi.fn().mockResolvedValue({
      status: "shortlisted",
      updatedAt: Date.parse("2026-02-01T00:00:00.000Z"),
    });

    const result = await runCandidateStatusWrites({
      candidates: [
        { identityKey: "r1", actionType: "reject", status: "rejected", actedAt: "2026-01-01T00:00:00.000Z" },
      ],
      workspaceSlug: "hr",
      writeSecret: "secret-1",
      batchSize: 50,
      sleepMs: 100,
      mutate,
      getExistingStatus,
    });

    expect(result).toEqual({ writes: 0, errors: 0, skippedExisting: 1 });
    expect(getExistingStatus).toHaveBeenCalledWith({
      identityKey: "r1",
      actionType: "reject",
      status: "rejected",
      actedAt: "2026-01-01T00:00:00.000Z",
    });
    expect(mutate).not.toHaveBeenCalled();
  });
});
