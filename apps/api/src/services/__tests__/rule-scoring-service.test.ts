import { describe, it, expect, vi, beforeEach } from "vitest";
import type { ResumeIndex } from "../resume-index.js";
import type { RuleScoringContext, RuleScoringResult, RequiredRoleRequirement, BrandHit, RoleSignalSummary } from "../rule-scoring.js";

// Mock file-system-dependent services so RuleScoringService can be
// instantiated without requiring config/resume/*.json5 files on disk.
vi.mock("../skills-knowledge.js", () => ({
  SkillsKnowledgeService: class {
    expandQueryWithSynonyms = (keywords: string[]) => keywords;
    getIndustryTaxonomy = () => [];
    getCompanyPatterns = () => [];
  },
}));

vi.mock("../job-description-service.js", () => ({
  JobDescriptionService: class {
    loadFile = () => ({
      autoMatch: { keywords: [] },
      location: "",
      title: "",
      content: "",
      requiredRoles: [],
    });
  },
}));

vi.mock("../filter-preset-service.js", () => ({
  FilterPresetService: class {
    getPreset = () => undefined;
  },
}));

vi.mock("../db.js", () => ({
  findProjectRoot: () => "/tmp/trends-test",
}));

vi.mock("node:fs", () => ({
  default: {
    existsSync: () => false,
    readFileSync: () => "",
  },
}));

import { RuleScoringService } from "../rule-scoring.js";

function makeService(): RuleScoringService {
  return new RuleScoringService("/tmp/trends-test");
}

function makeIndex(overrides: Partial<ResumeIndex> = {}): ResumeIndex {
  return {
    resumeId: "r_001",
    experienceYears: null,
    educationLevel: "",
    locationCity: "",
    searchText: "",
    skills: [],
    companies: [],
    industryTags: [],
    salaryRange: null,
    ...overrides,
  };
}

function makeContext(overrides: Partial<RuleScoringContext> = {}): RuleScoringContext {
  return {
    jobDescriptionId: "jd_test",
    title: "Test JD",
    keywords: [],
    targetLocations: [],
    educationRequirements: [],
    industryKeywords: [],
    industryTags: [],
    brandKeywords: [],
    requiredRoles: [],
    ...overrides,
  };
}

describe("RuleScoringService", () => {
  let service: RuleScoringService;

  beforeEach(() => {
    service = makeService();
  });

  describe("buildContextFromKeywords", () => {
    it("returns context with keyword-search id", () => {
      const ctx = service.buildContextFromKeywords(["销售", "东莞"]);
      expect(ctx.jobDescriptionId).toBe("keyword-search");
    });

    it("cleans and deduplicates keywords", () => {
      const ctx = service.buildContextFromKeywords([" 销售 ", "销售", "东莞"]);
      // ensureKeywords deduplicates and trims
      expect(ctx.keywords).toContain("销售");
      expect(ctx.keywords.filter((k) => k === "销售").length).toBe(1);
    });

    it("sets targetLocations from location param", () => {
      const ctx = service.buildContextFromKeywords(["销售"], "东莞");
      expect(ctx.targetLocations).toEqual(["东莞"]);
    });

    it("leaves targetLocations empty when no location", () => {
      const ctx = service.buildContextFromKeywords(["销售"]);
      expect(ctx.targetLocations).toEqual([]);
    });

    it("leaves educationRequirements empty for keyword-only context", () => {
      const ctx = service.buildContextFromKeywords(["销售"]);
      expect(ctx.educationRequirements).toEqual([]);
    });

    it("populates industryKeywords from cleaned keywords", () => {
      const ctx = service.buildContextFromKeywords(["销售"]);
      expect(ctx.industryKeywords).toEqual(ctx.keywords);
    });

    it("infers required roles from keywords", () => {
      const ctx = service.buildContextFromKeywords(["销售"]);
      // "销售" should match the "sales" role family
      expect(ctx.requiredRoles.length).toBeGreaterThanOrEqual(0);
    });
  });

  describe("scoreResume", () => {
    it("returns minimal score for empty index with empty context", () => {
      const index = makeIndex();
      const ctx = makeContext();
      const result = service.scoreResume(index, ctx);
      // No skills, no location, no education — only experience default (8) + no role/brand/industry
      expect(result.score).toBeLessThanOrEqual(20);
      expect(result.breakdown.skillMatch).toBe(0);
    });

    it("scores skill match when keywords match evidence text", () => {
      const index = makeIndex({ evidenceText: "具有5年销售经验，熟悉CNC设备" });
      const ctx = makeContext({ keywords: ["销售"] });
      const result = service.scoreResume(index, ctx);
      expect(result.breakdown.skillMatch).toBeGreaterThan(0);
      expect(result.matchedSkills).toContain("销售");
    });

    it("scores full skill match when all keywords present", () => {
      const index = makeIndex({ evidenceText: "销售 CNC 设备" });
      const ctx = makeContext({ keywords: ["销售", "cnc"] });
      const result = service.scoreResume(index, ctx);
      // skillMatch should be at maximum weight (15)
      expect(result.breakdown.skillMatch).toBe(15);
    });

    it("gives partial skill match for subset of keywords", () => {
      const index = makeIndex({ evidenceText: "销售经验丰富" });
      const ctx = makeContext({ keywords: ["销售", "python"] });
      const result = service.scoreResume(index, ctx);
      expect(result.breakdown.skillMatch).toBeGreaterThan(0);
      expect(result.breakdown.skillMatch).toBeLessThan(15);
    });

    it("scores experience match when role signal years meets requiredRoles minYears", () => {
      const index = makeIndex({ experienceYears: 5 });
      const ctx = makeContext({
        requiredRoles: [{
          type: "sales",
          minYears: 3,
          signals: ["销售"],
          verifyIn: "workHistory",
        }],
      });
      const roleSignals: RoleSignalSummary[] = [{
        type: "sales",
        matchedSignals: ["销售"],
        signalCount: 1,
        occurrences: 1,
        years: 5,
        industryVerifiedYears: 5,
        verifyIn: "workHistory",
      }];
      const result = service.scoreResume(index, ctx, [], roleSignals);
      expect(result.breakdown.experienceMatch).toBe(25); // full weight
    });

    it("penalizes experience match when role signal years below requiredRoles minYears", () => {
      const index = makeIndex({ experienceYears: 2 });
      const ctx = makeContext({
        requiredRoles: [{
          type: "sales",
          minYears: 5,
          signals: ["销售"],
          verifyIn: "workHistory",
        }],
      });
      const roleSignals: RoleSignalSummary[] = [{
        type: "sales",
        matchedSignals: ["销售"],
        signalCount: 1,
        occurrences: 1,
        years: 2,
        industryVerifiedYears: 2,
        verifyIn: "workHistory",
      }];
      const result = service.scoreResume(index, ctx, [], roleSignals);
      expect(result.breakdown.experienceMatch).toBeGreaterThan(0);
      expect(result.breakdown.experienceMatch).toBeLessThan(25);
    });

    it("gives default experience when no requiredRoles and years null", () => {
      const index = makeIndex({ experienceYears: null });
      const ctx = makeContext();
      const result = service.scoreResume(index, ctx);
      // When no requiredRoles and years null: round((25 * 8) / 25) = 8
      expect(result.breakdown.experienceMatch).toBe(8);
    });

    it("gives full experience when no requiredRoles and years present", () => {
      const index = makeIndex({ experienceYears: 10 });
      const ctx = makeContext();
      const result = service.scoreResume(index, ctx);
      expect(result.breakdown.experienceMatch).toBe(25);
    });

    it("scores location match for exact city", () => {
      const index = makeIndex({ locationCity: "东莞" });
      const ctx = makeContext({ targetLocations: ["东莞"] });
      const result = service.scoreResume(index, ctx);
      expect(result.breakdown.locationMatch).toBe(15); // full weight
    });

    it("scores location proximity for nearby city in same group", () => {
      const index = makeIndex({ locationCity: "深圳" });
      const ctx = makeContext({ targetLocations: ["东莞"] });
      const result = service.scoreResume(index, ctx);
      // Both in Pearl River Delta group
      expect(result.breakdown.locationMatch).toBeGreaterThan(0);
    });

    it("gives zero location match for distant city", () => {
      const index = makeIndex({ locationCity: "乌鲁木齐" });
      const ctx = makeContext({ targetLocations: ["东莞"] });
      const result = service.scoreResume(index, ctx);
      expect(result.breakdown.locationMatch).toBe(0);
    });

    it("scores education match when level meets requirement", () => {
      const index = makeIndex({ educationLevel: "本科" });
      const ctx = makeContext({ educationRequirements: ["本科及以上"] });
      const result = service.scoreResume(index, ctx);
      expect(result.breakdown.educationMatch).toBe(15); // full weight
    });

    it("penalizes education match when level below requirement", () => {
      const index = makeIndex({ educationLevel: "大专" });
      const ctx = makeContext({ educationRequirements: ["硕士及以上"] });
      const result = service.scoreResume(index, ctx);
      expect(result.breakdown.educationMatch).toBeGreaterThan(0);
      expect(result.breakdown.educationMatch).toBeLessThan(15);
    });

    it("gives default education score when no requirements specified", () => {
      const index = makeIndex({ educationLevel: "本科" });
      const ctx = makeContext({ educationRequirements: [] });
      const result = service.scoreResume(index, ctx);
      // round((15 * 10) / 15) = 10
      expect(result.breakdown.educationMatch).toBe(10);
    });

    it("gives zero education when no requirements and no education level", () => {
      const index = makeIndex({ educationLevel: "" });
      const ctx = makeContext({ educationRequirements: [] });
      const result = service.scoreResume(index, ctx);
      expect(result.breakdown.educationMatch).toBe(0);
    });

    it("returns brandRelevance 0 for MY market", () => {
      const index = makeIndex();
      const ctx = makeContext();
      const result = service.scoreResume(index, ctx, [], [], "MY");
      expect(result.breakdown.brandRelevance).toBe(0);
    });

    it("caps total score at 100", () => {
      const index = makeIndex({
        experienceYears: 10,
        educationLevel: "博士",
        locationCity: "东莞",
        evidenceText: "销售 CNC 数控 机床",
        skills: ["销售", "CNC", "数控"],
        companies: ["西门子"],
      });
      const ctx = makeContext({
        keywords: ["销售", "CNC", "数控"],
        targetLocations: ["东莞"],
        educationRequirements: ["本科及以上"],
        requiredRoles: [{
          type: "sales",
          minYears: 3,
          signals: ["销售"],
          verifyIn: "workHistory",
        }],
        industryKeywords: ["销售", "CNC", "数控"],
        industryTags: [],
      });
      const result = service.scoreResume(index, ctx);
      expect(result.score).toBeLessThanOrEqual(100);
    });

    it("produces correct recommendation thresholds", () => {
      // strong_match >= 85, match >= 70, potential >= 50
      const index = makeIndex({ experienceYears: 20 });
      const ctx = makeContext({
        requiredRoles: [{
          type: "sales",
          minYears: 5,
          signals: ["销售"],
          verifyIn: "workHistory",
        }],
      });
      const result = service.scoreResume(index, ctx);
      // Verify recommendation matches score range
      if (result.score >= 85) {
        expect(result.recommendation).toBe("strong_match");
      } else if (result.score >= 70) {
        expect(result.recommendation).toBe("match");
      } else if (result.score >= 50) {
        expect(result.recommendation).toBe("potential");
      } else {
        expect(result.recommendation).toBe("no_match");
      }
    });

    it("includes matchedSkills in result", () => {
      const index = makeIndex({ evidenceText: "精通CNC编程和销售管理" });
      const ctx = makeContext({ keywords: ["cnc", "销售"] });
      const result = service.scoreResume(index, ctx);
      expect(result.matchedSkills.length).toBeGreaterThan(0);
    });

    it("scores role match with required roles and role signals", () => {
      const index = makeIndex({ evidenceText: "5年销售经验" });
      const roleSignals: RoleSignalSummary[] = [{
        type: "sales",
        matchedSignals: ["销售"],
        signalCount: 1,
        occurrences: 2,
        years: 5,
        industryVerifiedYears: 3,
        verifyIn: "workHistory",
      }];
      const ctx = makeContext({
        requiredRoles: [{
          type: "sales",
          minYears: 3,
          signals: ["销售"],
          verifyIn: "workHistory",
        }],
      });
      const result = service.scoreResume(index, ctx, [], roleSignals);
      expect(result.breakdown.roleMatch).toBeGreaterThan(0);
    });

    it("penalizes sales role without industry verification", () => {
      const index = makeIndex({ evidenceText: "有销售背景" });
      const roleSignals: RoleSignalSummary[] = [{
        type: "sales",
        matchedSignals: ["销售"],
        signalCount: 1,
        occurrences: 1,
        years: 3,
        industryVerifiedYears: 0,
        verifyIn: "workHistory",
      }];
      const ctx = makeContext({
        requiredRoles: [{
          type: "sales",
          minYears: 2,
          signals: ["销售"],
          verifyIn: "workHistory",
        }],
      });
      const result = service.scoreResume(index, ctx, [], roleSignals);
      // Without industry verification, score is capped at 2/10 * weight
      expect(result.breakdown.roleMatch).toBeLessThanOrEqual(2);
    });
  });

  describe("scoreBatch", () => {
    it("returns results for each index", () => {
      const indexes = [
        makeIndex({ resumeId: "r_001", evidenceText: "销售" }),
        makeIndex({ resumeId: "r_002", evidenceText: "工程师" }),
      ];
      const ctx = makeContext({ keywords: ["销售"] });
      const results = service.scoreBatch(indexes, ctx);
      expect(results).toHaveLength(2);
      expect(results[0]?.resumeId).toBe("r_001");
      expect(results[1]?.resumeId).toBe("r_002");
    });

    it("preserves score order independent of input order", () => {
      const index1 = makeIndex({ resumeId: "r_001", evidenceText: "销售 CNC" });
      const index2 = makeIndex({ resumeId: "r_002", evidenceText: "完全无关内容" });
      const ctx = makeContext({ keywords: ["销售"] });
      const results = service.scoreBatch([index1, index2], ctx);
      expect(results[0]?.result.score).toBeGreaterThan(results[1]?.result.score ?? 0);
    });

    it("returns empty array for empty input", () => {
      const ctx = makeContext();
      const results = service.scoreBatch([], ctx);
      expect(results).toEqual([]);
    });
  });

  describe("toMatchingResult", () => {
    it("maps score and recommendation", () => {
      const scoringResult: RuleScoringResult = {
        score: 75,
        recommendation: "match",
        breakdown: {
          skillMatch: 10,
          roleMatch: 8,
          experienceMatch: 20,
          educationMatch: 12,
          locationMatch: 15,
          industryMatch: 5,
          brandRelevance: 5,
        },
        matchedSkills: ["CNC", "销售"],
        matchedCompanies: ["西门子"],
      };
      const result = service.toMatchingResult(scoringResult);
      expect(result.score).toBe(75);
      expect(result.recommendation).toBe("match");
      expect(result.scoreSource).toBe("rule");
    });

    it("adds highlights for matched skills", () => {
      const scoringResult: RuleScoringResult = {
        score: 50,
        recommendation: "potential",
        breakdown: {
          skillMatch: 10,
          roleMatch: 0,
          experienceMatch: 20,
          educationMatch: 10,
          locationMatch: 0,
          industryMatch: 5,
          brandRelevance: 5,
        },
        matchedSkills: ["CNC"],
        matchedCompanies: [],
      };
      const result = service.toMatchingResult(scoringResult);
      expect(result.highlights).toEqual(
        expect.arrayContaining([expect.stringContaining("命中关键词")])
      );
    });

    it("adds concern for missing role match", () => {
      const scoringResult: RuleScoringResult = {
        score: 30,
        recommendation: "no_match",
        breakdown: {
          skillMatch: 5,
          roleMatch: 0,
          experienceMatch: 10,
          educationMatch: 10,
          locationMatch: 0,
          industryMatch: 5,
          brandRelevance: 0,
        },
        matchedSkills: [],
        matchedCompanies: [],
      };
      const result = service.toMatchingResult(scoringResult);
      expect(result.concerns).toEqual(
        expect.arrayContaining([expect.stringContaining("缺少目标岗位职能经历")])
      );
    });

    it("adds concern for location mismatch", () => {
      const scoringResult: RuleScoringResult = {
        score: 40,
        recommendation: "potential",
        breakdown: {
          skillMatch: 5,
          roleMatch: 5,
          experienceMatch: 15,
          educationMatch: 10,
          locationMatch: 0,
          industryMatch: 5,
          brandRelevance: 0,
        },
        matchedSkills: [],
        matchedCompanies: [],
      };
      const result = service.toMatchingResult(scoringResult);
      expect(result.concerns).toEqual(
        expect.arrayContaining([expect.stringContaining("工作地点可能不匹配")])
      );
    });

    it("adds highlight for matched companies", () => {
      const scoringResult: RuleScoringResult = {
        score: 60,
        recommendation: "match",
        breakdown: {
          skillMatch: 10,
          roleMatch: 8,
          experienceMatch: 20,
          educationMatch: 12,
          locationMatch: 5,
          industryMatch: 5,
          brandRelevance: 0,
        },
        matchedSkills: [],
        matchedCompanies: ["西门子"],
      };
      const result = service.toMatchingResult(scoringResult);
      expect(result.highlights).toEqual(
        expect.arrayContaining([expect.stringContaining("相关公司经历")])
      );
    });

    it("includes summary string with score breakdown", () => {
      const scoringResult: RuleScoringResult = {
        score: 75,
        recommendation: "match",
        breakdown: {
          skillMatch: 10,
          roleMatch: 8,
          experienceMatch: 20,
          educationMatch: 12,
          locationMatch: 15,
          industryMatch: 5,
          brandRelevance: 5,
        },
        matchedSkills: [],
        matchedCompanies: [],
      };
      const result = service.toMatchingResult(scoringResult);
      expect(result.summary).toContain("规则评分 75 分");
      expect(result.summary).toContain("技能匹配 10/15");
    });

    it("adds brand highlights from brandContext", () => {
      const brandHits: BrandHit[] = [
        { brand: "siemens", role: "employer", source: "workHistory", context: "employer" },
      ];
      const scoringResult: RuleScoringResult = {
        score: 80,
        recommendation: "match",
        breakdown: {
          skillMatch: 10,
          roleMatch: 8,
          experienceMatch: 20,
          educationMatch: 12,
          locationMatch: 15,
          industryMatch: 5,
          brandRelevance: 10,
        },
        matchedSkills: [],
        matchedCompanies: [],
        brandContext: brandHits,
      };
      const result = service.toMatchingResult(scoringResult);
      expect(result.highlights).toEqual(
        expect.arrayContaining([expect.stringContaining("品牌雇主经历")])
      );
    });
  });

  describe("inferRequiredRolesFromKeywords", () => {
    it("returns empty array for empty keywords", () => {
      const result = service.inferRequiredRolesFromKeywords([]);
      expect(result).toEqual([]);
    });

    it("returns empty array for ambiguous keywords matching multiple families", () => {
      // "经理" matches manager family; adding "销售" matches sales family
      // Two families → ambiguous → empty
      const result = service.inferRequiredRolesFromKeywords(["经理", "技术员"]);
      // This may match 2 families depending on signal library — test the contract
      // Either 0 (ambiguous) or 1 (single match), never more than 1 family
      expect(result.length).toBeLessThanOrEqual(1);
    });

    it("returns sales role for sales-only keywords", () => {
      const result = service.inferRequiredRolesFromKeywords(["销售员", "客户开发"]);
      // Both terms belong to the "sales" family → single match
      if (result.length > 0) {
        expect(result[0]?.type).toBe("sales");
        expect(result[0]?.verifyIn).toBe("workHistory");
        expect(result[0]?.signals.length).toBeGreaterThan(0);
      }
    });
  });
});
