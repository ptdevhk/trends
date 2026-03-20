import { describe, expect, it } from "vitest";

import { parseSearchQuery } from "./query-parser";

describe("parseSearchQuery", () => {
  it("parses legacy whitespace-delimited input as AND tokens by default", () => {
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

  it("parses quoted multi-word phrases with explicit OR semantics", () => {
    expect(parseSearchQuery('"Sales Engineer" OR "Sales Manager"')).toEqual({
      keywords: ["sales engineer", "sales manager"],
      mode: "OR",
    });

    expect(parseSearchQuery('"哈斯 机床" OR "销售 工程师"')).toEqual({
      keywords: ["哈斯 机床", "销售 工程师"],
      mode: "OR",
    });
  });

  it("treats comma-delimited phrases as OR input for editor-friendly queries", () => {
    expect(parseSearchQuery("Sales Engineer, Sales Manager")).toEqual({
      keywords: ["sales engineer", "sales manager"],
      mode: "OR",
    });
  });

  it("parses explicit OR mode and removes operator tokens for single-word terms", () => {
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
    expect(parseSearchQuery("CNC cnc CNC")).toEqual({
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
