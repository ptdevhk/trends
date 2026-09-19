import { afterEach, describe, expect, it, vi } from "vitest";

import { config } from "./config.js";
import { callConvexQuery } from "./convex-utils.js";
import { listCandidatePolicyOverrides } from "./candidate-policy-override-service.js";

vi.mock("./convex-utils.js", async (importOriginal) => ({
  ...await importOriginal<typeof import("./convex-utils.js")>(),
  callConvexQuery: vi.fn(),
}));

type Override = {
  _id: string;
  resumeIdentity: string;
  companyKey: string;
  updatedAt: number;
};

function override(overrides: Partial<Override> & { _id: string }): Override {
  return {
    resumeIdentity: "identity-123",
    companyKey: "polywell",
    updatedAt: 1_700_000_000_000,
    ...overrides,
  };
}

describe("listCandidatePolicyOverrides", () => {
  afterEach(() => {
    vi.mocked(callConvexQuery).mockReset();
  });

  it("drains pages and keeps the newest override per identity+company", async () => {
    vi.mocked(callConvexQuery)
      .mockResolvedValueOnce({
        page: [
          override({ _id: "stale", updatedAt: 1_600_000_000_000 }),
          override({ _id: "other", resumeIdentity: "identity-456", companyKey: "fanuc" }),
        ],
        continueCursor: "cursor:2",
        isDone: false,
      })
      .mockResolvedValueOnce({
        page: [override({ _id: "fresh", updatedAt: 1_700_000_000_000 })],
        continueCursor: "cursor:done",
        isDone: true,
      });

    const result = await listCandidatePolicyOverrides("hr");
    expect(result.map((item) => item._id).sort()).toEqual(["fresh", "other"]);
    expect(callConvexQuery).toHaveBeenNthCalledWith(1, "candidate_policy_overrides:list", {
      workspaceSlug: "hr",
      paginationOpts: { cursor: null, numItems: 500 },
      writeSecret: config.auth.convexWriteSecret,
    });
    expect(callConvexQuery).toHaveBeenNthCalledWith(2, "candidate_policy_overrides:list", {
      workspaceSlug: "hr",
      paginationOpts: { cursor: "cursor:2", numItems: 500 },
      writeSecret: config.auth.convexWriteSecret,
    });
  });

  it("accepts a single unpaginated array response", async () => {
    vi.mocked(callConvexQuery).mockResolvedValueOnce([
      override({ _id: "only" }),
      override({ _id: "dupe", updatedAt: 1_800_000_000_000 }),
    ]);

    const result = await listCandidatePolicyOverrides("hr");

    expect(result).toHaveLength(1);
    expect(result[0]).toEqual(expect.objectContaining({ _id: "dupe" }));
    expect(callConvexQuery).toHaveBeenCalledTimes(1);
  });

  it("drops records missing resumeIdentity or companyKey", async () => {
    vi.mocked(callConvexQuery).mockResolvedValueOnce(
      [
        override({ _id: "valid" }),
        override({ _id: "no-identity", resumeIdentity: "   " }),
        override({ _id: "no-company", companyKey: "" }),
        { _id: "not-an-object" },
      ]
    );

    const result = await listCandidatePolicyOverrides("hr");

    expect(result.map((item) => item._id)).toEqual(["valid"]);
  });

  it("defaults effect to allow and normalizes trimmed identity fields", async () => {
    vi.mocked(callConvexQuery).mockResolvedValueOnce([
      { _id: "raw", resumeIdentity: "  identity-123  ", companyKey: "  polywell  " },
    ]);

    await expect(listCandidatePolicyOverrides("hr")).resolves.toEqual([
      expect.objectContaining({
        resumeIdentity: "identity-123",
        companyKey: "polywell",
        effect: "allow",
      }),
    ]);
  });

  it("rejects a cursor that never advances", async () => {
    // Same cursor on every page: the drain guard must trip on the second call
    // rather than loop to MAX_OVERRIDE_PAGES.
    vi.mocked(callConvexQuery).mockResolvedValue({
      page: [],
      continueCursor: "same-cursor",
      isDone: false,
    });

    await expect(listCandidatePolicyOverrides("hr")).rejects.toThrow(/did not advance/i);
    expect(callConvexQuery).toHaveBeenCalledTimes(2);
  });

  it("rejects an empty continue cursor on an incomplete page", async () => {
    vi.mocked(callConvexQuery).mockResolvedValueOnce({
      page: [],
      continueCursor: "",
      isDone: false,
    });

    await expect(listCandidatePolicyOverrides("hr")).rejects.toThrow(/did not advance/i);
  });

  it("rejects a malformed page payload", async () => {
    vi.mocked(callConvexQuery).mockResolvedValueOnce({ page: "not-an-array" });

    await expect(listCandidatePolicyOverrides("hr")).rejects.toThrow(/invalid/i);
  });
});
