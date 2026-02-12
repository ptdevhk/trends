import { describe, expect, it } from "vitest";

import {
  buildVerificationReport,
  classifyDualCollectionResult,
  countIdentityDistinctHits,
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
    const live: StageResult = {
      status: "FAIL",
      fallbackUsed: false,
      evidence: { mode: "live" },
      error: "live timeout",
    };
    const seeded: StageResult = {
      status: "PASS",
      fallbackUsed: false,
      evidence: { mode: "seeded" },
    };

    const result = classifyDualCollectionResult(live, seeded);
    expect(result.status).toBe("DEGRADED_PASS");
    expect(result.fallbackUsed).toBe(true);
    expect(result.error).toContain("live timeout");
  });

  it("fails when both live and seeded fail", () => {
    const live: StageResult = {
      status: "FAIL",
      fallbackUsed: false,
      evidence: { mode: "live" },
      error: "live failed",
    };
    const seeded: StageResult = {
      status: "FAIL",
      fallbackUsed: false,
      evidence: { mode: "seeded" },
      error: "seed failed",
    };

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

    const parsed: unknown = JSON.parse(toJsonOutput(report));
    if (typeof parsed !== "object" || parsed === null) {
      throw new Error("Expected JSON object output");
    }
    const root = parsed as { [key: string]: unknown };
    const stagesValue = root.stages;
    if (typeof stagesValue !== "object" || stagesValue === null) {
      throw new Error("Expected stages object");
    }
    const stages = stagesValue as { [key: string]: unknown };
    const collectionValue = stages.collection;
    if (typeof collectionValue !== "object" || collectionValue === null) {
      throw new Error("Expected collection stage object");
    }
    const collection = collectionValue as { [key: string]: unknown };

    expect(root.overallStatus).toBe("DEGRADED_PASS");
    expect(root.mode).toBe("dual");
    expect(root.keyword).toBe("CNC");
    expect(root.location).toBe("广东");
    expect(root.durationMs).toBe(10_000);
    expect(collection.status).toBe("DEGRADED_PASS");
    expect(collection.fallbackUsed).toBe(true);
  });
});

describe("verify-critical-path search evidence helpers", () => {
  it("computes identity-distinct counts with identityKey/externalId fallback", () => {
    const count = countIdentityDistinctHits([
      { _id: "resume:1", identityKey: "profileUrl:a", externalId: "ext-a" },
      { _id: "resume:2", identityKey: "profileUrl:a", externalId: "ext-b" },
      { _id: "resume:3", externalId: "EXT-C" },
      { _id: "resume:4", externalId: "ext-c" },
    ]);

    expect(count).toBe(2);
  });

  it("keeps new search evidence fields in JSON output", () => {
    const report = buildVerificationReport({
      mode: "dual",
      keyword: "CNC",
      location: "广东",
      convexUrl: "http://127.0.0.1:3210",
      startedAt: "2026-02-12T00:00:00.000Z",
      finishedAt: "2026-02-12T00:00:01.000Z",
      stages: {
        collection: stage("PASS"),
        search: {
          status: "PASS",
          fallbackUsed: false,
          evidence: {
            rawHitCount: 5,
            identityDistinctHitCount: 3,
            sentinelNoHitCount: 0,
          },
        },
        analysis: stage("PASS"),
      },
    });

    const parsed: unknown = JSON.parse(toJsonOutput(report));
    if (typeof parsed !== "object" || parsed === null) {
      throw new Error("Expected JSON object output");
    }
    const root = parsed as { [key: string]: unknown };
    const stagesValue = root.stages;
    if (typeof stagesValue !== "object" || stagesValue === null) {
      throw new Error("Expected stages object");
    }
    const stages = stagesValue as { [key: string]: unknown };
    const searchValue = stages.search;
    if (typeof searchValue !== "object" || searchValue === null) {
      throw new Error("Expected search stage object");
    }
    const search = searchValue as { [key: string]: unknown };
    const evidenceValue = search.evidence;
    if (typeof evidenceValue !== "object" || evidenceValue === null) {
      throw new Error("Expected search evidence object");
    }
    const evidence = evidenceValue as { [key: string]: unknown };

    expect(evidence.rawHitCount).toBe(5);
    expect(evidence.identityDistinctHitCount).toBe(3);
    expect(evidence.sentinelNoHitCount).toBe(0);
  });
});
