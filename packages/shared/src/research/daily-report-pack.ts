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
};

export type DailyStory = {
  title: string;
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
    (o.href === undefined || isStr(o.href))
  );
}

export function isDailyStory(v: unknown): v is DailyStory {
  if (typeof v !== 'object' || v === null) return false;
  const s = v as Record<string, unknown>;
  return isStr(s.title) && (s.imageUrl === undefined || isStr(s.imageUrl)) && isOptStr(s.href);
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
