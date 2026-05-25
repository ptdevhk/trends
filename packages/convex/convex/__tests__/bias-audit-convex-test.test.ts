/**
 * Integration tests using convex-test for bias_audit.ts.
 *
 * Covers: computeBiasMetrics, computeBiasMetricsForAllWorkspaces,
 * storeBiasReport, getLatestBiasReport, queryAuditLogs.
 *
 * Unit tests for bias_metrics.ts live in audit-convex-test.test.ts.
 */
import { convexTest } from "convex-test";
import { describe, expect, it } from "vitest";
import { api } from "../_generated/api.js";
import { internal } from "../_generated/api.js";
import schema from "../schema.js";
import { ageToBracket, fnvHash } from "../lib/bias_metrics.js";

const modules = (import.meta as any).glob("../**/*.ts", { eager: false });

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

interface BiasMetricsOk {
  status: "ok";
  workspaceSlug: string;
  decisionType: string;
  scoreThreshold: number;
  totalAuditRecords: number;
  groupCount: number;
  demographicParity: {
    disparityRatio: number;
    maxDifference: number;
    passing: boolean;
    groupRates: Array<{ groupKey: string; rate: number }>;
  };
  disparateImpact: Array<{ groupKey: string; ratio: number; referenceGroupKey: string }>;
  overrideRate: {
    tprDifference: number;
    fprDifference: number;
    passing: boolean;
  };
  scoreDrift: {
    psi: number;
    driftDetected: boolean;
  };
  anomalyFlags: {
    statisticalParityViolation: boolean;
    disparateImpactViolation: boolean;
    scoreDriftDetected: boolean;
  };
  computedAt: number;
}

interface BiasMetricsInsufficient {
  status: "insufficient_data";
  count: number;
  minimumRequired: number;
  message: string;
}

type BiasMetricsResult = BiasMetricsOk | BiasMetricsInsufficient;

function asOk(result: BiasMetricsResult): BiasMetricsOk {
  expect(result.status).toBe("ok");
  return result as BiasMetricsOk;
}

function asInsufficient(result: BiasMetricsResult): BiasMetricsInsufficient {
  expect(result.status).toBe("insufficient_data");
  return result as BiasMetricsInsufficient;
}

/** Insert a minimal resume and return its ID. */
async function insertResume(t: ReturnType<typeof convexTest>) {
  return t.run(async (ctx) => {
    return ctx.db.insert("resumes", {
      externalId: `r-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      content: {},
      hash: `h-${Math.random().toString(36).slice(2, 8)}`,
      tags: [],
      crawledAt: Date.now(),
      source: "test",
    });
  });
}

/** Insert an audit log entry for bias testing. */
async function insertAuditLog(
  t: ReturnType<typeof convexTest>,
  opts: {
    workspaceSlug: string;
    decisionType?: "score" | "tag" | "rank" | "filter" | "confirm";
    score?: number;
    outcome?: "pending" | "accepted" | "overridden" | "appealed";
    ageBracket?: string;
  },
) {
  const resumeId = await insertResume(t);
  const now = Date.now();
  const ageHash = opts.ageBracket ? fnvHash(opts.ageBracket) : undefined;

  await t.run(async (ctx) => {
    await ctx.db.insert("analysis_audit_log", {
      resumeId,
      workspaceSlug: opts.workspaceSlug,
      decisionType: opts.decisionType ?? "score",
      actionRef: "analyze:analyzeResume",
      inputSnapshot: {},
      modelMeta: { model: "gpt-4", provider: "openai" },
      output: { score: opts.score },
      protectedAttributeHashes: ageHash ? { ageBracketHash: ageHash } : undefined,
      outcome: opts.outcome ?? "pending",
      decidedAt: now,
      expiresAt: now + 2 * 365 * 24 * 60 * 60 * 1000,
    });
  });
}

// ---------------------------------------------------------------------------
// queryAuditLogs
// ---------------------------------------------------------------------------

describe("bias_audit: queryAuditLogs", () => {
  it("returns logs filtered by workspace and decisionType", async () => {
    const t = convexTest(schema, modules);

    await insertAuditLog(t, { workspaceSlug: "ws-a", decisionType: "score", score: 80 });
    await insertAuditLog(t, { workspaceSlug: "ws-a", decisionType: "tag", score: 70 });
    await insertAuditLog(t, { workspaceSlug: "ws-b", decisionType: "score", score: 90 });

    const logs = await t.query(internal.bias_audit.queryAuditLogs, {
      workspaceSlug: "ws-a",
      decisionType: "score",
    });

    expect(logs.length).toBe(1);
    expect(logs[0].workspaceSlug).toBe("ws-a");
    expect(logs[0].decisionType).toBe("score");
  });

  it("returns empty array when no logs match", async () => {
    const t = convexTest(schema, modules);

    const logs = await t.query(internal.bias_audit.queryAuditLogs, {
      workspaceSlug: "ws-empty",
      decisionType: "score",
    });

    expect(logs).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// storeBiasReport + getLatestBiasReport
// ---------------------------------------------------------------------------

describe("bias_audit: storeBiasReport + getLatestBiasReport", () => {
  it("stores a new report and retrieves it", async () => {
    const t = convexTest(schema, modules);

    const report: BiasMetricsOk = {
      status: "ok",
      workspaceSlug: "ws-report",
      decisionType: "score",
      scoreThreshold: 70,
      totalAuditRecords: 50,
      groupCount: 3,
      demographicParity: {
        disparityRatio: 0.85,
        maxDifference: 0.1,
        passing: true,
        groupRates: [
          { groupKey: "25-29", rate: 0.5 },
          { groupKey: "30-34", rate: 0.45 },
        ],
      },
      disparateImpact: [],
      overrideRate: { tprDifference: 0.05, fprDifference: 0.03, passing: true },
      scoreDrift: { psi: 0.05, driftDetected: false },
      anomalyFlags: { statisticalParityViolation: false, disparateImpactViolation: false, scoreDriftDetected: false },
      computedAt: Date.now(),
    };

    await t.mutation(internal.bias_audit.storeBiasReport, {
      workspaceSlug: "ws-report",
      report,
    });

    const retrieved = await t.query(api.bias_audit.getLatestBiasReport, {
      workspaceSlug: "ws-report",
    });

    expect(retrieved).not.toBeNull();
    expect((retrieved as BiasMetricsOk).status).toBe("ok");
    expect((retrieved as BiasMetricsOk).totalAuditRecords).toBe(50);
    expect((retrieved as BiasMetricsOk).demographicParity.passing).toBe(true);
  });

  it("upserts — overwrites an existing report", async () => {
    const t = convexTest(schema, modules);

    const reportV1: BiasMetricsOk = {
      status: "ok",
      workspaceSlug: "ws-upsert",
      decisionType: "score",
      scoreThreshold: 70,
      totalAuditRecords: 30,
      groupCount: 2,
      demographicParity: {
        disparityRatio: 0.9,
        maxDifference: 0.05,
        passing: true,
        groupRates: [],
      },
      disparateImpact: [],
      overrideRate: { tprDifference: 0.02, fprDifference: 0.01, passing: true },
      scoreDrift: { psi: 0.03, driftDetected: false },
      anomalyFlags: { statisticalParityViolation: false, disparateImpactViolation: false, scoreDriftDetected: false },
      computedAt: Date.now(),
    };

    await t.mutation(internal.bias_audit.storeBiasReport, {
      workspaceSlug: "ws-upsert",
      report: reportV1,
    });

    const reportV2: BiasMetricsOk = { ...reportV1, totalAuditRecords: 60, computedAt: Date.now() };
    await t.mutation(internal.bias_audit.storeBiasReport, {
      workspaceSlug: "ws-upsert",
      report: reportV2,
    });

    const retrieved = await t.query(api.bias_audit.getLatestBiasReport, {
      workspaceSlug: "ws-upsert",
    });

    expect((retrieved as BiasMetricsOk).totalAuditRecords).toBe(60);
  });

  it("returns null when no report exists", async () => {
    const t = convexTest(schema, modules);

    const result = await t.query(api.bias_audit.getLatestBiasReport, {
      workspaceSlug: "ws-none",
    });

    expect(result).toBeNull();
  });

  it("rejects a report with invalid shape (typed validator)", async () => {
    const t = convexTest(schema, modules);

    // status must be "ok" — passing a different value should throw
    await expect(
      t.mutation(internal.bias_audit.storeBiasReport, {
        workspaceSlug: "ws-invalid",
        report: {
          status: "bad_status",
          workspaceSlug: "ws-invalid",
          decisionType: "score",
        } as any,
      }),
    ).rejects.toThrow();

    // Missing required fields should also throw
    await expect(
      t.mutation(internal.bias_audit.storeBiasReport, {
        workspaceSlug: "ws-invalid",
        report: {
          status: "ok",
          workspaceSlug: "ws-invalid",
        } as any,
      }),
    ).rejects.toThrow();
  });
});

// ---------------------------------------------------------------------------
// computeBiasMetrics
// ---------------------------------------------------------------------------

describe("bias_audit: computeBiasMetrics", () => {
  it("returns insufficient_data when < 30 audit records", async () => {
    const t = convexTest(schema, modules);

    // Insert 5 records — below the 30 minimum
    for (let i = 0; i < 5; i++) {
      await insertAuditLog(t, {
        workspaceSlug: "ws-small",
        decisionType: "score",
        score: 75,
        ageBracket: ageToBracket(30),
      });
    }

    const result = await t.action(internal.bias_audit.computeBiasMetrics, {
      workspaceSlug: "ws-small",
      decisionType: "score",
    }) as BiasMetricsResult;

    const insuf = asInsufficient(result);
    expect(insuf.count).toBe(5);
    expect(insuf.minimumRequired).toBe(30);
  });

  it("computes bias metrics with sufficient data", async () => {
    const t = convexTest(schema, modules);

    // Insert 40 records across two age groups
    const ageGroup1 = ageToBracket(28); // "25-29"
    const ageGroup2 = ageToBracket(35); // "35-39"

    // Group 1: 20 records, 10 above threshold
    for (let i = 0; i < 20; i++) {
      await insertAuditLog(t, {
        workspaceSlug: "ws-metrics",
        decisionType: "score",
        score: i < 10 ? 80 : 50,
        ageBracket: ageGroup1,
        outcome: i < 10 ? "accepted" : "pending",
      });
    }

    // Group 2: 20 records, 8 above threshold
    for (let i = 0; i < 20; i++) {
      await insertAuditLog(t, {
        workspaceSlug: "ws-metrics",
        decisionType: "score",
        score: i < 8 ? 75 : 45,
        ageBracket: ageGroup2,
        outcome: i < 8 ? "accepted" : "overridden",
      });
    }

    const result = await t.action(internal.bias_audit.computeBiasMetrics, {
      workspaceSlug: "ws-metrics",
      decisionType: "score",
    }) as BiasMetricsResult;

    const ok = asOk(result);
    expect(ok.totalAuditRecords).toBe(40);
    expect(ok.groupCount).toBe(2);
    expect(ok.scoreThreshold).toBe(70); // default
    expect(ok.demographicParity).toBeDefined();
    expect(ok.demographicParity.groupRates.length).toBe(2);
    expect(ok.disparateImpact.length).toBe(1); // one comparison against reference
    expect(ok.overrideRate).toBeDefined();

    // Report should be persisted
    const stored = await t.query(api.bias_audit.getLatestBiasReport, {
      workspaceSlug: "ws-metrics",
    });
    expect(stored).not.toBeNull();
    expect((stored as BiasMetricsOk).totalAuditRecords).toBe(40);
  });

  it("respects custom scoreThreshold", async () => {
    const t = convexTest(schema, modules);

    const ageGroup = ageToBracket(30); // "30-34"

    // 35 records with scores around 60 — all below default threshold (70)
    // but above custom threshold of 50
    for (let i = 0; i < 35; i++) {
      await insertAuditLog(t, {
        workspaceSlug: "ws-threshold",
        decisionType: "score",
        score: 60,
        ageBracket: ageGroup,
      });
    }

    // With default threshold (70), positive rate should be 0
    const resultDefault = await t.action(internal.bias_audit.computeBiasMetrics, {
      workspaceSlug: "ws-threshold",
      decisionType: "score",
    }) as BiasMetricsResult;
    const okDefault = asOk(resultDefault);
    expect(okDefault.demographicParity.groupRates[0].rate).toBe(0);

    // With custom threshold (50), positive rate should be 1.0
    const resultCustom = await t.action(internal.bias_audit.computeBiasMetrics, {
      workspaceSlug: "ws-threshold",
      decisionType: "score",
      scoreThreshold: 50,
    }) as BiasMetricsResult;
    const okCustom = asOk(resultCustom);
    expect(okCustom.scoreThreshold).toBe(50);
    expect(okCustom.demographicParity.groupRates[0].rate).toBe(1);
  });

  it("groups records without ageBracketHash as 'unknown'", async () => {
    const t = convexTest(schema, modules);

    // 20 records with age bracket
    const ageGroup = ageToBracket(28);
    for (let i = 0; i < 20; i++) {
      await insertAuditLog(t, {
        workspaceSlug: "ws-unknown",
        decisionType: "score",
        score: 80,
        ageBracket: ageGroup,
      });
    }

    // 15 records without age bracket (no protectedAttributeHashes)
    for (let i = 0; i < 15; i++) {
      await insertAuditLog(t, {
        workspaceSlug: "ws-unknown",
        decisionType: "score",
        score: 80,
        // no ageBracket → no protectedAttributeHashes in the log
      });
    }

    const result = await t.action(internal.bias_audit.computeBiasMetrics, {
      workspaceSlug: "ws-unknown",
      decisionType: "score",
    }) as BiasMetricsResult;

    const ok = asOk(result);
    expect(ok.groupCount).toBe(2);
    const groupKeys = ok.demographicParity.groupRates.map((g) => g.groupKey);
    expect(groupKeys).toContain("unknown");
  });
});

// ---------------------------------------------------------------------------
// computeBiasMetricsForAllWorkspaces
// ---------------------------------------------------------------------------

describe("bias_audit: computeBiasMetricsForAllWorkspaces", () => {
  it("processes all workspaces and isolates errors", async () => {
    const t = convexTest(schema, modules);

    // Workspace with sufficient data
    const ageGroup = ageToBracket(30);
    for (let i = 0; i < 35; i++) {
      await insertAuditLog(t, {
        workspaceSlug: "ws-good",
        decisionType: "score",
        score: 75,
        ageBracket: ageGroup,
      });
    }

    // Workspace with insufficient data
    for (let i = 0; i < 5; i++) {
      await insertAuditLog(t, {
        workspaceSlug: "ws-small",
        decisionType: "score",
        score: 60,
        ageBracket: ageGroup,
      });
    }

    const results = await t.action(
      internal.bias_audit.computeBiasMetricsForAllWorkspaces,
      {},
    ) as Array<{ workspaceSlug: string; status: string }>;

    // Should have results for both workspaces
    expect(results.length).toBeGreaterThanOrEqual(2);

    const goodResult = results.find((r) => r.workspaceSlug === "ws-good");
    const smallResult = results.find((r) => r.workspaceSlug === "ws-small");

    expect(goodResult).toBeDefined();
    expect(goodResult!.status).toBe("ok");

    expect(smallResult).toBeDefined();
    expect(smallResult!.status).toBe("insufficient_data");
  });

  it("returns empty array when no workspaces have audit logs", async () => {
    const t = convexTest(schema, modules);

    const results = await t.action(
      internal.bias_audit.computeBiasMetricsForAllWorkspaces,
      {},
    ) as Array<{ workspaceSlug: string; status: string }>;

    expect(results).toEqual([]);
  });
});
