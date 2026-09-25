/**
 * DailyReportPack — the dated snapshot a worker (or demo script) builds and a
 * static renderer turns into `daily/YYYY-MM-DD.html`.
 *
 * Contract (v1, M3 layout):
 *  - hero: one big number + interest-over-time sparkline.
 *  - opportunities: 3 trend-cards for 今日商机, and the trend-table rows for
 *    今日趋势 reuse the same shape (rank = array order).
 *  - stories: 2–3 one-line hot stories.
 *  - CN-primary (zh-Hans) with a client-side EN toggle in the same HTML.
 *
 * No resume/PII ever belongs in a pack — it is a public static artifact.
 */

export type DailyReportPackSource = 'live' | 'frozen';

export type OpportunityKind = '商机' | '转机' | '动态';

export type DailyOpportunity = {
  kind: OpportunityKind;
  /** one short line, e.g. "3D 扫描 销售" */
  label: string;
  /** absent → gradient tile with a kind glyph; live pack sets SVG data-URI */
  imageUrl?: string;
  /** e.g. "3.8万" */
  heat: string;
  /** e.g. "+1,200%" (▲/▼ prepended at render) */
  growth: string;
  /** i18n key resolved by the client map: 今晨 / 昨天 / N天前 */
  started: string;
  /** 7-day trend series, normalized 0–100 */
  sparkline: number[];
  /** 趋势细分 */
  chips?: string[];
  /** Optional one-line evidence snippet from the source row (no PII). */
  snippet?: string;
  href?: string;
  /** Calendar day (Asia/Shanghai YYYY-MM-DD) the source row belongs to — set by
   *  buildLivePack for per-day (TODAY) scoping in the 定稿C layout. */
  rowDay?: string;
  /** Unix-ms as-of (publish day when set) for the row — drives `X 小时前` age. */
  rowAsOf?: number;
  /** Source platform id (e.g. `rss:gnews-diecast`) for the source label. */
  rowPlatform?: string;
};

export type DailyStory = {
  title: string;
  imageUrl?: string;
  href?: string;
  /** Calendar day (Asia/Shanghai YYYY-MM-DD) the source row belongs to (定稿C per-day TODAY scoping). */
  rowDay?: string;
  /** Unix-ms as-of (publish day when set) — drives `X 小时前` age. */
  rowAsOf?: number;
};

/**
 * 定稿C single masked headline (backend-supplied; renderer falls back to the
 * top same-day opportunity when `title` is absent). NO publish date, NOT pinned.
 */
export type DailyHeadline = {
  title: string;
  tag?: string;
  source?: string;
  href?: string;
};

/**
 * 定稿C DOWNSTREAM row (下游工业用户需求): keyword chip + title + source + age.
 * Backend pre-filters downstream keywords (压铸/压铸厂/die-casting/模具/五金);
 * the renderer does no keyword filtering.
 */
export type DailyDownstreamRow = {
  title: string;
  tag?: string;
  source?: string;
  /** Calendar day (YYYY-MM-DD) the row belongs to (for age bucketing). */
  day?: string;
  /** Real publish time ms (for `X 小时前` age). */
  publishedAt?: number;
  href?: string;
  imageUrl?: string;
  /** Raw downstream hit keyword (display chip when `tag` absent). */
  keyword?: string;
};

/** One FEATURED card (video/gallery) — type + length only, no dates. */
export type DailyFeatured = {
  title: string;
  type?: 'video' | 'gallery' | string;
  length?: string;
  imageUrl?: string;
  href?: string;
};

export type DailyReportPack = {
  date: string; // YYYY-MM-DD
  localeDefault: 'zh-Hans';
  source: DailyReportPackSource;
  generatedAt: string; // ISO
  hero: {
    headline: string;
    value: string;
    delta: string;
    meta: string;
    sparkline: number[];
    /** Day1…DayN labels aligned with sparkline (oldest → newest). */
    dayLabels?: string[];
    /** Calendar dates (YYYY-MM-DD) for Day1…DayN — used as nav links. */
    dayDates?: string[];
  };
  opportunities: DailyOpportunity[];
  stories: DailyStory[];
  /** 定稿C single masked headline. Absent → renderer falls back to top same-day item. */
  headline?: DailyHeadline;
  /** 定稿C TODAY DOWNSTREAM rows (keyword chip + title + source + age). */
  downstream?: DailyDownstreamRow[];
  /** 定稿C FEATURED blue band (VIDEO / GALLERY, no dates). Omit → section hidden. */
  featured?: { video: DailyFeatured[]; gallery: DailyFeatured[] };
  fallbackFromDate?: string;
  /** Honest hybrid notice shown as a banner (沿用最近完整日). */
  banner?: string;
};

/* ---------------------------------------------------------------------------
 * Runtime validation (no zod dependency — repo shared pkg uses hand-rolled
 * guards, e.g. market.ts / workspace.ts).
 * ------------------------------------------------------------------------- */

const KIND_SET: ReadonlySet<string> = new Set(['商机', '转机', '动态']);

function isStr(v: unknown): v is string {
  return typeof v === 'string' && v.length > 0;
}
function isOptStr(v: unknown): boolean {
  return v === undefined || typeof v === 'string';
}
function isNumArr(v: unknown): v is number[] {
  return Array.isArray(v) && v.every((n) => typeof n === 'number' && Number.isFinite(n));
}
function isStrArr(v: unknown): boolean {
  return Array.isArray(v) && v.every((n) => typeof n === 'string');
}

export function isDailyOpportunity(v: unknown): v is DailyOpportunity {
  if (typeof v !== 'object' || v === null) return false;
  const o = v as Record<string, unknown>;
  return (
    typeof o.kind === 'string' &&
    KIND_SET.has(o.kind) &&
    isStr(o.label) &&
    (o.imageUrl === undefined || isStr(o.imageUrl)) &&
    isStr(o.heat) &&
    isStr(o.growth) &&
    isStr(o.started) &&
    isNumArr(o.sparkline) &&
    (o.chips === undefined || isStrArr(o.chips)) &&
    (o.snippet === undefined || typeof o.snippet === 'string') &&
    (o.href === undefined || isStr(o.href)) &&
    (o.rowDay === undefined || isStr(o.rowDay)) &&
    (o.rowAsOf === undefined || typeof o.rowAsOf === 'number') &&
    (o.rowPlatform === undefined || isStr(o.rowPlatform))
  );
}

export function isDailyStory(v: unknown): v is DailyStory {
  if (typeof v !== 'object' || v === null) return false;
  const s = v as Record<string, unknown>;
  return (
    isStr(s.title) &&
    (s.imageUrl === undefined || isStr(s.imageUrl)) &&
    isOptStr(s.href) &&
    (s.rowDay === undefined || isStr(s.rowDay)) &&
    (s.rowAsOf === undefined || typeof s.rowAsOf === 'number')
  );
}

function isDailyHeadline(v: unknown): boolean {
  if (typeof v !== 'object' || v === null) return false;
  const h = v as Record<string, unknown>;
  return (
    isStr(h.title) &&
    (h.tag === undefined || isStr(h.tag)) &&
    (h.source === undefined || isStr(h.source)) &&
    (h.href === undefined || isStr(h.href))
  );
}

function isDailyDownstreamRow(v: unknown): boolean {
  if (typeof v !== 'object' || v === null) return false;
  const r = v as Record<string, unknown>;
  return (
    isStr(r.title) &&
    (r.tag === undefined || isStr(r.tag)) &&
    (r.source === undefined || isStr(r.source)) &&
    (r.day === undefined || isStr(r.day)) &&
    (r.publishedAt === undefined || typeof r.publishedAt === 'number') &&
    (r.href === undefined || isStr(r.href)) &&
    (r.imageUrl === undefined || isStr(r.imageUrl)) &&
    (r.keyword === undefined || isStr(r.keyword))
  );
}

function isDailyFeatured(v: unknown): boolean {
  if (typeof v !== 'object' || v === null) return false;
  const f = v as Record<string, unknown>;
  return (
    isStr(f.title) &&
    (f.type === undefined || isStr(f.type)) &&
    (f.length === undefined || isStr(f.length)) &&
    (f.imageUrl === undefined || isStr(f.imageUrl)) &&
    (f.href === undefined || isStr(f.href))
  );
}

/** A `featured` block is valid only when both buckets are arrays (may be empty). */
function isDailyFeaturedBlock(v: unknown): boolean {
  if (typeof v !== 'object' || v === null) return false;
  const f = v as Record<string, unknown>;
  return (
    Array.isArray(f.video) &&
    f.video.every(isDailyFeatured) &&
    Array.isArray(f.gallery) &&
    f.gallery.every(isDailyFeatured)
  );
}

export function isDailyReportPack(v: unknown): v is DailyReportPack {
  if (typeof v !== 'object' || v === null) return false;
  const p = v as Record<string, unknown>;
  const hero = p.hero as Record<string, unknown> | undefined;
  return (
    isStr(p.date) &&
    p.localeDefault === 'zh-Hans' &&
    (p.source === 'live' || p.source === 'frozen') &&
    isStr(p.generatedAt) &&
    !!(hero && typeof hero === 'object') &&
    isStr(hero.headline) &&
    isStr(hero.value) &&
    isStr(hero.delta) &&
    isStr(hero.meta) &&
    isNumArr(hero.sparkline) &&
    (hero.dayLabels === undefined ||
      (Array.isArray(hero.dayLabels) &&
        hero.dayLabels.every((x) => typeof x === 'string') &&
        hero.dayLabels.length === (hero.sparkline as number[]).length)) &&
    (hero.dayDates === undefined ||
      (Array.isArray(hero.dayDates) &&
        hero.dayDates.every((x) => typeof x === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(x)) &&
        hero.dayDates.length === (hero.sparkline as number[]).length)) &&
    Array.isArray(p.opportunities) &&
    p.opportunities.every((o) => isDailyOpportunity(o)) &&
    Array.isArray(p.stories) &&
    p.stories.every((s) => isDailyStory(s)) &&
    (p.headline === undefined || isDailyHeadline(p.headline)) &&
    (p.downstream === undefined ||
      (Array.isArray(p.downstream) && p.downstream.every(isDailyDownstreamRow))) &&
    (p.featured === undefined || isDailyFeaturedBlock(p.featured)) &&
    (p.fallbackFromDate === undefined || isStr(p.fallbackFromDate)) &&
    (p.banner === undefined || typeof p.banner === 'string')
  );
}

/**
 * Throws a descriptive Error on invalid packs so worker/renderer fail fast
 * instead of emitting a malformed public artifact.
 */
export function parseDailyReportPack(unknown: unknown): DailyReportPack {
  if (isDailyReportPack(unknown)) return unknown;
  throw new Error(
    'Invalid DailyReportPack: fields failed validation (see isDailyReportPack).',
  );
}

/** Empty → hybrid fallback. */
export function isPackBelowThreshold(pack: DailyReportPack, min = 4): boolean {
  return pack.opportunities.length + pack.stories.length < min;
}
