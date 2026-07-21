import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { parse as parseYaml } from "yaml";

export type PulseKeywordGroup = {
  id: string;
  label: string;
  keywords: string[];
};

export type PulseKeywordsSeed = {
  version: string;
  groups: PulseKeywordGroup[];
  defaultKeywords: string[];
};

function parseGroup(raw: unknown, label: string): PulseKeywordGroup {
  if (!raw || typeof raw !== "object") {
    throw new Error(`Invalid pulse keyword group in ${label}`);
  }
  const row = raw as Record<string, unknown>;
  const id = typeof row.id === "string" ? row.id.trim() : "";
  const groupLabel = typeof row.label === "string" ? row.label.trim() : "";
  if (!id || !groupLabel) {
    throw new Error(`Pulse keyword group in ${label} requires id and label`);
  }
  const keywordsRaw = Array.isArray(row.keywords) ? row.keywords : [];
  const keywords = keywordsRaw
    .filter((k): k is string => typeof k === "string" && k.trim().length > 0)
    .map((k) => k.trim());
  if (keywords.length === 0) {
    throw new Error(`Pulse keyword group ${id} needs at least one keyword`);
  }
  return { id, label: groupLabel, keywords };
}

export function parseResearchPulseKeywordsSeed(doc: unknown): PulseKeywordsSeed {
  if (!doc || typeof doc !== "object") {
    throw new Error("Pulse keywords seed must be an object");
  }
  const root = doc as Record<string, unknown>;
  const version = typeof root.version === "string" && root.version.trim() ? root.version.trim() : "v1";
  const groups = (Array.isArray(root.groups) ? root.groups : []).map((g, i) =>
    parseGroup(g, `groups[${i}]`),
  );
  if (groups.length === 0) {
    throw new Error("Pulse keywords seed requires at least one group");
  }

  const defaults =
    root.defaults && typeof root.defaults === "object"
      ? (root.defaults as Record<string, unknown>)
      : {};
  const enabledGroupIds = Array.isArray(defaults.enabledGroupIds)
    ? defaults.enabledGroupIds
        .filter((id): id is string => typeof id === "string" && id.trim().length > 0)
        .map((id) => id.trim())
    : groups.map((g) => g.id);

  const byId = new Map(groups.map((g) => [g.id, g]));
  const defaultKeywords: string[] = [];
  const seen = new Set<string>();
  for (const groupId of enabledGroupIds) {
    const group = byId.get(groupId);
    if (!group) {
      throw new Error(`Pulse keywords defaults.enabledGroupIds references unknown group: ${groupId}`);
    }
    for (const kw of group.keywords) {
      // Unique by display form in seed order (CJK identity; Latin later normalized at merge)
      if (seen.has(kw)) continue;
      seen.add(kw);
      defaultKeywords.push(kw);
    }
  }
  if (defaultKeywords.length === 0) {
    throw new Error("Pulse keywords seed defaultKeywords must be non-empty");
  }

  return { version, groups, defaultKeywords };
}

function defaultProjectRoot(): string {
  const cwd = resolve(process.cwd());
  try {
    readFileSync(resolve(cwd, "config/research_pulse_keywords.yaml"), "utf8");
    return cwd;
  } catch {
    const candidate = resolve(cwd, "../..");
    try {
      readFileSync(resolve(candidate, "config/research_pulse_keywords.yaml"), "utf8");
      return candidate;
    } catch {
      return cwd;
    }
  }
}

export function loadResearchPulseKeywordsSeed(projectRoot?: string): PulseKeywordsSeed {
  const root = projectRoot ?? defaultProjectRoot();
  const path = resolve(root, "config/research_pulse_keywords.yaml");
  const raw = readFileSync(path, "utf8");
  const doc = parseYaml(raw);
  return parseResearchPulseKeywordsSeed(doc);
}
