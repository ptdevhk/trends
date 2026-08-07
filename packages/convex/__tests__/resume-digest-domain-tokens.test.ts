import { describe, expect, it } from "vitest";

import { buildResumeDigest } from "../convex/lib/resume_digests.js";

const DOMAIN_TOKENS = ["cnc", "数控", "销售", "sales", "机床"];

function resume(
  content: Record<string, unknown>,
  coldSearchText: string,
  ingestData?: Record<string, unknown>,
) {
  return {
    _id: "resume-digest-token-test",
    identityKey: "id:digest-token-test",
    externalId: "ext:digest-token-test",
    source: "test",
    sourceKey: "test",
    content,
    searchText: coldSearchText,
    ingestData,
    isArchived: false,
    primaryRuleScore: 0,
    crawledAt: 1,
  } as never;
}

/**
 * Long content WITHOUT domain words: every domain token must come from the
 * cold-searchText presence path, so they are pure appended tokens competing
 * with the 1500-char cap. This reproduces the observed live regression where
 * one CN resume lost its 销售 token after a digest rebuild.
 */
function heavyContent(): Record<string, unknown> {
  return {
    name: "王".repeat(80),
    desiredPosition: "工程师".repeat(20),
    location: "广东省东莞市长安镇某某工业园一区",
    workHistory: [
      {
        companyName: "东莞市某某精密机械制造有限公司",
        jobTitle: "生产计划工程师",
        raw: "A".repeat(120),
      },
      { companyName: "B".repeat(60), jobTitle: "C".repeat(60) },
      { companyName: "D".repeat(60), jobTitle: "E".repeat(60) },
    ],
    skills: Array.from({ length: 14 }, (_, index) =>
      `技能${index}` + "x".repeat(55 + index * 3),
    ),
    summary: "总".repeat(120),
  };
}

function heavyIngestData(): Record<string, unknown> {
  return {
    industryTags: ["tag-a", "tag-b", "tag-c", "tag-d", "tag-e"],
    synonymHits: ["syn-a", "syn-b", "syn-c"],
    brandHits: [{ brand: "brand-a" }, { brand: "brand-b" }],
    companyHits: ["hit-a", "hit-b"],
  };
}

describe("resume digest domain-token stability (F3)", () => {
  it("regression: long content + many ingest tokens never drops domain tokens on rebuild", () => {
    const coldSearchText = "cnc 数控 销售 sales 机床 其他冷文本内容";
    const digest = buildResumeDigest(
      resume(heavyContent(), coldSearchText, heavyIngestData()),
      Date.now(),
    );

    const searchText = digest.searchText ?? "";
    expect(searchText.length).toBeGreaterThan(1000);
    for (const token of DOMAIN_TOKENS) {
      expect(searchText.includes(token)).toBe(true);
    }
    // Domain tokens lead the text: they are emitted with cap priority.
    expect(searchText.startsWith("cnc 数控 销售 sales 机床")).toBe(true);
  });

  it("keeps domain tokens even when the base content alone exceeds the cap", () => {
    const oversized = heavyContent();
    // Push the base past 1500 chars of unique tokens so the cap would
    // otherwise truncate everything appended after the content.
    oversized.skills = Array.from({ length: 30 }, (_, index) =>
      `技能${index}` + "x".repeat(70 + index * 2),
    );
    const digest = buildResumeDigest(
      resume(oversized, "cnc 数控 销售 sales 机床 其他冷文本内容"),
      Date.now(),
    );

    const searchText = digest.searchText ?? "";
    for (const token of DOMAIN_TOKENS) {
      expect(searchText.includes(token)).toBe(true);
    }
  });

  it("preserves the previous composition when content is short (no behavior change)", () => {
    const digest = buildResumeDigest(
      resume(
        {
          name: "张三",
          desiredPosition: "销售工程师",
          location: "东莞",
          workHistory: [
            { companyName: "东莞市某某精密机械有限公司", jobTitle: "销售经理" },
          ],
        },
        "cnc 数控 销售 sales 机床 其他冷文本内容",
        heavyIngestData(),
      ),
      Date.now(),
    );

    const searchText = digest.searchText ?? "";
    expect(searchText.includes("销售工程师")).toBe(true);
    expect(searchText.includes("东莞")).toBe(true);
    expect(searchText.includes("某某精密机械")).toBe(true);
    expect(searchText.includes("销售经理")).toBe(true);
    for (const token of DOMAIN_TOKENS) {
      expect(searchText.includes(token)).toBe(true);
    }
  });

  it("deduplicates priority tokens that are already present in the content", () => {
    const digest = buildResumeDigest(
      resume(
        {
          name: "李四",
          desiredPosition: "数控机床销售工程师",
          location: "东莞",
        },
        "cnc 数控 销售 sales 机床 其他冷文本内容",
      ),
      Date.now(),
    );

    const searchText = digest.searchText ?? "";
    const occurrences = (token: string) =>
      searchText.split(/\s+/g).filter((part) => part === token).length;
    expect(occurrences("cnc")).toBe(1);
    expect(occurrences("数控")).toBe(1);
  });
});
