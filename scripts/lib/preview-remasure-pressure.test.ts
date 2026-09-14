import { describe, expect, it } from "vitest";

import {
  PREVIEW_REMAASURE_MAX_CONVEX_PCT,
  PREVIEW_REMAASURE_MIN_MEM_AVAILABLE_GIB,
  decidePreviewRemasurePressure,
} from "./preview-remasure-pressure.ts";

describe("decidePreviewRemasurePressure", () => {
  it("allows remasure at the MemAvailable floor when Convex is under 75%", () => {
    expect(
      decidePreviewRemasurePressure({
        memAvailableGiB: PREVIEW_REMAASURE_MIN_MEM_AVAILABLE_GIB,
        convexMemPct: PREVIEW_REMAASURE_MAX_CONVEX_PCT - 0.01,
      }),
    ).toEqual({ ok: true, reasons: [] });
  });

  it("skips when MemAvailable is under 2.5 GiB", () => {
    const decision = decidePreviewRemasurePressure({
      memAvailableGiB: 2.49,
      convexMemPct: 70,
    });
    expect(decision.ok).toBe(false);
    expect(decision.reasons).toEqual(["MemAvailable 2.49 GiB < 2.5 GiB"]);
  });

  it("skips when Convex is 75% (not strictly under)", () => {
    const decision = decidePreviewRemasurePressure({
      memAvailableGiB: 3,
      convexMemPct: 75,
    });
    expect(decision.ok).toBe(false);
    expect(decision.reasons).toEqual(["Convex 75% >= 75%"]);
  });

  it("skips when either reading is non-finite (fail closed)", () => {
    expect(
      decidePreviewRemasurePressure({
        memAvailableGiB: Number.NaN,
        convexMemPct: 50,
      }).ok,
    ).toBe(false);
    expect(
      decidePreviewRemasurePressure({
        memAvailableGiB: 4,
        convexMemPct: "73.5",
      }).ok,
    ).toBe(false);
  });
});
