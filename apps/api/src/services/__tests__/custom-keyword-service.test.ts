import { describe, it, expect } from "vitest";
import {
  parseKeywordMarket,
  parseMarketList,
  parseVisible,
  parseWorkflowCollectionSource,
  parseCustomKeywordTag,
  parseWorkflowSeed,
  normalizeKeyword,
  createSystemLocationId,
  parseSystemLocationItem,
  normalizeConfig,
} from "../custom-keyword-service.js";

describe("parseKeywordMarket", () => {
  it("returns valid markets", () => {
    expect(parseKeywordMarket("CN")).toBe("CN");
    expect(parseKeywordMarket("MY")).toBe("MY");
  });
  it("returns null for invalid", () => {
    expect(parseKeywordMarket("US")).toBeNull();
    expect(parseKeywordMarket(null)).toBeNull();
    expect(parseKeywordMarket("")).toBeNull();
  });
});

describe("parseMarketList", () => {
  it("parses valid market arrays with dedup", () => {
    expect(parseMarketList(["CN", "MY"])).toEqual(["CN", "MY"]);
    expect(parseMarketList(["CN", "CN"])).toEqual(["CN"]);
  });
  it("returns undefined for empty or invalid", () => {
    expect(parseMarketList([])).toBeUndefined();
    expect(parseMarketList(["US"])).toBeUndefined();
    expect(parseMarketList("not-array")).toBeUndefined();
    expect(parseMarketList(null)).toBeUndefined();
  });
});

describe("parseVisible", () => {
  it("returns boolean for boolean input", () => {
    expect(parseVisible(true)).toBe(true);
    expect(parseVisible(false)).toBe(false);
  });
  it("returns undefined for non-boolean", () => {
    expect(parseVisible("true")).toBeUndefined();
    expect(parseVisible(null)).toBeUndefined();
    expect(parseVisible(1)).toBeUndefined();
  });
});

describe("parseWorkflowCollectionSource", () => {
  it("parses valid sources", () => {
    expect(parseWorkflowCollectionSource({ type: "seek" })).toEqual({ type: "seek" });
    expect(parseWorkflowCollectionSource({ type: "51job" })).toEqual({ type: "51job" });
    expect(parseWorkflowCollectionSource({ type: "job5156" })).toEqual({ type: "job5156" });
  });
  it("parses source with exactUrl", () => {
    expect(parseWorkflowCollectionSource({ type: "seek", exactUrl: "https://seek.com" })).toEqual({
      type: "seek",
      exactUrl: "https://seek.com",
    });
  });
  it("ignores empty exactUrl", () => {
    expect(parseWorkflowCollectionSource({ type: "seek", exactUrl: "  " })).toEqual({ type: "seek" });
  });
  it("returns null for invalid types", () => {
    expect(parseWorkflowCollectionSource({ type: "indeed" })).toBeNull();
    expect(parseWorkflowCollectionSource(null)).toBeNull();
    expect(parseWorkflowCollectionSource({})).toBeNull();
  });
});

describe("parseCustomKeywordTag", () => {
  it("parses valid tag with required fields", () => {
    expect(parseCustomKeywordTag({ id: "cnc", keyword: "CNC", category: "role" })).toEqual({
      id: "cnc",
      keyword: "CNC",
      category: "role",
    });
  });
  it("parses tag with optional fields", () => {
    const result = parseCustomKeywordTag({
      id: "cnc", keyword: "CNC", category: "role",
      english: "CNC Machining", markets: ["CN"], visible: true,
    });
    expect(result?.english).toBe("CNC Machining");
    expect(result?.markets).toEqual(["CN"]);
    expect(result?.visible).toBe(true);
  });
  it("trims whitespace from string fields", () => {
    const result = parseCustomKeywordTag({ id: " cnc ", keyword: " CNC ", category: " role " });
    expect(result?.id).toBe("cnc");
    expect(result?.keyword).toBe("CNC");
    expect(result?.category).toBe("role");
  });
  it("returns null for missing required fields", () => {
    expect(parseCustomKeywordTag(null)).toBeNull();
    expect(parseCustomKeywordTag({})).toBeNull();
    expect(parseCustomKeywordTag({ id: "a" })).toBeNull();
    expect(parseCustomKeywordTag({ id: "a", keyword: "b" })).toBeNull();
  });
  it("returns null for empty required fields", () => {
    expect(parseCustomKeywordTag({ id: "", keyword: "CNC", category: "role" })).toBeNull();
    expect(parseCustomKeywordTag({ id: "cnc", keyword: "  ", category: "role" })).toBeNull();
  });
});

describe("parseWorkflowSeed", () => {
  it("parses valid workflow seed", () => {
    const result = parseWorkflowSeed({
      id: "cn-cnc-sales",
      label: "CNC Sales CN",
      market: "CN",
      location: "广东",
      keywords: ["CNC", "销售"],
      collectionSource: { type: "51job" },
    });
    expect(result).toEqual({
      id: "cn-cnc-sales",
      label: "CNC Sales CN",
      market: "CN",
      location: "广东",
      keywords: ["CNC", "销售"],
      collectionSource: { type: "51job" },
    });
  });
  it("deduplicates keywords", () => {
    const result = parseWorkflowSeed({
      id: "a", label: "b", market: "MY", location: "",
      keywords: ["CNC", "CNC", "Sales"], collectionSource: { type: "seek" },
    });
    expect(result?.keywords).toEqual(["CNC", "Sales"]);
  });
  it("parses with visible flag", () => {
    const result = parseWorkflowSeed({
      id: "a", label: "b", market: "CN", location: "",
      keywords: ["x"], collectionSource: { type: "51job" }, visible: false,
    });
    expect(result?.visible).toBe(false);
  });
  it("returns null for missing required fields", () => {
    expect(parseWorkflowSeed(null)).toBeNull();
    expect(parseWorkflowSeed({ id: "a" })).toBeNull();
    expect(parseWorkflowSeed({ id: "a", label: "b", market: "CN", keywords: [], collectionSource: { type: "seek" } })).toBeNull();
    expect(parseWorkflowSeed({ id: "a", label: "b", market: "US", keywords: ["x"], collectionSource: { type: "seek" } })).toBeNull();
    expect(parseWorkflowSeed({ id: "a", label: "b", market: "CN", keywords: ["x"], collectionSource: { type: "invalid" } })).toBeNull();
  });
});

describe("normalizeKeyword", () => {
  it("trims string input", () => {
    expect(normalizeKeyword("  CNC  ")).toBe("CNC");
    expect(normalizeKeyword("销售")).toBe("销售");
  });
  it("returns empty string for non-strings", () => {
    expect(normalizeKeyword(null)).toBe("");
    expect(normalizeKeyword(undefined)).toBe("");
    expect(normalizeKeyword(42)).toBe("");
  });
});

describe("createSystemLocationId", () => {
  it("creates ID from level and keyword", () => {
    expect(createSystemLocationId("province", "广东")).toBe("job5156:province:%E5%B9%BF%E4%B8%9C");
    expect(createSystemLocationId("city", "深圳")).toBe("job5156:city:%E6%B7%B1%E5%9C%B3");
  });
  it("encodes special characters", () => {
    expect(createSystemLocationId("city", "A & B")).toBe("job5156:city:A%20%26%20B");
  });
});

describe("parseSystemLocationItem", () => {
  it("parses valid location item", () => {
    const result = parseSystemLocationItem({
      id: "job5156:city:深圳",
      keyword: "深圳",
      level: "city",
      visible: true,
      parentKeyword: "广东",
    });
    expect(result).toEqual({
      id: "job5156:city:深圳",
      keyword: "深圳",
      level: "city",
      parentKeyword: "广东",
      visible: true,
    });
  });
  it("parses location with markets", () => {
    const result = parseSystemLocationItem({
      id: "loc1", keyword: "KL", level: "city", visible: true, markets: ["MY"],
    });
    expect(result?.markets).toEqual(["MY"]);
  });
  it("handles missing parentKeyword", () => {
    const result = parseSystemLocationItem({
      id: "loc1", keyword: "深圳", level: "city", visible: true,
    });
    expect(result?.parentKeyword).toBeUndefined();
  });
  it("returns null for invalid level", () => {
    expect(parseSystemLocationItem({ id: "a", keyword: "b", level: "country", visible: true })).toBeNull();
  });
  it("returns null for missing fields", () => {
    expect(parseSystemLocationItem(null)).toBeNull();
    expect(parseSystemLocationItem({})).toBeNull();
    expect(parseSystemLocationItem({ id: "a", keyword: "b", level: "city" })).toBeNull();
  });
});

describe("normalizeConfig", () => {
  it("parses valid config with all sections", () => {
    const result = normalizeConfig({
      tags: [{ id: "cnc", keyword: "CNC", category: "role" }],
      categories: [{ id: "role", name: "Role" }],
      systemLocations: [],
      workflowSeeds: [{
        id: "cn-cnc", label: "CNC CN", market: "CN", location: "",
        keywords: ["CNC"], collectionSource: { type: "51job" },
      }],
    });
    expect(result.tags).toHaveLength(1);
    expect(result.categories).toHaveLength(1);
    expect(result.workflowSeeds).toHaveLength(1);
    expect(result.systemLocations).toHaveLength(0);
  });
  it("uses default categories when none provided", () => {
    const result = normalizeConfig({ tags: [], systemLocations: [], workflowSeeds: [] });
    expect(result.categories).toEqual([{ id: "custom", name: "自定义", icon: "⚙️" }]);
  });
  it("uses default categories when categories array is empty", () => {
    const result = normalizeConfig({ tags: [], categories: [], systemLocations: [], workflowSeeds: [] });
    expect(result.categories).toEqual([{ id: "custom", name: "自定义", icon: "⚙️" }]);
  });
  it("returns defaults for null/invalid input", () => {
    const result = normalizeConfig(null);
    expect(result.tags).toEqual([]);
    expect(result.categories).toEqual([{ id: "custom", name: "自定义", icon: "⚙️" }]);
  });
  it("filters invalid tags, locations, and seeds", () => {
    const result = normalizeConfig({
      tags: [{ id: "valid", keyword: "V", category: "c" }, { bad: true }],
      systemLocations: [{ bad: true }],
      workflowSeeds: [{ bad: true }],
    });
    expect(result.tags).toHaveLength(1);
    expect(result.systemLocations).toHaveLength(0);
    expect(result.workflowSeeds).toHaveLength(0);
  });
  it("preserves provided categories over defaults", () => {
    const result = normalizeConfig({
      categories: [{ id: "skill", name: "Skill" }],
    });
    expect(result.categories).toEqual([{ id: "skill", name: "Skill" }]);
  });
});
