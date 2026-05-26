/**
 * Integration tests for ai_tagging_results using convex-test.
 *
 * Covers:
 * - enqueueBatch (validation, basic creation, idempotency, retry)
 * - getSummary (counts by status)
 *
 * Uses convex-test with real schema validation — no mocks.
 */
import { createTest } from "./test-helpers.js";
import { describe, expect, it } from "vitest";
import { api } from "../_generated/api.js";
import type { Id } from "../_generated/dataModel.js";


// Helper: insert a minimal resume with ingestData that has work history evidence
let _resumeCounter = 0;
async function insertResumeWithTaggingData(
  t: ReturnType<typeof createTest>,
  overrides: Record<string, unknown> = {},
) {
  _resumeCounter += 1;
  return t.run(async (ctx) => {
    return ctx.db.insert("resumes", {
      externalId: `ext-${_resumeCounter}`,
      content: {
        name: "Test User",
        workHistory: [
          {
            company: "Acme Corp",
            jobTitle: "Senior Developer",
            years: 5,
            description: "Python and React development",
          },
        ],
      },
      hash: `hash-${_resumeCounter}`,
      tags: [],
      crawledAt: Date.now(),
      source: "test",
      sourceKey: "51job",
      ingestData: {
        evidenceText: "Python developer with 5 years experience",
        industryTags: ["software"],
        synonymHits: ["python"],
        brandHits: [],
        companyHits: [],
        ruleScores: {},
        experienceLevel: "senior",
        computedAt: Date.now(),
        skillsVersion: 1,
        roleSignals: [
          {
            type: "industry",
            matchedSignals: ["python"],
            signalCount: 1,
            occurrences: 5,
            years: 5,
            industryVerifiedYears: 5,
            verifyIn: "content",
          },
        ],
      },
      ...overrides,
    });
  });
}

// Helper: insert a minimal resume without ingestData
async function insertMinimalResume(
  t: ReturnType<typeof createTest>,
  overrides: Record<string, unknown> = {},
) {
  _resumeCounter += 1;
  return t.run(async (ctx) => {
    return ctx.db.insert("resumes", {
      externalId: `ext-minimal-${_resumeCounter}`,
      content: { name: "Minimal User" },
      hash: `hash-minimal-${_resumeCounter}`,
      tags: [],
      crawledAt: Date.now(),
      source: "test",
      ...overrides,
    });
  });
}

// Helper: insert an ai_tagging_result directly
async function insertTaggingResult(
  t: ReturnType<typeof createTest>,
  overrides: Record<string, unknown> = {},
) {
  _resumeCounter += 1;
  return t.run(async (ctx) => {
    return ctx.db.insert("ai_tagging_results", {
      resumeId: (overrides.resumeId ?? `fake-id-${_resumeCounter}`) as Id<"resumes">,
      workspaceSlug: "dev",
      profileKey: "test-profile",
      evidenceHash: `eh-${_resumeCounter}`,
      promptVersion: "v1",
      model: "gpt-4",
      idempotencyKey: `ik-${_resumeCounter}`,
      status: "pending",
      metrics: { attempts: 0 },
      createdAt: Date.now(),
      ...overrides,
    });
  });
}

// ---------------------------------------------------------------------------
// enqueueBatch
// ---------------------------------------------------------------------------

describe("ai_tagging_results: enqueueBatch", () => {
  it("throws when workspaceSlug is empty", async () => {
    const t = createTest();

    await expect(
      t.mutation(api.ai_tagging_results.enqueueBatch, {
        workspaceSlug: "  ",
        profileKey: "test",
        resumeIds: [],
      }),
    ).rejects.toThrow("workspaceSlug is required");
  });

  it("throws when profileKey is empty", async () => {
    const t = createTest();

    await expect(
      t.mutation(api.ai_tagging_results.enqueueBatch, {
        workspaceSlug: "dev",
        profileKey: "  ",
        resumeIds: [],
      }),
    ).rejects.toThrow("profileKey is required");
  });

  it("creates tagging results for resumes with evidence", async () => {
    const t = createTest();

    const resumeId = await insertResumeWithTaggingData(t);

    const result = await t.mutation(api.ai_tagging_results.enqueueBatch, {
      workspaceSlug: "dev",
      profileKey: "test-profile",
      resumeIds: [resumeId],
    });

    expect(result.created).toBeGreaterThanOrEqual(1);

    const results = await t.run(async (ctx) => {
      return ctx.db.query("ai_tagging_results").collect();
    });
    expect(results.length).toBeGreaterThanOrEqual(1);
    expect(results[0].workspaceSlug).toBe("dev");
    expect(results[0].profileKey).toBe("test-profile");
  });

  it("skips resumes without ingestData evidence", async () => {
    const t = createTest();

    const resumeId = await insertMinimalResume(t);

    const result = await t.mutation(api.ai_tagging_results.enqueueBatch, {
      workspaceSlug: "dev",
      profileKey: "test-profile",
      resumeIds: [resumeId],
    });

    // No evidence → skipped (no created results)
    expect(result.created).toBe(0);
  });

  it("reuses existing results with same idempotency key", async () => {
    const t = createTest();

    const resumeId = await insertResumeWithTaggingData(t);

    // First enqueue
    await t.mutation(api.ai_tagging_results.enqueueBatch, {
      workspaceSlug: "dev",
      profileKey: "test-profile",
      resumeIds: [resumeId],
    });

    // Second enqueue with same args
    const result = await t.mutation(api.ai_tagging_results.enqueueBatch, {
      workspaceSlug: "dev",
      profileKey: "test-profile",
      resumeIds: [resumeId],
    });

    expect(result.reused).toBeGreaterThanOrEqual(1);

    // Only one result should exist
    const results = await t.run(async (ctx) => {
      return ctx.db.query("ai_tagging_results").collect();
    });
    expect(results.length).toBe(1);
  });

  it("retries failed results when retryFailed is true", async () => {
    const t = createTest();

    const resumeId = await insertResumeWithTaggingData(t);

    // First enqueue
    await t.mutation(api.ai_tagging_results.enqueueBatch, {
      workspaceSlug: "dev",
      profileKey: "test-profile",
      resumeIds: [resumeId],
    });

    // Manually mark the result as failed
    const results = await t.run(async (ctx) => {
      return ctx.db.query("ai_tagging_results").collect();
    });
    await t.run(async (ctx) => {
      await ctx.db.patch(results[0]._id as any, {
        status: "failed",
        error: "test failure",
        completedAt: Date.now(),
      });
    });

    // Re-enqueue with retryFailed
    const result = await t.mutation(api.ai_tagging_results.enqueueBatch, {
      workspaceSlug: "dev",
      profileKey: "test-profile",
      resumeIds: [resumeId],
      retryFailed: true,
    });

    expect(result.retried).toBeGreaterThanOrEqual(1);
  });
});

// ---------------------------------------------------------------------------
// getSummary
// ---------------------------------------------------------------------------

describe("ai_tagging_results: getSummary", () => {
  it("returns zeros when no results exist", async () => {
    const t = createTest();

    const result = await t.query(api.ai_tagging_results.getSummary, {
      workspaceSlug: "dev",
      profileKey: "nonexistent",
    });

    expect(result).toEqual({ pending: 0, processing: 0, completed: 0, failed: 0, total: 0 });
  });

  it("counts results by status", async () => {
    const t = createTest();

    // Insert a resume so we have a valid resumeId
    const resumeId = await insertMinimalResume(t);

    // Insert results with different statuses
    await insertTaggingResult(t, { resumeId, status: "pending" });
    await insertTaggingResult(t, { resumeId, status: "pending" });
    await insertTaggingResult(t, { resumeId, status: "completed", completedAt: Date.now() });
    await insertTaggingResult(t, { resumeId, status: "failed", error: "test", completedAt: Date.now() });

    const result = await t.query(api.ai_tagging_results.getSummary, {
      workspaceSlug: "dev",
      profileKey: "test-profile",
    });

    expect(result.pending).toBe(2);
    expect(result.completed).toBe(1);
    expect(result.failed).toBe(1);
    expect(result.total).toBe(4);
  });

  it("returns zeros when workspaceSlug or profileKey is blank", async () => {
    const t = createTest();

    const result = await t.query(api.ai_tagging_results.getSummary, {
      workspaceSlug: "  ",
      profileKey: "test",
    });

    expect(result).toEqual({ pending: 0, processing: 0, completed: 0, failed: 0, total: 0 });
  });
});
