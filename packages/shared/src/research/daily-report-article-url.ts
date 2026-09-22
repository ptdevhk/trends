/**
 * Resolve publisher original article URLs for daily-report packs.
 *
 * Google News RSS often stores `news.google.com/rss/articles/CBMi…` wrappers.
 * Those must never ship as pack `href` — decode to the publisher URL via
 * Google's batchexecute RPC (garturlreq), matching public decoder protocols.
 */

const GOOGLE_NEWS_HOST = /(^|\.)news\.google\.com$/i;

export function isGoogleNewsArticleUrl(url: string): boolean {
  try {
    const u = new URL(url.trim());
    if (!GOOGLE_NEWS_HOST.test(u.hostname)) return false;
    const parts = u.pathname.split('/').filter(Boolean);
    if (parts.length < 2) return false;
    return parts[parts.length - 2] === 'articles' || parts[parts.length - 2] === 'read';
  } catch {
    return false;
  }
}

/** Extract the CBMi… / base64 article id from a Google News article URL. */
export function googleNewsArticleId(url: string): string | null {
  try {
    const u = new URL(url.trim());
    const parts = u.pathname.split('/').filter(Boolean);
    if (parts.length < 2) return null;
    if (!['articles', 'read'].includes(parts[parts.length - 2]!)) return null;
    const id = parts[parts.length - 1]!.split('?')[0];
    return id && id.length > 8 ? id : null;
  } catch {
    return null;
  }
}

/** Parse batchexecute text body → decoded publisher URL (or null). */
export function parseGarturlresResponse(text: string): string | null {
  const stripped = text.replace(/^\)\]\}'\s*/, '');
  const chunks = stripped.split(/\n+/).map((s) => s.trim()).filter(Boolean);
  for (const chunk of chunks) {
    try {
      const parsed = JSON.parse(chunk) as unknown;
      if (!Array.isArray(parsed)) continue;
      for (const row of parsed) {
        if (!Array.isArray(row)) continue;
        if (row[0] !== 'wrb.fr' && row[0] !== 'w779db') continue;
        if (row[1] !== 'Fbv4je') continue;
        const inner = row[2];
        if (typeof inner !== 'string') continue;
        const data = JSON.parse(inner) as unknown;
        if (Array.isArray(data) && typeof data[1] === 'string' && /^https?:\/\//i.test(data[1])) {
          return data[1];
        }
      }
    } catch {
      // try next chunk
    }
  }
  return null;
}

type DecodeParams = { signature: string; timestamp: string; base64Str: string };

async function fetchDecodingParams(base64Str: string): Promise<DecodeParams | null> {
  const url = `https://news.google.com/rss/articles/${base64Str}`;
  const res = await fetch(url, {
    headers: {
      'User-Agent':
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.0.0 Safari/537.36',
      Accept: 'text/html,application/xhtml+xml',
    },
  });
  if (!res.ok) return null;
  const html = await res.text();
  const signature = html.match(/data-n-a-sg="([^"]+)"/)?.[1];
  const timestamp = html.match(/data-n-a-ts="([^"]+)"/)?.[1];
  if (!signature || !timestamp) return null;
  return { signature, timestamp, base64Str };
}

async function decodeWithParams(params: DecodeParams): Promise<string | null> {
  const payload = [
    'Fbv4je',
    `["garturlreq",[["X","X",["X","X"],null,null,1,1,"US:en",null,1,null,null,null,null,null,0,1],"X","X",1,[1,1,1],1,1,null,0,0,null,0],"${params.base64Str}",${params.timestamp},"${params.signature}"]`,
  ];
  const body = `f.req=${encodeURIComponent(JSON.stringify([[payload]]))}`;
  const res = await fetch('https://news.google.com/_/DotsSplashUi/data/batchexecute?rpcids=Fbv4je', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded;charset=UTF-8',
      'User-Agent':
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.0.0 Safari/537.36',
      Origin: 'https://news.google.com',
      Referer: 'https://news.google.com/',
    },
    body,
  });
  if (!res.ok) return null;
  return parseGarturlresResponse(await res.text());
}

/** Prefer https when the publisher URL is http. */
export function preferHttpsArticleUrl(url: string): string {
  try {
    const u = new URL(url.trim());
    if (u.protocol === 'http:') {
      u.protocol = 'https:';
      return u.toString();
    }
    return u.toString();
  } catch {
    return url.trim();
  }
}

/**
 * If `url` is a Google News wrapper, decode to the publisher article URL.
 * Non-Google URLs are returned unchanged (https-preferred).
 * Returns null when Google decode fails (caller should drop the row).
 */
export async function resolveOriginalArticleUrl(url: string): Promise<string | null> {
  const trimmed = (url ?? '').trim();
  if (!trimmed || !/^https?:\/\//i.test(trimmed)) return null;
  if (!isGoogleNewsArticleUrl(trimmed)) return preferHttpsArticleUrl(trimmed);

  const id = googleNewsArticleId(trimmed);
  if (!id) return null;
  const params = await fetchDecodingParams(id);
  if (!params) return null;
  const decoded = await decodeWithParams(params);
  if (!decoded || isGoogleNewsArticleUrl(decoded)) return null;
  return preferHttpsArticleUrl(decoded);
}

/** Resolve many URLs with a small delay between Google fetches. */
export async function resolveOriginalArticleUrls(
  urls: string[],
  opts?: { delayMs?: number },
): Promise<Map<string, string | null>> {
  const delayMs = opts?.delayMs ?? 120;
  const out = new Map<string, string | null>();
  for (const url of urls) {
    if (out.has(url)) continue;
    try {
      out.set(url, await resolveOriginalArticleUrl(url));
    } catch {
      out.set(url, null);
    }
    if (isGoogleNewsArticleUrl(url) && delayMs > 0) {
      await new Promise((r) => setTimeout(r, delayMs));
    }
  }
  return out;
}
