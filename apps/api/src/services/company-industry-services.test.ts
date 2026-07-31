import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  query: vi.fn(),
  mutation: vi.fn(),
  recomputeList: vi.fn(),
  recomputeStart: vi.fn(),
}));

vi.mock("./convex-utils.js", () => ({
  callConvexQuery: mocks.query,
  callConvexMutation: mocks.mutation,
}));

vi.mock("./config.js", () => ({
  config: { auth: { convexWriteSecret: "test-secret" } },
}));

vi.mock("./company-industry-recompute-service.js", () => ({
  companyIndustryRecomputeService: {
    list: mocks.recomputeList,
    start: mocks.recomputeStart,
  },
}));

import {
  getReviewedIndustryProfilesByKeys,
  loadReviewedIndustryCatalog,
} from "./company-industry-profile-service.js";
import {
  listIndustryEvidenceSources,
  upsertIndustryEvidenceSource,
} from "./company-industry-evidence-service.js";
import {
  approveIndustryProposal,
  listIndustryProposals,
  undoIndustryProposalApproval,
} from "./company-industry-proposal-service.js";
import { listIndustryVerdictRevisions } from "./company-industry-revision-service.js";
import { logger } from "./logger.js";

const reviewedSnapshot = {
  companyKey: "acme-cnc",
  companyName: "ACME CNC",
  industryClass: "cnc",
  verificationLevel: "verified",
  verdictRevisionId: "revision-1",
  evidenceSummary: "Official catalog confirms CNC machine tools.",
  reviewedAt: 100,
  reviewedBy: "reviewer-1",
  sourceCount: 1,
  sourcePreviews: [
    {
      sourceId: "source-1",
      url: "https://acme.example/products/cnc",
      sourceDomain: "acme.example",
      sourceType: "official_site",
      trustTier: "primary",
    },
  ],
  additionalSourceCount: 0,
};

describe("company industry API services", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("undoes an approval and reuses an existing replacement recompute run", async () => {
    mocks.mutation.mockResolvedValueOnce({
      proposalId: "proposal-1",
      companyKey: "acme-industrial",
      reversalRevisionId: "undo-revision-2",
      restoredRevisionId: "revision-1",
      previousRunId: "run-approved",
      previousRunStatus: "completed",
      replacementRecomputeRequired: true,
      idempotent: false,
    });
    mocks.recomputeList.mockResolvedValueOnce([
      {
        runId: "run-replacement",
        workspaceSlug: "hr",
        companyKey: "acme-industrial",
        targetRevisionId: "revision-1",
        proposalId: "proposal-1",
        requestedBy: "reviewer-42",
        status: "running",
        attempt: 1,
        sourceDone: false,
        pageCount: 0,
        affectedCount: 0,
        alreadyCurrentCount: 0,
        scheduledCount: 0,
        readyCount: 0,
        failureCount: 0,
        batchCount: 0,
        failures: [],
        createdAt: 10,
        updatedAt: 10,
        operatorSummary: "running",
      },
    ]);

    await expect(
      undoIndustryProposalApproval(
        {
          proposalId: "proposal-1",
          approvedRevisionId: "revision-2",
          expectedCurrentRevisionId: "revision-2",
          expectedProposalUpdatedAt: 123,
          recomputeRunId: "run-approved",
          workspaceSlug: "hr",
        },
        "reviewer-42",
      ),
    ).resolves.toEqual({
      proposalId: "proposal-1",
      reversalRevisionId: "undo-revision-2",
      restoredRevisionId: "revision-1",
      status: "ready_for_review",
      recompute: {
        previousRunId: "run-approved",
        previousRunStatus: "completed",
        replacementRunId: "run-replacement",
        status: "running",
      },
    });

    expect(mocks.mutation).toHaveBeenCalledWith(
      "companies:undoIndustryProposalApproval",
      {
        proposalId: "proposal-1",
        approvedRevisionId: "revision-2",
        expectedCurrentRevisionId: "revision-2",
        expectedProposalUpdatedAt: 123,
        recomputeRunId: "run-approved",
        reviewer: "reviewer-42",
        writeSecret: "test-secret",
      },
    );
    expect(mocks.recomputeList).toHaveBeenCalledWith({
      workspaceSlug: "hr",
      companyKey: "acme-industrial",
      limit: 100,
    });
    expect(mocks.recomputeStart).not.toHaveBeenCalled();
  });

  it("starts a replacement recompute when no matching restored-revision run exists", async () => {
    mocks.mutation.mockResolvedValueOnce({
      proposalId: "proposal-1",
      companyKey: "acme-industrial",
      reversalRevisionId: "undo-revision-2",
      restoredRevisionId: "revision-1",
      previousRunId: "run-approved",
      previousRunStatus: "completed",
      replacementRecomputeRequired: true,
      idempotent: false,
    });
    mocks.recomputeList.mockResolvedValueOnce([
      {
        runId: "run-other-revision",
        workspaceSlug: "hr",
        companyKey: "acme-industrial",
        targetRevisionId: "revision-3",
        status: "completed",
      },
    ]);
    mocks.recomputeStart.mockResolvedValueOnce({
      runId: "run-replacement-new",
      status: "queued",
    });

    await expect(
      undoIndustryProposalApproval(
        {
          proposalId: "proposal-1",
          approvedRevisionId: "revision-2",
          workspaceSlug: "hr",
        },
        "reviewer-42",
      ),
    ).resolves.toMatchObject({
      recompute: {
        previousRunId: "run-approved",
        previousRunStatus: "completed",
        replacementRunId: "run-replacement-new",
        status: "queued",
      },
    });

    expect(mocks.recomputeStart).toHaveBeenCalledWith({
      workspaceSlug: "hr",
      companyKey: "acme-industrial",
      targetRevisionId: "revision-1",
      proposalId: "proposal-1",
      requestedBy: "reviewer-42",
    });
  });

  it("translates a stale undo mutation into IndustryReviewStaleError", async () => {
    mocks.mutation.mockRejectedValueOnce(
      new Error("INDUSTRY_REVIEW_STALE: The approval is no longer current"),
    );

    await expect(
      undoIndustryProposalApproval(
        {
          proposalId: "proposal-1",
          approvedRevisionId: "revision-2",
          workspaceSlug: "hr",
        },
        "reviewer-42",
      ),
    ).rejects.toMatchObject({
      name: "IndustryReviewStaleError",
      code: "INDUSTRY_REVIEW_STALE",
      reason: "The approval is no longer current",
    });
    expect(mocks.recomputeList).not.toHaveBeenCalled();
    expect(mocks.recomputeStart).not.toHaveBeenCalled();
  });

  it("batch-loads reviewed catalog entries once, preserves key order, and diagnoses missing/invalid revisions", async () => {
    mocks.query.mockResolvedValueOnce([
      { companyKey: "acme-cnc", status: "reviewed", profile: reviewedSnapshot },
      { companyKey: "missing-company", status: "missing" },
      {
        companyKey: "broken-company",
        status: "invalid_current_revision",
        currentRevisionId: "missing-revision",
      },
    ]);

    const result = await getReviewedIndustryProfilesByKeys([
      " ACME-CNC ",
      "missing-company",
      "acme-cnc",
      "broken-company",
    ]);

    expect(mocks.query).toHaveBeenCalledTimes(1);
    expect(mocks.query).toHaveBeenCalledWith(
      "companies:getReviewedIndustryCatalogByKeys",
      {
        companyKeys: ["acme-cnc", "missing-company", "broken-company"],
        writeSecret: "test-secret",
      },
    );
    expect([...result.profiles.keys()]).toEqual(["acme-cnc"]);
    expect(result.missingCompanyKeys).toEqual(["missing-company"]);
    expect(result.diagnostics).toEqual([
      {
        companyKey: "broken-company",
        code: "invalid_current_revision",
        currentRevisionId: "missing-revision",
      },
    ]);
  });

  it("degrades catalog lookup conservatively when Convex is unavailable", async () => {
    mocks.query.mockRejectedValueOnce(new Error("connection refused"));

    const result = await loadReviewedIndustryCatalog(["acme-cnc"]);

    expect(result.degraded).toBe(true);
    expect(result.profiles.size).toBe(0);
    expect(result.error).toContain("connection refused");
  });

  it("strictly parses evidence and rejects unsafe URLs before mutation", async () => {
    mocks.query.mockResolvedValueOnce([
      {
        _id: "row-1",
        sourceId: "source-1",
        companyKey: "acme-cnc",
        url: "https://acme.example/products/cnc",
        sourceDomain: "acme.example",
        sourceType: "official_site",
        trustTier: "primary",
        fetchStatus: "fetched",
        reviewStatus: "approved",
        sourceState: "active",
        createdAt: 1,
        updatedAt: 2,
      },
    ]);

    await expect(
      upsertIndustryEvidenceSource({
        sourceId: "unsafe",
        companyKey: "acme-cnc",
        url: "http://127.0.0.1/private",
        sourceType: "official_site",
        trustTier: "primary",
        fetchStatus: "fetched",
      }),
    ).rejects.toThrow("safe public HTTP(S) URL");
    expect(mocks.mutation).not.toHaveBeenCalled();

    const sources = await listIndustryEvidenceSources({ companyKey: "acme-cnc" });
    expect(sources).toHaveLength(1);
    expect(sources[0]?.sourceDomain).toBe("acme.example");
  });

  it("propagates the authenticated reviewer to approval mutations", async () => {
    mocks.mutation.mockResolvedValueOnce({
      proposalId: "proposal-1",
      revisionId: "revision-2",
      companyKey: "acme-cnc",
    });

    await approveIndustryProposal(
      {
        proposalId: "proposal-1",
        revisionId: "revision-2",
        verificationLevel: "verified",
        industryClass: "cnc",
        approvedSourceIds: ["source-1"],
        evidenceSummary: "Reviewed summary",
        decisionReason: "Primary source confirms CNC products",
        taxonomyVersion: "industry-v1",
      },
      "reviewer-42",
    );

    expect(mocks.mutation).toHaveBeenCalledWith(
      "companies:approveIndustryProposal",
      expect.objectContaining({
        reviewer: "reviewer-42",
        writeSecret: "test-secret",
      }),
    );
  });

  it("strictly parses proposal and revision lists", async () => {
    mocks.query
      .mockResolvedValueOnce([
        {
          _id: "proposal-row",
          proposalId: "proposal-1",
          companyKey: "acme-cnc",
          triggerReasons: ["unknown_employer"],
          priority: 50,
          sampleReferences: [
            {
              workspaceSlug: "my",
              resumeIdentity: "resume-1",
              workEntryFingerprint: "work-1",
            },
          ],
          status: "ready_for_review",
          createdAt: 1,
          updatedAt: 2,
        },
      ])
      .mockResolvedValueOnce([
        {
          _id: "revision-row",
          revisionId: "revision-1",
          companyKey: "acme-cnc",
          industryClass: "cnc",
          verificationLevel: "verified",
          approvedSourceIds: ["source-1"],
          evidenceSummary: "Reviewed",
          reviewedBy: "reviewer-1",
          reviewedAt: 100,
          decisionReason: "Confirmed",
          taxonomyVersion: "industry-v1",
          createdAt: 100,
        },
      ]);

    await expect(listIndustryProposals()).resolves.toEqual([
      expect.objectContaining({
        sampleReferences: [
          {
            workspaceSlug: "my",
            resumeIdentity: "resume-1",
            workEntryFingerprint: "work-1",
          },
        ],
      }),
    ]);
    await expect(
      listIndustryVerdictRevisions("acme-cnc"),
    ).resolves.toHaveLength(1);
  });

  it("skips malformed terminal proposal rows without failing the history list", async () => {
    const warning = vi.spyOn(logger, "warn").mockImplementation(() => {});
    try {
      mocks.query.mockResolvedValueOnce([
        {
          _id: "valid-row",
          proposalId: "valid-superseded-proposal",
          companyKey: "valid-company",
          triggerReasons: ["scheduled_freshness"],
          priority: 20,
          status: "superseded",
          createdAt: 1,
          updatedAt: 2,
        },
        {
          _id: "legacy-row",
          proposalId: "probe-nonexistent-xyz",
          companyKey: "legacy-company",
          triggerReasons: ["probe"],
          priority: 1,
          status: "superseded",
          createdAt: 1,
          updatedAt: 2,
        },
      ]);

      await expect(listIndustryProposals("superseded")).resolves.toEqual([
        expect.objectContaining({ proposalId: "valid-superseded-proposal" }),
      ]);
      expect(warning).toHaveBeenCalledWith(
        "Skipping invalid industry proposal record",
        {
          status: "superseded",
          proposalId: "probe-nonexistent-xyz",
        },
      );
    } finally {
      warning.mockRestore();
    }
  });
});
