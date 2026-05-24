import { describe, expect, it } from "vitest";

import {
  getDisallowedResumeFieldKeys,
  isResumeFieldAllowed,
  resolveResumeFieldUsagePolicy,
  sanitizeResumeRecordForSurface,
} from "./resume-field-usage-policy";

describe("resume field usage policy", () => {
  it("excludes protected fields per surface: age/gender/jobIntention/selfIntro from presentation/outreach/debug; age/gender/jobIntention/resumeSnippet/selfIntro from analysis", () => {
    for (const surface of ["presentation", "outreach", "debug"] as const) {
      expect(getDisallowedResumeFieldKeys(surface)).toEqual(["age", "gender", "jobIntention", "selfIntro"]);
      expect(isResumeFieldAllowed("age", surface)).toBe(false);
      expect(isResumeFieldAllowed("gender", surface)).toBe(false);
      expect(isResumeFieldAllowed("jobIntention", surface)).toBe(false);
      expect(isResumeFieldAllowed("selfIntro", surface)).toBe(false);
    }

    expect(getDisallowedResumeFieldKeys("analysis")).toEqual(["age", "gender", "jobIntention", "resumeSnippet", "selfIntro"]);
    expect(isResumeFieldAllowed("age", "analysis")).toBe(false);
    expect(isResumeFieldAllowed("gender", "analysis")).toBe(false);
    expect(isResumeFieldAllowed("jobIntention", "analysis")).toBe(false);
    expect(isResumeFieldAllowed("resumeSnippet", "analysis")).toBe(false);
    expect(isResumeFieldAllowed("selfIntro", "analysis")).toBe(false);
  });

  it("merges per-surface workspace overrides without affecting other surfaces", () => {
    const resolved = resolveResumeFieldUsagePolicy({
      fields: {
        jobIntention: {
          surfaces: {
            presentation: true,
          },
        },
        currentIndustry: {
          surfaces: {
            debug: false,
          },
        },
      },
    });

    expect(isResumeFieldAllowed("jobIntention", "presentation", resolved)).toBe(true);
    expect(isResumeFieldAllowed("jobIntention", "analysis", resolved)).toBe(false);
    expect(isResumeFieldAllowed("currentIndustry", "debug", resolved)).toBe(false);
    expect(isResumeFieldAllowed("currentIndustry", "presentation", resolved)).toBe(true);
  });

  it("creates sanitized projections without mutating the raw resume record", () => {
    const rawResume = {
      name: "Alice",
      age: "30",
      gender: "F",
      jobIntention: "Sales Engineer",
      selfIntro: "CNC sales background",
      education: "Bachelor",
    };

    const projection = sanitizeResumeRecordForSurface(rawResume, "presentation");

    expect(projection).toEqual({
      name: "Alice",
      education: "Bachelor",
    });
    expect(rawResume).toEqual({
      name: "Alice",
      age: "30",
      gender: "F",
      jobIntention: "Sales Engineer",
      selfIntro: "CNC sales background",
      education: "Bachelor",
    });
  });
});
