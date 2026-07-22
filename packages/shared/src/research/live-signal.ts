/**
 * Live vs curated-showcase partition for Research Eng signals.
 * Personas re-rank within each partition; live always precedes showcase.
 * Demo/synthetic rows are excluded from product items entirely.
 */

import { rankSignalsForPersona, type ResearchSignalLike } from "./persona-ranking.js";

export type LiveSignalMeta = {
  liveCount: number;
  showcaseCount: number;
  liveFirst: true;
};

export type LiveSignalLike = ResearchSignalLike & {
  evidence?: { platform?: string; url?: string };
  ingestRunId?: string | null;
};

const SYNTHETIC_PLATFORMS = new Set(["showcase", "rss:demo"]);

function isSyntheticHost(url: string | undefined): boolean {
  if (!url) return false;
  try {
    const host = new URL(url).hostname.toLowerCase();
    if (host === "example.com" || host.endsWith(".example.com")) return true;
    if (host === "localhost" || host.endsWith(".local")) return true;
    return false;
  } catch {
    // Unparseable URL is not product-live evidence.
    return true;
  }
}

/**
 * Curated showcase seed rows (may appear under 展示数据).
 */
export function isShowcaseCuratedSignal(signal: {
  evidence?: { platform?: string };
  ingestRunId?: string | null;
}): boolean {
  const platform = (signal.evidence?.platform ?? "").trim();
  if (platform === "showcase") return true;
  const runId = signal.ingestRunId ?? "";
  return typeof runId === "string" && runId.startsWith("showcase-seed");
}

/**
 * Product-live row: real ingest only (not showcase, not demo-seed, not fake hosts).
 */
export function isLiveResearchSignal(signal: {
  evidence?: { platform?: string; url?: string };
  ingestRunId?: string | null;
}): boolean {
  const platform = (signal.evidence?.platform ?? "").trim();
  if (SYNTHETIC_PLATFORMS.has(platform)) {
    return false;
  }
  const runId = signal.ingestRunId ?? "";
  if (typeof runId === "string") {
    if (runId === "demo-seed" || runId.startsWith("demo-")) return false;
    if (runId.startsWith("showcase-seed")) return false;
  }
  if (isSyntheticHost(signal.evidence?.url)) {
    return false;
  }
  return true;
}

/**
 * Partition into live vs curated showcase, rank each with persona, concatenate live-first.
 * Demo/synthetic non-showcase rows are dropped from product items.
 */
export function partitionAndRankSignalsForPersona<T extends LiveSignalLike>(
  signals: readonly T[],
  persona: string,
): {
  live: T[];
  showcase: T[];
  items: T[];
  meta: LiveSignalMeta;
} {
  const live: T[] = [];
  const showcase: T[] = [];
  for (const s of signals) {
    if (isLiveResearchSignal(s)) {
      live.push(s);
    } else if (isShowcaseCuratedSignal(s)) {
      showcase.push(s);
    }
    // else: demo-seed / synthetic — omit from product UI
  }
  const rankedLive = rankSignalsForPersona(live, persona);
  const rankedShowcase = rankSignalsForPersona(showcase, persona);
  return {
    live: rankedLive,
    showcase: rankedShowcase,
    items: [...rankedLive, ...rankedShowcase],
    meta: {
      liveCount: rankedLive.length,
      showcaseCount: rankedShowcase.length,
      liveFirst: true,
    },
  };
}
