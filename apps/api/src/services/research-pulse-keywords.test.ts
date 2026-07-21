import { describe, expect, it } from "vitest";
import { resolve } from "node:path";
import {
  emptyPulseKeywordsWorkspace,
  filterNewsByKeywords,
  loadResearchPulseKeywordsSeed,
  mergePulseKeywords,
  normalizePulseKeyword,
  parsePulseKeywordsWorkspace,
  MAX_CUSTOM_KEYWORDS,
  MAX_KEYWORD_LENGTH,
  PULSE_KEYWORDS_CONFIG_KEY,
} from "./research-pulse-keywords.js";

// apps/api/src/services -> monorepo root is four levels up
const REPO_ROOT = resolve(import.meta.dirname, "../../../../");

describe("research-pulse-keywords", () => {
  it("exports config key and custom limits", () => {
    expect(PULSE_KEYWORDS_CONFIG_KEY).toBe("research.pulseKeywords");
    expect(MAX_CUSTOM_KEYWORDS).toBe(20);
    expect(MAX_KEYWORD_LENGTH).toBe(32);
  });

  it("loads real seed with CNC defaults", () => {
    const seed = loadResearchPulseKeywordsSeed(REPO_ROOT);
    expect(seed.defaultKeywords).toContain("发那科");
    expect(seed.defaultKeywords).toContain("数控");
    expect(seed.groups.length).toBeGreaterThanOrEqual(3);
  });

  it("merge: seed only when workspace empty", () => {
    const seed = loadResearchPulseKeywordsSeed(REPO_ROOT);
    const eff = mergePulseKeywords(seed, emptyPulseKeywordsWorkspace());
    expect(eff).toEqual(seed.defaultKeywords);
  });

  it("merge: custom additive; excluded removes; exclude-all falls back to seed", () => {
    const seed = loadResearchPulseKeywordsSeed(REPO_ROOT);
    const withCustom = mergePulseKeywords(seed, {
      version: 1,
      enabled: [],
      excluded: [],
      custom: ["刀塔"],
    });
    expect(withCustom).toContain("刀塔");

    const excluded = mergePulseKeywords(seed, {
      version: 1,
      enabled: [],
      excluded: [...seed.defaultKeywords, "刀塔"],
      custom: ["刀塔"],
    });
    expect(excluded).toEqual(seed.defaultKeywords);
  });

  it("merge: enabled is additive beyond seed", () => {
    const seed = loadResearchPulseKeywordsSeed(REPO_ROOT);
    const eff = mergePulseKeywords(seed, {
      version: 1,
      enabled: ["刀塔"],
      excluded: [],
      custom: [],
    });
    expect(eff).toContain("刀塔");
    expect(eff).toEqual(expect.arrayContaining(seed.defaultKeywords));
  });

  it("normalizePulseKeyword trims, NFKC, and lowercases Latin", () => {
    expect(normalizePulseKeyword("  Fanuc  ")).toBe("fanuc");
    expect(normalizePulseKeyword("数控")).toBe("数控");
  });

  it("parsePulseKeywordsWorkspace tolerates missing/invalid raw", () => {
    expect(parsePulseKeywordsWorkspace(null)).toEqual(emptyPulseKeywordsWorkspace());
    expect(parsePulseKeywordsWorkspace({ enabled: ["a"], excluded: 1, custom: [" b "] })).toEqual({
      version: 1,
      enabled: ["a"],
      excluded: [],
      custom: ["b"],
    });
  });

  it("filterNewsByKeywords matches 发那科 and attaches matchedKeywords", () => {
    const items = [
      { title: "发那科推进智能制造", platform: "x", capturedAt: 2 },
      { title: "娱乐八卦无关", platform: "x", capturedAt: 1 },
    ];
    const hits = filterNewsByKeywords(items, ["发那科", "数控"]);
    expect(hits).toHaveLength(1);
    expect(hits[0]!.matchedKeywords).toContain("发那科");
  });

  it("filterNewsByKeywords Latin case-insensitive and snippet match", () => {
    const items = [
      { title: "Market update", rawSnippet: "FANUC expands plant", snippet: "ignored when raw present" },
      { title: "No hit here", snippet: "nothing industrial" },
    ];
    const hits = filterNewsByKeywords(items, ["fanuc"]);
    expect(hits).toHaveLength(1);
    expect(hits[0]!.matchedKeywords).toEqual(["fanuc"]);
  });
});
