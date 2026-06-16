import ExcelJS from "exceljs";
import { describe, expect, it, vi } from "vitest";

import { FeedbackImportService } from "./feedback-import-service";
import type { StoredReviewPacketRun } from "./review-packet-storage";

function buildRun(): StoredReviewPacketRun {
  return {
    id: "packet-1",
    workspaceSlug: "hr",
    source: "convex",
    format: "xlsx",
    status: "exported",
    totalCount: 2,
    packetFilename: "packet-1.xlsx",
    exportedAt: "2026-03-20T09:00:00+08:00",
    items: [
      {
        resumeId: "resume-1",
        identityKey: "profileUrl:my.employer.seek.com/candidates/503033454",
        profileUrl: "https://my.employer.seek.com/candidates/503033454",
        source: "my.employer.seek.com",
        name: "Alice",
      },
      {
        resumeId: "resume-2",
        identityKey: "profileUrl:hr.job5156.com/api/com/resume/123456",
        profileUrl: "https://hr.job5156.com/resume/view/123456",
        source: "hr.job5156.com",
        name: "Bob",
      },
    ],
  };
}

async function buildXlsxBuffer(rows: string[][]): Promise<Uint8Array> {
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet("Feedback");
  rows.forEach((row) => sheet.addRow(row));
  const buffer = await workbook.xlsx.writeBuffer();
  return new Uint8Array(buffer);
}

describe("FeedbackImportService", () => {
  it("imports CSV rows by Resume ID while tolerating Name edits", async () => {
    const service = new FeedbackImportService();
    const upsertCandidateStatus = vi.fn(async () => undefined);
    const saveAction = vi.fn(async () => undefined);

    const result = await service.importFeedback({
      run: buildRun(),
      fileName: "reviewed.csv",
      buffer: Buffer.from([
        "Resume ID,Name,Status,Action,Notes,Reference Note",
        "resume-1,Alice Zhang,interviewing,shortlist,Follow up,Referred by boss",
      ].join("\n"), "utf8"),
      updatedBy: "hr.lead",
      callbacks: {
        upsertCandidateStatus,
        saveAction,
      },
    });

    expect(result.summary.importedRows).toBe(1);
    expect(result.summary.nameMismatchCount).toBe(1);
    expect(upsertCandidateStatus).toHaveBeenCalledWith({
      identityKey: "profileUrl:my.employer.seek.com/candidates/503033454",
      status: "interviewing",
      notes: "Follow up",
      updatedBy: "hr.lead",
    });
    expect(saveAction).toHaveBeenCalledWith(expect.objectContaining({
      resumeId: "resume-1",
      actionType: "shortlist",
      actionData: expect.objectContaining({
        reviewPacketRunId: "packet-1",
        referenceNote: "Referred by boss",
      }),
    }));
    expect(result.warnings.some((warning) => warning.includes("edited Name"))).toBe(true);
  });

  it("falls back to normalized Profile URL for XLSX rows when Resume ID does not resolve", async () => {
    const service = new FeedbackImportService();
    const upsertCandidateStatus = vi.fn(async () => undefined);
    const saveAction = vi.fn(async () => undefined);

    const buffer = await buildXlsxBuffer([
      ["Resume ID", "Profile URL", "Status", "Notes"],
      [
        "missing-id",
        "https://hr.job5156.com/api/com/resume/123456?from=list",
        "offer",
        "Good to proceed",
      ],
    ]);

    const result = await service.importFeedback({
      run: buildRun(),
      fileName: "reviewed.xlsx",
      buffer,
      callbacks: {
        upsertCandidateStatus,
        saveAction,
      },
    });

    expect(result.summary.matchedByProfileUrlCount).toBe(1);
    expect(upsertCandidateStatus).toHaveBeenCalledWith({
      identityKey: "profileUrl:hr.job5156.com/api/com/resume/123456",
      status: "offer",
      notes: "Good to proceed",
      updatedBy: undefined,
    });
    expect(saveAction).toHaveBeenCalledWith(expect.objectContaining({
      resumeId: "resume-2",
      actionType: "note",
    }));
  });

  it("warns and skips rows that do not belong to the packet run", async () => {
    const service = new FeedbackImportService();
    const upsertCandidateStatus = vi.fn(async () => undefined);
    const saveAction = vi.fn(async () => undefined);

    const result = await service.importFeedback({
      run: buildRun(),
      fileName: "reviewed.csv",
      buffer: Buffer.from([
        "Resume ID,Status,Notes",
        "resume-999,interviewed_reject,Not in this packet",
      ].join("\n"), "utf8"),
      callbacks: {
        upsertCandidateStatus,
        saveAction,
      },
    });

    expect(result.summary.invalidRows).toBe(1);
    expect(upsertCandidateStatus).not.toHaveBeenCalled();
    expect(saveAction).not.toHaveBeenCalled();
    expect(result.warnings[0]).toContain("does not belong to review packet");
  });
});
