/**
 * renderDailyReportHtml(pack) → one dated, self-contained static HTML.
 *
 * Design: light industrial briefing — cool paper surface, charcoal ink,
 * copper heat accent (pic-first, sales-desk glanceable). Every opportunity
 * card, trend row, and hot story is an `<a target="_blank" rel="noopener">`
 * when `href` is a publisher URL; Google News wrappers and items without
 * `href` are omitted.
 *
 * - CN-primary (zh-Hans) with a client-side EN toggle in the same file
 *   (no second fetch).
 * - No resume/PII: the pack is the only input and is validated upstream.
 */

import type { DailyOpportunity, DailyReportPack, DailyStory, OpportunityKind } from './daily-report-pack.js';
import { isGoogleNewsArticleUrl } from './daily-report-article-url.js';
import { buildDailyReportThumbDataUri } from './daily-report-thumb.js';

function shortMdDate(ymd: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(ymd);
  return m ? `${m[2]}-${m[3]}` : ymd;
}

/** 星期N / weekday short for a YYYY-MM-DD calendar date. */
function weekdayLabel(ymd: string, locale: DailyReportLocale): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(ymd);
  if (!m) return '';
  const dt = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])));
  if (locale === 'en') {
    return dt.toLocaleDateString('en-US', { weekday: 'short', timeZone: 'UTC' });
  }
  const weekdays = ['日', '一', '二', '三', '四', '五', '六'];
  return `星期${weekdays[dt.getUTCDay()]}`;
}

export type DailyReportLocale = 'zh-Hans' | 'en';

/** Optional pack-side SVG thumb (may land from a parallel agent). */
type ThumbFields = {
  imageUrl?: string;
  thumbSvg?: string;
  chips?: string[];
};

/** Plate kind for fallback-branding (商机/转机/动态/story). */
type ThumbKind = OpportunityKind | 'story';

/* ---------------------------------------------------------------------------
 * i18n string map (mirrors what the generated HTML ships inline for the toggle)
 * ------------------------------------------------------------------------- */

type I18nMap = Record<string, string>;
const I18N: Record<DailyReportLocale, I18nMap> = {
  'zh-Hans': {
    title: '销售日报',
    sec1: '今日商机',
    sec1en: 'Top opportunities',
    sec2: '今日趋势',
    sec2en: 'Trending',
    sec3: '热闻',
    sec3en: 'Hot stories',
    'kind-商机': '商机',
    'kind-转机': '转机',
    'kind-动态': '动态',
    footer: 'Trends · 销售日报 · 分享链接',
  },
  en: {
    title: 'Sales Daily',
    sec1: 'Top Opportunities',
    sec1en: '',
    sec2: 'Trending',
    sec2en: '',
    sec3: 'Hot Stories',
    sec3en: '',
    'kind-商机': 'Opportunity',
    'kind-转机': 'Turnaround',
    'kind-动态': 'Signal',
    footer: 'Trends · Sales Daily · share link',
  },
};

const KIND_GLYPH: Record<OpportunityKind, string> = { 商机: '机', 转机: '转', 动态: '动' };
const KIND_PLATE: Record<OpportunityKind, string> = {
  商机: '#d6e4f5',
  转机: '#d6ebe0',
  动态: '#f0e2d4',
};

/* ---------------------------------------------------------------------------
 * helpers
 * ------------------------------------------------------------------------- */

function esc(s: string): string {
  return String(s)
    .split('&')
    .join('&amp;')
    .split('<')
    .join('&lt;')
    .split('>')
    .join('&gt;')
    .split('"')
    .join('&quot;');
}

function escAttr(s: string): string {
  return esc(s).split("'").join('&#39;');
}

/** Accept http(s) or SVG data-URI thumbs only. */
function isUsableImageUrl(url: string | undefined): url is string {
  if (!url || typeof url !== 'string') return false;
  const u = url.trim();
  if (u.startsWith('https://') || u.startsWith('http://')) return true;
  if (u.startsWith('data:image/svg+xml')) return true;
  return false;
}


/**
 * Branded fallback plate (data-URI SVG) used when no real thumb is available, and
 * as the client-side onerror replacement if a real image fails to load.
 */
function fallbackPlate(item: ThumbFields, alt: string, kind: ThumbKind): string {
  return buildDailyReportThumbDataUri({ title: alt, kind, chips: (item as { chips?: string[] }).chips ?? [] });
}

function asThumbFields(item: DailyOpportunity | DailyStory): ThumbFields {
  const extra = item as (DailyOpportunity | DailyStory) & { thumbSvg?: string };
  return {
    imageUrl: 'imageUrl' in extra ? extra.imageUrl : undefined,
    thumbSvg: typeof extra.thumbSvg === 'string' ? extra.thumbSvg : undefined,
  };
}

/**
 * Prefer a REAL validated imageUrl (http(s), SVG data-URI) with a graceful
 * onerror fallback to the branded SVG plate. A publisher cover can be an
 * `http://` plain URL (i.ce.cn), a non-standard aspect (sina 96x134), or
 * occasionally dead/403/bot-blocked — so every image tag gets an onerror that
 * points the SAME <img src> at the branded plate the moment it fails to load.
 *
 * IMPORTANT: onerror must swap `this.src`, NEVER `this.outerHTML`. Injecting a
 * data-URI string via outerHTML renders the URI as literal text (a raw blob of
 * SVG/CSS code), not as an image. Keeping the <img> and repointing its src is
 * what renders the plate correctly.
 */
function renderMediaInner(item: ThumbFields, alt: string, plateSvg: string): string {
  if (isUsableImageUrl(item.imageUrl)) {
    // Keep the <img>; on failure swap its src to the plate data-URI (this.src,
    // not outerHTML). onerror=null prevents an error loop.
    return `<img src="${escAttr(item.imageUrl)}" alt="${escAttr(alt)}" loading="lazy" onerror="this.onerror=null;this.src='${escAttr(plateSvg)}'"/>`;
  }
  // No real image → render the branded plate as an <img> (never inject the bare
  // data URI as text into the DOM).
  return `<img src="${escAttr(plateSvg)}" alt="${escAttr(alt)}" loading="lazy"/>`;
}

/** Normalize a series into an SVG polyline (preserveAspectRatio=none). */
function sparklinePoints(v: number[], w = 100, h = 30): string {
  const xs = Array.isArray(v) && v.length > 0 ? v : [50, 50];
  const min = Math.min(...xs);
  const max = Math.max(...xs);
  const span = max - min || 1;
  const n = xs.length;
  const step = n > 1 ? w / (n - 1) : w;
  const pts = xs.map((val, i) => {
    const x = (i * step).toFixed(1);
    const y = (h - ((val - min) / span) * (h - 2) - 1).toFixed(1);
    return `${x},${y}`;
  });
  return pts.join(' ');
}

function sparklineSvg(v: number[], color: string, w = 120, h = 30): string {
  const pts = sparklinePoints(v, w, h);
  return (
    `<svg viewBox="0 0 ${w} ${h}" preserveAspectRatio="none" height="${h}" width="100%" aria-hidden="true">` +
    `<polyline points="${pts}" fill="none" stroke="${color}" stroke-width="2" stroke-linecap="round"/>` +
    `</svg>`
  );
}

function kindClass(kind: OpportunityKind, locale: DailyReportLocale): string {
  return I18N[locale][`kind-${kind}`];
}

function formatPackDate(isoDate: string, locale: DailyReportLocale): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(isoDate);
  if (!m) return isoDate;
  const y = Number(m[1]);
  const mo = Number(m[2]);
  const d = Number(m[3]);
  const dt = new Date(Date.UTC(y, mo - 1, d));
  if (locale === 'en') {
    return dt.toLocaleDateString('en-US', {
      weekday: 'long',
      month: 'short',
      day: 'numeric',
      timeZone: 'UTC',
    });
  }
  const weekdays = ['日', '一', '二', '三', '四', '五', '六'];
  return `${mo}月${d}日 星期${weekdays[dt.getUTCDay()]}`;
}

function withHref<T extends { href?: string }>(items: T[]): Array<T & { href: string }> {
  return items.filter(
    (x): x is T & { href: string } =>
      typeof x.href === 'string' &&
      x.href.length > 0 &&
      !isGoogleNewsArticleUrl(x.href),
  );
}

/* ---------------------------------------------------------------------------
 * render
 * ------------------------------------------------------------------------- */

export function renderDailyReportHtml(pack: DailyReportPack, locale: DailyReportLocale = 'zh-Hans'): string {
  const t = I18N[locale];
  const linkedOpps = withHref(pack.opportunities);
  // 商机 cards = first 3; 今日趋势 rows = the remaining opportunities (from the
  // buildLivePack disjoint carve). Distinct items in each section.
  const cards = linkedOpps.slice(0, 3);
  const rows = linkedOpps.slice(3);
  const stories = withHref(pack.stories);

  const heroSpark = sparklineSvg(pack.hero.sparkline, '#1a8f5a', 280, 28);
  const dateLabel = formatPackDate(pack.date, locale);
  const dayDates = pack.hero.dayDates ?? [];
  const dayLabelHtml =
    dayDates.length > 0
      ? `<nav class="day-labels" data-testid="hero-day-labels" aria-label="7-day reports">${dayDates
          .map((ymd) => {
            const md = shortMdDate(ymd);
            const wd = weekdayLabel(ymd, locale);
            const current = ymd === pack.date;
            const cls = current ? 'day-link current' : 'day-link';
            const aria = current ? `${md} ${wd} (current)` : `${md} ${wd}`;
            // Absolute href + target="_top" so the in-app srcDoc iframe opens the public page,
            // while public /daily/ pages keep working unchanged.
            return `<a class="${cls}" href="/daily/${escAttr(ymd)}.html" target="_top" data-date="${escAttr(ymd)}" aria-label="${escAttr(aria)}"${current ? ' aria-current="page"' : ''}><span class="day-d">${esc(md)}</span><span class="day-w">${esc(wd)}</span></a>`;
          })
          .join('')}</nav>`
      : '';

  const cardHtml = cards
    .map((o) => {
      const glyph = KIND_GLYPH[o.kind];
      const plate = KIND_PLATE[o.kind];
      const sp = sparklineSvg(
        o.sparkline,
        o.kind === '商机' ? '#2f6fed' : o.kind === '转机' ? '#1a8f5a' : '#c45c26',
        72,
        22,
      );
      const chips = (o.chips ?? []).map((c) => `<span class="chip">${esc(c)}</span>`).join('');
      const fields = asThumbFields(o);
      const plateSvg = fallbackPlate(fields, o.label, o.kind);
      const media = renderMediaInner(fields, o.label, plateSvg);
      const coverInner = media
        ? media
        : `<span class="glyph">${glyph}</span>`;
      return `<a href="${escAttr(o.href)}" class="tile" target="_blank" rel="noopener">
        <div class="cover" style="background:${plate}">
          ${coverInner}
          <span class="badge b-grow">${esc(o.growth)}</span>
          <span class="badge b-hot">${esc(o.heat)}</span>
        </div>
        <div class="body">
          <div class="name-row"><span class="name">${esc(o.label)}</span><span class="when" data-started="${escAttr(o.started)}"></span></div>
          ${chips ? `<div class="chips">${chips}</div>` : ''}
          <div class="spark-mini">${sp}</div>
        </div>
      </a>`;
    })
    .join('');

  const rowHtml = rows
    .map((o, i) => {
      const kindCls = kindClass(o.kind, locale);
      const chips = (o.chips ?? []).map((c) => `<span class="chip">${esc(c)}</span>`).join('');
      const growColor = o.growth.startsWith('-') ? '#c0392b' : '#1a8f5a';
      return `<a href="${escAttr(o.href)}" class="row" target="_blank" rel="noopener">
        <div class="rank">${i + 1}</div>
        <div class="main"><div class="name"><span class="kind k-${o.kind === '商机' ? 'j' : o.kind === '转机' ? 'z' : 'd'}">${kindCls}</span><span>${esc(o.label)}</span></div>
          ${chips ? `<div class="chips">${chips}</div>` : ''}</div>
        <div class="figs"><div class="hot">${esc(o.heat)}</div><div class="grow" style="color:${growColor}">${esc(o.growth)}</div><div class="when" data-started="${escAttr(o.started)}"></div></div>
        ${sparklineSvg(o.sparkline, o.growth.startsWith('-') ? '#c0392b' : '#1a8f5a', 58, 24).replace('width="100%"', 'width="58"')}
      </a>`;
    })
    .join('');

  const bannerHtml = pack.banner ? `<div class="banner">${esc(pack.banner)}</div>` : '';

  const storyHtml = stories
    .map((s, i) => {
      const fields = asThumbFields(s);
      const plate = i % 2 === 0 ? '#ebe4d8' : '#e0e6ee';
      const plateSvg = fallbackPlate(fields, s.title, 'story');
      const media = renderMediaInner(fields, s.title, plateSvg);
      const coverInner = media
        ? media
        : `<div class="thumb-plate" style="background:${plate}"></div>`;
      return `<a href="${escAttr(s.href)}" class="story" target="_blank" rel="noopener">
        <div class="cover">${coverInner}</div>
        <div class="body">${esc(s.title)}</div>
      </a>`;
    })
    .join('');

  return `<!DOCTYPE html>
<html lang="zh-Hans">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>销售日报 · ${esc(pack.date)}</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Barlow+Condensed:wght@600;700&family=Noto+Sans+SC:wght@400;600;700&display=swap" rel="stylesheet">
<style>
  :root{
    --paper:#f0f3f6;
    --surface:#ffffff;
    --ink:#1a222c;
    --edge:#d0d7e0;
    --mute:#5c6b7a;
    --heat:#c45c26;
    --signal:#2f6fed;
    --up:#1a8f5a;
    --chip-bg:#e8eef4;
    --chip-ink:#3a4a5c;
  }
  *{box-sizing:border-box;margin:0;padding:0;}
  body{
    background:var(--paper);
    color:var(--ink);
    font-family:"Noto Sans SC",-apple-system,BlinkMacSystemFont,"PingFang SC","Microsoft YaHei",sans-serif;
    padding:20px 14px 40px;
    display:flex;flex-direction:column;align-items:center;
    background-image:
      linear-gradient(180deg,rgba(240,243,246,.98),rgba(232,237,242,1)),
      repeating-linear-gradient(90deg,transparent,transparent 47px,rgba(208,215,224,.55) 47px,rgba(208,215,224,.55) 48px);
  }
  a.tile,a.row,a.story{text-decoration:none;color:inherit;}
  a.tile{display:flex;flex-direction:column;}
  a.row{display:flex;}
  a.story{display:flex;}
  a.tile:focus-visible,a.row:focus-visible,a.story:focus-visible{outline:2px solid var(--heat);outline-offset:2px;}
  .page{max-width:720px;width:100%;}
  .header{display:flex;justify-content:space-between;align-items:flex-end;margin-bottom:14px;}
  .header .title{
    font-family:"Barlow Condensed","Noto Sans SC",sans-serif;
    font-size:28px;font-weight:700;letter-spacing:.02em;color:var(--ink);line-height:1;
  }
  .header .date{font-size:12px;color:var(--mute);margin-top:4px;}
  .toggle{display:flex;border:1px solid var(--edge);overflow:hidden;background:var(--surface);border-radius:6px;}
  .toggle button{border:0;background:transparent;padding:6px 14px;font-size:12px;cursor:pointer;color:var(--mute);font-family:inherit;}
  .toggle button.on{background:var(--ink);color:#fff;font-weight:600;}
  .hero{
    background:var(--surface);
    border:1px solid var(--edge);
    border-left:4px solid var(--heat);
    border-radius:8px;
    padding:22px 20px 16px;
    margin-bottom:18px;
    position:relative;
    overflow:hidden;
    box-shadow:0 1px 2px rgba(26,34,44,.04);
  }
  .hero::after{
    content:"";position:absolute;inset:0 auto 0 0;width:40%;
    background:linear-gradient(90deg,rgba(196,92,38,.08),transparent);
    pointer-events:none;
  }
  .hero .top{display:flex;justify-content:space-between;align-items:center;margin-bottom:10px;position:relative;z-index:1;}
  .hero .brand{font-family:"Barlow Condensed",sans-serif;font-size:15px;font-weight:700;letter-spacing:.04em;color:var(--mute);}
  .hero .k{font-size:12px;color:var(--mute);margin-bottom:4px;}
  .hero .v{
    font-family:"Barlow Condensed",sans-serif;
    font-size:56px;font-weight:700;line-height:1;letter-spacing:-.02em;color:var(--ink);
  }
  .hero .v .d{font-size:20px;color:var(--up);font-weight:700;margin-left:6px;}
  .hero .meta{font-size:12px;color:var(--mute);text-align:right;}
  .hero svg{display:block;width:100%;margin-top:12px;opacity:.9;position:relative;z-index:1;}
  .day-labels{
    display:flex;justify-content:space-between;gap:4px;margin-top:8px;position:relative;z-index:1;
    font-size:10px;color:var(--mute);letter-spacing:.02em;
  }
  .day-labels .day-link{
    flex:1;display:flex;flex-direction:column;align-items:center;gap:2px;
    padding:4px 2px;border-radius:6px;text-decoration:none;color:var(--mute);
    border:1px solid transparent;transition:color .12s ease,border-color .12s ease,background .12s ease;
  }
  .day-labels .day-link:hover{color:var(--heat);border-color:var(--edge);background:rgba(196,92,38,.06);}
  .day-labels .day-link.current{color:var(--ink);font-weight:700;border-color:var(--heat);background:rgba(196,92,38,.08);}
  .day-labels .day-d{font-family:"Barlow Condensed",sans-serif;font-size:12px;letter-spacing:.02em;font-variant-numeric:tabular-nums;}
  .day-labels .day-w{font-size:10px;opacity:.9;}
  .day-labels .day-link:focus-visible{outline:2px solid var(--heat);outline-offset:1px;}
  .section{margin-bottom:18px;}
  .section-title{
    font-family:"Barlow Condensed","Noto Sans SC",sans-serif;
    font-size:18px;font-weight:700;margin-bottom:10px;
    display:flex;align-items:baseline;gap:8px;color:var(--ink);
    border-bottom:1px solid var(--edge);padding-bottom:6px;
  }
  .section-title .en{font-size:11px;color:var(--mute);font-weight:400;font-family:"Noto Sans SC",sans-serif;}
  .grid{display:flex;gap:10px;}
  .tile{
    flex:1;background:var(--surface);border:1px solid var(--edge);border-radius:8px;
    overflow:hidden;transition:border-color .15s ease,box-shadow .15s ease;
    box-shadow:0 1px 2px rgba(26,34,44,.04);
  }
  .tile:hover{border-color:var(--heat);box-shadow:0 2px 8px rgba(196,92,38,.1);}
  .tile .cover{position:relative;height:120px;overflow:hidden;display:flex;align-items:center;justify-content:center;}
  .tile .cover img,.tile .cover > svg{width:100%;height:100%;object-fit:cover;display:block;}
  .cover .glyph{
    font-family:"Barlow Condensed",sans-serif;
    font-size:42px;color:rgba(26,34,44,.55);font-weight:700;
  }
  .cover .badge{
    position:absolute;background:rgba(255,255,255,.92);color:var(--ink);
    font-size:10px;font-weight:600;padding:2px 7px;z-index:1;border:1px solid var(--edge);border-radius:4px;
  }
  .cover .b-grow{top:8px;left:8px;}.cover .b-hot{top:8px;right:8px;color:var(--heat);}
  .tile .body{padding:10px;display:flex;flex-direction:column;gap:6px;flex:1;}
  .tile .name-row{display:flex;justify-content:space-between;align-items:center;gap:6px;}
  .tile .name{font-size:13px;font-weight:600;line-height:1.3;}.tile .when{font-size:10px;color:var(--mute);flex-shrink:0;}
  .tile .chips{display:flex;gap:4px;flex-wrap:wrap;}
  .tile .chip{font-size:10px;background:var(--chip-bg);color:var(--chip-ink);padding:1px 6px;border-radius:4px;}
  .spark-mini{margin-top:auto;opacity:.75;max-width:80px;}
  .spark-mini svg{display:block;width:100%;height:22px;}
  .panel{background:var(--surface);border:1px solid var(--edge);overflow:hidden;border-radius:8px;box-shadow:0 1px 2px rgba(26,34,44,.04);}
  .row{
    align-items:center;gap:12px;padding:11px 14px;
    border-bottom:1px solid var(--edge);transition:background .12s ease;
  }
  .row:last-child{border-bottom:0;}
  .row:hover{background:rgba(196,92,38,.06);}
  .rank{font-family:"Barlow Condensed",sans-serif;font-size:16px;color:var(--heat);width:22px;flex-shrink:0;font-weight:700;}
  .row .main{flex:1;min-width:0;}
  .row .name{font-size:14px;font-weight:600;display:flex;align-items:center;gap:7px;}
  .kind{font-size:10px;color:#fff;padding:1px 6px;flex-shrink:0;border-radius:3px;}
  .k-j{background:var(--signal);}.k-z{background:var(--up);}.k-d{background:var(--heat);}
  .chips{display:flex;gap:5px;margin-top:5px;flex-wrap:wrap;}
  .chip{font-size:10px;background:var(--chip-bg);color:var(--chip-ink);padding:1px 6px;border-radius:4px;}
  .figs{text-align:right;flex-shrink:0;}
  .figs .hot{font-size:13px;font-weight:700;}.figs .grow{font-size:13px;font-weight:700;}.figs .when{font-size:10px;color:var(--mute);}
  .stories{display:flex;flex-direction:column;gap:8px;}
  .story{
    align-items:stretch;gap:0;
    background:var(--surface);border:1px solid var(--edge);border-radius:8px;
    overflow:hidden;transition:border-color .15s ease,box-shadow .15s ease;
    box-shadow:0 1px 2px rgba(26,34,44,.04);
  }
  .story:hover{border-color:var(--heat);box-shadow:0 2px 8px rgba(196,92,38,.1);}
  /* Fixed 4:3 crop box — portrait publisher covers (people.cn/sina) no longer
     stretch the row to intrinsic 96×206; object-fit:cover centers the photo. */
  .story .cover{
    width:96px;aspect-ratio:4/3;flex-shrink:0;align-self:center;
    position:relative;overflow:hidden;background:var(--chip-bg);
  }
  .story .cover img,.story .cover > svg,.story .cover .thumb-plate{
    position:absolute;inset:0;width:100%;height:100%;
    object-fit:cover;object-position:center;display:block;
  }
  .story .body{padding:12px 14px;font-size:13px;font-weight:600;color:var(--ink);display:flex;align-items:center;flex:1;line-height:1.35;}
  .footer{margin-top:18px;text-align:center;font-size:11px;color:var(--mute);}
  .banner{
    margin:0 0 14px;background:#fff8f0;border:1px solid #e8c9a0;border-radius:6px;
    padding:8px 12px;font-size:12px;color:#7a4e1a;
  }
  @media (max-width:560px){
    .grid{flex-direction:column;}
    .hero .v{font-size:44px;}
    .story .cover{width:72px;}
  }
  @media (prefers-reduced-motion:reduce){
    .tile,.row,.story{transition:none;}
  }
</style>
</head>
<body>
<div class="page">
  ${bannerHtml}
  <div class="header">
    <div>
      <div class="title" data-i18n="title">${t.title}</div>
      <div class="date" data-date="${escAttr(pack.date)}">${esc(dateLabel)}</div>
    </div>
    <div class="toggle"><button type="button" id="btn-zh" class="on">中文</button><button type="button" id="btn-en">EN</button></div>
  </div>

  <div class="hero">
    <div class="top"><div class="brand" data-i18n="title">${t.title}</div></div>
    <div style="display:flex;align-items:flex-end;justify-content:space-between;gap:12px;position:relative;z-index:1">
      <div>
        <div class="k">${esc(pack.hero.headline)}</div>
        <div class="v">${esc(pack.hero.value)} <span class="d">${esc(pack.hero.delta)}</span></div>
      </div>
      <div class="meta">${esc(pack.hero.meta)}</div>
    </div>
    ${heroSpark}
    ${dayLabelHtml}
  </div>

  <div class="section">
    <div class="section-title"><span data-i18n="sec1">${t.sec1}</span><span class="en" data-i18n="sec1en">${t.sec1en}</span></div>
    <div class="grid">${cardHtml}</div>
  </div>

  <div class="section">
    <div class="section-title"><span data-i18n="sec2">${t.sec2}</span><span class="en" data-i18n="sec2en">${t.sec2en}</span></div>
    <div class="panel">${rowHtml}</div>
  </div>

  <div class="section">
    <div class="section-title"><span data-i18n="sec3">${t.sec3}</span><span class="en" data-i18n="sec3en">${t.sec3en}</span></div>
    <div class="stories">${storyHtml}</div>
  </div>

  <div class="footer" data-i18n="footer">${t.footer}</div>
</div>

<script>
var PACK_DATE=${JSON.stringify(pack.date)};
var I18N=${JSON.stringify(I18N)};
function formatDate(iso,lang){
  var m=/^(\\d{4})-(\\d{2})-(\\d{2})$/.exec(iso);
  if(!m)return iso;
  var y=+m[1],mo=+m[2],d=+m[3];
  var dt=new Date(Date.UTC(y,mo-1,d));
  if(lang==='en'){
    return dt.toLocaleDateString('en-US',{weekday:'long',month:'short',day:'numeric',timeZone:'UTC'});
  }
  var wd=['日','一','二','三','四','五','六'];
  return mo+'月'+d+'日 星期'+wd[dt.getUTCDay()];
}
function applyLang(lang){
  var map=I18N[lang];
  document.querySelectorAll('[data-i18n]').forEach(function(el){
    var k=el.getAttribute('data-i18n');
    if(map[k]!=null&&map[k]!=='')el.textContent=map[k];
  });
  var dateEl=document.querySelector('[data-date]');
  if(dateEl)dateEl.textContent=formatDate(dateEl.getAttribute('data-date')||PACK_DATE,lang);
  document.getElementById('btn-zh').classList.toggle('on',lang==='zh-Hans');
  document.getElementById('btn-en').classList.toggle('on',lang!=='zh-Hans');
  document.documentElement.lang=lang;
}
document.getElementById('btn-zh').addEventListener('click',function(){applyLang('zh-Hans');try{localStorage.setItem('daily-lang','zh-Hans')}catch(e){}});
document.getElementById('btn-en').addEventListener('click',function(){applyLang('en');try{localStorage.setItem('daily-lang','en')}catch(e){}});
var saved=(function(){try{return localStorage.getItem('daily-lang')}catch(e){return null}})();
applyLang(saved==='en'?'en':'zh-Hans');
</script>
</body>
</html>`;
}
