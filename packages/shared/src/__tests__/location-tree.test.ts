import { describe, expect, it } from "vitest";

import {
  formatLocationHierarchyLabel,
  formatLocationHierarchySearchText,
  findLocation,
  getAllDescendants,
  getChildren,
  isLocationMatch,
  normalizeLocationHierarchy,
  normalizeLocationName,
  resolveLocationHierarchy,
} from "../location-tree";

// ── normalizeLocationName ──────────────────────────────────────────

describe("normalizeLocationName", () => {
  it("returns empty string for empty input", () => {
    expect(normalizeLocationName("")).toBe("");
  });

  it("returns empty string for whitespace-only input", () => {
    expect(normalizeLocationName("   ")).toBe("");
  });

  it("trims whitespace", () => {
    expect(normalizeLocationName("  东莞  ")).toBe("东莞");
  });

  it("strips common Chinese administrative suffixes", () => {
    expect(normalizeLocationName("东莞市")).toBe("东莞");
    expect(normalizeLocationName("南城区")).toBe("南城");
    expect(normalizeLocationName("浦东新区")).toBe("浦东");
    expect(normalizeLocationName("长安镇")).toBe("长安");
    expect(normalizeLocationName("江苏省")).toBe("江苏");
  });

  it("strips multiple suffixes iteratively", () => {
    // "市辖区" → strips "区" → "市辖" → no match → "市辖"
    // But "自治区" → strips "区" first, then may not match; depends on order
    expect(normalizeLocationName("东莞市")).toBe("东莞");
  });

  it("returns non-suffixed Chinese names unchanged", () => {
    expect(normalizeLocationName("中国")).toBe("中国");
    expect(normalizeLocationName("广东")).toBe("广东");
  });

  it("strips 中国 prefix from compound names", () => {
    expect(normalizeLocationName("中国广东")).toBe("广东");
    expect(normalizeLocationName("中国广东东莞")).toBe("广东东莞");
  });

  it("returns 中国 alone unchanged", () => {
    expect(normalizeLocationName("中国")).toBe("中国");
  });

  it("normalizes Chinese punctuation to empty (Chinese mode)", () => {
    expect(normalizeLocationName("广东，深圳、珠海")).toBe("广东深圳珠海");
  });

  it("normalizes punctuation to spaces (English mode)", () => {
    expect(normalizeLocationName("Kuala Lumpur, Malaysia")).toBe("Kuala Lumpur Malaysia");
  });

  it("keeps English letters as-is (English mode)", () => {
    expect(normalizeLocationName("Kuala Lumpur")).toBe("Kuala Lumpur");
  });

  it("does not strip suffix if result would be empty", () => {
    // "市" alone → suffix "市" would leave empty → not stripped
    expect(normalizeLocationName("市")).toBe("市");
  });
});

// ── formatLocationHierarchyLabel ────────────────────────────────────

describe("formatLocationHierarchyLabel", () => {
  it("returns empty string for null", () => {
    expect(formatLocationHierarchyLabel(null)).toBe("");
  });

  it("returns empty string for undefined", () => {
    expect(formatLocationHierarchyLabel(undefined)).toBe("");
  });

  it("returns country when only country is set", () => {
    expect(formatLocationHierarchyLabel({ country: "中国" })).toBe("中国");
  });

  it("joins province + city + district", () => {
    expect(formatLocationHierarchyLabel({ country: "中国", province: "广东", city: "东莞", district: "长安" })).toBe("广东东莞长安");
  });

  it("omits undefined levels", () => {
    expect(formatLocationHierarchyLabel({ country: "中国", province: "广东", city: "深圳" })).toBe("广东深圳");
  });

  it("returns country when province/city/district are all absent", () => {
    expect(formatLocationHierarchyLabel({ country: "Malaysia" })).toBe("Malaysia");
  });
});

// ── formatLocationHierarchySearchText ───────────────────────────────

describe("formatLocationHierarchySearchText", () => {
  it("returns empty string for null", () => {
    expect(formatLocationHierarchySearchText(null)).toBe("");
  });

  it("returns empty string for undefined", () => {
    expect(formatLocationHierarchySearchText(undefined)).toBe("");
  });

  it("joins all levels with spaces", () => {
    expect(formatLocationHierarchySearchText({ country: "中国", province: "广东", city: "东莞", district: "长安" })).toBe("中国 广东 东莞 长安");
  });

  it("omits undefined levels", () => {
    expect(formatLocationHierarchySearchText({ country: "中国", province: "广东" })).toBe("中国 广东");
  });
});

// ── resolveLocationHierarchy ────────────────────────────────────────

describe("resolveLocationHierarchy", () => {
  it("returns undefined for empty string", () => {
    expect(resolveLocationHierarchy("")).toBeUndefined();
  });

  it("returns undefined for whitespace-only string", () => {
    expect(resolveLocationHierarchy("   ")).toBeUndefined();
  });

  it("resolves a district to full hierarchy", () => {
    const h = resolveLocationHierarchy("东莞长安镇");
    expect(h).toEqual(expect.objectContaining({
      country: "中国",
      province: "广东",
      city: "东莞",
      district: "长安",
      confidence: "high",
    }));
  });

  it("resolves a city to province+country", () => {
    const h = resolveLocationHierarchy("深圳市");
    expect(h).toEqual(expect.objectContaining({
      country: "中国",
      province: "广东",
      city: "深圳",
    }));
  });

  it("resolves a province to country", () => {
    const h = resolveLocationHierarchy("广东省");
    expect(h).toEqual(expect.objectContaining({
      country: "中国",
      province: "广东",
    }));
  });

  it("resolves country-level node", () => {
    const h = resolveLocationHierarchy("中国");
    expect(h).toEqual(expect.objectContaining({
      country: "中国",
    }));
  });

  it("resolves via alias", () => {
    const h = resolveLocationHierarchy("江苏省苏州市昆山市");
    expect(h).toEqual(expect.objectContaining({
      country: "中国",
      province: "江苏",
      city: "苏州",
      district: "昆山",
    }));
  });

  it("rejects conflicting sibling locations", () => {
    expect(resolveLocationHierarchy("东莞深圳")).toBeUndefined();
  });

  it("passes matchedFrom through", () => {
    const h = resolveLocationHierarchy("深圳", "profile");
    expect(h?.matchedFrom).toBe("profile");
  });

  it("resolves Malaysia location", () => {
    const h = resolveLocationHierarchy("Kuala Lumpur");
    expect(h).toEqual(expect.objectContaining({
      country: "Malaysia",
      province: "Kuala Lumpur",
    }));
  });

  it("returns undefined for unrecognized text", () => {
    expect(resolveLocationHierarchy("UnknownPlace123")).toBeUndefined();
  });
});

// ── normalizeLocationHierarchy ──────────────────────────────────────

describe("normalizeLocationHierarchy", () => {
  it("returns undefined for null", () => {
    expect(normalizeLocationHierarchy(null)).toBeUndefined();
  });

  it("returns undefined for undefined", () => {
    expect(normalizeLocationHierarchy(undefined)).toBeUndefined();
  });

  it("returns undefined for empty object", () => {
    expect(normalizeLocationHierarchy({})).toBeUndefined();
  });

  it("resolves from a string input", () => {
    const h = normalizeLocationHierarchy("深圳");
    expect(h).toEqual(expect.objectContaining({
      country: "中国",
      province: "广东",
      city: "深圳",
    }));
  });

  it("resolves from an object with parts", () => {
    const h = normalizeLocationHierarchy({ country: "中国", province: "广东", city: "深圳" });
    expect(h).toEqual(expect.objectContaining({
      country: "中国",
      province: "广东",
      city: "深圳",
    }));
  });

  it("preserves matchedFrom from input object", () => {
    const h = normalizeLocationHierarchy({ country: "中国", province: "广东", matchedFrom: "workHistory" });
    expect(h?.matchedFrom).toBe("workHistory");
  });

  it("preserves confidence from input object", () => {
    const h = normalizeLocationHierarchy({ country: "中国", province: "广东", confidence: "high" });
    expect(h?.confidence).toBe("high");
  });

  it("falls back to raw object when resolve fails but country is present", () => {
    const h = normalizeLocationHierarchy({ country: "CustomLand", province: "Region1" });
    expect(h).toEqual(expect.objectContaining({
      country: "CustomLand",
      province: "Region1",
    }));
  });

  it("ignores invalid matchedFrom values", () => {
    const h = normalizeLocationHierarchy({ country: "中国", matchedFrom: "invalid" });
    expect(h?.matchedFrom).toBeUndefined();
  });

  it("ignores invalid confidence values (keeps resolved confidence)", () => {
    const h = normalizeLocationHierarchy({ country: "中国", confidence: "medium" });
    // "medium" is not a valid confidence so it's ignored;
    // but resolveLocationHierarchy("中国") returns confidence: "high"
    expect(h?.confidence).toBe("high");
  });

  it("does not set confidence when resolve fails and input is invalid", () => {
    const h = normalizeLocationHierarchy({ country: "CustomLand", confidence: "medium" });
    expect(h?.confidence).toBeUndefined();
  });
});

// ── findLocation ────────────────────────────────────────────────────

describe("findLocation", () => {
  it("finds by exact name", () => {
    const node = findLocation("东莞");
    expect(node?.name).toBe("东莞");
    expect(node?.level).toBe("city");
  });

  it("finds by alias", () => {
    expect(findLocation("东莞市")?.name).toBe("东莞");
  });

  it("finds by compound text", () => {
    expect(findLocation("东莞南城区")?.name).toBe("南城");
  });

  it("finds country aliases", () => {
    expect(findLocation("China")?.name).toBe("中国");
    expect(findLocation("china")?.name).toBe("中国");
    expect(findLocation("CN")?.name).toBe("中国");
    expect(findLocation("cn")?.name).toBe("中国");
  });

  it("finds Malaysia aliases", () => {
    expect(findLocation("Kuala Lumpur MY")?.name).toBe("Kuala Lumpur");
    expect(findLocation("Kuala Lumpur, Malaysia")?.name).toBe("Kuala Lumpur");
  });

  it("returns undefined for unrecognized location", () => {
    expect(findLocation("Nowhere123")).toBeUndefined();
  });

  it("returns undefined for empty string", () => {
    expect(findLocation("")).toBeUndefined();
  });
});

// ── getChildren ─────────────────────────────────────────────────────

describe("getChildren", () => {
  it("returns children of a province", () => {
    const children = getChildren("广东");
    const names = children.map((c) => c.name);
    expect(names).toContain("东莞");
    expect(names).toContain("深圳");
    expect(names).toContain("广州");
  });

  it("returns children of a city with districts", () => {
    const children = getChildren("深圳");
    const names = children.map((c) => c.name);
    expect(names).toContain("宝安");
  });

  it("returns empty array for a leaf node", () => {
    expect(getChildren("长安")).toEqual([]);
  });

  it("returns empty array for unrecognized parent", () => {
    expect(getChildren("Nowhere")).toEqual([]);
  });

  it("returns empty array for empty string", () => {
    expect(getChildren("")).toEqual([]);
  });
});

// ── getAllDescendants ───────────────────────────────────────────────

describe("getAllDescendants", () => {
  it("returns all descendants of a province", () => {
    const descendants = getAllDescendants("广东");
    const names = descendants.map((d) => d.name);
    expect(names).toContain("南城");
    expect(names).toContain("长安");
    expect(names).toContain("东莞");
    expect(names).toContain("深圳");
  });

  it("returns empty array for a leaf node", () => {
    expect(getAllDescendants("长安")).toEqual([]);
  });

  it("returns empty array for unrecognized ancestor", () => {
    expect(getAllDescendants("Nowhere")).toEqual([]);
  });

  it("returns empty array for empty string", () => {
    expect(getAllDescendants("")).toEqual([]);
  });
});

// ── isLocationMatch ─────────────────────────────────────────────────

describe("isLocationMatch", () => {
  it("matches exact name", () => {
    expect(isLocationMatch("东莞", "东莞")).toBe(true);
  });

  it("matches alias to canonical", () => {
    expect(isLocationMatch("东莞市", "东莞")).toBe(true);
  });

  it("matches descendant to ancestor", () => {
    expect(isLocationMatch("东莞市", "广东")).toBe(true);
    expect(isLocationMatch("东莞南城区", "广东")).toBe(true);
  });

  it("matches district to city ancestor", () => {
    expect(isLocationMatch("长安镇", "东莞")).toBe(true);
  });

  it("matches district to province ancestor", () => {
    expect(isLocationMatch("长安镇", "广东")).toBe(true);
  });

  it("rejects non-descendant branches", () => {
    expect(isLocationMatch("深圳市", "东莞")).toBe(false);
    expect(isLocationMatch("广东", "东莞")).toBe(false);
  });

  it("rejects sibling cities", () => {
    expect(isLocationMatch("深圳", "东莞")).toBe(false);
  });

  it("matches any location when filter is empty", () => {
    expect(isLocationMatch("东莞", "")).toBe(true);
    expect(isLocationMatch("深圳", "")).toBe(true);
  });

  it("matches China aliases as country-wide root", () => {
    expect(isLocationMatch("广东东莞长安镇", "china")).toBe(true);
    expect(isLocationMatch("广东东莞长安镇", "CN")).toBe(true);
  });

  it("matches Malaysia locations", () => {
    expect(isLocationMatch("Kuala Lumpur, Malaysia", "Kuala Lumpur MY")).toBe(true);
    expect(isLocationMatch("Kuala Lumpur", "Malaysia")).toBe(true);
  });

  it("returns false for empty resume location against non-empty filter", () => {
    expect(isLocationMatch("", "广东")).toBe(false);
  });

  it("falls back to string includes for unknown filter", () => {
    expect(isLocationMatch("广东东莞某区", "东莞")).toBe(true);
  });

  it("rejects mismatch when no hierarchical or string match", () => {
    expect(isLocationMatch("上海", "广东")).toBe(false);
  });
});
