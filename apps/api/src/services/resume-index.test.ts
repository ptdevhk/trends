import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { buildLatestWorkHistoryEvidence } from "@trends/shared";

import { ResumeIndexService } from "./resume-index";

import type { ResumeItem } from "../types/resume";

const TEST_SKILLS_MD = `---
version: 1
updated_at: '2026-03-27'
description: Test skills knowledge file
---

# Skills Knowledge

## Domain Taxonomy

### machinery
- displayName: Machinery
- keywords: 机床, 车床, cnc, 数控, machine tools, machining center, precision machinery

### sales
- displayName: Sales
- keywords: 销售, sales, sales engineer, business development manager, account manager

### metrology
- displayName: Metrology
- keywords: 测量, metrology, coordinate measuring machine, quality inspection

## Synonym Table

- 机床: machine tools, cnc machines
- 销售工程师: sales engineer, technical sales engineer
- 业务拓展: business development, business development manager
- 大客户: key account, key account manager, account manager
- 测量: metrology, quality inspection
- CMM: coordinate measuring machine

## Experience Signals

### mid
- displayName: Mid
- keywords: specialist

## Company Patterns

- FANUC [role: both] (aliases: 发那科, Fanuc)

## Industry Context

### Test
Machine tools and metrology

## Exclusion Patterns

- exclude: ad, promo

## Learning Log

- 2026-03-27: test fixture
`;

function createFixtureRoot(): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "resume-index-"));
  fs.mkdirSync(path.join(root, "config", "resume"), { recursive: true });
  fs.mkdirSync(path.join(root, "config", "job-descriptions"), { recursive: true });

  fs.writeFileSync(
    path.join(root, "config", "resume", "skills.md"),
    TEST_SKILLS_MD,
    "utf8"
  );

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
location: 东莞
auto_match:
  keywords: [车床, CNC, 销售]
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
            {
              raw: "2022-01~2025-01 东莞富佳机械设备有限公司 销售经理",
              companyName: "东莞富佳机械设备有限公司",
              jobTitle: "销售经理",
              description: "负责 CNC 车床客户拓展",
              startDate: "2022-01",
              endDate: "2025-01",
            },
          ],
          profileEducation: [
            {
              institution: "华南理工大学",
              qualification: "机械工程本科",
            },
          ],
          skills: ["CNC", { name: "Key account management", yearsOfExperience: 3 }],
          languages: ["中文", { name: "English", proficiency: "professional" }],
          licences: [{ name: "C1" }],
          resumeSnippet: { text: "有机床设备销售经验" },
          currentIndustry: { name: "工业机械" },
          currentSubindustry: "数控机床",
          rightToWork: { status: "citizen" },
          digitalIdentity: { linkedinUrl: "https://www.linkedin.com/in/example" },
          noticePeriodDays: 30,
          extractedAt: "2026-02-11T00:00:00.000Z",
          resumeId: "R1001",
          perUserId: "U1001",
        },
      ];

      const index = service.buildIndex("sample:test", resumes);
      const entry = index.get("R1001");

      expect(entry).toBeDefined();
      expect(entry?.experienceYears).toBeCloseTo(3, 5);
      expect(entry?.educationLevel).toBe("bachelor");
      expect(entry?.locationCity).toBe("东莞");
      expect(entry?.skills.some((skill) => skill.includes("销售") || skill.includes("车床"))).toBe(true);
      expect(entry?.companies.some((company) => company.includes("机械设备"))).toBe(true);
      expect(entry?.industryTags).toEqual(["machinery", "sales"]);
      expect(entry?.evidenceText).toBe(buildLatestWorkHistoryEvidence(resumes[0]?.workHistory).text);
      expect(entry?.searchText).not.toContain("熟悉cnc车床和设备销售");
      expect(entry?.searchText).not.toContain("东莞 车床 销售 cnc");
      expect(resumes[0]?.profileEducation?.[0]?.institution).toBe("华南理工大学");
      expect(resumes[0]?.currentIndustry).toEqual({ name: "工业机械" });
      expect(resumes[0]?.noticePeriodDays).toBe(30);
      expect(entry?.salaryRange?.min).toBe(12000);
      expect(entry?.salaryRange?.max).toBe(18000);
    } finally {
      cleanupFixtureRoot(root);
    }
  });

  it("uses structured location hierarchy when raw location is missing", () => {
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
          location: "",
          locationHierarchy: {
            country: "中国",
            province: "广东",
            city: "东莞",
            district: "长安",
          },
          selfIntro: "",
          jobIntention: "",
          expectedSalary: "12000-18000元/月",
          workHistory: [],
          extractedAt: "2026-02-11T00:00:00.000Z",
          resumeId: "R2002",
          perUserId: "U2002",
        },
      ];

      const index = service.buildIndex("sample:hierarchy", resumes);
      const entry = index.get("R2002");

      expect(entry?.locationCity).toBe("东莞");
      expect(entry?.searchText).toContain("中国");
      expect(entry?.searchText).toContain("广东");
      expect(entry?.searchText).toContain("东莞");
      expect(entry?.searchText).toContain("长安");
    } finally {
      cleanupFixtureRoot(root);
    }
  });

  it("extracts seeded English location cities before CJK fallback", () => {
    const root = createFixtureRoot();

    try {
      const service = new ResumeIndexService(root);
      const resumes: ResumeItem[] = [
        {
          name: "Alex Tan",
          profileUrl: "https://my.employer.seek.com/candidates/1",
          activityStatus: "Active",
          age: "29",
          experience: "6 years",
          education: "Bachelor",
          location: "Kuala Lumpur, Malaysia",
          selfIntro: "",
          jobIntention: "",
          expectedSalary: "",
          workHistory: [],
          extractedAt: "2026-03-16T00:00:00.000Z",
          resumeId: "R2001",
          profileType: "seek",
        },
      ];

      const index = service.buildIndex("sample:seek", resumes);
      expect(index.get("R2001")?.locationCity).toBe("Kuala Lumpur");
    } finally {
      cleanupFixtureRoot(root);
    }
  });

  it("derives English manufacturing and recruiter phrases from canonical skills knowledge", () => {
    const root = createFixtureRoot();

    try {
      const service = new ResumeIndexService(root);
      const resumes: ResumeItem[] = [
        {
          name: "Alex Tan",
          profileUrl: "https://my.employer.seek.com/candidates/2",
          activityStatus: "Active",
          age: "33",
          experience: "8 years",
          education: "Bachelor",
          location: "Selangor, Malaysia",
          selfIntro: "",
          jobIntention: "Business Development Manager",
          expectedSalary: "",
          workHistory: [
            {
              raw: "2020-01~2024-12 Precision Motion Sdn Bhd Business Development Manager",
              companyName: "Precision Motion Sdn Bhd",
              jobTitle: "Business Development Manager",
              description: "Handled machine tools distributors and coordinate measuring machine accounts",
              startDate: "2020-01",
              endDate: "2024-12",
            },
          ],
          extractedAt: "2026-03-27T00:00:00.000Z",
          resumeId: "R3001",
          profileType: "seek",
        },
      ];

      const index = service.buildIndex("sample:seek-english-vocab", resumes);
      const entry = index.get("R3001");

      expect(entry?.skills).toEqual(expect.arrayContaining([
        "business development manager",
        "machine tools",
        "coordinate measuring machine",
      ]));
      expect(entry?.industryTags).toEqual(expect.arrayContaining(["machinery", "sales", "metrology"]));
      expect(entry?.searchText).toContain("business development manager");
      expect(entry?.searchText).toContain("machine tools");
    } finally {
      cleanupFixtureRoot(root);
    }
  });
});
