import { describe, expect, it } from "vitest";
import { resolve } from "node:path";
import {
  emptyHotlistPlatformsWorkspace,
  loadResearchHotlistPlatformsSeed,
  mergeHotlistPlatforms,
  parseHotlistPlatformsWorkspace,
} from "./research-hotlist-platforms.js";

const REPO_ROOT = resolve(import.meta.dirname, "../../../../");

describe("research-hotlist-platforms", () => {
  it("loads seed with catalog + defaults", () => {
    const seed = loadResearchHotlistPlatformsSeed(REPO_ROOT);
    expect(seed.defaults).toContain("weibo");
    expect(seed.defaults).toContain("cls-hot");
    expect(seed.catalogIds).toContain("bilibili-hot-search");
    expect(seed.groups.length).toBeGreaterThanOrEqual(3);
  });

  it("merge: empty workspace → defaults", () => {
    const seed = loadResearchHotlistPlatformsSeed(REPO_ROOT);
    expect(mergeHotlistPlatforms(seed, emptyHotlistPlatformsWorkspace())).toEqual(seed.defaults);
  });

  it("merge: enabled subset; unknown dropped; excluded removed; exclude-all falls back", () => {
    const seed = loadResearchHotlistPlatformsSeed(REPO_ROOT);
    expect(
      mergeHotlistPlatforms(seed, {
        version: 1,
        enabled: ["weibo", "not-a-real-id", "cls-hot"],
        excluded: ["weibo"],
      }),
    ).toEqual(["cls-hot"]);

    const wiped = mergeHotlistPlatforms(seed, {
      version: 1,
      enabled: [],
      excluded: [...seed.defaults],
    });
    expect(wiped).toEqual(seed.defaults);
  });

  it("parseHotlistPlatformsWorkspace tolerates junk", () => {
    expect(parseHotlistPlatformsWorkspace(null)).toEqual(emptyHotlistPlatformsWorkspace());
    expect(
      parseHotlistPlatformsWorkspace({ enabled: [" weibo "], excluded: [1, "x"] }).enabled,
    ).toEqual(["weibo"]);
  });
});
