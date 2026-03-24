import { describe, expect, it } from "vitest";

import { FeedbackSummaryService } from "./feedback-summary-service";

describe("FeedbackSummaryService", () => {
  it("builds aggregate-first summary data from packet, statuses, and actions", () => {
    const service = new FeedbackSummaryService();
    const summary = service.buildSummary({
      run: {
        id: "packet-1",
        workspaceSlug: "hr",
        source: "convex",
        format: "xlsx",
        status: "feedback_imported",
        totalCount: 3,
        packetFilename: "packet-1.xlsx",
        exportedAt: "2026-03-20T09:00:00+08:00",
        feedbackImportedAt: "2026-03-20T10:00:00+08:00",
        items: [
          { resumeId: "resume-1", identityKey: "id-1", name: "Alice" },
          { resumeId: "resume-2", identityKey: "id-2", name: "Bob" },
          { resumeId: "resume-3", identityKey: "id-3", name: "Carol" },
        ],
        stats: {
          import: {
            importedAt: "2026-03-20T10:00:00+08:00",
            fileName: "reviewed.xlsx",
            totalRows: 2,
            matchedRows: 2,
            importedRows: 2,
            reviewedCount: 2,
            statusUpdates: 2,
            actionUpdates: 2,
            noteUpdates: 0,
            invalidRows: 0,
            duplicateRows: 0,
            warningCount: 1,
            matchedByProfileUrlCount: 0,
            nameMismatchCount: 1,
            reviewedResumeIds: ["resume-1", "resume-2"],
            warnings: ["Name edited"],
          },
        },
      },
      statuses: [
        { identityKey: "id-1", status: "interviewed_pass" },
        { identityKey: "id-2", status: "offer" },
      ],
      actions: [
        {
          id: 1,
          resumeId: "resume-1",
          actionType: "shortlist",
          createdAt: "2026-03-20T10:00:00+08:00",
        },
        {
          id: 2,
          resumeId: "resume-2",
          actionType: "contact",
          createdAt: "2026-03-20T10:05:00+08:00",
        },
      ],
    });

    expect(summary.totalExported).toBe(3);
    expect(summary.reviewedCount).toBe(2);
    expect(summary.pendingCount).toBe(1);
    expect(summary.warningCount).toBe(1);
    expect(summary.statusBreakdown).toEqual(expect.arrayContaining([
      expect.objectContaining({ key: "interviewed_pass", count: 1 }),
      expect.objectContaining({ key: "offer", count: 1 }),
      expect.objectContaining({ key: "new", count: 1 }),
    ]));
    expect(summary.actionBreakdown).toEqual(expect.arrayContaining([
      expect.objectContaining({ key: "shortlist", count: 1 }),
      expect.objectContaining({ key: "contact", count: 1 }),
    ]));
    expect(summary.warnings).toEqual(["Name edited"]);
  });
});
