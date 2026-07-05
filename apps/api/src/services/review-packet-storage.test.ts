import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

import { ReviewPacketStorage } from "./review-packet-storage";
import { getResumeScreeningDb, resetResumeScreeningDb } from "./database";

function createFixtureRoot(): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "review-packet-storage-"));
  fs.mkdirSync(path.join(root, "output"), { recursive: true });
  fs.writeFileSync(path.join(root, "pyproject.toml"), "", "utf8");
  return root;
}

describe("ReviewPacketStorage", () => {
  let root = "";

  afterEach(() => {
    vi.restoreAllMocks();
    resetResumeScreeningDb();
    if (root) {
      fs.rmSync(root, { recursive: true, force: true });
      root = "";
    }
  });

  it("creates, retrieves, and lists tracked runs", () => {
    root = createFixtureRoot();
    const storage = new ReviewPacketStorage(root);

    const created = storage.createRun({
      id: "packet-1",
      workspaceSlug: "hr",
      source: "convex",
      jobDescriptionId: "lathe-sales",
      format: "xlsx",
      totalCount: 2,
      packetFilename: "packet-1.xlsx",
      exportedAt: "2026-03-20T09:00:00+08:00",
      items: [
        { resumeId: "resume-1", identityKey: "profileUrl:resume-1", name: "Alice" },
        { resumeId: "resume-2", identityKey: "profileUrl:resume-2", name: "Bob" },
      ],
    });

    expect(created.id).toBe("packet-1");
    expect(created.workspaceSlug).toBe("hr");
    expect(created.items).toHaveLength(2);

    const fetched = storage.getRun("packet-1", "hr");
    expect(fetched?.packetFilename).toBe("packet-1.xlsx");

    const listed = storage.listRuns("hr");
    expect(listed.map((run) => run.id)).toEqual(["packet-1"]);
  });

  it("records feedback import and summary updates", () => {
    root = createFixtureRoot();
    const storage = new ReviewPacketStorage(root);

    storage.createRun({
      id: "packet-2",
      workspaceSlug: "dev",
      source: "sample",
      sampleName: "sample-initial",
      format: "csv",
      totalCount: 1,
      packetFilename: "packet-2.csv",
      exportedAt: "2026-03-20T10:00:00+08:00",
      items: [{ resumeId: "resume-3", identityKey: "resume-3", name: "Carol" }],
    });

    const imported = storage.recordFeedbackImport({
      id: "packet-2",
      workspaceSlug: "dev",
      stats: {
        importedAt: "2026-03-20T10:30:00+08:00",
        fileName: "reviewed.xlsx",
        totalRows: 1,
        matchedRows: 1,
        importedRows: 1,
        reviewedCount: 1,
        statusUpdates: 1,
        actionUpdates: 1,
        noteUpdates: 0,
        invalidRows: 0,
        duplicateRows: 0,
        warningCount: 1,
        matchedByProfileUrlCount: 0,
        nameMismatchCount: 1,
        reviewedResumeIds: ["resume-3"],
        warnings: ["Name edited"],
      },
    });

    expect(imported?.status).toBe("feedback_imported");
    expect(imported?.stats?.import?.fileName).toBe("reviewed.xlsx");

    const summarized = storage.updateSummaryStats({
      id: "packet-2",
      workspaceSlug: "dev",
      sent: true,
      stats: {
        previewedAt: "2026-03-20T10:35:00+08:00",
        sentAt: "2026-03-20T10:40:00+08:00",
        channel: "wechat_work",
        reviewedCount: 1,
        pendingCount: 0,
        warningCount: 1,
        statusBreakdown: { interviewed_pass: 1 },
        actionBreakdown: { shortlist: 1 },
      },
    });

    expect(summarized?.status).toBe("summary_sent");
    expect(summarized?.summaryChannel).toBe("wechat_work");
    expect(summarized?.stats?.summary?.actionBreakdown.shortlist).toBe(1);
  });

  it("marks a run as failed", () => {
    root = createFixtureRoot();
    const storage = new ReviewPacketStorage(root);

    storage.createRun({
      id: "packet-3",
      workspaceSlug: "dev",
      source: "convex",
      format: "xlsx",
      totalCount: 5,
      exportedAt: "2026-03-20T11:00:00+08:00",
      items: [],
    });

    const failed = storage.markFailed({
      id: "packet-3",
      workspaceSlug: "dev",
      error: "Export file missing",
    });

    expect(failed?.status).toBe("failed");
    expect(failed?.error).toBe("Export file missing");
  });

  it("isolates runs by workspace", () => {
    root = createFixtureRoot();
    const storage = new ReviewPacketStorage(root);

    storage.createRun({
      id: "packet-hr",
      workspaceSlug: "hr",
      source: "convex",
      format: "xlsx",
      totalCount: 1,
      exportedAt: "2026-03-20T12:00:00+08:00",
      items: [{ resumeId: "r1", identityKey: "r1" }],
    });

    storage.createRun({
      id: "packet-dev",
      workspaceSlug: "dev",
      source: "convex",
      format: "xlsx",
      totalCount: 1,
      exportedAt: "2026-03-20T12:01:00+08:00",
      items: [{ resumeId: "r2", identityKey: "r2" }],
    });

    expect(storage.listRuns("hr").map((r) => r.id)).toEqual(["packet-hr"]);
    expect(storage.listRuns("dev").map((r) => r.id)).toEqual(["packet-dev"]);
    expect(storage.getRun("packet-hr", "dev")).toBeNull();
  });

  it("logs malformed items_json and falls back to an empty item list", () => {
    root = createFixtureRoot();
    const storage = new ReviewPacketStorage(root);
    const consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    storage.createRun({
      id: "packet-bad-items",
      workspaceSlug: "dev",
      source: "convex",
      format: "xlsx",
      totalCount: 1,
      exportedAt: "2026-03-20T12:02:00+08:00",
      items: [{ resumeId: "r1", identityKey: "r1" }],
    });

    getResumeScreeningDb(root)
      .prepare("UPDATE review_packet_runs SET items_json = ? WHERE id = ? AND workspace_slug = ?")
      .run("not json", "packet-bad-items", "dev");

    const loaded = storage.getRun("packet-bad-items", "dev");

    expect(loaded?.items).toEqual([]);
    expect(consoleErrorSpy).toHaveBeenCalledWith(
      "review-packet-storage items_json parse failed:",
      expect.any(SyntaxError),
    );
  });

  it("logs malformed stats_json and falls back to undefined stats", () => {
    root = createFixtureRoot();
    const storage = new ReviewPacketStorage(root);
    const consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    storage.createRun({
      id: "packet-bad-stats",
      workspaceSlug: "dev",
      source: "convex",
      format: "xlsx",
      totalCount: 1,
      exportedAt: "2026-03-20T12:03:00+08:00",
      items: [{ resumeId: "r1", identityKey: "r1" }],
      stats: {
        summary: {
          reviewedCount: 1,
          pendingCount: 0,
          warningCount: 0,
          statusBreakdown: { shortlisted: 1 },
          actionBreakdown: { shortlist: 1 },
        },
      },
    });

    getResumeScreeningDb(root)
      .prepare("UPDATE review_packet_runs SET stats_json = ? WHERE id = ? AND workspace_slug = ?")
      .run("not json", "packet-bad-stats", "dev");

    const loaded = storage.getRun("packet-bad-stats", "dev");

    expect(loaded?.stats).toBeUndefined();
    expect(consoleErrorSpy).toHaveBeenCalledWith(
      "review-packet-storage stats_json parse failed:",
      expect.any(SyntaxError),
    );
  });
});
