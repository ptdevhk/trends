import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  query: vi.fn(),
  mutation: vi.fn(),
  resolveSurfaces: vi.fn(),
  getProfile: vi.fn(),
  upsertProposal: vi.fn(),
}));

vi.mock("./convex-utils.js", () => ({
  callConvexQuery: mocks.query,
  callConvexMutation: mocks.mutation,
}));

vi.mock("./config.js", () => ({
  config: { auth: { convexWriteSecret: "test-secret" } },
}));

vi.mock("./company-industry-profile-service.js", () => ({
  resolveCompanyKeysForEmployerSurfaces: mocks.resolveSurfaces,
  getIndustryProfile: mocks.getProfile,
}));

vi.mock("./company-industry-proposal-service.js", () => ({
  upsertIndustryProposal: mocks.upsertProposal,
}));

import {
  buildIndustryMaintenanceCandidates,
  promoteIndustryMaintenanceCandidates,
} from "./industry-maintenance-trigger-service.js";
import { requestCompanyIndustryEvidenceRefresh } from "./company-industry-refresh-request-service.js";

describe("industry hybrid maintenance services", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("deduplicates resolved and unresolved ingest events with bounded privacy-safe references", () => {
    const events = Array.from({ length: 14 }, (_, index) => ({
      employerSurface:
        index % 2 === 0 ? "ACME CNC Sdn Bhd" : "Acme CNC Sdn. Bhd.",
      unresolvedReason: "miss" as const,
      nearbyScore: index === 0 ? 88 : 40,
      directRoleYears: index === 0 ? 3 : 0,
      workspaceSlug: "my",
      resumeIdentity: `resume-${index}`,
      workEntryFingerprint: `work-${index}`,
      // Deliberately no raw resume content/body property in the contract.
    }));
    const normalized = new Map([["acme cnc sdn bhd", "acme-cnc"]]);

    const candidates = buildIndustryMaintenanceCandidates(events, normalized);

    expect(candidates).toHaveLength(1);
    expect(candidates[0]).toMatchObject({
      companyKey: "acme-cnc",
      triggerReasons: [
        "frequent_employer",
        "high_value_candidate",
        "unknown_employer",
      ],
      priority: 75,
    });
    expect(candidates[0]?.sampleReferences).toHaveLength(10);
    expect(JSON.stringify(candidates[0])).not.toContain("body");
    expect(JSON.stringify(candidates[0])).not.toContain("ACME CNC Sdn Bhd");
  });

  it("promotes one durable proposal per canonical company and reports coalescing", async () => {
    mocks.resolveSurfaces.mockResolvedValue({
      companyKeysByNormalizedSurface: new Map([
        ["acme cnc", "acme-cnc"],
      ]),
      missingNormalizedSurfaces: [],
      degraded: false,
    });
    const upsert = vi
      .fn()
      .mockResolvedValueOnce({ proposalId: "existing", created: false });

    const result = await promoteIndustryMaintenanceCandidates(
      [
        {
          employerSurface: "ACME CNC",
          unresolvedReason: "miss",
          nearbyScore: 75,
        },
        {
          employerSurface: "acme cnc",
          unresolvedReason: "low_confidence_keyword",
        },
      ],
      {
        resolveEmployerSurfaces: mocks.resolveSurfaces,
        upsertProposal: upsert,
      },
    );

    expect(upsert).toHaveBeenCalledTimes(1);
    expect(upsert.mock.calls[0]?.[0]).toMatchObject({
      companyKey: "acme-cnc",
      triggerReasons: [
        "high_value_candidate",
        "unknown_employer",
        "weak_employer_evidence",
      ],
    });
    expect(result).toMatchObject({
      created: 0,
      coalesced: 1,
      degradedResolution: false,
    });
  });

  it("coalesces authorized recruiter refresh requests and returns no internal findings", async () => {
    mocks.getProfile.mockResolvedValue({
      companyKey: "acme-cnc",
      currentRevisionId: "revision-1",
      verificationLevel: "verified",
    });
    mocks.upsertProposal.mockResolvedValue({
      proposalId: "proposal-open",
      created: false,
    });
    mocks.query.mockResolvedValue({
      resumeIdentity: "resume-1",
      workEntryFingerprint: "work-1",
    });
    mocks.mutation.mockResolvedValue({
      requestId: "industry-refresh-request-1",
      created: true,
      proposalId: "proposal-open",
    });

    const result = await requestCompanyIndustryEvidenceRefresh({
      companyKey: "ACME-CNC",
      currentRevisionId: "revision-1",
      workspaceSlug: "my",
      requesterId: "recruiter-42",
      reasonCode: "stale",
      note: "Official page looks old",
      resumeIdentity: "resume-1",
      workEntryFingerprint: "work-1",
    });

    expect(mocks.upsertProposal).toHaveBeenCalledWith(
      expect.objectContaining({
        companyKey: "acme-cnc",
        triggerReasons: ["recruiter_refresh_request"],
        priority: 100,
        currentRevisionId: "revision-1",
        requestedBy: "recruiter-42",
      }),
    );
    expect(mocks.query).toHaveBeenCalledWith(
      "companies:resolveIndustryRefreshResumeReference",
      {
        workspaceSlug: "my",
        companyKey: "acme-cnc",
        verdictRevisionId: "revision-1",
        resumeReference: "resume-1",
        writeSecret: "test-secret",
      },
    );
    expect(mocks.mutation).toHaveBeenCalledWith(
      "companies:recordIndustryRefreshRequest",
      expect.objectContaining({
        proposalId: "proposal-open",
        companyKey: "acme-cnc",
        verdictRevisionId: "revision-1",
        workspaceSlug: "my",
        requesterId: "recruiter-42",
        reasonCode: "stale",
      }),
    );
    expect(result).toEqual({
      companyKey: "acme-cnc",
      currentRevisionId: "revision-1",
      proposalId: "proposal-open",
      status: "already_pending",
    });
    expect(result).not.toHaveProperty("sources");
    expect(result).not.toHaveProperty("workerConfidence");
  });

  it("rejects stale recruiter revisions and oversized notes before proposal creation", async () => {
    mocks.getProfile.mockResolvedValue({
      companyKey: "acme-cnc",
      currentRevisionId: "revision-2",
      verificationLevel: "verified",
    });

    await expect(
      requestCompanyIndustryEvidenceRefresh({
        companyKey: "acme-cnc",
        currentRevisionId: "revision-1",
        workspaceSlug: "my",
        requesterId: "recruiter-42",
        reasonCode: "stale",
      }),
    ).rejects.toThrow(/revision is stale/i);

    await expect(
      requestCompanyIndustryEvidenceRefresh({
        companyKey: "acme-cnc",
        currentRevisionId: "revision-2",
        workspaceSlug: "my",
        requesterId: "recruiter-42",
        reasonCode: "incorrect",
        note: "x".repeat(301),
      }),
    ).rejects.toThrow(/300 characters/i);
    expect(mocks.upsertProposal).not.toHaveBeenCalled();
  });

  it("rejects recruiter resume references outside the active workspace/company revision", async () => {
    mocks.getProfile.mockResolvedValue({
      companyKey: "acme-cnc",
      currentRevisionId: "revision-2",
      verificationLevel: "verified",
    });
    mocks.query.mockResolvedValue(null);

    await expect(
      requestCompanyIndustryEvidenceRefresh({
        companyKey: "acme-cnc",
        currentRevisionId: "revision-2",
        workspaceSlug: "my",
        requesterId: "recruiter-42",
        reasonCode: "stale",
        resumeIdentity: "resume-from-other-workspace",
      }),
    ).rejects.toThrow(/does not belong to this workspace/i);
    expect(mocks.upsertProposal).not.toHaveBeenCalled();
    expect(mocks.mutation).not.toHaveBeenCalled();
  });
});
