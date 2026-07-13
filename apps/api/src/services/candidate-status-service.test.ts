import { afterEach, describe, expect, it, vi } from "vitest";

import { config } from "./config.js";
import { callConvexQuery } from "./convex-utils.js";
import { listCandidateStatuses } from "./candidate-status-service.js";

vi.mock("./convex-utils.js", async (importOriginal) => ({
  ...await importOriginal<typeof import("./convex-utils.js")>(),
  callConvexQuery: vi.fn(),
}));

describe("listCandidateStatuses", () => {
  afterEach(() => {
    vi.mocked(callConvexQuery).mockReset();
  });

  it("drains secret-protected status pages", async () => {
    vi.mocked(callConvexQuery)
      .mockResolvedValueOnce({
        page: [{ identityKey: "candidate-1", status: "new", updatedAt: 1 }],
        continueCursor: "cursor:2",
        isDone: false,
      })
      .mockResolvedValueOnce({
        page: [{ identityKey: "candidate-2", status: "shortlisted", updatedAt: 2 }],
        continueCursor: "cursor:done",
        isDone: true,
      });

    await expect(listCandidateStatuses("hr")).resolves.toEqual([
      expect.objectContaining({ identityKey: "candidate-1" }),
      expect.objectContaining({ identityKey: "candidate-2" }),
    ]);
    expect(callConvexQuery).toHaveBeenNthCalledWith(1, "candidate_status:listPage", {
      workspaceSlug: "hr",
      paginationOpts: { cursor: null, numItems: 500 },
      writeSecret: config.auth.convexWriteSecret,
    });
    expect(callConvexQuery).toHaveBeenNthCalledWith(2, "candidate_status:listPage", {
      workspaceSlug: "hr",
      paginationOpts: { cursor: "cursor:2", numItems: 500 },
      writeSecret: config.auth.convexWriteSecret,
    });
  });

  it("rejects malformed and non-advancing pagination", async () => {
    vi.mocked(callConvexQuery).mockResolvedValueOnce({
      page: [],
      continueCursor: "",
      isDone: false,
    });
    await expect(listCandidateStatuses("hr")).rejects.toThrow(/did not advance/i);

    vi.mocked(callConvexQuery).mockResolvedValueOnce({ page: "not-an-array" });
    await expect(listCandidateStatuses("hr")).rejects.toThrow(/invalid/i);
  });
});
