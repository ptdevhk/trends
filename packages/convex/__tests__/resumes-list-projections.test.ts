/**
 * Unit tests for lib/resumes_list_projections.ts
 *
 * Covers: projectResumeListDoc, projectResumeDetailDoc,
 * matchesResumeListFilters, buildResumeDigest, sortResumeDocs,
 * normalizeResumeListFilters, getIngestRuleScore.
 */
import { describe, expect, it } from "vitest";
import { matchesResumeDigestFilters } from "@trends/shared";
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

  it("strips analysis from list projection (Phase 3 — moved to resume_analyses)", () => {
    const resume = makeResume({
      analysis: { score: 85, summary: "Good", highlights: [], recommendation: "match" },
    });
    const projected = projectResumeListDoc(resume as any);

    // Analysis is no longer included in the list projection — score display
    // comes from resume_digests.displayScore instead. Detail view fetches
    // full analysis from resume_analyses on demand.
    expect(projected.analysis).toBeUndefined();
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
  it("projects detail content with work history", async () => {
    const resume = makeResume({
      content: { name: "Alice", workHistory: [{ companyName: "Acme", jobTitle: "Engineer", raw: "Acme - Engineer (2020-2023)" }] },
    });
    // Phase 3 completion: projectResumeDetailDoc is now async and fetches
    // analysis from resume_analyses via by_resume index. Mock ctx.db.query
    // chain to return no cold row (resume has no analysis in this fixture).
    const mockCtx = {
      db: {
        query: () => ({
          withIndex: () => ({
            unique: async () => null,
          }),
        }),
      },
    } as any;
    const projected = await projectResumeDetailDoc(mockCtx, resume as any);

    expect(projected.content).toBeDefined();
    expect(projected.externalId).toBe("ext-1");
  });

  it("keeps at most the latest ten detailed entries in detail projection", async () => {
    const resume = makeResume({
      content: {
        name: "Alice",
        workHistory: Array.from({ length: 11 }, (_, index) => ({
          companyName: `Company ${index + 1}`,
          jobTitle: `Role ${index + 1}`,
          description: `Detailed responsibilities ${index + 1}`,
          startDate: `${2015 + index}-01`,
          endDate: `${2015 + index}-12`,
          raw: `Company ${index + 1} - Role ${index + 1}`,
        })),
      },
    });
    const mockCtx = {
      db: {
        query: () => ({
          withIndex: () => ({
            unique: async () => null,
          }),
        }),
      },
    } as any;

    const projected = await projectResumeDetailDoc(mockCtx, resume as any);
    const workHistory = Array.isArray(projected.content?.workHistory)
      ? projected.content.workHistory
      : [];

    expect(workHistory).toHaveLength(10);
    expect(workHistory[0]).toEqual(expect.objectContaining({
      companyName: "Company 11",
      description: "Detailed responsibilities 11",
    }));
    expect(workHistory.map((entry) => entry.companyName)).not.toContain("Company 1");
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

  it("does not count direct unverified sales work-history years for minRoleYears", () => {
    const resume = makeResume({
      ingestData: {
        verifiedRoleYears: {},
        roleSignals: [{
          type: "sales",
          signalCount: 2,
          years: 6.75,
          roleRelevantYears: 6.75,
          industryVerifiedRelevantYears: 0,
          industryVerifiedYears: 0,
          matchedSignals: ["销售"],
          matchedWorkEntries: [{
            jobTitle: "电话销售",
            years: 6.75,
            industryVerified: false,
            directRoleMatch: true,
            matchedSignals: ["销售"],
          }],
        }],
      },
    }) as Parameters<typeof matchesResumeListFilters>[0];

    expect(matchesResumeListFilters(resume, { roleFilterType: "sales", minRoleYears: 1 })).toBe(false);
  });

  it("checks any role when roleFilterType is not set", () => {
    const resume = makeResume({
      ingestData: {
        verifiedRoleYears: { sales: 2 },
        roleSignals: [],
      },
    }) as Parameters<typeof matchesResumeListFilters>[0];

    expect(matchesResumeListFilters(resume, { minRoleYears: 1 })).toBe(true);
  });

  it("normalizes roleFilterType whitespace before applying minRoleYears", () => {
    const resume = makeResume({
      ingestData: {
        verifiedRoleYears: { sales: 2 },
        roleSignals: [],
      },
    }) as Parameters<typeof matchesResumeListFilters>[0];

    expect(matchesResumeListFilters(resume, { roleFilterType: " Sales ", minRoleYears: 1 })).toBe(true);
  });

  it("rejects non-direct sales mentions for minRoleYears", () => {
    const resume = makeResume({
      ingestData: {
        verifiedRoleYears: {},
        roleSignals: [{
          type: "sales",
          signalCount: 1,
          years: 5,
          roleRelevantYears: 0,
          industryVerifiedRelevantYears: 0,
          industryVerifiedYears: 0,
          matchedSignals: ["销售"],
          matchedWorkEntries: [{
            jobTitle: "CNC/数控操机",
            years: 5,
            industryVerified: false,
            directRoleMatch: false,
            matchedSignals: ["销售"],
          }],
        }],
      },
    }) as Parameters<typeof matchesResumeListFilters>[0];

    expect(matchesResumeListFilters(resume, { roleFilterType: "sales", minRoleYears: 1 })).toBe(false);
  });

  it("MY Seek direct-role-only resumes still fail minRoleYears without verified years", () => {
    const resume = makeResume({
      source: "hk.employer.seek.com",
      sourceKey: "seek",
      externalId: "hk.employer.seek.com:profile:uuid-talent-1",
      content: {
        name: "Carol White",
        experience: "",
        workHistory: [{ jobTitle: "Sales Manager", companyName: "Acme MY", years: "?", startDate: "2019-01", endDate: "2024-06" }],
      },
      ingestData: {
        market: "MY",
        verifiedRoleYears: {},
        roleSignals: [{
          type: "sales",
          signalCount: 1,
          years: 5.5,
          roleRelevantYears: 5.5,
          industryVerifiedRelevantYears: 0,
          industryVerifiedYears: 0,
          matchedSignals: ["Sales Manager"],
          matchedWorkEntries: [{
            jobTitle: "Sales Manager",
            companyName: "Acme MY",
            years: 5.5,
            industryVerified: false,
            directRoleMatch: true,
            matchedSignals: ["Sales Manager"],
          }],
        }],
      },
    }) as Parameters<typeof matchesResumeListFilters>[0];

    expect(matchesResumeListFilters(resume, { minRoleYears: 1 })).toBe(false);
    expect(matchesResumeListFilters(resume, { roleFilterType: "sales", minRoleYears: 1 })).toBe(false);
    // Still project market for UI
    const projected = projectResumeListDoc(resume as any);
    expect(projected.ingestData?.market).toBe("MY");
  });

  it("keeps verified engineer years from satisfying a sales gate", () => {
    const resume = makeResume({
      source: "hk.employer.seek.com",
      sourceKey: "seek",
      ingestData: {
        market: "MY",
        verifiedRoleYears: { engineer: 4 },
        roleSignals: [{
          type: "sales",
          signalCount: 1,
          years: 4,
          roleRelevantYears: 4,
          industryVerifiedRelevantYears: 0,
          industryVerifiedYears: 0,
          matchedSignals: ["Sales Manager"],
          matchedWorkEntries: [{
            jobTitle: "Sales Manager",
            years: 4,
            industryVerified: false,
            directRoleMatch: true,
            matchedSignals: ["Sales Manager"],
          }],
        }, {
          type: "engineer",
          signalCount: 1,
          years: 4,
          roleRelevantYears: 4,
          industryVerifiedRelevantYears: 4,
          industryVerifiedYears: 4,
          matchedSignals: ["Application Engineer"],
          matchedWorkEntries: [{
            jobTitle: "Application Engineer",
            years: 4,
            industryVerified: true,
            directRoleMatch: true,
            matchedSignals: ["Application Engineer"],
          }],
        }],
      },
    }) as Parameters<typeof matchesResumeListFilters>[0];

    expect(matchesResumeListFilters(resume, { roleFilterType: "sales", minRoleYears: 1 })).toBe(false);
    expect(matchesResumeListFilters(resume, { roleFilterType: "engineer", minRoleYears: 1 })).toBe(true);
  });

  it("CN resumes still require industry-verified years for minRoleYears", () => {
    const resume = makeResume({
      source: "hr.job5156.com",
      sourceKey: "job5156",
      ingestData: {
        market: "CN",
        verifiedRoleYears: {},
        roleSignals: [{
          type: "sales",
          signalCount: 1,
          years: 6,
          roleRelevantYears: 6,
          industryVerifiedRelevantYears: 0,
          industryVerifiedYears: 0,
          matchedSignals: ["销售"],
          matchedWorkEntries: [{
            jobTitle: "销售工程师",
            years: 6,
            industryVerified: false,
            directRoleMatch: true,
            matchedSignals: ["销售"],
          }],
        }],
      },
    }) as Parameters<typeof matchesResumeListFilters>[0];

    expect(matchesResumeListFilters(resume, { roleFilterType: "sales", minRoleYears: 1 })).toBe(false);
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

  it("projects verified role years from roleSignals when verifiedRoleYears is absent", () => {
    const resume = makeResume({
      ingestData: {
        roleSignals: [{
          type: "sales",
          signalCount: 2,
          years: 6.75,
          roleRelevantYears: 6.75,
          industryVerifiedRelevantYears: 3,
          industryVerifiedYears: 3,
          matchedSignals: ["销售"],
        }],
      },
    }) as Parameters<typeof buildResumeDigest>[0];

    const digest = buildResumeDigest(resume, Date.UTC(2026, 5, 4));

    expect(digest.roleTypes).toEqual(["sales"]);
    expect(digest.roleYearsByType).toEqual({ sales: 3 });
  });

  it("keeps unverified role signal types separate from verified digest role years for CN", () => {
    const resume = makeResume({
      source: "hr.job5156.com",
      sourceKey: "job5156",
      ingestData: {
        market: "CN",
        roleSignals: [{
          type: "sales",
          signalCount: 1,
          years: 2,
          roleRelevantYears: 2,
          industryVerifiedRelevantYears: 0,
          industryVerifiedYears: 0,
          matchedSignals: ["销售"],
          matchedWorkEntries: [{
            jobTitle: "销售工程师",
            years: 2,
            industryVerified: false,
            directRoleMatch: true,
            matchedSignals: ["销售"],
          }],
        }],
      },
    }) as Parameters<typeof buildResumeDigest>[0];

    const digest = buildResumeDigest(resume, Date.UTC(2026, 5, 4));

    expect(digest.roleTypes).toEqual(["sales"]);
    expect(digest.roleYearsByType).toEqual({});
  });

  it("MY Seek digests do not store direct-role fallback years when industry verify is 0", () => {
    const resume = makeResume({
      source: "hk.employer.seek.com",
      sourceKey: "seek",
      externalId: "hk.employer.seek.com:profile:uuid-1",
      ingestData: {
        market: "MY",
        verifiedRoleYears: {},
        roleSignals: [{
          type: "sales",
          signalCount: 1,
          years: 5.5,
          roleRelevantYears: 5.5,
          industryVerifiedRelevantYears: 0,
          industryVerifiedYears: 0,
          matchedSignals: ["Sales Manager"],
          matchedWorkEntries: [{
            jobTitle: "Sales Manager",
            companyName: "Acme MY",
            years: 5.5,
            industryVerified: false,
            directRoleMatch: true,
            matchedSignals: ["Sales Manager"],
          }],
        }],
      },
    }) as Parameters<typeof buildResumeDigest>[0];

    const digest = buildResumeDigest(resume, Date.UTC(2026, 5, 4));

    expect(digest.roleTypes).toEqual(["sales"]);
    expect(digest.roleYearsByType).toEqual({});
    expect(matchesResumeDigestFilters(digest as any, { minRoleYears: 1, roleFilterType: "sales" })).toBe(false);
    expect(matchesResumeDigestFilters(digest as any, { minRoleYears: 1 })).toBe(false);
  });

  it("round-trips bounded revision-backed evidence into the digest and list projection", () => {
    const summary = {
      companyKey: "acme-cnc",
      companyName: "ACME CNC",
      industryClass: "cnc",
      verificationLevel: "verified",
      verdictRevisionId: "revision-acme-1",
      evidenceSummary: "Official catalog confirms CNC machine tools.",
      verifiedYears: 3,
      roleTypes: ["sales"],
      reviewedAt: 100,
      reviewedBy: "reviewer-1",
      sourceCount: 1,
      sourcePreviews: [{
        sourceId: "source-1",
        url: "https://acme.example/cnc",
        sourceDomain: "acme.example",
        sourceType: "official_site",
        trustTier: "primary",
      }],
      additionalSourceCount: 0,
    };
    const resume = makeResume({
      ingestData: {
        evidenceProjectionVersion: 1,
        industryEvidenceCatalogState: "ready",
        verifiedIndustryEvidenceSummaries: [summary],
        verifiedRoleYears: { sales: 99 },
        roleSignals: [{
          type: "sales",
          signalCount: 1,
          years: 3,
          industryVerifiedYears: 3,
          industryVerifiedRelevantYears: 3,
          matchedSignals: ["sales"],
          matchedWorkEntries: [{
            companyName: "ACME CNC",
            companyKey: "acme-cnc",
            jobTitle: "Sales Manager",
            years: 3,
            industryVerified: true,
            verdictRevisionId: "revision-acme-1",
            workEntryFingerprint: "work-1",
            directRoleMatch: true,
            matchedSignals: ["sales"],
          }],
          verifyIn: "workHistory",
        }],
      },
    }) as Parameters<typeof buildResumeDigest>[0];

    const digest = buildResumeDigest(resume, Date.UTC(2026, 5, 4));
    const projected = projectResumeListDoc(resume as any);

    expect(digest.roleYearsByType).toEqual({ sales: 3 });
    expect(digest.evidenceProjectionVersion).toBe(1);
    expect(digest.verifiedIndustryEvidenceSummaries).toEqual([summary]);
    expect(projected.ingestData?.verifiedIndustryEvidenceSummaries).toEqual([
      summary,
    ]);
    expect(
      projected.ingestData?.roleSignals?.[0]?.matchedWorkEntries?.[0],
    ).toMatchObject({
      companyKey: "acme-cnc",
      verdictRevisionId: "revision-acme-1",
      workEntryFingerprint: "work-1",
    });
  });

  it("does not let mismatched revision aggregates satisfy strict digest years", () => {
    const resume = makeResume({
      ingestData: {
        evidenceProjectionVersion: 1,
        industryEvidenceCatalogState: "ready",
        verifiedIndustryEvidenceSummaries: [{
          companyKey: "acme-cnc",
          companyName: "ACME CNC",
          industryClass: "cnc",
          verificationLevel: "verified",
          verdictRevisionId: "revision-current",
          evidenceSummary: "Reviewed.",
          reviewedAt: 100,
          sourceCount: 0,
          sourcePreviews: [],
          additionalSourceCount: 0,
        }],
        verifiedRoleYears: { sales: 8 },
        roleSignals: [{
          type: "sales",
          signalCount: 1,
          years: 8,
          industryVerifiedYears: 8,
          industryVerifiedRelevantYears: 8,
          matchedSignals: ["sales"],
          matchedWorkEntries: [{
            companyKey: "acme-cnc",
            years: 8,
            industryVerified: true,
            verdictRevisionId: "revision-superseded",
            workEntryFingerprint: "work-1",
            directRoleMatch: true,
            matchedSignals: ["sales"],
          }],
          verifyIn: "workHistory",
        }],
      },
    }) as Parameters<typeof buildResumeDigest>[0];

    const digest = buildResumeDigest(resume, Date.UTC(2026, 5, 4));

    expect(digest.roleTypes).toEqual(["sales"]);
    expect(digest.roleYearsByType).toEqual({});
    expect(digest.industryEvidenceStale).toBe(true);
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
      roleFilterType: " Sales ",
    });

    expect(result!.education).toEqual(["mba", "phd"]);
    expect(result!.skills).toEqual(["python"]);
    expect(result!.roleFilterType).toBe("sales");
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

describe("buildResumeDigest list fields", () => {
  it("projects list sort fields without copying cold full document payload", () => {
    const resume = makeResume({
      identityKey: "identity-list-1",
      searchText: "cnc ".repeat(2000),
      primaryRuleScore: 88,
      crawledAt: 12345,
      content: {
        name: "List Candidate",
        location: "Shanghai, China",
        expectedSalary: "20000",
      },
    });

    const digest = buildResumeDigest(resume as any, 999);

    expect(digest.identityKey).toBe("identity-list-1");
    expect(digest.primaryRuleScore).toBe(88);
    expect(digest.crawledAt).toBe(12345);
    expect(digest.searchText?.length ?? 0).toBeLessThan(1600);
    expect(digest.updatedAt).toBe(999);
  });
});
