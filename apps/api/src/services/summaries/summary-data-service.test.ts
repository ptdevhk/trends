import { describe, expect, it } from "vitest";

import { SummaryDataService } from "./summary-data-service";

describe("SummaryDataService", () => {
  it("builds a daily report from Convex and action summaries", async () => {
    const service = new SummaryDataService({
      now: () => new Date("2026-03-26T04:00:00.000Z"),
      actionStorage: {
        summarizeActionsInWindow: () => ({
          total: 3,
          breakdown: [
            { actionType: "shortlist", count: 1 },
            { actionType: "reject", count: 1 },
            { actionType: "contact", count: 1 },
          ],
        }),
      },
      queryConvex: async (pathName) => {
        if (pathName === "resumes:getSummaryWindow") {
          return {
            total: 5,
            bySource: [
              { key: "job5156", count: 3 },
              { key: "seek", count: 2 },
            ],
          };
        }

        if (pathName === "candidate_status:list") {
          return [
            { status: "interviewing", updatedAt: Date.parse("2026-03-25T12:00:00.000Z") },
            { status: "offer", updatedAt: Date.parse("2026-03-25T18:00:00.000Z") },
            { status: "offer", updatedAt: Date.parse("2026-03-20T18:00:00.000Z") },
          ];
        }

        if (pathName === "resume_tasks:getSummaryWindow") {
          return {
            total: 2,
            byStatus: [
              { key: "completed", count: 1 },
              { key: "failed", count: 1 },
            ],
          };
        }

        throw new Error(`Unexpected Convex path: ${pathName}`);
      },
    });

    const report = await service.buildSummaryReport({
      workspaceSlug: "hr",
      period: "daily",
      endAt: "2026-03-26T04:00:00.000Z",
    });

    expect(report.workspaceSlug).toBe("hr");
    expect(report.totals).toEqual({
      newResumes: 5,
      candidateStatusUpdates: 2,
      shortlistActions: 1,
      rejectActions: 1,
      contactActions: 1,
      collectionTasksCompleted: 1,
      collectionTasksFailed: 1,
    });
    expect(report.breakdowns.resumesBySource).toEqual([
      { key: "job5156", label: "job5156", count: 3 },
      { key: "seek", label: "seek", count: 2 },
    ]);
    expect(report.breakdowns.candidateStatusByValue).toEqual([
      { key: "interviewing", label: "Interviewing", count: 1 },
      { key: "offer", label: "Offer", count: 1 },
    ]);
    expect(report.notes).toHaveLength(2);
  });
});
