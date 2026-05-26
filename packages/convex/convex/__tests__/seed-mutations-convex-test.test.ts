/**
 * Integration tests for seed mutations using convex-test.
 *
 * Replaces seed-mutations.test.ts (hand-crafted mocks)
 * with proper convex-test infrastructure.
 */
import { convexTest } from "convex-test";
import { describe, expect, it } from "vitest";
import { api } from "../_generated/api.js";
import schema from "../schema.js";

const modules = (import.meta as any).glob("../**/*.ts", { eager: false });

describe("seed: seedJobDescriptions", () => {
  it("inserts new job descriptions", async () => {
    const t = convexTest(schema, modules);

    const result = await t.mutation(api.seed.seedJobDescriptions, {
      items: [
        { title: "CNC Sales", content: "Job description content", type: "system" },
        { title: "Custom Role", content: "Custom content", type: "custom", workspaceSlug: "dev" },
      ],
    });

    expect(result.inserted).toBe(2);
    expect(result.skipped).toBe(0);
  });

  it("skips existing job descriptions with identical content", async () => {
    const t = convexTest(schema, modules);

    await t.mutation(api.seed.seedJobDescriptions, {
      items: [
        { title: "CNC Sales", content: "same content", type: "system" },
      ],
    });

    const result = await t.mutation(api.seed.seedJobDescriptions, {
      items: [
        { title: "CNC Sales", content: "same content", type: "system" },
      ],
    });

    expect(result.inserted).toBe(0);
    expect(result.skipped).toBe(1);
    expect(result.updated).toBe(0);
  });

  it("updates existing job descriptions when content changes", async () => {
    const t = convexTest(schema, modules);

    await t.mutation(api.seed.seedJobDescriptions, {
      items: [
        { title: "CNC Sales", content: "old content", type: "system" },
      ],
    });

    const result = await t.mutation(api.seed.seedJobDescriptions, {
      items: [
        { title: "CNC Sales", content: "new content", type: "system" },
      ],
    });

    expect(result.inserted).toBe(0);
    expect(result.skipped).toBe(1);
    expect(result.updated).toBe(1);
  });
});

describe("seed: seedResumes", () => {
  it("inserts new resumes", async () => {
    const t = convexTest(schema, modules);

    const result = await t.mutation(api.seed.seedResumes, {
      resumes: [
        {
          externalId: "ext-1",
          content: { name: "Alice" },
          hash: "abc123",
          source: "test",
          tags: ["demo"],
        },
      ],
    });

    expect(result.inserted).toBe(1);
    expect(result.skipped).toBe(0);
  });

  it("skips resumes that already exist by externalId", async () => {
    const t = convexTest(schema, modules);

    await t.mutation(api.seed.seedResumes, {
      resumes: [
        {
          externalId: "ext-1",
          content: { name: "Alice" },
          hash: "abc123",
          source: "test",
          tags: ["demo"],
        },
      ],
    });

    const result = await t.mutation(api.seed.seedResumes, {
      resumes: [
        {
          externalId: "ext-1",
          content: { name: "Alice Updated" },
          hash: "new-hash",
          source: "test",
          tags: ["demo"],
        },
      ],
    });

    // Second submission should be skipped or updated (not a fresh insert)
    expect(result.inserted).toBe(0);
  });
});

describe("seed: clearWorkspaceData", () => {
  it("deletes custom JDs and search profiles for the specified workspace", async () => {
    const t = convexTest(schema, modules);

    // Seed some data first
    await t.mutation(api.seed.seedJobDescriptions, {
      items: [
        { title: "Custom JD Dev", content: "c", type: "custom", workspaceSlug: "dev" },
        { title: "System JD", content: "s", type: "system" },
        { title: "Custom JD HR", content: "h", type: "custom", workspaceSlug: "hr" },
      ],
    });

    const result = await t.mutation(api.seed.clearWorkspaceData, {
      workspaceSlug: "dev",
    });

    expect(result.workspaceSlug).toBe("dev");
    expect(result.customJobDescriptions).toBeGreaterThanOrEqual(1);
  });

  it("only deletes data for the specified workspace", async () => {
    const t = convexTest(schema, modules);

    await t.mutation(api.seed.seedJobDescriptions, {
      items: [
        { title: "HR Custom", content: "c", type: "custom", workspaceSlug: "hr" },
        { title: "Dev Custom", content: "d", type: "custom", workspaceSlug: "dev" },
      ],
    });

    const result = await t.mutation(api.seed.clearWorkspaceData, {
      workspaceSlug: "hr",
    });

    expect(result.customJobDescriptions).toBeGreaterThanOrEqual(1);

    // Dev data should still exist
    const jds = await t.run(async (ctx) => {
      return ctx.db.query("job_descriptions").collect();
    });
    const devJd = jds.find((jd) => jd.title === "Dev Custom");
    expect(devJd).toBeDefined();
  });
});

describe("seed: clearAll", () => {
  it("deletes all data from every table", async () => {
    const t = convexTest(schema, modules);

    // Seed some data first
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

    const result = await t.mutation(api.seed.clearAll, {});

    expect(result.success).toBe(true);
  });
});
