/**
 * Epoch-6 preview remasure pressure gate (local decision only).
 * Does not SSH, remasure, drain, or upgrade.
 *
 * Recorded 2026-09-14: remasure only when MemAvailable ≥ 2.5 GiB and
 * preview Convex memory is strictly under 75%.
 */
export const PREVIEW_REMAASURE_MIN_MEM_AVAILABLE_GIB = 2.5;
export const PREVIEW_REMAASURE_MAX_CONVEX_PCT = 75;

export type PreviewRemasurePressure = {
  memAvailableGiB: unknown;
  convexMemPct: unknown;
};

export type PreviewRemasureDecision = {
  ok: boolean;
  reasons: string[];
};

function finiteNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

export function decidePreviewRemasurePressure(
  input: PreviewRemasurePressure,
): PreviewRemasureDecision {
  const reasons: string[] = [];
  const mem = finiteNumber(input.memAvailableGiB);
  const convex = finiteNumber(input.convexMemPct);

  if (mem === null || mem < PREVIEW_REMAASURE_MIN_MEM_AVAILABLE_GIB) {
    reasons.push(
      `MemAvailable ${mem === null ? "unmeasured" : `${mem} GiB`} < ${PREVIEW_REMAASURE_MIN_MEM_AVAILABLE_GIB} GiB`,
    );
  }
  if (convex === null || convex >= PREVIEW_REMAASURE_MAX_CONVEX_PCT) {
    reasons.push(
      `Convex ${convex === null ? "unmeasured" : `${convex}%`} >= ${PREVIEW_REMAASURE_MAX_CONVEX_PCT}%`,
    );
  }

  return { ok: reasons.length === 0, reasons };
}
