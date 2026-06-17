import { describe, expect, it } from "vitest";

import type { SummaryReport } from "@trends/shared";

import { SummaryRenderer } from "../summary-renderer.js";

const baseReport: SummaryReport = {
  workspaceSlug: "dev",
  period: "daily",
  generatedAt: "2026-05-25T09:00:00Z",
  window: { startAt: "2026-05-24T00:00:00Z", endAt: "2026-05-25T00:00:00Z", timezone: "Asia/Hong_Kong" },
  totals: {
    newResumes: 12,
    collectionTasksCompleted: 8,
    collectionTasksFailed: 1,
    candidateStatusUpdates: 5,
    shortlistActions: 3,
    rejectActions: 1,
    contactActions: 0,
  },
  breakdowns: {
    resumesBySource: [
      { key: "51job", label: "51job", count: 10 },
      { key: "Seek", label: "Seek", count: 2 },
    ],
    collectionTasksByStatus: [
      { key: "completed", label: "completed", count: 8 },
      { key: "failed", label: "failed", count: 1 },
    ],
    candidateStatusByValue: [
      { key: "shortlisted", label: "shortlisted", count: 3 },
      { key: "rejected", label: "rejected", count: 1 },
    ],
    actionsByType: [
      { key: "shortlist", label: "shortlist", count: 3 },
      { key: "reject", label: "reject", count: 1 },
    ],
  },
  notes: ["No critical incidents."],
};

describe("SummaryRenderer", () => {
  const renderer = new SummaryRenderer();

  describe("renderMarkdown", () => {
    it("renders a basic daily summary report", () => {
      const markdown = renderer.renderMarkdown(baseReport);

      expect(markdown).toContain("# Daily Ops Summary");
      expect(markdown).toContain("- Workspace: dev");
      expect(markdown).toContain("- Period: daily");
      expect(markdown).toContain("- New resumes: 12");
      expect(markdown).toContain("- 51job: 10");
      expect(markdown).toContain("- Seek: 2");
      expect(markdown).toContain("- completed: 8");
      expect(markdown).toContain("- No critical incidents.");
    });

    it("renders a weekly summary with correct title", () => {
      const report: SummaryReport = { ...baseReport, period: "weekly" };
      const markdown = renderer.renderMarkdown(report);

      expect(markdown).toContain("# Weekly Ops Summary");
    });

    it("renders empty count lists with '- none'", () => {
      const report: SummaryReport = {
        ...baseReport,
        breakdowns: {
          resumesBySource: [],
          collectionTasksByStatus: [],
          candidateStatusByValue: [],
          actionsByType: [],
        },
      };

      const markdown = renderer.renderMarkdown(report);

      // Each empty count list section should have "- none"
      const noneMatches = markdown.match(/- none/g);
      expect(noneMatches).not.toBeNull();
      expect(noneMatches!.length).toBeGreaterThanOrEqual(2);
    });

    it("renders comparison section when present", () => {
      const report: SummaryReport = {
        ...baseReport,
        comparison: {
          previousWindow: { startAt: "2026-05-23T00:00:00Z", endAt: "2026-05-24T00:00:00Z", timezone: "Asia/Hong_Kong" },
          totalsDelta: {
            sharedIngest: { newResumes: 5, collectionTasksCompleted: -2, collectionTasksFailed: 0 },
            workspaceActivity: { candidateStatusUpdates: 1, shortlistActions: 0, rejectActions: -1, contactActions: 3 },
          },
        },
      };

      const markdown = renderer.renderMarkdown(report);

      expect(markdown).toContain("## Previous Period Comparison");
      expect(markdown).toContain("+5");
      expect(markdown).toContain("-2");
      expect(markdown).toContain("+3");
    });

    it("renders new candidates section when present", () => {
      const report: SummaryReport = {
        ...baseReport,
        newCandidates: [
          { resumeId: "r1", name: "Alice", source: "51job", location: "Dongguan", experience: "5", score: 85, crawledAt: "2026-05-24T10:00:00Z" },
          { resumeId: "r2", name: "Bob", source: "Seek", crawledAt: "2026-05-24T11:00:00Z" },
        ],
      };

      const markdown = renderer.renderMarkdown(report);

      expect(markdown).toContain("## New Candidates (2)");
      expect(markdown).toContain("Alice | 51job | Dongguan | 5yr | score:85");
      expect(markdown).toContain("Bob | Seek");
    });

    it("renders new candidates with no entries", () => {
      const report: SummaryReport = {
        ...baseReport,
        newCandidates: [],
      };

      const markdown = renderer.renderMarkdown(report);

      expect(markdown).toContain("## New Candidates (0)");
      expect(markdown).toContain("- No new candidates in this period");
    });

    it("uses scoped data when available", () => {
      const report: SummaryReport = {
        ...baseReport,
        scopes: {
          sharedIngest: {
            totals: { newResumes: 20, collectionTasksCompleted: 15, collectionTasksFailed: 2 },
            breakdowns: {
              resumesBySource: [{ key: "51job", label: "51job", count: 20 }],
              collectionTasksByStatus: [{ key: "completed", label: "completed", count: 15 }],
            },
          },
          workspaceActivity: {
            totals: { candidateStatusUpdates: 10, shortlistActions: 5, rejectActions: 3, contactActions: 2 },
            breakdowns: {
              candidateStatusByValue: [{ key: "shortlisted", label: "shortlisted", count: 5 }],
              actionsByType: [{ key: "shortlist", label: "shortlist", count: 5 }],
            },
          },
        },
      };

      const markdown = renderer.renderMarkdown(report);

      expect(markdown).toContain("- New resumes: 20");
      expect(markdown).toContain("- 51job: 20");
      expect(markdown).toContain("- Candidate status updates: 10");
    });

    it("renders candidates without name using resumeId", () => {
      const report: SummaryReport = {
        ...baseReport,
        newCandidates: [
          { resumeId: "r-unknown", source: "51job", score: 70, crawledAt: "2026-05-24T12:00:00Z" },
        ],
      };

      const markdown = renderer.renderMarkdown(report);

      expect(markdown).toContain("r-unknown | 51job | score:70");
    });
  });
});
