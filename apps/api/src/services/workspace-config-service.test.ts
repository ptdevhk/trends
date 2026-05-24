import { describe, expect, it } from "vitest";

import {
  mergeItemsById,
  mergeUnknown,
  parseCustomKeywordCategory,
  parseCustomKeywordTag,
  parseFilterPreset,
  parseFilterPresetsConfig,
  parseLearningLogConfig,
  parseLearningLogEntry,
  parseMarkets,
  parsePresetCategory,
  parseSummaryChannel,
  parseSummaryPeriod,
  parseSummaryProfileRecord,
  parseSummaryProfilesConfig,
  parseSummaryProfileSchedule,
  parseSystemLocationItem,
  parseVisible,
  parseWorkflowCollectionSource,
  parseWorkflowSeed,
  readBoolean,
  readNumber,
  readString,
} from "./workspace-config-service";

describe("readString", () => {
  it("returns trimmed string for valid strings", () => {
    expect(readString("  hello  ")).toBe("hello");
  });

  it("returns null for empty strings", () => {
    expect(readString("")).toBeNull();
    expect(readString("   ")).toBeNull();
  });

  it("returns null for non-strings", () => {
    expect(readString(42)).toBeNull();
    expect(readString(null)).toBeNull();
    expect(readString(undefined)).toBeNull();
  });
});

describe("readNumber", () => {
  it("returns finite numbers", () => {
    expect(readNumber(42)).toBe(42);
    expect(readNumber(0)).toBe(0);
    expect(readNumber(-3.5)).toBe(-3.5);
  });

  it("returns null for non-finite numbers", () => {
    expect(readNumber(Infinity)).toBeNull();
    expect(readNumber(NaN)).toBeNull();
  });

  it("returns null for non-numbers", () => {
    expect(readNumber("42")).toBeNull();
    expect(readNumber(null)).toBeNull();
  });
});

describe("readBoolean", () => {
  it("returns booleans", () => {
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
  it("returns deduplicated valid markets", () => {
    expect(parseMarkets(["CN", "MY", "CN"])).toEqual(["CN", "MY"]);
  });

  it("returns undefined for empty result", () => {
    expect(parseMarkets(["US", "UK"])).toBeUndefined();
  });

  it("returns undefined for non-array", () => {
    expect(parseMarkets("CN")).toBeUndefined();
    expect(parseMarkets(null)).toBeUndefined();
  });
});

describe("parseVisible", () => {
  it("returns boolean for valid values", () => {
    expect(parseVisible(true)).toBe(true);
    expect(parseVisible(false)).toBe(false);
  });

  it("returns undefined for non-booleans", () => {
    expect(parseVisible("true")).toBeUndefined();
  });
});

describe("parseWorkflowCollectionSource", () => {
  it("parses valid collection source with type only", () => {
    expect(parseWorkflowCollectionSource({ type: "51job" })).toEqual({ type: "51job" });
  });

  it("parses valid collection source with exactUrl", () => {
    expect(parseWorkflowCollectionSource({ type: "seek", exactUrl: "https://seek.com" })).toEqual({
      type: "seek",
      exactUrl: "https://seek.com",
    });
  });

  it("returns null for invalid type", () => {
    expect(parseWorkflowCollectionSource({ type: "linkedin" })).toBeNull();
  });

  it("returns null for non-record input", () => {
    expect(parseWorkflowCollectionSource("51job")).toBeNull();
  });
});

describe("mergeUnknown", () => {
  it("returns base when override is undefined", () => {
    expect(mergeUnknown({ a: 1 }, undefined)).toEqual({ a: 1 });
  });

  it("returns override for primitive values", () => {
    expect(mergeUnknown("old", "new")).toBe("new");
  });

  it("replaces arrays entirely", () => {
    expect(mergeUnknown([1, 2], [3, 4])).toEqual([3, 4]);
  });

  it("deep merges objects", () => {
    expect(mergeUnknown({ a: 1, b: 2 }, { b: 3, c: 4 })).toEqual({ a: 1, b: 3, c: 4 });
  });

  it("deep merges nested objects", () => {
    expect(mergeUnknown({ a: { x: 1, y: 2 } }, { a: { y: 3 } })).toEqual({ a: { x: 1, y: 3 } });
  });
});

describe("parseSummaryPeriod", () => {
  it("accepts daily and weekly", () => {
    expect(parseSummaryPeriod("daily")).toBe("daily");
    expect(parseSummaryPeriod("weekly")).toBe("weekly");
  });

  it("rejects invalid values", () => {
    expect(parseSummaryPeriod("monthly")).toBeNull();
    expect(parseSummaryPeriod(42)).toBeNull();
  });
});

describe("parseSummaryChannel", () => {
  it("accepts valid channels", () => {
    expect(parseSummaryChannel("email")).toBe("email");
    expect(parseSummaryChannel("feishu")).toBe("feishu");
    expect(parseSummaryChannel("wechat_work")).toBe("wechat_work");
    expect(parseSummaryChannel("telegram")).toBe("telegram");
  });

  it("rejects invalid channels", () => {
    expect(parseSummaryChannel("slack")).toBeNull();
  });
});

describe("parseSummaryProfileSchedule", () => {
  it("parses valid schedule", () => {
    expect(parseSummaryProfileSchedule({ cron: "0 9 * * 1-5" })).toEqual({ cron: "0 9 * * 1-5" });
  });

  it("returns null when cron is missing", () => {
    expect(parseSummaryProfileSchedule({})).toBeNull();
  });

  it("returns null for non-record input", () => {
    expect(parseSummaryProfileSchedule("cron")).toBeNull();
  });
});

describe("parseSummaryProfileRecord", () => {
  const validRecord = {
    id: "profile-1",
    name: "Daily Summary",
    enabled: true,
    schedule: { cron: "0 9 * * *" },
    request: { period: "daily", channel: "email", dryRun: false, to: "admin@example.com" },
  };

  it("parses a valid record", () => {
    const result = parseSummaryProfileRecord(validRecord);
    expect(result).not.toBeNull();
    expect(result!.id).toBe("profile-1");
    expect(result!.name).toBe("Daily Summary");
    expect(result!.enabled).toBe(true);
  });

  it("returns null when required fields are missing", () => {
    expect(parseSummaryProfileRecord({ id: "x" })).toBeNull();
    expect(parseSummaryProfileRecord(null)).toBeNull();
  });

  it("returns null when email channel is missing 'to'", () => {
    const record = { ...validRecord, request: { period: "daily", channel: "email", dryRun: false } };
    expect(parseSummaryProfileRecord(record)).toBeNull();
  });
});

describe("parseSummaryProfilesConfig", () => {
  it("returns empty profiles for invalid input", () => {
    expect(parseSummaryProfilesConfig(null)).toEqual({ profiles: [] });
    expect(parseSummaryProfilesConfig("invalid")).toEqual({ profiles: [] });
  });

  it("filters out invalid profile records", () => {
    const result = parseSummaryProfilesConfig({
      profiles: [{ id: "x" }, { id: "p1", name: "Test", enabled: true, schedule: { cron: "0 9 * * *" }, request: { period: "daily", channel: "email", dryRun: false, to: "a@b.c" } }],
    });
    expect(result.profiles).toHaveLength(1);
    expect(result.profiles[0].id).toBe("p1");
  });
});

describe("parseCustomKeywordTag", () => {
  it("parses a valid tag with required fields", () => {
    const result = parseCustomKeywordTag({ id: "t1", keyword: "CNC", category: "industry" });
    expect(result).not.toBeNull();
    expect(result!.id).toBe("t1");
    expect(result!.keyword).toBe("CNC");
    expect(result!.category).toBe("industry");
  });

  it("parses tag with optional fields", () => {
    const result = parseCustomKeywordTag({ id: "t1", keyword: "CNC", category: "industry", english: "CNC Machining", markets: ["CN"], visible: true, source: "system" });
    expect(result!.english).toBe("CNC Machining");
    expect(result!.markets).toEqual(["CN"]);
    expect(result!.visible).toBe(true);
    expect(result!.source).toBe("system");
  });

  it("returns null when required fields are missing", () => {
    expect(parseCustomKeywordTag({ id: "t1" })).toBeNull();
    expect(parseCustomKeywordTag(null)).toBeNull();
  });

  it("ignores invalid source values", () => {
    const result = parseCustomKeywordTag({ id: "t1", keyword: "CNC", category: "industry", source: "unknown" });
    expect(result!.source).toBeUndefined();
  });
});

describe("parseCustomKeywordCategory", () => {
  it("parses a valid category", () => {
    const result = parseCustomKeywordCategory({ id: "c1", name: "Industry", icon: "🏭" });
    expect(result).toEqual({ id: "c1", name: "Industry", icon: "🏭" });
  });

  it("returns null when required fields are missing", () => {
    expect(parseCustomKeywordCategory({ id: "c1" })).toBeNull();
  });
});

describe("parseSystemLocationItem", () => {
  it("parses a valid city location", () => {
    const result = parseSystemLocationItem({ id: "dg", keyword: "东莞", level: "city", visible: true, parentKeyword: "广东" });
    expect(result).not.toBeNull();
    expect(result!.keyword).toBe("东莞");
    expect(result!.level).toBe("city");
    expect(result!.parentKeyword).toBe("广东");
  });

  it("returns null when required fields are missing", () => {
    expect(parseSystemLocationItem({ id: "dg", keyword: "东莞" })).toBeNull();
    expect(parseSystemLocationItem({ id: "dg", keyword: "东莞", level: "state", visible: true })).toBeNull();
  });
});

describe("parseWorkflowSeed", () => {
  it("parses a valid workflow seed", () => {
    const result = parseWorkflowSeed({
      id: "ws1",
      label: "CNC Search",
      market: "CN",
      location: "东莞",
      keywords: ["CNC", "车床"],
      collectionSource: { type: "51job" },
    });
    expect(result).not.toBeNull();
    expect(result!.id).toBe("ws1");
    expect(result!.keywords).toEqual(["CNC", "车床"]);
  });

  it("deduplicates keywords", () => {
    const result = parseWorkflowSeed({
      id: "ws1",
      label: "CNC",
      market: "CN",
      location: "",
      keywords: ["CNC", "CNC", "车床"],
      collectionSource: { type: "51job" },
    });
    expect(result!.keywords).toEqual(["CNC", "车床"]);
  });

  it("returns null when required fields are missing", () => {
    expect(parseWorkflowSeed({ id: "ws1" })).toBeNull();
    expect(parseWorkflowSeed({ id: "ws1", label: "X", market: "CN", keywords: [], collectionSource: { type: "51job" } })).toBeNull();
  });

  it("returns null for invalid market", () => {
    expect(parseWorkflowSeed({ id: "ws1", label: "X", market: "US", keywords: ["a"], collectionSource: { type: "51job" } })).toBeNull();
  });
});

describe("mergeItemsById", () => {
  it("merges items by id with override taking precedence", () => {
    const base = [{ id: "a", value: 1 }, { id: "b", value: 2 }];
    const overrides = [{ id: "a", value: 10 }, { id: "c", value: 3 }];

    const result = mergeItemsById(base, overrides);
    expect(result).toHaveLength(3);
    expect(result.find((i) => i.id === "a")!.value).toBe(10);
    expect(result.find((i) => i.id === "b")!.value).toBe(2);
    expect(result.find((i) => i.id === "c")!.value).toBe(3);
  });

  it("returns base items when no overrides", () => {
    const base = [{ id: "a", value: 1 }];
    expect(mergeItemsById(base, [])).toEqual(base);
  });
});

describe("parseFilterPreset", () => {
  it("parses a valid preset with experience filter", () => {
    const result = parseFilterPreset({
      id: "p1",
      name: "Senior",
      category: "experience",
      filters: { minExperience: 5, maxExperience: null },
    });
    expect(result).not.toBeNull();
    expect(result!.id).toBe("p1");
    expect(result!.filters.minExperience).toBe(5);
    expect(result!.filters.maxExperience).toBeNull();
  });

  it("parses preset with salary range", () => {
    const result = parseFilterPreset({
      id: "p1",
      name: "High Salary",
      category: "salary",
      filters: { salaryRange: { min: 15000, max: 30000 } },
    });
    expect(result!.filters.salaryRange).toEqual({ min: 15000, max: 30000 });
  });

  it("parses preset with education filter", () => {
    const result = parseFilterPreset({
      id: "p1",
      name: "Degree",
      category: "education",
      filters: { education: ["本科", "硕士"] },
    });
    expect(result!.filters.education).toEqual(["本科", "硕士"]);
  });

  it("returns null when required fields are missing", () => {
    expect(parseFilterPreset({ id: "p1" })).toBeNull();
    expect(parseFilterPreset(null)).toBeNull();
  });
});

describe("parsePresetCategory", () => {
  it("parses a valid category", () => {
    const result = parsePresetCategory({ id: "exp", name: "Experience", icon: "⏱" });
    expect(result).toEqual({ id: "exp", name: "Experience", icon: "⏱" });
  });

  it("returns null when required fields are missing", () => {
    expect(parsePresetCategory({ id: "exp" })).toBeNull();
  });
});

describe("parseFilterPresetsConfig", () => {
  it("returns empty config for invalid input", () => {
    expect(parseFilterPresetsConfig(null)).toEqual({ presets: [], categories: [] });
  });

  it("filters out invalid items", () => {
    const result = parseFilterPresetsConfig({
      presets: [{ id: "x" }],
      categories: [{ id: "c1", name: "Cat" }],
    });
    expect(result.presets).toHaveLength(0);
    expect(result.categories).toHaveLength(1);
  });
});

describe("parseLearningLogEntry", () => {
  it("parses a valid entry", () => {
    const result = parseLearningLogEntry({ date: "2026-05-25", observation: "CNC → lathe synonym" });
    expect(result).toEqual({ date: "2026-05-25", observation: "CNC → lathe synonym" });
  });

  it("returns null when required fields are missing", () => {
    expect(parseLearningLogEntry({ date: "2026-05-25" })).toBeNull();
    expect(parseLearningLogEntry(null)).toBeNull();
  });
});

describe("parseLearningLogConfig", () => {
  it("filters out invalid entries", () => {
    const result = parseLearningLogConfig([
      { date: "2026-05-25", observation: "valid" },
      { date: "2026-05-25" },
      "invalid",
    ]);
    expect(result).toHaveLength(1);
    expect(result[0].observation).toBe("valid");
  });

  it("returns empty array for non-array input", () => {
    expect(parseLearningLogConfig("not array")).toEqual([]);
  });
});
