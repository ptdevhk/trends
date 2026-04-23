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
    expect(USER_PROMPT_TEMPLATE).toContain("60-80"); // verified:0 + domain-relevant special case
    expect(USER_PROMPT_TEMPLATE).toContain("40-59");
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
  it("caps related_exp when industry tags come from non-sales roles + domain-irrelevant company", () => {
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
      {
        targetRoleType: "sales",
        keywords: ["cnc", "销售"],
      }
    );

    // Industry tags from CNC technician work + domain-irrelevant company (insurance)
    // → the tags don't reflect the sales role's domain. Ceiling of 15 applies.
    expect(normalized.breakdown?.related_exp).toBe(15);
    expect(normalized.score).toBe(8);
    expect(normalized.recommendation).toBe("no_match");
  });

  it("bypasses ceiling when industry tags overlap + sales company is domain-relevant", () => {
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
      {
        targetRoleType: "sales",
        keywords: ["cnc", "销售"],
      }
    );

    // Industry tags + direct sales role at a domain-relevant company (machinery trading)
    // → tags likely reflect the sales role's domain. Ceiling does NOT apply.
    // The AI score (85) passes through above the floor of 60.
    expect(normalized.breakdown?.related_exp).toBe(85); // AI score passes through
    expect(normalized.score).toBe(43); // 85 * 0.5 + 0 = 42.5 → rounded 43
    expect(normalized.recommendation).toBe("potential");
  });

  it("applies floor of 60 for unverified domain-relevant sales (AI under-scores)", () => {
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
      {
        targetRoleType: "sales",
        keywords: ["cnc", "销售"],
      }
    );

    // AI gave 22 but floor of 60 applies: unverified + domain tags + no irrelevant company
    expect(normalized.breakdown?.related_exp).toBe(60);
    expect(normalized.score).toBe(30); // 60 * 0.5 + 0 = 30
    expect(normalized.recommendation).toBe("no_match"); // 30 < 40
  });

  it("does not apply unverified floor when sales is at domain-irrelevant company", () => {
    const normalized = normalizeAnalysisResult(
      {
        score: 80,
        recommendation: "strong_match",
        summary: "summary",
        highlights: [],
        breakdown: {
          related_exp: 40, // AI scores moderately, but ceiling should cap to 15
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
      {
        targetRoleType: "sales",
        keywords: ["cnc", "销售"],
      }
    );

    // Insurance company → domain-irrelevant → no floor, ceiling caps at 15
    expect(normalized.breakdown?.related_exp).toBe(15); // Ceiling caps 40→15, floor doesn't lift
    expect(normalized.score).toBe(8);
    expect(normalized.recommendation).toBe("no_match");
  });

  it("does not apply unverified floor when no direct sales job title (description-only)", () => {
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
      {
        targetRoleType: "sales",
        keywords: ["cnc", "销售"],
      }
    );

    // No direct sales title → floor doesn't apply; also noDirectSalesRoleCap zeros it out
    expect(normalized.breakdown?.related_exp).toBe(0);
    expect(normalized.recommendation).toBe("no_match");
  });

  it("unverified floor does not apply for industry-verified sales (80 floor takes precedence)", () => {
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
      {
        targetRoleType: "sales",
        keywords: ["cnc", "销售"],
      }
    );

    // Industry-verified sales gets the 80 floor (higher than 60)
    expect(normalized.breakdown?.related_exp).toBe(80);
    expect(normalized.score).toBe(40);
  });

  it("does not cap related_exp when industry tags overlap AND sales is industry-verified", () => {
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
      {
        targetRoleType: "sales",
        keywords: ["cnc", "销售"],
      }
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
      {
        targetRoleType: "sales",
        keywords: ["销售"],
      }
    );

    // Sales-only keyword — no domain ceiling applies.
    // Floor does NOT apply: directRoleMatch=true but industryVerified=false,
    // so unverified sales lets the AI score pass through.
    expect(normalized.breakdown?.related_exp).toBe(70); // AI score passes through
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
        { targetRoleType: "sales" }
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
        { targetRoleType: "sales" }
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
        {}
      );
      // recommendation "potential" matches, but score 75 in prose != computed score
      // The actual computed score = round(40*0.5) + 0 = 20
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
          breakdown: { related_exp: 80, industry_db: 10 },
        },
        { ingestData: { industryDbV2Raw: 10, companyHits: ["TestCo"], brandHits: [{ context: "employer" }], roleSignals: [{ type: "sales", years: 5, roleRelevantYears: 5, industryVerifiedYears: 5, matchedSignals: ["销售"] }] } } as unknown,
        { targetRoleType: "sales" }
      );
      // score 90 matches, but recommendation "match" should be "strong_match" (>=85)
      expect(normalized.recommendation).toBe("strong_match");
      expect(normalized.summary).toContain("strong_match");
      expect(normalized.summary).not.toMatch(/\bmatch\b(?!\s*_)/);
    });

    it("does not modify summary when both score and recommendation match", () => {
      const originalSummary = "候选人经验丰富，score 90，recommendation strong_match。";
      const normalized = normalizeAnalysisResult(
        {
          score: 90,
          recommendation: "strong_match",
          summary: originalSummary,
          highlights: [],
          breakdown: { related_exp: 80, industry_db: 10 },
        },
        { ingestData: { industryDbV2Raw: 10, companyHits: ["TestCo"], brandHits: [{ context: "employer" }], roleSignals: [{ type: "sales", years: 5, roleRelevantYears: 5, industryVerifiedYears: 5, matchedSignals: ["销售"] }] } } as unknown,
        { targetRoleType: "sales" }
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
        {}
      );
      // Both score and recommendation mismatch → English canonical line appended
      expect(normalized.summary).toContain("Normalized result: score 10, recommendation no_match");
    });

    it("appends Chinese canonical statement for Han-text mismatched summaries", () => {
      const normalized = normalizeAnalysisResult(
        {
          score: 58,
          recommendation: "potential",
          summary: "行业数据库验证方面信息有限，综合 score 58，属于具备潜在匹配的候选人。",
          highlights: [],
          breakdown: { related_exp: 80, industry_db: 0 },
        },
        { ingestData: { industryDbV2Raw: 10, companyHits: ["深圳市创世纪机械有限公司"], brandHits: [{ context: "employer" }], roleSignals: [{ type: "sales", years: 3.8, roleRelevantYears: 3.8, industryVerifiedYears: 3.8, matchedSignals: ["销售工程师"] }] } } as unknown,
        { targetRoleType: "sales" }
      );
      expect(normalized.summary).toContain("系统归一化结果：score 90，recommendation strong_match");
    });
  });

  describe("recommendationFromScore threshold boundaries", () => {
    // score = round(related_exp * 0.5) + industry_db
    // industry_db = 50 when companyHits exist, else industryDbV2Raw clamped 0-50

    it("returns strong_match at exactly 85", () => {
      // round(70*0.5)=35, industry_db=50 → score=85
      const normalized = normalizeAnalysisResult(
        { score: 0, recommendation: "no_match", summary: "ok", highlights: [], breakdown: { related_exp: 70, industry_db: 0 } },
        { ingestData: { industryDbV2Raw: 0, companyHits: ["some-company"], brandHits: [], roleSignals: [] } } as unknown,
        {}
      );
      expect(normalized.score).toBe(85);
      expect(normalized.recommendation).toBe("strong_match");
    });

    it("returns match at 84 (just below strong_match)", () => {
      // round(68*0.5)=34, industry_db=50 → score=84
      const normalized = normalizeAnalysisResult(
        { score: 0, recommendation: "no_match", summary: "ok", highlights: [], breakdown: { related_exp: 68, industry_db: 0 } },
        { ingestData: { industryDbV2Raw: 0, companyHits: ["some-company"], brandHits: [], roleSignals: [] } } as unknown,
        {}
      );
      expect(normalized.score).toBe(84);
      expect(normalized.recommendation).toBe("match");
    });

    it("returns match at exactly 70", () => {
      // round(80*0.5)=40, industry_db=30 → score=70
      const normalized = normalizeAnalysisResult(
        { score: 0, recommendation: "no_match", summary: "ok", highlights: [], breakdown: { related_exp: 80, industry_db: 0 } },
        { ingestData: { industryDbV2Raw: 30, companyHits: [], brandHits: [], roleSignals: [] } } as unknown,
        {}
      );
      expect(normalized.score).toBe(70);
      expect(normalized.recommendation).toBe("match");
    });

    it("returns potential at 69 (just below match)", () => {
      // round(78*0.5)=39, industry_db=30 → score=69
      const normalized = normalizeAnalysisResult(
        { score: 0, recommendation: "no_match", summary: "ok", highlights: [], breakdown: { related_exp: 78, industry_db: 0 } },
        { ingestData: { industryDbV2Raw: 30, companyHits: [], brandHits: [], roleSignals: [] } } as unknown,
        {}
      );
      expect(normalized.score).toBe(69);
      expect(normalized.recommendation).toBe("potential");
    });

    it("returns potential at exactly 40", () => {
      // round(80*0.5)=40, industry_db=0 → score=40
      const normalized = normalizeAnalysisResult(
        { score: 0, recommendation: "no_match", summary: "ok", highlights: [], breakdown: { related_exp: 80, industry_db: 0 } },
        { ingestData: { industryDbV2Raw: 0, companyHits: [], brandHits: [], roleSignals: [] } } as unknown,
        {}
      );
      expect(normalized.score).toBe(40);
      expect(normalized.recommendation).toBe("potential");
    });

    it("returns no_match at 39 (just below potential)", () => {
      // round(78*0.5)=39, industry_db=0 → score=39
      const normalized = normalizeAnalysisResult(
        { score: 0, recommendation: "no_match", summary: "ok", highlights: [], breakdown: { related_exp: 78, industry_db: 0 } },
        { ingestData: { industryDbV2Raw: 0, companyHits: [], brandHits: [], roleSignals: [] } } as unknown,
        {}
      );
      expect(normalized.score).toBe(39);
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
        { targetRoleType: "sales", keywords: ["CNC", "销售"] }
      );
      // Domain-irrelevant ceiling should cap related_exp at 15
      expect(normalized.breakdown?.related_exp).toBeLessThanOrEqual(15);
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
        { targetRoleType: "sales", keywords: ["CNC", "销售"] }
      );
      expect(normalized.breakdown?.related_exp).toBeLessThanOrEqual(15);
    });
  });
});
