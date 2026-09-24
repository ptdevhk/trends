/**
 * Research news-source opt-in/out pack + merge.
 *
 * Source of truth for which `rss:{feed_id}` news feeds are active, shared by
 * worker ingest, daily-report build, and the research hub. Feeds are grouped by
 * topic/brand in `config/research_news_sources.yaml`; feed URLs stay in
 * `config/config.yaml` (never duplicated here).
 *
 * Default-ON / opt-out: empty workspace overlay => every default group ON.
 * Precedence: masterEnabled=false > excludedFeeds > enabledFeeds > group > defaults.
 *
 * NOTE: no node:fs / node:path here — the seed YAML loader lives in
 * `./research-news-sources-seed.ts` (Node-only) so this module stays safe for
 * Vite client bundling and Convex edge-runtime sync.
 */

export type NewsSourceGroup = {
  id: string;
  label: string;
  feeds: string[];
};

export type NewsSourcesSeed = {
  version: string;
  groups: NewsSourceGroup[];
  /** Feed ids in catalog order (unique across all groups). */
  catalogIds: string[];
  /** Group ids defaulted ON (opt-out). */
  defaultGroupIds: string[];
};

export type NewsSourcesWorkspaceValue = {
  version: 1;
  /** Absent/true => master ON. Explicit false => effective []. */
  masterEnabled?: boolean;
  /** Group ids the desk turned OFF. */
  excludedGroups: string[];
  /** Feed ids the desk turned OFF (wins over group membership). */
  excludedFeeds: string[];
  /** Feed ids force-ON inside an excluded group (escape hatch). */
  enabledFeeds: string[];
};

function parseGroup(raw: unknown, label: string): NewsSourceGroup {
  if (!raw || typeof raw !== "object") {
    throw new Error(`Invalid news-source group in ${label}`);
  }
  const row = raw as Record<string, unknown>;
  const id = typeof row.id === "string" ? row.id.trim() : "";
  const groupLabel = typeof row.label === "string" ? row.label.trim() : "";
  if (!id || !groupLabel) {
    throw new Error(`News-source group in ${label} requires id and label`);
  }
  const feeds = Array.isArray(row.feeds)
    ? row.feeds.filter((f): f is string => typeof f === "string").map((f) => f.trim())
    : [];
  if (feeds.length === 0) {
    throw new Error(`News-source group ${id} requires at least one feed`);
  }
  return { id, label: groupLabel, feeds };
}

export function parseResearchNewsSourcesSeed(doc: unknown): NewsSourcesSeed {
  if (!doc || typeof doc !== "object") {
    throw new Error("News-sources seed must be an object");
  }
  const root = doc as Record<string, unknown>;
  const version =
    typeof root.version === "string" && root.version.trim() ? root.version.trim() : "v1";
  const groups = (Array.isArray(root.groups) ? root.groups : []).map((g, i) =>
    parseGroup(g, `groups[${i}]`),
  );
  if (groups.length === 0) {
    throw new Error("News-sources seed requires at least one group");
  }

  const catalogIds: string[] = [];
  const seen = new Set<string>();
  for (const group of groups) {
    for (const feed of group.feeds) {
      if (seen.has(feed)) {
        throw new Error(`Duplicate news-source feed id in catalog: ${feed}`);
      }
      seen.add(feed);
      catalogIds.push(feed);
    }
  }

  const defaultsRoot = (root.defaults as Record<string, unknown> | undefined) ?? {};
  const defaultGroupIds = Array.isArray(defaultsRoot.groups)
    ? defaultsRoot.groups.filter((id): id is string => typeof id === "string")
    : [];
  if (defaultGroupIds.length === 0) {
    throw new Error("News-sources seed defaults.groups must be non-empty");
  }
  const groupIdSet = new Set(groups.map((g) => g.id));
  for (const id of defaultGroupIds) {
    if (!groupIdSet.has(id)) {
      throw new Error(`News-sources defaults references unknown group: ${id}`);
    }
  }

  return { version, groups, catalogIds, defaultGroupIds };
}

export function emptyNewsSourcesWorkspace(): NewsSourcesWorkspaceValue {
  return { version: 1, excludedGroups: [], excludedFeeds: [], enabledFeeds: [] };
}

/**
 * Parse a raw workspace_config value into the opt-out shape.
 * Missing / empty row => default (master ON, no excludes).
 */
export function parseNewsSourcesWorkspace(raw: unknown): NewsSourcesWorkspaceValue {
  if (!raw || typeof raw !== "object") {
    return emptyNewsSourcesWorkspace();
  }
  const row = raw as Record<string, unknown>;
  const asList = (v: unknown): string[] =>
    Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : [];
  const masterEnabled =
    typeof row.masterEnabled === "boolean" ? row.masterEnabled : undefined;
  return {
    version: 1,
    ...(masterEnabled === undefined ? {} : { masterEnabled }),
    excludedGroups: asList(row.excludedGroups),
    excludedFeeds: asList(row.excludedFeeds),
    enabledFeeds: asList(row.enabledFeeds),
  };
}

/**
 * Effective active feed-id set (catalog order), opt-out semantics.
 * master off => []. Never returns empty when master is on and the seed has feeds
 * (a bad exclude-all falls back to the seed defaults).
 */
export function mergeNewsSources(
  seed: NewsSourcesSeed,
  workspace: NewsSourcesWorkspaceValue,
): string[] {
  if (workspace.masterEnabled === false) return [];

  const groupIdSet = new Set(seed.groups.map((g) => g.id));
  const excludedGroups = new Set(workspace.excludedGroups.filter((id) => groupIdSet.has(id)));
  const defaultGroupSet = new Set(seed.defaultGroupIds);

  // base = feeds of default groups that are not explicitly excluded, in catalog order.
  // (opt-out: only `defaultGroupIds` are ON by default; every other group is OFF
  //  unless a feed is force-enabled via `enabledFeeds`.)
  const baseSet = new Set<string>();
  const base: string[] = [];
  for (const group of seed.groups) {
    if (!defaultGroupSet.has(group.id)) continue; // not a default -> off unless force-enabled
    if (excludedGroups.has(group.id)) continue;
    for (const feed of group.feeds) {
      if (baseSet.has(feed)) continue;
      baseSet.add(feed);
      base.push(feed);
    }
  }

  // escape hatch: enabledFeeds force-ON (feed-level), even inside an excluded/default-off group.
  const catalogSet = new Set(seed.catalogIds);
  const enabledSet = new Set(workspace.enabledFeeds.filter((f) => catalogSet.has(f)));
  const excludedSet = new Set(workspace.excludedFeeds);

  const effective: string[] = [];
  const effectiveSet = new Set<string>();
  const push = (feed: string) => {
    if (effectiveSet.has(feed)) return;
    effectiveSet.add(feed);
    effective.push(feed);
  };
  for (const feed of base) {
    if (excludedSet.has(feed)) continue;
    push(feed);
  }
  for (const feed of enabledSet) {
    if (excludedSet.has(feed)) continue; // excludedFeeds wins
    push(feed);
  }

  if (effective.length === 0 && seed.catalogIds.length > 0) {
    return [...seed.catalogIds];
  }
  return effective;
}
