import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { api } from "../convex/_generated/api.js";
import { createTest } from "./test-helpers.js";

const WRITE_SECRET = "test-secret";

describe("candidate_status write authorization", () => {
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

  it("rejects candidate status upsert without the server write secret", async () => {
    const t = createTest();

    await expect(
      t.mutation(api.candidate_status.upsert, {
        workspaceSlug: "hr",
        identityKey: "candidate-1",
        status: "new",
      }),
    ).rejects.toThrow("Unauthorized Convex write");

    await expect(
      t.mutation(api.candidate_status.upsert, {
        workspaceSlug: "hr",
        identityKey: "candidate-1",
        status: "new",
        writeSecret: "wrong-secret",
      }),
    ).rejects.toThrow("Unauthorized Convex write");
  });

  it("allows candidate status upsert with the server write secret", async () => {
    const t = createTest();

    const id = await t.mutation(api.candidate_status.upsert, {
      workspaceSlug: "hr",
      identityKey: "candidate-1",
      status: "contacted",
      updatedBy: "api-user",
      writeSecret: WRITE_SECRET,
    });

    expect(id).toBeDefined();
    const status = await t.query(api.candidate_status.getByIdentity, {
      workspaceSlug: "hr",
      identityKey: "candidate-1",
    });
    expect(status?.updatedBy).toBe("api-user");
  });
});
