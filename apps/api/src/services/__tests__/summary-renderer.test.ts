import { describe, expect, it } from "vitest";

import type { SummaryCountEntry, SummaryNewCandidate, SummaryReport } from "@trends/shared";

import { SummaryRenderer } from "../summaries/summary-renderer.js";

// --- renderCountList (private, tested via renderMarkdown) ---

describe("SummaryRenderer.renderMarkdown", () => {
  const renderer = new SummaryRenderer();

  function makeReport(overrides: Partial<SummaryReport> = {}): SummaryReport {
    return {
      workspaceSlug: "test-ws",
      period: "daily",
      generatedAt: "2026-05-22T10:00:00Z",
      window: { startAt: "2026-05-21", endAt: "2026-05-22", timezone: "Asia/Shanghai" },
      totals: {
        newResumes: 10,
        candidateStatusUpdates: 5,
        shortlistActions: 3,
        rejectActions: 1,
        contactActions: 2,
        collectionTasksCompleted: 8,
        collectionTasksFailed: 0,
      },
      breakdowns: {
        resumesBySource: [],
        candidateStatusByValue: [],
        actionsByType: [],
        collectionTasksByStatus: [],
      },
      notes: [],
      ...overrides,
    };
  }

  it("renders a minimal daily report", () => {
    const md = renderer.renderMarkdown(makeReport());
    expect(md).toContain("# Daily Ops Summary");
    expect(md).toContain("- Workspace: test-ws");
    expect(md).toContain("- Period: daily");
    expect(md).toContain("- New resumes: 10");
    expect(md).toContain("- Shortlist actions: 3");
    expect(md).toContain("- Collection tasks completed: 8");
  });

  it("renders weekly title", () => {
    const md = renderer.renderMarkdown(makeReport({ period: "weekly" }));
    expect(md).toContain("# Weekly Ops Summary");
  });

  it("renders monthly title", () => {
    const md = renderer.renderMarkdown(makeReport({ period: "monthly" }));
    expect(md).toContain("# Monthly New Candidates Digest");
  });

  it("renders resume source breakdown", () => {
    const entries: SummaryCountEntry[] = [
      { key: "51job", label: "51job", count: 5 },
      { key: "seek", label: "SEEK", count: 3 },
    ];
    const md = renderer.renderMarkdown(makeReport({
      breakdowns: {
        ...makeReport().breakdowns,
        resumesBySource: entries,
      },
    }));
    expect(md).toContain("- 51job: 5");
    expect(md).toContain("- SEEK: 3");
  });

  it("renders '- none' for empty breakdown entries", () => {
    const md = renderer.renderMarkdown(makeReport());
    expect(md).toContain("- none");
  });

  it("renders previous period comparison with delta formatting", () => {
    const md = renderer.renderMarkdown(makeReport({
      comparison: {
        previousWindow: { startAt: "2026-05-20", endAt: "2026-05-21", timezone: "Asia/Shanghai" },
        totalsDelta: {
          sharedIngest: { newResumes: 3, collectionTasksCompleted: -2, collectionTasksFailed: 0 },
          workspaceActivity: { candidateStatusUpdates: 1, shortlistActions: -1, rejectActions: 0, contactActions: 5 },
        },
      },
    }));
    expect(md).toContain("## Previous Period Comparison");
    expect(md).toContain("+3");
    expect(md).toContain("-2");
    expect(md).toContain("-1");
    expect(md).toContain("+5");
  });

  it("renders new candidates section", () => {
    const candidates: SummaryNewCandidate[] = [
      {
        resumeId: "r1",
        name: "张某",
        source: "51job",
        location: "东莞",
        experience: "5",
        education: "本科",
        score: 85,
        recommendation: "strong_match",
        crawledAt: "2026-05-22",
      },
      {
        resumeId: "r2",
        source: "seek",
        crawledAt: "2026-05-22",
      },
    ];
    const md = renderer.renderMarkdown(makeReport({ newCandidates: candidates }));
    expect(md).toContain("## New Candidates (2)");
    expect(md).toContain("张某 | 51job | 东莞 | 5yr | score:85");
    expect(md).toContain("r2 | seek");
  });

  it("renders 'No new candidates' when list is empty", () => {
    const md = renderer.renderMarkdown(makeReport({ newCandidates: [] }));
    expect(md).toContain("## New Candidates (0)");
    expect(md).toContain("- No new candidates in this period");
  });

  it("renders notes", () => {
    const md = renderer.renderMarkdown(makeReport({ notes: ["System healthy", "No alerts"] }));
    expect(md).toContain("- System healthy");
    expect(md).toContain("- No alerts");
  });

  it("omits comparison section when not provided", () => {
    const md = renderer.renderMarkdown(makeReport());
    expect(md).not.toContain("Previous Period Comparison");
  });

  it("omits new candidates section when not provided", () => {
    const md = renderer.renderMarkdown(makeReport());
    expect(md).not.toContain("New Candidates");
  });

  it("uses scoped totals when available", () => {
    const md = renderer.renderMarkdown(makeReport({
      scopes: {
        sharedIngest: {
          totals: { newResumes: 20, collectionTasksCompleted: 15, collectionTasksFailed: 1 },
          breakdowns: { resumesBySource: [], collectionTasksByStatus: [] },
        },
        workspaceActivity: {
          totals: { candidateStatusUpdates: 10, shortlistActions: 6, rejectActions: 2, contactActions: 4 },
          breakdowns: { candidateStatusByValue: [], actionsByType: [] },
        },
      },
    }));
    expect(md).toContain("- New resumes: 20");
    expect(md).toContain("- Shortlist actions: 6");
    expect(md).toContain("- Collection tasks failed: 1");
  });
});
