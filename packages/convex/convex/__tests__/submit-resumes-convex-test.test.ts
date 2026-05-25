/**
 * Integration tests for resume_tasks.submitResumes using convex-test.
 *
 * Covers the highest-risk paths:
 * - New resume insertion (identity dedup, tags, sync events)
 * - Existing resume update (hash changed → full update)
 * - Existing resume unchanged (same hash → no patch)
 * - Identity deduplication within the same batch
 * - restoreState fields (ingestData, analysis, analyses)
 *
 * Uses convex-test with real schema validation — no mocks.
 */
import { convexTest } from "convex-test";
import { describe, expect, it } from "vitest";
import { api } from "../_generated/api.js";
import schema from "../schema.js";

const modules = (import.meta as any).glob("../**/*.ts", { eager: false });

// Helper: build a minimal resume payload for submitResumes
let _resumeCounter = 0;
function makeResume(overrides: Record<string, unknown> = {}) {
  _resumeCounter += 1;
  return {
    externalId: `ext-${_resumeCounter}`,
    content: { name: `User ${_resumeCounter}` },
    hash: `hash-${_resumeCounter}`,
    source: "test",
    tags: ["test"],
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// submitResumes: new resume insertion
// ---------------------------------------------------------------------------

describe("resume_tasks: submitResumes — insert", () => {
  it("inserts a new resume", async () => {
    const t = convexTest(schema, modules);

    const result = await t.mutation(api.resume_tasks.submitResumes, {
      resumes: [makeResume()],
    });

    expect(result.inserted).toBe(1);
    expect(result.updated).toBe(0);
    expect(result.unchanged).toBe(0);
    expect(result.input).toBe(1);
    expect(result.submitted).toBe(1);
  });

  it("inserts multiple new resumes", async () => {
    const t = convexTest(schema, modules);

    const result = await t.mutation(api.resume_tasks.submitResumes, {
      resumes: [makeResume(), makeResume(), makeResume()],
    });

    expect(result.inserted).toBe(3);
    expect(result.input).toBe(3);
  });

  it("stores resume fields correctly", async () => {
    const t = convexTest(schema, modules);

    await t.mutation(api.resume_tasks.submitResumes, {
      resumes: [makeResume({ externalId: "ext-store-test", tags: ["python", "react"] })],
    });

    const resumes = await t.run(async (ctx) => {
      return ctx.db.query("resumes").collect();
    });
    expect(resumes).toHaveLength(1);
    expect(resumes[0].externalId).toBe("ext-store-test");
    expect(resumes[0].tags).toEqual(["python", "react"]);
    expect(resumes[0].source).toBe("test");
  });
});

// ---------------------------------------------------------------------------
// submitResumes: identity deduplication
// ---------------------------------------------------------------------------

describe("resume_tasks: submitResumes — dedup", () => {
  it("deduplicates identical resumes within a batch", async () => {
    const t = convexTest(schema, modules);

    const resume = makeResume({ externalId: "ext-dedup" });
    const result = await t.mutation(api.resume_tasks.submitResumes, {
      resumes: [resume, { ...resume }], // same identityKey
    });

    expect(result.inserted).toBe(1);
    expect(result.identityDeduped).toBe(1);
    expect(result.input).toBe(2);
    expect(result.submitted).toBe(1); // after dedup
  });
});

// ---------------------------------------------------------------------------
// submitResumes: update existing
// ---------------------------------------------------------------------------

describe("resume_tasks: submitResumes — update", () => {
  it("updates a resume when hash changes", async () => {
    const t = convexTest(schema, modules);

    // First insert
    await t.mutation(api.resume_tasks.submitResumes, {
      resumes: [makeResume({ externalId: "ext-update", hash: "hash-v1" })],
    });

    // Update with new hash
    const result = await t.mutation(api.resume_tasks.submitResumes, {
      resumes: [makeResume({ externalId: "ext-update", hash: "hash-v2", content: { name: "Updated" } })],
    });

    expect(result.inserted).toBe(0);
    expect(result.updated).toBe(1);
    expect(result.unchanged).toBe(0);
    expect(result.identityMatched).toBeGreaterThanOrEqual(1);

    const resumes = await t.run(async (ctx) => {
      return ctx.db.query("resumes").collect();
    });
    expect(resumes).toHaveLength(1);
    expect(resumes[0].hash).toBe("hash-v2");
  });

  it("leaves resume unchanged when hash is the same", async () => {
    const t = convexTest(schema, modules);

    // First insert
    await t.mutation(api.resume_tasks.submitResumes, {
      resumes: [makeResume({ externalId: "ext-unchanged", hash: "hash-same" })],
    });

    // Submit same hash again
    const result = await t.mutation(api.resume_tasks.submitResumes, {
      resumes: [makeResume({ externalId: "ext-unchanged", hash: "hash-same" })],
    });

    expect(result.inserted).toBe(0);
    expect(result.unchanged).toBe(1);
  });

  it("merges tags on update", async () => {
    const t = convexTest(schema, modules);

    // First insert with tags ["python"]
    await t.mutation(api.resume_tasks.submitResumes, {
      resumes: [makeResume({ externalId: "ext-merge-tags", hash: "hash-v1", tags: ["python"] })],
    });

    // Update with new hash and additional tags
    await t.mutation(api.resume_tasks.submitResumes, {
      resumes: [makeResume({ externalId: "ext-merge-tags", hash: "hash-v2", tags: ["react", "golang"] })],
    });

    const resumes = await t.run(async (ctx) => {
      return ctx.db.query("resumes").collect();
    });
    // Tags should be merged: ["python", "react", "golang"]
    expect(resumes[0].tags).toEqual(expect.arrayContaining(["python", "react", "golang"]));
  });
});

// ---------------------------------------------------------------------------
// submitResumes: restoreState
// ---------------------------------------------------------------------------

describe("resume_tasks: submitResumes — restoreState", () => {
  it("applies restoreState fields to new resume", async () => {
    const t = convexTest(schema, modules);

    const result = await t.mutation(api.resume_tasks.submitResumes, {
      resumes: [makeResume({
        externalId: "ext-restore",
        restoreState: {
          crawledAt: 1000,
          isArchived: true,
          archivedAt: 2000,
          primaryRuleScore: 85,
        },
      })],
    });

    expect(result.inserted).toBe(1);

    const resumes = await t.run(async (ctx) => {
      return ctx.db.query("resumes").collect();
    });
    expect(resumes[0].crawledAt).toBe(1000);
  });

  it("applies ingestData from restoreState", async () => {
    const t = convexTest(schema, modules);

    const ingestData = {
      industryTags: ["tech"],
      synonymHits: ["python"],
      brandHits: [],
      companyHits: [],
      roleSignals: [],
      ruleScores: {},
      experienceLevel: "senior",
      computedAt: Date.now(),
      skillsVersion: 1,
    };

    const result = await t.mutation(api.resume_tasks.submitResumes, {
      resumes: [makeResume({
        externalId: "ext-ingest",
        restoreState: {
          ingestData,
        },
      })],
    });

    expect(result.inserted).toBe(1);

    const resumes = await t.run(async (ctx) => {
      return ctx.db.query("resumes").collect();
    });
    expect(resumes[0].ingestData).toBeDefined();
  });
});

// ---------------------------------------------------------------------------
// submitResumes: sync events
// ---------------------------------------------------------------------------

describe("resume_tasks: submitResumes — sync events", () => {
  it("creates a sync event after submission", async () => {
    const t = convexTest(schema, modules);

    await t.mutation(api.resume_tasks.submitResumes, {
      resumes: [makeResume()],
    });

    const events = await t.run(async (ctx) => {
      return ctx.db.query("sync_events").collect();
    });
    expect(events).toHaveLength(1);
    expect(events[0].source).toBe("browser-extension");
    expect(events[0].status).toBe("success");
    expect(events[0].inserted).toBe(1);
  });
});
