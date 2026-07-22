import { workspaceConfigService } from "./workspace-config-service.js";
import {
  HOTLIST_PLATFORMS_CONFIG_KEY,
  MAX_ENABLED_PLATFORMS,
  MAX_PLATFORM_ID_LENGTH,
  emptyHotlistPlatformsWorkspace,
  loadResearchHotlistPlatformsSeed,
  mergeHotlistPlatforms,
  parseHotlistPlatformsWorkspace,
  type HotlistPlatformsSeed,
  type HotlistPlatformsWorkspaceValue,
} from "./research-hotlist-platforms.js";

export class HotlistPlatformsValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "HotlistPlatformsValidationError";
  }
}

export type HotlistPlatformsState = {
  seed: HotlistPlatformsSeed;
  workspace: HotlistPlatformsWorkspaceValue;
  effective: string[];
};

function sanitizePlatformList(raw: unknown, field: string, catalog: Set<string>): string[] {
  if (raw === undefined) {
    return [];
  }
  if (!Array.isArray(raw)) {
    throw new HotlistPlatformsValidationError(`${field} must be an array of strings`);
  }
  const out: string[] = [];
  const seen = new Set<string>();
  for (const item of raw) {
    if (typeof item !== "string") {
      throw new HotlistPlatformsValidationError(`${field} must be an array of strings`);
    }
    const trimmed = item.trim();
    if (!trimmed) continue;
    if (trimmed.length > MAX_PLATFORM_ID_LENGTH) {
      throw new HotlistPlatformsValidationError(
        `${field} platform id exceeds max length of ${MAX_PLATFORM_ID_LENGTH}`,
      );
    }
    if (!catalog.has(trimmed)) {
      throw new HotlistPlatformsValidationError(`${field} contains unknown platform id: ${trimmed}`);
    }
    if (seen.has(trimmed)) continue;
    seen.add(trimmed);
    out.push(trimmed);
  }
  if (out.length > MAX_ENABLED_PLATFORMS) {
    throw new HotlistPlatformsValidationError(
      `${field} exceeds max of ${MAX_ENABLED_PLATFORMS} platforms`,
    );
  }
  return out;
}

export async function getHotlistPlatformsState(
  workspaceSlug: string,
): Promise<HotlistPlatformsState> {
  const seed = loadResearchHotlistPlatformsSeed();
  let raw: unknown;
  try {
    raw = await workspaceConfigService.getWorkspaceConfigValue(
      workspaceSlug,
      HOTLIST_PLATFORMS_CONFIG_KEY,
    );
  } catch {
    raw = undefined;
  }
  const workspace = parseHotlistPlatformsWorkspace(raw);
  const effective = mergeHotlistPlatforms(seed, workspace);
  return { seed, workspace, effective };
}

export async function putHotlistPlatforms(
  workspaceSlug: string,
  body: { enabled?: string[]; excluded?: string[] },
): Promise<HotlistPlatformsState> {
  const current = await getHotlistPlatformsState(workspaceSlug);
  const catalog = new Set(current.seed.catalogIds);

  const next: HotlistPlatformsWorkspaceValue = {
    version: 1,
    enabled:
      body.enabled !== undefined
        ? sanitizePlatformList(body.enabled, "enabled", catalog)
        : current.workspace.enabled,
    excluded:
      body.excluded !== undefined
        ? sanitizePlatformList(body.excluded, "excluded", catalog)
        : current.workspace.excluded,
  };

  await workspaceConfigService.setWorkspaceConfigValue(
    workspaceSlug,
    HOTLIST_PLATFORMS_CONFIG_KEY,
    next,
  );

  const seed = loadResearchHotlistPlatformsSeed();
  const effective = mergeHotlistPlatforms(seed, next);
  return { seed, workspace: next, effective };
}

export { emptyHotlistPlatformsWorkspace };
