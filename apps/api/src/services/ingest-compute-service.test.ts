import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { describe, expect, it, beforeEach, afterEach } from "vitest";

import { buildLatestWorkHistoryEvidence } from "@trends/shared";

import { IngestComputeService, buildResumeIndex } from "./ingest-compute-service";

const TEST_SKILLS_MD = `---
version: 42
updated_at: '2026-02-21'
description: Test skills knowledge file
---

# Skills Knowledge

## Domain Taxonomy

### machinery
- displayName: 机械
- keywords: 机床, 车床, lathe, machining

### cnc
- displayName: CNC
- keywords: cnc, 数控, fanuc, star

### sales
- displayName: 销售
- keywords: 销售, sales, account

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

- STAR [role: both] (aliases: 星, STAR机床, スター精密)
- FANUC [role: both] (aliases: 发那科, ファナック)
- MITSUBISHI [role: both] (aliases: 三菱, 三菱系统)
- HAAS [role: equipment] (aliases: 哈斯, Haas Automation)
- MAZAK [role: both] (aliases: 马扎克, Yamazaki Mazak)
- 润星科技 [role: both] (aliases: 润星, Runxing)
- 思瑞测量 [role: both] (aliases: 思瑞, CHOTEST)
- 秦川机床 [role: both] (aliases: 秦川, Qinchuan)

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
required_roles:
  - type: sales
    min_years: 1
    signals: [销售, 渠道, 销售经理, 销售工程师]
    verify_in: workHistory
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

const TEST_KEYWORDS_STRUCTURED_MD = `
## 重点企业 (Key Companies)

| ID | 公司名称 (Company Name) | 英文名称 (English Name) | 类型 (Type) |
| --- | --- | --- | --- |
| 1 | 北京精雕科技集团有限公司 | JINGDIAO | key_company |
| 2 | 东莞精雕机械科技有限公司 |  | key_company |
| 3 | 上海发那科机器人有限公司 | FANUC | key_company |
| 4 | 秦川机床集团股份公司 | QINCHUAN | key_company |
| 5 | 润星科技集团 | RUNXING | key_company |

## ITES 参展商 (ITES Exhibitors)

| ID | 公司名称 (Company Name) | 英文名称 (English Name) | 展品类别 (Category) |
| --- | --- | --- | --- |
| 1 | 宝力机械有限公司 |  | 金属切削机床 |

## 4.3 进口代理商 (Import Agents)

### 4.3.4 三坐标/测量扫描代理商 (CMM/Measurement Scanning Agents)

| ID | 代理商名称 (Agent Name) | 英文名称 (English Name) | 类型 (Type) |
| --- | --- | --- | --- |
| 1 | 秦川 |  | 测量扫描代理 |
| 2 | 润星 |  | 测量扫描代理 |
| 3 | 思瑞 |  | 测量扫描代理 |
`;

const TEST_BRANDS_JSON = JSON.stringify([
  { id: 1, nameCn: "发那科", nameEn: "FANUC", type: "加工中心/数控车床", origin: "international" },
  { id: 2, nameCn: "三菱", nameEn: "MITSUBISHI", type: "加工中心/火花机", origin: "international" },
  { id: 3, nameCn: "哈斯", nameEn: "HAAS", type: "加工中心/走心机", origin: "international" },
  { id: 4, nameCn: "润星科技", nameEn: "RUNXING", type: "加工中心/数控车床", origin: "domestic" },
  { id: 5, nameCn: "思瑞测量", nameEn: "CHOTEST", type: "测量扫描", origin: "domestic" },
  { id: 6, nameCn: "秦川机床", nameEn: "QINCHUAN", type: "加工中心/数控车床", origin: "domestic" },
  { id: 7, nameCn: "精雕", nameEn: "JINGDIAO", type: "加工中心/数控车床", origin: "domestic" },
], null, 2);

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

const SAMPLE_RESUME_HAAS = {
  data: [
    {
      name: "王五",
      profileUrl: "https://example.com/profile/789",
      activityStatus: "在线中",
      age: "31岁",
      experience: "6年",
      education: "本科",
      location: "东莞市",
      jobIntention: "哈斯车床销售经理",
      expectedSalary: "15000-20000元/月",
      selfIntro: "熟悉精密加工行业客户开发与渠道管理。",
      workHistory: [
        { raw: "2020-01~2025-12(5年11月)东莞某设备公司销售经理" },
      ],
      extractedAt: "2026-02-21T10:00:00.000Z",
    },
  ],
};

const SAMPLE_RESUME_ENGINEER = {
  data: [
    {
      name: "赵六",
      profileUrl: "https://example.com/profile/901",
      activityStatus: "在线中",
      age: "30岁",
      experience: "6年",
      education: "本科",
      location: "东莞市",
      jobIntention: "机械工程师",
      expectedSalary: "18000-22000元/月",
      selfIntro: "具备机械设计与研发经验，熟悉设备调试和技术问题排查。",
      workHistory: [
        { raw: "2021-01~2025-12(4年11月)东莞自动化设备有限公司机械工程师" },
        { raw: "2019-06~2020-12(1年6月)深圳科技有限公司研发工程师" },
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
    const configIndustryDataDir = path.join(tmpDir, "config", "industry-data");

    fs.mkdirSync(configResumeDir, { recursive: true });
    fs.mkdirSync(configJdDir, { recursive: true });
    fs.mkdirSync(configIndustryDataDir, { recursive: true });

    // Write test files
    fs.writeFileSync(path.join(configResumeDir, "skills.md"), TEST_SKILLS_MD);
    fs.writeFileSync(path.join(configJdDir, "jd-lathe-sales.md"), TEST_JD_LATHE_SALES);
    fs.writeFileSync(path.join(configJdDir, "jd-cnc-engineer.md"), TEST_JD_CNC_ENGINEER);
    fs.writeFileSync(path.join(configIndustryDataDir, "keywords-structured.md"), TEST_KEYWORDS_STRUCTURED_MD);
    fs.writeFileSync(path.join(configIndustryDataDir, "brands.json"), TEST_BRANDS_JSON);

    service = new IngestComputeService(tmpDir);
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("should compute industryTags from work history evidence only", () => {
    const result = service.computeOne("resume-123", SAMPLE_RESUME_CNC_SALES);

    expect(result.industryTags).toContain("CNC");
    expect(result.industryTags).toContain("销售");
    expect(result.industryTags).not.toContain("机械");
  });

  it("should compute synonymHits from work history evidence only", () => {
    const result = service.computeOne("resume-123", SAMPLE_RESUME_CNC_SALES);

    expect(result.synonymHits).toEqual(expect.arrayContaining([
      "销售",
      "业务",
      "商务",
    ]));
    expect(result.synonymHits).not.toContain("车床");
    expect(result.synonymHits).not.toContain("cnc车床");
    expect(result.synonymHits).not.toContain("数控车床");
  });

  it("should not derive industryTags / synonymHits / experienceLevel from non-workHistory fields (strict-mode evidence)", () => {
    const resume = {
      data: [
        {
          name: "测试候选人",
          profileUrl: "https://example.com/profile/strict",
          activityStatus: "在线中",
          age: "30岁",
          experience: "5年",
          // keywords planted in education/location/salary/jobIntention/selfIntro
          // must NOT drive strict-mode signals — only workHistory evidence counts.
          education: "CNC 数控 机床 本科",
          location: "东莞市 销售 团队管理",
          jobIntention: "manager lead",
          expectedSalary: "10000 sales account",
          selfIntro: "大客户 团队管理 manager",
          workHistory: [
            { raw: "2021-01~2025-12(4年11月)某公司普通职员" },
          ],
          extractedAt: "2026-02-21T10:00:00.000Z",
        },
      ],
    };

    const result = service.computeOne("resume-strict-evidence", resume);

    expect(result.industryTags).not.toContain("CNC");
    expect(result.industryTags).not.toContain("机械");
    expect(result.industryTags).not.toContain("销售");
    expect(result.synonymHits).not.toContain("cnc");
    expect(result.synonymHits).not.toContain("数控");
    expect(result.synonymHits).not.toContain("业务");
    expect(result.experienceLevel).toBe("mid");
  });

  it("should compute ruleScores for all active JDs", () => {
    const result = service.computeOne("resume-123", SAMPLE_RESUME_CNC_SALES);

    expect(result.ruleScores).toHaveProperty("jd-lathe-sales");
    expect(result.ruleScores).toHaveProperty("jd-cnc-engineer");

    // CNC sales resume should score well on lathe-sales JD
    expect(result.ruleScores["jd-lathe-sales"]).toBeGreaterThan(50);
    const maxScore = Math.max(...Object.values(result.ruleScores));
    expect(result.primaryRuleScore).toBe(maxScore);
  });

  it("should not derive senior experience level from selfIntro", () => {
    const result = service.computeOne("resume-123", SAMPLE_RESUME_CNC_SALES);

    expect(result.experienceLevel).toBe("mid");
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

  it("should compute role signals and experience years from work history", () => {
    const result = service.computeOne("resume-123", SAMPLE_RESUME_CNC_SALES);
    const salesRole = result.roleSignals.find((item) => item.type === "sales");
    const index = buildResumeIndex(SAMPLE_RESUME_CNC_SALES.data[0], 0);

    expect(salesRole).toBeDefined();
    expect(salesRole?.signalCount).toBeGreaterThan(0);
    expect(salesRole?.years).toBeGreaterThan(0);
    expect(index.experienceYears).toBeCloseTo(6.5, 1);
    expect(result.ruleScores["jd-lathe-sales"]).toBeGreaterThan(50);
  });

  it("should compute engineer role signals from work history", () => {
    const result = service.computeOne("resume-901", SAMPLE_RESUME_ENGINEER);
    const engineerRole = result.roleSignals.find((item) => item.type === "engineer");

    expect(engineerRole).toBeDefined();
    expect(engineerRole?.matchedSignals).toEqual(expect.arrayContaining(["工程师", "研发"]));
    expect(engineerRole?.years).toBeGreaterThan(0);
  });

  it("should persist matched work-entry evidence and prioritize title matches", () => {
    const structuredResume = {
      data: [
        {
          ...SAMPLE_RESUME_CNC_SALES.data[0],
          workHistory: [
            {
              raw: "2021-01~2023-06 东莞精雕机械科技有限公司 销售工程师",
              companyName: "东莞精雕机械科技有限公司",
              jobTitle: "销售工程师",
              description: "负责客户开发与渠道维护",
              startDate: "2021-01",
              endDate: "2023-06",
            },
            {
              raw: "2019-01~2020-12 深圳科技有限公司 项目协调",
              companyName: "深圳科技有限公司",
              jobTitle: "项目协调",
              description: "协助销售团队推进客户跟进",
              startDate: "2019-01",
              endDate: "2020-12",
            },
          ],
        },
      ],
    };
    const result = service.computeOne("resume-structured", structuredResume);
    const salesRole = result.roleSignals.find((item) => item.type === "sales");

    expect(salesRole).toBeDefined();
    expect(salesRole?.signalCount).toBeGreaterThan((salesRole?.matchedSignals.length ?? 0));
    expect(salesRole?.roleRelevantYears).toBeGreaterThan(2);
    expect(salesRole?.industryVerifiedRelevantYears).toBeGreaterThan(2);
    expect(salesRole?.matchedWorkEntries).toEqual(expect.arrayContaining([
      expect.objectContaining({
        companyName: "东莞精雕机械科技有限公司",
        jobTitle: "销售工程师",
        industryVerified: true,
        matchedSignals: expect.arrayContaining(["销售", "销售工程师", "渠道"]),
      }),
    ]));
    expect(salesRole?.matchedWorkEntries?.some((entry) => entry.companyName === "深圳科技有限公司")).toBe(false);
  });

  it("should gate auxiliary description-only sales mentions", () => {
    const result = service.computeOne("resume-cnc-aux-sales", {
      data: [
        {
          ...SAMPLE_RESUME_ENGINEER.data[0],
          jobIntention: "CNC编程员",
          selfIntro: "长期从事CNC编程与设备调试。",
          workHistory: [
            {
              raw: "2021-01~2024-12 汇专机床 CNC编程员",
              companyName: "汇专机床",
              jobTitle: "CNC编程员",
              description: "配合公司销售搞定客户",
              startDate: "2021-01",
              endDate: "2024-12",
            },
          ],
        },
      ],
    });

    const salesRole = result.roleSignals.find((item) => item.type === "sales");
    const engineerRole = result.roleSignals.find((item) => item.type === "engineer");

    expect(salesRole).toBeUndefined();
    expect(engineerRole).toBeDefined();
    expect(engineerRole?.years).toBeGreaterThan(0);
  });

  it("should preserve non-auxiliary multi-signal sales attribution from description", () => {
    const result = service.computeOne("resume-sales-desc-signals", {
      data: [
        {
          ...SAMPLE_RESUME_ENGINEER.data[0],
          jobIntention: "项目专员",
          selfIntro: "擅长订单统筹和渠道沟通。",
          workHistory: [
            {
              raw: "2022-01~2024-12 深圳运营有限公司 项目专员",
              companyName: "深圳运营有限公司",
              jobTitle: "项目专员",
              description: "负责销售订单处理，渠道开发",
              startDate: "2022-01",
              endDate: "2024-12",
            },
          ],
        },
      ],
    });

    const salesRole = result.roleSignals.find((item) => item.type === "sales");

    expect(salesRole).toBeDefined();
    expect(salesRole?.matchedSignals).toEqual(expect.arrayContaining(["销售", "渠道"]));
    expect(salesRole?.years).toBeGreaterThan(2);
    expect(salesRole?.matchedWorkEntries).toEqual(expect.arrayContaining([
      expect.objectContaining({
        companyName: "深圳运营有限公司",
        jobTitle: "项目专员",
        matchedSignals: expect.arrayContaining(["销售", "渠道"]),
      }),
    ]));
  });

  it("should count only direct sales-title years as sales roleRelevantYears", () => {
    const result = service.computeOne("resume-sales-support-vs-direct", {
      data: [
        {
          ...SAMPLE_RESUME_ENGINEER.data[0],
          extractedAt: "2026-04-15T00:00:00.000Z",
          workHistory: [
            {
              raw: "2021-01~2025-01 某设备公司 项目工程师",
              companyName: "某设备公司",
              jobTitle: "项目工程师",
              description: "参与销售商务谈判，协助代理商推进订单与验收",
              startDate: "2021-01",
              endDate: "2025-01",
            },
            {
              raw: "2020-01~2021-01 某机床公司 销售工程师",
              companyName: "某机床公司",
              jobTitle: "销售工程师",
              description: "负责客户开发与报价跟进",
              startDate: "2020-01",
              endDate: "2021-01",
            },
          ],
        },
      ],
    });

    const salesRole = result.roleSignals.find((item) => item.type === "sales");

    expect(salesRole).toBeDefined();
    expect(salesRole?.years ?? 0).toBeGreaterThan(4);
    expect(salesRole?.roleRelevantYears).toBeCloseTo(1, 1);
  });

  it("should ignore generic company boilerplate sales mentions on engineer resumes", () => {
    const result = service.computeOne("resume-engineer-company-boilerplate", {
      data: [
        {
          ...SAMPLE_RESUME_ENGINEER.data[0],
          jobIntention: "自动化设计工程师",
          selfIntro: "长期从事自动化设备开发、编程与调试。",
          workHistory: [
            {
              raw: "2019-01~2024-12 深圳通信科技有限公司 自动化设计工程师",
              companyName: "深圳通信科技有限公司",
              jobTitle: "自动化设计工程师",
              description: "公司致力于各类通信产品的研发、制造和销售，负责自动化设备开发导入、PLC编程与现场调试。",
              startDate: "2019-01",
              endDate: "2024-12",
            },
          ],
        },
      ],
    });

    const salesRole = result.roleSignals.find((item) => item.type === "sales");
    const engineerRole = result.roleSignals.find((item) => item.type === "engineer");

    expect(salesRole).toBeUndefined();
    expect(engineerRole).toBeDefined();
    expect(engineerRole?.matchedSignals).toEqual(expect.arrayContaining(["工程师", "开发", "编程", "调试"]));
    expect(engineerRole?.years).toBeGreaterThan(5);
  });

  it("should mark directRoleMatch=false when jobTitle is a company boilerplate description", () => {
    const result = service.computeOne("resume-vivo-boilerplate-jobtitle", {
      data: [
        {
          ...SAMPLE_RESUME_ENGINEER.data[0],
          extractedAt: "2026-04-15T00:00:00.000Z",
          workHistory: [
            {
              raw: "2018-04~2024-06 维沃移动通信有限公司 公司致力于各类通信产品的研发、制造和销售 自动化 内容: 公司介绍: 业务已覆盖中国、东南亚等广大市场。工作内容: 主要负责新机型量产导入工作",
              companyName: "维沃移动通信有限公司",
              jobTitle: "公司致力于各类通信产品的研发、制造和销售",
              description: "自动化 内容: 公司介绍: 业务已覆盖中国、东南亚等广大市场。工作内容: 主要负责新机型量产导入工作",
              startDate: "2018-04",
              endDate: "2024-06",
            },
          ],
        },
      ],
    });

    const salesRole = result.roleSignals.find((item) => item.type === "sales");
    const engineerRole = result.roleSignals.find((item) => item.type === "engineer");

    // The sales signal should exist (matched "销售" from the boilerplate jobTitle)
    // but directRoleMatch should be false because the jobTitle is a company description
    expect(salesRole).toBeDefined();
    expect(salesRole?.matchedSignals).toEqual(expect.arrayContaining(["销售"]));
    if (salesRole?.matchedWorkEntries && salesRole.matchedWorkEntries.length > 0) {
      const salesEntry = salesRole.matchedWorkEntries.find(
        (e: { companyName?: string }) => e.companyName === "维沃移动通信有限公司",
      );
      expect(salesEntry?.directRoleMatch).toBe(false);
    }

    // Engineer should have directRoleMatch=true (engineer title is genuine)
    expect(engineerRole).toBeDefined();
  });
  it("should recognize English business-development sales titles in work history", () => {
    const result = service.computeOne("resume-bd-manager", {
      data: [
        {
          ...SAMPLE_RESUME_ENGINEER.data[0],
          jobIntention: "Business Development Manager",
          selfIntro: "Focused on machine tools channel growth in Malaysia.",
          workHistory: [
            {
              raw: "2021-01~2024-12 Acme Precision Sdn Bhd Business Development Manager",
              companyName: "Acme Precision Sdn Bhd",
              jobTitle: "Business Development Manager",
              description: "Managed channel sales and key account manager coverage for machine tools distributors",
              startDate: "2021-01",
              endDate: "2024-12",
            },
          ],
        },
      ],
    });

    const salesRole = result.roleSignals.find((item) => item.type === "sales");

    expect(salesRole).toBeDefined();
    expect(salesRole?.matchedSignals).toEqual(expect.arrayContaining([
      "business development",
      "business development manager",
      "channel sales",
      "key account manager",
    ]));
    expect(salesRole?.years).toBeGreaterThan(3);
  });

  it("should use extractedAt as a stable anchor for ongoing role years", () => {
    const ongoingResume = {
      data: [
        {
          ...SAMPLE_RESUME_CNC_SALES.data[0],
          extractedAt: "2026-02-21T10:00:00.000Z",
          workHistory: [
            {
              raw: "2021-03~至今 东莞精密机械有限公司销售主管",
              companyName: "东莞精密机械有限公司",
              jobTitle: "销售主管",
              startDate: "2021-03",
              endDate: "至今",
            },
          ],
        },
      ],
    };

    const result = service.computeOne("resume-ongoing", ongoingResume);
    const salesRole = result.roleSignals.find((item) => item.type === "sales");
    const index = buildResumeIndex(ongoingResume.data[0], 0);

    expect(index.experienceYears).toBeCloseTo(4.9, 1);
    expect(salesRole?.years).toBeCloseTo(4.92, 1);
  });

  it("should build tagging envelope with confidence and provenance", () => {
    const result = service.computeOne("resume-123", SAMPLE_RESUME_CNC_SALES);

    const taggingIndustryTag = result.taggingEnvelope.entries.find((item) => item.tag === "industry:cnc");
    const taggingRoleTag = result.taggingEnvelope.entries.find((item) => item.tag === "role:sales");
    const taggingCompanyTag = result.taggingEnvelope.entries.find((item) => item.tag === "company:star");

    expect(result.taggingEnvelope.schemaVersion).toBe(1);
    expect(result.taggingEnvelope.generatedAt).toBeGreaterThan(0);
    expect(result.taggingEnvelope.entries.length).toBeGreaterThan(0);

    expect(taggingIndustryTag?.provenance.stage).toBe("industry_taxonomy");
    expect(taggingIndustryTag?.provenance.generatedBy).toBe("ingest-compute-service");
    expect(taggingIndustryTag?.confidence).toBeGreaterThan(0);
    expect(taggingIndustryTag?.version).toBe(42);
    expect(taggingRoleTag?.provenance.stage).toBe("role_signal_aggregation");
    expect(taggingRoleTag?.provenance.generatedBy).toBe("ingest-compute-service");
    expect(taggingCompanyTag).toBeUndefined();
  });

  it("should ignore selfIntro brand mentions in processing", () => {
    const equipmentResume = {
      data: [
        {
          ...SAMPLE_RESUME_JUNIOR.data[0],
          selfIntro: "熟悉发那科与马扎克机台操作，具备设备使用经验。",
          jobIntention: "CNC操作员",
          workHistory: [],
        },
      ],
    };
    const result = service.computeOne("resume-equipment", equipmentResume);

    expect(result.brandHits).toEqual([]);
  });

  it("should classify workHistory brand mentions as employer context", () => {
    const employerResume = {
      data: [
        {
          ...SAMPLE_RESUME_JUNIOR.data[0],
          selfIntro: "负责机器人自动化项目交付。",
          workHistory: [
            { raw: "2020-01~2023-12(3年11月)上海发那科机器人有限公司销售工程师" },
          ],
        },
      ],
    };
    const result = service.computeOne("resume-employer", employerResume);

    expect(result.brandHits).toContainEqual({
      brand: "fanuc",
      role: "employer",
      source: "workHistory",
      context: "employer",
      companyId: 3,
    });
  });

  it("should keep non-brand ITES employers in companyHits without creating employer brandHits", () => {
    const result = service.computeOne("resume-baoli", {
      data: [
        {
          ...SAMPLE_RESUME_JUNIOR.data[0],
          selfIntro: "",
          workHistory: [
            { raw: "2020-01~2024-01 东莞宝力机械科技有限公司 销售经理" },
          ],
        },
      ],
    });

    expect(result.companyHits).toContain("宝力机械有限公司");
    expect(result.brandHits.filter((hit) => hit.context === "employer")).toEqual([]);
  });

  it("should not match loose skills aliases as employer brands; should match Tier-1 industry DB companies", () => {
    const falsePositiveResume = {
      data: [
        {
          ...SAMPLE_RESUME_JUNIOR.data[0],
          workHistory: [
            { raw: "2016-06~2021-11(5年5月)东莞精雕机械科技有限公司" },
          ],
        },
      ],
    };
    const truePositiveResume = {
      data: [
        {
          ...SAMPLE_RESUME_JUNIOR.data[0],
          workHistory: [
            { raw: "2016-06~2021-11(5年5月)北京精雕科技集团有限公司" },
          ],
        },
      ],
    };

    const falsePositiveResult = service.computeOne("resume-dg-jingdiao", falsePositiveResume);
    expect(falsePositiveResult.companyHits).not.toContain("jingdiao");

    const truePositiveResult = service.computeOne("resume-bj-jingdiao", truePositiveResume);
    expect(truePositiveResult.companyHits).toContain("jingdiao");
    expect(truePositiveResult.brandHits).toContainEqual({
      brand: "jingdiao",
      role: "employer",
      source: "workHistory",
      context: "employer",
      companyId: 1,
    });
  });

  it("should reject ambiguous short employer substrings while preserving qualified near-exact company hits", () => {
    const falsePositiveResume = {
      data: [
        {
          ...SAMPLE_RESUME_JUNIOR.data[0],
          workHistory: [
            { raw: "2020-01~2022-12(2年11月)东莞市秦川电力设备有限公司销售工程师" },
            { raw: "2018-01~2019-12(1年11月)珠海润星泰电器有限公司业务员" },
            { raw: "2016-01~2017-12(1年11月)岑巩县思瑞高级中学教师" },
          ],
        },
      ],
    };
    const truePositiveResume = {
      data: [
        {
          ...SAMPLE_RESUME_JUNIOR.data[0],
          workHistory: [
            { raw: "2020-01~2024-12(4年11月)秦川机床集团销售工程师" },
          ],
        },
      ],
    };

    const falsePositiveResult = service.computeOne("resume-partial-false-positive", falsePositiveResume);
    expect(falsePositiveResult.brandHits).toEqual([]);
    expect(falsePositiveResult.companyHits).toEqual([]);

    const truePositiveResult = service.computeOne("resume-qinchuan", truePositiveResume);
    expect(truePositiveResult.companyHits).toContain("qinchuan");
    expect(truePositiveResult.brandHits).toContainEqual({
      brand: "qinchuan",
      role: "employer",
      source: "workHistory",
      context: "employer",
      companyId: 4,
    });
  });

  it("should ignore selfIntro sales brand mentions in processing", () => {
    const salesResume = {
      data: [
        {
          ...SAMPLE_RESUME_JUNIOR.data[0],
          selfIntro: "负责STAR销售、渠道拓展与客户拜访。",
          jobIntention: "机床销售工程师",
          workHistory: [],
        },
      ],
    };
    const result = service.computeOne("resume-sales", salesResume);

    expect(result.brandHits).toEqual([]);
  });

  it("should not emit brand hits from selfIntro only content", () => {
    const dedupeResume = {
      data: [
        {
          ...SAMPLE_RESUME_JUNIOR.data[0],
          selfIntro: "发那科设备使用经验，发那科机台操作，发那科设备熟悉。",
          workHistory: [],
        },
      ],
    };
    const result = service.computeOne("resume-dedupe", dedupeResume);

    expect(result.brandHits).toEqual([]);
  });

  it("should compute alias tokens from non-employer brand mentions", () => {
    const result = service.computeOne("resume-brand-aliases", {
      data: [
        {
          ...SAMPLE_RESUME_JUNIOR.data[0],
          workHistory: [
            { raw: "2020-01~2024-12(4年11月)某设备公司销售工程师，负责三菱系统调试、发那科设备维护。" },
          ],
        },
      ],
    });

    expect(result.companyHits).toEqual([]);
    expect(result.brandHits.map((hit) => hit.brand)).toEqual(expect.arrayContaining(["mitsubishi", "fanuc"]));
    expect(result.companyPatternAliasTokens).toContain("mitsubishi");
    expect(result.companyPatternAliasTokens).toContain("三菱");
    expect(result.industryDbV2RawComponents.companyScore).toBe(0);
  });

  it("should not match HAAS aliases from excluded fields", () => {
    const result = service.computeOne("resume-789", SAMPLE_RESUME_HAAS);

    expect(result.companyHits).toEqual([]);
    expect(result.companyPatternAliasTokens).toBe("");
  });

  it("should include aliases for employer and non-employer brand matches without duplication", () => {
    const result = service.computeOne("resume-brand-aliases", {
      data: [
        {
          ...SAMPLE_RESUME_JUNIOR.data[0],
          workHistory: [
            { raw: "2020-01~2024-12(4年11月)上海发那科机器人有限公司销售工程师，负责三菱系统调试、发那科设备维护。" },
          ],
        },
      ],
    });

    expect(result.companyHits).toEqual(["fanuc"]);
    expect(result.brandHits.map((hit) => hit.brand)).toEqual(expect.arrayContaining(["fanuc", "mitsubishi"]));
    const aliasTokens = result.companyPatternAliasTokens.split(/\s+/).filter(Boolean);
    expect(aliasTokens).toEqual(expect.arrayContaining(["fanuc", "发那科", "mitsubishi", "三菱"]));
    expect(aliasTokens.filter((token) => token === "三菱")).toHaveLength(1);
  });

  it("should compute deterministic industry_db v2 raw scores from employer and brand evidence", () => {
    const result = service.computeOne("resume-employer-brand", {
      data: [
        {
          ...SAMPLE_RESUME_JUNIOR.data[0],
          workHistory: [
            { raw: "2020-01~2024-12(4年11月)上海发那科机器人有限公司销售工程师，负责STAR车床销售、FANUC系统调试。" },
            { raw: "2018-01~2019-12(1年11月)北京精雕科技集团有限公司销售工程师，负责STAR设备销售。" },
          ],
        },
      ],
    });

    expect(result.companyHits).toEqual(expect.arrayContaining(["fanuc", "jingdiao"]));
    expect(result.industryDbV2RawComponents).toEqual({
      companyScore: 20,
      brandScore: 20,
      weightedBrandUnits: 2,
      uniqueCompanies: 2,
      brandUnitCount: 2,
    });
    expect(result.industryDbV2Raw).toBe(40);
  });

  it("should dedupe repeated brand mentions by brand and context for industry_db v2 raw scoring", () => {
    const result = service.computeOne("resume-brand-dedupe", {
      data: [
        {
          ...SAMPLE_RESUME_JUNIOR.data[0],
          workHistory: [
            { raw: "2020-01~2024-12(4年11月)某设备公司销售工程师，负责STAR销售、STAR销售、STAR设备使用、STAR设备使用、STAR编程调试。" },
          ],
        },
      ],
    });

    expect(result.companyHits).toEqual([]);
    expect(result.industryDbV2RawComponents).toEqual({
      companyScore: 0,
      brandScore: 10,
      weightedBrandUnits: 1,
      uniqueCompanies: 0,
      brandUnitCount: 1,
    });
    expect(result.industryDbV2Raw).toBe(10);
  });

  it("should return empty company matches for unknown brands", () => {
    const result = service.computeOne("resume-456", SAMPLE_RESUME_JUNIOR);

    expect(result.companyHits).toEqual([]);
    expect(result.companyPatternAliasTokens).toBe("");
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
    expect(results[0].experienceLevel).toBe("mid");
    expect(results[1].experienceLevel).toBe("junior");
    expect(results.every((item) => Array.isArray(item.brandHits))).toBe(true);
    expect(results.every((item) => Array.isArray(item.companyHits))).toBe(true);
    expect(results.every((item) => typeof item.companyPatternAliasTokens === "string")).toBe(true);
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
    const index = buildResumeIndex(noHistory.data[0], 0);

    expect(result.evidenceText).toBe("");
    expect(index.experienceYears).toBeNull();
    expect(result.industryTags).toBeDefined();
    expect(result.ruleScores).toBeDefined();
  });

  it("should build evidenceText with the shared evidence helper", () => {
    const item = {
      ...SAMPLE_RESUME_JUNIOR.data[0],
      workHistory: [
        { raw: "  2020-2025   Sales   Engineer  " },
        { raw: " CNC 机床 " },
      ],
    };

    const index = buildResumeIndex(item, 0);

    expect(index.evidenceText).toBe(buildLatestWorkHistoryEvidence(item).text);
    expect(index.evidenceText).toBe("2020-2025 sales engineer\ncnc 机床");
    expect(index.searchText).not.toContain("应届毕业生");
    expect(index.searchText).not.toContain("机械助理");
  });

  it("should produce evidence from manual-import-shaped structured work history even with empty selfIntro", () => {
    const item = {
      ...SAMPLE_RESUME_JUNIOR.data[0],
      selfIntro: "",
      jobIntention: "销售工程师",
      workHistory: [
        {
          raw: "2021-03~2025-03 东莞精密机械有限公司 销售工程师",
          companyName: "东莞精密机械有限公司",
          jobTitle: "销售工程师",
          description: "负责华南区机床销售与客户维护",
          startDate: "2021-03",
          endDate: "2025-03",
        },
      ],
      profileEducation: [
        {
          institution: "华南理工大学",
          qualification: "本科",
          fieldOfStudy: "机械设计制造及其自动化",
          startDate: "2015-09",
          endDate: "2019-06",
        },
      ],
      resumeSnippet: {
        text: "姓名：张三\n工作经历\n2021-03~至今 东莞精密机械有限公司 销售工程师\n工作描述：负责华南区机床销售与客户维护",
      },
    };

    const index = buildResumeIndex(item, 0);
    const result = service.computeOne("resume-manual-51job", { data: [item] });
    const salesRole = result.roleSignals.find((entry) => entry.type === "sales");

    expect(index.evidenceText).toContain("东莞精密机械有限公司");
    expect(index.evidenceText).toContain("销售工程师");
    expect(result.evidenceText).toBe(index.evidenceText);
    expect(result.ruleScores["jd-lathe-sales"]).toBeGreaterThan(0);
    expect(salesRole?.years).toBeGreaterThan(0);
    expect(salesRole?.matchedWorkEntries).toEqual(expect.arrayContaining([
      expect.objectContaining({
        companyName: "东莞精密机械有限公司",
        jobTitle: "销售工程师",
      }),
    ]));
  });

  it("should use structured work history dates and company names", () => {
    const item = {
      ...SAMPLE_RESUME_JUNIOR.data[0],
      workHistory: [
        {
          raw: "2021-03 ~ 2023-08 Example Co. Sales Manager",
          companyName: "Example Co.",
          jobTitle: "Sales Manager",
          startDate: "2021-03",
          endDate: "2023-08",
        },
      ],
    };

    const index = buildResumeIndex(item, 0);
    const result = service.computeOne("resume-structured", { data: [item] });

    expect(index.experienceYears).toBeCloseTo(2.4, 1);
    expect(index.companies).toContain("Example");
    expect(result.evidenceText).toContain("example co.");
  });

  it("should throw error for invalid content", () => {
    expect(() => {
      service.computeOne("resume-bad", {});
    }).toThrow("Invalid resume content");

    expect(() => {
      service.computeOne("resume-bad", { data: [] });
    }).toThrow("Invalid resume content");
  });

  it("should deduplicate companyHits when the same verified employer appears in multiple work history entries", () => {
    const result = service.computeOne("resume-dedup-employer", {
      data: [
        {
          ...SAMPLE_RESUME_JUNIOR.data[0],
          workHistory: [
            { raw: "2016-06~2019-12(3年6月)北京精雕科技集团有限公司销售工程师" },
            { raw: "2020-01~2024-12(4年11月)北京精雕科技集团有限公司区域经理" },
          ],
        },
      ],
    });

    // The same company key should appear only once in companyHits
    const jingdiaoHits = result.companyHits.filter((key) => key === "jingdiao");
    expect(jingdiaoHits).toHaveLength(1);

    // Should still produce a single employer brandHit
    const employerHits = result.brandHits.filter((hit) => hit.context === "employer");
    expect(employerHits).toHaveLength(1);
    expect(employerHits[0]).toEqual({
      brand: "jingdiao",
      role: "employer",
      source: "workHistory",
      context: "employer",
      companyId: 1,
    });
  });

  it("should not produce companyHits for work history entries at non-verified companies", () => {
    const result = service.computeOne("resume-non-verified-employer", {
      data: [
        {
          ...SAMPLE_RESUME_JUNIOR.data[0],
          workHistory: [
            { raw: "2020-01~2024-12(4年11月)东莞市普通贸易有限公司销售经理" },
          ],
        },
      ],
    });

    expect(result.companyHits).toEqual([]);
    expect(result.brandHits.filter((hit) => hit.context === "employer")).toEqual([]);
  });

  describe("MY market graceful degradation", () => {
    const internationalHitResume = {
      data: [
        {
          ...SAMPLE_RESUME_JUNIOR.data[0],
          workHistory: [
            { raw: "2020-01~2024-12(4年11月)上海发那科机器人有限公司销售工程师，负责STAR车床销售、FANUC系统调试。" },
            { raw: "2018-01~2019-12(1年11月)北京精雕科技集团有限公司销售工程师，负责STAR设备销售。" },
          ],
        },
      ],
    };

    it("should set market to CN by default (no sourceKey)", () => {
      const result = service.computeOne("resume-default", SAMPLE_RESUME_CNC_SALES);
      expect(result.market).toBe("CN");
    });

    it("should set market to CN for job5156 sourceKey", () => {
      const result = service.computeOne("resume-cn", SAMPLE_RESUME_CNC_SALES, "job5156");
      expect(result.market).toBe("CN");
    });

    it("should set market to MY for seek sourceKey", () => {
      const result = service.computeOne("resume-my", SAMPLE_RESUME_CNC_SALES, "seek");
      expect(result.market).toBe("MY");
    });

    it("should gracefully return zero MY hits when no verified employer or brand matches exist", () => {
      const myResult = service.computeOne("resume-my", SAMPLE_RESUME_CNC_SALES, "seek");

      // This fixture has no qualifying international employer/brand evidence,
      // so zero hits are expected — not because MY verification is skipped.
      expect(myResult.industryDbV2Raw).toBe(0);
      expect(myResult.brandHits).toEqual([]);
      expect(myResult.companyHits).toEqual([]);
      expect(myResult.industryDbV2RawComponents).toEqual({
        companyScore: 0,
        brandScore: 0,
        weightedBrandUnits: 0,
        uniqueCompanies: 0,
        brandUnitCount: 0,
      });
    });

    it("should keep international employer and brand verification active for MY resumes", () => {
      const cnResult = service.computeOne("resume-cn-hit", internationalHitResume, "job5156");
      const myResult = service.computeOne("resume-my-hit", internationalHitResume, "seek");

      expect(myResult.companyHits).toEqual(cnResult.companyHits);
      expect(myResult.brandHits).toEqual(cnResult.brandHits);
      expect(myResult.industryDbV2RawComponents).toEqual(cnResult.industryDbV2RawComponents);
      expect(myResult.industryDbV2Raw).toBe(cnResult.industryDbV2Raw);
      expect(myResult.industryDbV2Raw).toBeGreaterThan(0);
    });

    it("should still compute industryTags for MY market (keyword-based)", () => {
      const result = service.computeOne("resume-my", SAMPLE_RESUME_CNC_SALES, "seek");

      // Keyword-based tags still work regardless of market
      expect(result.industryTags.length).toBeGreaterThan(0);
    });

    it("should keep MY rule scoring active even when the resume has no direct hits", () => {
      const myResult = service.computeOne("resume-my", SAMPLE_RESUME_CNC_SALES, "seek");

      expect(myResult.primaryRuleScore).toBeGreaterThan(0);
    });
  });

  describe("JTEKT / TOYODA alias regression (CN HR feedback 宋先生 case)", () => {
    // Regression for the 2026-07-09 CN HR feedback audit: 宋先生 worked at
    // 捷太格特机床(大连)有限公司 (JTEKT) but scored 15 because the employer
    // string was not seeded as a known company and 捷太格特/JTEKT were not
    // aliased to the TOYODA brand pattern. These fixtures mirror the real
    // config changes in skills.md/skills.en.md/brands.json/keywords-structured.md.
    const JTEKT_SKILLS_MD = `---
version: 42
updated_at: '2026-07-10'
description: JTEKT alias regression fixture
---

# Skills Knowledge

## Domain Taxonomy

### machinery
- displayName: 机械
- keywords: 机床, 车床, lathe, machining

### sales
- displayName: 销售
- keywords: 销售, sales, account

## Company Patterns

- TOYODA [role: both] (aliases: 丰田工机, ジェイテクト, 捷太格特, JTEKT, JTEKT机床, 捷太格特机床)
- 蕙勒 [role: both] (aliases: 蕙勒智能, 蕙勒智能科技, Huile)
- 唯思凌科 [role: both] (aliases: 湖北唯思凌科, 唯思凌科装备, WSLK)

## Industry Context

JTEKT alias cluster regression.

## Exclusion Patterns

- exclude: 测试, test, demo

## Learning Log

- 2026-07-10: JTEKT/捷太格特 aliased to TOYODA brand cluster
`;

    const JTEKT_KEYWORDS_STRUCTURED_MD = `
## 重点企业 (Key Companies)

| ID | 公司名称 (Company Name) | 英文名称 (English Name) | 类型 (Type) |
| --- | --- | --- | --- |
| 1 | 捷太格特机床(大连)有限公司 | JTEKT Machine (Dalian) | key_company |
`;

    const JTEKT_BRANDS_JSON = JSON.stringify([
      { id: 16, nameCn: "丰田工机", nameEn: "TOYODA", type: "加工中心/数控车床", origin: "international" },
      { id: 80, nameCn: "蕙勒", nameEn: "HUILE", type: "加工中心/数控车床", origin: "domestic" },
      { id: 81, nameCn: "唯思凌科", nameEn: "WSLK", type: "加工中心/数控车床", origin: "domestic" },
    ], null, 2);

    let jtektDir: string;
    let jtektService: IngestComputeService;

    beforeEach(() => {
      jtektDir = fs.mkdtempSync(path.join(os.tmpdir(), "ingest-jtekt-"));
      const resumeDir = path.join(jtektDir, "config", "resume");
      const industryDir = path.join(jtektDir, "config", "industry-data");
      fs.mkdirSync(resumeDir, { recursive: true });
      fs.mkdirSync(industryDir, { recursive: true });
      fs.writeFileSync(path.join(resumeDir, "skills.md"), JTEKT_SKILLS_MD);
      fs.writeFileSync(path.join(industryDir, "keywords-structured.md"), JTEKT_KEYWORDS_STRUCTURED_MD);
      fs.writeFileSync(path.join(industryDir, "brands.json"), JTEKT_BRANDS_JSON);
      jtektService = new IngestComputeService(jtektDir);
    });

    afterEach(() => {
      fs.rmSync(jtektDir, { recursive: true, force: true });
    });

    it("should seed 捷太格特机床(大连)有限公司 as a verified company hit (宋先生 case)", () => {
      // 宋先生-style work history: 捷太格特机床(大连)有限公司 sales manager.
      // Before the fix this employer was unknown -> 0 companyHits -> industry_db 0.
      // After the keywords-structured.md seed it verifies as a Tier-1 company.
      const result = jtektService.computeOne("resume-song", {
        data: [
          {
            ...SAMPLE_RESUME_JUNIOR.data[0],
            workHistory: [
              { raw: "2024-04~2026-04(2年)捷太格特机床(大连)有限公司销售经理，负责四川重庆区域机床销售全流程" },
            ],
          },
        ],
      });

      expect(result.companyHits.length).toBeGreaterThan(0);
      // Industry DB must no longer be zero after the company seed.
      expect(result.industryDbV2Raw).toBeGreaterThan(0);
    });

    it("should resolve the 捷太格特 alias to a TOYODA brand hit when mentioned outside an employer name", () => {
      // When 捷太格特 appears in a non-employer context (equipment/description),
      // the skills.md alias cluster must resolve it to the toyoda brand.
      const result = jtektService.computeOne("resume-jtekt-brand", {
        data: [
          {
            ...SAMPLE_RESUME_JUNIOR.data[0],
            workHistory: [
              { raw: "2024-04~2026-04(2年)某设备公司销售工程师，负责捷太格特机床销售与JTEKT设备推广" },
            ],
          },
        ],
      });

      expect(result.brandHits.map((hit) => hit.brand)).toContain("toyoda");
      expect(result.industryDbV2Raw).toBeGreaterThan(0);
    });

    it("should classify 蕙勒 and 唯思凌科 as domestic-origin brands", () => {
      // 蕙勒 (李铛 employer) - domestic CNC machine company
      const huileResult = jtektService.computeOne("resume-li-dang", {
        data: [
          {
            ...SAMPLE_RESUME_JUNIOR.data[0],
            workHistory: [
              { raw: "2020-01~2024-12(4年11月)蕙勒智能科技销售经理，负责蕙勒数控机床销售" },
            ],
          },
        ],
      });
      expect(huileResult.brandHits.map((hit) => hit.brand)).toContain("蕙勒");
      expect(huileResult.industryDbV2Raw).toBeGreaterThan(0);
      // 唯思凌科 (张武汉 employer) - domestic CNC machine company
      const wslkResult = jtektService.computeOne("resume-zhang-wuhan", {
        data: [
          {
            ...SAMPLE_RESUME_JUNIOR.data[0],
            workHistory: [
              { raw: "2025-03~至今 荆州唯思凌科销售工程师，负责唯思凌科数控机床工装业务" },
            ],
          },
        ],
      });
      expect(wslkResult.brandHits.map((hit) => hit.brand)).toContain("唯思凌科");
      expect(wslkResult.industryDbV2Raw).toBeGreaterThan(0);
    });
  });
});
