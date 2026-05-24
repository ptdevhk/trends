import { describe, expect, it } from "vitest";

import { recordUsage, getBudget } from "../llm_cost";
import { getRemainingBudget, todayPeriod } from "../lib/parallelism";

type ConvexHandler<TArgs, TResult> = {
  _handler: (ctx: unknown, args: TArgs) => Promise<TResult>;
};

const recordUsageHandler = (recordUsage as unknown as ConvexHandler<
  {
    workspaceId: string;
    inputTokens: number;
    outputTokens: number;
    confirmCount?: number;
  },
  void
>)._handler;

const getBudgetHandler = (getBudget as unknown as ConvexHandler<
  { workspaceId: string },
  unknown
>)._handler;

/**
 * Builds a mock Convex db that supports chained .eq() index queries.
 */
function makeMockCtx() {
  const records: Array<Record<string, any>> = [];
  let nextId = 1;

  function buildEqChain(pairs: Array<{ field: string; value: string }> = []) {
    return {
      eq(field: string, value: string) {
        return buildEqChain([...pairs, { field, value }]);
      },
      get pairs() {
        return pairs;
      },
    };
  }

  return {
    db: {
      query(tableName: string) {
        if (tableName === "llm_cost_tracking") {
          return {
            withIndex(
              indexName: string,
              apply: (q: { eq: (field: string, value: string) => any }) => any,
            ) {
              const chain = apply(buildEqChain());
              const eqPairs = chain.pairs as Array<{ field: string; value: string }>;

              const filtered = records.filter((r) =>
                eqPairs.every((p) => r[p.field] === p.value),
              );

              return {
                async first() {
                  return filtered.length > 0 ? filtered[0] : null;
                },
              };
            },
          };
        }
        throw new Error(`Unexpected table query: ${tableName}`);
      },
      async insert(tableName: string, doc: Record<string, any>) {
        const id = `lct-${nextId++}`;
        records.push({ _id: id, ...doc });
        return id;
      },
      async patch(id: string, updates: Record<string, any>) {
        const idx = records.findIndex((r) => r._id === id);
        if (idx >= 0) {
          Object.assign(records[idx], updates);
        }
      },
    },
  };
}

describe("llm_cost", () => {
  describe("recordUsage", () => {
    it("inserts a new cost tracking record when none exists", async () => {
      const ctx = makeMockCtx();
      await recordUsageHandler(ctx as never, {
        workspaceId: "ws-1",
        inputTokens: 100,
        outputTokens: 50,
      });
      // Verify via getBudget that something was recorded
      const budget = await getBudgetHandler(ctx as never, { workspaceId: "ws-1" }) as any;
      expect(budget).toBeDefined();
      expect(budget.remainingTokens).toBeLessThan(budget.limit);
    });

    it("patches existing record to accumulate tokens", async () => {
      const ctx = makeMockCtx();
      await recordUsageHandler(ctx as never, {
        workspaceId: "ws-1",
        inputTokens: 100,
        outputTokens: 50,
        confirmCount: 1,
      });
      await recordUsageHandler(ctx as never, {
        workspaceId: "ws-1",
        inputTokens: 200,
        outputTokens: 30,
        confirmCount: 2,
      });
      const budget = await getBudgetHandler(ctx as never, { workspaceId: "ws-1" }) as any;
      // 100 + 200 = 300 tokens used
      expect(budget.remainingTokens).toBe(budget.limit - 300);
    });
  });

  describe("getBudget", () => {
    it("returns full budget when no usage exists", async () => {
      const ctx = makeMockCtx();
      const budget = await getBudgetHandler(ctx as never, { workspaceId: "ws-1" }) as any;
      expect(budget.remainingTokens).toBeGreaterThan(0);
      expect(budget.remainingConfirms).toBeGreaterThan(0);
      expect(budget.period).toBe(todayPeriod());
    });
  });
});

describe("getRemainingBudget (parallelism lib)", () => {
  it("returns full budget when record is null", () => {
    const budget = getRemainingBudget(null);
    expect(budget.remainingTokens).toBeGreaterThan(0);
    expect(budget.remainingConfirms).toBeGreaterThan(0);
  });

  it("deducts used tokens from budget", () => {
    const full = getRemainingBudget(null);
    const budget = getRemainingBudget({ inputTokens: 5000, confirmCount: 3 });
    expect(budget.remainingTokens).toBe(full.limit - 5000);
    expect(budget.remainingTokens).toBeLessThan(full.limit);
  });

  it("clamps remaining tokens to zero when over budget", () => {
    const full = getRemainingBudget(null);
    const budget = getRemainingBudget({
      inputTokens: full.limit + 100000,
      confirmCount: 100000,
    });
    expect(budget.remainingTokens).toBe(0);
    expect(budget.remainingConfirms).toBe(0);
  });
});
