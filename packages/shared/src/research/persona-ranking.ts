/**
 * Shared persona ranking for Research Eng signals.
 * Personas re-rank/filter shared storage — they do not fork it.
 *
 * hr:    hiring_signal > market_move > company_mention > sales_trigger
 * sales: sales_trigger > market_move > company_mention > hiring_signal
 */

export type ResearchPersona = "hr" | "sales";

export type ResearchSignalKind =
  | "company_mention"
  | "hiring_signal"
  | "market_move"
  | "sales_trigger";

export type ResearchSignalLike = {
  kind: string;
  capturedAt?: number;
  score?: number | null;
  title?: string;
  [key: string]: unknown;
};

const HR_KIND_ORDER: Record<string, number> = {
  hiring_signal: 0,
  market_move: 1,
  company_mention: 2,
  sales_trigger: 3,
};

const SALES_KIND_ORDER: Record<string, number> = {
  sales_trigger: 0,
  market_move: 1,
  company_mention: 2,
  hiring_signal: 3,
};

export function normalizeResearchPersona(value: string | null | undefined): ResearchPersona {
  const normalized = (value ?? "").trim().toLowerCase();
  return normalized === "sales" ? "sales" : "hr";
}

export function kindRankForPersona(kind: string, persona: ResearchPersona): number {
  const table = persona === "sales" ? SALES_KIND_ORDER : HR_KIND_ORDER;
  return table[kind] ?? 99;
}

/**
 * Re-rank signals for a persona without mutating the input array.
 * Primary: kind priority for persona; secondary: higher score; tertiary: newer capturedAt.
 */
export function rankSignalsForPersona<T extends ResearchSignalLike>(
  signals: readonly T[],
  persona: ResearchPersona | string,
): T[] {
  const p = normalizeResearchPersona(typeof persona === "string" ? persona : persona);
  return [...signals].sort((a, b) => {
    const kindDelta = kindRankForPersona(a.kind, p) - kindRankForPersona(b.kind, p);
    if (kindDelta !== 0) {
      return kindDelta;
    }
    const scoreA = typeof a.score === "number" ? a.score : 0;
    const scoreB = typeof b.score === "number" ? b.score : 0;
    if (scoreA !== scoreB) {
      return scoreB - scoreA;
    }
    const capturedA = typeof a.capturedAt === "number" ? a.capturedAt : 0;
    const capturedB = typeof b.capturedAt === "number" ? b.capturedAt : 0;
    return capturedB - capturedA;
  });
}
