/**
 * Tests for custom-keyword-service.ts — pure parse/normalize functions.
 *
 * The CustomKeywordService class (fs/JSON5/cache) is NOT covered here;
 * only the exported pure functions that parse and normalize config data.
 */
import { describe, expect, it } from "vitest";
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
} from "../services/custom-keyword-service.js";

// ---------------------------------------------------------------------------
// parseKeywordMarket
// ---------------------------------------------------------------------------

describe("parseKeywordMarket", () => {
  it("returns 'CN' for 'CN'", () => {
    expect(parseKeywordMarket("CN")).toBe("CN");
  });

  it("returns 'MY' for 'MY'", () => {
    expect(parseKeywordMarket("MY")).toBe("MY");
  });

  it("returns null for unknown string", () => {
    expect(parseKeywordMarket("US")).toBeNull();
  });

  it("returns null for non-string", () => {
    expect(parseKeywordMarket(123)).toBeNull();
    expect(parseKeywordMarket(null)).toBeNull();
    expect(parseKeywordMarket(undefined)).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// parseMarketList
// ---------------------------------------------------------------------------

describe("parseMarketList", () => {
  it("deduplicates and returns valid markets", () => {
    expect(parseMarketList(["CN", "MY", "CN"])).toEqual(["CN", "MY"]);
  });

  it("returns undefined for empty array after filtering", () => {
    expect(parseMarketList(["US", "UK"])).toBeUndefined();
  });

  it("returns undefined for non-array", () => {
    expect(parseMarketList("CN")).toBeUndefined();
    expect(parseMarketList(null)).toBeUndefined();
  });

  it("returns single-element array for single valid market", () => {
    expect(parseMarketList(["MY"])).toEqual(["MY"]);
  });
});

// ---------------------------------------------------------------------------
// parseVisible
// ---------------------------------------------------------------------------

describe("parseVisible", () => {
  it("returns true for true", () => {
    expect(parseVisible(true)).toBe(true);
  });

  it("returns false for false", () => {
    expect(parseVisible(false)).toBe(false);
  });

  it("returns undefined for non-boolean", () => {
    expect(parseVisible(1)).toBeUndefined();
    expect(parseVisible("true")).toBeUndefined();
    expect(parseVisible(null)).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// parseWorkflowCollectionSource
// ---------------------------------------------------------------------------

describe("parseWorkflowCollectionSource", () => {
  it("parses valid source with exactUrl", () => {
    expect(parseWorkflowCollectionSource({ type: "job5156", exactUrl: "  https://example.com  " })).toEqual({
      type: "job5156",
      exactUrl: "https://example.com",
    });
  });

  it("parses valid source without exactUrl", () => {
    expect(parseWorkflowCollectionSource({ type: "51job" })).toEqual({ type: "51job" });
  });

  it("parses seek type", () => {
    expect(parseWorkflowCollectionSource({ type: "seek" })).toEqual({ type: "seek" });
  });

  it("returns null for invalid type", () => {
    expect(parseWorkflowCollectionSource({ type: "indeed" })).toBeNull();
  });

  it("returns null for non-object", () => {
    expect(parseWorkflowCollectionSource(null)).toBeNull();
    expect(parseWorkflowCollectionSource("job5156")).toBeNull();
    expect(parseWorkflowCollectionSource(undefined)).toBeNull();
  });

  it("ignores empty/whitespace exactUrl", () => {
    expect(parseWorkflowCollectionSource({ type: "job5156", exactUrl: "   " })).toEqual({ type: "job5156" });
  });
});

// ---------------------------------------------------------------------------
// parseCustomKeywordTag
// ---------------------------------------------------------------------------

describe("parseCustomKeywordTag", () => {
  it("parses a minimal valid tag", () => {
    expect(parseCustomKeywordTag({ id: "t1", keyword: "CNC", category: "skill" })).toEqual({
      id: "t1",
      keyword: "CNC",
      category: "skill",
    });
  });

  it("parses tag with all optional fields", () => {
    expect(parseCustomKeywordTag({
      id: "t2", keyword: "Python", category: "skill",
      english: "Python", markets: ["CN", "MY"], visible: true,
    })).toEqual({
      id: "t2", keyword: "Python", category: "skill",
      english: "Python", markets: ["CN", "MY"], visible: true,
    });
  });

  it("returns null when required fields are missing", () => {
    expect(parseCustomKeywordTag({ id: "", keyword: "K", category: "c" })).toBeNull();
    expect(parseCustomKeywordTag({ id: "1", keyword: "", category: "c" })).toBeNull();
    expect(parseCustomKeywordTag({ id: "1", keyword: "K", category: "" })).toBeNull();
  });

  it("returns null for non-object", () => {
    expect(parseCustomKeywordTag(null)).toBeNull();
    expect(parseCustomKeywordTag("tag")).toBeNull();
  });

  it("trims whitespace from string fields", () => {
    expect(parseCustomKeywordTag({ id: " t1 ", keyword: " CNC ", category: " skill " })).toEqual({
      id: "t1", keyword: "CNC", category: "skill",
    });
  });

  it("omits english when empty/whitespace", () => {
    const result = parseCustomKeywordTag({ id: "t1", keyword: "K", category: "c", english: "  " });
    expect(result).not.toHaveProperty("english");
  });
});

// ---------------------------------------------------------------------------
// parseWorkflowSeed
// ---------------------------------------------------------------------------

describe("parseWorkflowSeed", () => {
  const validSeed = {
    id: "ws1",
    label: "CNC Operator",
    market: "CN",
    location: "Dongguan",
    keywords: ["CNC", "operator"],
    collectionSource: { type: "job5156" },
  };

  it("parses a valid workflow seed", () => {
    expect(parseWorkflowSeed(validSeed)).toEqual({
      id: "ws1",
      label: "CNC Operator",
      market: "CN",
      location: "Dongguan",
      keywords: ["CNC", "operator"],
      collectionSource: { type: "job5156" },
    });
  });

  it("includes visible when present", () => {
    const result = parseWorkflowSeed({ ...validSeed, visible: true });
    expect(result?.visible).toBe(true);
  });

  it("returns null when required fields are missing", () => {
    expect(parseWorkflowSeed({ ...validSeed, id: "" })).toBeNull();
    expect(parseWorkflowSeed({ ...validSeed, label: "" })).toBeNull();
    expect(parseWorkflowSeed({ ...validSeed, market: "US" })).toBeNull();
    expect(parseWorkflowSeed({ ...validSeed, keywords: [] })).toBeNull();
    expect(parseWorkflowSeed({ ...validSeed, collectionSource: { type: "invalid" } })).toBeNull();
  });

  it("deduplicates and trims keywords", () => {
    const result = parseWorkflowSeed({
      ...validSeed,
      keywords: ["  CNC  ", "operator", "CNC", ""],
    });
    expect(result?.keywords).toEqual(["CNC", "operator"]);
  });

  it("returns null for non-object", () => {
    expect(parseWorkflowSeed(null)).toBeNull();
    expect(parseWorkflowSeed(42)).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// normalizeKeyword
// ---------------------------------------------------------------------------

describe("normalizeKeyword", () => {
  it("trims string input", () => {
    expect(normalizeKeyword("  CNC  ")).toBe("CNC");
  });

  it("returns empty string for non-string", () => {
    expect(normalizeKeyword(123)).toBe("");
    expect(normalizeKeyword(null)).toBe("");
    expect(normalizeKeyword(undefined)).toBe("");
  });
});

// ---------------------------------------------------------------------------
// createSystemLocationId
// ---------------------------------------------------------------------------

describe("createSystemLocationId", () => {
  it("creates province id", () => {
    expect(createSystemLocationId("province", "广东")).toBe("job5156:province:%E5%B9%BF%E4%B8%9C");
  });

  it("creates city id", () => {
    expect(createSystemLocationId("city", "深圳")).toBe("job5156:city:%E6%B7%B1%E5%9C%B3");
  });
});

// ---------------------------------------------------------------------------
// parseSystemLocationItem
// ---------------------------------------------------------------------------

describe("parseSystemLocationItem", () => {
  it("parses a valid city location", () => {
    expect(parseSystemLocationItem({
      id: "loc1", keyword: "深圳", level: "city", visible: true,
    })).toEqual({
      id: "loc1", keyword: "深圳", level: "city", parentKeyword: undefined, visible: true,
    });
  });

  it("parses a province location with parentKeyword", () => {
    expect(parseSystemLocationItem({
      id: "loc2", keyword: "东莞", level: "city", visible: false, parentKeyword: "广东", markets: ["CN"],
    })).toEqual({
      id: "loc2", keyword: "东莞", level: "city", parentKeyword: "广东", visible: false, markets: ["CN"],
    });
  });

  it("returns null when required fields are missing", () => {
    expect(parseSystemLocationItem({ id: "", keyword: "K", level: "city", visible: true })).toBeNull();
    expect(parseSystemLocationItem({ id: "1", keyword: "", level: "city", visible: true })).toBeNull();
    expect(parseSystemLocationItem({ id: "1", keyword: "K", level: "region", visible: true })).toBeNull();
    expect(parseSystemLocationItem({ id: "1", keyword: "K", level: "city", visible: "yes" })).toBeNull();
  });

  it("returns null for non-object", () => {
    expect(parseSystemLocationItem(null)).toBeNull();
    expect(parseSystemLocationItem("string")).toBeNull();
  });

  it("omits parentKeyword when empty", () => {
    const result = parseSystemLocationItem({
      id: "loc3", keyword: "深圳", level: "city", visible: true, parentKeyword: "  ",
    });
    expect(result?.parentKeyword).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// normalizeConfig
// ---------------------------------------------------------------------------

describe("normalizeConfig", () => {
  it("returns defaults for null/undefined input", () => {
    const result = normalizeConfig(null);
    expect(result.tags).toEqual([]);
    expect(result.categories.length).toBe(1);
    expect(result.categories[0].id).toBe("custom");
    expect(result.systemLocations).toEqual([]);
    expect(result.workflowSeeds).toEqual([]);
  });

  it("returns defaults for non-object input", () => {
    const result = normalizeConfig("string");
    expect(result.tags).toEqual([]);
  });

  it("parses valid config with tags, categories, locations, seeds", () => {
    const result = normalizeConfig({
      tags: [{ id: "t1", keyword: "CNC", category: "skill" }],
      categories: [{ id: "cat1", name: "技能", icon: "🔧" }],
      systemLocations: [{ id: "loc1", keyword: "深圳", level: "city", visible: true }],
      workflowSeeds: [{
        id: "ws1", label: "Test", market: "CN", location: "SZ",
        keywords: ["CNC"], collectionSource: { type: "job5156" },
      }],
    });

    expect(result.tags.length).toBe(1);
    expect(result.tags[0].keyword).toBe("CNC");
    expect(result.categories.length).toBe(1);
    expect(result.categories[0].name).toBe("技能");
    expect(result.systemLocations.length).toBe(1);
    expect(result.workflowSeeds.length).toBe(1);
  });

  it("uses default categories when none provided", () => {
    const result = normalizeConfig({ tags: [], systemLocations: [], workflowSeeds: [] });
    expect(result.categories.length).toBe(1);
    expect(result.categories[0].id).toBe("custom");
  });

  it("filters invalid tags silently", () => {
    const result = normalizeConfig({
      tags: [
        { id: "valid", keyword: "K", category: "c" },
        { id: "", keyword: "X", category: "c" },
        null,
        "invalid",
      ],
    });
    expect(result.tags.length).toBe(1);
    expect(result.tags[0].id).toBe("valid");
  });

  it("skips categories missing id or name", () => {
    const result = normalizeConfig({
      categories: [
        { id: "c1", name: "Valid" },
        { id: "", name: "NoId" },
        { id: "c3", name: "" },
      ],
    });
    expect(result.categories.length).toBe(1);
    expect(result.categories[0].id).toBe("c1");
  });
});
