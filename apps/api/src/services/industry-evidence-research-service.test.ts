import { beforeEach, describe, expect, it, vi } from "vitest";

const { callConvexMutation, callConvexQuery, enqueueIndustryMaintenance } = vi.hoisted(() => ({
  callConvexMutation: vi.fn(),
  callConvexQuery: vi.fn(),
  enqueueIndustryMaintenance: vi.fn().mockResolvedValue({ runId: "run-1", coalesced: false }),
}));

vi.mock("./convex-utils.js", () => ({ callConvexMutation, callConvexQuery }));
vi.mock("./config.js", () => ({
  config: {
    industryEvidenceTargetedQueueEnabled: true,
    industryEvidenceResearchMaxBatch: 20,
    auth: { convexWriteSecret: "test-secret" },
  },
}));
vi.mock("./industry-maintenance-pipeline-service.js", () => ({
  enqueueIndustryMaintenance,
}));

import {
  enqueueIndustryEvidenceResearch,
  enqueueIndustryEvidenceResearchBatch,
  resolveExactResumeResearchTargets,
} from "./industry-evidence-research-service.js";

describe("industry evidence targeted research service", () => {
  beforeEach(() => {
    callConvexMutation.mockReset();
    callConvexQuery.mockReset();
    enqueueIndustryMaintenance.mockClear();
  });

  it("queues one exact proposal and dispatches a targeted worker payload", async () => {
    callConvexMutation.mockResolvedValue({
      requestId: "request-1",
      proposalId: "proposal-1",
      origin: "admin_review",
      state: "queued",
      priority: 60,
      requestedAt: 100,
      demandCount: 1,
      attemptCount: 0,
      updatedAt: 100,
      canRetry: false,
      canCancel: true,
      disposition: "created",
    });
    const result = await enqueueIndustryEvidenceResearch({
      workspaceSlug: "dev",
      proposalId: "proposal-1",
      origin: "admin_review",
      requestedBy: "admin-1",
    });
    expect(result.request.requestId).toBe("request-1");
    expect(enqueueIndustryMaintenance).toHaveBeenCalledWith(expect.objectContaining({
      mode: "targeted",
      proposalIds: ["proposal-1"],
      requestIds: ["request-1"],
    }));
  });

  it("coalesces a resume result set into one bounded targeted dispatch", async () => {
    callConvexQuery
      .mockResolvedValueOnce({ targets: [{ availability: "target_available", proposalId: "p-1" }] })
      .mockResolvedValueOnce({ targets: [{ availability: "target_available", proposalId: "p-2" }] });
    callConvexMutation
      .mockResolvedValueOnce({ requestId: "r-1", proposalId: "p-1", origin: "resume_search_batch", state: "queued", priority: 80, requestedAt: 1, demandCount: 1, attemptCount: 0, updatedAt: 1, canRetry: false, canCancel: true, disposition: "created" })
      .mockResolvedValueOnce({ requestId: "r-2", proposalId: "p-2", origin: "resume_search_batch", state: "queued", priority: 80, requestedAt: 1, demandCount: 1, attemptCount: 0, updatedAt: 1, canRetry: false, canCancel: true, disposition: "created" });
    const result = await resolveExactResumeResearchTargets({
      workspaceSlug: "dev",
      resumeIds: ["resume-1", "resume-2"],
      requestedBy: "admin-1",
    });
    expect(result.queued).toBe(2);
    expect(result.proposalIds).toEqual(["p-1", "p-2"]);
    expect(enqueueIndustryMaintenance).toHaveBeenCalledTimes(1);
  });

  it("does not dispatch an empty batch", async () => {
    const result = await enqueueIndustryEvidenceResearchBatch({
      workspaceSlug: "dev",
      proposalIds: [],
      origin: "resume_search_batch",
      requestedBy: "admin-1",
    });
    expect(result.requests).toEqual([]);
    expect(result.dispatch).toEqual({ runId: null, coalesced: false });
    expect(enqueueIndustryMaintenance).not.toHaveBeenCalled();
  });
});
