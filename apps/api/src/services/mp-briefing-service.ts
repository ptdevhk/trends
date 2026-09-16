import type { MpArticleUrl } from "./mp-article-classifier.js";
import {
  classifyMpArticleUrl,
  MpArticleUrlError,
} from "./mp-article-classifier.js";

/**
 * Build a briefing card for pasted public WeChat official-account (mp) articles.
 *
 * The card carries the URL plus any metadata extracted without a WeChat scrape:
 * - articleId / account id parsed from the URL when present
 * - the mp path so the desk can label the source as 公众号
 *
 * We intentionally do NOT fetch mp.weixin.qq.com/s/... HTML here. Those pages are
 * heavily obfuscated JS + anti-bot and there is no reliable structured metadata
 * to extract with a plain GET; fetching them would drift toward an in-BFF WeChat
 * scrape (out of scope for the intake plan). Metadata enrichment is left to the
 * operator / WeRSS sidecar (Phase B). A blocked/paywalled/deleted URL simply
 * yields a card with the URL; the BFF never probes Channels for it.
 *
 * Failure modes are validation-only: classifyMpArticleUrl throws MpArticleUrlError
 * for malformed URLs → callers map that to a 400 envelope (never 502/503, and never
 * a Channels probe).
 */

export class MpBriefingValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "MpBriefingValidationError";
  }
}

const MIN_URLS = 1;
const MAX_URLS = 8;

export type MpBriefingCard = {
  url: string;
  articleId?: string;
  kind: "mp";
};

export type MpBriefingResult = {
  generatedAt: string;
  cards: MpBriefingCard[];
};

export async function buildMpBriefing(urls: unknown): Promise<MpBriefingResult> {
  if (!Array.isArray(urls)) {
    throw new MpBriefingValidationError("urls must contain 1 to 8 items");
  }
  if (urls.length < MIN_URLS || urls.length > MAX_URLS) {
    throw new MpBriefingValidationError("urls must contain 1 to 8 items");
  }

  const cards: MpBriefingCard[] = [];
  for (const item of urls) {
    if (typeof item !== "string" || !item.trim()) {
      throw new MpBriefingValidationError("each url must be a non-empty string");
    }
    let parsed: MpArticleUrl;
    try {
      parsed = classifyMpArticleUrl(item);
    } catch (error) {
      if (error instanceof MpArticleUrlError) {
        throw new MpBriefingValidationError(error.message);
      }
      throw error;
    }
    cards.push({
      url: parsed.url,
      ...(parsed.articleId ? { articleId: parsed.articleId } : {}),
      kind: "mp" as const,
    });
  }

  return {
    generatedAt: new Date().toISOString(),
    cards,
  };
}
