import { describe, expect, it } from "vitest";

import { findProjectRoot } from "./db";
import { JobDescriptionService } from "./job-description-service";
import { ResumeIndexService } from "./resume-index";
import { RuleScoringService } from "./rule-scoring";
import { resolveResumeId } from "./resume-utils";

import type { ResumeItem, ResumeSampleFile } from "../types/resume";

describe("RuleScoringService", () => {
  it("scores lathe-sales candidates sensibly", () => {
    const root = findProjectRoot();
    const jobService = new JobDescriptionService(root);
    const jd = jobService.loadFile("lathe-sales");

    const sample: ResumeSampleFile = {
      name: "fixture",
      filename: "fixture.json",
      updatedAt: "2026-02-03T10:00:00.000Z",
      size: 1,
    };

    const items: ResumeItem[] = [
      {
        name: "候选人A",
        profileUrl: "",
        activityStatus: "",
        age: "30",
        experience: "5年",
        education: "本科",
        location: "东莞",
        selfIntro: "有STAR车床销售经验，熟悉CNC设备。",
        jobIntention: "车床 销售 STAR CNC",
        expectedSalary: "12000-20000/月",
        workHistory: [
          { raw: "2019-01 ~ 2024-01 STAR机床 - 销售工程师" },
        ],
        extractedAt: "2026-02-03T10:00:00.000Z",
      },
      {
        name: "候选人B",
        profileUrl: "",
        activityStatus: "",
        age: "24",
        experience: "1年",
        education: "本科",
        location: "北京",
        selfIntro: "React前端开发，缺少销售经验。",
        jobIntention: "前端 开发 React",
        expectedSalary: "15000-20000/月",
        workHistory: [
          { raw: "2024-01 ~ 至今 某互联网公司 - 前端工程师" },
        ],
        extractedAt: "2026-02-03T11:00:00.000Z",
      },
    ];

    const indexService = new ResumeIndexService(root);
    indexService.indexSample({ items, sample });

    const scorer = new RuleScoringService(root);
    const idA = resolveResumeId(items[0], 0);
    const idB = resolveResumeId(items[1], 1);
    const indexA = indexService.get(idA);
    const indexB = indexService.get(idB);

    expect(indexA).toBeDefined();
    expect(indexB).toBeDefined();

    if (!indexA || !indexB) {
      throw new Error("Failed to build resume indexes for fixtures");
    }

    const scoreA = scorer.scoreResume(indexA, jd);
    const scoreB = scorer.scoreResume(indexB, jd);

    expect(scoreA.score).toBeGreaterThanOrEqual(70);
    expect(scoreA.recommendation).toMatch(/strong_match|match/);

    expect(scoreB.score).toBeLessThan(50);
    expect(scoreB.recommendation).toBe("no_match");
  });
});
