import { describe, expect, it, vi } from "vitest";

import { enqueueIndustryMaintenance } from "./industry-maintenance-pipeline-service.js";

import type { MaintenancePipelineDeps } from "./industry-maintenance-pipeline-service.js";

function makeDeps(overrides: Partial<MaintenancePipelineDeps> = {}): MaintenancePipelineDeps {
  return {
    findActiveRun: vi.fn().mockResolvedValue(null),
    startRun: vi.fn().mockResolvedValue({ runId: "r-1" }),
    postToWorker: vi.fn().mockResolvedValue({ ok: true, status: 200 }),
    finishRun: vi.fn().mockResolvedValue(undefined),
    patchTriggerContext: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  };
}

describe("enqueueIndustryMaintenance", () => {
  it("creates a new run when none active and posts to worker", async () => {
    const deps = makeDeps();
    const result = await enqueueIndustryMaintenance(
      { workspaceSlug: "dev", triggerSource: "manual" },
      deps,
    );
    expect(result).toEqual({ runId: "r-1", coalesced: false });
    expect(deps.startRun).toHaveBeenCalledWith(
      expect.objectContaining({ workspaceSlug: "dev", triggerSource: "manual" }),
    );
    expect(deps.postToWorker).toHaveBeenCalledWith(
      "/worker/industry/maintenance",
      expect.objectContaining({ runId: "r-1" }),
    );
  });

  it("coalesces onto an active run instead of starting a new one", async () => {
    const deps = makeDeps({
      findActiveRun: vi.fn().mockResolvedValue({ runId: "r-live" }),
    });
    const result = await enqueueIndustryMaintenance(
      { workspaceSlug: "dev", triggerSource: "approval", triggerContext: "p-9" },
      deps,
    );
    expect(result).toEqual({ runId: "r-live", coalesced: true });
    expect(deps.startRun).not.toHaveBeenCalled();
    expect(deps.postToWorker).not.toHaveBeenCalled();
    // The coalesced trigger context is appended to the active run.
    expect(deps.patchTriggerContext).toHaveBeenCalledWith(
      expect.objectContaining({ runId: "r-live", triggerContext: "p-9" }),
    );
  });

  it("marks the run failed when the worker is unreachable", async () => {
    const deps = makeDeps({
      postToWorker: vi.fn().mockRejectedValue(new Error("worker down")),
    });
    const result = await enqueueIndustryMaintenance(
      { workspaceSlug: "dev", triggerSource: "restore" },
      deps,
    );
    expect(result).toEqual({ runId: "r-1", coalesced: false });
    // The fire-and-forget advance runs asynchronously; give it a tick.
    await new Promise((resolve) => setImmediate(resolve));
    expect(deps.finishRun).toHaveBeenCalledWith(
      expect.objectContaining({
        runId: "r-1",
        status: "failed",
        failureMessage: expect.stringContaining("worker"),
      }),
    );
  });

  it("never throws to the caller even if startRun fails", async () => {
    const deps = makeDeps({
      startRun: vi.fn().mockRejectedValue(new Error("convex down")),
    });
    await expect(
      enqueueIndustryMaintenance(
        { workspaceSlug: "dev", triggerSource: "manual" },
        deps,
      ),
    ).resolves.toEqual({ runId: null, coalesced: false });
  });
});
