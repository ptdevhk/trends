import { describe, expect, it } from "vitest";

import { countByKey, getResumeSourceKey, matchesWorkflowFilters } from "./verify-workflow-dataset.ts";

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
});
