import { describe, expect, it } from "vitest";

import {
  buildVerificationReport,
  classifyDualCollectionResult,
  reduceOverallStatus,
  toJsonOutput,
  type StageResult,
} from "../../../../../scripts/verify-critical-path";

function stage(status: StageResult["status"], fallbackUsed: boolean = false): StageResult {
  return {
    status,
    fallbackUsed,
    evidence: {},
  };
}

describe("verify-critical-path status reduction", () => {
  it("returns PASS when all stages pass", () => {
    expect(reduceOverallStatus([stage("PASS"), stage("PASS"), stage("PASS")])).toBe("PASS");
  });

  it("returns DEGRADED_PASS when any stage is degraded and none fail", () => {
    expect(reduceOverallStatus([stage("PASS"), stage("DEGRADED_PASS"), stage("PASS")])).toBe("DEGRADED_PASS");
  });

  it("returns FAIL when any stage fails", () => {
    expect(reduceOverallStatus([stage("PASS"), stage("FAIL"), stage("DEGRADED_PASS")])).toBe("FAIL");
  });
});

describe("verify-critical-path dual mode fallback", () => {
  it("marks degraded pass when live fails and seeded succeeds", () => {
    const live = {
      status: "FAIL",
      fallbackUsed: false,
      evidence: { mode: "live" },
      error: "live timeout",
    } as StageResult;
    const seeded = {
      status: "PASS",
      fallbackUsed: false,
      evidence: { mode: "seeded" },
    } as StageResult;

    const result = classifyDualCollectionResult(live, seeded);
    expect(result.status).toBe("DEGRADED_PASS");
    expect(result.fallbackUsed).toBe(true);
    expect(result.error).toContain("live timeout");
  });

  it("fails when both live and seeded fail", () => {
    const live = {
      status: "FAIL",
      fallbackUsed: false,
      evidence: { mode: "live" },
      error: "live failed",
    } as StageResult;
    const seeded = {
      status: "FAIL",
      fallbackUsed: false,
      evidence: { mode: "seeded" },
      error: "seed failed",
    } as StageResult;

    const result = classifyDualCollectionResult(live, seeded);
    expect(result.status).toBe("FAIL");
    expect(result.fallbackUsed).toBe(true);
  });
});

describe("verify-critical-path json report schema", () => {
  it("produces stable JSON shape for machine parsing", () => {
    const report = buildVerificationReport({
      mode: "dual",
      keyword: "CNC",
      location: "广东",
      convexUrl: "http://127.0.0.1:3210",
      startedAt: "2026-02-12T00:00:00.000Z",
      finishedAt: "2026-02-12T00:00:10.000Z",
      stages: {
        collection: stage("DEGRADED_PASS", true),
        search: stage("PASS"),
        analysis: stage("PASS"),
      },
    });

    const parsed = JSON.parse(toJsonOutput(report)) as Record<string, unknown>;
    const stages = parsed.stages as Record<string, unknown>;
    const collection = stages.collection as Record<string, unknown>;

    expect(parsed.overallStatus).toBe("DEGRADED_PASS");
    expect(parsed.mode).toBe("dual");
    expect(parsed.keyword).toBe("CNC");
    expect(parsed.location).toBe("广东");
    expect(parsed.durationMs).toBe(10_000);
    expect(collection.status).toBe("DEGRADED_PASS");
    expect(collection.fallbackUsed).toBe(true);
  });
});
