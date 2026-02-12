import { describe, expect, it } from "vitest";

import { buildSearchText } from "../../../../../packages/convex/convex/search_text";

describe("buildSearchText", () => {
  it("handles missing fields safely", () => {
    expect(buildSearchText({})).toBe("");
    expect(buildSearchText(null)).toBe("");
  });

  it("includes key resume fields for search", () => {
    const value = buildSearchText({
      name: "Alice",
      jobIntention: "CNC Sales Engineer",
      location: "Dongguan",
      selfIntro: "FANUC and STAR machine sales",
      workHistory: [{ raw: "Sold CNC lathes for 5 years" }],
      tags: ["precision", "lathe"],
    });

    expect(value).toContain("alice");
    expect(value).toContain("cnc sales engineer");
    expect(value).toContain("dongguan");
    expect(value).toContain("fanuc");
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

  it("splits cjk and ascii boundaries for mixed-script search tokens", () => {
    const result = buildSearchText({
      jobIntention: "东莞CNC编程",
      selfIntro: "熟悉cnc操作和车床CNC技术员",
    });

    expect(result).toContain("东莞 cnc 编程");
    expect(result).toContain("cnc 操作");
    expect(result).toContain("车床 cnc 技术员");
  });

  it("keeps cnc parity stable for mixed-case mixed-script variants", () => {
    const variantA = buildSearchText({
      selfIntro: "精通CNC车床与编程",
      workHistory: [{ raw: "负责cnc设备调试" }],
    });
    const variantB = buildSearchText({
      selfIntro: "精通cnc车床与编程",
      workHistory: [{ raw: "负责CNC设备调试" }],
    });

    expect(variantA).toContain("cnc");
    expect(variantB).toContain("cnc");
    expect(variantA).toContain("车床");
    expect(variantB).toContain("车床");
    expect(variantA).toBe(variantB);
  });
});
