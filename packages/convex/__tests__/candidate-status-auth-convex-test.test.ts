import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { api } from "../convex/_generated/api.js";
import { createTest, seedResume } from "./test-helpers.js";

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

  it.each(["importNotesBatch", "restoreBatch"] as const)(
    "rejects candidate status %s without the server write secret",
    async (mutationName) => {
      const t = createTest();
      const args = mutationName === "importNotesBatch"
        ? {
            workspaceSlug: "hr",
            items: [{ resumeId: "resume-id", comments: "note" }],
            updatedBy: "api-user",
          }
        : {
            workspaceSlug: "hr",
            allowOrphan: true,
            items: [{
              identityKey: "candidate-1",
              status: "new" as const,
              updatedAt: 1_700_000_000_000,
              history: [],
            }],
          };

      await expect(
        t.mutation(api.candidate_status[mutationName], args),
      ).rejects.toThrow("Unauthorized Convex write");
      await expect(
        t.mutation(api.candidate_status[mutationName], {
          ...args,
          writeSecret: "wrong-secret",
        }),
      ).rejects.toThrow("Unauthorized Convex write");
    },
  );

  it.each(["listPage", "getByIdentities"] as const)(
    "rejects candidate status %s without the server read secret",
    async (queryName) => {
      const t = createTest();
      const args = queryName === "listPage"
        ? { workspaceSlug: "hr", paginationOpts: { cursor: null, numItems: 100 } }
        : { workspaceSlug: "hr", identityKeys: ["candidate-1"] };

      await expect(
        t.query(api.candidate_status[queryName], args),
      ).rejects.toThrow("Unauthorized Convex read");
      await expect(
        t.query(api.candidate_status[queryName], {
          ...args,
          writeSecret: "wrong-secret",
        }),
      ).rejects.toThrow("Unauthorized Convex read");
    },
  );
});

describe("candidate_status.clearWorkspace", () => {
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

  it("rejects clearWorkspace without the server write secret", async () => {
    const t = createTest();

    await expect(
      t.mutation(api.candidate_status.clearWorkspace, {
        workspaceSlug: "hr",
      }),
    ).rejects.toThrow("Unauthorized Convex write");

    await expect(
      t.mutation(api.candidate_status.clearWorkspace, {
        workspaceSlug: "hr",
        writeSecret: "wrong-secret",
      }),
    ).rejects.toThrow("Unauthorized Convex write");
  });

  it("clears candidate_status rows for the target workspace only", async () => {
    const t = createTest();

    await t.mutation(api.candidate_status.upsert, {
      workspaceSlug: "hr",
      identityKey: "candidate-hr-1",
      status: "shortlisted",
      updatedBy: "api-user",
      writeSecret: WRITE_SECRET,
    });
    await t.mutation(api.candidate_status.upsert, {
      workspaceSlug: "dev",
      identityKey: "candidate-dev-1",
      status: "shortlisted",
      updatedBy: "api-user",
      writeSecret: WRITE_SECRET,
    });

    const result = await t.mutation(api.candidate_status.clearWorkspace, {
      workspaceSlug: "hr",
      writeSecret: WRITE_SECRET,
    });

    expect(result.clearedStatuses).toBe(1);

    const hrRemaining = await t.query(api.candidate_status.list, {
      workspaceSlug: "hr",
    });
    const devRemaining = await t.query(api.candidate_status.list, {
      workspaceSlug: "dev",
    });
    expect(hrRemaining).toHaveLength(0);
    expect(devRemaining).toHaveLength(1);
    expect(devRemaining[0]?.identityKey).toBe("candidate-dev-1");
  });

  it("clears resume_digest_statuses overlay rows for the target workspace only", async () => {
    const t = createTest();

    const hrResumeId = await seedResume(t, {
      externalId: "overlay-hr-resume",
      identityKey: "profileUrl:example.com/candidates/overlay-hr",
    });
    const devResumeId = await seedResume(t, {
      externalId: "overlay-dev-resume",
      identityKey: "profileUrl:example.com/candidates/overlay-dev",
    });

    await t.run(async (ctx) => {
      await ctx.db.insert("resume_digest_statuses", {
        resumeId: hrResumeId,
        identityKey: "overlay-hr-1",
        workspaceSlug: "hr",
        status: "shortlisted",
        updatedAt: Date.now(),
      });
      await ctx.db.insert("resume_digest_statuses", {
        resumeId: devResumeId,
        identityKey: "overlay-dev-1",
        workspaceSlug: "dev",
        status: "shortlisted",
        updatedAt: Date.now(),
      });
    });

    const result = await t.mutation(api.candidate_status.clearWorkspace, {
      workspaceSlug: "hr",
      writeSecret: WRITE_SECRET,
    });

    expect(result.clearedOverlayRows).toBe(1);

    const devOverlay = await t.run(async (ctx) =>
      ctx.db
        .query("resume_digest_statuses")
        .withIndex("by_workspace_identity", (q) =>
          q.eq("workspaceSlug", "dev")
        )
        .collect()
    );
    expect(devOverlay).toHaveLength(1);
    expect(devOverlay[0]?.identityKey).toBe("overlay-dev-1");
  });
});
