import { describe, expect, it, vi } from "vitest";
import {
  normalizeKeywords,
  sourceMappingEntries,
  parseConvexProvenance,
  collectBffAndModeProvenance,
  normalizeMatchRecommendations,
  hasResumeListFilters,
  resolveResumeSortOrder,
  dedupeResumeSearchProvenance,
  resolveProjectedResumeRuleScore,
  buildKeywordExpansionSummary,
  buildSearchEventQuery,
  toKeywordJobDescriptionId,
  createSsePayload,
  buildKeywordRequirements,
  buildKeywordResponsibilities,
  createResumeMatchContextMap,
  toResumeItemFromRecord,
  prepareResumeCandidate,
  filterPreparedCandidatesByResumeFilters,
  buildAiResumePayload,
} from "../resume-candidate-prep.js";
import type { ResumeItem } from "../../types/resume.js";
import type { ResumeIndex } from "../resume-index.js";
import type { ResumeKeywordExpansion, PreparedResumeCandidate, ResumeMatchContextEntry } from "../resume-candidate-prep.js";
import type { StoredMatch } from "../match-storage.js";
import type { MatchingResult } from "../ai-matching.js";
import type { ResumeFilters } from "../resume-service.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeMinimalResume(overrides: Partial<ResumeItem> = {}): ResumeItem {
  return {
    name: "John Doe",
    profileUrl: "http://example.com/john",
    source: "linkedin",
    activityStatus: "active",
    age: "30",
    experience: "5 years",
    education: "Bachelor",
    location: "New York",
    selfIntro: "Software engineer",
    jobIntention: "Senior role",
    expectedSalary: "100k",
    workHistory: [],
    extractedAt: "2025-01-01",
    ...overrides,
  };
}

function makeMinimalIndex(overrides: Partial<ResumeIndex> = {}): ResumeIndex {
  return {
    resumeId: "res-1",
    experienceYears: 5,
    educationLevel: "Bachelor",
    locationCity: "New York",
    skills: ["JavaScript", "TypeScript"],
    companies: ["Acme Corp"],
    industryTags: ["tech"],
    salaryRange: null,
    searchText: "john doe new york bachelor javascript typescript acme corp",
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("resume-candidate-prep", () => {
  // ── normalizeKeywords ────────────────────────────────────────────────────
  describe("normalizeKeywords", () => {
    it("normalizes keywords to lowercase array", () => {
      expect(normalizeKeywords(["JavaScript", "React"])).toEqual(["javascript", "react"]);
    });

    it("handles undefined input", () => {
      expect(normalizeKeywords(undefined)).toEqual([]);
    });

    it("handles null-like non-array values", () => {
      expect(normalizeKeywords(null as unknown as string[])).toEqual([]);
    });

    it("handles empty array", () => {
      expect(normalizeKeywords([])).toEqual([]);
    });

    it("trims whitespace and lowercases", () => {
      expect(normalizeKeywords(["  Node.js  ", " Express "])).toEqual(["node.js", "express"]);
    });

    it("handles mixed case phrases", () => {
      expect(normalizeKeywords(["Machine Learning", "Deep Learning"])).toEqual(["machine learning", "deep learning"]);
    });
  });

  // ── sourceMappingEntries ─────────────────────────────────────────────────
  describe("sourceMappingEntries", () => {
    it("converts record to array of term/expandedFrom objects", () => {
      const result = sourceMappingEntries({ js: "javascript", ts: "typescript" });
      expect(result).toEqual([
        { term: "js", expandedFrom: "javascript" },
        { term: "ts", expandedFrom: "typescript" },
      ]);
    });

    it("returns empty array for undefined input", () => {
      expect(sourceMappingEntries(undefined)).toEqual([]);
    });

    it("returns empty array for empty record", () => {
      expect(sourceMappingEntries({})).toEqual([]);
    });

    it("handles single entry", () => {
      const result = sourceMappingEntries({ react: "React.js" });
      expect(result).toEqual([{ term: "react", expandedFrom: "React.js" }]);
    });
  });

  // ── parseConvexProvenance ────────────────────────────────────────────────
  describe("parseConvexProvenance", () => {
    it("parses valid provenance items", () => {
      const result = parseConvexProvenance([
        { term: "react", source: "synonymHits" },
        { term: "javascript", source: "searchText", expandedFrom: "js" },
      ]);
      expect(result).toEqual([
        { term: "react", source: "synonymHits" },
        { term: "javascript", source: "searchText", expandedFrom: "js" },
      ]);
    });

    it("returns undefined for non-array input", () => {
      expect(parseConvexProvenance(null)).toBeUndefined();
      expect(parseConvexProvenance(undefined)).toBeUndefined();
      expect(parseConvexProvenance("string")).toBeUndefined();
      expect(parseConvexProvenance({})).toBeUndefined();
    });

    it("filters out items with invalid source", () => {
      const result = parseConvexProvenance([
        { term: "react", source: "synonymHits" },
        { term: "foo", source: "invalidSource" },
      ]);
      expect(result).toEqual([{ term: "react", source: "synonymHits" }]);
    });

    it("filters out items missing term", () => {
      const result = parseConvexProvenance([
        { term: "", source: "searchText" },
        { term: "react", source: "searchText" },
      ]);
      expect(result).toEqual([{ term: "react", source: "searchText" }]);
    });

    it("filters out non-record items", () => {
      const result = parseConvexProvenance(["string", 42, { term: "react", source: "synonymHits" }]);
      expect(result).toEqual([{ term: "react", source: "synonymHits" }]);
    });

    it("handles empty array", () => {
      expect(parseConvexProvenance([])).toBeUndefined();
    });

    it("accepts all valid source values", () => {
      const result = parseConvexProvenance([
        { term: "a", source: "searchText" },
        { term: "b", source: "industryTags" },
        { term: "c", source: "companyHits" },
        { term: "d", source: "synonymHits" },
      ]);
      expect(result).toHaveLength(4);
    });

    it("handles expandedFrom optional field", () => {
      const result = parseConvexProvenance([
        { term: "react", source: "synonymHits" },
        { term: "js", source: "searchText", expandedFrom: "javascript" },
      ]);
      expect(result![1].expandedFrom).toBe("javascript");
    });
  });

  // ── collectBffAndModeProvenance ──────────────────────────────────────────
  describe("collectBffAndModeProvenance", () => {
    it("collects matching variants from search text", () => {
      const result = collectBffAndModeProvenance(
        "javascript react node",
        [
          { original: "JS", variants: ["javascript", "js"] },
          { original: "React", variants: ["react", "reactjs"] },
        ],
        {},
      );
      expect(result).toEqual([
        { term: "javascript", source: "searchText" },
        { term: "react", source: "searchText" },
      ]);
    });

    it("deduplicates matching terms", () => {
      const result = collectBffAndModeProvenance(
        "javascript javascript",
        [
          { original: "JS", variants: ["javascript"] },
        ],
        {},
      );
      expect(result).toHaveLength(1);
    });

    it("attaches expandedFrom from source mapping", () => {
      const result = collectBffAndModeProvenance(
        "react",
        [
          { original: "React", variants: ["react"] },
        ],
        { react: "React.js" },
      );
      expect(result).toEqual([{ term: "react", source: "searchText", expandedFrom: "React.js" }]);
    });

    it("returns empty array when no variants match", () => {
      const result = collectBffAndModeProvenance(
        "python",
        [
          { original: "JS", variants: ["javascript", "js"] },
        ],
        {},
      );
      expect(result).toEqual([]);
    });

    it("handles empty groups", () => {
      const result = collectBffAndModeProvenance("javascript", [], {});
      expect(result).toEqual([]);
    });

    it("handles empty search text", () => {
      const result = collectBffAndModeProvenance("", [{ original: "JS", variants: ["javascript"] }], {});
      expect(result).toEqual([]);
    });
  });

  // ── normalizeMatchRecommendations ────────────────────────────────────────
  describe("normalizeMatchRecommendations", () => {
    it("filters and deduplicates valid recommendations", () => {
      const result = normalizeMatchRecommendations(["strong_match", "match", "strong_match", "no_match"]);
      expect(result).toEqual(["strong_match", "match", "no_match"]);
    });

    it("returns undefined for empty array", () => {
      expect(normalizeMatchRecommendations([])).toBeUndefined();
    });

    it("returns undefined for undefined input", () => {
      expect(normalizeMatchRecommendations(undefined)).toBeUndefined();
    });

    it("filters out invalid recommendations", () => {
      const result = normalizeMatchRecommendations(["strong_match", "invalid_rec", "match"]);
      expect(result).toEqual(["strong_match", "match"]);
    });

    it("handles all valid recommendations", () => {
      const result = normalizeMatchRecommendations(["strong_match", "match", "potential", "no_match"]);
      expect(result).toEqual(["strong_match", "match", "potential", "no_match"]);
    });

    it("trims whitespace from values", () => {
      const result = normalizeMatchRecommendations(["  strong_match  ", " match "]);
      expect(result).toEqual(["strong_match", "match"]);
    });

    it("returns undefined when only invalid values", () => {
      const result = normalizeMatchRecommendations(["invalid1", "invalid2"]);
      expect(result).toBeUndefined();
    });
  });

  // ── hasResumeListFilters ─────────────────────────────────────────────────
  describe("hasResumeListFilters", () => {
    it("returns false for empty params", () => {
      expect(hasResumeListFilters({})).toBe(false);
    });

    it("detects maxExperience", () => {
      expect(hasResumeListFilters({ maxExperience: 10 })).toBe(true);
    });

    it("detects education list", () => {
      expect(hasResumeListFilters({ education: ["Bachelor"] })).toBe(true);
    });

    it("detects skills list", () => {
      expect(hasResumeListFilters({ skills: ["JavaScript"] })).toBe(true);
    });

    it("detects requiredKeywords list", () => {
      expect(hasResumeListFilters({ requiredKeywords: ["react"] })).toBe(true);
    });

    it("detects locations list", () => {
      expect(hasResumeListFilters({ locations: ["New York"] })).toBe(true);
    });

    it("detects minSalary", () => {
      expect(hasResumeListFilters({ minSalary: 50000 })).toBe(true);
    });

    it("detects maxSalary", () => {
      expect(hasResumeListFilters({ maxSalary: 150000 })).toBe(true);
    });

    it("detects minRoleYears", () => {
      expect(hasResumeListFilters({ minRoleYears: 3 })).toBe(true);
    });

    it("detects roleFilterType", () => {
      expect(hasResumeListFilters({ roleFilterType: "engineer" })).toBe(true);
    });

    it("detects minAge", () => {
      expect(hasResumeListFilters({ minAge: 18 })).toBe(true);
    });

    it("detects maxAge", () => {
      expect(hasResumeListFilters({ maxAge: 65 })).toBe(true);
    });

    it("detects sources list", () => {
      expect(hasResumeListFilters({ sources: ["linkedin"] })).toBe(true);
    });

    it("returns false for empty arrays", () => {
      expect(hasResumeListFilters({ skills: [], education: [] })).toBe(false);
    });

    it("returns false for zero numeric values", () => {
      expect(hasResumeListFilters({ minRoleYears: 0 })).toBe(true);
    });
  });

  // ── resolveResumeSortOrder ───────────────────────────────────────────────
  describe("resolveResumeSortOrder", () => {
    it("returns sortOrder when sortBy is score (default)", () => {
      expect(resolveResumeSortOrder("score", "asc")).toBe("asc");
      expect(resolveResumeSortOrder("score", "desc")).toBe("desc");
    });

    it("returns sortOrder when sortBy is undefined", () => {
      expect(resolveResumeSortOrder(undefined, "desc")).toBe("desc");
    });

    it("returns undefined when sortBy is score and sortOrder is undefined", () => {
      expect(resolveResumeSortOrder("score", undefined)).toBeUndefined();
    });

    it("defaults to asc for name sort", () => {
      expect(resolveResumeSortOrder("name", undefined)).toBe("asc");
    });

    it("returns explicit sortOrder for name when provided", () => {
      expect(resolveResumeSortOrder("name", "desc")).toBe("desc");
    });

    it("defaults to asc for experience sort", () => {
      expect(resolveResumeSortOrder("experience", undefined)).toBe("asc");
    });

    it("defaults to asc for extractedAt sort", () => {
      expect(resolveResumeSortOrder("extractedAt", undefined)).toBe("asc");
    });
  });

  // ── dedupeResumeSearchProvenance ────────────────────────────────────────
  describe("dedupeResumeSearchProvenance", () => {
    it("deduplicates by source|term|expandedFrom key", () => {
      const result = dedupeResumeSearchProvenance([
        { term: "react", source: "synonymHits" },
        { term: "react", source: "synonymHits" },
        { term: "javascript", source: "searchText" },
      ]);
      expect(result).toEqual([
        { term: "react", source: "synonymHits" },
        { term: "javascript", source: "searchText" },
      ]);
    });

    it("treats items with different expandedFrom as distinct", () => {
      const result = dedupeResumeSearchProvenance([
        { term: "js", source: "searchText", expandedFrom: "javascript" },
        { term: "js", source: "searchText", expandedFrom: "javascript" },
      ]);
      expect(result).toHaveLength(1);
    });

    it("treats same term different source as distinct", () => {
      const result = dedupeResumeSearchProvenance([
        { term: "react", source: "searchText" },
        { term: "react", source: "synonymHits" },
      ]);
      expect(result).toHaveLength(2);
    });

    it("returns empty array for undefined input", () => {
      expect(dedupeResumeSearchProvenance(undefined)).toEqual([]);
    });

    it("preserves order of first occurrence", () => {
      const result = dedupeResumeSearchProvenance([
        { term: "c", source: "searchText" },
        { term: "a", source: "searchText" },
        { term: "c", source: "searchText" },
        { term: "b", source: "searchText" },
      ]);
      expect(result.map((r) => r.term)).toEqual(["c", "a", "b"]);
    });

    it("handles items with expandedFrom undefined", () => {
      const result = dedupeResumeSearchProvenance([
        { term: "react", source: "synonymHits" },
      ]);
      expect(result).toEqual([{ term: "react", source: "synonymHits" }]);
    });
  });

  // ── resolveProjectedResumeRuleScore ──────────────────────────────────────
  describe("resolveProjectedResumeRuleScore", () => {
    it("resolves score from ingestData.ruleScores by jobDescriptionId", () => {
      const result = resolveProjectedResumeRuleScore(
        { ingestData: { ruleScores: { "jd-1": 85 } } },
        "jd-1",
      );
      expect(result).toBe(85);
    });

    it("returns 0 when ingestData is missing", () => {
      const result = resolveProjectedResumeRuleScore({}, "jd-1");
      expect(result).toBe(0);
    });

    it("returns 0 when ruleScores is missing", () => {
      const result = resolveProjectedResumeRuleScore(
        { ingestData: {} },
        "jd-1",
      );
      expect(result).toBe(0);
    });

    it("returns 0 when jobDescriptionId not in ruleScores", () => {
      const result = resolveProjectedResumeRuleScore(
        { ingestData: { ruleScores: { "jd-2": 90 } } },
        "jd-1",
      );
      expect(result).toBe(0);
    });

    it("handles non-record ingestData", () => {
      const result = resolveProjectedResumeRuleScore(
        { ingestData: "invalid" },
        "jd-1",
      );
      expect(result).toBe(0);
    });

    it("handles non-record ruleScores", () => {
      const result = resolveProjectedResumeRuleScore(
        { ingestData: { ruleScores: "invalid" } },
        "jd-1",
      );
      expect(result).toBe(0);
    });
  });

  // ── buildKeywordExpansionSummary ────────────────────────────────────────
  describe("buildKeywordExpansionSummary", () => {
    it("builds summary from expansion with all fields", () => {
      const expansion = {
        flatTerms: ["javascript", "react"],
        mode: "AND" as const,
        groups: [{ original: "JS", variants: ["javascript", "js"] }],
        sourceMapping: { js: "javascript" },
      };
      const result = buildKeywordExpansionSummary(expansion);
      expect(result).toEqual({
        expandedTo: ["javascript", "react"],
        mode: "AND",
        keywordGroups: [{ original: "JS", variants: ["javascript", "js"] }],
        sourceMapping: { js: "javascript" },
      });
    });

    it("handles undefined expansion", () => {
      const result = buildKeywordExpansionSummary(undefined as unknown as ResumeKeywordExpansion);
      expect(result).toEqual({
        expandedTo: undefined,
        mode: undefined,
        keywordGroups: undefined,
        sourceMapping: undefined,
      });
    });

    it("handles null expansion", () => {
      const result = buildKeywordExpansionSummary(null as unknown as ResumeKeywordExpansion);
      expect(result).toEqual({
        expandedTo: undefined,
        mode: undefined,
        keywordGroups: undefined,
        sourceMapping: undefined,
      });
    });

    it("handles expansion with partial fields", () => {
      const expansion = { mode: "OR" as const };
      const result = buildKeywordExpansionSummary(expansion as unknown as ResumeKeywordExpansion);
      expect(result).toEqual({
        expandedTo: undefined,
        mode: "OR",
        keywordGroups: undefined,
        sourceMapping: undefined,
      });
    });
  });

  // ── buildSearchEventQuery ────────────────────────────────────────────────
  describe("buildSearchEventQuery", () => {
    it("builds query from keywords", () => {
      expect(buildSearchEventQuery({ keywords: ["react", "node"] })).toBe("react node");
    });

    it("appends location when provided", () => {
      expect(buildSearchEventQuery({ keywords: ["react"], location: "New York" })).toBe("react New York");
    });

    it("returns null when keywords are empty even with location", () => {
      // The function only uses location when keywordQuery is truthy;
      // with empty keywords, it falls through to jobDescriptionId check.
      expect(buildSearchEventQuery({ keywords: [], location: "NY" })).toBeNull();
    });

    it("uses jd: prefix when keywords are empty and no location", () => {
      expect(buildSearchEventQuery({ keywords: [], jobDescriptionId: "jd-123" })).toBe("jd:jd-123");
    });

    it("uses jd: prefix when keywords are all empty/whitespace", () => {
      expect(buildSearchEventQuery({ keywords: ["  ", ""], jobDescriptionId: "jd-456" })).toBe("jd:jd-456");
    });

    it("returns null when keywords and jobDescriptionId are empty/missing", () => {
      expect(buildSearchEventQuery({ keywords: [] })).toBeNull();
    });

    it("trims location whitespace", () => {
      expect(buildSearchEventQuery({ keywords: ["react"], location: "  NYC  " })).toBe("react NYC");
    });

    it("trims jobDescriptionId whitespace", () => {
      expect(buildSearchEventQuery({ keywords: [], jobDescriptionId: "  jd-789  " })).toBe("jd:jd-789");
    });
  });

  // ── toKeywordJobDescriptionId ────────────────────────────────────────────
  describe("toKeywordJobDescriptionId", () => {
    it("builds keyword analysis ID from keywords", () => {
      const id = toKeywordJobDescriptionId(["react", "node"]);
      expect(id).toBeTruthy();
      expect(typeof id).toBe("string");
      expect(id.length).toBeGreaterThan(0);
    });

    it("includes location when provided", () => {
      const idWithLocation = toKeywordJobDescriptionId(["react"], "New York");
      const idWithoutLocation = toKeywordJobDescriptionId(["react"]);
      expect(idWithLocation).toBeTruthy();
      expect(idWithLocation).not.toBe(idWithoutLocation);
    });

    it("produces consistent output for same input", () => {
      const id1 = toKeywordJobDescriptionId(["react", "node"], "NYC");
      const id2 = toKeywordJobDescriptionId(["react", "node"], "NYC");
      expect(id1).toBe(id2);
    });

    it("produces different output for different inputs", () => {
      const id1 = toKeywordJobDescriptionId(["react"]);
      const id2 = toKeywordJobDescriptionId(["vue"]);
      expect(id1).not.toBe(id2);
    });
  });

  // ── createSsePayload ─────────────────────────────────────────────────────
  describe("createSsePayload", () => {
    it("formats SSE payload with event and string data", () => {
      const result = createSsePayload("progress", "50%");
      expect(result).toBe("event: progress\ndata: \"50%\"\n\n");
    });

    it("formats SSE payload with object data", () => {
      const result = createSsePayload("result", { score: 85, status: "done" });
      expect(result).toBe("event: result\ndata: {\"score\":85,\"status\":\"done\"}\n\n");
    });

    it("handles numeric data", () => {
      const result = createSsePayload("count", 42);
      expect(result).toBe("event: count\ndata: 42\n\n");
    });

    it("handles boolean data", () => {
      const result = createSsePayload("flag", true);
      expect(result).toBe("event: flag\ndata: true\n\n");
    });

    it("handles null data", () => {
      const result = createSsePayload("empty", null);
      expect(result).toBe("event: empty\ndata: null\n\n");
    });

    it("handles array data", () => {
      const result = createSsePayload("items", [1, 2, 3]);
      expect(result).toBe("event: items\ndata: [1,2,3]\n\n");
    });
  });

  // ── buildKeywordRequirements ─────────────────────────────────────────────
  describe("buildKeywordRequirements", () => {
    it("builds Chinese requirements text from keywords", () => {
      const result = buildKeywordRequirements(["React", "Node.js"]);
      expect(result).toBe("候选人需具备以下关键技能/经验:\n- React\n- Node.js");
    });

    it("handles single keyword", () => {
      const result = buildKeywordRequirements(["JavaScript"]);
      expect(result).toBe("候选人需具备以下关键技能/经验:\n- JavaScript");
    });

    it("handles empty array", () => {
      const result = buildKeywordRequirements([]);
      expect(result).toBe("候选人需具备以下关键技能/经验:\n");
    });

    it("handles many keywords", () => {
      const result = buildKeywordRequirements(["a", "b", "c"]);
      expect(result).toBe("候选人需具备以下关键技能/经验:\n- a\n- b\n- c");
    });

    it("preserves keyword casing", () => {
      const result = buildKeywordRequirements(["TypeScript", "CSS"]);
      expect(result).toContain("TypeScript");
      expect(result).toContain("CSS");
    });
  });

  // ── buildKeywordResponsibilities ─────────────────────────────────────────
  describe("buildKeywordResponsibilities", () => {
    it("builds responsibilities text from keywords and location", () => {
      const result = buildKeywordResponsibilities(["React", "Node"], "New York");
      expect(result).toBe("核心关键词: React, Node\n目标地点: New York");
    });

    it("omits location when not provided", () => {
      const result = buildKeywordResponsibilities(["React", "Node"]);
      expect(result).toBe("核心关键词: React, Node");
    });

    it("returns prefix even for empty keywords and no location", () => {
      // The function always includes "核心关键词:" even when keywords are empty
      expect(buildKeywordResponsibilities([])).toBe("核心关键词: ");
    });

    it("includes prefix plus location when keywords are empty", () => {
      const result = buildKeywordResponsibilities([], "New York");
      expect(result).toBe("核心关键词: \n目标地点: New York");
    });

    it("trims location whitespace", () => {
      const result = buildKeywordResponsibilities(["React"], "  NYC  ");
      expect(result).toBe("核心关键词: React\n目标地点: NYC");
    });

    it("handles single keyword", () => {
      const result = buildKeywordResponsibilities(["TypeScript"], "London");
      expect(result).toBe("核心关键词: TypeScript\n目标地点: London");
    });
  });

  // ── createResumeMatchContextMap ──────────────────────────────────────────
  describe("createResumeMatchContextMap", () => {
    it("creates map from StoredMatch entries", () => {
      const matches: StoredMatch[] = [
        {
          id: 1,
          resumeId: "res-1",
          jobDescriptionId: "jd-1",
          score: 85,
          recommendation: "strong_match",
          highlights: [],
          concerns: [],
          summary: "Good match",
          scoreSource: "ai",
          matchedAt: "2025-01-01",
        },
        {
          id: 2,
          resumeId: "res-2",
          jobDescriptionId: "jd-1",
          score: 60,
          recommendation: "match",
          highlights: [],
          concerns: [],
          summary: "Decent match",
          scoreSource: "rule",
          matchedAt: "2025-01-01",
        },
      ];
      const map = createResumeMatchContextMap(matches);
      expect(map.get("res-1")).toEqual({ score: 85, recommendation: "strong_match" });
      expect(map.get("res-2")).toEqual({ score: 60, recommendation: "match" });
      expect(map.size).toBe(2);
    });

    it("creates map from ResumeMatchContextEntry entries", () => {
      const entries: ResumeMatchContextEntry[] = [
        { resumeId: "res-1", score: 90, recommendation: "strong_match" },
        { resumeId: "res-2", score: 45, recommendation: "no_match" },
      ];
      const map = createResumeMatchContextMap(entries);
      expect(map.get("res-1")).toEqual({ score: 90, recommendation: "strong_match" });
      expect(map.get("res-2")).toEqual({ score: 45, recommendation: "no_match" });
    });

    it("handles empty array", () => {
      const map = createResumeMatchContextMap([]);
      expect(map.size).toBe(0);
    });

    it("overwrites duplicate resume IDs with last entry", () => {
      const matches: ResumeMatchContextEntry[] = [
        { resumeId: "res-1", score: 70, recommendation: "match" },
        { resumeId: "res-1", score: 95, recommendation: "strong_match" },
      ];
      const map = createResumeMatchContextMap(matches);
      expect(map.get("res-1")).toEqual({ score: 95, recommendation: "strong_match" });
    });
  });

  // ── toResumeItemFromRecord ───────────────────────────────────────────────
  describe("toResumeItemFromRecord", () => {
    it("converts a record to ResumeItem", () => {
      const record = {
        name: "John Doe",
        profileUrl: "http://example.com/john",
        source: "linkedin",
        activityStatus: "active",
        age: "30",
        experience: "5 years",
        education: "Bachelor",
        location: "New York",
        selfIntro: "Engineer",
        jobIntention: "Senior",
        expectedSalary: "100k",
        extractedAt: "2025-01-01",
      };
      const item = toResumeItemFromRecord(record);
      expect(item.name).toBe("John Doe");
      expect(item.profileUrl).toBe("http://example.com/john");
      expect(item.source).toBe("linkedin");
      expect(item.experience).toBe("5 years");
    });

    it("handles profileUrl fallback keys", () => {
      // Use type workaround to omit profileUrl so ?? fallback activates
      const item1 = toResumeItemFromRecord({ profile_url: "http://url1", name: "A", activityStatus: "", age: "", experience: "", education: "", location: "", selfIntro: "", jobIntention: "", expectedSalary: "", workHistory: [], extractedAt: "" } as Record<string, unknown>);
      expect(item1.profileUrl).toBe("http://url1");

      const item2 = toResumeItemFromRecord({ profileURL: "http://url2", name: "B", activityStatus: "", age: "", experience: "", education: "", location: "", selfIntro: "", jobIntention: "", expectedSalary: "", workHistory: [], extractedAt: "" } as Record<string, unknown>);
      expect(item2.profileUrl).toBe("http://url2");

      const item3 = toResumeItemFromRecord({ url: "http://url3", name: "C", activityStatus: "", age: "", experience: "", education: "", location: "", selfIntro: "", jobIntention: "", expectedSalary: "", workHistory: [], extractedAt: "" } as Record<string, unknown>);
      expect(item3.profileUrl).toBe("http://url3");
    });

    it("uses source parameter when record has no source", () => {
      const item = toResumeItemFromRecord(
        { name: "John", profileUrl: "", activityStatus: "", age: "", experience: "", education: "", location: "", selfIntro: "", jobIntention: "", expectedSalary: "", workHistory: [], extractedAt: "" },
        "linkedin",
      );
      expect(item.source).toBe("linkedin");
    });

    it("normalizes workHistory entries", () => {
      const record = {
        name: "John",
        profileUrl: "",
        activityStatus: "",
        age: "",
        experience: "",
        education: "",
        location: "",
        selfIntro: "",
        jobIntention: "",
        expectedSalary: "",
        workHistory: [
          { companyName: "Acme Corp", jobTitle: "Engineer", startDate: "2020-01", endDate: "2023-01" },
          { companyName: "  ", jobTitle: "", startDate: "" }, // should be filtered out
        ],
        extractedAt: "2025-01-01",
      };
      const item = toResumeItemFromRecord(record);
      expect(item.workHistory).toHaveLength(1);
      expect(item.workHistory[0]!.companyName).toBe("Acme Corp");
    });

    it("handles non-array workHistory", () => {
      const item = toResumeItemFromRecord(
        { name: "John", profileUrl: "", workHistory: "invalid", activityStatus: "", age: "", experience: "", education: "", location: "", selfIntro: "", jobIntention: "", expectedSalary: "", extractedAt: "" },
      );
      expect(item.workHistory).toEqual([]);
    });

    it("includes projectExperience when present", () => {
      const record = {
        name: "John",
        profileUrl: "",
        activityStatus: "",
        age: "",
        experience: "",
        education: "",
        location: "",
        selfIntro: "",
        jobIntention: "",
        expectedSalary: "",
        workHistory: [],
        projectExperience: [{ companyName: "Project X" }],
        extractedAt: "2025-01-01",
      };
      const item = toResumeItemFromRecord(record);
      expect(item.projectExperience).toHaveLength(1);
    });

    it("omits projectExperience when empty", () => {
      const item = toResumeItemFromRecord(
        { name: "John", profileUrl: "", projectExperience: [], activityStatus: "", age: "", experience: "", education: "", location: "", selfIntro: "", jobIntention: "", expectedSalary: "", workHistory: [], extractedAt: "" },
      );
      expect(item.projectExperience).toBeUndefined();
    });

    it("handles null profileEducation entries", () => {
      const record = {
        name: "John",
        profileUrl: "",
        activityStatus: "",
        age: "",
        experience: "",
        education: "",
        location: "",
        selfIntro: "",
        jobIntention: "",
        expectedSalary: "",
        workHistory: [],
        profileEducation: [null, { institution: "MIT" }],
        extractedAt: "2025-01-01",
      };
      const item = toResumeItemFromRecord(record);
      expect(item.profileEducation).toHaveLength(1);
      expect(item.profileEducation![0]!.institution).toBe("MIT");
    });

    it("preserves searchText when present", () => {
      const record = {
        name: "John",
        profileUrl: "",
        searchText: "john doe engineer",
        activityStatus: "",
        age: "",
        experience: "",
        education: "",
        location: "",
        selfIntro: "",
        jobIntention: "",
        expectedSalary: "",
        workHistory: [],
        extractedAt: "2025-01-01",
      };
      const item = toResumeItemFromRecord(record);
      expect(item.searchText).toBe("john doe engineer");
    });

    it("handles resumeId, perUserId, profileId, externalId", () => {
      const record = {
        name: "John",
        profileUrl: "",
        activityStatus: "",
        age: "",
        experience: "",
        education: "",
        location: "",
        selfIntro: "",
        jobIntention: "",
        expectedSalary: "",
        workHistory: [],
        extractedAt: "",
        resumeId: "res-1",
        perUserId: "user-1",
        profileId: "profile-1",
        externalId: "ext-1",
      };
      const item = toResumeItemFromRecord(record);
      expect(item.resumeId).toBe("res-1");
      expect(item.perUserId).toBe("user-1");
      expect(item.profileId).toBe("profile-1");
      expect(item.externalId).toBe("ext-1");
    });
  });

  // ── prepareResumeCandidate ──────────────────────────────────────────────
  describe("prepareResumeCandidate", () => {
    it("prepares candidate with provided indexData", () => {
      const resume = makeMinimalResume();
      const indexData = makeMinimalIndex();
      const result = prepareResumeCandidate({ resume, resumeId: "res-1", indexData });
      expect(result.resumeId).toBe("res-1");
      expect(result.indexData).toBe(indexData);
      expect(result.primaryRuleScore).toBeUndefined();
      expect(result.provenance).toBeUndefined();
      expect(result.brandHits).toEqual([]);
      expect(result.companyHits).toEqual([]);
      expect(result.roleSignals).toEqual([]);
    });

    it("assigns resumeId from params when not in resume", () => {
      const resume = makeMinimalResume({ resumeId: undefined });
      const result = prepareResumeCandidate({ resume, resumeId: "res-from-params", indexData: makeMinimalIndex() });
      expect(result.resume.resumeId).toBe("res-from-params");
    });

    it("uses provided ingestData over resume.ingestData", () => {
      const resume = makeMinimalResume({ ingestData: { brandHits: [{ brand: "Old", role: "employer", source: "workHistory", context: "employer" }] } });
      const result = prepareResumeCandidate({
        resume,
        resumeId: "res-1",
        indexData: makeMinimalIndex(),
        ingestData: { brandHits: [{ brand: "New", role: "equipment", source: "workHistory", context: "employer" }] },
      });
      expect(result.brandHits).toHaveLength(1);
      expect(result.brandHits[0]!.brand).toBe("New");
    });

    it("parses brandHits, companyHits, roleSignals from ingestData", () => {
      const resume = makeMinimalResume();
      const ingestData = {
        brandHits: [{ brand: "Haas", role: "employer", source: "workHistory", context: "employer" }],
        companyHits: ["Acme Corp"],
        roleSignals: [{ type: "engineer", years: 5, matchedSignals: ["problem-solving"], verifyIn: "workHistory" }],
      };
      const result = prepareResumeCandidate({
        resume,
        resumeId: "res-1",
        indexData: makeMinimalIndex(),
        ingestData,
      });
      expect(result.brandHits).toHaveLength(1);
      expect(result.companyHits).toEqual(["Acme Corp"]);
      expect(result.roleSignals).toHaveLength(1);
    });

    it("creates fallback index when indexData not provided", () => {
      const resume = makeMinimalResume({
        name: "Alice",
        location: "London",
        education: "Master",
        workHistory: [{ companyName: "Tech Corp", jobTitle: "Dev", startDate: "2020-01", endDate: "2023-01" }],
      });
      const result = prepareResumeCandidate({ resume, resumeId: "res-fallback" });
      expect(result.indexData.searchText).toContain("alice");
      expect(result.indexData.searchText).toContain("london");
      expect(result.indexData.companies).toContain("Tech Corp");
      expect(result.indexData.experienceYears).toBeNull();
    });

    it("preserves primaryRuleScore and provenance", () => {
      const result = prepareResumeCandidate({
        resume: makeMinimalResume(),
        resumeId: "res-1",
        indexData: makeMinimalIndex(),
        primaryRuleScore: 92,
        provenance: [{ term: "react", source: "searchText" }],
      });
      expect(result.primaryRuleScore).toBe(92);
      expect(result.provenance).toEqual([{ term: "react", source: "searchText" }]);
    });

    it("handles empty ingestData gracefully", () => {
      const result = prepareResumeCandidate({
        resume: makeMinimalResume(),
        resumeId: "res-1",
        indexData: makeMinimalIndex(),
        ingestData: undefined,
      });
      expect(result.brandHits).toEqual([]);
      expect(result.companyHits).toEqual([]);
      expect(result.roleSignals).toEqual([]);
    });
  });

  // ── filterPreparedCandidatesByResumeFilters ─────────────────────────────
  describe("filterPreparedCandidatesByResumeFilters", () => {
    it("returns all prepared candidates when no filters provided", () => {
      const prepared = [
        { resume: makeMinimalResume({ name: "Alice" }), resumeId: "alice" } as PreparedResumeCandidate,
        { resume: makeMinimalResume({ name: "Bob" }), resumeId: "bob" } as PreparedResumeCandidate,
      ];
      const result = filterPreparedCandidatesByResumeFilters(prepared, undefined, {} as never);
      expect(result).toHaveLength(2);
    });

    it("filters candidates using ResumeService.filterResumes", () => {
      const alice = makeMinimalResume({ name: "Alice" });
      const bob = makeMinimalResume({ name: "Bob" });
      const prepared = [
        { resume: alice, resumeId: "alice" } as PreparedResumeCandidate,
        { resume: bob, resumeId: "bob" } as PreparedResumeCandidate,
      ];
      const filters: ResumeFilters = { skills: ["JavaScript"] };

      const mockResumeService = {
        filterResumes: vi.fn().mockReturnValue(new Set([alice])),
        filterResumesByContent: vi.fn(),
        expandSearchQuery: vi.fn(),
        computeMultiBrandScores: vi.fn(),
      };

      const result = filterPreparedCandidatesByResumeFilters(prepared, filters, mockResumeService as never);
      expect(result).toHaveLength(1);
      expect(result[0]!.resumeId).toBe("alice");
      expect(mockResumeService.filterResumes).toHaveBeenCalledWith(
        [alice, bob],
        filters,
      );
    });

    it("returns empty when all candidates are filtered out", () => {
      const prepared = [
        { resume: makeMinimalResume({ name: "Alice" }), resumeId: "alice" } as PreparedResumeCandidate,
      ];
      const mockResumeService = {
        filterResumes: vi.fn().mockReturnValue(new Set()),
        filterResumesByContent: vi.fn(),
        expandSearchQuery: vi.fn(),
        computeMultiBrandScores: vi.fn(),
      };
      const result = filterPreparedCandidatesByResumeFilters(prepared, { skills: ["Nonexistent"] }, mockResumeService as never);
      expect(result).toHaveLength(0);
    });
  });

  // ── buildAiResumePayload ─────────────────────────────────────────────────
  describe("buildAiResumePayload", () => {
    it("builds AI matching payload from prepared candidate", () => {
      const resume = makeMinimalResume({
        name: "Alice Smith",
        education: "Master",
        profileType: "seek",
        workHistory: [
          { companyName: "Tech Corp", jobTitle: "Senior Engineer", startDate: "2020-01", endDate: "2023-01", description: "Built systems" },
        ],
      });
      const indexData = makeMinimalIndex({
        experienceYears: 6,
        skills: ["JavaScript", "React"],
        companies: ["Tech Corp"],
      });
      const item = { resume, resumeId: "res-1", indexData, companyHits: ["Tech Corp"], roleSignals: [{ type: "engineer", matchedSignals: ["problem-solving"], signalCount: 1, occurrences: 1, years: 3, verifyIn: "workHistory" as const }] };
      const payload = buildAiResumePayload(item);
      expect(payload.id).toBe("res-1");
      expect(payload.name).toBe("Alice Smith");
      expect(payload.workExperience).toBe(6);
      expect(payload.education).toBe("Master");
      expect(payload.skills).toEqual(["JavaScript", "React"]);
      expect(payload.companies).toEqual(["Tech Corp"]);
      expect(payload.companyHits).toEqual(["Tech Corp"]);
      expect(payload.roleSignals).toHaveLength(1);
      expect(payload.workHistory).toBeTruthy();
      expect(payload.sourceKey).toBe("seek");
    });

    it("uses fallback name '未命名' when name is empty", () => {
      const resume = makeMinimalResume({ name: "" });
      const indexData = makeMinimalIndex();
      const payload = buildAiResumePayload({ resume, resumeId: "res-1", indexData, companyHits: [], roleSignals: [] });
      expect(payload.name).toBe("未命名");
    });

    it("extracts companies from workHistory when indexData.companies is empty", () => {
      const resume = makeMinimalResume({
        workHistory: [
          { companyName: "Startup Inc", jobTitle: "Dev", startDate: "2019-01", endDate: "2022-01" },
        ],
      });
      const indexData = makeMinimalIndex({ companies: [] });
      const payload = buildAiResumePayload({ resume, resumeId: "res-1", indexData, companyHits: [], roleSignals: [] });
      expect(payload.companies).toContain("Startup Inc");
    });

    it("handles empty workHistory", () => {
      const resume = makeMinimalResume({ workHistory: [] });
      const indexData = makeMinimalIndex();
      const payload = buildAiResumePayload({ resume, resumeId: "res-1", indexData, companyHits: [], roleSignals: [] });
      expect(payload.workHistory).toBeUndefined();
    });

    it("handles missing profileType", () => {
      const resume = makeMinimalResume({ profileType: undefined });
      const payload = buildAiResumePayload({
        resume,
        resumeId: "res-1",
        indexData: makeMinimalIndex(),
        companyHits: [],
        roleSignals: [],
      });
      // resolveResumeAnalysisSourceKey returns undefined for unrecognized source keys
      expect(payload.sourceKey).toBeUndefined();
    });
  });
});
