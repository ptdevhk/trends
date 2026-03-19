import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { describe, expect, it, beforeEach, afterEach } from "vitest";

import { buildWorkHistoryEvidence } from "@trends/shared";

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

    expect(result.experienceLevel).toBe("unknown");
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

  it("should build tag envelope with confidence and provenance", () => {
    const result = service.computeOne("resume-123", SAMPLE_RESUME_CNC_SALES);

    const industryTag = result.tagEnvelope.find((item) => item.tag === "industry:cnc");
    const roleTag = result.tagEnvelope.find((item) => item.tag === "role:sales");
    const companyTag = result.tagEnvelope.find((item) => item.tag === "company:star");
    const taggingIndustryTag = result.taggingEnvelope.entries.find((item) => item.tag === "industry:cnc");
    const taggingRoleTag = result.taggingEnvelope.entries.find((item) => item.tag === "role:sales");
    const taggingCompanyTag = result.taggingEnvelope.entries.find((item) => item.tag === "company:star");

    expect(Array.isArray(result.tagEnvelope)).toBe(true);
    expect(result.tagEnvelope.length).toBeGreaterThan(0);
    expect(result.taggingEnvelope.schemaVersion).toBe(1);
    expect(result.taggingEnvelope.generatedAt).toBeGreaterThan(0);
    expect(result.taggingEnvelope.entries.length).toBe(result.tagEnvelope.length);

    expect(industryTag).toBeDefined();
    expect(industryTag?.source).toBe("rule");
    expect(industryTag?.confidence).toBeGreaterThan(0);
    expect(industryTag?.version).toBe(42);

    expect(roleTag).toBeDefined();
    expect(roleTag?.source).toBe("rule");
    expect(roleTag?.evidence).toEqual(expect.arrayContaining(["roleType:sales"]));

    expect(companyTag).toBeUndefined();

    expect(taggingIndustryTag?.provenance.stage).toBe("industry_taxonomy");
    expect(taggingIndustryTag?.provenance.generatedBy).toBe("ingest-compute-service");
    expect(taggingRoleTag?.provenance.stage).toBe("role_signal_aggregation");
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
    expect(results[0].experienceLevel).toBe("unknown");
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

    expect(index.evidenceText).toBe(buildWorkHistoryEvidence(item).text);
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
});
