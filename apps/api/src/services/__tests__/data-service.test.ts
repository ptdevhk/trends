import { describe, expect, it } from "vitest";

import { DataService, STOPWORDS } from "../data-service.js";

/**
 * Tests for DataService.extractWordsFromTitle — a pure function
 * that extracts keywords from news/RSS titles. Imports the real
 * implementation and STOPWORDS from data-service.ts to avoid
 * test-source drift.
 */

const ds = new DataService();

describe("extractWordsFromTitle", () => {
  it("extracts Chinese keywords from a title", () => {
    const words = ds.extractWordsFromTitle("新能源汽车销量创历史新高");
    // Continuous Chinese text is extracted as one block (no word segmentation)
    expect(words).toContain("新能源汽车销量创历史新高");
    expect(words).toHaveLength(1);
  });

  it("extracts English keywords from a title", () => {
    const words = ds.extractWordsFromTitle("OpenAI releases GPT-5 model");
    expect(words).toContain("OpenAI");
    expect(words).toContain("releases");
    expect(words).toContain("model");
  });

  it("does not split continuous Chinese text on embedded stopwords", () => {
    const words = ds.extractWordsFromTitle("中国的新能源汽车已经发布");
    // The entire string is one continuous Chinese block; stopwords only filter exact matches
    expect(words).toContain("中国的新能源汽车已经发布");
    expect(words).not.toContain("的"); // standalone stopword would be filtered
  });

  it("filters standalone stopwords from space-separated Chinese", () => {
    const words = ds.extractWordsFromTitle("关注 最新 动态");
    expect(words).not.toContain("关注");
    expect(words).not.toContain("最新");
    expect(words).toContain("动态");
  });

  it("removes URLs from title before extraction", () => {
    const words = ds.extractWordsFromTitle("breaking news https://example.com/article/123 more text");
    expect(words).not.toContainEqual(expect.stringContaining("example"));
    expect(words).toContain("breaking");
    expect(words).toContain("news");
    expect(words).toContain("more");
    expect(words).toContain("text");
  });

  it("removes bracketed content from title", () => {
    const words = ds.extractWordsFromTitle("经济 [视频] 增长报告");
    expect(words).not.toContain("视频");
    expect(words).toContain("经济");
    expect(words).toContain("增长报告");
  });

  it("removes Chinese punctuation marks", () => {
    const words = ds.extractWordsFromTitle("「深度」人工智能发展《白皮书》发布");
    // After punctuation removal, "深度" merges with "人工智能发展" into one block
    // "发布" is a stopword but part of the continuous block, not filtered
    expect(words).toContain("深度人工智能发展白皮书发布");
  });

  it("returns empty array for title with only stopwords", () => {
    const words = ds.extractWordsFromTitle("的 了 在 是");
    expect(words).toEqual([]);
  });

  it("returns empty array for empty string", () => {
    const words = ds.extractWordsFromTitle("");
    expect(words).toEqual([]);
  });

  it("handles mixed Chinese and English title", () => {
    const words = ds.extractWordsFromTitle("CNC数控机床的AI应用趋势");
    expect(words).toContain("CNC");
    // "的" merges with preceding Chinese into one block "数控机床的" — stopword filter is exact-match only
    expect(words).toContain("数控机床的");
    expect(words).toContain("AI");
    expect(words).toContain("应用趋势");
  });

  it("respects minLength parameter", () => {
    const words = ds.extractWordsFromTitle("AI CNC 机床", 3);
    expect(words).not.toContain("AI");   // length 2, below minLength
    expect(words).toContain("CNC");      // length 3, meets minLength
    expect(words).not.toContain("机床"); // length 2 Chinese chars, below minLength
  });

  it("handles title that is only a URL", () => {
    const words = ds.extractWordsFromTitle("https://example.com/news");
    expect(words).toEqual([]);
  });

  it("preserves alphanumeric English tokens", () => {
    const words = ds.extractWordsFromTitle("GPT4o and Claude3 models released");
    expect(words).toContain("GPT4o");
    expect(words).toContain("and");
    expect(words).toContain("Claude3");
    expect(words).toContain("models");
    expect(words).toContain("released");
  });

  it("extracts keywords from realistic news title with punctuation", () => {
    const words = ds.extractWordsFromTitle("【突发】特朗普宣布对华加征关税，中方回应");
    // After 【】 removal, "突发" merges with the following text into one Chinese block
    // "中方回应" is a continuous Chinese block — "回应" is a stopword but the regex
    // matches continuous Chinese sequences first, so the whole block passes.
    expect(words).toContain("突发特朗普宣布对华加征关税");
    expect(words).toContain("中方回应");
  });

  it("STOPWORDS set contains expected entries", () => {
    expect(STOPWORDS.has("的")).toBe(true);
    expect(STOPWORDS.has("发布")).toBe(true);
    expect(STOPWORDS.has("关注")).toBe(true);
    expect(STOPWORDS.has("新能源汽车")).toBe(false);
  });
});
