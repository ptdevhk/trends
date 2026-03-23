import { ConvexHttpClient } from "convex/browser";
import { afterEach, describe, expect, it, vi } from "vitest";

import { runWorkspaceDemoResumeCleanup } from "./clear-workspace-demo-resumes.ts";

afterEach(() => {
  vi.restoreAllMocks();
});

describe("clear-workspace-demo-resumes", () => {
  it("calls the workspace-demo cleanup mutation and returns the result payload", async () => {
    const mutationSpy = vi
      .spyOn(ConvexHttpClient.prototype, "mutation")
      .mockResolvedValue({
        deleted: 1,
        tag: "workspace-demo",
      } as never);

    const result = await runWorkspaceDemoResumeCleanup({
      convexUrl: "http://127.0.0.1:3210",
      json: true,
    });

    expect(mutationSpy).toHaveBeenCalledTimes(1);
    expect(mutationSpy.mock.calls[0]?.[1]).toEqual({});
    expect(result).toEqual({
      success: true,
      convexUrl: "http://127.0.0.1:3210",
      deleted: 1,
      tag: "workspace-demo",
    });
  });
});
