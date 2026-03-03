import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { RuleScoringService } from "./rule-scoring";

import type { ResumeIndex } from "./resume-index";

function createFixtureRoot(): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "rule-scoring-"));
  fs.mkdirSync(path.join(root, "config", "resume"), { recursive: true });
  fs.mkdirSync(path.join(root, "config", "job-descriptions"), { recursive: true });

  fs.writeFileSync(
    path.join(root, "config", "resume", "filter-presets.json5"),
    JSON.stringify({ presets: [], categories: [] }, null, 2),
    "utf8"
  );

  fs.writeFileSync(
    path.join(root, "config", "job-descriptions", "lathe-sales.md"),
    `---
id: jd-lathe-sales
title: 车床销售工程师
status: active
auto_match:
  keywords: [车床, CNC, 销售]
  locations: [东莞, 广州]
  priority: 90
  suggested_filters:
    minExperience: 2
    education: [大专, 本科]
required_roles:
  - type: sales
    min_years: 1
    signals: [销售, 销售经理, 销售工程师, 客户, 渠道, 业务开发]
    verify_in: workHistory
---
# 职位要求\n- 2年以上车床销售经验\n`,
    "utf8"
  );

  fs.writeFileSync(
    path.join(root, "config", "resume", "skills.md"),
    `---
version: 1
updated_at: '2026-02-24'
---

# Skills Knowledge

## Domain Taxonomy

### cnc
- displayName: CNC
- keywords: cnc, 数控, fanuc

## Synonym Table

- 数控: CNC

## Company Patterns

- FANUC [role: both] (aliases: 发那科, Fanuc)
- STAR [role: both] (aliases: 津上, Star Micronics)
`,
    "utf8"
  );

  return root;
}

function cleanupFixtureRoot(root: string): void {
  fs.rmSync(root, { recursive: true, force: true });
}

describe("RuleScoringService", () => {
  it("builds keyword-only context with inferred industry tags", () => {
    const root = createFixtureRoot();

    try {
      const service = new RuleScoringService(root);
      const context = service.buildContextFromKeywords(["cnc", "车床"], "广东");

      expect(context.jobDescriptionId).toBe("keyword-search");
      expect(context.title).toBe("cnc, 车床");
      expect(context.keywords).toEqual(["cnc", "车床"]);
      expect(context.targetLocations).toEqual(["广东"]);
      expect(context.industryTags).toEqual(["cnc"]);
    } finally {
      cleanupFixtureRoot(root);
    }
  });

  it("scores strong candidate higher than weak candidate", () => {
    const root = createFixtureRoot();

    try {
      const service = new RuleScoringService(root);
      const context = service.buildContext("lathe-sales");

      const strongCandidate: ResumeIndex = {
        resumeId: "R-strong",
        experienceYears: 5,
        educationLevel: "bachelor",
        locationCity: "东莞",
        workHistoryText: "2021-2025 东莞精密机械 销售经理 客户开发 渠道拓展",
        skills: ["车床", "cnc", "销售"],
        companies: ["东莞富佳机械设备有限公司"],
        industryTags: ["machinery", "cnc", "sales"],
        salaryRange: { min: 10000, max: 20000 },
        searchText: "东莞 车床 cnc 销售 机械设备 大客户",
      };

      const weakCandidate: ResumeIndex = {
        resumeId: "R-weak",
        experienceYears: 0,
        educationLevel: "high_school",
        locationCity: "北京",
        skills: ["文员"],
        companies: ["零售公司"],
        industryTags: ["sales"],
        salaryRange: { min: 4000, max: 6000 },
        searchText: "北京 文员 客服",
      };

      const strongScore = service.scoreResume(strongCandidate, context);
      const weakScore = service.scoreResume(weakCandidate, context);

      expect(strongScore.score).toBeGreaterThan(weakScore.score);
      expect(strongScore.recommendation === "match" || strongScore.recommendation === "strong_match").toBe(true);
      expect(weakScore.recommendation === "potential" || weakScore.recommendation === "no_match").toBe(true);
      expect(strongScore.breakdown.skillMatch).toBeGreaterThan(0);
      expect(strongScore.breakdown.roleMatch).toBe(8);
      expect(strongScore.breakdown.locationMatch).toBe(15);
      expect(strongScore.breakdown.brandRelevance).toBe(0);
    } finally {
      cleanupFixtureRoot(root);
    }
  });

  it("matches location with exact or long-enough substrings only", () => {
    const root = createFixtureRoot();

    try {
      const service = new RuleScoringService(root);
      const baseIndex: Omit<ResumeIndex, "locationCity" | "resumeId"> = {
        experienceYears: 3,
        educationLevel: "bachelor",
        skills: ["cnc"],
        companies: [],
        industryTags: ["cnc"],
        salaryRange: { min: 8000, max: 15000 },
        searchText: "cnc 销售 北京 东莞",
      };

      const beijingContext = service.buildContextFromKeywords(["cnc"], "北京");
      const beijingScore = service.scoreResume(
        {
          ...baseIndex,
          resumeId: "R-beijing",
          locationCity: "北京市",
        },
        beijingContext
      );
      expect(beijingScore.breakdown.locationMatch).toBe(15);

      const shortContext = service.buildContextFromKeywords(["cnc"], "京");
      const shortScore = service.scoreResume(
        {
          ...baseIndex,
          resumeId: "R-short",
          locationCity: "北京",
        },
        shortContext
      );
      expect(shortScore.breakdown.locationMatch).toBe(0);

      const dongguanContext = service.buildContextFromKeywords(["cnc"], "东莞");
      const dongguanScore = service.scoreResume(
        {
          ...baseIndex,
          resumeId: "R-dongguan",
          locationCity: "东莞市",
        },
        dongguanContext
      );
      expect(dongguanScore.breakdown.locationMatch).toBe(15);
    } finally {
      cleanupFixtureRoot(root);
    }
  });

  it("applies proximity location scoring for nearby cities", () => {
    const root = createFixtureRoot();

    try {
      const service = new RuleScoringService(root);
      const context = service.buildContextFromKeywords(["cnc"], "东莞");

      const baseIndex: Omit<ResumeIndex, "locationCity" | "resumeId"> = {
        experienceYears: 3,
        educationLevel: "bachelor",
        skills: ["cnc"],
        companies: [],
        industryTags: ["cnc"],
        salaryRange: { min: 8000, max: 15000 },
        searchText: "cnc 销售",
      };

      const exactResult = service.scoreResume(
        {
          ...baseIndex,
          resumeId: "R-exact",
          locationCity: "东莞",
        },
        context
      );
      expect(exactResult.breakdown.locationMatch).toBe(15);

      const nearbyResult = service.scoreResume(
        {
          ...baseIndex,
          resumeId: "R-nearby",
          locationCity: "深圳",
        },
        context
      );
      expect(nearbyResult.breakdown.locationMatch).toBe(8);

      const farResult = service.scoreResume(
        {
          ...baseIndex,
          resumeId: "R-far",
          locationCity: "北京",
        },
        context
      );
      expect(farResult.breakdown.locationMatch).toBe(0);
    } finally {
      cleanupFixtureRoot(root);
    }
  });

  it("uses softer experience gap penalty", () => {
    const root = createFixtureRoot();

    try {
      const service = new RuleScoringService(root);
      const context = {
        ...service.buildContextFromKeywords(["cnc"], "东莞"),
        minExperience: 5,
      };

      const baseIndex: Omit<ResumeIndex, "experienceYears" | "resumeId"> = {
        educationLevel: "bachelor",
        locationCity: "东莞",
        skills: ["cnc"],
        companies: [],
        industryTags: ["cnc"],
        salaryRange: { min: 8000, max: 15000 },
        searchText: "cnc 销售",
      };

      const oneYearShort = service.scoreResume(
        {
          ...baseIndex,
          resumeId: "R-gap-1",
          experienceYears: 4,
        },
        context
      );
      expect(oneYearShort.breakdown.experienceMatch).toBe(20);

      const twoYearsShort = service.scoreResume(
        {
          ...baseIndex,
          resumeId: "R-gap-2",
          experienceYears: 3,
        },
        context
      );
      expect(twoYearsShort.breakdown.experienceMatch).toBe(15);
    } finally {
      cleanupFixtureRoot(root);
    }
  });

  it("matches skills and industry keywords through synonyms", () => {
    const root = createFixtureRoot();

    try {
      const service = new RuleScoringService(root);
      const context = service.buildContextFromKeywords(["数控"]);

      const index: ResumeIndex = {
        resumeId: "R-synonym",
        experienceYears: 3,
        educationLevel: "bachelor",
        locationCity: "东莞",
        skills: ["cnc"],
        companies: [],
        industryTags: ["cnc"],
        salaryRange: { min: 8000, max: 15000 },
        searchText: "cnc 车床 销售",
      };

      const result = service.scoreResume(index, context);

      expect(result.matchedSkills).toContain("数控");
      expect(result.breakdown.skillMatch).toBe(15);
      expect(result.breakdown.industryMatch).toBeGreaterThan(0);
    } finally {
      cleanupFixtureRoot(root);
    }
  });

  it("applies higher brand relevance when JD includes brand keyword", () => {
    const root = createFixtureRoot();

    try {
      const service = new RuleScoringService(root);
      const context = service.buildContextFromKeywords(["发那科", "销售"], "东莞");

      const index: ResumeIndex = {
        resumeId: "R-brand",
        experienceYears: 5,
        educationLevel: "bachelor",
        locationCity: "东莞",
        skills: ["销售", "cnc"],
        companies: ["上海发那科机器人有限公司"],
        industryTags: ["cnc", "sales"],
        salaryRange: { min: 10000, max: 18000 },
        searchText: "东莞 发那科 销售 cnc",
      };

      const equipmentResult = service.scoreResume(index, context, [
        { brand: "fanuc", role: "both", source: "selfIntro", context: "equipment" },
      ]);
      const employerResult = service.scoreResume(index, context, [
        { brand: "fanuc", role: "both", source: "workHistory", context: "employer" },
      ]);

      expect(equipmentResult.breakdown.brandRelevance).toBe(7);
      expect(employerResult.breakdown.brandRelevance).toBe(10);
      expect(employerResult.score).toBeGreaterThan(equipmentResult.score);
    } finally {
      cleanupFixtureRoot(root);
    }
  });

  it("uses low brand weights when JD has no brand keyword", () => {
    const root = createFixtureRoot();

    try {
      const service = new RuleScoringService(root);
      const context = service.buildContextFromKeywords(["cnc", "销售"], "东莞");

      const index: ResumeIndex = {
        resumeId: "R-brand-low",
        experienceYears: 4,
        educationLevel: "bachelor",
        locationCity: "东莞",
        skills: ["销售", "cnc"],
        companies: [],
        industryTags: ["cnc"],
        salaryRange: { min: 9000, max: 16000 },
        searchText: "东莞 cnc 销售",
      };

      const result = service.scoreResume(index, context, [
        { brand: "fanuc", role: "both", source: "workHistory", context: "employer" },
      ]);
      expect(result.breakdown.brandRelevance).toBe(4);
    } finally {
      cleanupFixtureRoot(root);
    }
  });

  it("applies lower score for equipment-only brand role", () => {
    const root = createFixtureRoot();

    try {
      const service = new RuleScoringService(root);
      const context = service.buildContextFromKeywords(["fanuc"], "东莞");

      const index: ResumeIndex = {
        resumeId: "R-brand-role-equipment",
        experienceYears: 5,
        educationLevel: "bachelor",
        locationCity: "东莞",
        skills: ["销售", "cnc"],
        companies: ["上海发那科机器人有限公司"],
        industryTags: ["cnc", "sales"],
        salaryRange: { min: 10000, max: 18000 },
        searchText: "东莞 发那科 销售 cnc",
      };

      const equipmentRoleResult = service.scoreResume(index, context, [
        { brand: "fanuc", role: "equipment", source: "workHistory", context: "employer" },
      ]);
      const employerRoleResult = service.scoreResume(index, context, [
        { brand: "fanuc", role: "employer", source: "workHistory", context: "employer" },
      ]);

      expect(equipmentRoleResult.breakdown.brandRelevance).toBe(7);
      expect(employerRoleResult.breakdown.brandRelevance).toBe(10);
      expect(employerRoleResult.score).toBeGreaterThan(equipmentRoleResult.score);
    } finally {
      cleanupFixtureRoot(root);
    }
  });

  it("keeps full score for both-role brand hits", () => {
    const root = createFixtureRoot();

    try {
      const service = new RuleScoringService(root);
      const context = service.buildContextFromKeywords(["fanuc"], "东莞");

      const index: ResumeIndex = {
        resumeId: "R-brand-role-both",
        experienceYears: 5,
        educationLevel: "bachelor",
        locationCity: "东莞",
        skills: ["销售", "cnc"],
        companies: ["上海发那科机器人有限公司"],
        industryTags: ["cnc", "sales"],
        salaryRange: { min: 10000, max: 18000 },
        searchText: "东莞 发那科 销售 cnc",
      };

      const bothRoleResult = service.scoreResume(index, context, [
        { brand: "fanuc", role: "both", source: "workHistory", context: "employer" },
      ]);

      expect(bothRoleResult.breakdown.brandRelevance).toBe(10);
    } finally {
      cleanupFixtureRoot(root);
    }
  });

  it("penalizes resumes without required sales role signals", () => {
    const root = createFixtureRoot();

    try {
      const service = new RuleScoringService(root);
      const context = service.buildContext("lathe-sales");

      const operatorCandidate: ResumeIndex = {
        resumeId: "R-operator",
        experienceYears: 6,
        educationLevel: "associate",
        locationCity: "东莞",
        workHistoryText: "2019-2025 CNC操作员 负责车床编程与设备维护",
        skills: ["cnc", "车床", "销售"],
        companies: ["东莞某机床厂"],
        industryTags: ["machinery", "cnc"],
        salaryRange: { min: 9000, max: 12000 },
        searchText: "东莞 cnc 车床 操作 维护",
      };

      const salesCandidate: ResumeIndex = {
        resumeId: "R-sales",
        experienceYears: 5,
        educationLevel: "bachelor",
        locationCity: "东莞",
        workHistoryText: "2020-2025 机床销售工程师 负责客户开发 渠道拓展",
        skills: ["cnc", "车床", "销售"],
        companies: ["东莞设备公司"],
        industryTags: ["machinery", "cnc", "sales"],
        salaryRange: { min: 12000, max: 18000 },
        searchText: "东莞 车床 销售 客户 渠道",
      };

      const operatorResult = service.scoreResume(operatorCandidate, context);
      const salesResult = service.scoreResume(salesCandidate, context);

      expect(operatorResult.breakdown.roleMatch).toBe(2);
      expect(salesResult.breakdown.roleMatch).toBe(8);
      expect(salesResult.score).toBeGreaterThan(operatorResult.score);
    } finally {
      cleanupFixtureRoot(root);
    }
  });

  it("supports role-context rollback via enabled=false", () => {
    const root = createFixtureRoot();
    fs.writeFileSync(
      path.join(root, "config", "resume", "rule-weights.json5"),
      `{
  roleContext: {
    enabled: false,
    capRatio: 0.8,
    softGateFloorRatio: 0.2,
  },
}
`,
      "utf8"
    );

    try {
      const service = new RuleScoringService(root);
      const context = service.buildContext("lathe-sales");

      const operatorCandidate: ResumeIndex = {
        resumeId: "R-rollback-operator",
        experienceYears: 6,
        educationLevel: "associate",
        locationCity: "东莞",
        workHistoryText: "2019-2025 CNC操作员 负责车床编程与设备维护",
        skills: ["cnc", "车床", "销售"],
        companies: ["东莞某机床厂"],
        industryTags: ["machinery", "cnc"],
        salaryRange: { min: 9000, max: 12000 },
        searchText: "东莞 cnc 车床 操作 维护",
      };

      const salesCandidate: ResumeIndex = {
        resumeId: "R-rollback-sales",
        experienceYears: 5,
        educationLevel: "bachelor",
        locationCity: "东莞",
        workHistoryText: "2020-2025 机床销售工程师 负责客户开发 渠道拓展",
        skills: ["cnc", "车床", "销售"],
        companies: ["东莞设备公司"],
        industryTags: ["machinery", "cnc", "sales"],
        salaryRange: { min: 12000, max: 18000 },
        searchText: "东莞 车床 销售 客户 渠道",
      };

      const operatorResult = service.scoreResume(operatorCandidate, context);
      const salesResult = service.scoreResume(salesCandidate, context);

      expect(operatorResult.breakdown.roleMatch).toBe(0);
      expect(salesResult.breakdown.roleMatch).toBe(10);
    } finally {
      cleanupFixtureRoot(root);
    }
  });
});
