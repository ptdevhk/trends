import { listResearchNews } from "./research-service.js";
import { resolveResearchCompanySurface } from "./research-industry-bridge-service.js";
import { workspaceConfigService } from "./workspace-config-service.js";
import {
  analyzeKeywordHits,
  annotateNewsByKeywords,
  loadResearchPulseKeywordsSeed,
  mergePulseKeywords,
  parsePulseKeywordsWorkspace,
  type PulseKeywordHit,
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
  resolvedCompanies?: Array<{
    companyKey: string;
    nameCn: string;
    nameEn?: string;
  }>;
};

export type ResearchPulseResult = {
  items: PulseNewsItem[];
  meta: {
    filtered: boolean;
    effectiveKeywords: string[];
    rawCount: number;
    matchedCount: number;
    keywordHits: PulseKeywordHit[];
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
  resolvedCompanies?: Array<{
    companyKey: string;
    nameCn: string;
    nameEn?: string;
  }>;
}): PulseNewsItem {
  return {
    title: n.title,
    platform: n.platform,
    ...(n.url ? { url: n.url } : {}),
    capturedAt: n.capturedAt,
    matchedKeywords: n.matchedKeywords,
    ...(n.resolvedCompanies?.length ? { resolvedCompanies: n.resolvedCompanies } : {}),
  };
}

function resolvePulseMatchedCompanies(
  matchedKeywords: string[],
): Array<{ companyKey: string; nameCn: string; nameEn?: string }> {
  const seen = new Set<string>();
  const resolved: Array<{ companyKey: string; nameCn: string; nameEn?: string }> = [];
  for (const keyword of matchedKeywords) {
    const hit = resolveResearchCompanySurface(keyword);
    if (!hit || seen.has(hit.companyKey)) {
      continue;
    }
    seen.add(hit.companyKey);
    resolved.push({
      companyKey: hit.companyKey,
      nameCn: hit.nameCn,
      ...(hit.nameEn ? { nameEn: hit.nameEn } : {}),
    });
  }
  return resolved;
}

/** NewsNow hotlist platforms only — exclude RSS brand feeds (`rss:*`). */
export function isHotlistPlatform(platform: string): boolean {
  const p = platform.trim().toLowerCase();
  if (!p) return false;
  return !p.startsWith("rss:");
}

export async function getResearchPulse(
  workspaceSlug: string,
  opts: { limit?: number; all?: boolean; hotlistOnly?: boolean } = {},
): Promise<ResearchPulseResult> {
  const limit = Math.min(Math.max(opts.limit ?? 12, 1), 50);
  const { effective } = await getPulseKeywordsState(workspaceSlug);
  // Fetch a wider window when hotlistOnly so RSS rows do not crowd out NewsNow.
  const fetchLimit = opts.hotlistOnly
    ? Math.min(Math.max(opts.all ? limit * 4 : 200, limit), 200)
    : opts.all
      ? limit
      : 100;
  const raw = await listResearchNews({ limit: fetchLimit });
  const sorted = [...raw]
    .filter((item) => (opts.hotlistOnly ? isHotlistPlatform(item.platform) : true))
    .sort((a, b) => b.capturedAt - a.capturedAt);
  const rawCount = sorted.length;
  const annotated = annotateNewsByKeywords(sorted, effective);
  const hits = annotated.filter((item) => item.matchedKeywords.length > 0);
  const keywordHits = analyzeKeywordHits(annotated, effective);

  if (opts.all) {
    return {
      items: annotated.slice(0, limit).map((n) =>
        mapPulseItem({
          title: n.title,
          platform: n.platform,
          url: n.url,
          capturedAt: n.capturedAt,
          matchedKeywords: n.matchedKeywords,
          resolvedCompanies: resolvePulseMatchedCompanies(n.matchedKeywords),
        }),
      ),
      meta: {
        filtered: false,
        effectiveKeywords: effective,
        rawCount,
        matchedCount: hits.length,
        keywordHits,
      },
    };
  }

  const sliced = hits.slice(0, limit);
  return {
    items: sliced.map((n) =>
      mapPulseItem({
        title: n.title,
        platform: n.platform,
        url: n.url,
        capturedAt: n.capturedAt,
        matchedKeywords: n.matchedKeywords,
        resolvedCompanies: resolvePulseMatchedCompanies(n.matchedKeywords),
      }),
    ),
    meta: {
      filtered: true,
      effectiveKeywords: effective,
      rawCount,
      matchedCount: hits.length,
      keywordHits,
    },
  };
}
