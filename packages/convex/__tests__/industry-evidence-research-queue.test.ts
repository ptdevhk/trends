import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { api } from "../convex/_generated/api.js";
import { createTest } from "./test-helpers.js";

const WRITE_SECRET = "test-secret";
const originalWriteSecret = process.env.CONVEX_WRITE_SECRET;

beforeEach(() => {
  process.env.CONVEX_WRITE_SECRET = WRITE_SECRET;
});

afterEach(() => {
  if (originalWriteSecret === undefined) delete process.env.CONVEX_WRITE_SECRET;
  else process.env.CONVEX_WRITE_SECRET = originalWriteSecret;
});

async function seedProposal(t: ReturnType<typeof createTest>, proposalId = "vision-proposal") {
  await t.mutation(api.companies.upsertIndustryProposal, {
    writeSecret: WRITE_SECRET,
    proposalId,
    normalizedEmployerSurface: "vision machine tools",
    triggerReasons: ["unknown_employer"],
    priority: 100,
  });
}

describe("targeted industry-evidence research queue", () => {
  it("coalesces repeat demand and claims one exact proposal with a lease", async () => {
    const t = createTest();
    await seedProposal(t);

    const first = await t.mutation(api.companies.enqueueIndustryEvidenceResearchRequest, {
      writeSecret: WRITE_SECRET,
      workspaceSlug: "dev",
      proposalId: "vision-proposal",
      origin: "resume_detail",
      requestedBy: "admin-1",
    });
    expect(first.created).toBe(true);
    expect(first.priority).toBe(100);

    const second = await t.mutation(api.companies.enqueueIndustryEvidenceResearchRequest, {
      writeSecret: WRITE_SECRET,
      workspaceSlug: "dev",
      proposalId: "vision-proposal",
      origin: "scheduled_sweep",
      requestedBy: "scheduler",
    });
    expect(second.created).toBe(false);
    expect(second.demandCount).toBe(2);
    expect(second.priority).toBe(100);

    const claimed = await t.mutation(api.companies.claimIndustryEvidenceResearchRequests, {
      writeSecret: WRITE_SECRET,
      runId: "run-targeted-1",
      requestIds: [first.requestId],
      limit: 10,
    });
    expect(claimed.proposalIds).toEqual(["vision-proposal"]);
    expect(claimed.requests).toHaveLength(1);
    expect(claimed.requests[0]?.requestId).toBe(first.requestId);

    const summary = await t.query(api.companies.getIndustryEvidenceResearchRequestSummary, {
      writeSecret: WRITE_SECRET,
      workspaceSlug: "dev",
      proposalId: "vision-proposal",
    });
    expect(summary.active?.state).toBe("leased");
    expect(summary.active?.attemptCount).toBe(1);
  });

  it("does not permit enqueue to change proposal or company truth", async () => {
    const t = createTest();
    await seedProposal(t);
    const before = await t.query(api.companies.getIndustryProposal, {
      writeSecret: WRITE_SECRET,
      proposalId: "vision-proposal",
    });
    await t.mutation(api.companies.enqueueIndustryEvidenceResearchRequest, {
      writeSecret: WRITE_SECRET,
      workspaceSlug: "dev",
      proposalId: "vision-proposal",
      origin: "resume_detail",
    });
    const after = await t.query(api.companies.getIndustryProposal, {
      writeSecret: WRITE_SECRET,
      proposalId: "vision-proposal",
    });
    expect(after?.companyKey).toBe(before?.companyKey);
    expect(after?.status).toBe(before?.status);
    expect(after?.updatedAt).toBe(before?.updatedAt);
  });

  it("completes a leased request and recovers an expired lease", async () => {
    const t = createTest();
    await seedProposal(t, "p-complete");
    const request = await t.mutation(api.companies.enqueueIndustryEvidenceResearchRequest, {
      writeSecret: WRITE_SECRET,
      workspaceSlug: "dev",
      proposalId: "p-complete",
      origin: "admin_review",
    });
    const claimed = await t.mutation(api.companies.claimIndustryEvidenceResearchRequests, {
      writeSecret: WRITE_SECRET,
      runId: "run-complete",
      requestIds: [request.requestId],
      leaseMs: 30_000,
    });
    const lease = claimed.requests[0]!;
    const completed = await t.mutation(api.companies.completeIndustryEvidenceResearchRequest, {
      writeSecret: WRITE_SECRET,
      requestId: lease.requestId,
      leaseId: lease.leaseId,
      runId: "run-complete",
      state: "needs_more_evidence",
      outcome: "No approval-safe source was found.",
    });
    expect(completed.completed).toBe(true);

    const summary = await t.query(api.companies.getIndustryEvidenceResearchRequestSummary, {
      writeSecret: WRITE_SECRET,
      workspaceSlug: "dev",
      proposalId: "p-complete",
    });
    expect(summary.active).toBeNull();
    expect(summary.history[0]?.state).toBe("needs_more_evidence");

    const retry = await t.mutation(api.companies.retryIndustryEvidenceResearchRequest, {
      writeSecret: WRITE_SECRET,
      workspaceSlug: "dev",
      proposalId: "p-complete",
      requestId: request.requestId,
    });
    expect(retry.state).toBe("queued");
  });

  it("requires fetched proposal evidence before persisting identity candidates", async () => {
    const t = createTest();
    await seedProposal(t, "p-identity");
    await expect(
      t.mutation(api.companies.upsertIndustryIdentityCandidate, {
        writeSecret: WRITE_SECRET,
        proposalId: "p-identity",
        candidateFingerprint: "candidate-1",
        normalizedLegalName: "VISION MACHINE TOOLS SDN BHD",
        sourceIds: ["missing-source"],
        confidence: 0.8,
        conflictCodes: [],
        extractionVersion: "test-v1",
      }),
    ).rejects.toThrow(/allowed fetched proposal source/);
  });

  it("records an attended identity mapping without approving the proposal", async () => {
    const t = createTest();
    await seedProposal(t, "p-map");
    await t.mutation(api.companies.upsert, {
      writeSecret: WRITE_SECRET,
      companyKey: "vision-machine-tools",
      displayName: "Vision Machine Tools",
      status: "confirmed",
    });
    await t.mutation(api.companies.upsertIndustryEvidenceSource, {
      writeSecret: WRITE_SECRET,
      sourceId: "p-map-source",
      proposalId: "p-map",
      url: "https://vision.example/about",
      sourceType: "official_site",
      trustTier: "primary",
      title: "VISION MACHINE TOOLS SDN. BHD.",
      evidenceExcerpt: "VISION MACHINE TOOLS SDN. BHD. manufactures CNC machine tools.",
      fetchStatus: "fetched",
      contentFingerprint: "sha256:vision",
    });
    await t.mutation(api.companies.upsertIndustryIdentityCandidate, {
      writeSecret: WRITE_SECRET,
      proposalId: "p-map",
      candidateFingerprint: "candidate-vision",
      normalizedLegalName: "VISION MACHINE TOOLS SDN. BHD.",
      jurisdiction: "MY",
      sourceIds: ["p-map-source"],
      confidence: 0.88,
      conflictCodes: [],
      extractionVersion: "test-v1",
    });
    const proposalBefore = await t.query(api.companies.getIndustryProposal, {
      writeSecret: WRITE_SECRET,
      proposalId: "p-map",
    });
    const resolved = await t.mutation(api.companies.resolveIndustryProposalIdentity, {
      writeSecret: WRITE_SECRET,
      workspaceSlug: "dev",
      actor: "admin-1",
      proposalId: "p-map",
      expectedProposalUpdatedAt: proposalBefore!.updatedAt,
      candidateFingerprint: "candidate-vision",
      mappingMode: "existing",
      companyKey: "vision-machine-tools",
      sourceIds: ["p-map-source"],
      reviewNote: "Matched the fetched legal name to the canonical registry row.",
    });
    expect(resolved.companyKey).toBe("vision-machine-tools");
    const proposalAfter = await t.query(api.companies.getIndustryProposal, {
      writeSecret: WRITE_SECRET,
      proposalId: "p-map",
    });
    expect(proposalAfter?.companyKey).toBe("vision-machine-tools");
    expect(proposalAfter?.status).toBe("new");
    const candidates = await t.query(api.companies.listIndustryIdentityCandidates, {
      writeSecret: WRITE_SECRET,
      proposalId: "p-map",
    });
    expect(candidates[0]?.reviewState).toBe("reviewed");
  });
});
