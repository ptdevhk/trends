import { describe, expect, it } from "vitest";

// We test bffMatchesResumeFilters indirectly by constructing the doc
// and filters and asserting on the result. The function is module-private,
// so we test through the exported route logic or replicate the function.
// Since bffMatchesResumeFilters is not exported, we replicate its core
// logic for testing, verifying alignment with Convex behavior.

import { normalizeEducationLevel, parseExperienceYears } from "../../services/resume-service.js";
import { parseSalaryRange } from "@trends/shared";

// Helper to replicate bffMatchesResumeFilters for unit testing.
// This mirrors the function in routes/resumes.ts exactly.
function bffMatchesResumeFilters(
  doc: Record<string, unknown>,
  loweredSearchText: string,
  filters: {
    minExperience?: number;
    maxExperience?: number;
    education?: string[];
    skills?: string[];
    requiredKeywords?: string[];
    minSalary?: number;
    maxSalary?: number;
    showArchived?: boolean;
  },
): boolean {
  function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === "object" && value !== null;
  }
  function toStringValue(value: unknown): string | undefined {
    return typeof value === "string" ? value : undefined;
  }
  function toOptionalNumber(value: unknown): number | undefined {
    if (typeof value === "number" && Number.isFinite(value)) return value;
    return undefined;
  }

  if (!filters.showArchived && doc.isArchived === true) return false;

  const content = isRecord(doc.content) ? doc.content : {};

  if (typeof filters.minExperience === "number" || typeof filters.maxExperience === "number") {
    const expStr = toStringValue(content.experience) ?? "";
    const expYears = parseExperienceYears(expStr);
    if (expYears === null) {
      if (typeof filters.maxExperience === "number") return false;
    } else {
      if (typeof filters.minExperience === "number" && expYears < filters.minExperience) return false;
      if (typeof filters.maxExperience === "number" && expYears > filters.maxExperience) return false;
    }
  }

  if (filters.education?.length) {
    const edu = toStringValue(content.education) ?? "";
    const level = normalizeEducationLevel(edu);
    if (!level || !filters.education.includes(level)) return false;
  }

  if (filters.skills?.length) {
    if (!filters.skills.some((skill) => loweredSearchText.includes(skill.toLowerCase()))) return false;
  }

  if (filters.requiredKeywords?.length) {
    if (!filters.requiredKeywords.every((kw) => loweredSearchText.includes(kw.toLowerCase()))) return false;
  }

  if (typeof filters.minSalary === "number" || typeof filters.maxSalary === "number") {
    const salaryStr = toStringValue(content.expectedSalary) ?? "";
    const salary = parseSalaryRange(salaryStr);
    if (!salary) {
      if (typeof filters.maxSalary === "number") return false;
    } else {
      if (typeof filters.minSalary === "number") {
        const maxSalary = salary.max ?? salary.min;
        if (maxSalary !== undefined && maxSalary < filters.minSalary) return false;
      }
      if (typeof filters.maxSalary === "number") {
        const minSalary = salary.min ?? salary.max;
        if (minSalary !== undefined && minSalary > filters.maxSalary) return false;
      }
    }
  }

  return true;
}

function makeDoc(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    content: {
      experience: "5年",
      education: "本科",
      expectedSalary: "15-25万/年",
      ...((overrides.content as Record<string, unknown>) ?? {}),
    },
    isArchived: false,
    source: "51job",
    ...overrides,
  };
}

describe("bffMatchesResumeFilters", () => {
  describe("archived filter", () => {
    it("excludes archived resumes by default", () => {
      const doc = makeDoc({ isArchived: true });
      expect(bffMatchesResumeFilters(doc, "", {})).toBe(false);
    });

    it("includes archived resumes when showArchived is true", () => {
      const doc = makeDoc({ isArchived: true });
      expect(bffMatchesResumeFilters(doc, "", { showArchived: true })).toBe(true);
    });
  });

  describe("experience filter — graceful degradation", () => {
    it("resumes with empty experience pass minExperience filter", () => {
      const doc = makeDoc({ content: { experience: "" } });
      expect(bffMatchesResumeFilters(doc, "", { minExperience: 1 })).toBe(true);
    });

    it("resumes with unknown experience are excluded by maxExperience", () => {
      const doc = makeDoc({ content: { experience: "" } });
      expect(bffMatchesResumeFilters(doc, "", { maxExperience: 5 })).toBe(false);
    });

    it("resumes with known low experience are excluded by minExperience", () => {
      const doc = makeDoc({ content: { experience: "应届" } });
      expect(bffMatchesResumeFilters(doc, "", { minExperience: 1 })).toBe(false);
    });

    it("resumes with known high experience pass minExperience", () => {
      const doc = makeDoc({ content: { experience: "5" } });
      expect(bffMatchesResumeFilters(doc, "", { minExperience: 1 })).toBe(true);
    });
  });

  describe("education filter — normalization", () => {
    it("matches Chinese education terms to standard levels", () => {
      const doc = makeDoc({ content: { education: "硕士" } });
      expect(bffMatchesResumeFilters(doc, "", { education: ["master"] })).toBe(true);
    });

    it("matches English education terms for MY market", () => {
      const doc = makeDoc({ content: { education: "Bachelor of Engineering" } });
      expect(bffMatchesResumeFilters(doc, "", { education: ["bachelor"] })).toBe(true);
    });

    it("excludes resumes whose education doesn't match filter", () => {
      const doc = makeDoc({ content: { education: "大专" } });
      expect(bffMatchesResumeFilters(doc, "", { education: ["master"] })).toBe(false);
    });
  });

  describe("skills filter — full search text", () => {
    it("matches skills from searchText, not just industryTags", () => {
      const doc = makeDoc({ content: { industryTags: [] } });
      // "cnc" appears in searchText but not in industryTags
      expect(bffMatchesResumeFilters(doc, "cnc sales engineer malaysia", { skills: ["cnc"] })).toBe(true);
    });

    it("excludes resumes without matching skills in searchText", () => {
      const doc = makeDoc({ content: { industryTags: [] } });
      expect(bffMatchesResumeFilters(doc, "sales engineer malaysia", { skills: ["fanuc"] })).toBe(false);
    });
  });

  describe("requiredKeywords filter", () => {
    it("requires all keywords to be present", () => {
      const doc = makeDoc();
      expect(bffMatchesResumeFilters(doc, "machine tools cnc sales", { requiredKeywords: ["machine tools", "cnc"] })).toBe(true);
    });

    it("excludes if any keyword is missing", () => {
      const doc = makeDoc();
      expect(bffMatchesResumeFilters(doc, "cnc sales", { requiredKeywords: ["machine tools", "cnc"] })).toBe(false);
    });
  });

  describe("salary filter — parseSalaryRange", () => {
    it("parses salary with 万 multiplier correctly", () => {
      // parseSalaryRange("15-25万/年") returns {min: 150, max: 250} (in 千 units)
      const doc = makeDoc({ content: { expectedSalary: "15-25万/年" } });
      // max 250 should be above minSalary: 100 (千)
      expect(bffMatchesResumeFilters(doc, "", { minSalary: 100 })).toBe(true);
    });

    it("excludes resumes below minSalary using range-aware parsing", () => {
      // parseSalaryRange("5-8千/月") returns {min: 5, max: 8} (in 千 units)
      const doc = makeDoc({ content: { expectedSalary: "5-8千/月" } });
      expect(bffMatchesResumeFilters(doc, "", { minSalary: 10 })).toBe(false);
    });

    it("excludes unknown salary when maxSalary is set", () => {
      const doc = makeDoc({ content: { expectedSalary: "" } });
      expect(bffMatchesResumeFilters(doc, "", { maxSalary: 200 })).toBe(false);
    });

    it("passes unknown salary when only minSalary is set", () => {
      const doc = makeDoc({ content: { expectedSalary: "" } });
      expect(bffMatchesResumeFilters(doc, "", { minSalary: 50 })).toBe(true);
    });

    it("excludes resumes exceeding maxSalary", () => {
      // parseSalaryRange("30-50万/年") returns {min: 300, max: 500} (in 千 units)
      const doc = makeDoc({ content: { expectedSalary: "30-50万/年" } });
      expect(bffMatchesResumeFilters(doc, "", { maxSalary: 200 })).toBe(false);
    });
  });

  describe("combined filters", () => {
    it("applies multiple filters simultaneously", () => {
      const doc = makeDoc({ content: { experience: "5年", education: "本科", expectedSalary: "15-25万/年" } });
      expect(bffMatchesResumeFilters(doc, "cnc sales", {
        minExperience: 3,
        education: ["bachelor"],
        skills: ["cnc"],
        minSalary: 100,
      })).toBe(true);
    });

    it("fails if any single filter fails", () => {
      const doc = makeDoc({ content: { experience: "1年", education: "本科", expectedSalary: "15-25万/年" } });
      expect(bffMatchesResumeFilters(doc, "cnc sales", {
        minExperience: 3,
        education: ["bachelor"],
        skills: ["cnc"],
        minSalary: 100,
      })).toBe(false);
    });
  });
});
