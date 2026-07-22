export {
  loadResearchPulseKeywordsSeed,
  type PulseKeywordGroup,
  type PulseKeywordsSeed,
} from "./research-pulse-keywords-pack.js";

import type { PulseKeywordsSeed } from "./research-pulse-keywords-pack.js";

export const PULSE_KEYWORDS_CONFIG_KEY = "research.pulseKeywords";
export const MAX_CUSTOM_KEYWORDS = 20;
export const MAX_KEYWORD_LENGTH = 32;

export type PulseKeywordsWorkspaceValue = {
  version: 1;
  enabled: string[];
  excluded: string[];
  custom: string[];
};

export type PulseKeywordHit = {
  keyword: string;
  hitCount: number;
  sampleTitles: string[];
};

export function emptyPulseKeywordsWorkspace(): PulseKeywordsWorkspaceValue {
  return { version: 1, enabled: [], excluded: [], custom: [] };
}

function asStringList(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter((v): v is string => typeof v === "string")
    .map((v) => v.trim())
    .filter((v) => v.length > 0);
}

/**
 * Normalize a keyword for set membership / exclude compare:
 * trim + Unicode NFKC; Latin lowercased. Display form is kept separately by callers.
 */
export function normalizePulseKeyword(k: string): string {
  const nfkc = k.trim().normalize("NFKC");
  // Lowercase Latin letters only (leave CJK / other scripts as-is after NFKC)
  return nfkc.replace(/[A-Za-z]+/g, (m) => m.toLowerCase());
}

export function parsePulseKeywordsWorkspace(raw: unknown): PulseKeywordsWorkspaceValue {
  if (!raw || typeof raw !== "object") {
    return emptyPulseKeywordsWorkspace();
  }
  const row = raw as Record<string, unknown>;
  return {
    version: 1,
    enabled: asStringList(row.enabled),
    excluded: asStringList(row.excluded),
    custom: asStringList(row.custom),
  };
}

/**
 * Merge seed defaults with workspace overlay.
 * empty after exclude-all → fall back to seed.defaultKeywords.
 */
export function mergePulseKeywords(
  seed: PulseKeywordsSeed,
  workspace: PulseKeywordsWorkspaceValue,
): string[] {
  const seedDefaults = seed.defaultKeywords;

  // base = unique(seedDefaults ∪ custom ∪ enabled) in stable order
  const base: string[] = [];
  const seenNorm = new Set<string>();

  const pushUnique = (kw: string) => {
    const trimmed = kw.trim();
    if (!trimmed) return;
    const norm = normalizePulseKeyword(trimmed);
    if (seenNorm.has(norm)) return;
    seenNorm.add(norm);
    base.push(trimmed);
  };

  for (const k of seedDefaults) pushUnique(k);
  for (const k of workspace.custom) pushUnique(k);
  for (const k of workspace.enabled) pushUnique(k);

  const excluded = new Set(workspace.excluded.map(normalizePulseKeyword));
  const effective = base.filter((k) => !excluded.has(normalizePulseKeyword(k)));

  if (effective.length === 0) {
    return [...seedDefaults];
  }
  return effective;
}

function haystackForItem(item: {
  title: string;
  rawSnippet?: string;
  snippet?: string;
}): string {
  const snippet = item.rawSnippet ?? item.snippet ?? "";
  return `${item.title} ${snippet}`.normalize("NFKC");
}

function keywordMatchesHaystack(haystack: string, keyword: string): boolean {
  const kw = keyword.trim().normalize("NFKC");
  if (!kw) return false;
  // Latin case-insensitive: lower both sides only for Latin letters
  const hayLower = haystack.replace(/[A-Za-z]+/g, (m) => m.toLowerCase());
  const kwLower = kw.replace(/[A-Za-z]+/g, (m) => m.toLowerCase());
  return hayLower.includes(kwLower);
}

function normalizeActiveKeywords(keywords: string[]): string[] {
  const unique: string[] = [];
  const seen = new Set<string>();
  for (const keyword of keywords) {
    const trimmed = keyword.trim();
    if (!trimmed) continue;
    const normalized = normalizePulseKeyword(trimmed);
    if (seen.has(normalized)) continue;
    seen.add(normalized);
    unique.push(trimmed);
  }
  return unique;
}

function matchedKeywordsForItem<T extends { title: string; rawSnippet?: string; snippet?: string }>(
  item: T,
  activeKeywords: string[],
): string[] {
  const haystack = haystackForItem(item);
  const matchedKeywords: string[] = [];
  for (const keyword of activeKeywords) {
    if (keywordMatchesHaystack(haystack, keyword)) {
      matchedKeywords.push(keyword);
    }
  }
  return matchedKeywords;
}

export function annotateNewsByKeywords<
  T extends { title: string; rawSnippet?: string; snippet?: string },
>(items: T[], keywords: string[]): Array<T & { matchedKeywords: string[] }> {
  const activeKeywords = normalizeActiveKeywords(keywords);
  return items.map((item) => ({
    ...item,
    matchedKeywords: matchedKeywordsForItem(item, activeKeywords),
  }));
}

/**
 * Filter news by keyword substring match (OR). Attaches matchedKeywords.
 * Sort/limit is the caller's responsibility (pulse service).
 */
export function filterNewsByKeywords<
  T extends { title: string; rawSnippet?: string; snippet?: string },
>(items: T[], keywords: string[]): Array<T & { matchedKeywords: string[] }> {
  return annotateNewsByKeywords(items, keywords).filter((item) => item.matchedKeywords.length > 0);
}

export function analyzeKeywordHits<
  T extends {
    title: string;
    rawSnippet?: string;
    snippet?: string;
    matchedKeywords?: string[];
  },
>(
  items: T[],
  keywords: string[],
  opts: { sampleLimit?: number } = {},
): PulseKeywordHit[] {
  const activeKeywords = normalizeActiveKeywords(keywords);
  const sampleLimit = Math.max(0, opts.sampleLimit ?? 2);
  const entries = activeKeywords.map((keyword) => ({
    keyword,
    hitCount: 0,
    sampleTitles: [] as string[],
  }));
  const indexByKeyword = new Map(entries.map((entry) => [normalizePulseKeyword(entry.keyword), entry]));

  for (const item of items) {
    const matchedKeywords = Array.isArray(item.matchedKeywords)
      ? activeKeywords.filter((keyword) =>
          item.matchedKeywords!.some(
            (candidate) => normalizePulseKeyword(candidate) === normalizePulseKeyword(keyword),
          ),
        )
      : matchedKeywordsForItem(item, activeKeywords);

    for (const keyword of matchedKeywords) {
      const entry = indexByKeyword.get(normalizePulseKeyword(keyword));
      if (!entry) continue;
      entry.hitCount += 1;
      const title = item.title.trim();
      if (
        title &&
        entry.sampleTitles.length < sampleLimit &&
        !entry.sampleTitles.includes(title)
      ) {
        entry.sampleTitles.push(title);
      }
    }
  }

  return entries;
}
