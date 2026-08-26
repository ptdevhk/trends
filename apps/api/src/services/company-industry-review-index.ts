import { createHash } from "node:crypto";

import type {
  IndustryReviewAction,
  IndustryReviewConfidenceBand,
  IndustryReviewRiskFlag,
} from "@trends/shared";

import type {
  CompanyIndustryProfile,
} from "./company-industry-profile-service.js";
import type {
  IndustryEvidenceSource,
} from "./company-industry-contracts.js";

export interface IndustryReviewIndexEntry {
  proposalId: string;
  inputFingerprint: string;
  recommendedAction: IndustryReviewAction;
  confidenceBand: IndustryReviewConfidenceBand;
  riskFlags: IndustryReviewRiskFlag[];
  priority: number;
  updatedAt: number;
  sourceCount?: number;
}

export interface IndustryReviewIndexQuery {
  limit?: number;
  cursor?: string;
  snapshot?: string;
  riskFlag?: IndustryReviewRiskFlag;
  confidenceBand?: IndustryReviewConfidenceBand;
  recommendedAction?: IndustryReviewAction;
}

export interface IndustryReviewIndexPage {
  items: IndustryReviewIndexEntry[];
  nextCursor?: string;
  snapshot: string;
}

const ACTION_RANK: Record<IndustryReviewAction, number> = {
  needs_more_evidence: 0,
  inspect: 1,
  approve: 2,
  reject: 3,
};

interface IndustryReviewCursor {
  snapshot: string;
  afterProposalId: string;
}

function indexSnapshot(entries: readonly IndustryReviewIndexEntry[]): string {
  return createHash("sha256")
    .update(
      JSON.stringify(
        entries
          .map((entry) => ({
            proposalId: entry.proposalId,
            inputFingerprint: entry.inputFingerprint,
            recommendedAction: entry.recommendedAction,
            confidenceBand: entry.confidenceBand,
            riskFlags: [...entry.riskFlags].sort(),
            priority: entry.priority,
            updatedAt: entry.updatedAt,
            sourceCount: entry.sourceCount,
          }))
          .sort((left, right) => left.proposalId.localeCompare(right.proposalId)),
      ),
    )
    .digest("hex");
}

interface CachedIndustryReviewIndex {
  entries: IndustryReviewIndexEntry[];
  maintenanceFingerprint: string;
  expiresAt: number;
  skippedCount?: number;
  skippedProposalIds?: string[];
}

const REVIEW_INDEX_CACHE_TTL_MS = 15_000;
const REVIEW_INDEX_CACHE_MAX_KEYS = 8;
const reviewIndexCache = new Map<string, CachedIndustryReviewIndex>();

export interface IndustryReviewCorpus {
  sources: IndustryEvidenceSource[];
  profiles: CompanyIndustryProfile[];
}

interface CachedIndustryReviewCorpus extends IndustryReviewCorpus {
  maintenanceFingerprint: string;
  expiresAt: number;
}

/**
 * The evidence-source and profile tables are key-independent across review
 * queue cache keys (`${workspaceSlug}:${status}`), so a miss on any key loads
 * them once and shares them for the same freshness window. This avoids
 * reloading the two large tables for every status key per TTL expiry.
 */
const corpusCache = new Map<string, CachedIndustryReviewCorpus>();
let corpusInFlight:
  | Promise<IndustryReviewCorpus | null>
  | null = null;

export function getCachedIndustryReviewCorpus(
  maintenanceFingerprint: string,
  now = Date.now(),
): IndustryReviewCorpus | undefined {
  const cached = corpusCache.get(maintenanceFingerprint);
  if (!cached || cached.expiresAt <= now) {
    if (cached) corpusCache.delete(maintenanceFingerprint);
    return undefined;
  }
  return { sources: cached.sources, profiles: cached.profiles };
}

export function setCachedIndustryReviewCorpus(
  maintenanceFingerprint: string,
  corpus: IndustryReviewCorpus,
  now = Date.now(),
): void {
  corpusCache.delete(maintenanceFingerprint);
  corpusCache.set(maintenanceFingerprint, {
    ...corpus,
    maintenanceFingerprint,
    expiresAt: now + REVIEW_INDEX_CACHE_TTL_MS,
  });
}

/**
 * Returns the shared sources/profiles corpus, loading it once per
 * maintenance-fingerprint window. Concurrent callers await the same load
 * (stampede guard); failures are not cached.
 */
export async function getIndustryReviewCorpusOrLoad(
  maintenanceFingerprint: string,
  loader: () => Promise<IndustryReviewCorpus>,
): Promise<IndustryReviewCorpus | null> {
  const cached = getCachedIndustryReviewCorpus(maintenanceFingerprint);
  if (cached) return cached;
  if (corpusInFlight) {
    const corpus = await corpusInFlight;
    if (corpus) return corpus;
  }
  const load = loader()
    .then((corpus) => {
      setCachedIndustryReviewCorpus(maintenanceFingerprint, corpus);
      return corpus;
    })
    .catch((error: unknown) => {
      corpusInFlight = null;
      throw error;
    });
  corpusInFlight = load;
  try {
    return await load;
  } finally {
    corpusInFlight = null;
  }
}

export function clearIndustryReviewCorpus(): void {
  corpusCache.clear();
  corpusInFlight = null;
}

/**
 * The queue index is advisory only. It is deliberately bounded and disposable:
 * the source/profile/proposal reads remain the authority, while this cache keeps
 * repeated refreshes from re-ranking every proposal until a mutation or short
 * freshness window invalidates it.
 */
export function getCachedIndustryReviewIndex(
  key: string,
  maintenanceFingerprint: string,
  now = Date.now(),
): readonly IndustryReviewIndexEntry[] | undefined {
  const cached = reviewIndexCache.get(key);
  if (!cached || cached.expiresAt <= now || cached.maintenanceFingerprint !== maintenanceFingerprint) {
    if (cached) reviewIndexCache.delete(key);
    return undefined;
  }
  return cached.entries;
}

/**
 * Skip accounting stored alongside a cached index. Entries cached before
 * skip accounting was introduced have no skip fields; they read as clean.
 */
export function getCachedIndustryReviewIndexSkip(
  key: string,
  maintenanceFingerprint: string,
  now = Date.now(),
): { skippedCount: number; skippedProposalIds: string[] } | undefined {
  const cached = reviewIndexCache.get(key);
  if (!cached || cached.expiresAt <= now || cached.maintenanceFingerprint !== maintenanceFingerprint) {
    return undefined;
  }
  return {
    skippedCount: cached.skippedCount ?? 0,
    skippedProposalIds: cached.skippedProposalIds ?? [],
  };
}

export function setCachedIndustryReviewIndex(
  key: string,
  entries: readonly IndustryReviewIndexEntry[],
  maintenanceFingerprint: string,
  now = Date.now(),
  skip?: { skippedCount: number; skippedProposalIds: string[] },
): void {
  if (reviewIndexCache.has(key)) reviewIndexCache.delete(key);
  while (reviewIndexCache.size >= REVIEW_INDEX_CACHE_MAX_KEYS) {
    const oldestKey = reviewIndexCache.keys().next().value;
    if (typeof oldestKey !== "string") break;
    reviewIndexCache.delete(oldestKey);
  }
  reviewIndexCache.set(key, {
    entries: [...entries],
    maintenanceFingerprint,
    expiresAt: now + REVIEW_INDEX_CACHE_TTL_MS,
    ...(skip ? { skippedCount: skip.skippedCount, skippedProposalIds: skip.skippedProposalIds } : {}),
  });
}

export function invalidateIndustryReviewIndex(key?: string): void {
  if (key) {
    reviewIndexCache.delete(key);
    return;
  }
  reviewIndexCache.clear();
  clearIndustryReviewCorpus();
}

export function createIndustryReviewCursor(input: IndustryReviewCursor): string {
  return Buffer.from(JSON.stringify(input), "utf8").toString("base64url");
}

function decodeIndustryReviewCursor(cursor: string): IndustryReviewCursor {
  try {
    const value = JSON.parse(Buffer.from(cursor, "base64url").toString("utf8")) as Partial<IndustryReviewCursor>;
    if (
      typeof value.snapshot !== "string" ||
      typeof value.afterProposalId !== "string" ||
      !value.snapshot ||
      !value.afterProposalId
    ) {
      throw new Error("invalid cursor");
    }
    return value as IndustryReviewCursor;
  } catch {
    throw new Error("INDUSTRY_REVIEW_CURSOR_STALE: invalid review queue cursor");
  }
}

function compareIndexEntries(
  left: IndustryReviewIndexEntry,
  right: IndustryReviewIndexEntry,
): number {
  return (
    ACTION_RANK[left.recommendedAction] - ACTION_RANK[right.recommendedAction] ||
    right.riskFlags.length - left.riskFlags.length ||
    right.priority - left.priority ||
    left.updatedAt - right.updatedAt ||
    left.proposalId.localeCompare(right.proposalId)
  );
}

export function paginateIndustryReviewIndex(
  entries: readonly IndustryReviewIndexEntry[],
  query: IndustryReviewIndexQuery = {},
): IndustryReviewIndexPage {
  const snapshot = indexSnapshot(entries);
  if (query.snapshot && query.snapshot !== snapshot) {
    throw new Error("INDUSTRY_REVIEW_CURSOR_STALE: review queue snapshot changed");
  }
  const filtered = entries
    .filter((entry) =>
      query.riskFlag === undefined || entry.riskFlags.includes(query.riskFlag),
    )
    .filter((entry) =>
      query.confidenceBand === undefined || entry.confidenceBand === query.confidenceBand,
    )
    .filter((entry) =>
      query.recommendedAction === undefined || entry.recommendedAction === query.recommendedAction,
    )
    .sort(compareIndexEntries);
  const cursor = query.cursor ? decodeIndustryReviewCursor(query.cursor) : undefined;
  if (cursor && cursor.snapshot !== snapshot) {
    throw new Error("INDUSTRY_REVIEW_CURSOR_STALE: review queue snapshot changed");
  }
  const afterIndex = cursor
    ? filtered.findIndex((entry) => entry.proposalId === cursor.afterProposalId)
    : -1;
  if (cursor && afterIndex < 0) {
    throw new Error("INDUSTRY_REVIEW_CURSOR_STALE: cursor item is no longer indexed");
  }
  const limit = Math.min(100, Math.max(1, Math.floor(query.limit ?? 50)));
  const start = afterIndex + 1;
  const items = filtered.slice(start, start + limit);
  const last = items.at(-1);
  const nextCursor =
    last && start + items.length < filtered.length
      ? createIndustryReviewCursor({ snapshot, afterProposalId: last.proposalId })
      : undefined;
  return { items, ...(nextCursor ? { nextCursor } : {}), snapshot };
}

export const industryReviewIndexInternals = {
  compareIndexEntries,
  indexSnapshot,
  decodeIndustryReviewCursor,
  cacheSize: () => reviewIndexCache.size,
  corpusCacheSize: () => corpusCache.size,
  clearCache: () => invalidateIndustryReviewIndex(),
};
