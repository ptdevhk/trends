import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  query: vi.fn(),
  mutation: vi.fn(),
}));

vi.mock("./convex-utils.js", () => ({
  callConvexQuery: mocks.query,
  callConvexMutation: mocks.mutation,
}));

vi.mock("./config.js", () => ({
  config: { auth: { convexWriteSecret: "test-secret" } },
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
} from "./company-industry-proposal-service.js";
import { listIndustryVerdictRevisions } from "./company-industry-revision-service.js";

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
});
