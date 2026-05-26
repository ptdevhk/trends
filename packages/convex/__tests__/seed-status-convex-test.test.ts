/**
 * Integration tests for seed status using convex-test.
 *
 * Replaces seed-status.test.ts (hand-crafted mocks)
 * with proper convex-test infrastructure.
 */
import { createTest } from "./test-helpers.js";
import { describe, expect, it } from "vitest";
import { api } from "../convex/_generated/api.js";


describe("seed: status", () => {
  it("reports an empty database as empty", async () => {
    const t = createTest();

    const result = await t.query(api.seed.status, {});

    expect(result.isEmpty).toBe(true);
    expect(result.jobDescriptions).toBe(0);
    expect(result.resumes).toBe(0);
  });

  it("reports presence as 0/1 after seeding data", async () => {
    const t = createTest();

    await t.mutation(api.seed.seedJobDescriptions, {
      items: [{ title: "Test JD", content: "c", type: "system" }],
    });
    await t.mutation(api.seed.seedResumes, {
      resumes: [{
        externalId: "ext-1",
        content: { name: "Test" },
        hash: "hash-1",
        source: "test",
        tags: [],
      }],
    });

    const result = await t.query(api.seed.status, {});

    expect(result.isEmpty).toBe(false);
    expect(result.jobDescriptions).toBe(1);
    expect(result.resumes).toBe(1);
  });
});
