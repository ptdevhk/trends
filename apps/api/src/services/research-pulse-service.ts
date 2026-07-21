import { listResearchNews } from "./research-service.js";
import { workspaceConfigService } from "./workspace-config-service.js";
import {
  filterNewsByKeywords,
  loadResearchPulseKeywordsSeed,
  mergePulseKeywords,
  parsePulseKeywordsWorkspace,
  type PulseKeywordsSeed,
  type PulseKeywordsWorkspaceValue,
  MAX_CUSTOM_KEYWORDS,
  MAX_KEYWORD_LENGTH,
  PULSE_KEYWORDS_CONFIG_KEY,
} from "./research-pulse-keywords.js";

export class PulseKeywordsValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PulseKeywordsValidationError";
  }
}

export type PulseKeywordsState = {
  seed: PulseKeywordsSeed;
  workspace: PulseKeywordsWorkspaceValue;
  effective: string[];
};

export type PulseNewsItem = {
  title: string;
  platform: string;
  url?: string;
  capturedAt: number;
  matchedKeywords: string[];
};

export type ResearchPulseResult = {
  items: PulseNewsItem[];
  meta: {
    filtered: boolean;
    effectiveKeywords: string[];
    rawCount: number;
    matchedCount: number;
  };
};

function sanitizeKeywordList(raw: unknown, field: string): string[] {
  if (raw === undefined) {
    return [];
  }
  if (!Array.isArray(raw)) {
    throw new PulseKeywordsValidationError(`${field} must be an array of strings`);
  }
  const out: string[] = [];
  for (const item of raw) {
    if (typeof item !== "string") {
      throw new PulseKeywordsValidationError(`${field} must be an array of strings`);
    }
    const trimmed = item.trim();
    if (!trimmed) continue;
    if (trimmed.length > MAX_KEYWORD_LENGTH) {
      throw new PulseKeywordsValidationError(
        `${field} keyword exceeds max length of ${MAX_KEYWORD_LENGTH}`,
      );
    }
    out.push(trimmed);
  }
  return out;
}

function validateCustomList(custom: string[]): void {
  if (custom.length > MAX_CUSTOM_KEYWORDS) {
    throw new PulseKeywordsValidationError(
      `custom exceeds max of ${MAX_CUSTOM_KEYWORDS} keywords`,
    );
  }
}

export async function getPulseKeywordsState(workspaceSlug: string): Promise<PulseKeywordsState> {
  const seed = loadResearchPulseKeywordsSeed();
  let raw: unknown;
  try {
    raw = await workspaceConfigService.getWorkspaceConfigValue(
      workspaceSlug,
      PULSE_KEYWORDS_CONFIG_KEY,
    );
  } catch {
    // Fall back to seed defaults when workspace get fails (design error table)
    raw = undefined;
  }
  const workspace = parsePulseKeywordsWorkspace(raw);
  const effective = mergePulseKeywords(seed, workspace);
  return { seed, workspace, effective };
}

export async function putPulseKeywords(
  workspaceSlug: string,
  body: { enabled?: string[]; excluded?: string[]; custom?: string[] },
): Promise<PulseKeywordsState> {
  const current = await getPulseKeywordsState(workspaceSlug);

  const next: PulseKeywordsWorkspaceValue = {
    version: 1,
    enabled:
      body.enabled !== undefined
        ? sanitizeKeywordList(body.enabled, "enabled")
        : current.workspace.enabled,
    excluded:
      body.excluded !== undefined
        ? sanitizeKeywordList(body.excluded, "excluded")
        : current.workspace.excluded,
    custom:
      body.custom !== undefined
        ? sanitizeKeywordList(body.custom, "custom")
        : current.workspace.custom,
  };
  validateCustomList(next.custom);

  await workspaceConfigService.setWorkspaceConfigValue(
    workspaceSlug,
    PULSE_KEYWORDS_CONFIG_KEY,
    next,
  );

  const seed = loadResearchPulseKeywordsSeed();
  const effective = mergePulseKeywords(seed, next);
  return { seed, workspace: next, effective };
}

function mapPulseItem(n: {
  title: string;
  platform: string;
  url?: string;
  capturedAt: number;
  matchedKeywords: string[];
}): PulseNewsItem {
  return {
    title: n.title,
    platform: n.platform,
    ...(n.url ? { url: n.url } : {}),
    capturedAt: n.capturedAt,
    matchedKeywords: n.matchedKeywords,
  };
}

export async function getResearchPulse(
  workspaceSlug: string,
  opts: { limit?: number; all?: boolean } = {},
): Promise<ResearchPulseResult> {
  const limit = Math.min(Math.max(opts.limit ?? 12, 1), 50);
  const { effective } = await getPulseKeywordsState(workspaceSlug);
  const raw = await listResearchNews({ limit: opts.all ? limit : 100 });
  const sorted = [...raw].sort((a, b) => b.capturedAt - a.capturedAt);
  const rawCount = sorted.length;

  if (opts.all) {
    return {
      items: sorted.slice(0, limit).map((n) =>
        mapPulseItem({
          title: n.title,
          platform: n.platform,
          url: n.url,
          capturedAt: n.capturedAt,
          matchedKeywords: [],
        }),
      ),
      meta: {
        filtered: false,
        effectiveKeywords: effective,
        rawCount,
        matchedCount: rawCount,
      },
    };
  }

  const hits = filterNewsByKeywords(sorted, effective);
  const sliced = hits.slice(0, limit);
  return {
    items: sliced.map((n) =>
      mapPulseItem({
        title: n.title,
        platform: n.platform,
        url: n.url,
        capturedAt: n.capturedAt,
        matchedKeywords: n.matchedKeywords,
      }),
    ),
    meta: {
      filtered: true,
      effectiveKeywords: effective,
      rawCount,
      matchedCount: hits.length,
    },
  };
}
