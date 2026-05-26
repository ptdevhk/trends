/**
 * Integration tests for ai_tagging_results.ts using convex-test.
 *
 * Covers: enqueueBatch, getSummary, listForCompare, listPending,
 * claimPending, markCompleted, markFailed.
 *
 * Does NOT cover drainQueue (calls LLM API).
 */
import { createTest } from "./test-helpers.js";
import { describe, expect, it } from "vitest";
import { api, internal } from "../convex/_generated/api.js";
import type { Id } from "../convex/_generated/dataModel.js";


/** Insert a minimal resume with ingestData.evidenceText and return its ID. */
async function insertResumeWithEvidence(t: ReturnType<typeof createTest>) {
  return t.run(async (ctx) => {
    return ctx.db.insert("resumes", {
      externalId: `r-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      content: { name: "Test User" },
      hash: `h-${Math.random().toString(36).slice(2, 8)}`,
      tags: [],
      crawledAt: Date.now(),
      source: "test",
      ingestData: {
        evidenceText: "5 years sales experience in machine tool industry",
        industryTags: ["sales"],
        synonymHits: [],
        brandHits: [],
        companyHits: [],
        ruleScores: {},
        experienceLevel: "mid",
        computedAt: Date.now(),
        skillsVersion: 1,
      },
    });
  });
}

/** Insert a tagging result directly for testing. */
async function insertTaggingResult(
  t: ReturnType<typeof createTest>,
  overrides: Record<string, unknown> = {},
) {
  return t.run(async (ctx) => {
    return ctx.db.insert("ai_tagging_results", {
      resumeId: (overrides.resumeId ?? (await ctx.db.insert("resumes", {
        externalId: `r-${Math.random().toString(36).slice(2, 6)}`,
        content: {},
        hash: `h-${Math.random().toString(36).slice(2, 8)}`,
        tags: [],
        crawledAt: Date.now(),
        source: "test",
      }))) as Id<"resumes">,
      workspaceSlug: "ws-test",
      profileKey: "default",
      evidenceHash: "eh-test",
      promptVersion: "v1",
      model: "gpt-4",
      idempotencyKey: `ik-${Math.random().toString(36).slice(2, 8)}`,
      status: "pending",
      createdAt: Date.now(),
      ...overrides,
    });
  });
}

// ---------------------------------------------------------------------------
// enqueueBatch
// ---------------------------------------------------------------------------

describe("ai_tagging_results: enqueueBatch", () => {
  it("creates tagging results for resumes with evidence text", async () => {
    const t = createTest();

    const resumeId = await insertResumeWithEvidence(t);

    const result = await t.mutation(api.ai_tagging_results.enqueueBatch, {
      workspaceSlug: "ws-enqueue",
      profileKey: "default",
      resumeIds: [resumeId],
    });

    expect(result.created).toBe(1);
    expect(result.reused).toBe(0);
  });

  it("throws when workspaceSlug is empty", async () => {
    const t = createTest();

    const resumeId = await insertResumeWithEvidence(t);

    await expect(
      t.mutation(api.ai_tagging_results.enqueueBatch, {
        workspaceSlug: "  ",
        profileKey: "default",
        resumeIds: [resumeId],
      }),
    ).rejects.toThrow("workspaceSlug is required");
  });

  it("reuses existing results (idempotency)", async () => {
    const t = createTest();

    const resumeId = await insertResumeWithEvidence(t);

    await t.mutation(api.ai_tagging_results.enqueueBatch, {
      workspaceSlug: "ws-idem",
      profileKey: "default",
      resumeIds: [resumeId],
    });

    const result = await t.mutation(api.ai_tagging_results.enqueueBatch, {
      workspaceSlug: "ws-idem",
      profileKey: "default",
      resumeIds: [resumeId],
    });

    expect(result.reused).toBe(1);
    expect(result.created).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// getSummary
// ---------------------------------------------------------------------------

describe("ai_tagging_results: getSummary", () => {
  it("returns zero counts when no results exist", async () => {
    const t = createTest();

    const summary = await t.query(api.ai_tagging_results.getSummary, {
      workspaceSlug: "ws-empty",
      profileKey: "default",
    });

    expect(summary).toEqual({ pending: 0, processing: 0, completed: 0, failed: 0, total: 0 });
  });

  it("counts results by status", async () => {
    const t = createTest();

    await insertTaggingResult(t, {
      workspaceSlug: "ws-summary",
      profileKey: "default",
      status: "pending",
    });
    await insertTaggingResult(t, {
      workspaceSlug: "ws-summary",
      profileKey: "default",
      status: "completed",
    });

    const summary = await t.query(api.ai_tagging_results.getSummary, {
      workspaceSlug: "ws-summary",
      profileKey: "default",
    });

    expect(summary.pending).toBe(1);
    expect(summary.completed).toBe(1);
    expect(summary.total).toBe(2);
  });
});

// ---------------------------------------------------------------------------
// claimPending + markCompleted + markFailed
// ---------------------------------------------------------------------------

describe("ai_tagging_results: claim + complete/fail lifecycle", () => {
  it("claims a pending result and transitions to processing", async () => {
    const t = createTest();

    const id = await insertTaggingResult(t, { status: "pending" });

    const claimed = await t.mutation(internal.ai_tagging_results.claimPending, { id });

    expect(claimed).not.toBeNull();
    expect(claimed!.status).toBe("pending"); // Returns the row before patch

    // After claim, status should be processing
    const row = await t.run(async (ctx) => ctx.db.get(id));
    expect(row!.status).toBe("processing");
    expect(row!.metrics!.attempts).toBe(1);
  });

  it("returns null for non-pending result", async () => {
    const t = createTest();

    const id = await insertTaggingResult(t, { status: "completed" });

    const claimed = await t.mutation(internal.ai_tagging_results.claimPending, { id });

    expect(claimed).toBeNull();
  });

  it("marks a processing result as completed", async () => {
    const t = createTest();

    const id = await insertTaggingResult(t, { status: "processing" });

    await t.mutation(internal.ai_tagging_results.markCompleted, {
      id,
      result: {
        roleFit: "sales_verified",
        recommendation: "strong_match",
        confidence: 0.95,
        tags: ["industry:software"],
        evidenceLines: ["5 years in sales"],
      },
      metrics: { latencyMs: 1200, tokensIn: 800, tokensOut: 200 },
    });

    const row = await t.run(async (ctx) => ctx.db.get(id));
    expect(row!.status).toBe("completed");
    expect(row!.result!.roleFit).toBe("sales_verified");
    expect(row!.completedAt).toBeDefined();
  });

  it("marks a processing result as failed", async () => {
    const t = createTest();

    const id = await insertTaggingResult(t, { status: "processing" });

    await t.mutation(internal.ai_tagging_results.markFailed, {
      id,
      error: "API rate limit exceeded",
    });

    const row = await t.run(async (ctx) => ctx.db.get(id));
    expect(row!.status).toBe("failed");
    expect(row!.error).toBe("API rate limit exceeded");
  });

  it("does not overwrite a completed result", async () => {
    const t = createTest();

    const id = await insertTaggingResult(t, { status: "completed" });

    await t.mutation(internal.ai_tagging_results.markFailed, {
      id,
      error: "Should not apply",
    });

    const row = await t.run(async (ctx) => ctx.db.get(id));
    expect(row!.status).toBe("completed");
  });
});

// ---------------------------------------------------------------------------
// listPending
// ---------------------------------------------------------------------------

describe("ai_tagging_results: listPending", () => {
  it("returns only pending results for workspace/profile", async () => {
    const t = createTest();

    await insertTaggingResult(t, {
      workspaceSlug: "ws-pending",
      profileKey: "default",
      status: "pending",
    });
    await insertTaggingResult(t, {
      workspaceSlug: "ws-pending",
      profileKey: "default",
      status: "completed",
    });

    const pending = await t.query(internal.ai_tagging_results.listPending, {
      workspaceSlug: "ws-pending",
      profileKey: "default",
    });

    expect(pending).toHaveLength(1);
    expect(pending[0].status).toBe("pending");
  });
});
