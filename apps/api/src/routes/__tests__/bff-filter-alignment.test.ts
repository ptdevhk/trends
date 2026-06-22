import { describe, expect, it } from "vitest";

import { bffMatchesResumeFilters } from "../../services/bff-filter-utils.js";
import { matchesResumeDigestFilters, type DigestRecord } from "@trends/shared";

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
      // Search filters use raw CNY; "15-25万/年" parses to {min: 150000, max: 250000}.
      const doc = makeDoc({ content: { expectedSalary: "15-25万/年" } });
      expect(bffMatchesResumeFilters(doc, "", { minSalary: 100000 })).toBe(true);
    });

    it("excludes resumes below minSalary using range-aware parsing", () => {
      // Search filters use raw CNY; "5-8千/月" parses to {min: 5000, max: 8000}.
      const doc = makeDoc({ content: { expectedSalary: "5-8千/月" } });
      expect(bffMatchesResumeFilters(doc, "", { minSalary: 10000 })).toBe(false);
    });

    it("excludes unknown salary when maxSalary is set", () => {
      const doc = makeDoc({ content: { expectedSalary: "" } });
      expect(bffMatchesResumeFilters(doc, "", { maxSalary: 200000 })).toBe(false);
    });

    it("passes unknown salary when only minSalary is set", () => {
      const doc = makeDoc({ content: { expectedSalary: "" } });
      expect(bffMatchesResumeFilters(doc, "", { minSalary: 50000 })).toBe(true);
    });

    it("excludes resumes exceeding maxSalary", () => {
      // Search filters use raw CNY; "30-50万/年" parses to {min: 300000, max: 500000}.
      const doc = makeDoc({ content: { expectedSalary: "30-50万/年" } });
      expect(bffMatchesResumeFilters(doc, "", { maxSalary: 200000 })).toBe(false);
    });

    it("excludes monthly wan salaries above maxSalary=25000", () => {
      const doc = makeDoc({ content: { expectedSalary: "2.8-4.2万/月" } });
      expect(bffMatchesResumeFilters(doc, "", { maxSalary: 25000 })).toBe(false);
    });
  });

  describe("combined filters", () => {
    it("applies multiple filters simultaneously", () => {
      const doc = makeDoc({ content: { experience: "5年", education: "本科", expectedSalary: "15-25万/年" } });
      expect(bffMatchesResumeFilters(doc, "cnc sales", {
        education: ["bachelor"],
        skills: ["cnc"],
        minSalary: 100000,
      })).toBe(true);
    });

    it("fails if any single filter fails", () => {
      const doc = makeDoc({ content: { experience: "1年", education: "本科", expectedSalary: "15-25万/年" } });
      expect(bffMatchesResumeFilters(doc, "cnc sales", {
        education: ["master"],
        skills: ["cnc"],
        minSalary: 100,
      })).toBe(false);
    });
  });

  describe("sources filter — sourceKey exact match", () => {
    it("matches resume by resolved sourceKey", () => {
      const doc = makeDoc({ source: "51job" });
      expect(bffMatchesResumeFilters(doc, "", { sources: ["51job"] })).toBe(true);
    });

    it("does not match via substring — '51' should not match '51job'", () => {
      const doc = makeDoc({ source: "51job" });
      expect(bffMatchesResumeFilters(doc, "", { sources: ["51"] })).toBe(false);
    });

    it("matches when sourceKey is explicitly provided", () => {
      const doc = makeDoc({ source: "seek", sourceKey: "seek" });
      expect(bffMatchesResumeFilters(doc, "", { sources: ["seek"] })).toBe(true);
    });

    it("excludes resume with non-matching source", () => {
      const doc = makeDoc({ source: "51job" });
      expect(bffMatchesResumeFilters(doc, "", { sources: ["zhilian"] })).toBe(false);
    });
  });

  describe("roleFilterType — verifiedRoleYears takes precedence", () => {
    it("matches when verifiedRoleYears has the role", () => {
      const doc = makeDoc({
        ingestData: {
          verifiedRoleYears: { "sales manager": 5 },
          roleSignals: [],
        },
      });
      expect(bffMatchesResumeFilters(doc, "", { roleFilterType: "sales manager" })).toBe(true);
    });

    it("matches when only roleSignals has the role", () => {
      const doc = makeDoc({
        ingestData: {
          verifiedRoleYears: {},
          roleSignals: [{ type: "cnc operator" }],
        },
      });
      expect(bffMatchesResumeFilters(doc, "", { roleFilterType: "cnc operator" })).toBe(true);
    });

    it("matches via verifiedRoleYears even without roleSignals", () => {
      const doc = makeDoc({
        ingestData: {
          verifiedRoleYears: { "cnc operator": 3 },
          roleSignals: [],
        },
      });
      expect(bffMatchesResumeFilters(doc, "", { roleFilterType: "cnc operator" })).toBe(true);
    });

    it("excludes when role is in neither verifiedRoleYears nor roleSignals", () => {
      const doc = makeDoc({
        ingestData: {
          verifiedRoleYears: { "sales manager": 5 },
          roleSignals: [{ type: "cnc operator" }],
        },
      });
      expect(bffMatchesResumeFilters(doc, "", { roleFilterType: "project manager" })).toBe(false);
    });

    it("matches case-insensitively", () => {
      const doc = makeDoc({
        ingestData: {
          verifiedRoleYears: { "cnc operator": 3 },
          roleSignals: [],
        },
      });
      expect(bffMatchesResumeFilters(doc, "", { roleFilterType: "CNC Operator" })).toBe(true);
    });
  });

  describe("minRoleYears filter", () => {
    it("passes when verifiedRoleYears for roleFilterType meets threshold", () => {
      const doc = makeDoc({
        ingestData: {
          verifiedRoleYears: { "sales manager": 5 },
          roleSignals: [],
        },
      });
      expect(bffMatchesResumeFilters(doc, "", { roleFilterType: "sales manager", minRoleYears: 3 })).toBe(true);
    });

    it("normalizes roleFilterType before reading legacy verifiedRoleYears", () => {
      const doc = makeDoc({
        ingestData: {
          verifiedRoleYears: { "sales manager": 5 },
          roleSignals: [],
        },
      });
      expect(bffMatchesResumeFilters(doc, "", { roleFilterType: " Sales Manager ", minRoleYears: 3 })).toBe(true);
    });

    it("excludes when verifiedRoleYears for roleFilterType is below threshold", () => {
      const doc = makeDoc({
        ingestData: {
          verifiedRoleYears: { "sales manager": 2 },
          roleSignals: [],
        },
      });
      expect(bffMatchesResumeFilters(doc, "", { roleFilterType: "sales manager", minRoleYears: 3 })).toBe(false);
    });

    it("falls back to roleSignals when no verifiedRoleYears for role", () => {
      const doc = makeDoc({
        ingestData: {
          verifiedRoleYears: {},
          roleSignals: [{ type: "cnc operator", signalCount: 3, years: 4, industryVerifiedYears: 4, matchedSignals: ["cnc"] }],
        },
      });
      expect(bffMatchesResumeFilters(doc, "", { roleFilterType: "cnc operator", minRoleYears: 3 })).toBe(true);
    });

    it("does not count direct unverified sales work-history years for the search role-year gate", () => {
      const doc = makeDoc({
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
      });

      expect(bffMatchesResumeFilters(doc, "", { roleFilterType: "sales", minRoleYears: 1 })).toBe(false);
    });

    it("does not count non-direct sales mentions for the search role-year gate", () => {
      const doc = makeDoc({
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
      });

      expect(bffMatchesResumeFilters(doc, "", { roleFilterType: "sales", minRoleYears: 1 })).toBe(false);
    });

    it("checks any role when roleFilterType is not set", () => {
      const doc = makeDoc({
        ingestData: {
          verifiedRoleYears: { "sales manager": 5 },
          roleSignals: [],
        },
      });
      expect(bffMatchesResumeFilters(doc, "", { minRoleYears: 3 })).toBe(true);
    });

    it("excludes when no role meets minRoleYears", () => {
      const doc = makeDoc({
        ingestData: {
          verifiedRoleYears: { "junior": 1 },
          roleSignals: [],
        },
      });
      expect(bffMatchesResumeFilters(doc, "", { minRoleYears: 3 })).toBe(false);
    });
  });

  describe("age filter", () => {
    it("excludes resumes below minAge", () => {
      const doc = makeDoc({ age: 25, content: { age: "25岁" } });
      expect(bffMatchesResumeFilters(doc, "", { minAge: 30 })).toBe(false);
    });

    it("passes resumes at or above minAge", () => {
      const doc = makeDoc({ age: 30, content: { age: "30岁" } });
      expect(bffMatchesResumeFilters(doc, "", { minAge: 30 })).toBe(true);
    });

    it("excludes resumes above maxAge", () => {
      const doc = makeDoc({ age: 45, content: { age: "45岁" } });
      expect(bffMatchesResumeFilters(doc, "", { maxAge: 40 })).toBe(false);
    });

    it("passes resumes at or below maxAge", () => {
      const doc = makeDoc({ age: 40, content: { age: "40岁" } });
      expect(bffMatchesResumeFilters(doc, "", { maxAge: 40 })).toBe(true);
    });

    it("parses age from content.age string when doc.age is absent", () => {
      const doc = makeDoc({ content: { age: "28岁" } });
      expect(bffMatchesResumeFilters(doc, "", { minAge: 25 })).toBe(true);
    });

    it("passes when age is unknown and age filter is set", () => {
      // Unknown age: no numeric doc.age and no parseable content.age
      const doc = makeDoc({ content: { age: "" } });
      // Age filter only applies when age can be determined
      expect(bffMatchesResumeFilters(doc, "", { minAge: 25 })).toBe(true);
    });
  });

  describe("locations filter", () => {
    it("matches location from content.location using Chinese name", () => {
      const doc = makeDoc({ content: { location: "东莞" } });
      expect(bffMatchesResumeFilters(doc, "", { locations: ["东莞"] })).toBe(true);
    });

    it("excludes when no location matches", () => {
      const doc = makeDoc({ content: { location: "深圳" } });
      expect(bffMatchesResumeFilters(doc, "", { locations: ["东莞"] })).toBe(false);
    });
  });

  describe("digest/full-doc filter parity", () => {
    it("keeps digest filter semantics aligned for the CNC sales restored-dataset filter set", () => {
      const doc = {
        isArchived: false,
        source: "job5156",
        sourceKey: "job5156",
        age: 30,
        content: {
          education: "本科",
          expectedSalary: "15K-25K",
          locationHierarchy: { country: "中国", province: "广东", city: "东莞" },
          workHistory: [{ raw: "销售工程师 CNC 数控机床渠道开发" }],
        },
        ingestData: {
          verifiedRoleYears: { sales: 3 },
          roleSignals: [{ type: "sales", years: 3 }],
        },
      };
      const digest: DigestRecord = {
        isArchived: false,
        source: "job5156",
        sourceKey: "job5156",
        age: 30,
        locationText: "中国 广东 东莞",
        educationLevel: "bachelor",
        salaryMin: 15000,
        salaryMax: 25000,
        roleTypes: ["sales"],
        roleYearsByType: { sales: 3 },
        searchText: "cnc 销售 数控 机床 渠道",
      };
      const filters = {
        minRoleYears: 1,
        roleFilterType: "sales",
        minAge: 25,
        maxAge: 40,
        locations: ["China"],
        maxSalary: 25000,
      };

      expect(matchesResumeDigestFilters(digest, filters)).toBe(true);
      expect(bffMatchesResumeFilters(doc, digest.searchText ?? "", filters)).toBe(true);
    });

    it("normalizes digest roleFilterType before checking verified role years", () => {
      const digest: DigestRecord = {
        isArchived: false,
        source: "job5156",
        sourceKey: "job5156",
        roleTypes: ["sales"],
        roleYearsByType: { sales: 2 },
        searchText: "cnc 销售",
      };

      expect(matchesResumeDigestFilters(digest, { roleFilterType: " Sales ", minRoleYears: 1 })).toBe(true);
    });

    it("lets China-source digest rows match a country-wide China filter when locationText is missing", () => {
      const digest: DigestRecord = {
        isArchived: false,
        source: "ehire.51job.com",
        sourceKey: "51job",
        locationText: "",
        searchText: "cnc 销售",
      };

      expect(matchesResumeDigestFilters(digest, { locations: ["China"], sources: ["51job"] })).toBe(true);
      expect(matchesResumeDigestFilters(digest, { locations: ["广东"], sources: ["51job"] })).toBe(false);
    });

    it("normalizes digest roleFilterType before checking verified role years", () => {
      const digest: DigestRecord = {
        isArchived: false,
        source: "job5156",
        sourceKey: "job5156",
        roleTypes: ["sales"],
        roleYearsByType: { sales: 2 },
        searchText: "cnc 销售",
      };

      expect(matchesResumeDigestFilters(digest, { roleFilterType: " Sales ", minRoleYears: 1 })).toBe(true);
    });

    it("lets China-source digest rows match a country-wide China filter when locationText is missing", () => {
      const digest: DigestRecord = {
        isArchived: false,
        source: "ehire.51job.com",
        sourceKey: "51job",
        locationText: "",
        searchText: "cnc 销售",
      };

      expect(matchesResumeDigestFilters(digest, { locations: ["China"], sources: ["51job"] })).toBe(true);
      expect(matchesResumeDigestFilters(digest, { locations: ["广东"], sources: ["51job"] })).toBe(false);
    });
  });
});
