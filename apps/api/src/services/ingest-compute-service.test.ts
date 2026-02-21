import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { describe, expect, it, beforeEach, afterEach } from "vitest";

import { IngestComputeService } from "./ingest-compute-service";

const TEST_SKILLS_MD = `---
version: 42
updated_at: '2026-02-21'
description: Test skills knowledge file
---

# Skills Knowledge

## Domain Taxonomy

### machinery
- displayName: Machinery
- keywords: 机床, 车床, lathe, machining

### cnc
- displayName: CNC
- keywords: cnc, 数控, fanuc, star

### sales
- displayName: Sales
- keywords: 销售, 客户, sales, account

## Synonym Table

- 机床: 机械设备, 加工设备
- 车床: cnc车床, 数控车床
- 数控: cnc, computer numerical control
- 销售: 业务, 商务

## Experience Signals

### senior
- displayName: Senior Level
- keywords: 团队管理, 大客户, manager, lead

### mid
- displayName: Mid Level
- keywords: 独立, 熟练, specialist

### junior
- displayName: Junior Level
- keywords: 应届, 实习, assistant, intern

## Company Patterns

- STAR (aliases: 星, STAR机床, スター精密)
- FANUC (aliases: 发那科, ファナック)

## Industry Context

### CNC Machining

High-precision manufacturing with computer-controlled equipment.

## Exclusion Patterns

- exclude: 测试, test, demo

## Learning Log

- 2026-02-10: shortlist pattern -> STAR + 渠道客户优先
- 2026-02-15: Candidates with 5+ years CNC experience preferred
`;

const TEST_JD_LATHE_SALES = `---
id: jd-lathe-sales
title: 车床销售工程师
status: active
auto_match:
  keywords: [车床, CNC车床, 数控车床, STAR, 机床销售]
  locations: [东莞, 广州, 深圳]
  priority: 90
  filter_preset: sales-mid
  suggested_filters:
    minExperience: 2
    education: [大专, 本科]
---

# 车床销售工程师

## 职位要求

- 2年以上车床销售经验
- 熟悉CNC车床产品
- 有客户资源优先
`;

const TEST_JD_CNC_ENGINEER = `---
id: jd-cnc-engineer
title: CNC工程师
status: active
auto_match:
  keywords: [cnc, 数控, 编程]
  locations: [东莞]
  priority: 80
---

# CNC工程师

## 职位要求

- 熟悉CNC编程
- 懂FANUC系统
`;

const SAMPLE_RESUME_CNC_SALES = {
  data: [
    {
      name: "张三",
      profileUrl: "https://example.com/profile/123",
      activityStatus: "在线中",
      age: "28岁",
      experience: "5年",
      education: "本科",
      location: "东莞市",
      jobIntention: "CNC车床销售工程师",
      expectedSalary: "10000-15000元/月",
      selfIntro: "5年车床销售经验，熟悉STAR、FANUC等品牌，有大客户资源，团队管理经验丰富。",
      workHistory: [
        { raw: "2021-03~2026-01(4年10月)东莞精密机械有限公司销售主管" },
        { raw: "2019-06~2021-02(1年8月)广州CNC设备公司销售工程师" },
      ],
      extractedAt: "2026-02-21T10:00:00.000Z",
    },
  ],
};

const SAMPLE_RESUME_JUNIOR = {
  data: [
    {
      name: "李四",
      profileUrl: "https://example.com/profile/456",
      activityStatus: "在线中",
      age: "22岁",
      experience: "应届生",
      education: "大专",
      location: "深圳市",
      jobIntention: "机械助理",
      expectedSalary: "5000-6000元/月",
      selfIntro: "应届毕业生，实习期间学习过CNC基础知识。",
      workHistory: [
        { raw: "2025-06~2025-12(6月)某机械厂实习生" },
      ],
      extractedAt: "2026-02-21T10:00:00.000Z",
    },
  ],
};

describe("IngestComputeService", () => {
  let tmpDir: string;
  let service: IngestComputeService;

  beforeEach(() => {
    // Create temp project structure
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "ingest-test-"));

    const configResumeDir = path.join(tmpDir, "config", "resume");
    const configJdDir = path.join(tmpDir, "config", "job-descriptions");

    fs.mkdirSync(configResumeDir, { recursive: true });
    fs.mkdirSync(configJdDir, { recursive: true });

    // Write test files
    fs.writeFileSync(path.join(configResumeDir, "skills.md"), TEST_SKILLS_MD);
    fs.writeFileSync(path.join(configJdDir, "jd-lathe-sales.md"), TEST_JD_LATHE_SALES);
    fs.writeFileSync(path.join(configJdDir, "jd-cnc-engineer.md"), TEST_JD_CNC_ENGINEER);

    service = new IngestComputeService(tmpDir);
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("should compute industryTags for CNC sales resume", () => {
    const result = service.computeOne("resume-123", SAMPLE_RESUME_CNC_SALES);

    expect(result.industryTags).toContain("machinery");
    expect(result.industryTags).toContain("cnc");
    expect(result.industryTags).toContain("sales");
  });

  it("should compute synonymHits for CNC sales resume", () => {
    const result = service.computeOne("resume-123", SAMPLE_RESUME_CNC_SALES);

    expect(result.synonymHits).toContain("车床");  // matches "车床" in jobIntention
    expect(result.synonymHits).toContain("销售");  // matches "销售" in jobIntention
  });

  it("should compute ruleScores for all active JDs", () => {
    const result = service.computeOne("resume-123", SAMPLE_RESUME_CNC_SALES);

    expect(result.ruleScores).toHaveProperty("jd-lathe-sales");
    expect(result.ruleScores).toHaveProperty("jd-cnc-engineer");

    // CNC sales resume should score well on lathe-sales JD
    expect(result.ruleScores["jd-lathe-sales"]).toBeGreaterThan(50);
  });

  it("should detect senior experience level", () => {
    const result = service.computeOne("resume-123", SAMPLE_RESUME_CNC_SALES);

    expect(result.experienceLevel).toBe("senior");  // has "团队管理", "大客户"
  });

  it("should detect junior experience level", () => {
    const result = service.computeOne("resume-456", SAMPLE_RESUME_JUNIOR);

    expect(result.experienceLevel).toBe("junior");  // has "应届", "实习"
  });

  it("should include metadata fields", () => {
    const result = service.computeOne("resume-123", SAMPLE_RESUME_CNC_SALES);

    expect(result.resumeId).toBe("resume-123");
    expect(result.computedAt).toBeGreaterThan(0);
    expect(result.skillsVersion).toBe(42);  // from TEST_SKILLS_MD
  });

  it("should accept direct ResumeItem payloads from Convex storage", () => {
    const directPayload = SAMPLE_RESUME_CNC_SALES.data[0];
    const result = service.computeOne("resume-direct", directPayload);

    expect(result.resumeId).toBe("resume-direct");
    expect(result.ruleScores["jd-lathe-sales"]).toBeGreaterThan(50);
  });

  it("should compute batch of resumes", () => {
    const inputs = [
      { resumeId: "resume-123", content: SAMPLE_RESUME_CNC_SALES },
      { resumeId: "resume-456", content: SAMPLE_RESUME_JUNIOR },
    ];

    const results = service.computeBatch(inputs);

    expect(results).toHaveLength(2);
    expect(results[0].resumeId).toBe("resume-123");
    expect(results[1].resumeId).toBe("resume-456");
    expect(results[0].experienceLevel).toBe("senior");
    expect(results[1].experienceLevel).toBe("junior");
  });

  it("should clear skills cache before each computeBatch call", () => {
    const initial = service.computeBatch([
      { resumeId: "resume-123", content: SAMPLE_RESUME_CNC_SALES },
    ]);
    expect(initial[0]?.skillsVersion).toBe(42);

    const skillsPath = path.join(tmpDir, "config", "resume", "skills.md");
    const updatedSkills = fs.readFileSync(skillsPath, "utf8").replace("version: 42", "version: 43");
    fs.writeFileSync(skillsPath, updatedSkills, "utf8");

    const updated = service.computeBatch([
      { resumeId: "resume-123", content: SAMPLE_RESUME_CNC_SALES },
    ]);
    expect(updated[0]?.skillsVersion).toBe(43);
  });

  it("should handle resume without work history", () => {
    const noHistory = {
      data: [
        {
          ...SAMPLE_RESUME_JUNIOR.data[0],
          workHistory: [],
        },
      ],
    };

    const result = service.computeOne("resume-789", noHistory);

    expect(result.industryTags).toBeDefined();
    expect(result.ruleScores).toBeDefined();
  });

  it("should throw error for invalid content", () => {
    expect(() => {
      service.computeOne("resume-bad", {});
    }).toThrow("Invalid resume content");

    expect(() => {
      service.computeOne("resume-bad", { data: [] });
    }).toThrow("Invalid resume content");
  });
});
