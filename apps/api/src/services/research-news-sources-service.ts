import { workspaceConfigService } from "./workspace-config-service.js";
import {
  NEWS_SOURCES_CONFIG_KEY,
  emptyNewsSourcesWorkspace,
  loadResearchNewsSourcesSeed,
  mergeNewsSources,
  parseNewsSourcesWorkspace,
  type NewsSourcesSeed,
  type NewsSourcesWorkspaceValue,
} from "./research-news-sources.js";

export class NewsSourcesValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "NewsSourcesValidationError";
  }
}

export type NewsSourcesState = {
  seed: NewsSourcesSeed;
  workspace: NewsSourcesWorkspaceValue;
  effective: string[];
};

function sanitizeFeedList(raw: unknown, field: string, catalog: Set<string>): string[] {
  if (raw === undefined) return [];
  if (!Array.isArray(raw)) {
    throw new NewsSourcesValidationError(`${field} must be an array of strings`);
  }
  const out: string[] = [];
  const seen = new Set<string>();
  for (const item of raw) {
    if (typeof item !== "string") {
      throw new NewsSourcesValidationError(`${field} must be an array of strings`);
    }
    const trimmed = item.trim();
    if (!trimmed) continue;
    if (!catalog.has(trimmed)) {
      throw new NewsSourcesValidationError(`${field} contains unknown feed id: ${trimmed}`);
    }
    if (seen.has(trimmed)) continue;
    seen.add(trimmed);
    out.push(trimmed);
  }
  return out;
}

export async function getNewsSourcesState(workspaceSlug: string): Promise<NewsSourcesState> {
  const seed = loadResearchNewsSourcesSeed();
  let raw: unknown;
  try {
    raw = await workspaceConfigService.getWorkspaceConfigValue(
      workspaceSlug,
      NEWS_SOURCES_CONFIG_KEY,
    );
  } catch {
    raw = undefined;
  }
  const workspace = parseNewsSourcesWorkspace(raw);
  const effective = mergeNewsSources(seed, workspace);
  return { seed, workspace, effective };
}

export async function putNewsSources(
  workspaceSlug: string,
  body: {
    masterEnabled?: boolean;
    excludedGroups?: string[];
    excludedFeeds?: string[];
    enabledFeeds?: string[];
  },
): Promise<NewsSourcesState> {
  const current = await getNewsSourcesState(workspaceSlug);
  const groupIdSet: Set<string> = new Set(current.seed.groups.map((g) => g.id));
  const catalog = new Set(current.seed.catalogIds);

  const next: NewsSourcesWorkspaceValue = {
    version: 1,
    ...(body.masterEnabled !== undefined ? { masterEnabled: body.masterEnabled } : {}),
    excludedGroups:
      body.excludedGroups !== undefined
        ? sanitizeFeedList(body.excludedGroups, "excludedGroups", groupIdSet)
        : current.workspace.excludedGroups,
    excludedFeeds:
      body.excludedFeeds !== undefined
        ? sanitizeFeedList(body.excludedFeeds, "excludedFeeds", catalog)
        : current.workspace.excludedFeeds,
    enabledFeeds:
      body.enabledFeeds !== undefined
        ? sanitizeFeedList(body.enabledFeeds, "enabledFeeds", catalog)
        : current.workspace.enabledFeeds,
  };

  await workspaceConfigService.setWorkspaceConfigValue(
    workspaceSlug,
    NEWS_SOURCES_CONFIG_KEY,
    next,
  );

  const seed = loadResearchNewsSourcesSeed();
  const effective = mergeNewsSources(seed, next);
  return { seed, workspace: next, effective };
}

export { emptyNewsSourcesWorkspace };
