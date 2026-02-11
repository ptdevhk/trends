import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { ResumeIndexService } from "./resume-index";

import type { ResumeItem } from "../types/resume";

function createFixtureRoot(): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "resume-index-"));
  fs.mkdirSync(path.join(root, "config", "resume"), { recursive: true });
  fs.mkdirSync(path.join(root, "config", "job-descriptions"), { recursive: true });

  fs.writeFileSync(
    path.join(root, "config", "resume", "skills_words.txt"),
    "CNC lathe sales 机床 车床\n"
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
---
# 职位要求\n- 2年以上经验\n`,
    "utf8"
  );

  return root;
}

function cleanupFixtureRoot(root: string): void {
  fs.rmSync(root, { recursive: true, force: true });
}

describe("ResumeIndexService", () => {
  it("builds structured index fields from resume data", () => {
    const root = createFixtureRoot();

    try {
      const service = new ResumeIndexService(root);

      const resumes: ResumeItem[] = [
        {
          name: "张三",
          profileUrl: "javascript:;",
          activityStatus: "活跃",
          age: "31",
          experience: "5年",
          education: "本科",
          location: "东莞长安镇",
          selfIntro: "熟悉CNC车床和设备销售",
          jobIntention: "东莞 车床 销售 CNC",
          expectedSalary: "12000-18000元/月",
          workHistory: [
            { raw: "2022-01~2025-01 东莞富佳机械设备有限公司 销售经理" },
          ],
          extractedAt: "2026-02-11T00:00:00.000Z",
          resumeId: "R1001",
          perUserId: "U1001",
        },
      ];

      const index = service.buildIndex("sample:test", resumes);
      const entry = index.get("R1001");

      expect(entry).toBeDefined();
      expect(entry?.experienceYears).toBe(5);
      expect(entry?.educationLevel).toBe("bachelor");
      expect(entry?.locationCity).toBe("东莞");
      expect(entry?.skills.some((skill) => skill.includes("cnc") || skill.includes("车床"))).toBe(true);
      expect(entry?.companies.some((company) => company.includes("机械设备"))).toBe(true);
      expect(entry?.industryTags).toContain("machinery");
      expect(entry?.industryTags).toContain("sales");
      expect(entry?.salaryRange?.min).toBe(12000);
      expect(entry?.salaryRange?.max).toBe(18000);
    } finally {
      cleanupFixtureRoot(root);
    }
  });
});
