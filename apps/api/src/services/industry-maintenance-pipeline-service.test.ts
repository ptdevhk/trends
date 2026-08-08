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

  it("leaves the run for worker-side completion when the worker POST times out", async () => {
    const deps = makeDeps({
      postToWorker: vi.fn().mockRejectedValue(
        new DOMException("The operation timed out", "TimeoutError"),
      ),
    });
    await enqueueIndustryMaintenance(
      { workspaceSlug: "dev", triggerSource: "schedule" },
      deps,
    );
    await new Promise((resolve) => setImmediate(resolve));
    // The worker may still be researching; the run must not be marked failed.
    expect(deps.finishRun).not.toHaveBeenCalled();
  });

  it("does not release leases when the worker POST times out", async () => {
    const deps = makeDeps({
      startRun: vi.fn().mockResolvedValue({
        runId: "r-target",
        requests: [
          { requestId: "request-1", proposalId: "proposal-1", leaseId: "lease-1" },
        ],
      }),
      postToWorker: vi.fn().mockRejectedValue(new DOMException("aborted", "AbortError")),
      releaseRequests: vi.fn().mockResolvedValue(undefined),
    });
    await enqueueIndustryMaintenance(
      { workspaceSlug: "dev", triggerSource: "manual", mode: "targeted" },
      deps,
    );
    await new Promise((resolve) => setImmediate(resolve));
    // Releasing leases on timeout could double-process proposals the worker
    // is already researching; leave them leased for worker-side completion.
    expect(deps.releaseRequests).not.toHaveBeenCalled();
    expect(deps.finishRun).not.toHaveBeenCalled();
  });

  it("finishes the run failed when the worker connection is refused", async () => {
    const deps = makeDeps({
      postToWorker: vi.fn().mockRejectedValue(new TypeError("fetch failed")),
    });
    await enqueueIndustryMaintenance(
      { workspaceSlug: "dev", triggerSource: "restore" },
      deps,
    );
    await new Promise((resolve) => setImmediate(resolve));
    // Connection refusal means the worker never got the request: fail the run.
    expect(deps.finishRun).toHaveBeenCalledWith(
      expect.objectContaining({ runId: "r-1", status: "failed" }),
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

  it("does not coalesce an exact targeted request onto a broad active sweep", async () => {
    const deps = makeDeps({
      findActiveRun: vi.fn().mockResolvedValue({ runId: "r-sweep" }),
      startRun: vi.fn().mockResolvedValue({
        runId: "r-target",
        proposalIds: ["proposal-1"],
        requests: [{ requestId: "request-1", proposalId: "proposal-1", leaseId: "lease-1" }],
      }),
    });
    const result = await enqueueIndustryMaintenance(
      {
        workspaceSlug: "dev",
        triggerSource: "manual",
        mode: "targeted",
        proposalIds: ["proposal-1"],
        requestIds: ["request-1"],
      },
      deps,
    );
    expect(result).toEqual({ runId: "r-target", coalesced: false });
    expect(deps.startRun).toHaveBeenCalledWith(expect.objectContaining({ mode: "targeted" }));
    expect(deps.postToWorker).toHaveBeenCalledWith(
      "/worker/industry/maintenance",
      expect.objectContaining({ mode: "targeted", proposalIds: ["proposal-1"], requests: expect.any(Array) }),
    );
  });

  it("does not hide a broad trigger behind an active targeted run", async () => {
    const deps = makeDeps({
      findActiveRun: vi.fn().mockResolvedValue({ runId: "r-target", mode: "targeted" }),
    });
    const result = await enqueueIndustryMaintenance(
      { workspaceSlug: "dev", triggerSource: "schedule" },
      deps,
    );
    expect(result).toEqual({ runId: "r-1", coalesced: false });
    expect(deps.startRun).toHaveBeenCalled();
  });
});
