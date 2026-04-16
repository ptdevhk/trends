import { describe, expect, it } from "vitest";

import {
  buildKeywordMatchingRules,
  buildKeywordRequirements,
  normalizeAnalysisResult,
  normalizeResume,
  USER_PROMPT_TEMPLATE,
} from "../analyze";

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

  it("normalizes AI analysis into weighted related_exp and direct industry_db score", () => {
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
        recommendation: "potential",
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
          brandHits: [],
        },
      } as unknown
    );

    expect(normalized.breakdown?.related_exp).toBe(90);
    expect(normalized.breakdown?.industry_db).toBe(50);
    expect(normalized.score).toBe(95);
    expect(normalized.recommendation).toBe("strong_match");
  });

  it("applies a sales related_exp floor when direct sales signals show 3+ verified years", () => {
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
      {
        targetRoleType: "sales",
      }
    );

    expect(normalized.breakdown?.related_exp).toBe(80);
    expect(normalized.score).toBe(40);
    expect(normalized.recommendation).toBe("potential");
  });

  it("caps related_exp to 0 for description-only sales support (no direct sales job title)", () => {
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
      {
        targetRoleType: "sales",
      }
    );

    // directRoleMatch=false means "项目工程师" got sales signal from description,
    // not from actual sales job title — cap fires, related_exp → 0
    expect(normalized.breakdown?.related_exp).toBe(0);
    expect(normalized.score).toBe(0);
    expect(normalized.recommendation).toBe("no_match");
  });

  it("applies the sales related_exp floor for direct business development titles", () => {
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
      {
        targetRoleType: "sales",
      }
    );

    expect(normalized.breakdown?.related_exp).toBe(80);
    expect(normalized.score).toBe(40);
    expect(normalized.recommendation).toBe("potential");
  });

  it("rewrites stale summary score mentions to the normalized score", () => {
    const normalized = normalizeAnalysisResult(
      {
        score: 58,
        recommendation: "potential",
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
      {
        targetRoleType: "sales",
      }
    );

    expect(normalized.score).toBe(90);
    expect(normalized.recommendation).toBe("strong_match");
    expect(normalized.summary).toContain("score 90");
    expect(normalized.summary).not.toContain("score 58");
    expect(normalized.summary).toContain("recommendation strong_match");
  });

  it("includes explicit related_exp scoring bands in prompt guidance", () => {
    expect(USER_PROMPT_TEMPLATE).toContain("85-100");
    expect(USER_PROMPT_TEMPLATE).toContain("70-84");
    expect(USER_PROMPT_TEMPLATE).toContain("40-69");
    expect(USER_PROMPT_TEMPLATE).toContain("0-39");
  });

  it("caps related_exp to 15 for domain-irrelevant sales when keywords combine domain + sales", () => {
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
      {
        targetRoleType: "sales",
        keywords: ["cnc", "销售"],
      }
    );

    // Insurance sales is domain-irrelevant to CNC sales — cap at 15
    expect(normalized.breakdown?.related_exp).toBe(15);
    expect(normalized.score).toBe(8);
    expect(normalized.recommendation).toBe("no_match");
  });

  it("does not cap related_exp when sales has industry-verified overlap", () => {
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
      {
        targetRoleType: "sales",
        keywords: ["cnc", "销售"],
      }
    );

    // Industry-verified CNC sales — no ceiling
    expect(normalized.breakdown?.related_exp).toBe(85);
  });

  it("does not cap related_exp when brand hits prove domain overlap", () => {
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
      {
        targetRoleType: "sales",
        keywords: ["cnc", "销售"],
      }
    );

    // FANUC brand hit with product context proves CNC domain — no ceiling
    expect(normalized.breakdown?.related_exp).toBe(85);
  });

  it("caps related_exp when brand hits are only technical (not sales-relevant)", () => {
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
      {
        targetRoleType: "sales",
        keywords: ["cnc", "销售"],
      }
    );

    // Technical-only brand hits from CNC operator work do not prove sales domain overlap
    // directRoleMatch=false triggers noDirectSalesRoleCap (→ 0) which fires before ceiling
    // score = 0*0.5 + 50(brand hits) = 50 → potential
    expect(normalized.breakdown?.related_exp).toBe(0);
    expect(normalized.score).toBe(50);
    expect(normalized.recommendation).toBe("potential");
  });
  it("does not cap related_exp when industry tags overlap with domain keywords", () => {
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
                  companyName: "某机械贸易公司",
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
      {
        targetRoleType: "sales",
        keywords: ["cnc", "销售"],
      }
    );

    // "cnc" maps to "machinery" tag in FALLBACK_INDUSTRY_KEYWORDS — no ceiling
    expect(normalized.breakdown?.related_exp).toBe(85);
  });

  it("does not apply domain ceiling when keywords are sales-only", () => {
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
      {
        targetRoleType: "sales",
        keywords: ["销售"],
      }
    );

    // Sales-only keyword — no domain ceiling applies
    expect(normalized.breakdown?.related_exp).toBe(80); // floor raises to 80
  });
});
