import { describe, expect, it } from "vitest";

import { parseAgeFromContent, parseAgeNumber } from "../lib/age";

describe("age parser", () => {
  it("parses numeric values and age suffix strings", () => {
    expect(parseAgeNumber(29)).toBe(29);
    expect(parseAgeNumber(29.8)).toBe(29);
    expect(parseAgeNumber("29")).toBe(29);
    expect(parseAgeNumber("29岁")).toBe(29);
    expect(parseAgeNumber(" 29 岁 ")).toBe(29);
  });

  it("rejects invalid age values", () => {
    expect(parseAgeNumber(undefined)).toBeNull();
    expect(parseAgeNumber(null)).toBeNull();
    expect(parseAgeNumber(0)).toBeNull();
    expect(parseAgeNumber("0")).toBeNull();
    expect(parseAgeNumber("abc")).toBeNull();
    expect(parseAgeNumber("29 years old")).toBeNull();
  });

  it("parses nested content.data[0].age first", () => {
    expect(
      parseAgeFromContent({
        data: [{ age: "31岁" }],
        age: "26",
      })
    ).toBe(31);
  });

  it("falls back to top-level age fields when nested age is invalid", () => {
    expect(
      parseAgeFromContent({
        data: [{ age: "unknown" }],
        age: "28岁",
      })
    ).toBe(28);

    expect(
      parseAgeFromContent({
        data: [{ age: "" }],
        ageNumber: "27",
      })
    ).toBe(27);
  });

  it("returns null when content has no valid age values", () => {
    expect(parseAgeFromContent({ data: [{ age: "N/A" }] })).toBeNull();
    expect(parseAgeFromContent({ age: "unknown", ageNumber: "x" })).toBeNull();
    expect(parseAgeFromContent("invalid")).toBeNull();
  });
});
