/**
 * Tests for bff-filter-utils.ts — BFF-side resume filter matching.
 *
 * Covers bffMatchesResumeFilters and parseAgeFromContentField with
 * systematic filter combinations that mirror Convex filter behavior.
 */
import { describe, expect, it } from "vitest";
import {
  bffMatchesResumeFilters,
  parseAgeFromContentField,
  type BffResumeFilters,
} from "../services/bff-filter-utils.js";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

function makeDoc(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    content: {
      experience: "5年",
      education: "本科",
      expectedSalary: "15k-25k",
      location: "深圳",
      skills: ["CNC", "销售"],
      ...((overrides.content as Record<string, unknown>) ?? {}),
    },
    ingestData: {
      industryTags: ["cnc", "machining", "sales"],
      verifiedRoleYears: { sales: 5 },
      ...((overrides.ingestData as Record<string, unknown>) ?? {}),
    },
    source: "job5156",
    sourceKey: "job5156",
    isArchived: false,
    ...overrides,
  };
}

const BASE_TEXT = "cnc machining sales operator";

// ---------------------------------------------------------------------------
// parseAgeFromContentField
// ---------------------------------------------------------------------------

describe("parseAgeFromContentField", () => {
  it("parses numeric age", () => {
    expect(parseAgeFromContentField({ age: 32 })).toBe(32);
  });

  it("parses string age with digits", () => {
    expect(parseAgeFromContentField({ age: "28岁" })).toBe(28);
  });

  it("returns null for missing age", () => {
    expect(parseAgeFromContentField({})).toBeNull();
  });

  it("returns null for non-numeric age", () => {
    expect(parseAgeFromContentField({ age: "unknown" })).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// bffMatchesResumeFilters — archived filter
// ---------------------------------------------------------------------------

describe("bffMatchesResumeFilters — archived", () => {
  it("excludes archived resumes by default", () => {
    const doc = makeDoc({ isArchived: true });
    expect(bffMatchesResumeFilters(doc, BASE_TEXT, {})).toBe(false);
  });

  it("includes archived resumes when showArchived is true", () => {
    const doc = makeDoc({ isArchived: true });
    expect(bffMatchesResumeFilters(doc, BASE_TEXT, { showArchived: true })).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// bffMatchesResumeFilters — experience filter
// ---------------------------------------------------------------------------

describe("bffMatchesResumeFilters — experience", () => {
  it("passes when maxExperience is not exceeded", () => {
    const doc = makeDoc();
    expect(bffMatchesResumeFilters(doc, BASE_TEXT, { maxExperience: 7 })).toBe(true);
  });

  it("fails when maxExperience is exceeded", () => {
    const doc = makeDoc();
    expect(bffMatchesResumeFilters(doc, BASE_TEXT, { maxExperience: 3 })).toBe(false);
  });

  it("excludes unknown experience when maxExperience is set", () => {
    const doc = makeDoc({ content: { experience: undefined } });
    expect(bffMatchesResumeFilters(doc, BASE_TEXT, { maxExperience: 10 })).toBe(false);
  });

});

// ---------------------------------------------------------------------------
// bffMatchesResumeFilters — education filter
// ---------------------------------------------------------------------------

describe("bffMatchesResumeFilters — education", () => {
  it("passes when education matches", () => {
    const doc = makeDoc();
    expect(bffMatchesResumeFilters(doc, BASE_TEXT, { education: ["bachelor"] })).toBe(true);
  });

  it("fails when education does not match", () => {
    const doc = makeDoc();
    expect(bffMatchesResumeFilters(doc, BASE_TEXT, { education: ["phd"] })).toBe(false);
  });

  it("fails when education is missing", () => {
    const doc = makeDoc({ content: { education: undefined } });
    expect(bffMatchesResumeFilters(doc, BASE_TEXT, { education: ["bachelor"] })).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// bffMatchesResumeFilters — skills filter
// ---------------------------------------------------------------------------

describe("bffMatchesResumeFilters — skills", () => {
  it("passes when a skill is found in searchText", () => {
    const doc = makeDoc();
    expect(bffMatchesResumeFilters(doc, "cnc machining expert", { skills: ["cnc"] })).toBe(true);
  });

  it("fails when no skill matches", () => {
    const doc = makeDoc();
    expect(bffMatchesResumeFilters(doc, "cnc machining", { skills: ["python"] })).toBe(false);
  });

  it("matches any skill (OR logic)", () => {
    const doc = makeDoc();
    expect(bffMatchesResumeFilters(doc, "cnc machining", { skills: ["python", "cnc"] })).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// bffMatchesResumeFilters — requiredKeywords filter
// ---------------------------------------------------------------------------

describe("bffMatchesResumeFilters — requiredKeywords", () => {
  it("passes when all keywords are found", () => {
    const doc = makeDoc();
    expect(bffMatchesResumeFilters(doc, "cnc sales manager", { requiredKeywords: ["cnc", "sales"] })).toBe(true);
  });

  it("fails when a keyword is missing", () => {
    const doc = makeDoc();
    expect(bffMatchesResumeFilters(doc, "cnc operator", { requiredKeywords: ["cnc", "python"] })).toBe(false);
  });

  it("is case-insensitive when searchText is pre-lowered", () => {
    const doc = makeDoc();
    // bffMatchesResumeFilters receives pre-lowered searchText; keywords are lowered internally
    expect(bffMatchesResumeFilters(doc, "cnc sales", { requiredKeywords: ["CNC", "Sales"] })).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// bffMatchesResumeFilters — salary filter
// ---------------------------------------------------------------------------

describe("bffMatchesResumeFilters — salary", () => {
  it("passes when salary is within range", () => {
    const doc = makeDoc(); // expectedSalary: "15k-25k" → raw CNY {min:15000, max:25000}
    expect(bffMatchesResumeFilters(doc, BASE_TEXT, { minSalary: 10000, maxSalary: 30000 })).toBe(true);
  });

  it("fails when salary is below minimum", () => {
    const doc = makeDoc();
    expect(bffMatchesResumeFilters(doc, BASE_TEXT, { minSalary: 30000 })).toBe(false);
  });

  it("excludes wan salaries above a raw-CNY maximum", () => {
    const doc = makeDoc({ content: { expectedSalary: "2.8-4.2万/月" } });
    expect(bffMatchesResumeFilters(doc, BASE_TEXT, { maxSalary: 25000 })).toBe(false);
  });

  it("excludes unknown salary when maxSalary is set", () => {
    const doc = makeDoc({ content: { expectedSalary: undefined } });
    expect(bffMatchesResumeFilters(doc, BASE_TEXT, { maxSalary: 20000 })).toBe(false);
  });

  it("includes unknown salary when only minSalary is set", () => {
    const doc = makeDoc({ content: { expectedSalary: undefined } });
    expect(bffMatchesResumeFilters(doc, BASE_TEXT, { minSalary: 10000 })).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// bffMatchesResumeFilters — roleFilterType filter
// ---------------------------------------------------------------------------

describe("bffMatchesResumeFilters — roleFilterType", () => {
  it("passes when verifiedRoleYears has matching key", () => {
    const doc = makeDoc(); // verifiedRoleYears: { sales: 5 }
    expect(bffMatchesResumeFilters(doc, BASE_TEXT, { roleFilterType: "sales" })).toBe(true);
  });

  it("fails when no matching role exists", () => {
    const doc = makeDoc();
    expect(bffMatchesResumeFilters(doc, BASE_TEXT, { roleFilterType: "engineering" })).toBe(false);
  });

  it("matches via roleSignals when verifiedRoleYears has no key", () => {
    const doc = makeDoc({
      ingestData: {
        verifiedRoleYears: {},
        roleSignals: [{ type: "operator", years: 3, verifiedYears: 2, signalCount: 1, occurrences: 1, matchedSignals: [], verifyIn: "searchText" }],
      },
    });
    expect(bffMatchesResumeFilters(doc, BASE_TEXT, { roleFilterType: "operator" })).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// bffMatchesResumeFilters — minRoleYears filter
// ---------------------------------------------------------------------------

describe("bffMatchesResumeFilters — minRoleYears", () => {
  it("passes when verifiedRoleYears meets minimum", () => {
    const doc = makeDoc(); // verifiedRoleYears: { sales: 5 }
    expect(bffMatchesResumeFilters(doc, BASE_TEXT, { minRoleYears: 3, roleFilterType: "sales" })).toBe(true);
  });

  it("fails when verifiedRoleYears is below minimum", () => {
    const doc = makeDoc(); // verifiedRoleYears: { sales: 5 }
    expect(bffMatchesResumeFilters(doc, BASE_TEXT, { minRoleYears: 10, roleFilterType: "sales" })).toBe(false);
  });

  it("checks any role when roleFilterType is not set", () => {
    const doc = makeDoc(); // verifiedRoleYears: { sales: 5 }
    expect(bffMatchesResumeFilters(doc, BASE_TEXT, { minRoleYears: 3 })).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// bffMatchesResumeFilters — age filter
// ---------------------------------------------------------------------------

describe("bffMatchesResumeFilters — age", () => {
  it("passes when age is within range", () => {
    const doc = makeDoc({ age: 30 });
    expect(bffMatchesResumeFilters(doc, BASE_TEXT, { minAge: 25, maxAge: 35 })).toBe(true);
  });

  it("fails when age is below minimum", () => {
    const doc = makeDoc({ age: 22 });
    expect(bffMatchesResumeFilters(doc, BASE_TEXT, { minAge: 25 })).toBe(false);
  });

  it("falls back to content.age when doc.age is not set", () => {
    const doc = makeDoc({ content: { age: "28岁" } });
    expect(bffMatchesResumeFilters(doc, BASE_TEXT, { minAge: 25 })).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// bffMatchesResumeFilters — sources filter
// ---------------------------------------------------------------------------

describe("bffMatchesResumeFilters — sources", () => {
  it("passes when source matches", () => {
    const doc = makeDoc(); // sourceKey: "job5156"
    expect(bffMatchesResumeFilters(doc, BASE_TEXT, { sources: ["job5156"] })).toBe(true);
  });

  it("fails when source does not match", () => {
    const doc = makeDoc();
    expect(bffMatchesResumeFilters(doc, BASE_TEXT, { sources: ["seek"] })).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// bffMatchesResumeFilters — combined filters
// ---------------------------------------------------------------------------

describe("bffMatchesResumeFilters — combined", () => {
  it("passes with multiple matching filters", () => {
    const doc = makeDoc();
    expect(bffMatchesResumeFilters(doc, BASE_TEXT, {
      maxExperience: 7,
      skills: ["cnc"],
      sources: ["job5156"],
    })).toBe(true);
  });

  it("fails when any single filter fails", () => {
    const doc = makeDoc();
    expect(bffMatchesResumeFilters(doc, BASE_TEXT, {
      maxExperience: 7,
      skills: ["python"],
      sources: ["job5156"],
    })).toBe(false);
  });

  it("passes with no filters (returns all non-archived)", () => {
    const doc = makeDoc();
    expect(bffMatchesResumeFilters(doc, BASE_TEXT, {})).toBe(true);
  });
});
