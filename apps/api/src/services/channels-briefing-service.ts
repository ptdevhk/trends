import { assembleChannelsBriefing, type ChannelsBriefing } from "./channels-briefing-assembler.js";
import {
  ChannelsPreviewUpstreamError,
  ChannelsUrlError,
  classifyChannelsUrl,
  resolveChannelsPreview,
} from "./channels-preview-probe.js";

export { ChannelsPreviewUpstreamError };

export class ChannelsBriefingValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ChannelsBriefingValidationError";
  }
}

const MIN_URLS = 1;
const MAX_URLS = 8;

export async function buildChannelsBriefing(urls: unknown): Promise<ChannelsBriefing> {
  if (!Array.isArray(urls)) {
    throw new ChannelsBriefingValidationError("urls must contain 1 to 8 items");
  }
  if (urls.length < MIN_URLS || urls.length > MAX_URLS) {
    throw new ChannelsBriefingValidationError("urls must contain 1 to 8 items");
  }

  const shareUrls: string[] = [];
  for (const item of urls) {
    if (typeof item !== "string" || !item.trim()) {
      throw new ChannelsBriefingValidationError("each url must be a non-empty string");
    }
    shareUrls.push(item.trim());
  }

  try {
    for (const url of shareUrls) {
      classifyChannelsUrl(url);
    }
    const posts = await Promise.all(shareUrls.map((url) => resolveChannelsPreview(url)));
    return assembleChannelsBriefing(posts, { sources: shareUrls });
  } catch (error) {
    if (error instanceof ChannelsUrlError) {
      throw new ChannelsBriefingValidationError(error.message);
    }
    throw error;
  }
}
