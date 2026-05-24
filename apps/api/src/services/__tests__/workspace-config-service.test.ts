import { describe, it, expect } from "vitest";
import {
  readString,
  readNumber,
  readBoolean,
  parseMarkets,
  parseVisible,
  parseWorkflowCollectionSource,
  parseWorkspaceConfigEntry,
  mergeUnknown,
  parseSummaryPeriod,
  parseSummaryChannel,
  parseSummaryProfileSchedule,
  parseSummaryProfileRequest,
  parseSummaryProfileRecord,
  parseSummaryProfilesConfig,
  parseCustomKeywordTag,
  parseCustomKeywordCategory,
  parseSystemLocationItem,
  parseWorkflowSeed,
  parseCustomKeywordsConfig,
  mergeItemsById,
  mergeResolvedItemsById,
  parseFilterPreset,
  parsePresetCategory,
  parseFilterPresetsConfig,
  parseLearningLogEntry,
  parseLearningLogConfig,
  parseRuleWeightsConfig,
} from "../workspace-config-service.js";

describe("readString", () => {
  it("returns trimmed string for valid strings", () => {
    expect(readString("hello")).toBe("hello");
    expect(readString("  hello  ")).toBe("hello");
  });
  it("returns null for empty/whitespace/non-strings", () => {
    expect(readString("")).toBeNull();
    expect(readString("   ")).toBeNull();
    expect(readString(null)).toBeNull();
    expect(readString(undefined)).toBeNull();
    expect(readString(42)).toBeNull();
  });
});

describe("readNumber", () => {
  it("returns number for finite numbers", () => {
    expect(readNumber(42)).toBe(42);
    expect(readNumber(0)).toBe(0);
    expect(readNumber(-3.5)).toBe(-3.5);
  });
  it("returns null for non-finite/non-numbers", () => {
    expect(readNumber(Infinity)).toBeNull();
    expect(readNumber(NaN)).toBeNull();
    expect(readNumber("42")).toBeNull();
    expect(readNumber(null)).toBeNull();
  });
});

describe("readBoolean", () => {
  it("returns boolean for booleans", () => {
    expect(readBoolean(true)).toBe(true);
    expect(readBoolean(false)).toBe(false);
  });
  it("returns null for non-booleans", () => {
    expect(readBoolean("true")).toBeNull();
    expect(readBoolean(1)).toBeNull();
    expect(readBoolean(null)).toBeNull();
  });
});

describe("parseMarkets", () => {
  it("returns valid markets with dedup", () => {
    expect(parseMarkets(["CN", "MY"])).toEqual(["CN", "MY"]);
    expect(parseMarkets(["CN", "CN", "MY"])).toEqual(["CN", "MY"]);
  });
  it("returns undefined for invalid/empty arrays", () => {
    expect(parseMarkets([])).toBeUndefined();
    expect(parseMarkets(["US"])).toBeUndefined();
    expect(parseMarkets("not-array")).toBeUndefined();
    expect(parseMarkets(null)).toBeUndefined();
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
  });
});

describe("parseWorkflowCollectionSource", () => {
  it("parses valid sources", () => {
    expect(parseWorkflowCollectionSource({ type: "seek" })).toEqual({ type: "seek" });
    expect(parseWorkflowCollectionSource({ type: "seek", exactUrl: "https://example.com" })).toEqual({
      type: "seek",
      exactUrl: "https://example.com",
    });
    expect(parseWorkflowCollectionSource({ type: "51job" })).toEqual({ type: "51job" });
    expect(parseWorkflowCollectionSource({ type: "job5156" })).toEqual({ type: "job5156" });
  });
  it("returns null for invalid types", () => {
    expect(parseWorkflowCollectionSource({ type: "indeed" })).toBeNull();
    expect(parseWorkflowCollectionSource(null)).toBeNull();
    expect(parseWorkflowCollectionSource({})).toBeNull();
  });
});

describe("parseWorkspaceConfigEntry", () => {
  it("parses valid entries", () => {
    const result = parseWorkspaceConfigEntry({
      workspaceSlug: "default",
      configKey: "custom-keywords",
      configValue: { tags: [] },
      updatedAt: 1234567890,
    });
    expect(result).toEqual({
      workspaceSlug: "default",
      configKey: "custom-keywords",
      configValue: { tags: [] },
      updatedAt: 1234567890,
    });
  });
  it("returns null for missing required fields", () => {
    expect(parseWorkspaceConfigEntry(null)).toBeNull();
    expect(parseWorkspaceConfigEntry({})).toBeNull();
    expect(parseWorkspaceConfigEntry({ workspaceSlug: "a", configKey: "b" })).toBeNull();
  });
});

describe("mergeUnknown", () => {
  it("overrides with non-undefined override", () => {
    expect(mergeUnknown({ a: 1 }, { a: 2 })).toEqual({ a: 2 });
  });
  it("keeps base when override is undefined", () => {
    expect(mergeUnknown({ a: 1 }, { a: undefined })).toEqual({ a: 1 });
  });
  it("deep merges nested objects", () => {
    expect(mergeUnknown({ a: { b: 1, c: 2 } }, { a: { b: 3 } })).toEqual({ a: { b: 3, c: 2 } });
  });
  it("arrays are replaced, not merged", () => {
    expect(mergeUnknown([1, 2], [3])).toEqual([3]);
  });
  it("returns override for primitive types", () => {
    expect(mergeUnknown("a", "b")).toBe("b");
    expect(mergeUnknown(1, 2)).toBe(2);
  });
});

describe("parseSummaryPeriod", () => {
  it("returns valid periods", () => {
    expect(parseSummaryPeriod("daily")).toBe("daily");
    expect(parseSummaryPeriod("weekly")).toBe("weekly");
  });
  it("returns null for invalid", () => {
    expect(parseSummaryPeriod("monthly")).toBeNull();
    expect(parseSummaryPeriod(null)).toBeNull();
  });
});

describe("parseSummaryChannel", () => {
  it("returns valid channels", () => {
    expect(parseSummaryChannel("email")).toBe("email");
    expect(parseSummaryChannel("wechat_work")).toBe("wechat_work");
    expect(parseSummaryChannel("feishu")).toBe("feishu");
    expect(parseSummaryChannel("telegram")).toBe("telegram");
  });
  it("returns null for invalid", () => {
    expect(parseSummaryChannel("slack")).toBeNull();
    expect(parseSummaryChannel(null)).toBeNull();
  });
});

describe("parseSummaryProfileSchedule", () => {
  it("parses valid schedule", () => {
    expect(parseSummaryProfileSchedule({ cron: "0 9 * * 1-5" })).toEqual({ cron: "0 9 * * 1-5" });
  });
  it("returns null for missing cron", () => {
    expect(parseSummaryProfileSchedule({})).toBeNull();
    expect(parseSummaryProfileSchedule(null)).toBeNull();
  });
});

describe("parseSummaryProfileRequest", () => {
  it("parses valid email request", () => {
    const result = parseSummaryProfileRequest({
      period: "daily",
      channel: "email",
      dryRun: false,
      to: "test@example.com",
    });
    expect(result).toEqual({
      period: "daily",
      channel: "email",
      dryRun: false,
      to: "test@example.com",
    });
  });
  it("parses valid wechat_work request without to", () => {
    const result = parseSummaryProfileRequest({
      period: "weekly",
      channel: "wechat_work",
      dryRun: true,
    });
    expect(result).toEqual({
      period: "weekly",
      channel: "wechat_work",
      dryRun: true,
    });
  });
  it("returns null for email without to", () => {
    expect(
      parseSummaryProfileRequest({
        period: "daily",
        channel: "email",
        dryRun: false,
      }),
    ).toBeNull();
  });
  it("returns null for missing required fields", () => {
    expect(parseSummaryProfileRequest(null)).toBeNull();
    expect(parseSummaryProfileRequest({ period: "daily" })).toBeNull();
  });
});

describe("parseSummaryProfileRecord", () => {
  it("parses valid record", () => {
    const result = parseSummaryProfileRecord({
      id: "daily-cn",
      name: "Daily CN Report",
      enabled: true,
      schedule: { cron: "0 9 * * 1-5" },
      request: { period: "daily", channel: "feishu", dryRun: false },
    });
    expect(result).toEqual({
      id: "daily-cn",
      name: "Daily CN Report",
      enabled: true,
      schedule: { cron: "0 9 * * 1-5" },
      request: { period: "daily", channel: "feishu", dryRun: false },
    });
  });
  it("returns null for missing fields", () => {
    expect(parseSummaryProfileRecord(null)).toBeNull();
    expect(parseSummaryProfileRecord({ id: "a" })).toBeNull();
  });
});

describe("parseSummaryProfilesConfig", () => {
  it("parses valid config", () => {
    const result = parseSummaryProfilesConfig({
      profiles: [
        {
          id: "weekly-my",
          name: "Weekly MY Report",
          enabled: true,
          schedule: { cron: "0 9 * * 1" },
          request: { period: "weekly", channel: "email", dryRun: false, to: "hr@example.com" },
        },
      ],
    });
    expect(result.profiles).toHaveLength(1);
    expect(result.profiles[0].id).toBe("weekly-my");
  });
  it("returns empty config for invalid input", () => {
    expect(parseSummaryProfilesConfig(null)).toEqual({ profiles: [] });
    expect(parseSummaryProfilesConfig("invalid")).toEqual({ profiles: [] });
    expect(parseSummaryProfilesConfig({ profiles: "not-array" })).toEqual({ profiles: [] });
  });
});

describe("parseCustomKeywordTag", () => {
  it("parses valid tag", () => {
    const result = parseCustomKeywordTag({
      id: "cnc-sales",
      keyword: "CNC Sales",
      category: "role",
    });
    expect(result).toEqual({
      id: "cnc-sales",
      keyword: "CNC Sales",
      english: undefined,
      category: "role",
    });
  });
  it("parses tag with optional fields", () => {
    const result = parseCustomKeywordTag({
      id: "cnc-sales",
      keyword: "CNC销售",
      english: "CNC Sales",
      category: "role",
      markets: ["CN"],
      visible: true,
      source: "system",
    });
    expect(result?.markets).toEqual(["CN"]);
    expect(result?.visible).toBe(true);
    expect(result?.source).toBe("system");
  });
  it("returns null for missing required fields", () => {
    expect(parseCustomKeywordTag(null)).toBeNull();
    expect(parseCustomKeywordTag({ id: "a" })).toBeNull();
    expect(parseCustomKeywordTag({ id: "a", keyword: "b" })).toBeNull();
  });
});

describe("parseCustomKeywordCategory", () => {
  it("parses valid category", () => {
    expect(parseCustomKeywordCategory({ id: "role", name: "Role" })).toEqual({
      id: "role",
      name: "Role",
      icon: undefined,
    });
  });
  it("returns null for missing required fields", () => {
    expect(parseCustomKeywordCategory(null)).toBeNull();
    expect(parseCustomKeywordCategory({ id: "a" })).toBeNull();
  });
});

describe("parseSystemLocationItem", () => {
  it("parses valid location", () => {
    const result = parseSystemLocationItem({
      id: "shenzhen",
      keyword: "深圳",
      level: "city",
      visible: true,
      parentKeyword: "广东",
    });
    expect(result).toEqual({
      id: "shenzhen",
      keyword: "深圳",
      level: "city",
      parentKeyword: "广东",
      visible: true,
    });
  });
  it("returns null for invalid level", () => {
    expect(
      parseSystemLocationItem({ id: "a", keyword: "b", level: "country", visible: true }),
    ).toBeNull();
  });
  it("returns null for missing fields", () => {
    expect(parseSystemLocationItem(null)).toBeNull();
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
  it("returns null for missing required fields", () => {
    expect(parseWorkflowSeed(null)).toBeNull();
    expect(parseWorkflowSeed({ id: "a" })).toBeNull();
    expect(parseWorkflowSeed({ id: "a", label: "b", market: "CN", keywords: [], collectionSource: { type: "seek" } })).toBeNull();
  });
  it("returns null for invalid market", () => {
    expect(
      parseWorkflowSeed({
        id: "a",
        label: "b",
        market: "US",
        keywords: ["x"],
        collectionSource: { type: "seek" },
      }),
    ).toBeNull();
  });
});

describe("parseCustomKeywordsConfig", () => {
  it("parses valid config", () => {
    const result = parseCustomKeywordsConfig({
      tags: [{ id: "t1", keyword: "k1", category: "c1" }],
      categories: [{ id: "c1", name: "Category 1" }],
      systemLocations: [],
      workflowSeeds: [],
    });
    expect(result.tags).toHaveLength(1);
    expect(result.categories).toHaveLength(1);
  });
  it("returns empty config for invalid input", () => {
    expect(parseCustomKeywordsConfig(null)).toEqual({
      tags: [],
      categories: [],
      systemLocations: [],
      workflowSeeds: [],
    });
  });
});

describe("mergeItemsById", () => {
  it("merges by id with override winning", () => {
    const base = [{ id: "a", value: 1 }, { id: "b", value: 2 }];
    const overrides = [{ id: "a", value: 10 }];
    const result = mergeItemsById(base, overrides);
    expect(result).toEqual([{ id: "a", value: 10 }, { id: "b", value: 2 }]);
  });
  it("adds new items from overrides", () => {
    const base = [{ id: "a", value: 1 }];
    const overrides = [{ id: "b", value: 2 }];
    const result = mergeItemsById(base, overrides);
    expect(result).toHaveLength(2);
  });
  it("returns base when no overrides", () => {
    expect(mergeItemsById([{ id: "a", value: 1 }], [])).toEqual([{ id: "a", value: 1 }]);
  });
});

describe("mergeResolvedItemsById", () => {
  it("assigns system source to base items", () => {
    const result = mergeResolvedItemsById([{ id: "a", value: 1 }], []);
    expect(result[0].source).toBe("system");
  });
  it("assigns workspace source to override items", () => {
    const result = mergeResolvedItemsById([], [{ id: "a", value: 1 }]);
    expect(result[0].source).toBe("workspace");
  });
  it("override items get workspace source", () => {
    const result = mergeResolvedItemsById(
      [{ id: "a", value: 1 }],
      [{ id: "a", value: 10 }],
    );
    expect(result[0].source).toBe("workspace");
    expect(result[0].value).toBe(10);
  });
});

describe("parseFilterPreset", () => {
  it("parses valid preset", () => {
    const result = parseFilterPreset({
      id: "junior-cnc",
      name: "Junior CNC",
      category: "role",
      filters: { minExperience: 1 },
    });
    expect(result).toEqual({
      id: "junior-cnc",
      name: "Junior CNC",
      category: "role",
      filters: { minExperience: 1 },
    });
  });
  it("parses preset with maxExperience null", () => {
    const result = parseFilterPreset({
      id: "p1",
      name: "P1",
      category: "c1",
      filters: { maxExperience: null },
    });
    expect(result?.filters?.maxExperience).toBeNull();
  });
  it("parses preset with salaryRange", () => {
    const result = parseFilterPreset({
      id: "p1",
      name: "P1",
      category: "c1",
      filters: { salaryRange: { min: 5000, max: 10000 } },
    });
    expect(result?.filters?.salaryRange).toEqual({ min: 5000, max: 10000 });
  });
  it("returns null for missing required fields", () => {
    expect(parseFilterPreset(null)).toBeNull();
    expect(parseFilterPreset({ id: "a" })).toBeNull();
  });
});

describe("parsePresetCategory", () => {
  it("parses valid category", () => {
    expect(parsePresetCategory({ id: "role", name: "Role" })).toEqual({
      id: "role",
      name: "Role",
      icon: undefined,
    });
  });
  it("returns null for missing fields", () => {
    expect(parsePresetCategory(null)).toBeNull();
  });
});

describe("parseFilterPresetsConfig", () => {
  it("parses valid config", () => {
    const result = parseFilterPresetsConfig({
      presets: [{ id: "p1", name: "P1", category: "c1", filters: {} }],
      categories: [{ id: "c1", name: "C1" }],
    });
    expect(result.presets).toHaveLength(1);
    expect(result.categories).toHaveLength(1);
  });
  it("returns empty config for invalid input", () => {
    expect(parseFilterPresetsConfig(null)).toEqual({ presets: [], categories: [] });
  });
});

describe("parseLearningLogEntry", () => {
  it("parses valid entry", () => {
    expect(parseLearningLogEntry({ date: "2026-05-22", observation: "Found X" })).toEqual({
      date: "2026-05-22",
      observation: "Found X",
    });
  });
  it("returns null for missing fields", () => {
    expect(parseLearningLogEntry(null)).toBeNull();
    expect(parseLearningLogEntry({ date: "2026-05-22" })).toBeNull();
  });
});

describe("parseLearningLogConfig", () => {
  it("parses valid array", () => {
    const result = parseLearningLogConfig([
      { date: "2026-05-22", observation: "A" },
      { date: "2026-05-21", observation: "B" },
    ]);
    expect(result).toHaveLength(2);
  });
  it("returns empty array for invalid input", () => {
    expect(parseLearningLogConfig(null)).toEqual([]);
    expect(parseLearningLogConfig("invalid")).toEqual([]);
  });
});

describe("parseRuleWeightsConfig", () => {
  it("returns undefined for null input", () => {
    expect(parseRuleWeightsConfig(null)).toBeUndefined();
  });
  it("returns empty object for unknown keys (Zod strips them)", () => {
    // Zod .partial() strips unknown keys but still returns a valid object
    expect(parseRuleWeightsConfig({ invalidKey: true })).toEqual({});
  });
  it("parses valid categoryWeights override", () => {
    const result = parseRuleWeightsConfig({ categoryWeights: { skillMatch: 0.2 } });
    expect(result).toEqual({ categoryWeights: { skillMatch: 0.2 } });
  });
});
