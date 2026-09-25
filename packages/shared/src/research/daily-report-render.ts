/**
 * renderDailyReportHtml(pack) → one dated, self-contained static HTML.
 *
 * Design: final 定稿C single-headline industrial briefing — cool paper surface
 * (`--bg #edf0f4`), white cards, blue accent (`--blue #2f6fed`), copper heat
 * accent (`--heat #c45c26`), machinery-first / downstream-first content. The
 * finalized visual SSOT is `daily-ui-demo/销售日报-定稿C-单头条.html`; this
 * renderer is its 1:1 static implementation.
 *
 * Layout top→bottom:
 *   1. Single masked HEADLINE (tag + title + source; NO publish date; NOT pinned)
 *   2. TODAY — high-density list, ONLY `rowDay == reportDate`:
 *        a. DOWNSTREAM first (keyword chip + title + source + age)
 *        b. 商机 / 新闻 (with heat / growth tags)
 *   3. FEATURED — blue band, dual-col grouped VIDEO / GALLERY (type + length only,
 *      NO dates); content is a new set beyond TODAY, rendered only when supplied.
 *
 * Every opportunity row is an `<a target="_blank" rel="noopener">` when `href`
 * is a publisher URL; Google News wrappers and items without `href` are omitted.
 *
 * - CN-primary (zh-Hans) with a client-side EN toggle in the same file.
 * - No resume/PII: the pack is the only input and is validated upstream.
 */

import type { DailyOpportunity, DailyReportPack } from './daily-report-pack.js';
import { isGoogleNewsArticleUrl } from './daily-report-article-url.js';

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

/* ---------------------------------------------------------------------------
 * i18n string map (mirrors what the generated HTML ships inline for the toggle)
 * ------------------------------------------------------------------------- */

type I18nMap = Record<string, string>;
const I18N: Record<DailyReportLocale, I18nMap> = {
  'zh-Hans': {
    title: '销售日报',
    headline: '头条',
    today: '当日内容',
    downstream: '下游需求',
    biznews: '商机 / 新闻',
    featured: '精选',
    video: '视频',
    gallery: '图集',
    source: '来源',
    footer: 'Trends · 销售日报 · 分享链接',
    'kind-商机': '商机',
    'kind-转机': '转机',
    'kind-动态': '动态',
  },
  en: {
    title: 'Sales Daily',
    headline: 'Headline',
    today: 'Today',
    downstream: 'Downstream Demand',
    biznews: 'Opportunities / News',
    featured: 'Featured',
    video: 'Video',
    gallery: 'Gallery',
    source: 'Source',
    footer: 'Trends · Sales Daily · share link',
    'kind-商机': 'Opportunity',
    'kind-转机': 'Turnaround',
    'kind-动态': 'Signal',
  },
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

/** Accept embedded data-URI thumbs only (shareable single-file HTML). */
function isUsableImageUrl(url: string | undefined): url is string {
  if (!url || typeof url !== 'string') return false;
  const u = url.trim();
  return /^data:image\/(png|jpeg|jpg|webp|svg\+xml)/i.test(u);
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

function platformLabel(platform: string): string {
  const id = platform.replace(/^rss:/, '');
  const known: Record<string, string> = {
    'gnews-diecast': '压铸网',
    'bing-cnc-machine': '工业网',
    'bing-gongyemuji': '工业网',
    'bing-muju': '模具网',
    'bing-chongya': '压铸网',
    'gnews-cnc-machine': '数控机床要闻',
    'gnews-gongyemuji': '工业母机要闻',
    'bing-jiguang-qiege': '激光加工网',
  };
  if (known[id]) return known[id];
  // humanize: `gnews-cnc-machine` -> `gnews-cnc-machine`
  return id;
}

/** Relative age for a downstream row, from its day/publish time. */
function ageLabel(day: string, rowAsOf: number | undefined, locale: DailyReportLocale): string {
  if (typeof rowAsOf === 'number' && Number.isFinite(rowAsOf) && rowAsOf > 0) {
    const diffH = Math.max(0, Math.floor((Date.now() - rowAsOf) / 3_600_000));
    if (diffH < 1) return locale === 'en' ? 'now' : '刚刚';
    if (diffH < 24) return locale === 'en' ? `${diffH}h ago` : `${diffH} 小时前`;
    const diffD = Math.floor(diffH / 24);
    return locale === 'en' ? `${diffD}d ago` : `${diffD} 天前`;
  }
  if (day) {
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(day);
    if (!m) return day;
    const today = new Date();
    const y = today.getUTCFullYear();
    const mo = String(today.getUTCMonth() + 1).padStart(2, '0');
    const d0 = String(today.getUTCDate()).padStart(2, '0');
    const diffD = Math.floor((Date.parse(`${y}-${mo}-${d0}T00:00:00Z`) - Date.parse(`${day}T00:00:00Z`)) / 86_400_000);
    if (diffD <= 0) return locale === 'en' ? 'today' : '今天';
    return locale === 'en' ? `${diffD}d ago` : `${diffD} 天前`;
  }
  return '';
}

/* ---------------------------------------------------------------------------
 * render
 * ------------------------------------------------------------------------- */

export function renderDailyReportHtml(pack: DailyReportPack, locale: DailyReportLocale = 'zh-Hans'): string {
  const t = I18N[locale];
  const dateLabel = formatPackDate(pack.date, locale);
  const dayDates = pack.hero?.dayDates ?? [];

  // ── Headline ────────────────────────────────────────────────────────────
  // Prefer a backend-supplied headline; fall back to the top real same-day
  // matched opportunity (never invented content). Masked overlay, no publish
  // date, not pinned.
  let headline: { tag?: string; title: string; source: string; href?: string } | null = null;
  if (pack.headline && pack.headline.title) {
    const hl = pack.headline;
    headline = { tag: hl.tag, title: hl.title, source: hl.source || '', href: hl.href };
  } else {
    const primary = linkedOppsForHeadline(pack).find((o) => o.day === pack.date) ?? linkedOppsForHeadline(pack)[0];
    if (primary) {
      headline = {
        tag: primary.opp.kind,
        title: primary.opp.label,
        source: platformLabel(primary.rowPlatform || ''),
        href: primary.opp.href,
      };
    }
  }

  const headlineHtml = headline
    ? `<div class="sec-label hl">
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none"><path d="M4 18 h16 M6 13 h12 M8 8 h8 M10 3 h4" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>
        ${t.headline} <span class="en" data-i18n="headline-en"></span>
        <span class="anno">${locale === 'en' ? 'no publish date' : '不显示发布日期'}</span>
      </div>
      ${headline.href ? `<a class="hero" href="${escAttr(headline.href)}" target="_blank" rel="noopener">` : `<div class="hero">`}
        <div class="inner">
          ${headline.tag ? `<span class="tag overlay">${esc(headline.tag)}</span>` : ''}
          <div class="h">${esc(headline.title)}</div>
          ${headline.source ? `<div class="s">${locale === 'en' ? 'Source' : '来源'}：${esc(headline.source)}</div>` : ''}
        </div>
      ${headline.href ? '</a>' : '</div>'}`
    : '';

  // ── TODAY: downstream first, then 商机/新闻 ─────────────────────────────
  const downstream = pack.downstream ?? [];
  const downstreamHtml =
    downstream.length > 0
      ? `<div class="grp">
          <div class="gh"><span>${t.downstream} <span class="tag d" style="margin-left:6px">DOWNSTREAM</span></span><span class="cnt">${downstream.length}</span></div>
          <div class="gl">
            ${downstream
              .map((d) => {
                const src = d.source ? `<span>${t.source}：${esc(d.source)}</span>` : '';
                const age = ageLabel((d as { day?: string }).day ?? '', d.publishedAt, locale);
                return `<div class="row"><span class="tag d">${esc(d.tag || '下游')}</span><div><div class="rt">${esc(d.title)}</div><div class="rm">${src}${age ? `<span>${esc(age)}</span>` : ''}</div></div></div>`;
              })
              .join('')}
          </div>
        </div>`
      : '';

  // 商机/新闻 = all report-day surfaced content (opportunities + same-day
  // stories), de-duped by URL/title. Backend pre-filters downstream keyword
  // hits; THIS renderer does no keyword filtering (定稿C contract).
  const todayRows = dedupeToday([...linkedOppsToday(pack), ...storyToday(pack)]);
  const bizOpps = todayRows.map((r) => toBizRow(r, locale));
  const bizHtml =
    bizOpps.length > 0
      ? `<div class="grp">
          <div class="gh"><span>${t.biznews}</span><span class="cnt">${bizOpps.length}</span></div>
          <div class="gl">
            ${bizOpps
              .map((b) => {
                const html = b.href
                  ? `<a class="row" href="${escAttr(b.href)}" target="_blank" rel="noopener"><span class="tag ${b.tagCls}">${esc(b.tagTxt)}</span><div><div class="rt">${esc(b.title)}</div><div class="rm">${b.ageDisplay ? `<span>${esc(b.ageDisplay)}</span>` : ''}${b.heat ? `<span>${b.heat}</span>` : ''}${b.grow}</div></div></a>`
                  : `<div class="row"><span class="tag ${b.tagCls}">${esc(b.tagTxt)}</span><div><div class="rt">${esc(b.title)}</div><div class="rm">${b.ageDisplay ? `<span>${esc(b.ageDisplay)}</span>` : ''}</div></div></div>`;
                return html;
              })
              .join('')}
          </div>
        </div>`
      : '';

  const todayHtml =
    downstreamHtml || bizHtml
      ? `<div class="sec-label" style="margin-top:15px">
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none"><rect x="3" y="4" width="18" height="17" rx="2" stroke="currentColor" stroke-width="2"/><path d="M8 9 h8 M8 13 h8 M8 17 h5" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>
          ${t.today} <span class="en" data-i18n="today-en">TODAY</span>
          <span class="anno">${locale === 'en' ? `only ${pack.date}` : `仅当日 · 昨日见 ${shortMdDate(pack.date)} 前一档`}</span>
        </div>
        <div class="today">${downstreamHtml}${bizHtml}</div>`
      : '';

  // ── FEATURED: VIDEO / GALLERY dual col, no dates ────────────────────────
  const featured = pack.featured;
  const featuredHtml =
    featured && (featured.video.length > 0 || featured.gallery.length > 0)
      ? `<div class="featured">
          <div class="sec-label feat">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none"><path d="M12 3 l2.3 5.3 L20 9 l-4.2 3.8 L17.2 19 L12 15.8 L6.8 19 l1.4 -6.2 L4 9 l5.7 -.7 z" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"/></svg>
            ${t.featured} <span class="en" data-i18n="featured-en">FEATURED</span>
            <span class="anno">${locale === 'en' ? 'beyond today · no dates' : '日报以外的新内容 · 无日期'}</span>
          </div>
          ${featured.video.length > 0
            ? `<div class="fcat">${t.video} VIDEO</div><div class="fgrid">${featured.video.map((f) => fcard(f, 'video', locale)).join('')}</div>`
            : ''}
          ${featured.gallery.length > 0
            ? (featured.video.length > 0 ? '<div class="fcat" style="margin-top:11px">' : '<div class="fcat">') + `${t.gallery} GALLERY</div><div class="fgrid">${featured.gallery.map((f) => fcard(f, 'gallery', locale)).join('')}</div>`
            : ''}
        </div>`
      : '';

  const dayNavHtml =
    dayDates.length > 0
      ? `<nav class="day-labels" data-testid="hero-day-labels" aria-label="7-day reports">${dayDates
          .map((ymd) => {
            const md = shortMdDate(ymd);
            const wd = weekdayLabel(ymd, locale);
            const current = ymd === pack.date;
            const cls = current ? 'day-link current' : 'day-link';
            const aria = current ? `${md} ${wd} (current)` : `${md} ${wd}`;
            return `<a class="${cls}" href="/daily/${escAttr(ymd)}.html" target="_top" data-date="${escAttr(ymd)}" aria-label="${escAttr(aria)}"${current ? ' aria-current="page"' : ''}><span class="day-d">${esc(md)}</span><span class="day-w">${esc(wd)}</span></a>`;
          })
          .join('')}</nav>`
      : '';

  return `<!DOCTYPE html>
<html lang="zh-Hans">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>销售日报 · ${esc(pack.date)}</title>
<link rel="icon" href="data:image/svg+xml,%3Csvg%20xmlns%3D%22http%3A%2F%2Fwww.w3.org%2F2000%2Fsvg%22%20viewBox%3D%220%200%2032%2032%22%3E%3Crect%20width%3D%2232%22%20height%3D%2232%22%20rx%3D%227%22%20fill%3D%22%23ffffff%22%2F%3E%3Cpath%20d%3D%22M6%2010%20h20%20M6%2016%20h20%20M6%2022%20h13%22%20stroke%3D%22%232f6fed%22%20stroke-width%3D%222%22%20stroke-linecap%3D%22round%22%2F%3E%3C%2Fsvg%3E">
<style>
  :root{
    --bg:#edf0f4; --surface:#ffffff; --surface2:#f6f8fa; --surface3:#eaeff5;
    --line:#d9dfe7; --line2:#c2ccd8;
    --ink:#1d2835; --ink2:#5b6978; --ink3:#8d99a7;
    --blue:#2f6fed; --blue-soft:rgba(47,111,237,.1); --blue-line:rgba(47,111,237,.4);
    --heat:#c45c26; --heat-soft:rgba(196,92,38,.1); --heat-line:rgba(196,92,38,.4);
    --pos:#1a8f5a; --neg:#d0534a;
    --ftint:#f2f6fd;
    --sans:"PingFang SC","Microsoft YaHei","Noto Sans SC",system-ui,-apple-system,"Segoe UI",sans-serif;
    --mono:ui-monospace,SFMono-Regular,Consolas,"Cascadia Mono","Liberation Mono",Menlo,monospace;
  }
  *{box-sizing:border-box;margin:0;padding:0;}
  body{font-family:var(--sans);color:var(--ink);
    background:
      radial-gradient(1100px 500px at 18% -10%, rgba(47,111,237,.06), transparent 60%),
      repeating-linear-gradient(0deg, rgba(60,80,100,.04) 0 1px, transparent 1px 48px),
      repeating-linear-gradient(90deg, rgba(60,80,100,.04) 0 1px, transparent 1px 48px),
      var(--bg);
    min-height:100vh;-webkit-font-smoothing:antialiased;}
  ::selection{background:rgba(47,111,237,.22);}
  .app{max-width:980px;margin:0 auto;padding:26px 20px 60px;}
  a{text-decoration:none;color:inherit;}
  a:focus-visible{outline:2px solid var(--blue);outline-offset:2px;}

  /* ===== header / day nav ===== */
  .rpt-top{display:flex;justify-content:space-between;align-items:flex-start;gap:10px;margin-bottom:15px;flex-wrap:wrap;}
  .rpt-top h2{font-size:18px;font-weight:700;}
  .rpt-top .sub{font-size:12px;color:var(--ink3);margin-top:3px;}
  .toggle{display:flex;border:1px solid var(--line);overflow:hidden;background:var(--surface);border-radius:7px;flex:none;}
  .toggle button{border:0;background:transparent;padding:6px 14px;font-size:12px;cursor:pointer;color:var(--ink2);font-family:inherit;}
  .toggle button.on{background:var(--ink);color:#fff;font-weight:600;}
  .day-labels{display:flex;justify-content:space-between;gap:4px;margin:0 0 16px;font-size:10px;color:var(--ink3);}
  .day-labels .day-link{flex:1;display:flex;flex-direction:column;align-items:center;gap:2px;padding:5px 2px;border-radius:7px;border:1px solid transparent;}
  .day-labels .day-link:hover{color:var(--blue);border-color:var(--edge);background:rgba(47,111,237,.06);}
  .day-labels .day-link.current{color:var(--ink);font-weight:700;border-color:var(--blue);background:var(--blue-soft);}
  .day-labels .day-d{font-family:var(--mono);font-size:11px;color:inherit;font-variant-numeric:tabular-nums;}
  .day-labels .day-w{font-size:10px;opacity:.85;}

  /* ===== section label ===== */
  .sec-label{display:flex;align-items:center;gap:7px;font-family:var(--mono);font-size:10px;
    letter-spacing:.12em;color:var(--ink3);margin-bottom:9px;}
  .sec-label .anno{margin-left:auto;letter-spacing:0;font-family:var(--sans);font-size:10px;color:var(--ink3);}
  .sec-label .en{margin-left:1px;font-family:var(--sans);font-size:10px;color:var(--ink3);}
  .sec-label.hl{color:var(--heat);}
  .sec-label.hl::after{content:"";flex:1;height:1px;background:var(--heat-line);}
  .sec-label::after{content:"";flex:1;height:1px;background:var(--line);}
  .sec-label.hl::before,.sec-label.hl .en,.sec-label .en{margin-left:0;}
  .sec-label.feat{color:var(--blue);}
  .sec-label.feat::after{background:var(--blue-line);}

  /* 单一遮罩头条 */
  .hero{position:relative;border-radius:9px;overflow:hidden;height:118px;display:block;
    background:linear-gradient(150deg,#9fb3cc 0%,#7d93b0 45%,#5f7691 100%);}
  .hero::before{content:"";position:absolute;inset:0;
    background:linear-gradient(0deg,rgba(16,26,40,.86) 8%,rgba(16,26,40,.18) 58%,rgba(16,26,40,.08) 100%);}
  .hero .inner{position:relative;height:100%;display:flex;flex-direction:column;justify-content:flex-end;
    padding:12px 14px;gap:6px;}
  .hero .tag{color:#fff;border-color:rgba(255,255,255,.5);background:rgba(255,255,255,.16);align-self:flex-start;}
  .hero .h{color:#fff;font-size:16px;font-weight:700;line-height:1.45;max-width:92%;}
  .hero .s{color:rgba(255,255,255,.78);font-size:10.5px;line-height:1.5;}

  /* ===== tags ===== */
  .tag{display:inline-flex;align-items:center;font-size:10px;border-radius:4px;padding:1px 7px;
    border:1px solid;line-height:1.6;white-space:nowrap;flex:none;}
  .tag.d{color:var(--heat);border-color:var(--heat-line);background:var(--heat-soft);}
  .tag.n{color:var(--ink2);border-color:var(--line);background:var(--surface2);}
  .tag.o{color:var(--blue);border-color:var(--blue-line);background:var(--blue-soft);}
  .tag.g{color:var(--pos);border-color:rgba(26,143,90,.4);background:rgba(26,143,90,.07);}

  /* ===== TODAY ===== */
  .today{border:1px solid var(--line);border-radius:9px;overflow:hidden;background:#fff;}
  .grp{border-top:1px solid var(--line);}
  .grp:first-child{border-top:0;}
  .grp .gh{display:flex;justify-content:space-between;align-items:center;padding:7px 12px;
    font-size:11px;color:var(--ink2);letter-spacing:.05em;background:var(--surface2);}
  .grp .gh .cnt{font-family:var(--mono);}
  .grp .gl{display:flex;flex-direction:column;}
  .row{display:grid;grid-template-columns:auto 1fr;gap:9px;padding:9px 12px;border-top:1px dashed var(--line);}
  .row:first-child{border-top:0;}
  a.row{color:inherit;text-decoration:none;}
  .row .tag{margin-top:1px;}
  .row .rt{font-size:12.5px;font-weight:600;line-height:1.5;color:var(--ink);}
  a.row:hover .rt{color:var(--blue);}
  .row .rm{font-family:var(--mono);font-size:10px;color:var(--ink3);margin-top:3px;display:flex;gap:12px;flex-wrap:wrap;}

  /* ===== FEATURED (blue band) ===== */
  .featured{margin-top:15px;border:1px solid var(--blue-line);background:var(--ftint);border-radius:9px;padding:12px;}
  .fcat{font-size:9px;letter-spacing:.14em;color:var(--blue);margin:2px 1px 7px;}
  .fgrid{display:grid;grid-template-columns:1fr 1fr;gap:8px;}
  .fgrid + .fcat{margin-top:11px;}
  .fcard{display:grid;grid-template-columns:120px 1fr;border:1px solid var(--line);border-radius:6px;background:#fff;overflow:hidden;}
  .fcard .cv{display:grid;place-items:center;background:linear-gradient(160deg,#eef3f9,#dfe7f1);
    border-right:1px solid var(--line);min-height:58px;}
  .fcard .cv img{width:100%;height:100%;object-fit:cover;display:block;}
  .fcard .cb{padding:7px 10px;display:flex;flex-direction:column;justify-content:center;gap:4px;}
  .fcard .cb .t{font-size:12px;line-height:1.45;font-weight:600;}
  .fcard .cb .m{font-family:var(--mono);font-size:9.5px;color:var(--ink3);display:flex;gap:10px;flex-wrap:wrap;}

  /* ===== footer ===== */
  .rpt-foot{margin-top:16px;font-size:11px;color:var(--ink3);display:flex;justify-content:space-between;
    gap:8px;flex-wrap:wrap;text-align:center;}
  .rpt-foot .nobr{white-space:nowrap;}

  @media (max-width:820px){}
  @media (max-width:640px){
    .fcard{grid-template-columns:1fr;}
    .fcard .cv{min-height:72px;border-right:0;border-bottom:1px solid var(--line);}
    .hero{height:104px;}
    .hero .h{font-size:14.5px;}
    .toggle button{padding:6px 10px;}
  }
  @media (max-width:520px){
    .app{padding:18px 12px 44px;}
    .fgrid{grid-template-columns:1fr;}
  }
  @media (prefers-reduced-motion:reduce){a{transition:none;}}
</style>
</head>
<body>
<div class="app">

  <div class="rpt-top">
    <div>
      <h2 data-i18n="title">${t.title}</h2>
      <div class="sub" data-date="${escAttr(pack.date)}">${esc(dateLabel)}</div>
    </div>
    <div class="toggle"><button type="button" id="btn-zh" class="on">中文</button><button type="button" id="btn-en">EN</button></div>
  </div>

  ${dayNavHtml}
  ${headlineHtml}
  ${todayHtml}
  ${featuredHtml}

  <div class="rpt-foot">
    <span class="nobr">${locale === 'en' ? 'Generated by TrendRadar · single-file shareable' : '本报告由 TrendRadar 静态生成 · 单文件可归档转发'}</span>
    <span>${esc(pack.date)}</span>
  </div>
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

/* ---------------------------------------------------------------------------
 * 定稿C helpers — headline + TODAY sourcing (pure, backend pre-filtered)
 * ------------------------------------------------------------------------- */

/** Linked pool of opportunities, annotated with their row day + as-of time. */
function linkedPool(
  pack: DailyReportPack,
): Array<{ opp: DailyOpportunity; day: string; asOf?: number; rowPlatform?: string; href?: string }> {
  const out: Array<{ opp: DailyOpportunity; day: string; asOf?: number; rowPlatform?: string; href?: string }> = [];
  for (const o of pack.opportunities) {
    const href = (o as { href?: string }).href;
    const platform = (o as { rowPlatform?: string }).rowPlatform ?? '';
    // Keep a row WITHOUT a usable href only when it came from a CN news feed
    // (rss:gnews-*/rss:bing-*), which is the only way buildLivePack surfaces a
    // no-URL row (Google wrapper that didn't decode) — it renders non-clickable.
    // Any other no-href row is dropped (back-compat: 无链接 row never renders).
    const hrefUsable = !!href && !isGoogleNewsArticleUrl(href);
    if (!hrefUsable && !platform.startsWith('rss:gnews-') && !platform.startsWith('rss:bing-')) {
      continue;
    }
    out.push({
      opp: o,
      day: (o as { rowDay?: string }).rowDay ?? o.started ?? pack.date,
      asOf: (o as { rowAsOf?: number }).rowAsOf,
      rowPlatform: platform,
      href: hrefUsable ? href : undefined,
    });
  }
  return out;
}

/** Linked opportunities restricted to the report day (TODAY contract). */
function linkedOppsToday(pack: DailyReportPack) {
  return linkedPool(pack).filter((x) => x.day === pack.date);
}

/** Linked stories restricted to the report day (TODAY contract). */
function linkedStoriesToday(
  pack: DailyReportPack,
): Array<{ title: string; href?: string; day?: string; asOf?: number; rowPlatform?: string }> {
  return pack.stories
    .filter((s) => {
      const href = (s as { href?: string }).href;
      if (href) return !isGoogleNewsArticleUrl(href);
      // no-href story kept only when it came from a CN news feed (non-clickable)
      const platform = (s as { rowPlatform?: string }).rowPlatform ?? '';
      return platform.startsWith('rss:gnews-') || platform.startsWith('rss:bing-');
    })
    .map((s) => ({
      title: s.title,
      href: (s as { href?: string }).href,
      day: (s as { rowDay?: string }).rowDay,
      asOf: (s as { rowAsOf?: number }).rowAsOf,
    }));
}

/** 定稿C TODAY rows: unify opportunities + same-day stories, de-dupe by URL+title. */
function dedupeToday(
  rows: Array<
    | { opp: DailyOpportunity; day: string; asOf?: number; rowPlatform?: string; href?: string }
    | { title: string; href?: string; day?: string; asOf?: number }
  >,
): Array<
  | { opp: DailyOpportunity; day: string; asOf?: number; rowPlatform?: string; href?: string }
  | { title: string; href?: string; day?: string; asOf?: number }
> {
  const seen = new Set<string>();
  const out: (typeof rows)[number][] = [];
  for (const r of rows) {
    const isOpp = 'opp' in r;
    const title = isOpp ? (r as { opp: DailyOpportunity }).opp.label : (r as { title: string }).title;
    const href = isOpp
      ? (r as { opp: DailyOpportunity }).opp.href
      : (r as { href?: string }).href;
    const key = href ? `u:${href}` : `t:${normalizeKey(title)}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(r);
  }
  return out;
}

/** Feeds today's 商机/新闻 from opportunities + same-day stories (buildLivePack keeps a single surfaced pool). */
function storyToday(pack: DailyReportPack) {
  return linkedStoriesToday(pack).map((s) => ({ ...s }));
}

/** Normalize a title for de-dupe. */
function normalizeKey(s: string): string {
  return String(s || '')
    .normalize('NFKC')
    .replace(/[，,。．\s]+/g, '')
    .toLowerCase()
    .slice(0, 40);
}

/** Map a TODAY row to a 商机/新闻 row (tag cls + text, age, heat, growth). */
function toBizRow(
  r:
    | { opp: DailyOpportunity; day: string; asOf?: number; rowPlatform?: string; href?: string }
    | { title: string; href?: string; day?: string; asOf?: number },
  locale: DailyReportLocale,
): { tagCls: string; tagTxt: string; title: string; ageDisplay: string; heat: string; grow: string; href: string } {
  if ('opp' in r) {
    const o = r.opp;
    const tagTxt = I18N[locale][`kind-${o.kind}`] ?? o.kind;
    return {
      tagCls: o.kind === '商机' ? 'o' : o.kind === '转机' ? 'g' : 'n',
      tagTxt,
      title: o.label,
      ageDisplay: ageLabel(r.day, r.asOf, locale),
      heat: o.heat ? `${locale === 'en' ? 'Heat' : '热度'} ${esc(o.heat)}` : '',
      grow:
        o.growth && o.growth !== '—'
          ? `<span class="tag g" style="padding:0 5px">${esc(o.growth)}</span>`
          : '',
      href: o.href ?? '',
    };
  }
  return {
    tagCls: 'n',
    tagTxt: locale === 'en' ? 'News' : '新闻',
    title: r.title,
    ageDisplay: ageLabel(r.day ?? '', r.asOf, locale),
    heat: '',
    grow: '',
    href: r.href ?? '',
  };
}

/** Fallback headline pool (any linked opportunity; TODAY preferred). */
function linkedOppsForHeadline(pack: DailyReportPack) {
  return linkedPool(pack);
}

/** One FEATURED card (video/gallery) with type + length, cover, title. */
function fcard(f: { title: string; type?: string; length?: string; imageUrl?: string; href?: string }, cat: 'video' | 'gallery', locale: DailyReportLocale): string {
  const t = I18N[locale];
  const glyph = cat === 'video'
    ? '<svg width="18" height="18" viewBox="0 0 24 24" fill="var(--blue)"><path d="M8 5 v14 l11 -7 z"/></svg>'
    : '<svg width="18" height="18" viewBox="0 0 24 24" fill="none"><rect x="3" y="3" width="8" height="8" rx="1" stroke="var(--heat)" stroke-width="2"/><rect x="13" y="3" width="8" height="8" rx="1" stroke="var(--heat)" stroke-width="2"/><rect x="3" y="13" width="8" height="8" rx="1" stroke="var(--heat)" stroke-width="2"/><rect x="13" y="13" width="8" height="8" rx="1" stroke="var(--heat)" stroke-width="2"/></svg>';
  const inner = f.imageUrl && isUsableImageUrl(f.imageUrl)
    ? `<img src="${escAttr(f.imageUrl)}" alt="${escAttr(f.title)}" loading="lazy"/>`
    : glyph;
  const typeLabel = cat === 'video' ? t.video : t.gallery;
  return `<a class="fcard" ${f.href ? `href="${escAttr(f.href)}" target="_blank" rel="noopener"` : ''} role="link" tabindex="0">
    <div class="cv" style="background:${cat === 'video' ? 'linear-gradient(160deg,#eaf1fd,#dbe7fb)' : 'linear-gradient(160deg,#fdf3ec,#f6e3d3)'}">${inner}</div>
    <div class="cb">
      <div class="t">${esc(f.title)}</div>
      <div class="m"><span>${esc(typeLabel)}</span>${f.length ? `<span>${esc(f.length)}</span>` : ''}</div>
    </div>
  </a>`;
}
