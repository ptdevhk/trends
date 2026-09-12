import { describe, expect, it } from "vitest";
import { resolve } from "node:path";
import { readFileSync } from "node:fs";
import { parse as parseYaml } from "yaml";
import {
  loadResearchPulseKeywordsSeed,
  parseResearchPulseKeywordsSeed,
} from "./research-pulse-keywords-pack.js";

const REPO_ROOT = resolve(import.meta.dirname, "../../../../");

describe("research-pulse-keywords-pack new groups", () => {
  it("loads real seed containing the original 3 groups plus the 6 new industry tag groups", () => {
    const seed = loadResearchPulseKeywordsSeed(REPO_ROOT);
    const groupIds = seed.groups.map((g) => g.id);

    // Original 3 groups
    expect(groupIds).toContain("cnc-core");
    expect(groupIds).toContain("brands");
    expect(groupIds).toContain("hiring-sales");

    // 6 new precision-machinery groups
    expect(groupIds).toContain("machining");
    expect(groupIds).toContain("lathe");
    expect(groupIds).toContain("edm");
    expect(groupIds).toContain("measurement");
    expect(groupIds).toContain("smt");
    expect(groupIds).toContain("3d-printing");

    expect(seed.groups.length).toBe(9);
  });

  it("keeps defaults.enabledGroupIds strictly at [cnc-core, brands, hiring-sales]", () => {
    const rawYaml = readFileSync(resolve(REPO_ROOT, "config/research_pulse_keywords.yaml"), "utf8");
    const doc = parseYaml(rawYaml) as Record<string, unknown>;
    const defaults = doc.defaults as Record<string, unknown>;

    expect(defaults.enabledGroupIds).toEqual(["cnc-core", "brands", "hiring-sales"]);

    const seed = loadResearchPulseKeywordsSeed(REPO_ROOT);
    // defaultKeywords should only be formed from the 3 enabled groups
    const cncCoreGroup = seed.groups.find((g) => g.id === "cnc-core")!;
    const brandsGroup = seed.groups.find((g) => g.id === "brands")!;
    const hiringSalesGroup = seed.groups.find((g) => g.id === "hiring-sales")!;

    const expectedDefaultKws: string[] = [];
    const seen = new Set<string>();
    for (const g of [cncCoreGroup, brandsGroup, hiringSalesGroup]) {
      for (const kw of g.keywords) {
        if (seen.has(kw)) continue;
        seen.add(kw);
        expectedDefaultKws.push(kw);
      }
    }
    expect(seed.defaultKeywords).toEqual(expectedDefaultKws);
  });

  it("verifies all keywords in new groups are non-empty strings and within MAX_KEYWORD_LENGTH", () => {
    const seed = loadResearchPulseKeywordsSeed(REPO_ROOT);
    const newGroupIds = ["machining", "lathe", "edm", "measurement", "smt", "3d-printing"];

    for (const gid of newGroupIds) {
      const group = seed.groups.find((g) => g.id === gid);
      expect(group).toBeDefined();
      expect(group!.label.length).toBeGreaterThan(0);
      expect(group!.keywords.length).toBeGreaterThan(0);

      for (const kw of group!.keywords) {
        expect(typeof kw).toBe("string");
        expect(kw.trim().length).toBeGreaterThan(0);
        expect(kw.trim().length).toBeLessThanOrEqual(32);
      }
    }
  });

  it("matches keywords from keyword-tags.json dataset", () => {
    const seed = loadResearchPulseKeywordsSeed(REPO_ROOT);
    const tagsJson = JSON.parse(
      readFileSync(resolve(REPO_ROOT, "config/industry-data/keyword-tags.json"), "utf8"),
    );

    const checkMapping: Array<{ pulseId: string; tagKey: string }> = [
      { pulseId: "machining", tagKey: "machining" },
      { pulseId: "lathe", tagKey: "lathe" },
      { pulseId: "edm", tagKey: "edm" },
      { pulseId: "measurement", tagKey: "measurement" },
      { pulseId: "smt", tagKey: "smt" },
      { pulseId: "3d-printing", tagKey: "3d_printing" },
    ];

    for (const { pulseId, tagKey } of checkMapping) {
      const group = seed.groups.find((g) => g.id === pulseId)!;
      const expectedKeywords = tagsJson.tags[tagKey].map((e: { keyword: string }) => e.keyword);
      expect(group.keywords).toEqual(expectedKeywords);
    }
  });
});
