import { convexTest } from "convex-test";
import { describe, expect, it } from "vitest";

import { api } from "../convex/_generated/api.js";
import schema from "../convex/schema.js";
import { resolveMultiTokenFetchLimit } from "../convex/resumes_search.js";
import { seedResume } from "./test-helpers.js";

const modules = (import.meta as any).glob("../**/*.ts", { eager: false });

describe("resumes_search multi-token budget (F2)", () => {
  describe("resolveMultiTokenFetchLimit", () => {
    it("bounds per-token fetches to a limit-scaled budget, never below 50", () => {
      expect(resolveMultiTokenFetchLimit(5)).toBe(50);
      expect(resolveMultiTokenFetchLimit(10)).toBe(50);
      expect(resolveMultiTokenFetchLimit(25)).toBe(50);
      expect(resolveMultiTokenFetchLimit(50)).toBe(100);
      expect(resolveMultiTokenFetchLimit(100)).toBe(200);
    });

    it("caps the budget at 200 for oversized limits", () => {
      expect(resolveMultiTokenFetchLimit(500)).toBe(200);
      expect(resolveMultiTokenFetchLimit(1000)).toBe(200);
    });
  });

  it("2-token query returns exactly the resumes matching ALL tokens (AND)", async () => {
    const t = convexTest(schema, modules);
    await seedResume(t, {
      externalId: "both-1",
      identityKey: "id:both-1",
      searchText: "cnc sales 销售工程师",
    });
    await seedResume(t, {
      externalId: "both-2",
      identityKey: "id:both-2",
      searchText: "cnc 数控 sales manager",
    });
    await seedResume(t, {
      externalId: "only-cnc",
      identityKey: "id:only-cnc",
      searchText: "cnc machining operator",
    });
    await seedResume(t, {
      externalId: "only-sales",
      identityKey: "id:only-sales",
      searchText: "sales marketing 销售",
    });

    const result = await t.query(api.resumes_search.search, {
      query: "cnc sales",
      limit: 5,
    });

    expect(result.map((row) => row.externalId).sort()).toEqual([
      "both-1",
      "both-2",
    ]);
  });

  it("3-token query intersects across all tokens", async () => {
    const t = convexTest(schema, modules);
    await seedResume(t, {
      externalId: "triple-1",
      identityKey: "id:triple-1",
      searchText: "cnc 数控 sales 机床 销售",
    });
    await seedResume(t, {
      externalId: "double-1",
      identityKey: "id:double-1",
      searchText: "cnc 数控 sales",
    });

    const result = await t.query(api.resumes_search.search, {
      query: "cnc sales 机床",
      limit: 5,
    });
    expect(result.map((row) => row.externalId)).toEqual(["triple-1"]);
  });

  it("single-token path is unchanged (same results as the prior direct take)", async () => {
    const t = convexTest(schema, modules);
    await seedResume(t, {
      externalId: "s1",
      identityKey: "id:s1",
      searchText: "cnc operator machining",
    });
    await seedResume(t, {
      externalId: "s2",
      identityKey: "id:s2",
      searchText: "cnc programming",
    });
    await seedResume(t, {
      externalId: "s3",
      identityKey: "id:s3",
      searchText: "java spring",
    });

    const result = await t.query(api.resumes_search.search, {
      query: "cnc",
      limit: 2,
    });
    expect(result.map((row) => row.externalId).sort()).toEqual(["s1", "s2"]);
    expect(result.length).toBeLessThanOrEqual(2);
  });

  it("searchWithIngestData multi-token path keeps AND semantics", async () => {
    const t = convexTest(schema, modules);
    await seedResume(t, {
      externalId: "wi-both",
      identityKey: "id:wi-both",
      searchText: "cnc sales engineer",
    });
    await seedResume(t, {
      externalId: "wi-cnc-only",
      identityKey: "id:wi-cnc-only",
      searchText: "cnc programmer",
    });

    const result = await t.query(api.resumes_search.searchWithIngestData, {
      query: "cnc sales",
      limit: 5,
    });
    expect(result.map((row) => row.externalId)).toEqual(["wi-both"]);
  });

  it("excludes archived resumes on the multi-token path", async () => {
    const t = convexTest(schema, modules);
    await seedResume(t, {
      externalId: "active-both",
      identityKey: "id:active-both",
      searchText: "cnc sales",
    });
    await seedResume(t, {
      externalId: "archived-both",
      identityKey: "id:archived-both",
      searchText: "cnc sales",
      isArchived: true,
    });

    const result = await t.query(api.resumes_search.search, {
      query: "cnc sales",
      limit: 5,
    });
    expect(result.map((row) => row.externalId)).toEqual(["active-both"]);
  });
});
