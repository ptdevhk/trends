/**
 * Real-article thumbnail resolution for the daily report (render-time fetch).
 *
 * The report previously shipped generated SVG plates for every card/story.
 * `fetchArticleThumb` pulls the publisher's actual `og:image` meta (falling
 * back to the first `<img>` in the HTML) so the sales desk sees a real image.
 *
 * Pure HTTP: no schema change, no ingest-time capture, no backfill. The caller
 * (scripts/daily-report/build-live.ts) patches the pack's `imageUrl` in place,
 * and falls back to the existing SVG data-URI whenever fetch fails (graceful,
 * not fatal) — a live artifact should never hard-fail on a flaky publisher.
 *
 * Security: the returned value is a raw publisher URL that the static HTML
 * embeds in an `<img src>`; it is NOT an executable script. It is scoped for
 * the daily-report thumbnail use only.
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
 * mixed-content auto-upgrade/warning. Returns the input unchanged when it is
 * already https (or not http at all).
 */
function secureUrl(abs: string): string {
  return /^http:\/\//i.test(abs) ? abs.replace(/^http:\/\//i, 'https://') : abs;
}

/** A small icon/spacer-ish src we should skip in the <img> fallback. */
const TINY_IMG = /(logo|icon|spacer|pixel|blank|avatar|\.(ico|gif)|src=[^"']{0,12}\/)/i;

/** Pull og:image / og:image:url / twitter:image; fall back to first real <img>. */
export function extractThumbFromHtml(html: string, baseUrl: string): string | null {
  // og:image meta — most publishers set this to the article cover.
  const og =
    /<meta[^>]+property=["'](?:og:image|og:image:url)["'][^>]+content=["']([^"']+)["']/i.exec(html) ||
    /<meta[^>]+(?:property|name)=["']twitter:image["'][^>]+content=["']([^"']+)["']/i.exec(html) ||
    /<meta[^>]+content=["']([^"']+)["'][^>]+property=["'](?:og:image|og:image:url)["']/i.exec(html);
  if (og) {
    const abs = resolveAbsolute(og[1], baseUrl);
    if (abs && (abs.startsWith('http://') || abs.startsWith('https://'))) return secureUrl(abs);
  }
  // Fallback: first real <img> in the body (skip tiny icons/spacers/logos).
  const imgRe = /<img[^>]+src=["']([^"']+)["']/gi;
  let m: RegExpExecArray | null;
  while ((m = imgRe.exec(html)) !== null) {
    const abs = resolveAbsolute(m[1], baseUrl);
    if (!abs || !/^https?:\/\//i.test(abs)) continue;
    if (TINY_IMG.test(m[0])) continue;
    return secureUrl(abs);
  }
  return null;
}

/** True when the URL responds with an image content-type (HEAD probe). */
export async function isImageUrl(url: string, timeoutMs = 5000): Promise<boolean> {
  if (!/^https?:\/\//i.test(url)) return false;
  try {
    const res = await fetch(url, { method: 'HEAD', redirect: 'follow', signal: AbortSignal.timeout(timeoutMs) });
    if (!res.ok) return false;
    return (res.headers.get('content-type') || '').toLowerCase().startsWith('image/');
  } catch {
    return false;
  }
}

const FETCH_TIMEOUT_MS = 6000;
const MAX_BYTES = 1024 * 1024;

/**
 * Fetch an article page and return its thumbnail URL, or null on any failure
 * (network error, timeout, non-HTML, oversized, no image). Never throws.
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
    const ctype = (res.headers.get('content-type') || '').split(';')[0].toLowerCase();
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
    const htmlUtf8 = buf.toString('utf8');
    const html = ctype.includes('utf-8') ? htmlUtf8 : buf.toString('latin1');
    const cand = extractThumbFromHtml(html, url);
    // Reject wrong-but-real URLs by HEAD-probing the candidate is actually an image.
    if (cand && (await isImageUrl(cand))) return cand;
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
