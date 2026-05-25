/**
 * Tests for data-service.ts — STOPWORDS set and extractWordsFromTitle.
 *
 * Only the pure/exported parts are tested. The DataService class
 * methods (filesystem/cache/ParserService) are not covered here.
 */
import { describe, expect, it } from "vitest";
import { STOPWORDS, DataService } from "../services/data-service.js";

// ---------------------------------------------------------------------------
// STOPWORDS
// ---------------------------------------------------------------------------

describe("STOPWORDS", () => {
  it("contains common Chinese stopwords", () => {
    expect(STOPWORDS.has("的")).toBe(true);
    expect(STOPWORDS.has("了")).toBe(true);
    expect(STOPWORDS.has("在")).toBe(true);
  });

  it("contains news-noise words", () => {
    expect(STOPWORDS.has("热搜")).toBe(true);
    expect(STOPWORDS.has("网友")).toBe(true);
    expect(STOPWORDS.has("回应")).toBe(true);
  });

  it("does not contain substantive words", () => {
    expect(STOPWORDS.has("经济")).toBe(false);
    expect(STOPWORDS.has("CNC")).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// extractWordsFromTitle (instance method, but pure logic)
// ---------------------------------------------------------------------------

describe("extractWordsFromTitle", () => {
  // DataService constructor requires CacheService + ParserService but
  // extractWordsFromTitle doesn't use them.
  const svc = new DataService(undefined);

  it("extracts continuous Chinese runs from title", () => {
    // The regex matches [\u4e00-\u9fff]{2,} as continuous runs
    const words = svc.extractWordsFromTitle("中国经济增速放缓");
    expect(words).toEqual(["中国经济增速放缓"]);
  });

  it("splits Chinese and English segments", () => {
    const words = svc.extractWordsFromTitle("Python开发工程师招聘");
    expect(words).toContain("Python");
    expect(words).toContain("开发工程师招聘");
  });

  it("extracts English words from title", () => {
    const words = svc.extractWordsFromTitle("Python developer wanted");
    expect(words).toContain("Python");
    expect(words).toContain("developer");
    expect(words).toContain("wanted");
  });

  it("filters out Chinese stopwords from matches", () => {
    // When stopwords form part of a longer match, the whole run is matched;
    // but standalone 2-char stopwords are filtered out
    const words = svc.extractWordsFromTitle("经济政策 的 改革方向");
    expect(words).toContain("经济政策");
    expect(words).toContain("改革方向");
    expect(words).not.toContain("的");
  });

  it("strips URLs from title", () => {
    const words = svc.extractWordsFromTitle("经济政策 https://example.com/news/123 改革");
    expect(words.some((w) => w.includes("http") || w.includes("example"))).toBe(false);
  });

  it("strips bracket annotations", () => {
    const words = svc.extractWordsFromTitle("经济增长[图]分析");
    // After stripping [图], "经济增长分析" is one continuous Chinese run
    expect(words).toContain("经济增长分析");
  });

  it("strips special punctuation and merges runs", () => {
    // After stripping 「」《》, the remaining text is "经济政策分析"
    const words = svc.extractWordsFromTitle("「经济」《政策》分析");
    expect(words).toEqual(["经济政策分析"]);
  });

  it("respects minLength parameter for English", () => {
    const words2 = svc.extractWordsFromTitle("AI ML Python", 2);
    expect(words2).toContain("Python");
    // "AI" and "ML" are 2 chars but regex requires [a-zA-Z]{2,}[a-zA-Z0-9]*
    // which means 2+ alpha followed by optional alphanumeric — "AI" matches

    const words3 = svc.extractWordsFromTitle("CNC operator", 4);
    expect(words3).toContain("operator");
    expect(words3).not.toContain("CNC");
  });

  it("returns empty array for empty string", () => {
    expect(svc.extractWordsFromTitle("")).toEqual([]);
  });

  it("handles mixed content with separators", () => {
    const words = svc.extractWordsFromTitle("CNC操作员 | 5年经验 | 月薪15k-25k");
    expect(words).toContain("CNC");
    expect(words.some((w) => w.includes("操作员"))).toBe(true);
  });
});
