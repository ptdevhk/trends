/**
 * Unit tests for lib/resumes_list_projections.ts
 *
 * Covers: projectResumeListDoc, projectResumeDetailDoc,
 * matchesResumeListFilters, buildResumeDigest, sortResumeDocs,
 * normalizeResumeListFilters, getIngestRuleScore.
 */
import { describe, expect, it } from "vitest";
import { buildResumeDigest } from "../convex/lib/resume_digests.js";
import {
  projectResumeListDoc,
  projectResumeDetailDoc,
  matchesResumeListFilters,
  sortResumeDocs,
  normalizeResumeListFilters,
  getIngestRuleScore,
  type ResumeListFilterArgs,
} from "../convex/lib/resumes_list_projections.js";

// ---------------------------------------------------------------------------
// Minimal mock resume docs
// ---------------------------------------------------------------------------

function makeResume(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    _id: "r1" as unknown,
    _creationTime: Date.now(),
    externalId: "ext-1",
    content: { name: "Test User", experience: "5 years" },
    hash: "abc123",
    tags: [],
    crawledAt: Date.now(),
    source: "test",
    ...overrides,
  } as Record<string, unknown>;
}

// ---------------------------------------------------------------------------
// projectResumeListDoc
// ---------------------------------------------------------------------------

describe("projectResumeListDoc", () => {
  it("projects basic fields from a resume doc", () => {
    const resume = makeResume();
    const projected = projectResumeListDoc(resume as any);

    expect(projected._id).toBe("r1");
    expect(projected.externalId).toBe("ext-1");
    expect(projected.source).toBe("test");
    expect(projected.tags).toEqual([]);
  });

  it("includes analysis when present", () => {
    const resume = makeResume({
      analysis: { score: 85, summary: "Good", highlights: [], recommendation: "match" },
    });
    const projected = projectResumeListDoc(resume as any);

    expect(projected.analysis).toBeDefined();
    expect(projected.analysis!.score).toBe(85);
  });

  it("includes ingestData when present", () => {
    const resume = makeResume({
      ingestData: {
        industryTags: ["tech"],
        synonymHits: ["dev"],
        ruleScores: { tech: 0.9 },
        experienceLevel: "senior",
        computedAt: Date.now(),
        skillsVersion: 2,
      },
    });
    const projected = projectResumeListDoc(resume as any);

    expect(projected.ingestData).toBeDefined();
    expect(projected.ingestData!.industryTags).toEqual(["tech"]);
  });

  it("omits isArchived when false", () => {
    const resume = makeResume({ isArchived: false });
    const projected = projectResumeListDoc(resume as any);

    expect(projected.isArchived).toBeUndefined();
  });

  it("includes isArchived when true", () => {
    const resume = makeResume({ isArchived: true, archivedAt: Date.now() });
    const projected = projectResumeListDoc(resume as any);

    expect(projected.isArchived).toBe(true);
    expect(projected.archivedAt).toBeDefined();
  });
});

// ---------------------------------------------------------------------------
// projectResumeDetailDoc
// ---------------------------------------------------------------------------

describe("projectResumeDetailDoc", () => {
  it("projects detail content with work history", () => {
    const resume = makeResume({
      content: { name: "Alice", workHistory: [{ companyName: "Acme", jobTitle: "Engineer", raw: "Acme - Engineer (2020-2023)" }] },
    });
    const projected = projectResumeDetailDoc(resume as any);

    expect(projected.content).toBeDefined();
    expect(projected.externalId).toBe("ext-1");
  });
});

// ---------------------------------------------------------------------------
// matchesResumeListFilters
// ---------------------------------------------------------------------------

describe("matchesResumeListFilters", () => {
  it("matches when no filters provided", () => {
    const resume = makeResume();
    expect(matchesResumeListFilters(resume as any, undefined)).toBe(true);
  });

  it("excludes archived resumes when showArchived is false", () => {
    const resume = makeResume({ isArchived: true });
    expect(matchesResumeListFilters(resume as any, { showArchived: false })).toBe(false);
  });

  it("includes archived resumes when showArchived is true", () => {
    const resume = makeResume({ isArchived: true });
    expect(matchesResumeListFilters(resume as any, { showArchived: true })).toBe(true);
  });

  it("filters by source", () => {
    const resume = makeResume({ source: "hr.job5156.com" });

    // Source is resolved to the domain key (e.g. "job5156") via resolveResumeAnalysisSourceKey
    expect(matchesResumeListFilters(resume as any, { sources: ["job5156"] })).toBe(true);
    expect(matchesResumeListFilters(resume as any, { sources: ["linkedin"] })).toBe(false);
  });

  it("uses raw-CNY salary filters for wan salaries", () => {
    const resume = makeResume({
      content: { expectedSalary: "2.8-4.2万/月" },
    }) as Parameters<typeof matchesResumeListFilters>[0];

    expect(matchesResumeListFilters(resume, { maxSalary: 25000 })).toBe(false);
  });

  it("uses raw-CNY salary filters for mixed 千-to-万 salaries", () => {
    const resume = makeResume({
      content: { expectedSalary: "8千-1.1万/月" },
    }) as Parameters<typeof matchesResumeListFilters>[0];

    expect(matchesResumeListFilters(resume, { maxSalary: 9000 })).toBe(true);
    expect(matchesResumeListFilters(resume, { maxSalary: 7000 })).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// buildResumeDigest
// ---------------------------------------------------------------------------

describe("buildResumeDigest", () => {
  it("stores salary values in raw CNY for digest filtering", () => {
    const resume = makeResume({
      content: { expectedSalary: "2.8-4.2万/月" },
    }) as Parameters<typeof buildResumeDigest>[0];
    const digest = buildResumeDigest(resume, Date.UTC(2026, 5, 4));

    expect(digest.salaryMin).toBe(28000);
    expect(digest.salaryMax).toBe(42000);
  });

  it("stores mixed-unit salary values in raw CNY for digest filtering", () => {
    const resume = makeResume({
      content: { expectedSalary: "8千-1.1万/月" },
    }) as Parameters<typeof buildResumeDigest>[0];
    const digest = buildResumeDigest(resume, Date.UTC(2026, 5, 4));

    expect(digest.salaryMin).toBe(8000);
    expect(digest.salaryMax).toBe(11000);
  });
});

// ---------------------------------------------------------------------------
// normalizeResumeListFilters
// ---------------------------------------------------------------------------

describe("normalizeResumeListFilters", () => {
  it("returns undefined when input is undefined", () => {
    expect(normalizeResumeListFilters(undefined)).toBeUndefined();
  });

  it("trims and lowercases education and skills", () => {
    const result = normalizeResumeListFilters({
      education: ["  MBA  ", "PhD"],
      skills: ["  Python  "],
    });

    expect(result!.education).toEqual(["mba", "phd"]);
    expect(result!.skills).toEqual(["python"]);
  });

  it("removes empty entries", () => {
    const result = normalizeResumeListFilters({
      education: ["", "  ", "BS"],
    });

    expect(result!.education).toEqual(["bs"]);
  });
});

// ---------------------------------------------------------------------------
// getIngestRuleScore
// ---------------------------------------------------------------------------

describe("getIngestRuleScore", () => {
  it("returns rule score from ingestData when JD matches", () => {
    const resume = makeResume({
      ingestData: {
        industryTags: [],
        synonymHits: [],
        ruleScores: { "jd-test": 0.85 },
        experienceLevel: "senior",
        computedAt: Date.now(),
        skillsVersion: 2,
      },
    });
    expect(getIngestRuleScore(resume as any, "jd-test")).toBeCloseTo(0.85);
  });

  it("returns 0 when no ingestData", () => {
    const resume = makeResume();
    expect(getIngestRuleScore(resume as any, undefined)).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// sortResumeDocs
// ---------------------------------------------------------------------------

describe("sortResumeDocs", () => {
  it("sorts by ingest rule score when JD is specified", () => {
    const r1 = makeResume({
      _id: "r1",
      ingestData: { industryTags: [], synonymHits: [], ruleScores: { "jd-1": 0.5 }, experienceLevel: "senior", computedAt: Date.now(), skillsVersion: 2 },
    });
    const r2 = makeResume({
      _id: "r2",
      ingestData: { industryTags: [], synonymHits: [], ruleScores: { "jd-1": 0.9 }, experienceLevel: "senior", computedAt: Date.now(), skillsVersion: 2 },
    });

    const sorted = sortResumeDocs([r1 as any, r2 as any], { jobDescriptionId: "jd-1" });
    expect(sorted[0]._id).toBe("r2");
  });

  it("sorts by name when sortBy is 'name'", () => {
    const r1 = makeResume({ _id: "r1", content: { name: "Alice" } });
    const r2 = makeResume({ _id: "r2", content: { name: "Bob" } });

    const sorted = sortResumeDocs([r2 as any, r1 as any], { sortBy: "name", sortOrder: "asc" });
    expect(sorted[0]._id).toBe("r1");
  });
});
