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
  });

  it("falls back to \"未填写\" when ingest evidence is missing", () => {
    const normalized = normalizeResume({
      name: "李某",
      selfIntro: "CNC",
      jobIntention: "销售",
    } as unknown);

    expect(normalized.evidenceText).toBe("未填写");
  });
});
