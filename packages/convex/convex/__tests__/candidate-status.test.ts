import { describe, expect, it } from "vitest";

import { upsert, list, getByIdentity, listForBackup } from "../candidate_status";

type ConvexHandler<TArgs, TResult> = {
  _handler: (ctx: unknown, args: TArgs) => Promise<TResult>;
};

const upsertHandler = (upsert as unknown as ConvexHandler<
  {
    workspaceSlug?: string;
    identityKey: string;
    status: string;
    notes?: string;
    updatedBy?: string;
  },
  string
>)._handler;

const listHandler = (list as unknown as ConvexHandler<
  { workspaceSlug?: string },
  unknown[]
>)._handler;

const listForBackupHandler = (listForBackup as unknown as ConvexHandler<
  { workspaceSlug?: string },
  unknown[]
>)._handler;

const getByIdentityHandler = (getByIdentity as unknown as ConvexHandler<
  { workspaceSlug?: string; identityKey: string },
  unknown | null
>)._handler;

/**
 * Builds a mock Convex db that supports chained .eq() index queries.
 * Captures all eq pairs, then filters the in-memory record store.
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
        if (tableName === "candidate_status") {
          return {
            withIndex(
              indexName: string,
              apply: (q: { eq: (field: string, value: string) => any }) => any,
            ) {
              const chain = apply(buildEqChain());
              const eqPairs = chain.pairs as Array<{ field: string; value: string }>;

              // Filter records by all eq pairs
              const filtered = records.filter((r) =>
                eqPairs.every((p) => r[p.field] === p.value),
              );

              if (indexName === "by_workspace_status") {
                return {
                  async take(n: number) {
                    return filtered.slice(0, n);
                  },
                };
              }

              if (indexName === "by_workspace_identity") {
                return {
                  async unique() {
                    return filtered.length > 0 ? filtered[0] : null;
                  },
                };
              }

              return {
                async take(n: number) {
                  return filtered.slice(0, n);
                },
                async unique() {
                  return filtered.length > 0 ? filtered[0] : null;
                },
              };
            },
          };
        }
        throw new Error(`Unexpected table query: ${tableName}`);
      },
      async insert(tableName: string, doc: Record<string, any>) {
        const id = `cs-${nextId++}`;
        const record = { _id: id, ...doc };
        records.push(record);
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

describe("candidate_status", () => {
  describe("upsert", () => {
    it("inserts a new candidate status record", async () => {
      const ctx = makeMockCtx();
      const id = await upsertHandler(ctx as never, {
        identityKey: "candidate-1",
        status: "new",
      });
      expect(id).toBeDefined();
      expect(typeof id).toBe("string");
    });

    it("patches existing record when identityKey matches", async () => {
      const ctx = makeMockCtx();
      const id1 = await upsertHandler(ctx as never, {
        workspaceSlug: "default",
        identityKey: "candidate-1",
        status: "new",
      });
      const id2 = await upsertHandler(ctx as never, {
        workspaceSlug: "default",
        identityKey: "candidate-1",
        status: "contacted",
      });
      expect(id2).toBe(id1);
    });

    it("throws when identityKey is empty after trim", async () => {
      const ctx = makeMockCtx();
      await expect(
        upsertHandler(ctx as never, {
          identityKey: "  ",
          status: "new",
        }),
      ).rejects.toThrow("identityKey is required");
    });

    it("uses default workspace when workspaceSlug is undefined", async () => {
      const ctx = makeMockCtx();
      await upsertHandler(ctx as never, {
        identityKey: "candidate-1",
        status: "new",
      });
      const result = await listHandler(ctx as never, {});
      expect(result.length).toBeGreaterThan(0);
    });

    it("uses default workspace when workspaceSlug is empty string", async () => {
      const ctx = makeMockCtx();
      await upsertHandler(ctx as never, {
        workspaceSlug: "",
        identityKey: "candidate-1",
        status: "new",
      });
      const result = await listHandler(ctx as never, {});
      expect(result.length).toBeGreaterThan(0);
    });

    it("appends history entry on status change", async () => {
      const ctx = makeMockCtx();
      await upsertHandler(ctx as never, {
        workspaceSlug: "default",
        identityKey: "candidate-1",
        status: "new",
        notes: "initial",
      });
      await upsertHandler(ctx as never, {
        workspaceSlug: "default",
        identityKey: "candidate-1",
        status: "contacted",
        notes: "reached out",
      });
      const result = await listHandler(ctx as never, { workspaceSlug: "default" });
      expect(result.length).toBe(1);
      const record = result[0] as any;
      expect(record.history).toHaveLength(1);
      expect(record.history[0].status).toBe("new");
    });
  });

  describe("list", () => {
    it("returns empty array when no records", async () => {
      const ctx = makeMockCtx();
      const result = await listHandler(ctx as never, {});
      expect(result).toEqual([]);
    });

    it("returns records for given workspace", async () => {
      const ctx = makeMockCtx();
      await upsertHandler(ctx as never, {
        workspaceSlug: "ws-1",
        identityKey: "c1",
        status: "new",
      });
      await upsertHandler(ctx as never, {
        workspaceSlug: "ws-2",
        identityKey: "c2",
        status: "new",
      });
      const result = await listHandler(ctx as never, { workspaceSlug: "ws-1" });
      expect(result).toHaveLength(1);
    });
  });

  describe("listForBackup", () => {
    it("returns mapped records with selected fields", async () => {
      const ctx = makeMockCtx();
      await upsertHandler(ctx as never, {
        workspaceSlug: "default",
        identityKey: "c1",
        status: "new",
      });
      const result = await listForBackupHandler(ctx as never, { workspaceSlug: "default" });
      expect(result.length).toBeGreaterThan(0);
      const record = result[0] as any;
      expect(record).toHaveProperty("identityKey");
      expect(record).toHaveProperty("status");
    });
  });

  describe("getByIdentity", () => {
    it("returns null for non-existent identity", async () => {
      const ctx = makeMockCtx();
      const result = await getByIdentityHandler(ctx as never, {
        workspaceSlug: "default",
        identityKey: "nonexistent",
      });
      expect(result).toBeNull();
    });

    it("returns record for existing identity", async () => {
      const ctx = makeMockCtx();
      await upsertHandler(ctx as never, {
        workspaceSlug: "default",
        identityKey: "c1",
        status: "new",
      });
      const result = await getByIdentityHandler(ctx as never, {
        workspaceSlug: "default",
        identityKey: "c1",
      });
      expect(result).not.toBeNull();
      expect((result as any).identityKey).toBe("c1");
    });

    it("returns null for empty identityKey", async () => {
      const ctx = makeMockCtx();
      const result = await getByIdentityHandler(ctx as never, {
        workspaceSlug: "default",
        identityKey: "",
      });
      expect(result).toBeNull();
    });
  });
});
