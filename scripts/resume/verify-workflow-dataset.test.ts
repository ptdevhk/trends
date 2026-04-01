import { describe, expect, it } from "vitest";

import {
  buildFieldCoverageReport,
  countByKey,
  getResumeSourceKey,
  matchesWorkflowFilters,
} from "./verify-workflow-dataset.ts";

describe("verify workflow dataset helpers", () => {
  it("derives source keys from source hosts and profile types", () => {
    expect(getResumeSourceKey({
      _id: "seek-1",
      source: "my.employer.seek.com",
      content: {},
    })).toBe("seek");

    expect(getResumeSourceKey({
      _id: "job5156-1",
      source: "hr.job5156.com",
      content: {
        profileType: "job5156",
      },
    })).toBe("job5156");

    expect(getResumeSourceKey({
      _id: "manual-1",
      source: "51job-manual",
      content: {
        profileType: "51job-manual",
      },
    })).toBe("job5156");
  });

  it("matches workflow filters using source key and Malaysia location aliases", () => {
    const seekResume = {
      _id: "seek-1",
      source: "my.employer.seek.com",
      content: {
        location: "Kuala Lumpur, Malaysia",
      },
    };
    const job5156Resume = {
      _id: "job5156-1",
      source: "hr.job5156.com",
      content: {
        location: "广东东莞长安镇",
      },
    };

    expect(matchesWorkflowFilters(seekResume, { sourceKey: "seek", location: "Kuala Lumpur MY" })).toBe(true);
    expect(matchesWorkflowFilters(seekResume, { sourceKey: "job5156", location: "Kuala Lumpur MY" })).toBe(false);
    expect(matchesWorkflowFilters(job5156Resume, { sourceKey: "seek", location: "Kuala Lumpur MY" })).toBe(false);
  });

  it("counts unknown keys explicitly", () => {
    const rows = countByKey(
      [
        { source: "my.employer.seek.com" },
        { source: "my.employer.seek.com" },
        { source: undefined },
      ],
      (item) => item.source,
    );

    expect(rows).toEqual([
      { key: "my.employer.seek.com", count: 2 },
      { key: "unknown", count: 1 },
    ]);
  });

  it("builds field coverage summaries with a dedicated live 51job bucket", () => {
    const rows = buildFieldCoverageReport([
      {
        source: "ehire.51job.com",
        profileType: "51job",
        profileUrl: true,
        resumeId: true,
        workHistoryCount: 1,
        workHistoryHasDescription: false,
        profileEducation: false,
        jobIntention: true,
        expectedSalary: false,
        selfIntro: false,
        skills: false,
      },
      {
        source: "ehire.51job.com",
        profileType: "51job",
        profileUrl: false,
        resumeId: true,
        workHistoryCount: 0,
        workHistoryHasDescription: false,
        profileEducation: false,
        jobIntention: false,
        expectedSalary: false,
        selfIntro: false,
        skills: true,
      },
      {
        source: "my.employer.seek.com",
        profileType: "seek",
        profileUrl: true,
        resumeId: false,
        workHistoryCount: 1,
        workHistoryHasDescription: true,
        profileEducation: true,
        jobIntention: true,
        expectedSalary: true,
        selfIntro: false,
        skills: true,
      },
    ]);

    expect(rows).toEqual([
      {
        sourceKey: "51job",
        resumeCount: 2,
        profileUrlPct: 50,
        resumeIdPct: 100,
        workHistoryPct: 50,
        workHistoryDescriptionPct: 0,
        profileEducationPct: 0,
        jobIntentionPct: 50,
        expectedSalaryPct: 0,
        selfIntroPct: 0,
        skillsPct: 50,
      },
      {
        sourceKey: "seek",
        resumeCount: 1,
        profileUrlPct: 100,
        resumeIdPct: 0,
        workHistoryPct: 100,
        workHistoryDescriptionPct: 100,
        profileEducationPct: 100,
        jobIntentionPct: 100,
        expectedSalaryPct: 100,
        selfIntroPct: 0,
        skillsPct: 100,
      },
    ]);
  });
});
