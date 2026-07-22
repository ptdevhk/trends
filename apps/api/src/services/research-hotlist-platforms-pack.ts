import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { parse as parseYaml } from "yaml";

export type HotlistPlatform = {
  id: string;
  name: string;
  expectedDomain?: string;
};

export type HotlistPlatformGroup = {
  id: string;
  label: string;
  platforms: HotlistPlatform[];
};

export type HotlistPlatformsSeed = {
  version: string;
  groups: HotlistPlatformGroup[];
  defaults: string[];
  catalogIds: string[];
};

function parsePlatform(raw: unknown, label: string): HotlistPlatform {
  if (!raw || typeof raw !== "object") {
    throw new Error(`Invalid hotlist platform in ${label}`);
  }
  const row = raw as Record<string, unknown>;
  const id = typeof row.id === "string" ? row.id.trim() : "";
  const name = typeof row.name === "string" ? row.name.trim() : "";
  if (!id || !name) {
    throw new Error(`Hotlist platform in ${label} requires id and name`);
  }
  const expectedDomain =
    typeof row.expectedDomain === "string" && row.expectedDomain.trim()
      ? row.expectedDomain.trim()
      : undefined;
  return {
    id,
    name,
    ...(expectedDomain ? { expectedDomain } : {}),
  };
}

function parseGroup(raw: unknown, label: string): HotlistPlatformGroup {
  if (!raw || typeof raw !== "object") {
    throw new Error(`Invalid hotlist platform group in ${label}`);
  }
  const row = raw as Record<string, unknown>;
  const id = typeof row.id === "string" ? row.id.trim() : "";
  const groupLabel = typeof row.label === "string" ? row.label.trim() : "";
  if (!id || !groupLabel) {
    throw new Error(`Hotlist platform group in ${label} requires id and label`);
  }
  const platformsRaw = Array.isArray(row.platforms) ? row.platforms : [];
  const platforms = platformsRaw.map((p, i) => parsePlatform(p, `${label}.platforms[${i}]`));
  if (platforms.length === 0) {
    throw new Error(`Hotlist platform group ${id} needs at least one platform`);
  }
  return { id, label: groupLabel, platforms };
}

export function parseResearchHotlistPlatformsSeed(doc: unknown): HotlistPlatformsSeed {
  if (!doc || typeof doc !== "object") {
    throw new Error("Hotlist platforms seed must be an object");
  }
  const root = doc as Record<string, unknown>;
  const version =
    typeof root.version === "string" && root.version.trim() ? root.version.trim() : "v1";
  const groups = (Array.isArray(root.groups) ? root.groups : []).map((g, i) =>
    parseGroup(g, `groups[${i}]`),
  );
  if (groups.length === 0) {
    throw new Error("Hotlist platforms seed requires at least one group");
  }

  const catalogIds: string[] = [];
  const seen = new Set<string>();
  for (const group of groups) {
    for (const platform of group.platforms) {
      if (seen.has(platform.id)) {
        throw new Error(`Duplicate hotlist platform id in catalog: ${platform.id}`);
      }
      seen.add(platform.id);
      catalogIds.push(platform.id);
    }
  }

  const defaultsRaw = Array.isArray(root.defaults) ? root.defaults : [];
  const defaults = defaultsRaw
    .filter((id): id is string => typeof id === "string" && id.trim().length > 0)
    .map((id) => id.trim());
  if (defaults.length === 0) {
    throw new Error("Hotlist platforms seed defaults must be non-empty");
  }
  for (const id of defaults) {
    if (!seen.has(id)) {
      throw new Error(`Hotlist platforms defaults references unknown id: ${id}`);
    }
  }
  // Preserve catalog order for defaults
  const defaultSet = new Set(defaults);
  const orderedDefaults = catalogIds.filter((id) => defaultSet.has(id));

  return {
    version,
    groups,
    defaults: orderedDefaults,
    catalogIds,
  };
}

function defaultProjectRoot(): string {
  const cwd = resolve(process.cwd());
  try {
    readFileSync(resolve(cwd, "config/research_hotlist_platforms.yaml"), "utf8");
    return cwd;
  } catch {
    const candidate = resolve(cwd, "../..");
    try {
      readFileSync(resolve(candidate, "config/research_hotlist_platforms.yaml"), "utf8");
      return candidate;
    } catch {
      return cwd;
    }
  }
}

export function loadResearchHotlistPlatformsSeed(projectRoot?: string): HotlistPlatformsSeed {
  const root = projectRoot ?? defaultProjectRoot();
  const path = resolve(root, "config/research_hotlist_platforms.yaml");
  const raw = readFileSync(path, "utf8");
  const doc = parseYaml(raw);
  return parseResearchHotlistPlatformsSeed(doc);
}
