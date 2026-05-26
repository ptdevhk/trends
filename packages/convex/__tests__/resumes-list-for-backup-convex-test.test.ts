/**
 * Integration tests for listForBackup using convex-test.
 *
 * Replaces resumes-list-for-backup.test.ts (hand-crafted mocks)
 * with proper convex-test infrastructure.
 */
import { createTest } from "./test-helpers.js";
import { describe, expect, it } from "vitest";
import { api } from "../convex/_generated/api.js";


// Helper: insert a minimal resume
let _counter = 0;
async function insertResume(
  t: ReturnType<typeof createTest>,
  overrides: Record<string, unknown> = {},
) {
  _counter += 1;
  return t.run(async (ctx) => {
    return ctx.db.insert("resumes", {
      externalId: `ext-${_counter}`,
      content: { name: `User ${_counter}` },
      hash: `hash-${_counter}`,
      tags: [],
      crawledAt: _counter * 100,
      source: "test",
      sourceKey: "test",
      ...overrides,
    });
  });
}

describe("resumes: listForBackup", () => {
  it("filters by sourceHosts and limits results", async () => {
    const t = createTest();

    // Insert resumes from different sources
    await insertResume(t, {
      externalId: "seek:profile:2002",
      source: "hk.employer.seek.com",
      sourceKey: "seek",
      content: { name: "Bob", profileId: "2002" },
      crawledAt: 100,
    });
    await insertResume(t, {
      externalId: "hr.job5156.com:resume:1001",
      source: "hr.job5156.com",
      sourceKey: "job5156",
      content: { name: "Alice", resumeId: "1001" },
      tags: ["sales"],
      crawledAt: 200,
      searchText: "alice sales",
      primaryRuleScore: 93,
      ingestData: {
        industryTags: ["machine tools"],
        synonymHits: [],
        brandHits: [],
        companyHits: [],
        ruleScores: {},
        experienceLevel: "mid",
        computedAt: 1,
        skillsVersion: 1,
      },
    });
    await insertResume(t, {
      externalId: "hr.job5156.com:resume:1003",
      source: "hr.job5156.com",
      sourceKey: "job5156",
      content: { name: "Carol", resumeId: "1003" },
      tags: ["ops"],
      crawledAt: 50,
    });

    const result = await t.query(api.resumes.listForBackup, {
      paginationOpts: { cursor: null, numItems: 50 },
      sourceHosts: ["hr.job5156.com"],
      limit: 2,
    });

    // Should only contain job5156 resumes (filtered by sourceHosts)
    expect(result.page.length).toBeLessThanOrEqual(2);
    for (const row of result.page) {
      expect((row as Record<string, unknown>).source).toBe("hr.job5156.com");
    }
  });

  it("matches requested resume IDs using the shared resume ID resolver", async () => {
    const t = createTest();

    const id1 = await insertResume(t, {
      externalId: "seek:profile:2002",
      source: "hk.employer.seek.com",
      sourceKey: "seek",
      content: { name: "Bob", profileId: "2002" },
      crawledAt: 100,
      searchText: "bob seek sales",
      primaryRuleScore: 81,
    });
    await insertResume(t, {
      externalId: "seek:profile:9999",
      source: "hk.employer.seek.com",
      sourceKey: "seek",
      content: { name: "Carol", profileId: "9999" },
      crawledAt: 90,
    });

    const result = await t.query(api.resumes.listForBackup, {
      paginationOpts: { cursor: null, numItems: 50 },
      resumeIds: ["2002"],  // matches content.profileId
    });

    // Should only include the resume matching profileId "2002"
    expect(result.page).toHaveLength(1);
    expect((result.page[0] as Record<string, unknown>).externalId).toBe("seek:profile:2002");
  });
});
