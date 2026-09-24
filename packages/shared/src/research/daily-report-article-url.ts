/**
 * Resolve publisher original article URLs for daily-report packs.
 *
 * Google News RSS often stores `news.google.com/rss/articles/CBMi…` wrappers.
 * Those must never ship as pack `href` — decode to the publisher URL via
 * Google's batchexecute RPC (garturlreq), matching public decoder protocols.
 *
 * NOTE: decoding is best-effort and network-gated. Google can 503/400 our
 * egress region, in which case every resolve returns null — swallowing ~N×150ms
 * of sequential fetches per build. `resolveOriginalArticleUrls` therefore
 * parallelizes with a per-URL timeout and aborts the whole pass early when the
 * region is returning null en masse, so a fresh-ingest → build never stalls the
 * daily day-roll on Google decode work that yields nothing anyway.
 */

const GOOGLE_NEWS_HOST = /(^|\.)news\.google\.com$/i;

/** Hard cap on how long a single Google decode may take (ms). */
export const GOOGLE_DECODE_TIMEOUT_MS = 2500;
/** If this many consecutive Google decodes fail, stop trying the rest. */
export const GOOGLE_DECODE_NULL_THRESHOLD = 6;

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

/** Resolve many URLs, parallelized with a per-URL timeout and an early null abort. */
export async function resolveOriginalArticleUrls(
  urls: string[],
  opts?: { delayMs?: number; concurrency?: number },
): Promise<Map<string, string | null>> {
  const delayMs = opts?.delayMs ?? 120;
  const concurrency = opts?.concurrency ?? 12;
  const out = new Map<string, string | null>();

  // One task per unique URL (respect the earlier dedupe contract).
  const tasks: Array<{ url: string; run: () => Promise<string | null> }> = [];
  const tasksDone = new Set<string>();
  for (const url of urls) {
    if (tasksDone.has(url)) continue;
    tasksDone.add(url);
    tasks.push({
      url,
      run: async () => {
        if (!isGoogleNewsArticleUrl(url)) {
          // Non-Google URL: decode is identity (https-preferred) — no network.
          return preferHttpsArticleUrl(url);
        }
        return resolveGoogleWithTimeout(url, delayMs);
      },
    });
  }

  // Process batches of `concurrency` at a time; abort the whole pass once we've
  // seen a run of Google URLs all return null (region-blocked / nothing to win).
  let consecutiveNull = 0;
  for (let i = 0; i < tasks.length; i += concurrency) {
    const batch = tasks.slice(i, i + concurrency);
    const results = await Promise.all(
      batch.map((t) =>
        t.run().catch(() => null),
      ),
    );
    for (let j = 0; j < batch.length; j++) {
      const value = results[j]!;
      out.set(batch[j]!.url, value);
      if (isGoogleNewsArticleUrl(batch[j]!.url)) {
        if (value == null) {
          consecutiveNull += 1;
        } else {
          consecutiveNull = 0;
        }
      }
    }
    if (consecutiveNull >= GOOGLE_DECODE_NULL_THRESHOLD) {
      // Region is returning null en masse — stop burning network on the rest;
      // leave any remaining tasks unset (caller treats absent as a drop/non-match
      // exactly like a null).
      break;
    }
  }

  return out;
}

/** One Google article decode with a hard timeout attached. */
async function resolveGoogleWithTimeout(url: string, delayMs: number): Promise<string | null> {
  try {
    const result = await withTimeout(resolveOriginalArticleUrl(url), GOOGLE_DECODE_TIMEOUT_MS);
    if (isGoogleNewsArticleUrl(url) && delayMs > 0) {
      await new Promise((r) => setTimeout(r, delayMs));
    }
    return result;
  } catch {
    return null;
  }
}

/** Resolve a promise or reject once the timeout elapses. */
async function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`google decode timed out after ${ms}ms`)), ms);
  });
  try {
    return await Promise.race([p, timeout]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}
