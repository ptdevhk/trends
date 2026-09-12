import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { MAX_KEYWORD_LENGTH } from "../../apps/api/src/services/research-pulse-keywords.js";
import {
  buildKeywordTags,
  generateKeywordTagsJson,
  KEYWORD_TAG_CATEGORIES,
  type KeywordTagsFile,
} from "./build-keyword-tags.js";

const REPO_ROOT = resolve(import.meta.dirname, "../../");
const SOURCE_PATH = resolve(REPO_ROOT, "config/industry-data/keywords-structured.md");
const ARTIFACT_PATH = resolve(REPO_ROOT, "config/industry-data/keyword-tags.json");

describe("keyword-tags drift and schema validation", () => {
  it("defines all six precision-machinery categories", () => {
    expect(KEYWORD_TAG_CATEGORIES).toEqual([
      "machining",
      "lathe",
      "edm",
      "measurement",
      "smt",
      "3d_printing",
    ]);
  });

  it("regenerating matches byte-identical keyword-tags.json on disk", () => {
    const diskContent = readFileSync(ARTIFACT_PATH, "utf-8");
    const regenerated = generateKeywordTagsJson(SOURCE_PATH);
    expect(regenerated).toBe(diskContent);
  });

  it("all six categories are present with >0 entries and match expected parsed counts", () => {
    const data = buildKeywordTags(SOURCE_PATH);
    expect(data.version).toBe("v1");
    expect(data.source).toBe("config/industry-data/keywords-structured.md");

    const categories = Object.keys(data.tags);
    expect(categories.sort()).toEqual([...KEYWORD_TAG_CATEGORIES].sort());

    // Verify per-tag counts match table counts
    expect(data.tags.machining.length).toBe(20);
    expect(data.tags.lathe.length).toBe(22);
    expect(data.tags.edm.length).toBe(6);
    expect(data.tags.measurement.length).toBe(20);
    expect(data.tags.smt.length).toBe(8);
    expect(data.tags["3d_printing"].length).toBe(2);

    for (const cat of KEYWORD_TAG_CATEGORIES) {
      expect(data.tags[cat].length).toBeGreaterThan(0);
    }
  });

  it("contains no empty, oversized, or duplicate keywords within each tag", () => {
    const data = buildKeywordTags(SOURCE_PATH);

    for (const cat of KEYWORD_TAG_CATEGORIES) {
      const entries = data.tags[cat];
      const seen = new Set<string>();

      for (const entry of entries) {
        expect(entry.keyword).toBeDefined();
        const trimmed = entry.keyword.trim();
        expect(trimmed.length).toBeGreaterThan(0);
        expect(trimmed.length).toBeLessThanOrEqual(MAX_KEYWORD_LENGTH);

        // English is optional, but if present must be non-empty
        if ("english" in entry) {
          expect(entry.english).toBeDefined();
          expect(entry.english!.trim().length).toBeGreaterThan(0);
        }

        // Intra-tag uniqueness
        expect(seen.has(trimmed)).toBe(false);
        seen.add(trimmed);
      }
    }
  });

  it("preserves expected cross-tag intentional duplicates", () => {
    const data = buildKeywordTags(SOURCE_PATH);

    const latheKws = data.tags.lathe.map((e) => e.keyword);
    const edmKws = data.tags.edm.map((e) => e.keyword);
    const machiningKws = data.tags.machining.map((e) => e.keyword);

    // 慢走丝 in lathe and edm
    expect(latheKws).toContain("慢走丝");
    expect(edmKws).toContain("慢走丝");

    // 电火花 in machining and edm
    expect(machiningKws).toContain("电火花");
    expect(edmKws).toContain("电火花");

    // 线切割 in lathe and edm
    expect(latheKws).toContain("线切割");
    expect(edmKws).toContain("线切割");
  });
});
