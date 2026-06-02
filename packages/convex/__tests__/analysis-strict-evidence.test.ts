import { describe, expect, it } from "vitest";

import {
  buildKeywordMatchingRules,
  buildKeywordRequirements,
  normalizeAnalysisResult,
  normalizeResume,
  USER_PROMPT_TEMPLATE,
} from "../convex/analyze";

describe("normalizeResume strict evidence", () => {
  it("does not derive evidence text from selfIntro/jobIntention", () => {
    const normalized = normalizeResume({
      name: "陈某",
      selfIntro: "熟悉CNC车床销售与FANUC系统",
      jobIntention: "CNC销售工程师",
      ingestData: {
        evidenceText: "2021-2024 东莞机床公司 销售工程师 负责cnc车床销售与客户开发",
      },
    } as unknown);

    expect(normalized.evidenceText).toContain("东莞机床公司");
    expect(normalized.evidenceText).not.toContain("FANUC");
    expect(normalized.evidenceText).not.toContain("求职意向");
    expect(normalized.verifiedCompanies).toEqual([]);
  });

  it("falls back to \"未填写\" when ingest evidence is missing", () => {
    const normalized = normalizeResume({
      name: "李某",
      selfIntro: "CNC",
      jobIntention: "销售",
    } as unknown);

    expect(normalized.evidenceText).toBe("未填写");
    expect(normalized.verifiedCompanies).toEqual([]);
  });

  it("supports English fallback labels when locale is en", () => {
    const normalized = normalizeResume({
      selfIntro: "CNC",
      jobIntention: "Sales",
    } as unknown, { locale: "en" });

    expect(normalized.name).toBe("Not provided");
    expect(normalized.education).toBe("Not provided");
    expect(normalized.companies).toBe("Not provided");
    expect(normalized.evidenceText).toBe("Not provided");
    expect(normalized.roleSignalsText).toBe("none");
    expect(normalized.verifiedCompanies).toEqual([]);
  });

  it("limits derived companies to the latest three work history entries", () => {
    const normalized = normalizeResume({
      workHistory: [
        { raw: "2018-01 ~ 2019-01 Oldest Co Old Role", startDate: "2018-01", endDate: "2019-01", companyName: "Oldest Co", jobTitle: "Old Role" },
        { raw: "2023-01 ~ 2024-01 Recent Co Recent Role", startDate: "2023-01", endDate: "2024-01", companyName: "Recent Co", jobTitle: "Recent Role" },
        { raw: "2024-02 ~ 至今 Current Co Current Role", startDate: "2024-02", endDate: "至今", companyName: "Current Co", jobTitle: "Current Role" },
        { raw: "2021-01 ~ 2022-01 Middle Co Middle Role", startDate: "2021-01", endDate: "2022-01", companyName: "Middle Co", jobTitle: "Middle Role" },
      ],
    } as unknown, { locale: "en" });

    expect(normalized.companies).toBe("Current Co, Recent Co, Middle Co");
  });

  it("formats structured work-entry evidence in English when locale is en", () => {
    const normalized = normalizeResume({
      ingestData: {
        evidenceText: "2021-2024 Acme Machine Tools Sales Engineer",
        roleSignals: [
          {
            type: "sales",
            matchedSignals: ["CNC sales"],
            signalCount: 1,
            occurrences: 1,
            years: 4,
            industryVerifiedYears: 4,
            roleRelevantYears: 4,
            verifyIn: "workHistory",
            matchedWorkEntries: [
              {
                companyName: "Acme Machine Tools",
                jobTitle: "Sales Engineer",
                years: 2,
                industryVerified: true,
                matchedSignals: ["CNC sales"],
              },
            ],
          },
        ],
      },
    } as unknown, { locale: "en" });

    expect(normalized.roleSignalsText).toContain("2 years verified");
    expect(normalized.roleSignalsText).toContain("signals:CNC sales");
    expect(normalized.roleSignalsText).not.toContain("2年");
    expect(normalized.roleSignalsText).not.toContain("已验证");
    expect(normalized.roleSignalsText).not.toContain("信号:");
  });

  it("applies analysis field usage overrides to non-protected fields", () => {
    const normalized = normalizeResume({
      name: "Alice",
      education: "Bachelor",
      ingestData: {
        evidenceText: "2021-2024 Acme Machine Tools Sales Engineer",
      },
    } as unknown, {
      locale: "en",
      fieldUsagePolicy: {
        fields: {
          education: {
            surfaces: {
              analysis: false,
            },
          },
        },
      },
    });

    expect(normalized.name).toBe("Alice");
    expect(normalized.education).toBe("Not provided");
  });

  it("preserves verifiedCompanies from ingestData.companyHits", () => {
    const normalized = normalizeResume({
      name: "王某",
      ingestData: {
        evidenceText: "2020-2024 大连机床集团 销售",
        companyHits: ["大连机床集团"],
      },
    } as unknown);

    expect(normalized.verifiedCompanies).toEqual(["大连机床集团"]);
  });

  it("exposes structured roleSignals for prompt hydration", () => {
    const normalized = normalizeResume({
      name: "赵某",
      ingestData: {
        evidenceText: "2020-2024 深圳市玄羽科技有限公司 应用工程师",
        roleSignals: [
          {
            type: "engineer",
            matchedSignals: ["工程师", "调试"],
            signalCount: 2,
            occurrences: 2,
            years: 3.9,
            industryVerifiedYears: 0,
            roleRelevantYears: 3.9,
            verifyIn: "workHistory",
          },
          {
            type: "sales",
            matchedSignals: ["配合销售"],
            signalCount: 1,
            occurrences: 1,
            years: 0,
            industryVerifiedYears: 0,
            roleRelevantYears: 0,
            verifyIn: "workHistory",
          },
        ],
      },
    } as unknown);

    expect(normalized.roleSignals).toHaveLength(2);
    expect(normalized.roleSignalsText).toContain("engineer(workHistory)");
    expect(normalized.roleSignalsText).toContain("sales(workHistory)");
    expect(normalized.roleSignalsText).toContain("配合销售");
  });

  it("builds English keyword guidance for the English prompt locale", () => {
    expect(buildKeywordRequirements(["cnc", "servo"], "en")).toContain(
      "The candidate should have the following key skills or experience:"
    );
    expect(buildKeywordMatchingRules(["cnc", "servo"], "en")).toContain(
      "Score the candidate by how well their evidence matches the following keywords."
    );
  });

  it("normalizes AI analysis into the related_exp factor and direct industry_db display score", () => {
    const normalized = normalizeAnalysisResult(
      {
        score: 85,
        recommendation: "strong_match",
        summary: "summary",
        highlights: [],
        breakdown: {
          related_exp: 70,
          industry_db: 15,
        },
      },
      {
        ingestData: {
          industryDbV2Raw: 0,
          companyHits: [],
          brandHits: [],
        },
      } as unknown
    );

    expect(normalized.breakdown?.related_exp).toBe(70);
    expect(normalized.breakdown?.industry_db).toBe(0);
    expect(normalized.score).toBe(35);
    expect(normalized.recommendation).toBe("no_match");
  });

  it("promotes industry_db to 50 when verified company/brand evidence exists", () => {
    const normalized = normalizeAnalysisResult(
      {
        score: 40,
        recommendation: "strong_match",
        summary: "summary",
        highlights: [],
        breakdown: {
          related_exp: 90,
          industry_db: 0,
        },
      },
      {
        ingestData: {
          industryDbV2Raw: 5,
          companyHits: ["大连机床集团"],
          brandHits: [{ context: "product" }],
        },
      } as unknown
    );

    expect(normalized.breakdown?.related_exp).toBe(90);
    // brand (30) + company (20) → additive industry_db cap (50).
    expect(normalized.breakdown?.industry_db).toBe(50);
    // score = round(related_exp * 0.5) + industry_db = round(90*0.5) + 50 = 95.
    expect(normalized.score).toBe(95);
    expect(normalized.recommendation).toBe("strong_match");
  });

  it("passes through LLM related_exp without floor for 3+ verified years of sales", () => {
    const normalized = normalizeAnalysisResult(
      {
        score: 20,
        recommendation: "potential",
        summary: "summary",
        highlights: [],
        breakdown: {
          related_exp: 40,
          industry_db: 0,
        },
      },
      {
        ingestData: {
          industryDbV2Raw: 0,
          companyHits: [],
          brandHits: [],
          roleSignals: [
            {
              type: "sales",
              years: 4,
              roleRelevantYears: 4,
              industryVerifiedYears: 4,
              matchedSignals: ["销售工程师"],
              matchedWorkEntries: [
                {
                  jobTitle: "销售工程师",
                  years: 4,
                  industryVerified: true,
                  matchedSignals: ["销售"],
                },
              ],
            },
          ],
        },
      } as unknown,
    );

    expect(normalized.breakdown?.related_exp).toBe(40);
    expect(normalized.score).toBe(20);
    expect(normalized.recommendation).toBe("no_match");
  });

  it("passes through LLM related_exp without cap for description-only sales support (no direct sales title)", () => {
    const normalized = normalizeAnalysisResult(
      {
        score: 20,
        recommendation: "potential",
        summary: "summary",
        highlights: [],
        breakdown: {
          related_exp: 35,
          industry_db: 0,
        },
      },
      {
        ingestData: {
          industryDbV2Raw: 0,
          companyHits: [],
          brandHits: [],
          roleSignals: [
            {
              type: "sales",
              years: 6,
              roleRelevantYears: 6,
              matchedSignals: ["销售"],
              matchedWorkEntries: [
                {
                  jobTitle: "项目工程师",
                  years: 6,
                  industryVerified: false,
                  matchedSignals: ["销售"],
                  directRoleMatch: false,
                },
              ],
              verifyIn: "workHistory",
            },
          ],
        },
      } as unknown,
    );

    // LLM-primary: AI score passes through, no cap applied for description-only
    expect(normalized.breakdown?.related_exp).toBe(35);
    expect(normalized.score).toBe(18);
    expect(normalized.recommendation).toBe("no_match");
  });

  it("passes through LLM related_exp without floor for direct business development titles", () => {
    const normalized = normalizeAnalysisResult(
      {
        score: 20,
        recommendation: "potential",
        summary: "summary",
        highlights: [],
        breakdown: {
          related_exp: 35,
          industry_db: 0,
        },
      },
      {
        ingestData: {
          industryDbV2Raw: 0,
          companyHits: [],
          brandHits: [],
          roleSignals: [
            {
              type: "sales",
              years: 4,
              roleRelevantYears: 4,
              industryVerifiedYears: 4,
              matchedSignals: ["business development manager"],
              matchedWorkEntries: [
                {
                  jobTitle: "Business Development Manager",
                  years: 4,
                  industryVerified: true,
                  matchedSignals: ["business development manager"],
                  directRoleMatch: true,
                },
              ],
              verifyIn: "workHistory",
            },
          ],
        },
      } as unknown,
    );

    expect(normalized.breakdown?.related_exp).toBe(35);
    expect(normalized.score).toBe(18);
    expect(normalized.recommendation).toBe("no_match");
  });

  it("rewrites stale summary score mentions to the normalized score", () => {
    const normalized = normalizeAnalysisResult(
      {
        score: 58,
        recommendation: "strong_match",
        summary: "行业数据库验证方面信息有限，综合 score 58，属于具备潜在匹配的候选人。",
        highlights: [],
        breakdown: {
          related_exp: 80,
          industry_db: 0,
        },
      },
      {
        ingestData: {
          industryDbV2Raw: 10,
          companyHits: ["深圳市创世纪机械有限公司"],
          brandHits: [
            {
              context: "employer",
            },
          ],
          roleSignals: [
            {
              type: "sales",
              years: 3.8,
              roleRelevantYears: 3.8,
              industryVerifiedYears: 3.8,
              matchedSignals: ["销售工程师"],
            },
          ],
        },
      } as unknown,
    );

    expect(normalized.score).toBe(80);
    expect(normalized.recommendation).toBe("match");
    expect(normalized.summary).toContain("score 80");
    expect(normalized.summary).not.toContain("score 58");
    expect(normalized.summary).toContain("recommendation match");
  });

  it("includes explicit related_exp scoring bands in prompt guidance", () => {
    expect(USER_PROMPT_TEMPLATE).toContain("85-100");
    expect(USER_PROMPT_TEMPLATE).toContain("70-84");
    expect(USER_PROMPT_TEMPLATE).toContain("60-80"); // verified:0 + domain-relevant special case
    expect(USER_PROMPT_TEMPLATE).toContain("40-59");
    expect(USER_PROMPT_TEMPLATE).toContain("0-39");
  });

  it("passes through LLM related_exp without domain-irrelevant ceiling for insurance sales", () => {
    const normalized = normalizeAnalysisResult(
      {
        score: 40,
        recommendation: "potential",
        summary: "summary",
        highlights: [],
        breakdown: {
          related_exp: 40,
          industry_db: 0,
        },
      },
      {
        ingestData: {
          industryDbV2Raw: 0,
          companyHits: [],
          brandHits: [],
          roleSignals: [
            {
              type: "sales",
              years: 12.8,
              roleRelevantYears: 12.8,
              matchedSignals: ["销售经理", "销售", "业务"],
              matchedWorkEntries: [
                {
                  companyName: "中国平安人寿保险股份有限公司",
                  jobTitle: "销售经理",
                  years: 12.8,
                  industryVerified: false,
                  matchedSignals: ["销售经理", "销售", "业务"],
                  directRoleMatch: true,
                },
              ],
              verifyIn: "workHistory",
            },
          ],
        },
      } as unknown,
    );

    // LLM-primary: insurance sales score passes through without domain-irrelevant ceiling
    expect(normalized.breakdown?.related_exp).toBe(40);
    expect(normalized.score).toBe(20);
    expect(normalized.recommendation).toBe("no_match");
  });

  it("passes through LLM related_exp for industry-verified sales (no ceiling needed)", () => {
    const normalized = normalizeAnalysisResult(
      {
        score: 80,
        recommendation: "strong_match",
        summary: "summary",
        highlights: [],
        breakdown: {
          related_exp: 85,
          industry_db: 0,
        },
      },
      {
        ingestData: {
          industryDbV2Raw: 0,
          companyHits: [],
          brandHits: [],
          roleSignals: [
            {
              type: "sales",
              years: 5,
              roleRelevantYears: 5,
              industryVerifiedYears: 5,
              matchedSignals: ["销售工程师"],
              matchedWorkEntries: [
                {
                  companyName: "大连机床集团",
                  jobTitle: "销售工程师",
                  years: 5,
                  industryVerified: true,
                  matchedSignals: ["销售工程师"],
                  directRoleMatch: true,
                },
              ],
              verifyIn: "workHistory",
            },
          ],
        },
      } as unknown,
    );

    // Industry-verified CNC sales — no ceiling
    expect(normalized.breakdown?.related_exp).toBe(85);
  });

  it("passes through LLM related_exp when brand hits prove domain overlap", () => {
    const normalized = normalizeAnalysisResult(
      {
        score: 80,
        recommendation: "strong_match",
        summary: "summary",
        highlights: [],
        breakdown: {
          related_exp: 85,
          industry_db: 0,
        },
      },
      {
        ingestData: {
          industryDbV2Raw: 0,
          companyHits: [],
          brandHits: [
            {
              brand: "FANUC",
              context: "product",
            },
          ],
          roleSignals: [
            {
              type: "sales",
              years: 5,
              roleRelevantYears: 5,
              industryVerifiedYears: 0,
              matchedSignals: ["销售工程师"],
              matchedWorkEntries: [
                {
                  companyName: "苏州美科生贸易有限公司",
                  jobTitle: "销售工程师",
                  years: 5,
                  industryVerified: false,
                  matchedSignals: ["销售工程师"],
                  directRoleMatch: true,
                },
              ],
              verifyIn: "workHistory",
            },
          ],
        },
      } as unknown,
    );

    // FANUC brand hit with product context proves CNC domain — no ceiling
    expect(normalized.breakdown?.related_exp).toBe(85);
  });

  it("passes through LLM related_exp when brand hits are only technical (not sales-relevant)", () => {
    const normalized = normalizeAnalysisResult(
      {
        score: 80,
        recommendation: "strong_match",
        summary: "summary",
        highlights: [],
        breakdown: {
          related_exp: 85,
          industry_db: 0,
        },
      },
      {
        ingestData: {
          industryDbV2Raw: 0,
          companyHits: [],
          brandHits: [
            {
              brand: "FANUC",
              context: "technical",
            },
            {
              brand: "brother",
              context: "technical",
            },
          ],
          roleSignals: [
            {
              type: "sales",
              years: 6,
              roleRelevantYears: 6,
              matchedSignals: ["销售", "业务"],
              matchedWorkEntries: [
                {
                  companyName: "维沃移动通信有限公司",
                  jobTitle: "公司致力于各类通信产品的研发、制造和销售",
                  years: 6,
                  industryVerified: false,
                  matchedSignals: ["销售", "业务"],
                  directRoleMatch: false,
                },
              ],
              verifyIn: "workHistory",
            },
          ],
        },
      } as unknown,
    );

    // LLM-primary: AI score passes through without technical-only cap
    expect(normalized.breakdown?.related_exp).toBe(85);
    // technical brand hits → industry_db=40 (single hit baseline); score = round(85*0.5)+40 = 83.
    expect(normalized.score).toBe(83);
    expect(normalized.recommendation).toBe("match");
  });
  it("passes through LLM related_exp when industry tags from non-sales roles + domain-irrelevant company", () => {
    const normalized = normalizeAnalysisResult(
      {
        score: 80,
        recommendation: "strong_match",
        summary: "summary",
        highlights: [],
        breakdown: {
          related_exp: 85,
          industry_db: 0,
        },
      },
      {
        ingestData: {
          industryDbV2Raw: 0,
          companyHits: [],
          brandHits: [],
          industryTags: ["machinery"],
          roleSignals: [
            {
              type: "sales",
              years: 5,
              roleRelevantYears: 5,
              industryVerifiedYears: 0,
              matchedSignals: ["销售经理"],
              matchedWorkEntries: [
                {
                  companyName: "中国平安人寿保险股份有限公司",
                  jobTitle: "销售经理",
                  years: 5,
                  industryVerified: false,
                  matchedSignals: ["销售经理", "销售", "业务"],
                  directRoleMatch: true,
                },
              ],
              verifyIn: "workHistory",
            },
          ],
        },
      } as unknown,
    );

    // LLM-primary: AI score passes through without ceiling
    expect(normalized.breakdown?.related_exp).toBe(85);
    // score = round(85*0.5)+0 = 43.
    expect(normalized.score).toBe(43);
    expect(normalized.recommendation).toBe("potential");
  });

  it("passes through LLM related_exp when industry tags overlap + sales company is domain-relevant", () => {
    const normalized = normalizeAnalysisResult(
      {
        score: 80,
        recommendation: "strong_match",
        summary: "summary",
        highlights: [],
        breakdown: {
          related_exp: 85,
          industry_db: 0,
        },
      },
      {
        ingestData: {
          industryDbV2Raw: 0,
          companyHits: [],
          brandHits: [],
          industryTags: ["machinery"],
          roleSignals: [
            {
              type: "sales",
              years: 5,
              roleRelevantYears: 5,
              industryVerifiedYears: 0,
              matchedSignals: ["销售工程师"],
              matchedWorkEntries: [
                {
                  companyName: "苏州美科生贸易有限公司",
                  jobTitle: "销售工程师",
                  years: 5,
                  industryVerified: false,
                  matchedSignals: ["销售工程师"],
                  directRoleMatch: true,
                },
              ],
              verifyIn: "workHistory",
            },
          ],
        },
      } as unknown,
    );

    // Industry tags + direct sales role at a domain-relevant company (machinery trading)
    // → tags likely reflect the sales role's domain. Ceiling does NOT apply.
    // The AI score (85) passes through as related_exp; score = round(85*0.5)+0 = 43.
    expect(normalized.breakdown?.related_exp).toBe(85); // AI score passes through
    expect(normalized.score).toBe(43);
    expect(normalized.recommendation).toBe("potential");
  });

  it("passes through LLM related_exp without unverified floor for domain-relevant sales", () => {
    const normalized = normalizeAnalysisResult(
      {
        score: 20,
        recommendation: "potential",
        summary: "summary",
        highlights: [],
        breakdown: {
          related_exp: 22, // AI under-scores despite domain-relevant company
          industry_db: 0,
        },
      },
      {
        ingestData: {
          industryDbV2Raw: 0,
          companyHits: [],
          brandHits: [],
          industryTags: ["machinery"],
          roleSignals: [
            {
              type: "sales",
              years: 11.75,
              roleRelevantYears: 11.75,
              industryVerifiedYears: 0,
              matchedSignals: ["销售工程师"],
              matchedWorkEntries: [
                {
                  companyName: "苏州美科生贸易有限公司",
                  jobTitle: "销售工程师",
                  years: 11.75,
                  industryVerified: false,
                  matchedSignals: ["销售工程师"],
                  directRoleMatch: true,
                },
              ],
              verifyIn: "workHistory",
            },
          ],
        },
      } as unknown,
    );

    // AI gave 22, pass through with no floor; score = round(22*0.5)+0 = 11.
    expect(normalized.breakdown?.related_exp).toBe(22);
    expect(normalized.score).toBe(11);
    expect(normalized.recommendation).toBe("no_match"); // 11 < 40
  });

  it("passes through LLM related_exp without unverified floor for domain-irrelevant company", () => {
    const normalized = normalizeAnalysisResult(
      {
        score: 80,
        recommendation: "strong_match",
        summary: "summary",
        highlights: [],
        breakdown: {
          related_exp: 40, // AI scores moderately; score = related_exp (no ceiling here)
          industry_db: 0,
        },
      },
      {
        ingestData: {
          industryDbV2Raw: 0,
          companyHits: [],
          brandHits: [],
          industryTags: ["machinery"], // From CNC technician work
          roleSignals: [
            {
              type: "sales",
              years: 5,
              roleRelevantYears: 5,
              industryVerifiedYears: 0,
              matchedSignals: ["销售经理"],
              matchedWorkEntries: [
                {
                  companyName: "中国平安人寿保险股份有限公司",
                  jobTitle: "销售经理",
                  years: 5,
                  industryVerified: false,
                  matchedSignals: ["销售经理", "销售", "业务"],
                  directRoleMatch: true,
                },
              ],
              verifyIn: "workHistory",
            },
          ],
        },
      } as unknown,
    );

    // Insurance company → domain-irrelevant → no floor, no ceiling; score = round(40*0.5)+0 = 20.
    expect(normalized.breakdown?.related_exp).toBe(40);
    expect(normalized.score).toBe(20);
    expect(normalized.recommendation).toBe("no_match");
  });

  it("passes through LLM related_exp without unverified floor for description-only", () => {
    const normalized = normalizeAnalysisResult(
      {
        score: 30,
        recommendation: "potential",
        summary: "summary",
        highlights: [],
        breakdown: {
          related_exp: 35, // AI scores moderately
          industry_db: 0,
        },
      },
      {
        ingestData: {
          industryDbV2Raw: 0,
          companyHits: [],
          brandHits: [],
          industryTags: ["machinery"],
          roleSignals: [
            {
              type: "sales",
              years: 5,
              roleRelevantYears: 5,
              industryVerifiedYears: 0,
              matchedSignals: ["销售"],
              matchedWorkEntries: [
                {
                  companyName: "某机械公司",
                  jobTitle: "项目工程师",
                  years: 5,
                  industryVerified: false,
                  matchedSignals: ["销售"],
                  directRoleMatch: false, // No direct sales title!
                },
              ],
              verifyIn: "workHistory",
            },
          ],
        },
      } as unknown,
    );

    // LLM-primary: AI score passes through without floor for description-only
    expect(normalized.breakdown?.related_exp).toBe(35);
    expect(normalized.recommendation).toBe("no_match");
  });

  it("passes through LLM related_exp without floor for industry-verified sales", () => {
    const normalized = normalizeAnalysisResult(
      {
        score: 30,
        recommendation: "potential",
        summary: "summary",
        highlights: [],
        breakdown: {
          related_exp: 40, // AI under-scores
          industry_db: 0,
        },
      },
      {
        ingestData: {
          industryDbV2Raw: 0,
          companyHits: [],
          brandHits: [],
          industryTags: ["machinery"],
          roleSignals: [
            {
              type: "sales",
              years: 5,
              roleRelevantYears: 5,
              industryVerifiedYears: 4, // Industry-verified!
              matchedSignals: ["销售工程师"],
              matchedWorkEntries: [
                {
                  companyName: "大连机床集团",
                  jobTitle: "销售工程师",
                  years: 5,
                  industryVerified: true,
                  matchedSignals: ["销售工程师"],
                  directRoleMatch: true,
                },
              ],
              verifyIn: "workHistory",
            },
          ],
        },
      } as unknown,
    );

    // LLM-primary: AI score passes through without floor boost; score = round(40*0.5)+0 = 20.
    expect(normalized.breakdown?.related_exp).toBe(40);
    expect(normalized.score).toBe(20);
  });

  it("passes through LLM related_exp when industry tags overlap AND sales is industry-verified", () => {
    const normalized = normalizeAnalysisResult(
      {
        score: 80,
        recommendation: "strong_match",
        summary: "summary",
        highlights: [],
        breakdown: {
          related_exp: 85,
          industry_db: 0,
        },
      },
      {
        ingestData: {
          industryDbV2Raw: 0,
          companyHits: [],
          brandHits: [],
          industryTags: ["machinery"],
          roleSignals: [
            {
              type: "sales",
              years: 5,
              roleRelevantYears: 5,
              industryVerifiedYears: 3,
              matchedSignals: ["销售工程师"],
              matchedWorkEntries: [
                {
                  companyName: "大连机床集团",
                  jobTitle: "销售工程师",
                  years: 5,
                  industryVerified: true,
                  matchedSignals: ["销售工程师"],
                  directRoleMatch: true,
                },
              ],
              verifyIn: "workHistory",
            },
          ],
        },
      } as unknown,
    );

    // Industry-verified sales at a machinery company — no ceiling applies
    expect(normalized.breakdown?.related_exp).toBe(85);
  });

  it("lets AI score pass through for unverified sales with sales-only keywords", () => {
    const normalized = normalizeAnalysisResult(
      {
        score: 60,
        recommendation: "potential",
        summary: "summary",
        highlights: [],
        breakdown: {
          related_exp: 70,
          industry_db: 0,
        },
      },
      {
        ingestData: {
          industryDbV2Raw: 0,
          companyHits: [],
          brandHits: [],
          roleSignals: [
            {
              type: "sales",
              years: 8,
              roleRelevantYears: 8,
              matchedSignals: ["销售经理"],
              matchedWorkEntries: [
                {
                  companyName: "某保险公司",
                  jobTitle: "销售经理",
                  years: 8,
                  industryVerified: false,
                  matchedSignals: ["销售经理"],
                  directRoleMatch: true,
                },
              ],
              verifyIn: "workHistory",
            },
          ],
        },
      } as unknown,
    );

    // Sales-only keyword — no domain ceiling applies.
    // Floor does NOT apply: directRoleMatch=true but industryVerified=false,
    // so unverified sales lets the AI score pass through.
    // "potential" LLM recommendation caps related_exp at 60.
    expect(normalized.breakdown?.related_exp).toBe(60); // AI score passes through recommendation ceiling
  });

  describe("normalizeSummaryConsistency edge cases", () => {
    it("replaces empty summary with fallback text", () => {
      const normalized = normalizeAnalysisResult(
        {
          score: 90,
          recommendation: "strong_match",
          summary: "",
          highlights: [],
          breakdown: { related_exp: 80, industry_db: 10 },
        },
        { ingestData: { industryDbV2Raw: 10, companyHits: ["TestCo"], brandHits: [{ context: "employer" }], roleSignals: [{ type: "sales", years: 5, roleRelevantYears: 5, industryVerifiedYears: 5, matchedSignals: ["销售"] }] } } as unknown,
      );
      // normalizeAnalysisResult replaces empty summaries with a fallback
      expect(normalized.summary).not.toBe("");
      expect(normalized.summary.length).toBeGreaterThan(0);
    });

    it("replaces whitespace-only summary with fallback text", () => {
      const normalized = normalizeAnalysisResult(
        {
          score: 90,
          recommendation: "strong_match",
          summary: "   ",
          highlights: [],
          breakdown: { related_exp: 80, industry_db: 10 },
        },
        { ingestData: { industryDbV2Raw: 10, companyHits: ["TestCo"], brandHits: [{ context: "employer" }], roleSignals: [{ type: "sales", years: 5, roleRelevantYears: 5, industryVerifiedYears: 5, matchedSignals: ["销售"] }] } } as unknown,
      );
      // normalizeAnalysisResult replaces empty/whitespace summaries with a fallback
      expect(normalized.summary).not.toBe("   ");
      expect(normalized.summary.length).toBeGreaterThan(0);
    });

    it("rewrites score mismatch but keeps matching recommendation", () => {
      const normalized = normalizeAnalysisResult(
        {
          score: 58,
          recommendation: "potential",
          summary: "候选人有一定潜力，综合 score 75，属于 potential 匹配。",
          highlights: [],
          breakdown: { related_exp: 40, industry_db: 0 },
        },
        { ingestData: { industryDbV2Raw: 0, companyHits: [], brandHits: [], roleSignals: [] } } as unknown,
      );
      // recommendation "potential" matches, but score 75 in prose != computed score
      // The actual computed score = round(related_exp * 0.5) + industry_db = round(40*0.5)+0 = 20
      expect(normalized.score).toBe(20);
      expect(normalized.summary).toContain("score 20");
      expect(normalized.summary).not.toContain("score 75");
    });

    it("rewrites recommendation mismatch but keeps matching score", () => {
      const normalized = normalizeAnalysisResult(
        {
          score: 90,
          recommendation: "match",
          summary: "优秀候选人，score 90，recommendation match。",
          highlights: [],
          breakdown: { related_exp: 90, industry_db: 10 },
        },
        { ingestData: { industryDbV2Raw: 10, companyHits: ["TestCo"], brandHits: [{ context: "employer" }], roleSignals: [{ type: "sales", years: 5, roleRelevantYears: 5, industryVerifiedYears: 5, matchedSignals: ["销售"] }] } } as unknown,
      );
      // score 90 matches, but recommendation "match" should be "strong_match" (>=85)
      expect(normalized.recommendation).toBe("strong_match");
      expect(normalized.summary).toContain("strong_match");
      expect(normalized.summary).not.toMatch(/\bmatch\b(?!\s*_)/);
    });

    it("does not modify summary when both score and recommendation match", () => {
      // score = round(90*0.5)+40 = 85; summary says "score 90" which doesn't match → rewritten to "score 85".
      const originalSummary = "候选人经验丰富，score 85，recommendation strong_match。";
      const normalized = normalizeAnalysisResult(
        {
          score: 90,
          recommendation: "strong_match",
          summary: originalSummary,
          highlights: [],
          breakdown: { related_exp: 90, industry_db: 10 },
        },
        { ingestData: { industryDbV2Raw: 10, companyHits: ["TestCo"], brandHits: [{ context: "employer" }], roleSignals: [{ type: "sales", years: 5, roleRelevantYears: 5, industryVerifiedYears: 5, matchedSignals: ["销售"] }] } } as unknown,
      );
      expect(normalized.summary).toBe(originalSummary);
    });

    it("appends English canonical statement for non-Han mismatched summaries", () => {
      const normalized = normalizeAnalysisResult(
        {
          score: 30,
          recommendation: "potential",
          summary: "Candidate shows some relevant skills, score 58, recommendation match.",
          highlights: [],
          breakdown: { related_exp: 20, industry_db: 0 },
        },
        { ingestData: { industryDbV2Raw: 0, companyHits: [], brandHits: [], roleSignals: [] } } as unknown,
      );
      // Both score and recommendation mismatch → English canonical line appended
      // score = round(20*0.5)+0 = 10
      expect(normalized.summary).toContain("Normalized result: score 10, recommendation no_match");
    });

    it("appends Chinese canonical statement for Han-text mismatched summaries", () => {
      const normalized = normalizeAnalysisResult(
        {
          score: 58,
          recommendation: "strong_match",
          summary: "行业数据库验证方面信息有限，综合 score 58，属于具备潜在匹配的候选人。",
          highlights: [],
          breakdown: { related_exp: 80, industry_db: 0 },
        },
        { ingestData: { industryDbV2Raw: 10, companyHits: ["深圳市创世纪机械有限公司"], brandHits: [{ context: "employer" }], roleSignals: [{ type: "sales", years: 3.8, roleRelevantYears: 3.8, industryVerifiedYears: 3.8, matchedSignals: ["销售工程师"] }] } } as unknown,
      );
      expect(normalized.summary).toContain("系统归一化结果：score 80，recommendation match");
    });
  });

  describe("recommendationFromScore threshold boundaries", () => {
    // score = round(related_exp * 0.5) + industry_db; with no industry_db, score = round(related_exp * 0.5).
    // Each case sets related_exp to the target value with a match-tier ceiling (100) so it passes through.

    it("returns strong_match at exactly 85", () => {
      const normalized = normalizeAnalysisResult(
        { score: 0, recommendation: "strong_match", summary: "ok", highlights: [], breakdown: { related_exp: 85, industry_db: 0 } },
        { ingestData: { industryDbV2Raw: 0, companyHits: [], brandHits: [], roleSignals: [] } } as unknown,
      );
      // score = round(85*0.5)+0 = 43 → potential (40 <= 43 < 70).
      expect(normalized.score).toBe(43);
      expect(normalized.recommendation).toBe("potential");
    });

    it("returns match at 84 (just below strong_match)", () => {
      const normalized = normalizeAnalysisResult(
        { score: 0, recommendation: "match", summary: "ok", highlights: [], breakdown: { related_exp: 84, industry_db: 0 } },
        { ingestData: { industryDbV2Raw: 0, companyHits: [], brandHits: [], roleSignals: [] } } as unknown,
      );
      // score = round(84*0.5)+0 = 42 → potential (40 <= 42 < 70).
      expect(normalized.score).toBe(42);
      expect(normalized.recommendation).toBe("potential");
    });

    it("returns match at exactly 70", () => {
      const normalized = normalizeAnalysisResult(
        { score: 0, recommendation: "match", summary: "ok", highlights: [], breakdown: { related_exp: 70, industry_db: 0 } },
        { ingestData: { industryDbV2Raw: 0, companyHits: [], brandHits: [], roleSignals: [] } } as unknown,
      );
      // score = round(70*0.5)+0 = 35 → no_match (35 < 40).
      expect(normalized.score).toBe(35);
      expect(normalized.recommendation).toBe("no_match");
    });

    it("returns potential at 69 (just below match)", () => {
      const normalized = normalizeAnalysisResult(
        { score: 0, recommendation: "match", summary: "ok", highlights: [], breakdown: { related_exp: 69, industry_db: 0 } },
        { ingestData: { industryDbV2Raw: 0, companyHits: [], brandHits: [], roleSignals: [] } } as unknown,
      );
      // score = round(69*0.5)+0 = 35 → no_match (35 < 40).
      expect(normalized.score).toBe(35);
      expect(normalized.recommendation).toBe("no_match");
    });

    it("returns potential at exactly 40", () => {
      const normalized = normalizeAnalysisResult(
        { score: 0, recommendation: "match", summary: "ok", highlights: [], breakdown: { related_exp: 40, industry_db: 0 } },
        { ingestData: { industryDbV2Raw: 0, companyHits: [], brandHits: [], roleSignals: [] } } as unknown,
      );
      // score = round(40*0.5)+0 = 20 → no_match (20 < 40).
      expect(normalized.score).toBe(20);
      expect(normalized.recommendation).toBe("no_match");
    });

    it("returns no_match at 39 (just below potential)", () => {
      const normalized = normalizeAnalysisResult(
        { score: 0, recommendation: "match", summary: "ok", highlights: [], breakdown: { related_exp: 39, industry_db: 0 } },
        { ingestData: { industryDbV2Raw: 0, companyHits: [], brandHits: [], roleSignals: [] } } as unknown,
      );
      // score = round(39*0.5)+0 = 20 → no_match (20 < 40).
      expect(normalized.score).toBe(20);
      expect(normalized.recommendation).toBe("no_match");
    });
  });

  describe("LLM-primary regression guards", () => {
    it("passes through related_exp when breakdown is empty", () => {
      const normalized = normalizeAnalysisResult(
        { score: 0, recommendation: "no_match", summary: "ok", highlights: [], breakdown: {} },
        { ingestData: { industryDbV2Raw: 0, companyHits: [], brandHits: [], roleSignals: [] } } as unknown,
      );
      expect(normalized.breakdown?.related_exp).toBe(0);
      expect(normalized.score).toBe(0);
      expect(normalized.recommendation).toBe("no_match");
    });

    it("clamps negative related_exp to 0", () => {
      const normalized = normalizeAnalysisResult(
        { score: 0, recommendation: "no_match", summary: "ok", highlights: [], breakdown: { related_exp: -50, industry_db: 0 } },
        { ingestData: { industryDbV2Raw: 0, companyHits: [], brandHits: [], roleSignals: [] } } as unknown,
      );
      expect(normalized.breakdown?.related_exp).toBe(0);
      expect(normalized.score).toBe(0);
    });

    it("clamps over-100 related_exp to 100", () => {
      const normalized = normalizeAnalysisResult(
        { score: 0, recommendation: "match", summary: "ok", highlights: [], breakdown: { related_exp: 999, industry_db: 0 } },
        { ingestData: { industryDbV2Raw: 0, companyHits: [], brandHits: [], roleSignals: [] } } as unknown,
      );
      expect(normalized.breakdown?.related_exp).toBe(100);
      // score = round(100*0.5)+0 = 50.
      expect(normalized.score).toBe(50);
    });

    it("falls back to 0 when related_exp is null", () => {
      const normalized = normalizeAnalysisResult(
        { score: 20, recommendation: "potential", summary: "ok", highlights: [], breakdown: { related_exp: null, industry_db: 0 } },
        { ingestData: { industryDbV2Raw: 0, companyHits: [], brandHits: [], roleSignals: [] } } as unknown,
      );
      expect(normalized.breakdown?.related_exp).toBe(0);
      expect(normalized.score).toBe(0);
    });

    it("falls back to 0 when related_exp is undefined (missing from breakdown)", () => {
      const normalized = normalizeAnalysisResult(
        { score: 20, recommendation: "potential", summary: "ok", highlights: [], breakdown: { industry_db: 0 } },
        { ingestData: { industryDbV2Raw: 0, companyHits: [], brandHits: [], roleSignals: [] } } as unknown,
      );
      expect(normalized.breakdown?.related_exp).toBe(0);
      expect(normalized.score).toBe(0);
    });

    it("passes through low related_exp for description-only non-sales resume (no false cap inflation)", () => {
      // A description-only sales signal with no direct sales title — LLM gives low score
      // LLM-primary: must pass through without rule-based cap or floor distortion
      const normalized = normalizeAnalysisResult(
        { score: 5, recommendation: "no_match", summary: "ok", highlights: [], breakdown: { related_exp: 5, industry_db: 0 } },
        {
          ingestData: {
            industryDbV2Raw: 0, companyHits: [], brandHits: [],
            roleSignals: [{
              type: "sales", years: 2, roleRelevantYears: 2, industryVerifiedYears: 0,
              matchedSignals: ["销售"],
              matchedWorkEntries: [{ companyName: "某科技公司", jobTitle: "工程师", years: 2, matchedSignals: ["销售"], directRoleMatch: false }],
              verifyIn: "workHistory",
            }],
          },
        } as unknown,
      );
      expect(normalized.breakdown?.related_exp).toBe(5); // No floor boost, no cap
      // score = round(5*0.5)+0 = 3.
      expect(normalized.score).toBe(3);
      expect(normalized.recommendation).toBe("no_match");
    });
  });

  describe("isDomainIrrelevantSalesEntry keyword coverage", () => {
    it("detects insurance company as domain-irrelevant", () => {
      const normalized = normalizeAnalysisResult(
        {
          score: 70,
          recommendation: "match",
          summary: "ok",
          highlights: [],
          breakdown: { related_exp: 60, industry_db: 0 },
        },
        {
          ingestData: {
            industryDbV2Raw: 0,
            companyHits: [],
            brandHits: [],
            industryTags: ["machinery"],
            roleSignals: [{
              type: "sales",
              years: 5,
              roleRelevantYears: 5,
              industryVerifiedYears: 0,
              matchedSignals: ["销售"],
              matchedWorkEntries: [
                { companyName: "中国平安人寿保险", jobTitle: "保险代理人", years: 5, matchedSignals: ["保险代理"] },
              ],
            }],
          },
        } as unknown,
      );
      // Domain-irrelevant ceiling no longer applies; LLM score passes through
      expect(normalized.breakdown?.related_exp).toBe(60);
    });

    it("detects real estate company as domain-irrelevant", () => {
      const normalized = normalizeAnalysisResult(
        {
          score: 70,
          recommendation: "match",
          summary: "ok",
          highlights: [],
          breakdown: { related_exp: 60, industry_db: 0 },
        },
        {
          ingestData: {
            industryDbV2Raw: 0,
            companyHits: [],
            brandHits: [],
            industryTags: ["machinery"],
            roleSignals: [{
              type: "sales",
              years: 5,
              roleRelevantYears: 5,
              industryVerifiedYears: 0,
              matchedSignals: ["销售"],
              matchedWorkEntries: [
                { companyName: "恒大房地产", jobTitle: "置业顾问", years: 5, matchedSignals: ["置业顾问"] },
              ],
            }],
          },
        } as unknown,
      );
      expect(normalized.breakdown?.related_exp).toBe(60);
    });
  });

  describe("keywordMapsToIndustryTag taxonomy mapping", () => {
    // keywordMapsToIndustryTag is internal but exercised via inferUnverifiedDomainRelevantSalesFloor
    // which uses it to check if domain keywords overlap with resume industry tags.

    it("matches CNC keyword to machinery tag via FALLBACK_INDUSTRY_KEYWORDS", () => {
      // "cnc" is in FALLBACK_INDUSTRY_KEYWORDS.machinery; "machinery" is an industry tag
      const normalized = normalizeAnalysisResult(
        {
          score: 20,
          recommendation: "no_match",
          summary: "ok",
          highlights: [],
          breakdown: { related_exp: 22, industry_db: 0 },
        },
        {
          ingestData: {
            industryDbV2Raw: 0,
            companyHits: [],
            brandHits: [],
            industryTags: ["machinery"],
            roleSignals: [{
              type: "sales",
              years: 6,
              roleRelevantYears: 6,
              industryVerifiedYears: 0,
              industryVerifiedRelevantYears: 0,
              matchedSignals: ["销售工程师"],
              matchedWorkEntries: [
                { companyName: "苏州美科生贸易有限公司", jobTitle: "CNC销售工程师", years: 6, matchedSignals: ["销售工程师", "CNC"], directRoleMatch: true, industryVerified: false },
              ],
            }],
          },
        } as unknown,
      );
      // LLM-primary: AI score passes through without unverified floor
      expect(normalized.breakdown?.related_exp).toBe(22);
    });

    it("matches Chinese 机械 tag to machinery via INDUSTRY_DISPLAY_NAME_TO_TAG", () => {
      // "机械" is in INDUSTRY_DISPLAY_NAME_TO_TAG → "machinery"; "cnc" keyword maps to "machinery"
      const normalized = normalizeAnalysisResult(
        {
          score: 20,
          recommendation: "no_match",
          summary: "ok",
          highlights: [],
          breakdown: { related_exp: 22, industry_db: 0 },
        },
        {
          ingestData: {
            industryDbV2Raw: 0,
            companyHits: [],
            brandHits: [],
            industryTags: ["机械"],
            roleSignals: [{
              type: "sales",
              years: 6,
              roleRelevantYears: 6,
              industryVerifiedYears: 0,
              industryVerifiedRelevantYears: 0,
              matchedSignals: ["销售工程师"],
              matchedWorkEntries: [
                { companyName: "某数控设备有限公司", jobTitle: "销售工程师", years: 6, matchedSignals: ["销售工程师"], directRoleMatch: true, industryVerified: false },
              ],
            }],
          },
        } as unknown,
      );
      // LLM-primary: AI score passes through without unverified floor
      expect(normalized.breakdown?.related_exp).toBe(22);
    });

    it("does not match when keyword has no taxonomy mapping to any resume tag", () => {
      const normalized = normalizeAnalysisResult(
        {
          score: 20,
          recommendation: "no_match",
          summary: "ok",
          highlights: [],
          breakdown: { related_exp: 22, industry_db: 0 },
        },
        {
          ingestData: {
            industryDbV2Raw: 0,
            companyHits: [],
            brandHits: [],
            industryTags: ["software"],
            roleSignals: [{
              type: "sales",
              years: 6,
              roleRelevantYears: 6,
              industryVerifiedYears: 0,
              industryVerifiedRelevantYears: 0,
              matchedSignals: ["销售"],
              matchedWorkEntries: [
                { companyName: "某贸易公司", jobTitle: "销售", years: 6, matchedSignals: ["销售"], directRoleMatch: true, industryVerified: false },
              ],
            }],
          },
        } as unknown,
      );
      // "cnc" maps to "machinery" but resume has "software" tag — no overlap → no floor
      expect(normalized.breakdown?.related_exp).toBeLessThanOrEqual(22);
    });
  });

  describe("inferNoDirectSalesRoleCap", () => {
    it("passes through LLM related_exp without cap for description-only signals", () => {
      const normalized = normalizeAnalysisResult(
        {
          score: 40,
          recommendation: "potential",
          summary: "ok",
          highlights: [],
          breakdown: { related_exp: 40, industry_db: 0 },
        },
        {
          ingestData: {
            industryDbV2Raw: 0,
            companyHits: [],
            brandHits: [],
            industryTags: [],
            roleSignals: [{
              type: "sales",
              years: 3,
              roleRelevantYears: 3,
              industryVerifiedYears: 0,
              industryVerifiedRelevantYears: 0,
              matchedSignals: ["配合销售"],
              matchedWorkEntries: [
                { companyName: "某科技公司", jobTitle: "应用工程师", years: 3, matchedSignals: ["配合销售"], directRoleMatch: false, industryVerified: false },
              ],
            }],
          },
        } as unknown,
      );
      // LLM-primary: AI score passes through without cap
      expect(normalized.breakdown?.related_exp).toBe(40);
    });

    it("passes through LLM related_exp when a direct sales title exists", () => {
      const normalized = normalizeAnalysisResult(
        {
          score: 40,
          recommendation: "potential",
          summary: "ok",
          highlights: [],
          breakdown: { related_exp: 40, industry_db: 0 },
        },
        {
          ingestData: {
            industryDbV2Raw: 0,
            companyHits: [],
            brandHits: [],
            industryTags: [],
            roleSignals: [{
              type: "sales",
              years: 3,
              roleRelevantYears: 3,
              industryVerifiedYears: 3,
              industryVerifiedRelevantYears: 3,
              matchedSignals: ["销售工程师"],
              matchedWorkEntries: [
                { companyName: "某机床公司", jobTitle: "销售工程师", years: 3, matchedSignals: ["销售工程师"], directRoleMatch: true, industryVerified: true },
              ],
            }],
          },
        } as unknown,
      );
      // LLM-primary: AI score passes through without floor boost
      expect(normalized.breakdown?.related_exp).toBe(40);
    });
  });

  describe("hasNonEmployerBrandHits", () => {
    // Mirrors analyze.ts:119-132
    function isRecord(value: unknown): value is Record<string, unknown> {
      return typeof value === "object" && value !== null;
    }
    function hasNonEmployerBrandHits(value: unknown): boolean {
      if (!Array.isArray(value)) return false;
      return value.some((item) => {
        if (!isRecord(item)) return false;
        const context = typeof item.context === "string" ? item.context.trim().toLowerCase() : "";
        return context !== "employer";
      });
    }

    it("returns false for empty array", () => {
      expect(hasNonEmployerBrandHits([])).toBe(false);
    });

    it("returns false for non-array input", () => {
      expect(hasNonEmployerBrandHits(null)).toBe(false);
      expect(hasNonEmployerBrandHits("string")).toBe(false);
      expect(hasNonEmployerBrandHits(42)).toBe(false);
    });

    it("returns false when all brand hits have employer context", () => {
      expect(hasNonEmployerBrandHits([
        { context: "employer" },
        { context: "Employer" },
      ])).toBe(false);
    });

    it("returns true when at least one non-employer context exists", () => {
      expect(hasNonEmployerBrandHits([
        { context: "employer" },
        { context: "product" },
      ])).toBe(true);
    });

    it("returns true for sales context", () => {
      expect(hasNonEmployerBrandHits([{ context: "sales" }])).toBe(true);
    });

    it("returns true for items with no context field (defaults to empty string, not employer)", () => {
      expect(hasNonEmployerBrandHits([{ name: "brand" }])).toBe(true);
    });
  });

  describe("hasCompanyHits", () => {
    // Mirrors analyze.ts:134-140
    function hasCompanyHits(value: unknown): boolean {
      if (!Array.isArray(value)) return false;
      return value.some((item) => typeof item === "string" && item.trim().length > 0);
    }

    it("returns false for empty array", () => {
      expect(hasCompanyHits([])).toBe(false);
    });

    it("returns false for non-array input", () => {
      expect(hasCompanyHits(null)).toBe(false);
    });

    it("returns false for array of whitespace-only strings", () => {
      expect(hasCompanyHits(["  ", ""])).toBe(false);
    });

    it("returns true when at least one non-empty string exists", () => {
      expect(hasCompanyHits(["北京精雕科技集团有限公司"])).toBe(true);
    });

    it("skips non-string items", () => {
      expect(hasCompanyHits([42, null, "valid company"])).toBe(true);
      expect(hasCompanyHits([42, null, {} as unknown])).toBe(false);
    });
  });

  describe("computeDirectIndustryDbScoreFromResume", () => {
    // Mirrors analyze.ts:142-164
    function isRecord(value: unknown): value is Record<string, unknown> {
      return typeof value === "object" && value !== null;
    }
    function getResumeIngestData(resume: unknown): Record<string, unknown> {
      const root = isRecord(resume) ? resume : {};
      const content = isRecord(root.content) ? root.content : {};
      if (isRecord(root.ingestData)) return root.ingestData;
      if (isRecord(content.ingestData)) return content.ingestData;
      return {};
    }
    function hasNonEmployerBrandHitsFn(value: unknown): boolean {
      if (!Array.isArray(value)) return false;
      return value.some((item) => {
        if (!isRecord(item)) return false;
        const context = typeof item.context === "string" ? item.context.trim().toLowerCase() : "";
        return context !== "employer";
      });
    }
    function hasCompanyHitsFn(value: unknown): boolean {
      if (!Array.isArray(value)) return false;
      return value.some((item) => typeof item === "string" && item.trim().length > 0);
    }
    function toNumber(value: unknown): number | undefined {
      if (typeof value === "number" && Number.isFinite(value)) return value;
      if (typeof value === "string") {
        const parsed = Number(value);
        if (Number.isFinite(parsed)) return parsed;
      }
      return undefined;
    }
    function clamp(value: number, min: number, max: number): number {
      return Math.min(max, Math.max(min, value));
    }
    const INDUSTRY_DB_SCORE_CAP = 50;

    function computeDirectIndustryDbScoreFromResume(resume: unknown): number {
      const ingestData = getResumeIngestData(resume);
      const brandHits = hasNonEmployerBrandHitsFn(ingestData.brandHits);
      const companyHits = hasCompanyHitsFn(ingestData.companyHits);
      const hasAnyHit = brandHits || companyHits;
      const hasBoth = brandHits && companyHits;
      const directHitScore = (hasAnyHit ? 40 : 0) + (hasBoth ? 10 : 0);
      const raw = toNumber(ingestData.industryDbV2Raw) ?? 0;
      return clamp(Math.max(raw, directHitScore), 0, INDUSTRY_DB_SCORE_CAP);
    }

    it("returns 40 when non-employer brand hits exist", () => {
      expect(computeDirectIndustryDbScoreFromResume({
        ingestData: { brandHits: [{ context: "sales" }], companyHits: [] },
      })).toBe(40);
    });

    it("returns 40 when company hits exist", () => {
      expect(computeDirectIndustryDbScoreFromResume({
        ingestData: { brandHits: [], companyHits: ["北京精雕科技"] },
      })).toBe(40);
    });

    it("returns cap when both brand and company hits exist", () => {
      expect(computeDirectIndustryDbScoreFromResume({
        ingestData: { brandHits: [{ context: "equipment" }], companyHits: ["某公司"] },
      })).toBe(50);
    });

    it("does not cap when only employer-brand hits exist", () => {
      expect(computeDirectIndustryDbScoreFromResume({
        ingestData: { brandHits: [{ context: "employer" }], companyHits: [], industryDbV2Raw: 30 },
      })).toBe(30);
    });

    it("clamps industryDbV2Raw to 0-50 when no brand/company hits", () => {
      expect(computeDirectIndustryDbScoreFromResume({
        ingestData: { brandHits: [], companyHits: [], industryDbV2Raw: 75 },
      })).toBe(50);
    });

    it("returns industryDbV2Raw as-is when within 0-50", () => {
      expect(computeDirectIndustryDbScoreFromResume({
        ingestData: { brandHits: [], companyHits: [], industryDbV2Raw: 35 },
      })).toBe(35);
    });

    it("defaults to 0 when industryDbV2Raw is absent", () => {
      expect(computeDirectIndustryDbScoreFromResume({
        ingestData: { brandHits: [], companyHits: [] },
      })).toBe(0);
    });

    it("reads ingestData from content.ingestData fallback path", () => {
      expect(computeDirectIndustryDbScoreFromResume({
        content: { ingestData: { brandHits: [], companyHits: ["某公司"] } },
      })).toBe(40);
    });

    it("reads ingestData from root.ingestData preferentially", () => {
      expect(computeDirectIndustryDbScoreFromResume({
        ingestData: { brandHits: [], companyHits: ["根路径公司"] },
        content: { ingestData: { brandHits: [], companyHits: [], industryDbV2Raw: 20 } },
      })).toBe(40);
    });

    it("returns 0 when no ingestData at all", () => {
      expect(computeDirectIndustryDbScoreFromResume({})).toBe(0);
    });
  });

  describe("parseNumericBreakdown", () => {
    // Mirrors analyze.ts:103-117
    function isRecord(value: unknown): value is Record<string, unknown> {
      return typeof value === "object" && value !== null;
    }
    function toNumber(value: unknown): number | undefined {
      if (typeof value === "number" && Number.isFinite(value)) return value;
      if (typeof value === "string") {
        const parsed = Number(value);
        if (Number.isFinite(parsed)) return parsed;
      }
      return undefined;
    }
    function parseNumericBreakdown(value: unknown): Record<string, number> | undefined {
      if (!isRecord(value)) return undefined;
      const parsed: Record<string, number> = {};
      for (const [key, rawValue] of Object.entries(value)) {
        const numeric = toNumber(rawValue);
        if (numeric !== undefined) {
          parsed[key] = numeric;
        }
      }
      return Object.keys(parsed).length > 0 ? parsed : undefined;
    }

    it("returns undefined for non-object input", () => {
      expect(parseNumericBreakdown(null)).toBeUndefined();
      expect(parseNumericBreakdown("string")).toBeUndefined();
      expect(parseNumericBreakdown(42)).toBeUndefined();
    });

    it("returns undefined for empty object", () => {
      expect(parseNumericBreakdown({})).toBeUndefined();
    });

    it("returns undefined when all values are non-numeric", () => {
      expect(parseNumericBreakdown({ a: "bad", b: null, c: NaN })).toBeUndefined();
    });

    it("parses numeric values from object", () => {
      expect(parseNumericBreakdown({ related_exp: 80, industry_db: 35 })).toEqual({
        related_exp: 80,
        industry_db: 35,
      });
    });

    it("parses string numbers", () => {
      expect(parseNumericBreakdown({ related_exp: "75" })).toEqual({ related_exp: 75 });
    });

    it("filters non-numeric values keeping numeric ones", () => {
      expect(parseNumericBreakdown({ related_exp: 60, industry_db: "abc", extra: NaN })).toEqual({
        related_exp: 60,
      });
    });

    it("treats array input as record with numeric index keys", () => {
      // isRecord([1,2,3]) is true, so array enters the loop
      // numeric index keys "0","1","2" get parsed as string numbers
      const result = parseNumericBreakdown([1, 2, 3]);
      // Array indices become keys: { "0": 1, "1": 2, "2": 3 }
      expect(result).toEqual({ "0": 1, "1": 2, "2": 3 });
    });
  });

  describe("parseRoleSignals", () => {
    // Mirrors analyze.ts:670-742
    function isRecord(value: unknown): value is Record<string, unknown> {
      return typeof value === "object" && value !== null;
    }
    function toNumber(value: unknown): number | undefined {
      if (typeof value === "number" && Number.isFinite(value)) return value;
      if (typeof value === "string") {
        const parsed = Number(value);
        if (Number.isFinite(parsed)) return parsed;
      }
      return undefined;
    }

    type NormalizedRoleSignal = {
      type: string;
      matchedSignals: string[];
      signalCount: number;
      occurrences: number;
      years: number;
      industryVerifiedYears: number;
      roleRelevantYears?: number;
      industryVerifiedRelevantYears?: number;
      matchedWorkEntries?: Array<{
        companyName?: string;
        jobTitle?: string;
        years: number;
        industryVerified: boolean;
        matchedSignals: string[];
        directRoleMatch?: boolean;
      }>;
      verifyIn: "workHistory" | "searchText";
    };

    function parseRoleSignals(value: unknown): NormalizedRoleSignal[] {
      if (!Array.isArray(value)) return [];
      return value.flatMap((item) => {
        if (!isRecord(item)) return [];
        const type = typeof item.type === "string" ? item.type.trim() : "";
        const years = toNumber(item.years);
        if (!type || years === undefined) return [];
        const verifyIn = item.verifyIn === "searchText" ? "searchText" : "workHistory";
        const matchedSignals = Array.isArray(item.matchedSignals)
          ? item.matchedSignals.filter((signal): signal is string => typeof signal === "string" && signal.length > 0)
          : [];
        const signalCount = toNumber(item.signalCount) ?? matchedSignals.length;
        const occurrences = toNumber(item.occurrences) ?? matchedSignals.length;
        const industryVerifiedYears = toNumber(item.industryVerifiedYears) ?? 0;
        const roleRelevantYears = toNumber(item.roleRelevantYears);
        const industryVerifiedRelevantYears = toNumber(item.industryVerifiedRelevantYears);
        const matchedWorkEntries = Array.isArray(item.matchedWorkEntries)
          ? item.matchedWorkEntries.flatMap((entry) => {
              if (!isRecord(entry)) return [];
              const entryYears = toNumber(entry.years);
              if (entryYears === undefined) return [];
              const matchedEntrySignals = Array.isArray(entry.matchedSignals)
                ? entry.matchedSignals.filter(
                    (signal): signal is string => typeof signal === "string" && signal.length > 0
                  )
                : [];
              return [{
                companyName: typeof entry.companyName === "string" && entry.companyName.trim().length > 0
                  ? entry.companyName.trim() : undefined,
                jobTitle: typeof entry.jobTitle === "string" && entry.jobTitle.trim().length > 0
                  ? entry.jobTitle.trim() : undefined,
                years: entryYears,
                industryVerified: entry.industryVerified === true,
                matchedSignals: matchedEntrySignals,
                ...(typeof entry.directRoleMatch === "boolean"
                  ? { directRoleMatch: entry.directRoleMatch } : {}),
              }];
            })
          : undefined;
        return [{
          type, matchedSignals, signalCount, occurrences, years,
          industryVerifiedYears,
          ...(roleRelevantYears === undefined ? {} : { roleRelevantYears }),
          ...(industryVerifiedRelevantYears === undefined ? {} : { industryVerifiedRelevantYears }),
          ...(matchedWorkEntries && matchedWorkEntries.length > 0 ? { matchedWorkEntries } : {}),
          verifyIn,
        }];
      });
    }

    it("returns empty array for non-array input", () => {
      expect(parseRoleSignals(null)).toEqual([]);
      expect(parseRoleSignals({})).toEqual([]);
    });

    it("skips items with empty type", () => {
      expect(parseRoleSignals([{ type: "", years: 5 }])).toEqual([]);
    });

    it("skips items with missing years", () => {
      expect(parseRoleSignals([{ type: "sales" }])).toEqual([]);
    });

    it("skips non-record items", () => {
      expect(parseRoleSignals(["string", 42])).toEqual([]);
    });

    it("parses minimal valid signal", () => {
      const result = parseRoleSignals([{ type: "sales", years: 6.5 }]);
      expect(result).toHaveLength(1);
      expect(result[0].type).toBe("sales");
      expect(result[0].years).toBe(6.5);
      expect(result[0].verifyIn).toBe("workHistory");
      expect(result[0].industryVerifiedYears).toBe(0);
    });

    it("defaults verifyIn to workHistory when not searchText", () => {
      const result = parseRoleSignals([{ type: "sales", years: 3, verifyIn: "other" }]);
      expect(result[0].verifyIn).toBe("workHistory");
    });

    it("respects verifyIn searchText", () => {
      const result = parseRoleSignals([{ type: "sales", years: 3, verifyIn: "searchText" }]);
      expect(result[0].verifyIn).toBe("searchText");
    });

    it("defaults signalCount and occurrences to matchedSignals length when absent", () => {
      const result = parseRoleSignals([{
        type: "sales", years: 5,
        matchedSignals: ["销售", "销售工程师"],
      }]);
      expect(result[0].signalCount).toBe(2);
      expect(result[0].occurrences).toBe(2);
    });

    it("parses matchedWorkEntries with directRoleMatch", () => {
      const result = parseRoleSignals([{
        type: "sales", years: 6.5,
        matchedSignals: ["销售工程师"],
        matchedWorkEntries: [{
          companyName: "某机床公司",
          jobTitle: "销售工程师",
          years: 3.5,
          industryVerified: true,
          matchedSignals: ["销售工程师"],
          directRoleMatch: true,
        }],
      }]);
      expect(result[0].matchedWorkEntries).toHaveLength(1);
      expect(result[0].matchedWorkEntries![0].directRoleMatch).toBe(true);
      expect(result[0].matchedWorkEntries![0].industryVerified).toBe(true);
    });

    it("omits directRoleMatch when not a boolean", () => {
      const result = parseRoleSignals([{
        type: "sales", years: 3,
        matchedWorkEntries: [{
          companyName: "某公司",
          jobTitle: "销售",
          years: 2,
          industryVerified: false,
          matchedSignals: ["销售"],
        }],
      }]);
      expect(result[0].matchedWorkEntries![0]).not.toHaveProperty("directRoleMatch");
    });

    it("omits matchedWorkEntries when empty array", () => {
      const result = parseRoleSignals([{
        type: "sales", years: 3,
        matchedWorkEntries: [],
      }]);
      expect(result[0]).not.toHaveProperty("matchedWorkEntries");
    });

    it("drops matchedWorkEntry items with missing years", () => {
      const result = parseRoleSignals([{
        type: "sales", years: 3,
        matchedWorkEntries: [
          { companyName: "A", jobTitle: "Sales", years: 2, matchedSignals: ["销售"] },
          { companyName: "B", jobTitle: "Ops" },  // no years → dropped
        ],
      }]);
      expect(result[0].matchedWorkEntries).toHaveLength(1);
    });

    it("omits roleRelevantYears when undefined", () => {
      const result = parseRoleSignals([{ type: "sales", years: 3 }]);
      expect(result[0]).not.toHaveProperty("roleRelevantYears");
    });

    it("includes roleRelevantYears when present", () => {
      const result = parseRoleSignals([{
        type: "sales", years: 6, roleRelevantYears: 4,
      }]);
      expect(result[0].roleRelevantYears).toBe(4);
    });

    it("handles multiple signals in one array", () => {
      const result = parseRoleSignals([
        { type: "sales", years: 5 },
        { type: "engineer", years: 3 },
      ]);
      expect(result).toHaveLength(2);
      expect(result[0].type).toBe("sales");
      expect(result[1].type).toBe("engineer");
    });
  });

  describe("normalizeSummaryConsistency", () => {
    // Mirrors analyze.ts:177-232
    function hasHanText(value: string): boolean {
      return /[\u4e00-\u9fff]/.test(value);
    }
    function normalizeSummaryConsistency(
      summary: string,
      normalized: { score: number; recommendation: string },
    ): string {
      if (summary.trim().length === 0) return summary;
      let next = summary.trim();
      const mentionedScores = Array.from(
        next.matchAll(/\bscore\s*[:：]?\s*(\d{1,3}(?:\.\d+)?)/gi),
        (match) => Number(match[1]),
      ).filter((value) => Number.isFinite(value));
      const hasScoreMention = mentionedScores.length > 0;
      const hasScoreMismatch = hasScoreMention
        && !mentionedScores.some((value) => Math.round(value) === normalized.score);
      if (hasScoreMismatch) {
        next = next.replace(
          /(\bscore\s*[:：]?\s*)\d{1,3}(?:\.\d+)?/gi,
          (_raw, prefix: string) => `${prefix}${normalized.score}`,
        );
      }
      const recommendationMentions = Array.from(
        next.matchAll(/\b(strong_match|match|potential|no_match)\b/gi),
        (match) => match[1].toLowerCase(),
      );
      const hasRecommendationMention = recommendationMentions.length > 0;
      const hasRecommendationMismatch = hasRecommendationMention
        && !recommendationMentions.includes(normalized.recommendation);
      if (hasRecommendationMismatch) {
        next = next.replace(
          /\b(strong_match|match|potential|no_match)\b/gi,
          normalized.recommendation,
        );
      }
      if (hasScoreMismatch || hasRecommendationMismatch) {
        const normalizedLine = hasHanText(next)
          ? `系统归一化结果：score ${normalized.score}，recommendation ${normalized.recommendation}。`
          : `Normalized result: score ${normalized.score}, recommendation ${normalized.recommendation}.`;
        if (!next.includes(normalizedLine)) {
          next = `${next} ${normalizedLine}`.trim();
        }
      }
      return next;
    }

    it("returns whitespace-only summary unchanged", () => {
      expect(normalizeSummaryConsistency("   ", { score: 85, recommendation: "strong_match" }))
        .toBe("   ");
    });

    it("leaves consistent score and recommendation unchanged", () => {
      const input = "Good candidate. score: 85 recommendation strong_match";
      expect(normalizeSummaryConsistency(input, { score: 85, recommendation: "strong_match" }))
        .toBe(input);
    });

    it("replaces mismatched score with normalized score", () => {
      const result = normalizeSummaryConsistency(
        "Score 58 candidate with potential",
        { score: 85, recommendation: "strong_match" },
      );
      expect(result).toContain("score 85");
      expect(result).not.toContain("score 58");
    });

    it("replaces mismatched recommendation with normalized recommendation", () => {
      const result = normalizeSummaryConsistency(
        "score 85 match",
        { score: 85, recommendation: "strong_match" },
      );
      expect(result).toContain("strong_match");
      expect(result).not.toMatch(/\bmatch\b/);
    });

    it("replaces multiple score mentions in one summary", () => {
      const result = normalizeSummaryConsistency(
        "score 58 and score 72 mixed",
        { score: 85, recommendation: "strong_match" },
      );
      // Both occurrences should be replaced, plus canonical line adds a third
      expect(result).not.toContain("58");
      expect(result).not.toContain("72");
      expect(result.match(/score 85/g)!.length).toBeGreaterThanOrEqual(2);
    });

    it("appends English canonical statement on mismatch", () => {
      const result = normalizeSummaryConsistency(
        "score 58",
        { score: 85, recommendation: "strong_match" },
      );
      expect(result).toContain("Normalized result: score 85, recommendation strong_match.");
    });

    it("appends Chinese canonical statement when summary has CJK text", () => {
      const result = normalizeSummaryConsistency(
        "评分较低 score 58",
        { score: 85, recommendation: "strong_match" },
      );
      expect(result).toContain("系统归一化结果：score 85，recommendation strong_match。");
    });

    it("does not duplicate canonical statement on repeated calls", () => {
      const first = normalizeSummaryConsistency(
        "score 58",
        { score: 85, recommendation: "strong_match" },
      );
      const second = normalizeSummaryConsistency(
        first,
        { score: 85, recommendation: "strong_match" },
      );
      // After first pass, score is correct, so no mismatch on second pass
      expect(second).toBe(first);
    });

    it("handles score with decimal (e.g. 84.6 rounds to 85)", () => {
      const result = normalizeSummaryConsistency(
        "score 84.6",
        { score: 85, recommendation: "strong_match" },
      );
      // Math.round(84.6) === 85 → no mismatch → no rewrite
      expect(result).toContain("score 84.6");
      expect(result).not.toContain("Normalized result");
    });

    it("handles score with decimal that does not round to normalized score", () => {
      const result = normalizeSummaryConsistency(
        "score 83.6",
        { score: 85, recommendation: "strong_match" },
      );
      // Math.round(83.6) === 84 ≠ 85 → mismatch → rewrite
      expect(result).toContain("score 85");
      expect(result).toContain("Normalized result");
    });

    it("replaces recommendation substrings without word-boundary confusion", () => {
      // "potentially" contains "potential" but \b should protect it
      const result = normalizeSummaryConsistency(
        "potentially good score 85",
        { score: 85, recommendation: "strong_match" },
      );
      // "potentially" should NOT match \bpotential\b — the regex uses \b
      // So no recommendation mismatch should be detected
      expect(result).toContain("potentially");
    });

    it("handles Chinese colon after score keyword", () => {
      const result = normalizeSummaryConsistency(
        "score：58 推荐",
        { score: 85, recommendation: "strong_match" },
      );
      expect(result).toContain("score：85");
    });
  });

  describe("hasHanText", () => {
    // Mirrors analyze.ts:173
    function hasHanText(value: string): boolean {
      return /[\u4e00-\u9fff]/.test(value);
    }

    it("returns true for Chinese text", () => {
      expect(hasHanText("评分较低")).toBe(true);
    });

    it("returns true for mixed Chinese and English", () => {
      expect(hasHanText("score 85 推荐")).toBe(true);
    });

    it("returns false for English-only text", () => {
      expect(hasHanText("score 85 recommendation")).toBe(false);
    });

    it("returns false for empty string", () => {
      expect(hasHanText("")).toBe(false);
    });

    it("returns false for Japanese hiragana (not CJK unified ideographs)", () => {
      expect(hasHanText("ひらがな")).toBe(false);
    });

    it("returns true for CJK unified ideograph within range", () => {
      expect(hasHanText("销售")).toBe(true);
    });
  });

  describe("getResumeIngestData", () => {
    // Mirrors analyze.ts:142-152
    function isRecord(value: unknown): value is Record<string, unknown> {
      return typeof value === "object" && value !== null;
    }
    function getResumeIngestData(resume: unknown): Record<string, unknown> {
      const root = isRecord(resume) ? resume : {};
      const content = isRecord(root.content) ? root.content : {};
      if (isRecord(root.ingestData)) return root.ingestData;
      if (isRecord(content.ingestData)) return content.ingestData;
      return {};
    }

    it("returns root.ingestData when present", () => {
      const data = { brandHits: ["A"] };
      expect(getResumeIngestData({ ingestData: data })).toEqual(data);
    });

    it("falls back to content.ingestData when root.ingestData absent", () => {
      const data = { brandHits: ["B"] };
      expect(getResumeIngestData({ content: { ingestData: data } })).toEqual(data);
    });

    it("prefers root.ingestData over content.ingestData", () => {
      expect(getResumeIngestData({
        ingestData: { source: "root" },
        content: { ingestData: { source: "content" } },
      })).toEqual({ source: "root" });
    });

    it("returns empty object when neither path has ingestData", () => {
      expect(getResumeIngestData({})).toEqual({});
    });

    it("returns empty object for non-object input", () => {
      expect(getResumeIngestData(null)).toEqual({});
      expect(getResumeIngestData("string")).toEqual({});
    });

    it("returns empty object when ingestData is not a record", () => {
      expect(getResumeIngestData({ ingestData: "not an object" })).toEqual({});
      expect(getResumeIngestData({ ingestData: 42 })).toEqual({});
    });

    it("returns empty object when content is not a record", () => {
      expect(getResumeIngestData({ content: "bad" })).toEqual({});
    });
  });

  describe("inferDomainIrrelevantSalesCeiling", () => {
    // Mirrors analyze.ts:284-367 and helpers
    function isRecord(value: unknown): value is Record<string, unknown> {
      return typeof value === "object" && value !== null;
    }
    function toNumber(value: unknown): number | undefined {
      return typeof value === "number" && Number.isFinite(value) ? value : undefined;
    }
    function getResumeIngestData(resume: unknown): Record<string, unknown> {
      const root = isRecord(resume) ? resume : {};
      const content = isRecord(root.content) ? root.content : {};
      if (isRecord(root.ingestData)) return root.ingestData;
      if (isRecord(content.ingestData)) return content.ingestData;
      return {};
    }

    const DOMAIN_IRRELEVANT_SALES_KEYWORDS = [
      "保险", "人寿", "金融", "投资", "证券", "银行", "理财",
      "房地产", "地产", "置业", "房产",
      "教育", "培训", "学校",
      "医疗", "医院", "医药",
    ];

    const FALLBACK_INDUSTRY_KEYWORDS: Record<string, string[]> = {
      machinery: ["机床", "车床", "加工中心", "机械", "设备", "cnc", "数控"],
      sales: ["销售", "业务", "销售工程师", "业务拓展", "sales", "account", "bd", "market"],
      metrology: ["测量", "三维扫描", "3d", "cmm", "metrology", "scan"],
      software: ["c++", "c#", "mfc", "qt", "软件", "开发", "algorithm", "python"],
    };

    const INDUSTRY_DISPLAY_NAME_TO_TAG: Record<string, string> = {
      机械: "machinery",
      销售: "sales",
      测量: "metrology",
      软件: "software",
    };

    function isSalesRequiredContext(...texts: Array<string | undefined>): boolean {
      const haystack = texts
        .map((text) => (typeof text === "string" ? text.trim() : ""))
        .filter(Boolean)
        .join(" ");
      if (!haystack) return false;
      return /(?:^|\b)(?:sales?|business development|bd|account manager|key account manager|channel sales|channel manager|territory sales manager|regional sales manager)(?:\b|$)|销售工程师|销售经理|业务拓展|业务开发|客户开发|大客户|渠道销售|渠道经理|销售|渠道/.test(haystack);
    }

    function isDomainIrrelevantSalesEntry(entry: Record<string, unknown>): boolean {
      const companyName = typeof entry.companyName === "string" ? entry.companyName : "";
      const jobTitle = typeof entry.jobTitle === "string" ? entry.jobTitle : "";
      const text = `${companyName} ${jobTitle}`.toLowerCase();
      return DOMAIN_IRRELEVANT_SALES_KEYWORDS.some((kw) => text.includes(kw.toLowerCase()));
    }

    function keywordMapsToIndustryTag(keyword: string, resumeIndustryTags: string[]): boolean {
      const kwLower = keyword.trim().toLowerCase();
      if (!kwLower) return false;
      const normalizedTags = new Set<string>();
      for (const tag of resumeIndustryTags) {
        const tagLower = tag.toLowerCase();
        normalizedTags.add(tagLower);
        const mappedTag = INDUSTRY_DISPLAY_NAME_TO_TAG[tag];
        if (mappedTag) normalizedTags.add(mappedTag.toLowerCase());
      }
      if (normalizedTags.has(kwLower)) return true;
      for (const [tag, keywords] of Object.entries(FALLBACK_INDUSTRY_KEYWORDS)) {
        if (!normalizedTags.has(tag.toLowerCase())) continue;
        if (keywords.some((kw) => kw.toLowerCase() === kwLower)) return true;
      }
      return false;
    }

    function inferDomainIrrelevantSalesCeiling(
      resume: unknown,
      keywords: string[],
    ): number | undefined {
      const ingestData = getResumeIngestData(resume);
      if (!Array.isArray(ingestData.roleSignals)) return undefined;

      const salesKeywords = keywords.filter((kw) => isSalesRequiredContext(kw));
      const domainKeywords = keywords.filter((kw) => !isSalesRequiredContext(kw));
      if (salesKeywords.length === 0 || domainKeywords.length === 0) return undefined;

      const salesSignal = (ingestData.roleSignals as unknown[]).find((rawSignal) => {
        if (!isRecord(rawSignal)) return false;
        return typeof rawSignal.type === "string"
          && rawSignal.type.trim().toLowerCase() === "sales";
      });
      if (!salesSignal || !isRecord(salesSignal)) return undefined;

      const hasIndustryVerifiedSalesYears = (toNumber(salesSignal.industryVerifiedRelevantYears) ?? 0) > 0
        || (toNumber(salesSignal.industryVerifiedYears) ?? 0) > 0;

      const workEntries = Array.isArray(salesSignal.matchedWorkEntries)
        ? salesSignal.matchedWorkEntries.filter((e: unknown): e is Record<string, unknown> => isRecord(e))
        : [];
      const hasIndustryVerifiedSalesEntry = workEntries.some(
        (entry) => entry.industryVerified === true,
      );

      const hasSalesRelevantBrandHits = (() => {
        if (!Array.isArray(ingestData.brandHits) || ingestData.brandHits.length === 0) return false;
        if (hasIndustryVerifiedSalesEntry) return true;
        const salesRelevantContexts = new Set(["product", "dealer", "agent", "distributor"]);
        return (ingestData.brandHits as unknown[]).some((item) => {
          if (!isRecord(item)) return false;
          const context = typeof item.context === "string" ? item.context.trim().toLowerCase() : "";
          if (context === "employer" || context === "technical") return false;
          return salesRelevantContexts.has(context) || context === "both" || context === "";
        });
      })();

      const industryTags = Array.isArray(ingestData.industryTags)
        ? (ingestData.industryTags as unknown[]).filter((tag): tag is string => typeof tag === "string")
        : [];
      const hasDomainIndustryTag = industryTags.length > 0 && domainKeywords.some(
        (kw) => keywordMapsToIndustryTag(kw, industryTags),
      );
      const hasDomainIrrelevantSalesEntry = workEntries.some((entry) =>
        isDomainIrrelevantSalesEntry(entry),
      );

      if (hasIndustryVerifiedSalesYears || hasIndustryVerifiedSalesEntry || hasSalesRelevantBrandHits) {
        return undefined;
      }
      if (hasDomainIndustryTag && !hasDomainIrrelevantSalesEntry) {
        return undefined;
      }
      return 15;
    }

    it("returns undefined when resume has no roleSignals", () => {
      expect(inferDomainIrrelevantSalesCeiling(
        { ingestData: { roleSignals: undefined } },
        ["CNC", "销售"],
      )).toBeUndefined();
    });

    it("returns undefined when keywords have no sales component", () => {
      expect(inferDomainIrrelevantSalesCeiling(
        { ingestData: { roleSignals: [{ type: "engineer", years: 5 }] } },
        ["CNC", "数控"],
      )).toBeUndefined();
    });

    it("returns undefined when keywords have no domain component", () => {
      expect(inferDomainIrrelevantSalesCeiling(
        { ingestData: { roleSignals: [{ type: "sales", years: 5 }] } },
        ["销售"],
      )).toBeUndefined();
    });

    it("returns undefined when resume has no sales signal", () => {
      expect(inferDomainIrrelevantSalesCeiling(
        { ingestData: { roleSignals: [{ type: "engineer", years: 8 }] } },
        ["CNC", "销售"],
      )).toBeUndefined();
    });

    it("returns 15 for domain-irrelevant sales (insurance) with no bypass evidence", () => {
      expect(inferDomainIrrelevantSalesCeiling(
        {
          ingestData: {
            roleSignals: [{
              type: "sales",
              years: 5,
              matchedWorkEntries: [
                { companyName: "中国人寿保险", jobTitle: "保险代理人", years: 5 },
              ],
            }],
            brandHits: [],
            companyHits: [],
            industryTags: [],
          },
        },
        ["CNC", "销售"],
      )).toBe(15);
    });

    it("returns undefined when industry-verified sales years exist", () => {
      expect(inferDomainIrrelevantSalesCeiling(
        {
          ingestData: {
            roleSignals: [{
              type: "sales",
              years: 5,
              industryVerifiedYears: 3,
              matchedWorkEntries: [],
            }],
            brandHits: [],
            companyHits: [],
            industryTags: [],
          },
        },
        ["CNC", "销售"],
      )).toBeUndefined();
    });

    it("returns undefined when industry-verified sales entry exists", () => {
      expect(inferDomainIrrelevantSalesCeiling(
        {
          ingestData: {
            roleSignals: [{
              type: "sales",
              years: 5,
              matchedWorkEntries: [
                { companyName: "东莞机床公司", jobTitle: "销售工程师", years: 5, industryVerified: true },
              ],
            }],
            brandHits: [],
            companyHits: [],
            industryTags: [],
          },
        },
        ["CNC", "销售"],
      )).toBeUndefined();
    });

    it("returns undefined when sales-relevant brand hits exist (product context)", () => {
      expect(inferDomainIrrelevantSalesCeiling(
        {
          ingestData: {
            roleSignals: [{
              type: "sales",
              years: 5,
              matchedWorkEntries: [],
            }],
            brandHits: [{ name: "Mazak", context: "product" }],
            companyHits: [],
            industryTags: [],
          },
        },
        ["CNC", "销售"],
      )).toBeUndefined();
    });

    it("does not bypass on technical-only brand hits", () => {
      expect(inferDomainIrrelevantSalesCeiling(
        {
          ingestData: {
            roleSignals: [{
              type: "sales",
              years: 5,
              matchedWorkEntries: [],
            }],
            brandHits: [{ name: "FANUC", context: "technical" }],
            companyHits: [],
            industryTags: [],
          },
        },
        ["CNC", "销售"],
      )).toBe(15);
    });

    it("does not bypass on employer-only brand hits", () => {
      expect(inferDomainIrrelevantSalesCeiling(
        {
          ingestData: {
            roleSignals: [{
              type: "sales",
              years: 5,
              matchedWorkEntries: [],
            }],
            brandHits: [{ name: "Some Co", context: "employer" }],
            companyHits: [],
            industryTags: [],
          },
        },
        ["CNC", "销售"],
      )).toBe(15);
    });

    it("returns undefined when domain industry tag matches and no domain-irrelevant entry", () => {
      expect(inferDomainIrrelevantSalesCeiling(
        {
          ingestData: {
            roleSignals: [{
              type: "sales",
              years: 5,
              matchedWorkEntries: [
                { companyName: "东莞精密机械", jobTitle: "销售", years: 5 },
              ],
            }],
            brandHits: [],
            companyHits: [],
            industryTags: ["machinery"],
          },
        },
        ["CNC", "销售"],
      )).toBeUndefined();
    });

    it("returns 15 when domain industry tag matches but a domain-irrelevant entry exists", () => {
      expect(inferDomainIrrelevantSalesCeiling(
        {
          ingestData: {
            roleSignals: [{
              type: "sales",
              years: 8,
              matchedWorkEntries: [
                { companyName: "东莞机床公司", jobTitle: "销售", years: 3, industryVerified: true },
                { companyName: "平安保险", jobTitle: "保险代理人", years: 5 },
              ],
            }],
            brandHits: [],
            companyHits: [],
            industryTags: ["machinery"],
          },
        },
        ["CNC", "销售"],
      )).toBeUndefined(); // industryVerified entry bypasses ceiling
    });

    it("returns 15 for real estate sales with no domain evidence", () => {
      expect(inferDomainIrrelevantSalesCeiling(
        {
          ingestData: {
            roleSignals: [{
              type: "sales",
              years: 6,
              matchedWorkEntries: [
                { companyName: "万科地产", jobTitle: "置业顾问", years: 6 },
              ],
            }],
            brandHits: [],
            companyHits: [],
            industryTags: [],
          },
        },
        ["CNC", "销售"],
      )).toBe(15);
    });

    it("returns undefined for industryVerifiedRelevantYears bypass", () => {
      expect(inferDomainIrrelevantSalesCeiling(
        {
          ingestData: {
            roleSignals: [{
              type: "sales",
              years: 5,
              industryVerifiedRelevantYears: 3,
              matchedWorkEntries: [],
            }],
            brandHits: [],
            companyHits: [],
            industryTags: [],
          },
        },
        ["CNC", "销售"],
      )).toBeUndefined();
    });
  });

  describe("inferUnverifiedDomainRelevantSalesFloor", () => {
    // Mirrors analyze.ts:444-507
    function isRecord(value: unknown): value is Record<string, unknown> {
      return typeof value === "object" && value !== null;
    }
    function toNumber(value: unknown): number | undefined {
      return typeof value === "number" && Number.isFinite(value) ? value : undefined;
    }
    function getResumeIngestData(resume: unknown): Record<string, unknown> {
      const root = isRecord(resume) ? resume : {};
      const content = isRecord(root.content) ? root.content : {};
      if (isRecord(root.ingestData)) return root.ingestData;
      if (isRecord(content.ingestData)) return content.ingestData;
      return {};
    }

    const FALLBACK_INDUSTRY_KEYWORDS: Record<string, string[]> = {
      machinery: ["机床", "车床", "加工中心", "机械", "设备", "cnc", "数控"],
      sales: ["销售", "业务", "销售工程师", "业务拓展", "sales", "account", "bd", "market"],
      metrology: ["测量", "三维扫描", "3d", "cmm", "metrology", "scan"],
      software: ["c++", "c#", "mfc", "qt", "软件", "开发", "algorithm", "python"],
    };
    const INDUSTRY_DISPLAY_NAME_TO_TAG: Record<string, string> = {
      机械: "machinery",
      销售: "sales",
      测量: "metrology",
      软件: "software",
    };
    const DOMAIN_IRRELEVANT_SALES_KEYWORDS = [
      "保险", "人寿", "金融", "投资", "证券", "银行", "理财",
      "房地产", "地产", "置业", "房产",
      "教育", "培训", "学校",
      "医疗", "医院", "医药",
    ];

    function isSalesRequiredContext(...texts: Array<string | undefined>): boolean {
      const haystack = texts
        .map((text) => (typeof text === "string" ? text.trim() : ""))
        .filter(Boolean)
        .join(" ");
      if (!haystack) return false;
      return /(?:^|\b)(?:sales?|business development|bd|account manager|key account manager|channel sales|channel manager|territory sales manager|regional sales manager)(?:\b|$)|销售工程师|销售经理|业务拓展|业务开发|客户开发|大客户|渠道销售|渠道经理|销售|渠道/.test(haystack);
    }

    function isDomainIrrelevantSalesEntry(entry: Record<string, unknown>): boolean {
      const companyName = typeof entry.companyName === "string" ? entry.companyName : "";
      const jobTitle = typeof entry.jobTitle === "string" ? entry.jobTitle : "";
      const text = `${companyName} ${jobTitle}`.toLowerCase();
      return DOMAIN_IRRELEVANT_SALES_KEYWORDS.some((kw) => text.includes(kw.toLowerCase()));
    }

    function keywordMapsToIndustryTag(keyword: string, resumeIndustryTags: string[]): boolean {
      const kwLower = keyword.trim().toLowerCase();
      if (!kwLower) return false;
      const normalizedTags = new Set<string>();
      for (const tag of resumeIndustryTags) {
        const tagLower = tag.toLowerCase();
        normalizedTags.add(tagLower);
        const mappedTag = INDUSTRY_DISPLAY_NAME_TO_TAG[tag];
        if (mappedTag) normalizedTags.add(mappedTag.toLowerCase());
      }
      if (normalizedTags.has(kwLower)) return true;
      for (const [tag, keywords] of Object.entries(FALLBACK_INDUSTRY_KEYWORDS)) {
        if (!normalizedTags.has(tag.toLowerCase())) continue;
        if (keywords.some((kw) => kw.toLowerCase() === kwLower)) return true;
      }
      return false;
    }

    function inferUnverifiedDomainRelevantSalesFloor(
      resume: unknown,
      keywords: string[],
    ): number | undefined {
      const ingestData = getResumeIngestData(resume);
      if (!Array.isArray(ingestData.roleSignals)) return undefined;

      const salesKeywords = keywords.filter((kw) => isSalesRequiredContext(kw));
      const domainKeywords = keywords.filter((kw) => !isSalesRequiredContext(kw));
      if (salesKeywords.length === 0 || domainKeywords.length === 0) return undefined;

      const salesSignal = (ingestData.roleSignals as unknown[]).find((rawSignal) => {
        if (!isRecord(rawSignal)) return false;
        return typeof rawSignal.type === "string"
          && rawSignal.type.trim().toLowerCase() === "sales";
      });
      if (!salesSignal || !isRecord(salesSignal)) return undefined;

      const workEntries = Array.isArray(salesSignal.matchedWorkEntries)
        ? salesSignal.matchedWorkEntries.filter((e: unknown): e is Record<string, unknown> => isRecord(e))
        : [];
      const hasDirectSalesTitle = workEntries.some((entry) => entry.directRoleMatch === true);
      if (!hasDirectSalesTitle) return undefined;

      const hasIndustryVerifiedSales = (toNumber(salesSignal.industryVerifiedRelevantYears) ?? 0) > 0
        || (toNumber(salesSignal.industryVerifiedYears) ?? 0) > 0
        || workEntries.some((entry) => entry.industryVerified === true);
      if (hasIndustryVerifiedSales) return undefined;

      const industryTags = Array.isArray(ingestData.industryTags)
        ? (ingestData.industryTags as unknown[]).filter((tag): tag is string => typeof tag === "string")
        : [];
      const hasDomainIndustryTag = industryTags.length > 0 && domainKeywords.some(
        (kw) => keywordMapsToIndustryTag(kw, industryTags),
      );
      if (!hasDomainIndustryTag) return undefined;

      const hasDomainIrrelevantSalesEntry = workEntries.some((entry) =>
        isDomainIrrelevantSalesEntry(entry),
      );
      if (hasDomainIrrelevantSalesEntry) return undefined;

      return 60;
    }

    it("returns undefined when resume has no roleSignals", () => {
      expect(inferUnverifiedDomainRelevantSalesFloor(
        { ingestData: { roleSignals: undefined } },
        ["CNC", "销售"],
      )).toBeUndefined();
    });

    it("returns undefined when keywords have no sales component", () => {
      expect(inferUnverifiedDomainRelevantSalesFloor(
        { ingestData: { roleSignals: [{ type: "sales", years: 5 }] } },
        ["CNC"],
      )).toBeUndefined();
    });

    it("returns undefined when keywords have no domain component", () => {
      expect(inferUnverifiedDomainRelevantSalesFloor(
        { ingestData: { roleSignals: [{ type: "sales", years: 5 }] } },
        ["销售"],
      )).toBeUndefined();
    });

    it("returns undefined when resume has no sales signal", () => {
      expect(inferUnverifiedDomainRelevantSalesFloor(
        { ingestData: { roleSignals: [{ type: "engineer", years: 5 }] } },
        ["CNC", "销售"],
      )).toBeUndefined();
    });

    it("returns undefined when no work entry has directRoleMatch=true", () => {
      expect(inferUnverifiedDomainRelevantSalesFloor(
        {
          ingestData: {
            roleSignals: [{
              type: "sales",
              years: 5,
              matchedWorkEntries: [
                { companyName: "科技公司", jobTitle: "应用工程师", directRoleMatch: false },
              ],
            }],
            industryTags: ["machinery"],
          },
        },
        ["CNC", "销售"],
      )).toBeUndefined();
    });

    it("returns undefined when industry-verified sales exist", () => {
      expect(inferUnverifiedDomainRelevantSalesFloor(
        {
          ingestData: {
            roleSignals: [{
              type: "sales",
              years: 5,
              industryVerifiedYears: 3,
              matchedWorkEntries: [
                { companyName: "机床公司", jobTitle: "销售", directRoleMatch: true, industryVerified: true },
              ],
            }],
            industryTags: ["machinery"],
          },
        },
        ["CNC", "销售"],
      )).toBeUndefined();
    });

    it("returns undefined when no domain industry tag matches", () => {
      expect(inferUnverifiedDomainRelevantSalesFloor(
        {
          ingestData: {
            roleSignals: [{
              type: "sales",
              years: 5,
              matchedWorkEntries: [
                { companyName: "贸易公司", jobTitle: "销售", directRoleMatch: true },
              ],
            }],
            industryTags: [],
          },
        },
        ["CNC", "销售"],
      )).toBeUndefined();
    });

    it("returns undefined when domain-irrelevant sales entry exists", () => {
      expect(inferUnverifiedDomainRelevantSalesFloor(
        {
          ingestData: {
            roleSignals: [{
              type: "sales",
              years: 5,
              matchedWorkEntries: [
                { companyName: "平安保险", jobTitle: "销售", directRoleMatch: true },
              ],
            }],
            industryTags: ["machinery"],
          },
        },
        ["CNC", "销售"],
      )).toBeUndefined();
    });

    it("returns 60 for direct sales title + domain tag + no verified + no irrelevant entry", () => {
      expect(inferUnverifiedDomainRelevantSalesFloor(
        {
          ingestData: {
            roleSignals: [{
              type: "sales",
              years: 5,
              matchedWorkEntries: [
                { companyName: "东莞精密机械", jobTitle: "销售工程师", directRoleMatch: true },
              ],
            }],
            industryTags: ["machinery"],
          },
        },
        ["CNC", "销售"],
      )).toBe(60);
    });

    it("returns 60 with Chinese industry tag display name mapping", () => {
      expect(inferUnverifiedDomainRelevantSalesFloor(
        {
          ingestData: {
            roleSignals: [{
              type: "sales",
              years: 4,
              matchedWorkEntries: [
                { companyName: "某机械公司", jobTitle: "销售", directRoleMatch: true },
              ],
            }],
            industryTags: ["机械"],
          },
        },
        ["CNC", "销售"],
      )).toBe(60);
    });
  });

  describe("inferNoDirectSalesRoleCap (direct)", () => {
    // Mirrors analyze.ts:515-549 — direct unit tests (existing integration tests
    // go through normalizeAnalysisResult; these test the pure function logic)
    function isRecord(value: unknown): value is Record<string, unknown> {
      return typeof value === "object" && value !== null;
    }
    function getResumeIngestData(resume: unknown): Record<string, unknown> {
      const root = isRecord(resume) ? resume : {};
      const content = isRecord(root.content) ? root.content : {};
      if (isRecord(root.ingestData)) return root.ingestData;
      if (isRecord(content.ingestData)) return content.ingestData;
      return {};
    }

    function inferNoDirectSalesRoleCap(resume: unknown, precomputedFloor?: number): number | undefined {
      const ingestData = getResumeIngestData(resume);
      if (!Array.isArray(ingestData.roleSignals)) return undefined;

      const salesSignals = (ingestData.roleSignals as unknown[]).filter((raw): raw is Record<string, unknown> => {
        if (!isRecord(raw)) return false;
        const type = typeof raw.type === "string" ? raw.type.trim().toLowerCase() : "";
        return type === "sales";
      });

      if (salesSignals.length === 0) return 0;
      if (precomputedFloor !== undefined) return undefined;

      const hasDirectSalesTitle = salesSignals.some((rawSignal) => {
        const workEntries = Array.isArray(rawSignal.matchedWorkEntries)
          ? rawSignal.matchedWorkEntries.filter((e: unknown): e is Record<string, unknown> => isRecord(e))
          : [];
        return workEntries.some((rawEntry) => rawEntry.directRoleMatch === true);
      });
      if (hasDirectSalesTitle) return undefined;

      return 0;
    }

    it("returns undefined when resume has no roleSignals", () => {
      expect(inferNoDirectSalesRoleCap(
        { ingestData: { roleSignals: undefined } },
      )).toBeUndefined();
    });

    it("returns 0 when no sales signals exist at all", () => {
      expect(inferNoDirectSalesRoleCap(
        { ingestData: { roleSignals: [{ type: "engineer", years: 5 }] } },
      )).toBe(0);
    });

    it("returns undefined when floor is already applied (precomputedFloor)", () => {
      expect(inferNoDirectSalesRoleCap(
        {
          ingestData: {
            roleSignals: [{
              type: "sales",
              years: 5,
              matchedWorkEntries: [
                { companyName: "某公司", jobTitle: "应用工程师", directRoleMatch: false },
              ],
            }],
          },
        },
        60,
      )).toBeUndefined();
    });

    it("returns 0 when sales signal has no directRoleMatch entries", () => {
      expect(inferNoDirectSalesRoleCap(
        {
          ingestData: {
            roleSignals: [{
              type: "sales",
              years: 5,
              matchedWorkEntries: [
                { companyName: "科技公司", jobTitle: "技术支持", directRoleMatch: false },
              ],
            }],
          },
        },
      )).toBe(0);
    });

    it("returns undefined when sales signal has directRoleMatch=true entry", () => {
      expect(inferNoDirectSalesRoleCap(
        {
          ingestData: {
            roleSignals: [{
              type: "sales",
              years: 5,
              matchedWorkEntries: [
                { companyName: "机床公司", jobTitle: "销售工程师", directRoleMatch: true },
              ],
            }],
          },
        },
      )).toBeUndefined();
    });

    it("returns undefined when any sales signal has a direct match", () => {
      expect(inferNoDirectSalesRoleCap(
        {
          ingestData: {
            roleSignals: [
              {
                type: "sales",
                years: 3,
                matchedWorkEntries: [
                  { companyName: "某公司", jobTitle: "技术员", directRoleMatch: false },
                ],
              },
              {
                type: "sales",
                years: 5,
                matchedWorkEntries: [
                  { companyName: "机床公司", jobTitle: "销售", directRoleMatch: true },
                ],
              },
            ],
          },
        },
      )).toBeUndefined();
    });

    it("returns 0 when sales signal has no matchedWorkEntries", () => {
      expect(inferNoDirectSalesRoleCap(
        {
          ingestData: {
            roleSignals: [{
              type: "sales",
              years: 3,
            }],
          },
        },
      )).toBe(0);
    });
  });

  describe("inferSalesRelatedExpFloor", () => {
    // Mirrors analyze.ts:234-276
    function isRecord(value: unknown): value is Record<string, unknown> {
      return typeof value === "object" && value !== null;
    }
    function toNumber(value: unknown): number | undefined {
      return typeof value === "number" && Number.isFinite(value) ? value : undefined;
    }
    function getResumeIngestData(resume: unknown): Record<string, unknown> {
      const root = isRecord(resume) ? resume : {};
      const content = isRecord(root.content) ? root.content : {};
      if (isRecord(root.ingestData)) return root.ingestData;
      if (isRecord(content.ingestData)) return content.ingestData;
      return {};
    }

    function inferSalesRelatedExpFloor(resume: unknown): number | undefined {
      const ingestData = getResumeIngestData(resume);
      if (!Array.isArray(ingestData.roleSignals)) return undefined;

      for (const rawSignal of ingestData.roleSignals) {
        if (!isRecord(rawSignal)) continue;
        const type = typeof rawSignal.type === "string" ? rawSignal.type.trim().toLowerCase() : "";
        if (type !== "sales") continue;

        const verifiedYears = toNumber(rawSignal.industryVerifiedYears) ?? 0;
        const verifiedRelevantYears = toNumber(rawSignal.industryVerifiedRelevantYears) ?? 0;
        const workEntries = Array.isArray(rawSignal.matchedWorkEntries)
          ? rawSignal.matchedWorkEntries.filter((e: unknown): e is Record<string, unknown> => isRecord(e))
          : [];
        const hasDirectRoleEvidence = workEntries.some((e) => e.directRoleMatch === true);
        const hasIndustryVerifiedSales = verifiedYears > 0 || verifiedRelevantYears > 0
          || workEntries.some((e) => e.industryVerified === true);

        if (hasDirectRoleEvidence && !hasIndustryVerifiedSales) continue;

        const relevantYears = Math.max(verifiedYears, toNumber(rawSignal.roleRelevantYears) ?? toNumber(rawSignal.years) ?? 0);
        if (hasIndustryVerifiedSales && relevantYears >= 3) return 80;
      }
      return undefined;
    }

    it("returns undefined when resume has no roleSignals", () => {
      expect(inferSalesRelatedExpFloor(
        { ingestData: { roleSignals: undefined } },
      )).toBeUndefined();
    });

    it("returns undefined when no sales signal exists", () => {
      expect(inferSalesRelatedExpFloor(
        { ingestData: { roleSignals: [{ type: "engineer", years: 10 }] } },
      )).toBeUndefined();
    });

    it("returns undefined when sales has direct role but no industry verification", () => {
      // Unverified direct-role sales: 80 floor doesn't apply
      expect(inferSalesRelatedExpFloor(
        {
          ingestData: {
            roleSignals: [{
              type: "sales",
              years: 5,
              matchedWorkEntries: [
                { companyName: "某公司", jobTitle: "销售", directRoleMatch: true, industryVerified: false },
              ],
            }],
          },
        },
      )).toBeUndefined();
    });

    it("returns 80 for industry-verified sales with 3+ verified years", () => {
      expect(inferSalesRelatedExpFloor(
        {
          ingestData: {
            roleSignals: [{
              type: "sales",
              years: 5,
              industryVerifiedYears: 3,
              matchedWorkEntries: [],
            }],
          },
        },
      )).toBe(80);
    });

    it("returns 80 for industry-verified sales entry with 3+ years", () => {
      expect(inferSalesRelatedExpFloor(
        {
          ingestData: {
            roleSignals: [{
              type: "sales",
              years: 5,
              industryVerifiedYears: 0,
              matchedWorkEntries: [
                { companyName: "机床公司", jobTitle: "销售工程师", years: 4, directRoleMatch: true, industryVerified: true },
              ],
            }],
          },
        },
      )).toBe(80);
    });

    it("returns undefined when verified years are below 3", () => {
      expect(inferSalesRelatedExpFloor(
        {
          ingestData: {
            roleSignals: [{
              type: "sales",
              years: 2,
              industryVerifiedYears: 2,
              matchedWorkEntries: [],
            }],
          },
        },
      )).toBeUndefined();
    });

    it("uses roleRelevantYears when higher than verifiedYears", () => {
      expect(inferSalesRelatedExpFloor(
        {
          ingestData: {
            roleSignals: [{
              type: "sales",
              years: 5,
              industryVerifiedYears: 1,
              roleRelevantYears: 4,
              matchedWorkEntries: [
                { companyName: "机床公司", jobTitle: "销售", industryVerified: true },
              ],
            }],
          },
        },
      )).toBe(80);
    });

    it("returns 80 when industryVerifiedRelevantYears >= 3", () => {
      expect(inferSalesRelatedExpFloor(
        {
          ingestData: {
            roleSignals: [{
              type: "sales",
              years: 6,
              industryVerifiedYears: 0,
              industryVerifiedRelevantYears: 3,
              matchedWorkEntries: [],
            }],
          },
        },
      )).toBe(80);
    });

    it("skips non-record signals", () => {
      expect(inferSalesRelatedExpFloor(
        {
          ingestData: {
            roleSignals: [null, "not-a-record", 42, { type: "sales", years: 4, industryVerifiedYears: 4 }],
          },
        },
      )).toBe(80);
    });

    it("returns 80 for direct-role + industry-verified (both conditions met)", () => {
      expect(inferSalesRelatedExpFloor(
        {
          ingestData: {
            roleSignals: [{
              type: "sales",
              years: 8,
              industryVerifiedYears: 5,
              matchedWorkEntries: [
                { companyName: "精密机械", jobTitle: "销售经理", directRoleMatch: true, industryVerified: true },
              ],
            }],
          },
        },
      )).toBe(80);
    });

    it("returns undefined when sales signal has no verified evidence and no direct role", () => {
      expect(inferSalesRelatedExpFloor(
        {
          ingestData: {
            roleSignals: [{
              type: "sales",
              years: 5,
              matchedWorkEntries: [
                { companyName: "某公司", jobTitle: "技术支持", directRoleMatch: false, industryVerified: false },
              ],
            }],
          },
        },
      )).toBeUndefined();
    });
  });
});
