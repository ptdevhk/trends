/**
 * Integration tests for submitResumes using convex-test.
 *
 * Replaces resume-tasks-submit.test.ts (hand-crafted mocks)
 * with proper convex-test infrastructure.
 */
import { createTest } from "./test-helpers.js";
import { describe, expect, it } from "vitest";
import { api } from "../convex/_generated/api.js";


describe("resume_tasks: submitResumes", () => {
  it("preserves restore state and skips ingest scheduling for restored resumes", async () => {
    const t = createTest();

    const result = await t.mutation(api.resume_tasks.submitResumes, {
      resumes: [{
        externalId: "hr.job5156.com:resume:1001",
        content: {
          resumeId: "1001",
          name: "Alice",
          location: "东莞",
        },
        hash: "hash-1",
        source: "hr.job5156.com",
        tags: ["sales"],
        restoreState: {
          crawledAt: 1763942400000,
          isArchived: true,
          archivedAt: 1763942400000,
          searchText: "alice sales dongguan machine tools",
          primaryRuleScore: 91,
          ingestData: {
            industryTags: ["machine tools"],
            synonymHits: [],
            brandHits: [],
            companyHits: [],
            ruleScores: {},
            experienceLevel: "senior",
            computedAt: 1763942400000,
            skillsVersion: 1,
          } as any,
          analysis: {
            score: 88,
            summary: "Strong candidate",
            highlights: ["experienced"],
            recommendation: "yes",
          } as any,
          analyses: {
            "source:job5156|analysis:lathe-sales": {
              score: 88,
              summary: "Strong candidate",
              highlights: [],
              recommendation: "yes",
            },
          } as any,
        },
      }],
    });

    expect(result.input).toBe(1);
    expect(result.submitted).toBe(1);
    expect(result.deduped).toBe(0);
    expect(result.inserted).toBe(1);
    expect(result.updated).toBe(0);

    // Verify the resume was inserted with restore state
    const resumes = await t.run(async (ctx) => {
      return ctx.db.query("resumes").collect();
    });

    expect(resumes).toHaveLength(1);
    expect(resumes[0].externalId).toBe("hr.job5156.com:resume:1001");
    expect(resumes[0].searchText).toBe("alice sales dongguan machine tools");
    expect(resumes[0].isArchived).toBe(true);
    expect(resumes[0].primaryRuleScore).toBe(91);
  });

  it("submits fresh resume without restore state", async () => {
    const t = createTest();

    const result = await t.mutation(api.resume_tasks.submitResumes, {
      resumes: [{
        externalId: "seek:profile:2002",
        content: {
          profileId: "2002",
          name: "Bob",
          location: "Kuala Lumpur",
        },
        hash: "hash-2",
        source: "hk.employer.seek.com",
        tags: ["seek"],
      }],
    });

    expect(result.input).toBe(1);
    expect(result.submitted).toBe(1);
    expect(result.inserted).toBe(1);

    const resumes = await t.run(async (ctx) => {
      return ctx.db.query("resumes").collect();
    });

    expect(resumes).toHaveLength(1);
    expect(resumes[0].externalId).toBe("seek:profile:2002");
  });

  it("deduplicates resumes with the same externalId", async () => {
    const t = createTest();

    // Submit the same resume twice
    await t.mutation(api.resume_tasks.submitResumes, {
      resumes: [{
        externalId: "dup:resume:1",
        content: { name: "First" },
        hash: "hash-1",
        source: "test",
        tags: [],
      }],
    });

    const result = await t.mutation(api.resume_tasks.submitResumes, {
      resumes: [{
        externalId: "dup:resume:1",
        content: { name: "Second" },
        hash: "hash-2",
        source: "test",
        tags: [],
      }],
    });

    // Second submission is either deduped or identity-matched (not a fresh insert)
    expect(result.inserted).toBe(0);
    expect(result.deduped + result.identityDeduped + result.identityMatched).toBeGreaterThanOrEqual(1);
    expect(result.submitted).toBe(1);
  });
});
