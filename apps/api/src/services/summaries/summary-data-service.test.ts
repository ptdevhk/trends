import { describe, expect, it } from "vitest";

import { config } from "../config";
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
    expect(report.scopes).toEqual({
      sharedIngest: {
        totals: {
          newResumes: 5,
          collectionTasksCompleted: 1,
          collectionTasksFailed: 1,
        },
        breakdowns: {
          resumesBySource: [
            { key: "job5156", label: "job5156", count: 3 },
            { key: "seek", label: "seek", count: 2 },
          ],
          collectionTasksByStatus: [
            { key: "completed", label: "Completed", count: 1 },
            { key: "failed", label: "Failed", count: 1 },
          ],
        },
      },
      workspaceActivity: {
        totals: {
          candidateStatusUpdates: 2,
          shortlistActions: 1,
          rejectActions: 1,
          contactActions: 1,
        },
        breakdowns: {
          candidateStatusByValue: [
            { key: "interviewing", label: "Interviewing", count: 1 },
            { key: "offer", label: "Offer", count: 1 },
          ],
          actionsByType: [
            { key: "contact", label: "Contact", count: 1 },
            { key: "reject", label: "Reject", count: 1 },
            { key: "shortlist", label: "Shortlist", count: 1 },
          ],
        },
      },
    });
    expect(report.notes).toEqual([
      "Shared ingest totals come from the global resume and collection-task pools in the current workspace model.",
      "Workspace activity totals cover candidate-status updates and persisted workspace-linked actions only.",
    ]);
  });

  it("builds a weekly report with previous-period comparison totals", async () => {
    const currentWeekStart = Date.parse("2026-03-22T16:00:00.000Z");
    const previousWeekStart = Date.parse("2026-03-15T16:00:00.000Z");
    const service = new SummaryDataService({
      now: () => new Date("2026-03-26T04:00:00.000Z"),
      actionStorage: {
        summarizeActionsInWindow: ({ startAt }) => {
          if (startAt === "2026-03-23T00:00:00+08:00") {
            return {
              total: 4,
              breakdown: [
                { actionType: "shortlist", count: 3 },
                { actionType: "contact", count: 1 },
              ],
            };
          }

          return {
            total: 3,
            breakdown: [
              { actionType: "shortlist", count: 1 },
              { actionType: "reject", count: 2 },
            ],
          };
        },
      },
      queryConvex: async (pathName, args) => {
        if (pathName === "resumes:getSummaryWindow") {
          if (args.fromTimestamp === currentWeekStart) {
            return {
              total: 8,
              bySource: [
                { key: "seek", count: 5 },
                { key: "job5156", count: 3 },
              ],
            };
          }

          if (args.fromTimestamp === previousWeekStart) {
            return {
              total: 5,
              bySource: [
                { key: "job5156", count: 3 },
                { key: "seek", count: 2 },
              ],
            };
          }
        }

        if (pathName === "candidate_status:list") {
          return [
            { status: "interviewing", updatedAt: Date.parse("2026-03-24T00:00:00.000Z") },
            { status: "offer", updatedAt: Date.parse("2026-03-25T10:00:00.000Z") },
            { status: "offer", updatedAt: Date.parse("2026-03-18T10:00:00.000Z") },
          ];
        }

        if (pathName === "resume_tasks:getSummaryWindow") {
          if (args.fromTimestamp === currentWeekStart) {
            return {
              total: 3,
              byStatus: [
                { key: "completed", count: 2 },
                { key: "failed", count: 1 },
              ],
            };
          }

          if (args.fromTimestamp === previousWeekStart) {
            return {
              total: 1,
              byStatus: [{ key: "completed", count: 1 }],
            };
          }
        }

        throw new Error(`Unexpected Convex path: ${pathName}`);
      },
    });

    const report = await service.buildSummaryReport({
      workspaceSlug: "hr",
      period: "weekly",
      endAt: "2026-03-26T04:00:00.000Z",
    });

    expect(report.period).toBe("weekly");
    expect(report.window).toEqual({
      startAt: "2026-03-23T00:00:00+08:00",
      endAt: "2026-03-30T00:00:00+08:00",
      // Window timezone follows config.timezone (env TIMEZONE wins over
      // config.yaml). The dev shell sources .env (TIMEZONE=Asia/Hong_Kong),
      // but bare vitest runs inherit the shell default (Asia/Shanghai).
      timezone: config.timezone,
    });
    expect(report.totals).toEqual({
      newResumes: 8,
      candidateStatusUpdates: 2,
      shortlistActions: 3,
      rejectActions: 0,
      contactActions: 1,
      collectionTasksCompleted: 2,
      collectionTasksFailed: 1,
    });
    expect(report.comparison).toEqual({
      previousWindow: {
        startAt: "2026-03-16T00:00:00+08:00",
        endAt: "2026-03-23T00:00:00+08:00",
        timezone: config.timezone,
      },
      totalsDelta: {
        sharedIngest: {
          newResumes: 3,
          collectionTasksCompleted: 1,
          collectionTasksFailed: 1,
        },
        workspaceActivity: {
          candidateStatusUpdates: 1,
          shortlistActions: 2,
          rejectActions: -2,
          contactActions: 1,
        },
      },
    });
  });
});
