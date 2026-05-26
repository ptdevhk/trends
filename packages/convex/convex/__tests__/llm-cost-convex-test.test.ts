/**
 * Integration tests for llm_cost.ts using convex-test.
 *
 * Covers: recordUsage (insert + upsert accumulation), getBudget.
 */
import { createTest } from "./test-helpers.js";
import { describe, expect, it } from "vitest";
import { api, internal } from "../_generated/api.js";


// ---------------------------------------------------------------------------
// recordUsage
// ---------------------------------------------------------------------------

describe("llm_cost: recordUsage", () => {
  it("inserts a new daily cost record", async () => {
    const t = createTest();

    await t.mutation(internal.llm_cost.recordUsage, {
      workspaceId: "ws-cost",
      inputTokens: 1000,
      outputTokens: 500,
    });

    const records = await t.run(async (ctx) =>
      ctx.db.query("llm_cost_tracking").collect(),
    );

    expect(records).toHaveLength(1);
    expect(records[0].inputTokens).toBe(1000);
    expect(records[0].outputTokens).toBe(500);
    expect(records[0].confirmCount).toBe(0);
  });

  it("accumulates tokens on repeated calls", async () => {
    const t = createTest();

    await t.mutation(internal.llm_cost.recordUsage, {
      workspaceId: "ws-acc",
      inputTokens: 1000,
      outputTokens: 500,
      confirmCount: 1,
    });
    await t.mutation(internal.llm_cost.recordUsage, {
      workspaceId: "ws-acc",
      inputTokens: 500,
      outputTokens: 300,
      confirmCount: 2,
    });

    const records = await t.run(async (ctx) =>
      ctx.db.query("llm_cost_tracking").collect(),
    );

    expect(records).toHaveLength(1);
    expect(records[0].inputTokens).toBe(1500);
    expect(records[0].outputTokens).toBe(800);
    expect(records[0].confirmCount).toBe(3);
  });

  it("isolates different workspaces", async () => {
    const t = createTest();

    await t.mutation(internal.llm_cost.recordUsage, {
      workspaceId: "ws-a",
      inputTokens: 100,
      outputTokens: 50,
    });
    await t.mutation(internal.llm_cost.recordUsage, {
      workspaceId: "ws-b",
      inputTokens: 200,
      outputTokens: 100,
    });

    const records = await t.run(async (ctx) =>
      ctx.db.query("llm_cost_tracking").collect(),
    );

    expect(records).toHaveLength(2);
    const wsA = records.find((r) => r.workspaceId === "ws-a");
    const wsB = records.find((r) => r.workspaceId === "ws-b");
    expect(wsA!.inputTokens).toBe(100);
    expect(wsB!.inputTokens).toBe(200);
  });
});

// ---------------------------------------------------------------------------
// getBudget
// ---------------------------------------------------------------------------

describe("llm_cost: getBudget", () => {
  it("returns budget with remaining tokens", async () => {
    const t = createTest();

    // Record some usage
    await t.mutation(internal.llm_cost.recordUsage, {
      workspaceId: "ws-budget",
      inputTokens: 5000,
      outputTokens: 2000,
      confirmCount: 3,
    });

    const budget = await t.query(api.llm_cost.getBudget, {
      workspaceId: "ws-budget",
    });

    expect(budget).toBeDefined();
    expect(typeof budget.remainingTokens).toBe("number");
    expect(typeof budget.remainingConfirms).toBe("number");
    expect(budget.remainingTokens).toBeLessThan(budget.limit);
  });

  it("returns full budget when no usage recorded", async () => {
    const t = createTest();

    const budget = await t.query(api.llm_cost.getBudget, {
      workspaceId: "ws-nousage",
    });

    expect(budget).toBeDefined();
    expect(budget.remainingTokens).toBe(budget.limit);
    expect(budget.remainingConfirms).toBeGreaterThanOrEqual(0);
  });
});
