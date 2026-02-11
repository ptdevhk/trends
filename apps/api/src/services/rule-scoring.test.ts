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
---
# 职位要求\n- 2年以上车床销售经验\n`,
    "utf8"
  );

  return root;
}

function cleanupFixtureRoot(root: string): void {
  fs.rmSync(root, { recursive: true, force: true });
}

describe("RuleScoringService", () => {
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
      expect(strongScore.breakdown.locationMatch).toBe(15);
    } finally {
      cleanupFixtureRoot(root);
    }
  });
});
