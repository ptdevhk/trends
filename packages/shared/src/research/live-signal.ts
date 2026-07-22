/**
 * Live vs showcase partition for Research Eng signals.
 * Personas re-rank within each partition; live always precedes showcase.
 */

import { rankSignalsForPersona, type ResearchSignalLike } from "./persona-ranking.js";

export type LiveSignalMeta = {
  liveCount: number;
  showcaseCount: number;
  liveFirst: true;
};

export type LiveSignalLike = ResearchSignalLike & {
  evidence?: { platform?: string };
  ingestRunId?: string | null;
};

/**
 * Live row: not showcase platform and not showcase-seed ingest run.
 */
export function isLiveResearchSignal(signal: {
  evidence?: { platform?: string };
  ingestRunId?: string | null;
}): boolean {
  const platform = signal.evidence?.platform ?? "";
  if (platform === "showcase") {
    return false;
  }
  const runId = signal.ingestRunId ?? "";
  if (typeof runId === "string" && runId.startsWith("showcase-seed")) {
    return false;
  }
  return true;
}

/**
 * Partition into live vs showcase, rank each with persona, concatenate live-first.
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
    } else {
      showcase.push(s);
    }
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
