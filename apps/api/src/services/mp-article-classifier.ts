/**
 * Classify public WeChat official-account (mp.weixin.qq.com) article URLs for
 * the boss-paste briefing flow.
 *
 * This is deliberately SEPARATE from channels-preview-probe.ts: Channels
 * allowlists sph only and rejects mp by design (Phase C keeps that boundary).
 * mp articles are a distinct briefing path, not Channels.
 *
 * Accepted article forms (public share URLs only):
 *   - https://mp.weixin.qq.com/s/<id>
 *   - https://mp.weixin.qq.com/s?__biz=...&mid=...&idx=1&sn=... (legacy share)
 *
 * Rejects: non-https, userinfo, non-443 port, non-mp.weixin.qq.com host, and
 * non-article paths (e.g. /appmsg, /profile). We do NOT accept spams/verify or
 * other non-article WeChat surfaces.
 */

export class MpArticleUrlError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "MpArticleUrlError";
  }
}

export type MpArticleUrl = {
  /** Canonical mp article URL. Kept verbatim (WeChat article ids are opaque). */
  url: string;
  /** Opaque article id when present (the `/s/<id>` form). */
  articleId?: string;
};

export function classifyMpArticleUrl(urlStr: string): MpArticleUrl {
  if (typeof urlStr !== "string" || !urlStr.trim()) {
    throw new MpArticleUrlError("URL is not an allowlisted WeChat official-account article form");
  }

  let parsed: URL;
  try {
    parsed = new URL(urlStr.trim());
  } catch {
    throw new MpArticleUrlError("URL is not an allowlisted WeChat official-account article form");
  }

  if (parsed.protocol !== "https:") {
    throw new MpArticleUrlError("URL is not an allowlisted WeChat official-account article form");
  }
  if (parsed.username || parsed.password) {
    throw new MpArticleUrlError("URL is not an allowlisted WeChat official-account article form");
  }
  if (parsed.port && parsed.port !== "443") {
    throw new MpArticleUrlError("URL is not an allowlisted WeChat official-account article form");
  }

  const hostname = parsed.hostname.toLowerCase().replace(/\.$/, "");
  if (hostname !== "mp.weixin.qq.com") {
    // Channels (sph) and all other hosts belong to their own briefing lanes.
    throw new MpArticleUrlError("URL is not an allowlisted WeChat official-account article form");
  }

  const pathname = parsed.pathname || "/";
  const articleIdFromPath = pathname.match(/^\/s\/([A-Za-z0-9_-]+)\/?$/);

  // /s/<id> present → accept. Otherwise /s (or /s/) with __biz query → legacy share.
  if (articleIdFromPath && articleIdFromPath[1]) {
    return { url: urlStr.trim(), articleId: articleIdFromPath[1] };
  }
  if (pathname === "/s" || pathname === "/s/") {
    if (parsed.searchParams.has("__biz")) {
      return { url: urlStr.trim() };
    }
  }

  throw new MpArticleUrlError("URL is not an allowlisted WeChat official-account article form");
}
