/**
 * Offline unresolved entity queue (R2).
 * Pure aggregation + priority stubs — no external APIs.
 */

import { normalizeSurface } from "./industry-entity-resolve.js";

export type UnresolvedReason = "miss" | "low_confidence_keyword";

export interface UnresolvedEvent {
  surface: string;
  normalizedKey: string;
  reason: UnresolvedReason;
  /** Nearby resume/industry score if known (0–100 scale when present). */
  nearbyScore?: number;
  at?: string;
}

export interface UnresolvedAggregate {
  normalizedKey: string;
  count: number;
  examples: string[];
  maxNearbyScore: number;
  reasons: UnresolvedReason[];
  priority: boolean;
  priorityReasons: string[];
}

export interface PriorityStubOptions {
  minFreq?: number;
  minScore?: number;
  sellBrandAliases?: string[];
}

const DEFAULT_MIN_FREQ = 3;
const DEFAULT_MIN_SCORE = 70;
const MAX_EXAMPLES = 8;

/** Known sell-side / global brands used for misspelling heuristic defaults. */
export const DEFAULT_SELL_BRAND_ALIASES = [
  "brother",
  "兄弟",
  "star",
  "斯大",
  "zeiss",
  "蔡司",
  "shibaura",
  "芝浦",
  "fanuc",
  "发那科",
  "makino",
  "牧野",
  "toyoda",
  "jtekt",
  "丰田工机",
  "捷太格特",
];

export function makeUnresolvedEvent(
  surface: string,
  reason: UnresolvedReason,
  nearbyScore?: number,
  at?: string
): UnresolvedEvent {
  const trimmed = surface.trim();
  return {
    surface: trimmed,
    normalizedKey: normalizeSurface(trimmed),
    reason,
    nearbyScore:
      typeof nearbyScore === "number" && Number.isFinite(nearbyScore)
        ? nearbyScore
        : undefined,
    at: at ?? new Date().toISOString(),
  };
}

function levenshtein(a: string, b: string): number {
  if (a === b) return 0;
  if (!a.length) return b.length;
  if (!b.length) return a.length;
  const rows = a.length + 1;
  const cols = b.length + 1;
  const dp: number[][] = Array.from({ length: rows }, () =>
    Array.from({ length: cols }, () => 0)
  );
  for (let i = 0; i < rows; i++) dp[i][0] = i;
  for (let j = 0; j < cols; j++) dp[0][j] = j;
  for (let i = 1; i < rows; i++) {
    for (let j = 1; j < cols; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      dp[i][j] = Math.min(
        dp[i - 1][j] + 1,
        dp[i][j - 1] + 1,
        dp[i - 1][j - 1] + cost
      );
    }
  }
  return dp[a.length][b.length];
}

/**
 * Sell-brand misspelling heuristic: short edit distance to a known sell alias,
 * or shared prefix length >= 3 without exact equality.
 */
export function looksLikeSellBrandMisspelling(
  normalizedKey: string,
  sellBrandAliases: string[] = DEFAULT_SELL_BRAND_ALIASES
): boolean {
  if (!normalizedKey || normalizedKey.length < 2) return false;
  const key = normalizeSurface(normalizedKey);
  for (const raw of sellBrandAliases) {
    const alias = normalizeSurface(raw);
    if (!alias || alias.length < 2) continue;
    if (key === alias) continue;
    if (alias.length <= 6 && levenshtein(key, alias) === 1) return true;
    if (alias.length >= 3 && key.length >= 3) {
      const prefixLen = Math.min(3, alias.length, key.length);
      if (
        key.slice(0, prefixLen) === alias.slice(0, prefixLen) &&
        Math.abs(key.length - alias.length) <= 2
      ) {
        return true;
      }
    }
  }
  return false;
}

export function evaluatePriority(
  aggregate: Pick<UnresolvedAggregate, "count" | "maxNearbyScore" | "normalizedKey">,
  options: PriorityStubOptions = {}
): { priority: boolean; reasons: string[] } {
  const minFreq = options.minFreq ?? DEFAULT_MIN_FREQ;
  const minScore = options.minScore ?? DEFAULT_MIN_SCORE;
  const sell = options.sellBrandAliases ?? DEFAULT_SELL_BRAND_ALIASES;
  const reasons: string[] = [];
  if (aggregate.count >= minFreq) reasons.push(`freq>=${minFreq}`);
  if (aggregate.maxNearbyScore >= minScore) reasons.push(`score>=${minScore}`);
  if (looksLikeSellBrandMisspelling(aggregate.normalizedKey, sell)) {
    reasons.push("sell_brand_misspelling");
  }
  return { priority: reasons.length > 0, reasons };
}

export function aggregateUnresolvedEvents(
  events: UnresolvedEvent[],
  options: PriorityStubOptions = {}
): UnresolvedAggregate[] {
  const byKey = new Map<
    string,
    {
      normalizedKey: string;
      count: number;
      examples: string[];
      maxNearbyScore: number;
      reasons: Set<UnresolvedReason>;
    }
  >();

  for (const event of events) {
    const key =
      event.normalizedKey ||
      normalizeSurface(event.surface) ||
      event.surface.trim().toLowerCase();
    if (!key) continue;
    let bucket = byKey.get(key);
    if (!bucket) {
      bucket = {
        normalizedKey: key,
        count: 0,
        examples: [],
        maxNearbyScore: 0,
        reasons: new Set(),
      };
      byKey.set(key, bucket);
    }
    bucket.count += 1;
    bucket.reasons.add(event.reason);
    if (
      typeof event.nearbyScore === "number" &&
      event.nearbyScore > bucket.maxNearbyScore
    ) {
      bucket.maxNearbyScore = event.nearbyScore;
    }
    if (
      event.surface &&
      !bucket.examples.includes(event.surface) &&
      bucket.examples.length < MAX_EXAMPLES
    ) {
      bucket.examples.push(event.surface);
    }
  }

  const aggregates: UnresolvedAggregate[] = [];
  for (const bucket of byKey.values()) {
    const { priority, reasons } = evaluatePriority(bucket, options);
    aggregates.push({
      normalizedKey: bucket.normalizedKey,
      count: bucket.count,
      examples: bucket.examples,
      maxNearbyScore: bucket.maxNearbyScore,
      reasons: Array.from(bucket.reasons),
      priority,
      priorityReasons: reasons,
    });
  }

  return aggregates.sort((a, b) => {
    if (a.priority !== b.priority) return a.priority ? -1 : 1;
    if (b.count !== a.count) return b.count - a.count;
    return b.maxNearbyScore - a.maxNearbyScore;
  });
}

export function filterAggregates(
  aggregates: UnresolvedAggregate[],
  opts: { minCount?: number; priorityOnly?: boolean } = {}
): UnresolvedAggregate[] {
  const minCount = opts.minCount ?? 1;
  return aggregates.filter((a) => {
    if (a.count < minCount) return false;
    if (opts.priorityOnly && !a.priority) return false;
    return true;
  });
}

export interface UnresolvedQueueFile {
  version: 1;
  updatedAt: string;
  events: UnresolvedEvent[];
  aggregates: UnresolvedAggregate[];
}

export function buildQueueFile(
  events: UnresolvedEvent[],
  options: PriorityStubOptions = {}
): UnresolvedQueueFile {
  const aggregates = aggregateUnresolvedEvents(events, options);
  return {
    version: 1,
    updatedAt: new Date().toISOString(),
    events,
    aggregates,
  };
}
