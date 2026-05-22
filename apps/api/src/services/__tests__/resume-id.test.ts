import { describe, expect, it } from "vitest";

import { resolveResumeId } from "../resume-id.js";

import type { ResumeItem } from "../../types/resume.js";

function makeResume(overrides: Partial<ResumeItem> = {}): ResumeItem {
  return {
    externalId: "job5156:resume:12345",
    name: "Test User",
    source: "hr.job5156.com",
    profileUrl: "https://example.com/resume",
    workHistory: [],
    ...overrides,
  } as ResumeItem;
}

describe("resolveResumeId", () => {
  it("resolves to externalId when present", () => {
    const resume = makeResume({ externalId: "job5156:resume:999" });
    expect(resolveResumeId(resume, 0)).toBe("job5156:resume:999");
  });

  it("falls back to name-index when no stable identity fields exist", () => {
    const resume = makeResume({ externalId: undefined, profileUrl: undefined } as Partial<ResumeItem>);
    const id = resolveResumeId(resume, 7);
    expect(id).toContain("7");
  });
});
