export const CHANNELS_PREVIEW_ENDPOINT =
  "https://channels.weixin.qq.com/finder-preview/api/feed/get_feed_info";

export const CHANNELS_PREVIEW_TIMEOUT_MS = 10_000;
export const CHANNELS_PREVIEW_MAX_BYTES = 256 * 1024;

const SPH_ID_RE = /^[A-Za-z0-9]+$/;
const SENSITIVE_QUERY_KEYS = [
  "token",
  "sign",
  "signature",
  "encfilekey",
  "thumbkey",
  "secret",
  "auth",
  "authorization",
  "key",
];

export class ChannelsUrlError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ChannelsUrlError";
  }
}

export class ChannelsPreviewUpstreamError extends Error {
  status: 502 | 503;

  constructor(message: string, status: 502 | 503) {
    super(message);
    this.name = "ChannelsPreviewUpstreamError";
    this.status = status;
  }
}

export type ChannelsPreviewPost = {
  shareId: string;
  url: string;
  author: string;
  caption: string;
  createtime: number | null;
  likes: number;
  comments: number;
  forwards: number;
  favs: number;
  views: number;
  coverUrl: string | null;
};

export type ChannelsPreviewTransport = {
  post(input: {
    url: string;
    body: string;
    headers: Record<string, string>;
    timeoutMs: number;
  }): Promise<{ status: number; json: unknown }>;
};

let injectedTransport: ChannelsPreviewTransport | undefined;

export function setChannelsPreviewTransportForTests(
  transport: ChannelsPreviewTransport | undefined,
): void {
  injectedTransport = transport;
}

export function classifyChannelsUrl(urlStr: string): { shareId: string; canonicalUrl: string } {
  if (typeof urlStr !== "string" || !urlStr.trim()) {
    throw new ChannelsUrlError("URL is not an allowlisted WeChat Channels share form");
  }

  let parsed: URL;
  try {
    parsed = new URL(urlStr.trim());
  } catch {
    throw new ChannelsUrlError("URL is not an allowlisted WeChat Channels share form");
  }

  if (parsed.protocol !== "https:") {
    throw new ChannelsUrlError("URL is not an allowlisted WeChat Channels share form");
  }
  if (parsed.username || parsed.password) {
    throw new ChannelsUrlError("URL is not an allowlisted WeChat Channels share form");
  }
  if (parsed.port && parsed.port !== "443") {
    throw new ChannelsUrlError("URL is not an allowlisted WeChat Channels share form");
  }

  const hostname = parsed.hostname.toLowerCase().replace(/\.$/, "");
  const pathname = parsed.pathname || "/";
  const shareIdFromPath = pathname.match(/^\/sph\/([A-Za-z0-9]+)\/?$/);
  const previewId = parsed.searchParams.get("id") ?? "";

  if (hostname === "weixin.qq.com" && shareIdFromPath && SPH_ID_RE.test(shareIdFromPath[1] ?? "")) {
    const shareId = shareIdFromPath[1]!;
    return { shareId, canonicalUrl: `https://weixin.qq.com/sph/${shareId}` };
  }

  if (
    hostname === "channels.weixin.qq.com" &&
    pathname === "/finder-preview/pages/sph" &&
    SPH_ID_RE.test(previewId)
  ) {
    return { shareId: previewId, canonicalUrl: `https://weixin.qq.com/sph/${previewId}` };
  }

  throw new ChannelsUrlError("URL is not an allowlisted WeChat Channels share form");
}

export function parseCountFmt(value: unknown): number {
  if (value === null || value === undefined) {
    return 0;
  }
  if (typeof value === "number" && Number.isFinite(value)) {
    return Math.trunc(value);
  }
  const raw = String(value).trim().replace(/\+$/, "").trim();
  if (!raw) {
    return 0;
  }
  try {
    if (/[万wW]$/.test(raw)) {
      return Math.trunc(Number.parseFloat(raw.slice(0, -1)) * 10_000);
    }
    if (/[kK]$/.test(raw)) {
      return Math.trunc(Number.parseFloat(raw.slice(0, -1)) * 1_000);
    }
    const parsed = Number.parseFloat(raw);
    return Number.isFinite(parsed) ? Math.trunc(parsed) : 0;
  } catch {
    return 0;
  }
}

function asRecord(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function firstString(...values: unknown[]): string {
  for (const value of values) {
    if (typeof value === "string" && value.trim()) {
      return value;
    }
  }
  return "";
}

function firstNumber(...values: unknown[]): number | null {
  for (const value of values) {
    if (typeof value === "number" && Number.isFinite(value)) {
      return Math.trunc(value);
    }
    if (typeof value === "string" && value.trim()) {
      const parsed = Number.parseInt(value, 10);
      if (Number.isFinite(parsed)) {
        return parsed;
      }
    }
  }
  return null;
}

const COVER_STILL_PATH_RE = /^\/\d+\/\d+\/stodownload$/;
const COVER_STILL_HOST = "finder.video.qq.com";
const COVER_STILL_ALLOWED_SENSITIVE_KEYS = new Set(["encfilekey", "token"]);
const PLAYABLE_MEDIA_MARKERS = [".mp4", ".m3u8", "wxavfile"];

function hasSensitiveQueryKey(key: string, allowed: ReadonlySet<string> = new Set()): boolean {
  const lower = key.toLowerCase();
  if (allowed.has(lower)) {
    return false;
  }
  return SENSITIVE_QUERY_KEYS.some((flag) => lower.includes(flag));
}

function isLiveShapedStill(parsed: URL): boolean {
  const hostname = parsed.hostname.toLowerCase().replace(/\.$/, "");
  if (hostname !== COVER_STILL_HOST) {
    return false;
  }
  if (!COVER_STILL_PATH_RE.test(parsed.pathname)) {
    return false;
  }
  return parsed.searchParams.has("picformat") || parsed.searchParams.has("wxampicformat");
}

export function sanitizeCoverUrl(raw: unknown): string | null {
  if (typeof raw !== "string") {
    return null;
  }
  const trimmed = raw.trim();
  if (!trimmed.startsWith("https://")) {
    return null;
  }
  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    return null;
  }
  if (parsed.username || parsed.password) {
    return null;
  }
  const haystack = `${parsed.pathname}${parsed.search}`.toLowerCase();
  if (PLAYABLE_MEDIA_MARKERS.some((marker) => haystack.includes(marker))) {
    return null;
  }

  if (isLiveShapedStill(parsed)) {
    for (const key of parsed.searchParams.keys()) {
      if (hasSensitiveQueryKey(key, COVER_STILL_ALLOWED_SENSITIVE_KEYS)) {
        return null;
      }
    }
    return trimmed;
  }

  if (parsed.pathname.toLowerCase().includes("stodownload")) {
    return null;
  }
  for (const key of parsed.searchParams.keys()) {
    if (hasSensitiveQueryKey(key)) {
      return null;
    }
  }
  return trimmed;
}

export function normalizeChannelsPreviewResponse(
  data: unknown,
  classified: { shareId: string; canonicalUrl: string },
): ChannelsPreviewPost {
  const root = asRecord(data);
  const nested = asRecord(root.data);
  const object = asRecord(nested.object ?? root.object);
  const feedInfo = asRecord(nested.feedInfo ?? root.feedInfo ?? object);
  const authorInfo = asRecord(
    nested.authorInfo ?? root.authorInfo ?? object.contact ?? object,
  );

  const caption = firstString(
    feedInfo.description,
    feedInfo.title,
    object.description,
    object.title,
  );
  const author = firstString(authorInfo.nickname, object.nickname, feedInfo.nickname);
  const createtime = firstNumber(feedInfo.createtime, feedInfo.createTime, object.createtime);
  const likes = parseCountFmt(
    feedInfo.likeCountFmt ?? feedInfo.like_count ?? feedInfo.likeCount ?? object.like_count,
  );
  const comments = parseCountFmt(
    feedInfo.commentCountFmt ??
      feedInfo.comment_count ??
      feedInfo.commentCount ??
      object.comment_count,
  );
  const forwards = parseCountFmt(
    feedInfo.forwardCountFmt ??
      feedInfo.forward_count ??
      feedInfo.forwardCount ??
      object.forward_count,
  );
  const favs = parseCountFmt(
    feedInfo.favCountFmt ?? feedInfo.fav_count ?? feedInfo.favCount ?? object.fav_count,
  );
  const views = parseCountFmt(
    feedInfo.readCountFmt ?? feedInfo.read_count ?? feedInfo.readCount ?? object.read_count,
  );
  const coverUrl = sanitizeCoverUrl(feedInfo.coverUrl ?? feedInfo.cover_url ?? object.coverUrl);

  const hasMetadata = Boolean(
    caption || author || views > 0 || likes > 0 || favs > 0 || forwards > 0 || createtime !== null,
  );
  if (!hasMetadata) {
    throw new ChannelsPreviewUpstreamError("WeChat Channels preview returned no metadata", 502);
  }

  return {
    shareId: classified.shareId,
    url: classified.canonicalUrl,
    author,
    caption,
    createtime,
    likes,
    comments,
    forwards,
    favs,
    views,
    coverUrl,
  };
}

function mapFetchError(error: unknown): never {
  const name = error instanceof Error ? error.name : "";
  const message = error instanceof Error ? error.message : String(error);
  if (
    name === "TimeoutError" ||
    name === "AbortError" ||
    /timeout|network|fetch failed|ECONNRESET|ENOTFOUND/i.test(message)
  ) {
    throw new ChannelsPreviewUpstreamError("WeChat Channels preview is unavailable", 503);
  }
  throw new ChannelsPreviewUpstreamError("WeChat Channels preview failed", 502);
}

async function defaultFetchTransport(input: {
  url: string;
  body: string;
  headers: Record<string, string>;
  timeoutMs: number;
}): Promise<{ status: number; json: unknown }> {
  let response: Response;
  try {
    response = await fetch(input.url, {
      method: "POST",
      headers: input.headers,
      body: input.body,
      redirect: "error",
      credentials: "omit",
      signal: AbortSignal.timeout(input.timeoutMs),
    });
  } catch (error) {
    mapFetchError(error);
  }

  if (!response.ok) {
    throw new ChannelsPreviewUpstreamError(
      `WeChat Channels preview returned HTTP ${response.status}`,
      502,
    );
  }

  const buffer = await response.arrayBuffer();
  if (buffer.byteLength > CHANNELS_PREVIEW_MAX_BYTES) {
    throw new ChannelsPreviewUpstreamError("WeChat Channels preview response exceeded 256 KiB", 502);
  }

  try {
    return { status: response.status, json: JSON.parse(new TextDecoder().decode(buffer)) };
  } catch {
    throw new ChannelsPreviewUpstreamError("WeChat Channels preview returned invalid JSON", 502);
  }
}

export async function resolveChannelsPreview(urlStr: string): Promise<ChannelsPreviewPost> {
  const classified = classifyChannelsUrl(urlStr);
  const pageUrl = `https://channels.weixin.qq.com/finder-preview/pages/sph?id=${classified.shareId}`;
  const rid = crypto.randomUUID().replaceAll("-", "");
  const requestUrl = `${CHANNELS_PREVIEW_ENDPOINT}?_rid=${rid}&_pageUrl=${encodeURIComponent(pageUrl)}`;
  const body = JSON.stringify({
    baseReq: { generalToken: "" },
    shortUri: classified.shareId,
  });
  const headers = {
    Accept: "application/json, text/plain, */*",
    "Content-Type": "application/json",
    Origin: "https://channels.weixin.qq.com",
    Referer: pageUrl,
    "User-Agent":
      "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
  };

  const transport = injectedTransport ?? { post: defaultFetchTransport };
  let payload: { status: number; json: unknown };
  try {
    payload = await transport.post({
      url: requestUrl,
      body,
      headers,
      timeoutMs: CHANNELS_PREVIEW_TIMEOUT_MS,
    });
  } catch (error) {
    if (error instanceof ChannelsPreviewUpstreamError) {
      throw error;
    }
    mapFetchError(error);
  }

  if (payload.status < 200 || payload.status >= 300) {
    throw new ChannelsPreviewUpstreamError(
      `WeChat Channels preview returned HTTP ${payload.status}`,
      502,
    );
  }

  return normalizeChannelsPreviewResponse(payload.json, classified);
}
