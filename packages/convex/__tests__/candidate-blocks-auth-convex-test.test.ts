import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { api } from "../convex/_generated/api.js";
import { createTest } from "./test-helpers.js";

const WRITE_SECRET = "test-secret";

describe("candidate_blocks write authorization", () => {
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

  it("rejects block mutations without the server write secret", async () => {
    const t = createTest();

    await expect(
      t.mutation(api.candidate_blocks.upsert, {
        workspaceSlug: "hr",
        identityKey: "candidate-1",
        reason: "duplicate",
      }),
    ).rejects.toThrow("Unauthorized Convex write");

    await expect(
      t.mutation(api.candidate_blocks.bulkUpsert, {
        workspaceSlug: "hr",
        identityKeys: ["candidate-1"],
        reason: "duplicate",
        writeSecret: "wrong-secret",
      }),
    ).rejects.toThrow("Unauthorized Convex write");

    await expect(
      t.mutation(api.candidate_blocks.updateReason, {
        workspaceSlug: "hr",
        identityKey: "candidate-1",
        reason: "new reason",
      }),
    ).rejects.toThrow("Unauthorized Convex write");

    await expect(
      t.mutation(api.candidate_blocks.remove, {
        workspaceSlug: "hr",
        identityKey: "candidate-1",
      }),
    ).rejects.toThrow("Unauthorized Convex write");
  });

  it("allows block mutations with the server write secret", async () => {
    const t = createTest();

    const id = await t.mutation(api.candidate_blocks.upsert, {
      workspaceSlug: "hr",
      identityKey: "candidate-1",
      blockedBy: "api-user",
      writeSecret: WRITE_SECRET,
    });
    expect(id).toBeDefined();

    const bulk = await t.mutation(api.candidate_blocks.bulkUpsert, {
      workspaceSlug: "hr",
      identityKeys: ["candidate-1", "candidate-2"],
      reason: "bulk reason",
      blockedBy: "api-user",
      writeSecret: WRITE_SECRET,
    });
    expect(bulk).toMatchObject({ total: 2, inserted: 1, updated: 1 });

    await expect(
      t.mutation(api.candidate_blocks.updateReason, {
        workspaceSlug: "hr",
        identityKey: "candidate-2",
        reason: "updated reason",
        writeSecret: WRITE_SECRET,
      }),
    ).resolves.toBe(true);

    await expect(
      t.mutation(api.candidate_blocks.remove, {
        workspaceSlug: "hr",
        identityKey: "candidate-1",
        writeSecret: WRITE_SECRET,
      }),
    ).resolves.toBe(true);
  });
});
