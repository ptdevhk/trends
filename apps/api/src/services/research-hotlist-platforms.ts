export {
  loadResearchHotlistPlatformsSeed,
  type HotlistPlatform,
  type HotlistPlatformGroup,
  type HotlistPlatformsSeed,
} from "./research-hotlist-platforms-pack.js";

import type { HotlistPlatformsSeed } from "./research-hotlist-platforms-pack.js";

export const HOTLIST_PLATFORMS_CONFIG_KEY = "research.hotlistPlatforms";
export const MAX_ENABLED_PLATFORMS = 40;
export const MAX_PLATFORM_ID_LENGTH = 64;

export type HotlistPlatformsWorkspaceValue = {
  version: 1;
  enabled: string[];
  excluded: string[];
};

export function emptyHotlistPlatformsWorkspace(): HotlistPlatformsWorkspaceValue {
  return { version: 1, enabled: [], excluded: [] };
}

function asStringList(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter((v): v is string => typeof v === "string")
    .map((v) => v.trim())
    .filter((v) => v.length > 0);
}

export function parseHotlistPlatformsWorkspace(raw: unknown): HotlistPlatformsWorkspaceValue {
  if (!raw || typeof raw !== "object") {
    return emptyHotlistPlatformsWorkspace();
  }
  const row = raw as Record<string, unknown>;
  return {
    version: 1,
    enabled: asStringList(row.enabled),
    excluded: asStringList(row.excluded),
  };
}

/**
 * Merge seed defaults with workspace overlay.
 * - enabled non-empty → start from enabled ∩ catalog
 * - enabled empty → seed.defaults
 * - drop excluded
 * - empty after exclude → fall back to seed.defaults
 * Catalog order is preserved.
 */
export function mergeHotlistPlatforms(
  seed: HotlistPlatformsSeed,
  workspace: HotlistPlatformsWorkspaceValue,
): string[] {
  const catalog = new Set(seed.catalogIds);
  const baseIds =
    workspace.enabled.length > 0
      ? workspace.enabled.filter((id) => catalog.has(id))
      : [...seed.defaults];
  const baseSet = new Set(baseIds);
  const order = seed.catalogIds.filter((id) => baseSet.has(id));
  const excluded = new Set(workspace.excluded);
  const effective = order.filter((id) => !excluded.has(id));
  if (effective.length === 0) {
    return [...seed.defaults];
  }
  return effective;
}
