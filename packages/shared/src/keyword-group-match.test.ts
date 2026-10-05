import { describe, expect, it } from "vitest";
import {
  expandLatinPhraseIndexTerms,
  isLatinMultiWordPhrase,
  latinPhraseTokens,
  matchesKeywordGroupSoft,
  matchesLatinPhraseSoft,
} from "./keyword-group-match.js";

describe("isLatinMultiWordPhrase", () => {
  it("accepts English multi-word titles", () => {
    expect(isLatinMultiWordPhrase("Service Engineer")).toBe(true);
    expect(isLatinMultiWordPhrase("sales manager")).toBe(true);
  });

  it("rejects single tokens and CJK", () => {
    expect(isLatinMultiWordPhrase("CNC")).toBe(false);
    expect(isLatinMultiWordPhrase("销售工程师")).toBe(false);
    expect(isLatinMultiWordPhrase("service")).toBe(false);
  });
});

describe("matchesLatinPhraseSoft", () => {
  it("matches when all tokens appear without a contiguous phrase", () => {
    const text = "senior services engineer cnc machine tools";
    expect(matchesLatinPhraseSoft(text, "Service Engineer")).toBe(true);
  });

  it("rejects when a token is missing", () => {
    expect(matchesLatinPhraseSoft("cnc operator", "Service Engineer")).toBe(false);
  });
});

describe("matchesKeywordGroupSoft", () => {
  const group = {
    original: "service engineer",
    variants: ["service engineer"],
  };

  it("hits contiguous phrase", () => {
    expect(
      matchesKeywordGroupSoft("worked as service engineer at fanuc", group),
    ).toBe(true);
  });

  it("hits split tokens without contiguous phrase", () => {
    expect(
      matchesKeywordGroupSoft(
        "promote cnc equipment · services engineer · malaysia",
        group,
      ),
    ).toBe(true);
  });

  it("misses CNC-only sales text", () => {
    expect(
      matchesKeywordGroupSoft("cnc sales manager machine tools", group),
    ).toBe(false);
  });

  it("leaves CJK groups as substring-only", () => {
    expect(
      matchesKeywordGroupSoft("数控机床销售工程师", {
        original: "销售工程师",
        variants: ["销售工程师"],
      }),
    ).toBe(true);
    expect(
      matchesKeywordGroupSoft("数控机床 销售", {
        original: "销售工程师",
        variants: ["销售工程师"],
      }),
    ).toBe(false);
  });
});

describe("expandLatinPhraseIndexTerms", () => {
  it("adds whitespace tokens for Latin phrases", () => {
    expect(expandLatinPhraseIndexTerms(["service engineer", "cnc"])).toEqual([
      "service engineer",
      "service",
      "engineer",
      "cnc",
    ]);
  });

  it("leaves CJK alone", () => {
    expect(expandLatinPhraseIndexTerms(["销售工程师"])).toEqual(["销售工程师"]);
  });
});

describe("latinPhraseTokens", () => {
  it("lowercases and drops short crumbs", () => {
    expect(latinPhraseTokens("Service Engineer")).toEqual(["service", "engineer"]);
  });
});
