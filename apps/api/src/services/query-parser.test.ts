import { describe, expect, it } from "vitest";

import { parseSearchQuery } from "./query-parser";

describe("parseSearchQuery", () => {
  it("parses multi-keyword input as AND by default", () => {
    expect(parseSearchQuery("哈斯 东莞")).toEqual({
      keywords: ["哈斯", "东莞"],
      mode: "AND",
    });

    expect(parseSearchQuery("哈斯 东莞 销售")).toEqual({
      keywords: ["哈斯", "东莞", "销售"],
      mode: "AND",
    });

    expect(parseSearchQuery("CNC")).toEqual({
      keywords: ["cnc"],
      mode: "AND",
    });
  });

  it("parses explicit OR mode and removes operator tokens", () => {
    expect(parseSearchQuery("哈斯 or 东莞")).toEqual({
      keywords: ["哈斯", "东莞"],
      mode: "OR",
    });

    expect(parseSearchQuery("哈斯 OR 东莞")).toEqual({
      keywords: ["哈斯", "东莞"],
      mode: "OR",
    });
  });

  it("deduplicates normalized keywords", () => {
    expect(parseSearchQuery("CNC cnc CNC"))
      .toEqual({
        keywords: ["cnc"],
        mode: "AND",
      });
  });

  it("returns empty keywords for blank input", () => {
    expect(parseSearchQuery("   ")).toEqual({
      keywords: [],
      mode: "AND",
    });
  });
});
