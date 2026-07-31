import { createHash } from "node:crypto";

import type {
  IndustryReviewAction,
  IndustryReviewConfidenceBand,
  IndustryReviewRiskFlag,
} from "@trends/shared";

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
}

const REVIEW_INDEX_CACHE_TTL_MS = 15_000;
const REVIEW_INDEX_CACHE_MAX_KEYS = 8;
const reviewIndexCache = new Map<string, CachedIndustryReviewIndex>();

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

export function setCachedIndustryReviewIndex(
  key: string,
  entries: readonly IndustryReviewIndexEntry[],
  maintenanceFingerprint: string,
  now = Date.now(),
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
  });
}

export function invalidateIndustryReviewIndex(key?: string): void {
  if (key) {
    reviewIndexCache.delete(key);
    return;
  }
  reviewIndexCache.clear();
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
  clearCache: () => invalidateIndustryReviewIndex(),
};
