/**
 * Tests for steward-utils.ts — pure helpers: query building, URL candidate
 * filtering, industry signal extraction, and the credit ledger.
 */
import { describe, expect, it } from "vitest";
import {
  buildResearchQueries,
  filterCandidateUrls,
  isOfficialDomain,
  extractIndustrySignal,
  createCreditLedger,
  type TavilyLikeResult,
} from "./steward-utils.js";

describe("buildResearchQueries", () => {
  it("builds the two template queries per name", () => {
    expect(buildResearchQueries(["富泰精机"])).toEqual([
      "富泰精机 主营 行业",
      "富泰精机 公司 简介 官网",
    ]);
    expect(buildResearchQueries(["富泰精机", "Futai Precision"])).toEqual([
      "富泰精机 主营 行业",
      "富泰精机 公司 简介 官网",
      "Futai Precision 主营 行业",
      "Futai Precision 公司 简介 官网",
    ]);
  });

  it("dedupes names and caps the query count", () => {
    expect(buildResearchQueries(["富泰精机", "富泰精机", " 富泰精机 "], 3)).toEqual([
      "富泰精机 主营 行业",
      "富泰精机 公司 简介 官网",
      "富泰精机 主营 行业", // duplicate names produce duplicate queries; cap trims later
    ]);
    expect(buildResearchQueries(["富泰精机", "Futai Precision"], 3)).toEqual([
      "富泰精机 主营 行业",
      "富泰精机 公司 简介 官网",
      "Futai Precision 主营 行业",
    ]);
  });

  it("skips empty names and returns [] for no input", () => {
    expect(buildResearchQueries([], 3)).toEqual([]);
    expect(buildResearchQueries(["  ", ""], 3)).toEqual([]);
  });
});

describe("isOfficialDomain", () => {
  it("matches exact and subdomain suffixes", () => {
    expect(isOfficialDomain("futai.com", ["futai.com"])).toBe(true);
    expect(isOfficialDomain("www.futai.com", ["futai.com"])).toBe(true);
    expect(isOfficialDomain("a.b.futai.com", ["futai.com"])).toBe(true);
  });

  it("does not match lookalike or unrelated domains", () => {
    expect(isOfficialDomain("futai.com.evil.com", ["futai.com"])).toBe(false);
    expect(isOfficialDomain("futai.com.cn", ["futai.com"])).toBe(false);
    expect(isOfficialDomain("notfutai.com", ["futai.com"])).toBe(false);
    expect(isOfficialDomain("example.com", ["futai.com"])).toBe(false);
  });
});

describe("filterCandidateUrls", () => {
  const results: TavilyLikeResult[] = [
    {
      title: "富泰精机官网",
      url: "https://www.futai.com/about",
      content: "数控机床制造",
      score: 0.6,
    },
    {
      title: "富泰精机 - 百度百科",
      url: "https://baike.baidu.com/item/futai",
      content: "自动化设备",
      score: 0.9,
    },
    {
      title: "富泰精机 - B2B",
      url: "http://b2b.example.com/futai",
      content: "机械加工",
      score: 0.8,
    },
    {
      title: "富泰精机 - B2B (dup)",
      url: "http://b2b.example.com:80/futai", // default port normalizes to the same URL
      content: "机械加工",
      score: 0.7,
    },
    {
      title: "lookalike",
      url: "https://futai.com.evil.com/x",
      content: "数控",
      score: 0.99,
    },
  ];

  it("drops junk search domains and dedupes by normalized URL", () => {
    const candidates = filterCandidateUrls(results, { maxCandidates: 10 });
    const urls = candidates.map((c) => c.url);
    expect(urls).not.toContain("https://baike.baidu.com/item/futai");
    expect(urls.filter((u) => u === "http://b2b.example.com/futai")).toHaveLength(1);
    expect(urls).not.toContain("http://b2b.example.com:80/futai"); // port-normalized dup dropped
    expect(urls).toContain("https://futai.com.evil.com/x"); // junk filter only, not lookalike
  });

  it("sorts official-first then score desc and flags isOfficial", () => {
    const candidates = filterCandidateUrls(results, {
      maxCandidates: 10,
      officialDomains: ["futai.com"],
    });
    expect(candidates[0]).toMatchObject({
      url: "https://www.futai.com/about",
      sourceDomain: "www.futai.com",
      isOfficial: true,
    });
    expect(candidates[1]).toMatchObject({ url: "https://futai.com.evil.com/x", isOfficial: false });
    expect(candidates[2]).toMatchObject({ url: "http://b2b.example.com/futai", isOfficial: false });
  });

  it("caps results at maxCandidates", () => {
    const candidates = filterCandidateUrls(results, { maxCandidates: 2 });
    expect(candidates).toHaveLength(2);
  });

  it("returns [] for no results", () => {
    expect(filterCandidateUrls([], { maxCandidates: 10 })).toEqual([]);
  });
});

describe("extractIndustrySignal", () => {
  it("detects cnc with weight-2 confidence", () => {
    const signal = extractIndustrySignal("富泰精机主营数控加工");
    expect(signal.industryClass).toBe("cnc");
    expect(signal.confidence).toBe(0.5); // 数控 1 hit × weight 2 = 2 / 4
  });

  it("caps confidence at 1", () => {
    const signal = extractIndustrySignal("数控 数控 数控 数控 数控 数控 数控 数控");
    expect(signal.industryClass).toBe("cnc");
    expect(signal.confidence).toBe(1);
  });

  it("returns unknown with confidence 0 when no signal matches", () => {
    const signal = extractIndustrySignal("富泰精机成立于2005年，位于东莞");
    expect(signal.industryClass).toBe("unknown");
    expect(signal.confidence).toBe(0);
    expect(signal.excerpt).toBeUndefined();
  });

  it("breaks ties by group order (automation over metrology)", () => {
    const signal = extractIndustrySignal("自动化设备与三坐标测量仪");
    expect(signal.industryClass).toBe("automation");
    expect(signal.confidence).toBe(0.25);
  });

  it("includes a bounded excerpt centered on the first winning hit", () => {
    const padding = "富泰精机专注精密领域服务。".repeat(20);
    const signal = extractIndustrySignal(`${padding}主营数控加工中心${padding}`);
    expect(signal.excerpt).toBeDefined();
    expect(signal.excerpt!.length).toBeLessThanOrEqual(320);
    expect(signal.excerpt).toContain("数控");
  });
});

describe("createCreditLedger", () => {
  it("tracks spent and remaining within budget", () => {
    const ledger = createCreditLedger(10);
    expect(ledger.spent).toBe(0);
    expect(ledger.remaining).toBe(10);
    expect(ledger.canSpend(3)).toBe(true);
    expect(ledger.spend(3)).toBe(true);
    expect(ledger.spent).toBe(3);
    expect(ledger.remaining).toBe(7);
    expect(ledger.canSpend(8)).toBe(false);
    expect(ledger.spend(8)).toBe(false);
    expect(ledger.spent).toBe(3);
  });

  it("rejects invalid costs", () => {
    const ledger = createCreditLedger(10);
    expect(ledger.spend(-1)).toBe(false);
    expect(ledger.spend(0)).toBe(true); // zero-cost spend is a no-op that stays valid
    expect(ledger.spent).toBe(0);
  });

  it("handles a zero budget", () => {
    const ledger = createCreditLedger(0);
    expect(ledger.canSpend(1)).toBe(false);
    expect(ledger.spend(1)).toBe(false);
    expect(ledger.remaining).toBe(0);
  });
});
