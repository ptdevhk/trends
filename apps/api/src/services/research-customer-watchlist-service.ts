import { workspaceConfigService } from "./workspace-config-service.js";
import { classifyChannelsUrl } from "./channels-preview-probe.js";
import { resolveChannelsPreview } from "./channels-preview-probe.js";
import {
  classifyMpArticleUrl,
  MpArticleUrlError,
} from "./mp-article-classifier.js";

export const CUSTOMER_WATCHLIST_CONFIG_KEY = "research.customerWatchlist";

export const DOWNSTREAM_BRANCHES = [
  "压铸",
  "模具",
  "五金",
  "冲压",
  "机加工",
  "钣金",
  "其他",
] as const;
export type DownstreamBranch = (typeof DOWNSTREAM_BRANCHES)[number];

export type WatchlistSourceKind = "videoChannel" | "mp" | "manual";

export type CustomerWatchEntry = {
  id: string;
  /** Canonical company key if resolved; else a slug derived from the name. */
  companyKey: string;
  name: string;
  aliases: string[];
  downstreamBranch: DownstreamBranch;
  sourceKind: WatchlistSourceKind;
  sourceUrls: string[];
  sourceAuthor?: string;
  caption?: string;
  status: "active" | "needsTopic";
  createdAt: number;
  updatedAt: number;
};

export type CustomerWatchlist = CustomerWatchEntry[];

export class CustomerWatchlistValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CustomerWatchlistValidationError";
  }
}

function isDownstreamBranch(value: unknown): value is DownstreamBranch {
  return typeof value === "string" && (DOWNSTREAM_BRANCHES as readonly string[]).includes(value);
}

export function slugifyCompanyKey(name: string): string {
  const cleaned = name
    .trim()
    .toLowerCase()
    .replace(/[^\p{Script=Han}A-Za-z0-9]+/gu, "-")
    .replace(/^-+|-+$/g, "");
  return cleaned || "customer";
}

function parseEntry(value: unknown, id: string): CustomerWatchEntry | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const row = value as Record<string, unknown>;
  if (typeof row.name !== "string" || !row.name.trim()) return null;
  const branch = isDownstreamBranch(row.downstreamBranch) ? row.downstreamBranch : "其他";
  const sourceKind =
    row.sourceKind === "videoChannel" || row.sourceKind === "mp" || row.sourceKind === "manual"
      ? row.sourceKind
      : "manual";
  return {
    id,
    companyKey: typeof row.companyKey === "string" ? row.companyKey : slugifyCompanyKey(row.name),
    name: row.name.trim(),
    aliases: Array.isArray(row.aliases) ? row.aliases.filter((a): a is string => typeof a === "string") : [],
    downstreamBranch: branch,
    sourceKind,
    sourceUrls: Array.isArray(row.sourceUrls)
      ? row.sourceUrls.filter((s): s is string => typeof s === "string")
      : [],
    ...(typeof row.sourceAuthor === "string" && row.sourceAuthor ? { sourceAuthor: row.sourceAuthor } : {}),
    ...(typeof row.caption === "string" && row.caption ? { caption: row.caption } : {}),
    status: row.status === "needsTopic" ? "needsTopic" : "active",
    createdAt: typeof row.createdAt === "number" ? row.createdAt : 0,
    updatedAt: typeof row.updatedAt === "number" ? row.updatedAt : typeof row.createdAt === "number" ? row.createdAt : 0,
  };
}

export function parseCustomerWatchlist(raw: unknown): CustomerWatchlist {
  if (!Array.isArray(raw)) return [];
  const out: CustomerWatchlist = [];
  for (const [i, item] of raw.entries()) {
    const stored = item && typeof item === "object" && !Array.isArray(item)
      ? (item as Record<string, unknown>).id
      : undefined;
    const id = typeof stored === "string" && stored ? stored : String(i);
    const parsed = parseEntry(item, id);
    if (parsed) out.push(parsed);
  }
  return out;
}

export async function getCustomerWatchlist(workspaceSlug: string): Promise<CustomerWatchlist> {
  const raw = await workspaceConfigService.getWorkspaceConfigValue(workspaceSlug, CUSTOMER_WATCHLIST_CONFIG_KEY);
  return parseCustomerWatchlist(raw);
}

function sanitizeName(name: string): string {
  const trimmed = name.trim();
  if (!trimmed) throw new CustomerWatchlistValidationError("客户名称不能为空");
  if (trimmed.length > 60) throw new CustomerWatchlistValidationError("客户名称过长");
  return trimmed;
}

function sanitizeAliases(aliases: unknown): string[] {
  if (aliases === undefined) return [];
  if (!Array.isArray(aliases)) throw new CustomerWatchlistValidationError("别名必须是数组");
  const out: string[] = [];
  for (const a of aliases) {
    if (typeof a !== "string") continue;
    const t = a.trim();
    if (t) out.push(t);
  }
  return out;
}

export async function addCustomerWatchEntry(
  workspaceSlug: string,
  input: {
    name: string;
    aliases?: string[];
    downstreamBranch?: DownstreamBranch;
    sourceKind?: WatchlistSourceKind;
    sourceUrls?: string[];
    sourceAuthor?: string;
    caption?: string;
    status?: "active" | "needsTopic";
  },
): Promise<CustomerWatchlist> {
  const name = sanitizeName(input.name);
  const branch = isDownstreamBranch(input.downstreamBranch) ? input.downstreamBranch : "其他";
  const sourceKind: WatchlistSourceKind =
    input.sourceKind === "videoChannel" || input.sourceKind === "mp" || input.sourceKind === "manual"
      ? input.sourceKind
      : "manual";
  const sourceUrls = Array.isArray(input.sourceUrls)
    ? input.sourceUrls.filter((s): s is string => typeof s === "string")
    : [];

  const existing = await getCustomerWatchlist(workspaceSlug);
  // naive dedupe on normalized name to avoid duplicate watch rows
  const norm = name.trim().toLowerCase();
  const dup = existing.find((e) => e.name.trim().toLowerCase() === norm);
  const now = Date.now();
  if (dup) {
    const merged: CustomerWatchEntry = {
      ...dup,
      name,
      aliases: Array.from(new Set([...dup.aliases, ...sanitizeAliases(input.aliases)])),
      downstreamBranch: branch,
      sourceUrls: Array.from(new Set([...dup.sourceUrls, ...sourceUrls])),
      updatedAt: now,
    };
    if (input.sourceAuthor) merged.sourceAuthor = input.sourceAuthor;
    if (input.caption && !merged.caption) merged.caption = input.caption;
    const next = existing.map((e) => (e.id === dup.id ? merged : e));
    await workspaceConfigService.setWorkspaceConfigValue(workspaceSlug, CUSTOMER_WATCHLIST_CONFIG_KEY, next);
    return next;
  }

  const entry: CustomerWatchEntry = {
    id: `c-${now.toString(36)}-${Math.random().toString(36).slice(2, 6)}`,
    companyKey: slugifyCompanyKey(name),
    name,
    aliases: sanitizeAliases(input.aliases),
    downstreamBranch: branch,
    sourceKind,
    sourceUrls,
    ...(input.sourceAuthor ? { sourceAuthor: input.sourceAuthor } : {}),
    ...(input.caption ? { caption: input.caption } : {}),
    status: input.status === "needsTopic" ? "needsTopic" : "active",
    createdAt: now,
    updatedAt: now,
  };
  const next: CustomerWatchlist = [...existing, entry];
  await workspaceConfigService.setWorkspaceConfigValue(workspaceSlug, CUSTOMER_WATCHLIST_CONFIG_KEY, next);
  return next;
}

export async function removeCustomerWatchEntry(
  workspaceSlug: string,
  id: string,
): Promise<CustomerWatchlist> {
  const existing = await getCustomerWatchlist(workspaceSlug);
  const next = existing.filter((e) => e.id !== id);
  if (next.length === existing.length) {
    throw new CustomerWatchlistValidationError("未找到该客户");
  }
  await workspaceConfigService.setWorkspaceConfigValue(workspaceSlug, CUSTOMER_WATCHLIST_CONFIG_KEY, next);
  return next;
}

const MP_BROWSER_UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36";
const MP_FETCH_TIMEOUT_MS = 12000;

type MpDetectedMeta = { name?: string; author?: string; caption?: string };

/**
 * Best-effort 公众号 detection from a public mp article page.
 *
 * WeChat mp pages are JS-heavy + anti-bot, but public share pages expose the
 * account display name (`id="js_name"` banner) and the article title (`og:title`)
 * as raw HTML that a plain GET can read — no in-BFF WeChat "scrape" product,
 * just reading the article's own open-graph meta the browser already has.
 *
 * Prefer `js_name` (the account the boss pastes from) as the watch name, then
 * `og:article:author` (editorial attribution). Any failure — bot-challenge,
 * deleted/blocked, timeout, non-200 — returns {} so the caller falls back to
 * manual entry (never blocks the flow).
 */
async function detectMpArticleMeta(url: string): Promise<MpDetectedMeta> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), MP_FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      headers: { "User-Agent": MP_BROWSER_UA, "Accept-Language": "zh-CN,zh;q=0.9" },
      redirect: "follow",
      signal: controller.signal,
    });
    if (!res.ok) return {};
    const html = await res.text();
    const jsName = /id="js_name"[^>]*>([^<]{1,60})</.exec(html)?.[1]?.trim() ?? "";
    const ogAuthor =
      /<meta[^>]+property="og:article:author"[^>]+content="([^"]*)"/.exec(html)?.[1]?.trim() ?? "";
    const ogTitle =
      /<meta[^>]+property="og:title"[^>]+content="([^"]*)"/.exec(html)?.[1]?.trim() ?? "";
    const name = (jsName || ogAuthor).trim();
    return {
      ...(name ? { name } : {}),
      ...(ogAuthor ? { author: ogAuthor } : {}),
      ...(ogTitle ? { caption: ogTitle } : {}),
    };
  } catch {
    // blocked / bot-challenge / timeout / deleted → no metadata (manual entry)
    return {};
  } finally {
    clearTimeout(timer);
  }
}

export type IdentifyResult = {
  kind: "videoChannel" | "mp" | "manual";
  name: string | null;
  author?: string;
  caption?: string;
  url: string;
  needsTopic: boolean;
  shareId?: string;
  articleId?: string;
};

/**
 * Given a single pasted WeChat link, identify the underlying customer/topic.
 * - Channels (weixin.qq.com/sph/...) → resolve the live preview → author (company) + caption.
 * - mp (mp.weixin.qq.com) → validation-only (anti-bot; no fetch) → needsTopic=true, name null.
 * Unknown/malformed → name null, needsTopic=true.
 */
export async function identifyFromLink(urlStr: string): Promise<IdentifyResult> {
  const url = urlStr.trim();
  let hostname = "";
  try {
    hostname = new URL(url).hostname.toLowerCase().replace(/\.$/, "");
  } catch {
    // fall through to manual
  }

  if (hostname === "weixin.qq.com" || hostname === "channels.weixin.qq.com") {
    try {
      const classified = classifyChannelsUrl(url);
      const post = await resolveChannelsPreview(classified.canonicalUrl);
      return {
        kind: "videoChannel",
        name: post.author || null,
        author: post.author || undefined,
        caption: post.caption || undefined,
        url: post.url,
        shareId: post.shareId,
        needsTopic: !post.author,
      };
    } catch {
      // blocked / no metadata → manual supplement
      let shareId: string | undefined;
      try {
        shareId = classifyChannelsUrl(url).shareId;
      } catch {
        /* ignore */
      }
      return {
        kind: "videoChannel",
        name: null,
        url,
        ...(shareId ? { shareId } : {}),
        needsTopic: true,
      };
    }
  }

  if (hostname === "mp.weixin.qq.com") {
    try {
      const parsed = classifyMpArticleUrl(url);
      // Best-effort account/topic detection from the article page's own meta.
      // Fall back to a manual-supplement stub on any fetch/parse/bot-block failure.
      const meta = await detectMpArticleMeta(parsed.url);
      if (meta.name) {
        return {
          kind: "mp",
          name: meta.name,
          ...(meta.author ? { author: meta.author } : {}),
          ...(meta.caption ? { caption: meta.caption } : {}),
          url: parsed.url,
          ...(parsed.articleId ? { articleId: parsed.articleId } : {}),
          needsTopic: false,
        };
      }
      return {
        kind: "mp",
        name: null,
        url: parsed.url,
        ...(parsed.articleId ? { articleId: parsed.articleId } : {}),
        needsTopic: true,
      };
    } catch (error) {
      if (error instanceof MpArticleUrlError) {
        throw new CustomerWatchlistValidationError(error.message);
      }
      throw error;
    }
  }

  return { kind: "manual", name: null, url, needsTopic: true };
}
