/**
 * Live → DailyReportPack projection.
 *
 * Pure, dependency-free transform: given (a) real research-news rows and
 * (b) the effective pulse keyword set, produce a `DailyReportPack` whose
 * metrics are ALL derived from the rows — no invented heat/growth numbers.
 *
 * Window policy (operator B, 2026-09-22):
 *  - Cards / stories / hero value = **report calendar day** (Asia/Shanghai).
 *  - Sparklines = **rolling 7 days ending on that day**, labeled Day1…Day7
 *    (Day1 = oldest, Day7 = report date).
 * Hub 综合热榜 stays limit-capped “近期”; this module does not change it.
 *
 * The API-side builder (`apps/api` / script) is responsible for fetching the
 * rows (Convex `research_news:listRecent` with `since` = day−6) and the
 * keyword seed; this module only shapes them.
 */

import type {
  DailyHeadline,
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
  /** Real article publish time (RSS <pubDate> -> ms), when the source exposes it.
   *  When present, the report buckets Day1..Day7 by this day; otherwise it
   *  falls back to capturedAt (ingest time). Carry it so a 7-day window spreads
   *  CNC news across actual publish days instead of collapsing to the ingest day. */
  publishedAt?: number;
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
  /**
   * When set, Day1…Day7 nav dates are anchored to this calendar day (the build
   * tip), so every page in a rolling-window build shares the same nav links.
   * Defaults to `date` (self-centered window).
   */
  navAnchorDate?: string;
  /**
   * Platform ids to drop from the row pool before ranking — used to keep a
   * sales-desk report CN-audience only (excludes EN feeds from TrendRadar).
   */
  excludePlatforms?: string[];
};

export type LivePackResult = {
  pack: DailyReportPack;
  /** Real counts used for hybrid fallback decisions. */
  counts: {
    rows: number;
    matched: number;
    /** Matched in the full 7d window (sparkline corpus). */
    windowMatched: number;
    hotlistMatched: number;
    items: number;
  };
  /** true when items < threshold → caller should use last good snapshot. */
  thin: boolean;
};

export const HYBRID_MIN_ITEMS = 4;

/** Sparkline length / Day1…DayN count. */
export const SPARKLINE_DAYS = 7;

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

/**
 * Surfaceability of a row, relaxing the strict real-publisher-URL rule for CN
 * news feeds specifically.
 *
 * The kicker (2026-09-25): the bulk of the daily corpus is `rss:gnews-*` /
 * `rss:bing-*` feeds whose Google wrapper URLs often fail to decode to a
 * publisher URL from this egress (region-blocked batchexecute → null). Those
 * rows would otherwise be dropped at the `hasRealNewsUrl` gate, collapsing a
 * day's distinct CNC count far below what was actually published (observed
 * 09-20→4, 09-21→8 vs 40+ wrapper titles that day).
 *
 * A CN-feed row is therefore surfaceable by title + paste + publish day alone —
 * the renderer emits it as a non-clickable row (no broken Google wrapper link
 * is shipped). Non-feed / hotlist platforms still require a real publisher URL.
 */
export function isSurfaceableNewsRow(row: LiveNewsRow): boolean {
  if (hasRealNewsUrl(row)) return true;
  const p = row.platform;
  if (!p.startsWith('rss:gnews-') && !p.startsWith('rss:bing-')) return false;
  return typeof row.title === 'string' && row.title.trim().length > 0;
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
  if (cjkCharCount(nk) >= 2) return true;
  const alnum = nk.replace(/[^A-Za-z0-9]/g, '');
  return alnum.length >= 3;
}

/** Keep strong hits; append ultra-generics only when ≥1 strong hit coexists. */
export function meaningfulHits(hits: string[]): string[] {
  const strong = hits.filter((h) => isStrongKeyword(h));
  if (strong.length === 0) return [];
  const generics = hits.filter((h) => ULTRA_GENERIC_KEYWORDS.has(normalizePulseKeyword(h)));
  return [...strong, ...generics];
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

/* ---------------------------------------------------------------------------
 * Asia/Shanghai calendar helpers (CN sales desk)
 * ------------------------------------------------------------------------- */

/** YYYY-MM-DD in Asia/Shanghai for a unix-ms timestamp. */
export function shanghaiIsoDay(ms: number): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Shanghai',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date(ms));
}

/** Start of calendar day `YYYY-MM-DD` in Asia/Shanghai (ms). */
export function shanghaiDayStartMs(dateYmd: string): number {
  const t = Date.parse(`${dateYmd}T00:00:00+08:00`);
  if (!Number.isFinite(t)) throw new Error(`Invalid date: ${dateYmd}`);
  return t;
}

/**
 * Calendar day (Asia/Shanghai) a row belongs to.
 * Prefer the real publish time (`publishedAt`) so a 7-day window spreads news
 * across its actual publish days even when every row was ingested in one run;
 * fall back to `capturedAt` (ingest time) when the source carried no date.
 */
export function rowDay(row: LiveNewsRow): string {
  const ms = typeof row.publishedAt === 'number' && Number.isFinite(row.publishedAt)
    ? row.publishedAt
    : row.capturedAt;
  return shanghaiIsoDay(ms);
}

/** "As-of" timestamp used for sparkline series + recency: publish day when set. */
export function rowAsOf(row: LiveNewsRow): number {
  return typeof row.publishedAt === 'number' && Number.isFinite(row.publishedAt)
    ? row.publishedAt
    : row.capturedAt;
}

/** `since` for listRecent: start of (reportDate − (SPARKLINE_DAYS−1)). */
export function sparklineWindowSinceMs(reportDateYmd: string): number {
  return shanghaiDayStartMs(reportDateYmd) - (SPARKLINE_DAYS - 1) * 86_400_000;
}

/**
 * Pulse hub window: start of (Shanghai today − (windowDays−1)).
 * `windowDays=1` → 今日; `windowDays=7` → Day1…Day7 ending today.
 */
export function pulseWindowSinceMs(windowDays: number, nowMs = Date.now()): number {
  const days = Math.min(Math.max(Math.floor(windowDays) || 1, 1), 31);
  const today = shanghaiIsoDay(nowMs);
  return shanghaiDayStartMs(today) - (days - 1) * 86_400_000;
}

/** Day1…DayN labels (oldest → newest). DayN = report date. */
export function sparklineDayLabels(n = SPARKLINE_DAYS): string[] {
  return Array.from({ length: n }, (_, i) => `Day${i + 1}`);
}

/**
 * Calendar dates for Day1…DayN ending on `reportDateYmd` (Asia/Shanghai).
 * DayN = report date; Day1 = report − (n−1) days.
 */
export function sparklineDayDates(reportDateYmd: string, n = SPARKLINE_DAYS): string[] {
  const end = shanghaiDayStartMs(reportDateYmd);
  return Array.from({ length: n }, (_, i) => {
    const ms = end - (n - 1 - i) * 86_400_000;
    return shanghaiIsoDay(ms);
  });
}

/** MM-DD short label for nav (from YYYY-MM-DD). */
export function shortMdDate(ymd: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(ymd);
  return m ? `${m[2]}-${m[3]}` : ymd;
}

export function buildLivePack(rows: LiveNewsRow[], opts: LivePackOptions): LivePackResult {
  const hotlistPlatforms = opts.hotlistPlatforms ?? [];
  const isHot = (p: string) =>
    hotlistPlatforms.length > 0 ? hotlistPlatforms.includes(p) : isHotlistPlatform(p);

  const reportDate = opts.date;
  const windowEndMs = shanghaiDayStartMs(reportDate) + 86_400_000 - 1;

  // CN-audience, sales-first: drop non-CN sources (EN feeds from TrendRadar)
  // before anything ranks, so hero/cards/rows/stories all reflect the CN desk.
  const cnOnlyRows = opts.excludePlatforms?.length
    ? rows.filter((row) => !opts.excludePlatforms!.includes(row.platform))
    : rows;

  // Annotate the full 7d window (caller should pass since=day−6).
  // day-scoping uses publish day (publishedAt) so a 7d window spreads rows by
  // their actual publish day, not by a single ingest capturedAt day.
  // Eligibility = publish day within [Day1, reportDate] (lower bound). Old
  // evergreen 深度报告/市场分析 rows (publishedAt 2023/2024/2025) are ingested
  // at `capturedAt` now but belong to years ago; without a lower bound they
  // flood a thin report day's surfaced slots (预见2023/2024… leak). Fall back
  // to capturedAt (always recent) when the row carried no publish date.
  const windowDay1 = sparklineDayDates(reportDate)[0];
  const windowAnnotated = cnOnlyRows
    .filter((row) => isSurfaceableNewsRow(row))
    .filter((row) => {
      const day = rowDay(row);
      return day >= windowDay1 && day <= reportDate;
    })
    .map((row) => {
      const rawHits = matchKeywords(row, opts.keywords);
      const hits = meaningfulHits(rawHits);
      return { row, hits };
    })
    .filter((x) => x.hits.length > 0)
    .sort((a, b) => rowAsOf(b.row) - rowAsOf(a.row));

  // Hero = report calendar day only (honest matched count stays day-scoped).
  // Bucketed by publish day (publishedAt) so a row published today counts today
  // even though it may have been ingested earlier/later in the same run.
  const dayAnnotated = windowAnnotated.filter((x) => rowDay(x.row) === reportDate);
  const hotlistMatched = dayAnnotated.filter((x) => isHot(x.row.platform));

  // De-dupe across the FULL 7d window so the sections can fill with distinct
  // items instead of echoing a thin report day (a single ingest run stamps
  // every row on one day; without window fallback the page would show 3).
  const seen = new Set<string>();
  const windowUnique = windowAnnotated.filter((x) => {
    const key = normalizePulseKeyword(shortLabel(x.row.title));
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });

  // Rank: report-day first (cards feel fresh), then hotlist, strong-hit count,
  // total hits, then recency (as-of time = publish day when set).
  const ranked = [...windowUnique].sort((a, b) => {
    const dayA = rowDay(a.row) === reportDate ? 1 : 0;
    const dayB = rowDay(b.row) === reportDate ? 1 : 0;
    if (dayA !== dayB) return dayB - dayA;
    const ha = isHot(a.row.platform) ? 1 : 0;
    const hb = isHot(b.row.platform) ? 1 : 0;
    if (ha !== hb) return hb - ha;
    const sa = a.hits.filter((h) => isStrongKeyword(h)).length;
    const sb = b.hits.filter((h) => isStrongKeyword(h)).length;
    if (sa !== sb) return sb - sa;
    if (a.hits.length !== b.hits.length) return b.hits.length - a.hits.length;
    return rowAsOf(b.row) - rowAsOf(a.row);
  });

  // Carve SECTIONS from one ranked pool so 今日商机 cards, 今日趋势 rows and
  // 热闻 stories are DISJOINT (previously the same top-3 echoed in all three).
  const maxOpp = opts.maxOpportunities ?? 3; // 商机 cards
  const maxRows = opts.maxTrendRows ?? 8; // 今日趋势 rows (raised 6 → 8)
  const maxStories = opts.maxStories ?? 6; // 热闻 stories (raised 3 → 6)
  const oppCount = Math.min(maxOpp + maxRows, ranked.length);

  // SURFACE ELIGIBILITY (Option A — honest sparse thin day): when the report day
  // itself has no matched items, do NOT pad the surfaced 商机/热闻 sections from
  // earlier window days. A thin/empty day should surface only its OWN same-day
  // items (even if that's 0) so today's report never re-renders yesterday's news
  // as if it were today's. (The evergreen publish-age cutoff in windowAnnotated
  // already removed 2023/2024 SEO rows; this removes the 09-20…09-23 window fill.)
  const daySurfacePool =
    dayAnnotated.length > 0
      ? ranked.filter((x) => rowDay(x.row) === reportDate)
      : [];

  const platformCount = (platform: string): number =>
    dayAnnotated.filter((a) => a.row.platform === platform).length;

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
    const href = row.url && row.url.trim() ? row.url.trim() : '';
    return toOpportunityWith({ row, hits, kind, chips, href });
  };

  const toOpportunityWith = ({
    row,
    hits,
    kind,
    chips,
    href,
  }: {
    row: LiveNewsRow
    hits: string[]
    kind: OpportunityKind
    chips: string[]
    href: string
  }): DailyOpportunity => ({
    kind,
    label: shortLabel(row.title),
    heat: heatFor(row, hits),
    growth: String(platformCount(row.platform)),
    started: rowDay(row),
    rowDay: rowDay(row),
    rowAsOf: rowAsOf(row),
    rowPlatform: row.platform,
    // 7-point series from the full window (Day1…Day7).
    sparkline: platformDailySeries(windowAnnotated, row.platform, windowEndMs, reportDate),
    chips,
    // Omit `href` entirely when the row has no usable publisher URL (CN-feed row
    // whose Google wrapper didn't decode). An empty string fails the strict pack
    // validator isStr (requires length>0) and must not be emitted.
    ...(href ? { href } : {}),
    imageUrl: buildDailyReportThumbDataUri({ title: row.title, kind, chips }),
    ...(row.rawSnippet ? { snippet: row.rawSnippet.slice(0, 120) } : {}),
  });

  // Carve 商机 opportunities (cards + trend rows) and 热闻 stories from the
  // report-day surface pool (daySurfacePool) — always disjoint, and never
  // window-padding a thin report day (empty pool when no same-day match).
  // 定稿C TODAY = DOWNSTREAM rows first, then 商机/新闻: the renderer merges
  // `opportunities` + `stories` (both report-day-scoped) into one 商机/新闻
  // group, so the boss's news-first report shows the full same-day corpus.
  const opportunities = daySurfacePool.slice(0, oppCount).map(toOpportunity);

  const stories: DailyStory[] = daySurfacePool
    .slice(oppCount, oppCount + maxStories)
    .map((x) => {
      const chips = x.hits.slice(0, 2);
      const href = x.row.url && x.row.url.trim() ? x.row.url.trim() : '';
      return {
        title: shortLabel(x.row.title),
        ...(href ? { href } : {}),
        rowDay: rowDay(x.row),
        rowAsOf: rowAsOf(x.row),
        imageUrl: buildDailyReportThumbDataUri({
          title: x.row.title,
          kind: 'story',
          chips,
        }),
      };
    });

  const matchedCount = dayAnnotated.length;
  const windowMatched = windowAnnotated.length;
  // Hero headline = report-day matched count, but a fresh sparse day (single-ingest
  // corpus where every row lands on one day) would honestly print 0 and look broken.
  // Fall back to the 7-day window total when the report day is empty, so the number is
  // never a misleading zero; delta becomes — (no day-vs-prev comparison) on fallback.
  const usingWindow = matchedCount === 0 && windowMatched > 0;
  const heroValue = usingWindow ? windowMatched : matchedCount;
  const prevMatched = opts.previous?.hero?.value ? Number(opts.previous.hero.value) : null;
  const delta =
    usingWindow || !(prevMatched && Number.isFinite(prevMatched) && prevMatched > 0)
      ? '—'
      : `${heroValue >= prevMatched ? '+' : ''}${Math.round(((heroValue - prevMatched) / prevMatched) * 100)}%`;

  const dayLabels = sparklineDayLabels(SPARKLINE_DAYS);
  const navAnchor = opts.navAnchorDate ?? reportDate;
  const dayDates = sparklineDayDates(navAnchor, SPARKLINE_DAYS);
  // Distinct items surfaced across all three sections (card + row + story).
  const items = opportunities.length + stories.length;

  // ── 定稿C: single masked headline = top same-day matched item (no invented
  //    content). Backend-supplied `pack.headline` overrides this if present.
  const topSameDay = daySurfacePool[0];
  const headline: DailyHeadline = topSameDay
    ? {
        title: shortLabel(topSameDay.row.title, 60),
        tag: kindForPlatform(topSameDay.row.platform),
        source: platformLabelFor(topSameDay.row.platform),
        href: topSameDay.row.url,
      }
    : { title: '' };

  // ── 定稿C: DOWNSTREAM rows (下游工业用户需求) from the report-day pool —
  //    backend pre-filters downstream keyword hits (压铸/压铸厂/die-casting/
  //    模具/五金 etc). Chip = first downstream hit. When empty and the report
  //    day is thin, also scan the rolling window so a sparse day still surfaces
  //    downstream demand (hybrid-safe; boss wants downstream-first).
  let downstream = daySurfacePool
    .filter((x) => isDownstreamHit(x.hits))
    .slice(0, 12)
    .map((x) => ({
      title: shortLabel(x.row.title),
      tag: downstreamChip(x.hits),
      source: platformLabelFor(x.row.platform),
      day: rowDay(x.row),
      publishedAt: typeof x.row.publishedAt === 'number' ? x.row.publishedAt : undefined,
      href: x.row.url,
    }));
  if (downstream.length === 0) {
    downstream = windowAnnotated
      .filter((x) => isDownstreamHit(x.hits))
      .slice(0, 6)
      .map((x) => ({
        title: shortLabel(x.row.title),
        tag: downstreamChip(x.hits),
        source: platformLabelFor(x.row.platform),
        day: rowDay(x.row),
        publishedAt: typeof x.row.publishedAt === 'number' ? x.row.publishedAt : undefined,
        href: x.row.url,
      }));
  }

  const pack: DailyReportPack = {
    date: opts.date,
    localeDefault: 'zh-Hans',
    source: 'live',
    generatedAt: opts.generatedAt,
    hero: {
      headline: '今日行业热度',
      value: String(heroValue),
      delta,
      meta: `${new Set(dayAnnotated.map((a) => a.row.platform)).size} 来源 · ${hotlistMatched.length} 热榜命中 · ${dayDates[0]}–${dayDates[dayDates.length - 1]}`,
      sparkline: overallDailySeries(windowAnnotated, windowEndMs, reportDate),
      dayLabels,
      dayDates,
    },
    opportunities,
    stories,
    headline,
    downstream,
  };

  return {
    pack,
    counts: {
      rows: cnOnlyRows.length,
      matched: matchedCount,
      windowMatched: windowAnnotated.length,
      hotlistMatched: hotlistMatched.length,
      items,
    },
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

/** 定稿C: normalized lowercase keyword for downstream membership checks. */
function normKw(k: string): string {
  return k.trim().normalize('NFKC').replace(/[A-Za-z]+/g, (m) => m.toLowerCase());
}

/**
 * 定稿C downstream keyword set (下游工业用户需求), matching boss N. Lai's ask
 * (压铸厂 / die-casting / 模具 / 五金 / 下游应用行业). Substring (OR) match.
 */
export const DOWNSTREAM_KEYWORDS: ReadonlySet<string> = new Set([
  '压铸', '压铸厂', '压铸机', 'die-casting', 'die casting', '模具', '五金',
  '铸件', '铸造', '注塑', '冲压', '锻造', '锻压', '钣金', '塑胶', '零件加工',
  '机加工', '下游', '工业用户', '采购需求',
].map(normKw));

/** True when any downstream-flagged hit is present. */
export function isDownstreamHit(hits: string[]): boolean {
  return hits.some((h) => DOWNSTREAM_KEYWORDS.has(normKw(h)));
}

/** First downstream hit to use as the row's keyword chip. */
export function downstreamChip(hits: string[]): string {
  const kw = hits.find((h) => DOWNSTREAM_KEYWORDS.has(normKw(h)));
  return kw || '下游';
}

/** Human source label for a platform id (机械行业/工业网-facing). */
export function platformLabelFor(platform: string): string {
  const id = (platform || '').replace(/^rss:/, '');
  const known: Record<string, string> = {
    'gnews-diecast': '压铸网',
    'bing-cnc-machine': '工业网',
    'bing-gongyemuji': '工业网',
    'bing-muju': '模具网',
    'bing-chongya': '压铸网',
    'gnews-cnc-machine': '数控机床要闻',
    'gnews-gongyemuji': '工业母机要闻',
    'gnews-muju-qiche': '模具网',
    'gnews-chongya': '冲压网',
  };
  return known[id] || id;
}

/**
 * Matched-title count per day for one platform over Day1…DayN ending on reportDate.
 *
 * NOTE: `capturedAt` is the INGEST time, not the article publish time, so a
 * single ingest run puts every row on one day. The series therefore only shows
 * real spread once the worker has run on ≥2 days; until then it is honestly
 * flat except for the newest day.
 */
function platformDailySeries(
  annotated: Array<{ row: LiveNewsRow }>,
  platform: string,
  _endMs: number,
  reportDate: string,
): number[] {
  return dailySeries(
    annotated.filter((a) => a.row.platform === platform).map((a) => a.row),
    reportDate,
  );
}

function overallDailySeries(
  annotated: Array<{ row: LiveNewsRow }>,
  _endMs: number,
  reportDate: string,
): number[] {
  return dailySeries(
    annotated.map((a) => a.row),
    reportDate,
  );
}

/** Bucket counts into Day1…DayN where DayN = reportDate (Shanghai). */
function dailySeries(rows: LiveNewsRow[], reportDate: string): number[] {
  const days = SPARKLINE_DAYS;
  const endStart = shanghaiDayStartMs(reportDate);
  const out = new Array(days).fill(0);
  for (const row of rows) {
    const day = rowDay(row);
    const dayStart = shanghaiDayStartMs(day);
    const idx = days - 1 - Math.round((endStart - dayStart) / 86_400_000);
    if (idx >= 0 && idx < days) out[idx] += 1;
  }
  return out;
}
