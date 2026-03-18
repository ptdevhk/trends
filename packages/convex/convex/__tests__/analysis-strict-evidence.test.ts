import { describe, expect, it } from "vitest";

import { normalizeResume } from "../analyze";

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
});
