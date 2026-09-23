/**
 * Real-article thumbnail resolution for the daily report (render-time fetch).
 *
 * The report previously shipped generated SVG plates for every card/story.
 * `fetchArticleThumb` pulls the publisher's actual `og:image` meta (falling
 * back to the article-body `<img>`s) so the sales desk sees a real image.
 *
 * Pure HTTP: no schema change, no ingest-time capture, no backfill. The caller
 * (scripts/daily-report/build-live.ts) patches the pack's `imageUrl` in place,
 * and falls back to the existing SVG data-URI whenever fetch fails (graceful,
 * not fatal) — a live artifact should never hard-fail on a flaky publisher.
 *
 * Security: the returned value is a raw publisher URL that the static HTML
 * embeds in an `<img src>`; it is NOT an executable script. It is scoped for
 * the daily-report thumbnail use only.
 *
 * Selection model (why candidate-list + dimension gate):
 * - Publisher pages that set no `og:image` (e.g. cpc.people.com.cn) put site
 *   chrome FIRST in the body (`shoujidenglu.jpg` mobile-login, share/language
 *   icons), so a "first <img>" heuristic commits a placeholder. We collect an
 *   ORDERED candidate list — og family first, then body `<img>`s in DOM order —
 *   and walk it until one passes a raster + minimum-size probe.
 * - A word blocklist alone can't catch every chrome filename (subscribe/s.png,
 *   topapp.jpg, article_lock_left.png…), so `isImageUrl` ALSO reads the image
 *   header dimensions and requires a plausible cover size. That rejects 48x48
 *   icons and 645x102 banners while letting 660px-wide covers through.
 */

/** Absolute URL of the article, else null. */
function resolveAbsolute(url: string, base: string): string | null {
  try {
    return new URL(url, base).href;
  } catch {
    return null;
  }
}

/**
 * Upgrade an absolute http(s) URL to https:// when plain-text `http://` — most
 * publisher CDNs (e.g. i.ce.cn, sinaimg) serve the same asset over https, and
 * shipping a plain-http URL into an https report triggers a browser
 * mixed-content auto-upgrade/warning. Resolves scheme-relative `//` host URLs
 * against the base scheme too. Returns the input unchanged when not http.
 */
function secureUrl(abs: string): string {
  return /^http:\/\//i.test(abs) ? abs.replace(/^http:\/\//i, 'https://') : abs;
}

/**
 * Site-chrome / non-article tokens. A candidate whose url (or alt) contains one
 * of these is NOT an article photo. Word-anchored so a genuine filename that
 * merely ends in e.g. `mark.jpg` isn't caught by a bare substring. `\p{L}`
 * gives language-safe word edges for Chinese publishers.
 */
const CHROME_RE =
  /\.(?:ico|gif|svg|svgz)\b|(?:^|[^\p{L}])(?:logo|banner|header|footer|share|qrcode|qr-?code|icon|icons?|spacer|pixel|blank|avatar|placeholder|place_?holder|login|signin|sign-?in|download|app-?download|app_?store|get-?app|cnt-?app|subscribe|topapp|cntmobile|qzone|weibo|wechat|wx|weixin|sound|voice|audio|speaker|flag|language|lang-?flag|beacon|tracker|pixel-?tag|analytics|impression|ad-?pic|ad_pic|ad[_-]?\d+|poster|brand|mark|seal|copyright|watermark|captcha|loading|spinner|shoujidenglu|mobile-?login|phone-?login|login-?icon|arrow|close|btn|button|slide|bullet|carousel|thumb-?nav|search-?icon|lock|float|menu)(?:[^\p{L}]|$)/iu;

/**
 * Short / marker srcs that are shell navigation, not photos (e.g. `/s/`,
 * `data:image/gif...` tracking pixels).
 */
const SHORT_SRC_RE =
  /src=["'](?:data:|[^"']{0,8}[;?,/ ][^"']{0,8})?["']|src=["']\/[a-z0-9]{1,3}[\/"']?/i;

/** Minimum plausible article-cover footprint (rejects icons/banners). */
const MIN_W = 256;
const MIN_H = 144;

/** A query token that marks a tracking/1x1 beacon. */
const BEACON_RE = /(tracker|pixel|beacon|impression|1x1)/i;

/** True when the URL/value is free of site-chrome / beacon markers. */
function isCleanUrl(url: string): boolean {
  return !BEACON_RE.test(url) && !CHROME_RE.test(url);
}

/**
 * Pull an ordered candidate list: og family metas first (document order), then
 * body `<img>` srcs in DOM order. Never throws. Returns [] when nothing usable.
 */
export function extractThumbFromHtml(html: string, baseUrl: string): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  const push = (raw: string): void => {
    if (typeof raw !== 'string' || !raw.trim()) return;
    const abs = resolveAbsolute(raw.trim(), baseUrl);
    if (!abs || !/^https?:\/\//i.test(abs)) return;
    const sec = secureUrl(abs);
    if (seen.has(sec)) return;
    seen.add(sec);
    out.push(sec);
  };

  // 1) og meta family, in document order. Attribute order agnostic.
  const ogRe =
    /<meta[^>]+(?:property|name)=["'](og:image:secure_url|og:image:url|og:image|twitter:image)["'][^>]*>/gi;
  let m: RegExpExecArray | null;
  while ((m = ogRe.exec(html)) !== null) {
    const content = /content=["']([^"']+)["']/i.exec(m[0]);
    if (!content) continue;
    const value = content[1];
    if (!isCleanUrl(value)) continue; // skip logo / wx_poster og images
    push(value);
  }

  // 2) body <img> srcs in DOM order (fallback when og absent or all rejected).
  const imgRe = /<img[^>]+src=["']([^"']+)["'][^>]*>/gi;
  while ((m = imgRe.exec(html)) !== null) {
    const token = m[0];
    if (SHORT_SRC_RE.test(token)) continue;
    if (CHROME_RE.test(token)) continue; // skip share/login/icon/logo marks
    push(m[1]);
  }
  return out;
}

/** PNG IHDR width/height (bytes 16-23), from a buffer starting with PNG magic. */
function pngSize(buf: Buffer): { w: number; h: number } | null {
  if (buf.length < 24 || buf.slice(1, 4).toString('ascii') !== 'PNG') return null;
  return { w: buf.readUInt32BE(16), h: buf.readUInt32BE(20) };
}

/** JPEG SOF0/SOF2/SOF1 width/height, scanning up to the buffer end. */
function jpegSize(buf: Buffer): { w: number; h: number } | null {
  if (buf.length < 16 || buf[0] !== 0xff || buf[1] !== 0xd8) return null;
  let i = 2;
  let scanned = 0;
  while (i + 9 < buf.length && scanned < 200000) {
    if (buf[i] !== 0xff) {
      i += 1;
      scanned += 1;
      continue;
    }
    const marker = buf[i + 1];
    if (marker === 0xd8 || (marker >= 0xd0 && marker <= 0xd9)) {
      i += 2;
      continue;
    }
    const len = buf.readUInt16BE(i + 2);
    if (marker >= 0xc0 && marker <= 0xc3) {
      return { w: buf.readUInt16BE(i + 7), h: buf.readUInt16BE(i + 5) };
    }
    if (len < 2) return null;
    i += 2 + len;
  }
  return null;
}

/** WebP RIFF: "RIFF"(0-4) size(4-8) "WEBP"(8-12) chunk-fourCC(12-16) size(16-20) data(20+). */
function webpSize(buf: Buffer): { w: number; h: number } | null {
  if (buf.length < 30 || buf.toString('ascii', 0, 4) !== 'RIFF') return null;
  const chunk = buf.toString('ascii', 12, 16);
  if (chunk === 'VP8L') {
    const b = buf.readUInt32LE(21);
    return { w: (b & 0x3fff) + 1, h: ((b >> 14) & 0x3fff) + 1 };
  }
  if (chunk === 'VP8X') {
    // flags byte at 20; canvas width-1 (24-bit LE) at 21-23; height-1 at 24-26.
    return { w: buf.readUIntLE(21, 3) + 1, h: buf.readUIntLE(24, 3) + 1 };
  }
  if (chunk === 'VP8 ') {
    return { w: buf.readUInt16LE(26) & 0x3fff, h: buf.readUInt16LE(28) & 0x3fff };
  }
  return null;
}

/**
 * Content-SNIFF the image header dimensions from the first bytes, independent
 * of the (unreliable) content-type header — e.g. yicai serves PNG bytes labeled
 * image/jpeg. Returns null when the bytes aren't a decodable raster header.
 */
function sniffDims(buf: Buffer): { w: number; h: number } | null {
  return pngSize(buf) ?? jpegSize(buf) ?? webpSize(buf) ?? null;
}

/**
 * Read up to PROBE_BYTES of the image to reach the header. Servers that ignore
 * Range still return the full body; we cap what we read.
 */
async function probeImageDims(url: string, timeoutMs: number): Promise<{ w: number; h: number } | null> {
  const res = await fetch(url, {
    headers: { Range: 'bytes=0-131071' },
    redirect: 'follow',
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (!res.ok && res.status !== 206) return null;
  const reader = res.body ? res.body.getReader() : null;
  if (!reader) return null;
  const chunks: Uint8Array[] = [];
  let bytes = 0;
  while (bytes < 131072) {
    const { done, value } = await reader.read();
    if (done) break;
    bytes += value.byteLength;
    if (bytes > 131072) {
      reader.cancel().catch(() => {});
      break;
    }
    chunks.push(value);
  }
  return sniffDims(Buffer.concat(chunks));
}

/**
 * True when the URL is http(s) AND the image bytes are an allowed raster format
 * (PNG/JPEG/WebP) AND a plausible cover size (min-width/height gate, content-
 * sniffed). The size gate rejects chrome that a word blocklist can't catch
 * (icons, lock/float bars, download banners). Never throws.
 */
export async function isImageUrl(url: string, timeoutMs = 5000): Promise<boolean> {
  if (!/^https?:\/\//i.test(url)) return false;
  if (!isCleanUrl(url)) return false;
  try {
    const d = await probeImageDims(url, timeoutMs);
    if (!d) return false;
    if (d.w < MIN_W || d.h < MIN_H) return false;
    return true;
  } catch {
    return false;
  }
}

const FETCH_TIMEOUT_MS = 6000;
const MAX_BYTES = 1024 * 1024;
const MAX_PROBE_CANDIDATES = 12;

/**
 * Fetch an article page and return its best thumbnail URL, or null on any
 * failure (network error, timeout, non-HTML, oversized, no usable image).
 * Walks the candidate list in order and returns the FIRST that is a real,
 * size-plausible raster image. Never throws.
 */
export async function fetchArticleThumb(url: string): Promise<string | null> {
  if (!/^https?:\/\//i.test(url)) return null;
  try {
    const res = await fetch(url, {
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; TrendsDailyReport/1.0)' },
      redirect: 'follow',
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    });
    if (!res.ok) return null;
    const ctypeFull = (res.headers.get('content-type') || '').toLowerCase();
    const ctype = ctypeFull.split(';')[0].trim();
    if (ctype && ctype !== 'text/html' && !ctype.endsWith('/html')) return null;
    const total = Number(res.headers.get('content-length') || 0);
    if (total > MAX_BYTES) return null;
    const reader = res.body ? res.body.getReader() : null;
    if (!reader) return null;
    const chunks: Uint8Array[] = [];
    let bytes = 0;
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      bytes += value.byteLength;
      if (bytes > MAX_BYTES) {
        reader.cancel().catch(() => {});
        return null;
      }
      chunks.push(value);
    }
    const buf = Buffer.concat(chunks);
    // Fix: decode as UTF-8 by default (the old latin1 default mangled CN pages).
    const charset = /charset=["']?([\w-]+)/i.exec(ctypeFull);
    const enc = charset ? charset[1].toLowerCase() : 'utf-8';
    const html =
      enc === 'utf-8' || enc === 'utf8' ? buf.toString('utf8') : buf.toString('latin1');

    const candidates = extractThumbFromHtml(html, url).slice(0, MAX_PROBE_CANDIDATES);
    for (const cand of candidates) {
      if (await isImageUrl(cand)) return cand;
    }
    return null;
  } catch {
    return null;
  }
}

/**
 * Fetch real thumbs for up to `limit` article URLs, honoring a small
 * concurrency cap. Returns a map url → thumb-or-undefined.
 */
export async function fetchThumbsForUrls(
  urls: string[],
  limit = 12,
  concurrency = 4,
): Promise<Map<string, string>> {
  const unique = [...new Set(urls.filter((u) => /^https?:\/\//i.test(u)))].slice(0, limit);
  const out = new Map<string, string>();
  let idx = 0;
  const worker = async () => {
    while (idx < unique.length) {
      const u = unique[idx++];
      const thumb = await fetchArticleThumb(u);
      if (thumb) out.set(u, thumb);
    }
  };
  const workers = Array.from({ length: Math.min(concurrency, Math.max(unique.length, 1)) }, () => worker());
  await Promise.all(workers);
  return out;
}
