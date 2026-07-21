/**
 * Integration tests for research_ops — ingest + parity run persistence.
 */
import { createTest } from "./test-helpers.js";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { api } from "../convex/_generated/api.js";

const WRITE_SECRET = "test-secret";
const originalWriteSecret = process.env.CONVEX_WRITE_SECRET;

beforeEach(() => {
  process.env.CONVEX_WRITE_SECRET = WRITE_SECRET;
});

afterEach(() => {
  if (originalWriteSecret === undefined) {
    delete process.env.CONVEX_WRITE_SECRET;
    return;
  }
  process.env.CONVEX_WRITE_SECRET = originalWriteSecret;
});

describe("research_ops (convex-test)", () => {
  it("starts and finishes an ingest run with counters", async () => {
    const t = createTest();
    const runId = "run-1";
    const started = await t.mutation(api.research_ops.startIngestRun, {
      writeSecret: WRITE_SECRET,
      runId,
      startedAt: 1000,
      enabledPlatforms: ["weibo", "rss"],
    });
    expect(started.created).toBe(true);

    await t.mutation(api.research_ops.finishIngestRun, {
      writeSecret: WRITE_SECRET,
      runId,
      finishedAt: 2000,
      status: "success",
      newsInserted: 3,
      newsUpdated: 1,
      signalsInserted: 2,
      unresolvedMentions: 5,
    });

    const row = await t.query(api.research_ops.getIngestRun, {
      writeSecret: WRITE_SECRET,
      runId,
    });
    expect(row).toMatchObject({
      runId,
      status: "success",
      newsInserted: 3,
      newsUpdated: 1,
      signalsInserted: 2,
      unresolvedMentions: 5,
      finishedAt: 2000,
      enabledPlatforms: ["weibo", "rss"],
    });
  });

  it("records parity runs and tracks greenStreak", async () => {
    const t = createTest();
    const base = {
      writeSecret: WRITE_SECRET,
      windowStart: 0,
      windowEnd: 1000,
      enabledPlatforms: ["weibo"],
      nativeTotal: 10,
      shadowTotal: 10,
      aggregateRatio: 0.9,
      platformBreakdown: [
        {
          platform: "weibo",
          nativeCount: 10,
          shadowCount: 10,
          ratio: 1,
          zeroWithShadow: false,
        },
      ],
      goldenCompanyResults: [
        { companyKey: "pro-technic-machinery", signalCount: 2, pass: true },
      ],
      nativeNonEmpty: true,
      green: true,
    };

    const first = await t.mutation(api.research_ops.recordParityRun, {
      ...base,
      parityRunId: "p1",
      evaluatedAt: 1000,
    });
    expect(first.greenStreak).toBe(1);

    const second = await t.mutation(api.research_ops.recordParityRun, {
      ...base,
      parityRunId: "p2",
      evaluatedAt: 2000,
    });
    expect(second.greenStreak).toBe(2);

    const fail = await t.mutation(api.research_ops.recordParityRun, {
      ...base,
      parityRunId: "p3",
      evaluatedAt: 3000,
      green: false,
      aggregateRatio: 0.5,
    });
    expect(fail.greenStreak).toBe(0);

    const recover = await t.mutation(api.research_ops.recordParityRun, {
      ...base,
      parityRunId: "p4",
      evaluatedAt: 4000,
    });
    expect(recover.greenStreak).toBe(1);

    const latest = await t.query(api.research_ops.latestParity, {
      writeSecret: WRITE_SECRET,
    });
    expect(latest?.parityRunId).toBe("p4");
    expect(latest?.greenStreak).toBe(1);
    expect(latest?.green).toBe(true);
  });

  it("does not inflate greenStreak when the same parityRunId is re-upserted", async () => {
    const t = createTest();
    const base = {
      writeSecret: WRITE_SECRET,
      windowStart: 0,
      windowEnd: 1000,
      enabledPlatforms: ["weibo"],
      nativeTotal: 10,
      shadowTotal: 10,
      aggregateRatio: 0.9,
      platformBreakdown: [
        {
          platform: "weibo",
          nativeCount: 10,
          shadowCount: 10,
          ratio: 1,
          zeroWithShadow: false,
        },
      ],
      goldenCompanyResults: [
        { companyKey: "pro-technic-machinery", signalCount: 2, pass: true },
      ],
      nativeNonEmpty: true,
      green: true,
    };

    const first = await t.mutation(api.research_ops.recordParityRun, {
      ...base,
      parityRunId: "same-id",
      evaluatedAt: 1000,
    });
    expect(first.created).toBe(true);
    expect(first.greenStreak).toBe(1);

    // Re-upsert same parityRunId must not treat itself as predecessor (1→2→…)
    const again = await t.mutation(api.research_ops.recordParityRun, {
      ...base,
      parityRunId: "same-id",
      evaluatedAt: 1500,
    });
    expect(again.created).toBe(false);
    expect(again.greenStreak).toBe(1);

    const third = await t.mutation(api.research_ops.recordParityRun, {
      ...base,
      parityRunId: "same-id",
      evaluatedAt: 2000,
    });
    expect(third.greenStreak).toBe(1);

    const latest = await t.query(api.research_ops.latestParity, {
      writeSecret: WRITE_SECRET,
    });
    expect(latest?.parityRunId).toBe("same-id");
    expect(latest?.greenStreak).toBe(1);

    // A new id after a prior green still advances from that stored streak once
    const next = await t.mutation(api.research_ops.recordParityRun, {
      ...base,
      parityRunId: "next-id",
      evaluatedAt: 3000,
    });
    expect(next.greenStreak).toBe(2);
  });
});
