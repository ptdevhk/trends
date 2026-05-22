import { describe, expect, it } from "vitest";

import { parseSearchQuery } from "../query-parser.js";

describe("parseSearchQuery", () => {
  it("parses comma-separated keywords", () => {
    const result = parseSearchQuery("cnc, 机床, 销售");
    expect(result.keywords.length).toBeGreaterThanOrEqual(3);
    expect(result.keywords).toContain("cnc");
  });

  it("lowercases keywords", () => {
    const result = parseSearchQuery("CNC, FANUC");
    expect(result.keywords.every((k) => k === k.toLowerCase())).toBe(true);
  });

  it("handles empty query", () => {
    const result = parseSearchQuery("");
    expect(result.keywords).toEqual([]);
    expect(result.mode).toBe("AND");
  });

  it("returns OR mode for OR keyword", () => {
    const result = parseSearchQuery("cnc OR 机床");
    expect(result.mode).toBe("OR");
  });
});
