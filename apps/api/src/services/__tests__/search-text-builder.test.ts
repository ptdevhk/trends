import { describe, expect, it } from "vitest";

import { buildSearchText } from "../../../../../packages/convex/convex/search_text";

describe("buildSearchText", () => {
  it("handles missing fields safely", () => {
    expect(buildSearchText({})).toBe("");
    expect(buildSearchText(null)).toBe("");
  });

  it("includes allowed resume fields for search while excluding noisy header fields", () => {
    const value = buildSearchText({
      name: "Alice",
      experience: "10 years",
      jobIntention: "CNC Sales Engineer",
      location: "Dongguan",
      selfIntro: "FANUC and STAR machine sales",
      summary: "Precision machine tool sales background",
      workHistory: [{ raw: "Sold CNC lathes for 5 years" }],
      tags: ["precision", "lathe"],
    });

    expect(value).toContain("alice");
    expect(value).not.toContain("dongguan");
    expect(value).not.toContain("cnc sales engineer");
    expect(value).not.toContain("fanuc");
    expect(value).not.toContain("10 years");
    expect(value).toContain("precision machine tool sales background");
    expect(value).toContain("sold cnc lathes for 5 years");
  });

  it("normalizes to lowercase deterministically", () => {
    const contentA = {
      name: "BOB",
      location: "GUANGDONG",
      workHistory: [{ raw: "CNC TECH" }],
      extra: { skills: ["FANUC"] },
    };
    const contentB = {
      extra: { skills: ["FANUC"] },
      workHistory: [{ raw: "CNC TECH" }],
      location: "GUANGDONG",
      name: "BOB",
    };

    const resultA = buildSearchText(contentA);
    const resultB = buildSearchText(contentB);

    expect(resultA).toBe(resultA.toLowerCase());
    expect(resultA).toBe(resultB);
  });

  it("indexes structured location hierarchy while ignoring hierarchy metadata fields", () => {
    const result = buildSearchText({
      locationHierarchy: {
        country: "中国",
        province: "广东",
        city: "东莞",
        matchedFrom: "location",
        confidence: "high",
      },
    });

    expect(result).toBe("中国 广东 东莞");
  });

  it("splits cjk and ascii boundaries for mixed-script search tokens", () => {
    const result = buildSearchText({
      summary: "东莞CNC编程 熟悉cnc操作和车床CNC技术员",
    });

    expect(result).toContain("东莞 cnc 编程");
    expect(result).toContain("cnc 操作");
    expect(result).toContain("车床 cnc 技术员");
  });

  it("keeps cnc parity stable for mixed-case mixed-script variants", () => {
    const variantA = buildSearchText({
      summary: "精通CNC车床与编程",
      workHistory: [{ raw: "负责cnc设备调试" }],
    });
    const variantB = buildSearchText({
      summary: "精通cnc车床与编程",
      workHistory: [{ raw: "负责CNC设备调试" }],
    });

    expect(variantA).toContain("cnc");
    expect(variantB).toContain("cnc");
    expect(variantA).toContain("车床");
    expect(variantB).toContain("车床");
    expect(variantA).toBe(variantB);
  });
});
