/**
 * Live → DailyReportPack projection.
 *
 * Pure, dependency-free transform: given (a) real research-news rows and
 * (b) the effective pulse keyword set, produce a `DailyReportPack` whose
 * metrics are ALL derived from the rows — no invented heat/growth numbers.
 *
 * The API-side builder (`apps/api` / script) is responsible for fetching the
 * rows (Convex `research_news:listRecent`) and the keyword seed; this module
 * only shapes them, so it is unit-testable in the node vitest env.
 */

import type {
  DailyOpportunity,
  DailyReportPack,
  DailyStory,
  OpportunityKind,
} from './daily-report-pack.js';
import { isGoogleNewsArticleUrl } from './daily-report-article-url.js';
import { buildDailyReportThumbDataUri } from './daily-report-thumb.js';

export type LiveNewsRow = {
  title: string;
  platform: string;
  url?: string;
  capturedAt: number;
  rawSnippet?: string;
  /** Platform-native hotlist rank (1 = top), when the source exposes one. */
  rank?: number;
};

export type LivePackOptions = {
  date: string;
  generatedAt: string;
  /** Effective pulse keyword set (seed ∪ workspace overlay). */
  keywords: string[];
  /** Platform ids treated as NewsNow hotlist (non-`rss:*`). */
  hotlistPlatforms?: string[];
  /** Max 商机 trend-cards (default 3). */
  maxOpportunities?: number;
  /** Max trend-table rows (default 6). */
  maxTrendRows?: number;
  /** Max hot stories (default 3). */
  maxStories?: number;
  /** Prior-day pack used for honest growth (matchedCount delta). */
  previous?: DailyReportPack | null;
  /** Platform label map for display (id → 中文名). */
  platformLabels?: Record<string, string>;
  /**
   * Per-platform hotlist rank (platform → { title → rank }). When present, a
   * hotlist row's real 热度 = `rankTotal - rank + 1` (higher = hotter), so the
   * hero/card heat is the platform's actual 热榜 position, not a proxy.
   */
  hotlistRanks?: Record<string, Record<string, number>>;
  /** Total ranked rows per platform (for the rank→heat inversion). */
  hotlistRankTotals?: Record<string, number>;
};

export type LivePackResult = {
  pack: DailyReportPack;
  /** Real counts used for hybrid fallback decisions. */
  counts: { rows: number; matched: number; hotlistMatched: number; items: number };
  /** true when items < threshold → caller should use last good snapshot. */
  thin: boolean;
};

export const HYBRID_MIN_ITEMS = 4;

/**
 * Ultra-generic hiring/sales tokens. Alone they match crime/business noise
 * ("线上报复订单"); keep only when a stronger industrial hit is also present.
 */
export const ULTRA_GENERIC_KEYWORDS: ReadonlySet<string> = new Set(
  ['订单', '招聘', '采购', '签约', '中标', '扩产'].map((k) => normalizePulseKeyword(k)),
);

/** NFKC + Latin-lowercase, mirroring research-pulse-keywords normalizePulseKeyword. */
export function normalizePulseKeyword(k: string): string {
  return k.trim().normalize('NFKC').replace(/[A-Za-z]+/g, (m) => m.toLowerCase());
}

export function isHotlistPlatform(platform: string): boolean {
  const p = platform.trim().toLowerCase();
  return p.length > 0 && !p.startsWith('rss:');
}

/**
 * True when the row carries a usable http(s) publisher news URL.
 * Google News wrapper URLs are rejected — resolve them upstream
 * (`resolveOriginalArticleUrl`) before calling `buildLivePack`.
 */
export function hasRealNewsUrl(row: LiveNewsRow): boolean {
  const u = (row.url ?? '').trim();
  if (!u) return false;
  if (!/^https?:\/\//i.test(u)) return false;
  if (isGoogleNewsArticleUrl(u)) return false;
  return true;
}

/** CJK code-point count (rough; surrogate pairs handled via spread). */
function cjkCharCount(s: string): number {
  let n = 0;
  for (const ch of s) {
    const cp = ch.codePointAt(0) ?? 0;
    if (
      (cp >= 0x4e00 && cp <= 0x9fff) ||
      (cp >= 0x3400 && cp <= 0x4dbf) ||
      (cp >= 0xf900 && cp <= 0xfaff)
    ) {
      n += 1;
    }
  }
  return n;
}

/**
 * Industry-meaningful keyword (not ultra-generic alone worth).
 * Length gate: ≥2 CJK chars OR ≥3 Latin/ASCII alnum chars.
 */
export function isStrongKeyword(kw: string): boolean {
  const nk = normalizePulseKeyword(kw);
  if (!nk || ULTRA_GENERIC_KEYWORDS.has(nk)) return false;
  const cjk = cjkCharCount(nk);
  if (cjk > 0) return [...nk].length >= 2;
  const latin = (nk.match(/[a-z0-9]/gi) ?? []).length;
  return latin >= 3;
}

export function isUltraGenericKeyword(kw: string): boolean {
  return ULTRA_GENERIC_KEYWORDS.has(normalizePulseKeyword(kw));
}

/**
 * Keep strong (industrial) hits; drop generic-only match sets.
 * When ≥1 strong hit exists, return strong hits first then generics (for chips).
 * Generic-only → [] (caller filters the row out).
 */
export function meaningfulHits(hits: string[]): string[] {
  if (hits.length === 0) return [];
  const strong: string[] = [];
  const weak: string[] = [];
  for (const h of hits) {
    if (isStrongKeyword(h)) strong.push(h);
    else if (isUltraGenericKeyword(h)) weak.push(h);
  }
  if (strong.length === 0) return [];
  return [...strong, ...weak];
}

/** Substring (OR) match of the effective keyword set on title+snippet. */
export function matchKeywords(row: LiveNewsRow, keywords: string[]): string[] {
  const hay = normalizePulseKeyword(`${row.title} ${row.rawSnippet ?? ''}`);
  const hits: string[] = [];
  for (const kw of keywords) {
    const nk = normalizePulseKeyword(kw);
    if (nk && hay.includes(nk)) hits.push(kw);
  }
  return hits;
}

function kindForPlatform(platform: string): OpportunityKind {
  // Honest mapping: hotlist hits are 商机 (desk-visible trend); brand/company
  // RSS is 转机 (supply-side signal); everything else is 动态.
  if (isHotlistPlatform(platform)) return '商机';
  if (platform.toLowerCase().includes('hiring') || platform.toLowerCase().includes('hire')) return '转机';
  return '动态';
}

export function buildLivePack(rows: LiveNewsRow[], opts: LivePackOptions): LivePackResult {
  const hotlistPlatforms = opts.hotlistPlatforms ?? [];
  const isHot = (p: string) =>
    hotlistPlatforms.length > 0 ? hotlistPlatforms.includes(p) : isHotlistPlatform(p);

  // Drop rows without a real news URL before ranking — cards/stories always
  // carry href. Then require ≥1 industry-strong keyword hit (generic-only → 0).
  const annotated = rows
    .filter((row) => hasRealNewsUrl(row))
    .map((row) => {
      const rawHits = matchKeywords(row, opts.keywords);
      const hits = meaningfulHits(rawHits);
      return { row, hits };
    })
    .filter((x) => x.hits.length > 0)
    .sort((a, b) => b.row.capturedAt - a.row.capturedAt);

  const hotlistMatched = annotated.filter((x) => isHot(x.row.platform));

  // Dedupe by the display label (same story syndicated across feeds with a
  // different " - 来源" suffix collapses to one row).
  const seen = new Set<string>();
  const unique = annotated.filter((x) => {
    const key = normalizePulseKeyword(shortLabel(x.row.title));
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });

  // Rank: hotlist first, then strong-hit count, then total hits, then recency.
  const ranked = [...unique].sort((a, b) => {
    const ha = isHot(a.row.platform) ? 1 : 0;
    const hb = isHot(b.row.platform) ? 1 : 0;
    if (ha !== hb) return hb - ha;
    const sa = a.hits.filter((h) => isStrongKeyword(h)).length;
    const sb = b.hits.filter((h) => isStrongKeyword(h)).length;
    if (sa !== sb) return sb - sa;
    if (a.hits.length !== b.hits.length) return b.hits.length - a.hits.length;
    return b.row.capturedAt - a.row.capturedAt;
  });

  const maxOpp = opts.maxOpportunities ?? 3;
  const maxRows = opts.maxTrendRows ?? 6;
  const maxStories = opts.maxStories ?? 3;

  // Real per-platform matched-title count (used for honest growth).
  const platformCount = (platform: string): number =>
    annotated.filter((a) => a.row.platform === platform).length;

  // Real 热度: prefer the platform-native hotlist rank when the row has one
  // (higher position → higher heat); otherwise the matched-keyword count is the
  // only honest signal available.
  const heatFor = (row: LiveNewsRow, hits: string[]): string => {
    const total = opts.hotlistRankTotals?.[row.platform];
    if (row.rank != null && total != null && total > 0) {
      return String(Math.max(total - row.rank + 1, 1));
    }
    return String(hits.length);
  };

  const toOpportunity = (x: (typeof ranked)[number]): DailyOpportunity => {
    const { row, hits } = x;
    const kind = kindForPlatform(row.platform);
    const chips = hits.slice(0, 3);
    const href = row.url!.trim();
    return {
      kind,
      label: shortLabel(row.title),
      heat: heatFor(row, hits),
      // Honest growth: this platform's matched-title count in the window.
      growth: String(platformCount(row.platform)),
      started: isoDay(row.capturedAt),
      // 7-point series: this platform's matched-title count across the last 7 days.
      sparkline: platformDailySeries(annotated, row.platform, row.capturedAt),
      chips,
      href,
      imageUrl: buildDailyReportThumbDataUri({ title: row.title, kind, chips }),
      ...(row.rawSnippet ? { snippet: row.rawSnippet.slice(0, 120) } : {}),
    };
  };

  const opportunities = ranked.slice(0, maxOpp).map(toOpportunity);
  // Trend-table rows are the same shape, just a longer slice; the renderer
  // reuses `opportunities` for both sections (cards = first 3, table = all).
  void maxRows;

  const stories: DailyStory[] = ranked.slice(0, maxStories).map((x) => {
    const chips = x.hits.slice(0, 2);
    return {
      title: shortLabel(x.row.title),
      href: x.row.url!.trim(),
      imageUrl: buildDailyReportThumbDataUri({
        title: x.row.title,
        kind: 'story',
        chips,
      }),
    };
  });

  const matchedCount = annotated.length;
  const prevMatched = opts.previous?.hero?.value ? Number(opts.previous.hero.value) : null;
  const delta =
    prevMatched && Number.isFinite(prevMatched) && prevMatched > 0
      ? `${matchedCount >= prevMatched ? '+' : ''}${Math.round(((matchedCount - prevMatched) / prevMatched) * 100)}%`
      : '—';

  const items = opportunities.length + stories.length;
  const pack: DailyReportPack = {
    date: opts.date,
    localeDefault: 'zh-Hans',
    source: 'live',
    generatedAt: opts.generatedAt,
    hero: {
      headline: '今日行业热度',
      value: String(matchedCount),
      delta,
      meta: `${new Set(annotated.map((a) => a.row.platform)).size} 来源 · ${hotlistMatched.length} 热榜命中`,
      sparkline: overallDailySeries(annotated),
    },
    opportunities,
    stories,
  };

  return {
    pack,
    counts: { rows: rows.length, matched: matchedCount, hotlistMatched: hotlistMatched.length, items },
    thin: items < HYBRID_MIN_ITEMS,
  };
}

/** Compact one-line label from a headline (strip source suffix, cap length). */
export function shortLabel(title: string, max = 42): string {
  let t = title.normalize('NFKC').trim();
  // Drop trailing " - 来源" / " | 来源" suffixes common in RSS titles.
  t = t.replace(/\s+[-|–—]\s+[^-|–—]{1,24}$/u, '').trim();
  if (t.length > max) t = `${t.slice(0, max - 1)}…`;
  return t;
}

function isoDay(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10);
}

/**
 * Matched-title count per day for one platform over the 7 days ending at `endMs`.
 *
 * NOTE: `capturedAt` is the INGEST time, not the article publish time, so a
 * single ingest run puts every row on one day. The series therefore only shows
 * real spread once the worker has run on ≥2 days; until then it is honestly
 * flat except for the newest day.
 */
function platformDailySeries(
  annotated: Array<{ row: LiveNewsRow }>,
  platform: string,
  endMs: number,
): number[] {
  return dailySeries(annotated.filter((a) => a.row.platform === platform).map((a) => a.row), endMs);
}

/** Overall matched-title count per day over the last 7 days. */
function overallDailySeries(annotated: Array<{ row: LiveNewsRow }>): number[] {
  const endMs = Math.max(...annotated.map((a) => a.row.capturedAt), 0);
  return dailySeries(annotated.map((a) => a.row), endMs);
}

function dailySeries(rows: LiveNewsRow[], endMs: number): number[] {
  const days = 7;
  const end = startOfUtcDay(endMs);
  const out = new Array(days).fill(0);
  for (const row of rows) {
    const idx = days - 1 - Math.round((end - startOfUtcDay(row.capturedAt)) / 86_400_000);
    if (idx >= 0 && idx < days) out[idx] += 1;
  }
  return out;
}

function startOfUtcDay(ms: number): number {
  return Math.floor(ms / 86_400_000) * 86_400_000;
}
