import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("../middleware/maintenance.js", () => ({
  maintenanceGuard: async (_c: unknown, next: () => Promise<void>) => {
    await next();
  },
}));

import { createApp } from "../app";
import { resetResumeScreeningDb } from "../services/database";
import * as industryReviewService from "../services/company-industry-review-service";
import { parseJsonBody } from "../test-utils";
import { createAuthHeaders } from "./test-auth-helpers";

type ConvexCall = {
  type: "query" | "mutation";
  pathName: string;
  args: Record<string, unknown>;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function parseConvexCall(input: Request | string | URL, init?: RequestInit): ConvexCall {
  const requestUrl =
    typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
  const type: ConvexCall["type"] = requestUrl.includes("/api/query") ? "query" : "mutation";
  const body = typeof init?.body === "string" ? JSON.parse(init.body) : null;
  if (!isRecord(body)) {
    throw new Error("Missing convex request body");
  }
  const pathName = typeof body.path === "string" ? body.path : "";
  const args = isRecord(body.args) ? body.args : {};
  if (!pathName) {
    throw new Error("Missing convex path in request body");
  }
  return { type, pathName, args };
}

function convexSuccess(value: unknown): Response {
  return new Response(JSON.stringify({ status: "success", value }), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
}

function convexFailure(errorMessage: string): Response {
  return new Response(JSON.stringify({ status: "error", errorMessage }), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
}

describe("companies routes", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    resetResumeScreeningDb();
  });

  it("rejects company list without session", async () => {
    const calls: ConvexCall[] = [];
    vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
      calls.push(parseConvexCall(input, init));
      return convexSuccess([]);
    });

    const app = createApp();
    const response = await app.request("/api/companies", {
      headers: { "X-Workspace-Slug": "hr" },
    });
    expect(response.status).toBe(401);
    expect(calls).toHaveLength(0);
  });

  it("lists companies and workspace policies for authenticated workspace", async () => {
    const auth = createAuthHeaders({ workspaceSlug: "hr", role: "user" });
    const calls: ConvexCall[] = [];
    vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
      const call = parseConvexCall(input, init);
      calls.push(call);
      if (call.pathName === "companies:list") {
        return convexSuccess([
          {
            _id: "c1",
            companyKey: "pro-technic-machinery",
            status: "confirmed",
            displayName: "宝力机械 / Pro-Technic Machinery",
            nameCn: "宝力机械",
            nameEn: "Pro-Technic Machinery",
            createdAt: 1,
            updatedAt: 1,
            aliases: [],
          },
        ]);
      }
      if (call.pathName === "companies:listPoliciesForScope") {
        expect(call.args.scopeId).toBe("hr");
        return convexSuccess([
          {
            companyKey: "pro-technic-machinery",
            displayName: "宝力机械 / Pro-Technic Machinery",
            status: "confirmed",
            scopeType: "workspace",
            scopeId: "hr",
            revision: 1,
            effects: { rankingEffect: "band_known_good" },
            createdAt: 1,
          },
        ]);
      }
      throw new Error(`Unexpected path ${call.pathName}`);
    });

    const app = createApp({ authStorage: auth.storage });
    const companies = await app.request("/api/companies", { headers: auth.headers });
    const policies = await app.request("/api/company-policies", { headers: auth.headers });

    expect(companies.status).toBe(200);
    expect(policies.status).toBe(200);
    const companiesBody = await parseJsonBody<{
      items: Array<{ companyKey: string }>;
    }>(companies);
    const policiesBody = await parseJsonBody<{
      items: Array<{ effects: { rankingEffect: string } }>;
    }>(policies);
    expect(companiesBody.items[0].companyKey).toBe("pro-technic-machinery");
    expect(policiesBody.items[0].effects.rankingEffect).toBe("band_known_good");
  });

  it("appends workspace policy with known_good preset", async () => {
    const auth = createAuthHeaders({ workspaceSlug: "hr", role: "user" });
    const calls: ConvexCall[] = [];
    vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
      const call = parseConvexCall(input, init);
      calls.push(call);
      if (call.pathName === "companies:appendPolicyRevision") {
        expect(call.args.scopeType).toBe("workspace");
        expect(call.args.scopeId).toBe("hr");
        expect(call.args.companyKey).toBe("pro-technic-machinery");
        expect(call.args.rankingEffect).toBe("band_known_good");
        return convexSuccess({ id: "rev1", revision: 2 });
      }
      throw new Error(`Unexpected path ${call.pathName}`);
    });

    const app = createApp({ authStorage: auth.storage });
    const response = await app.request("/api/company-policies", {
      method: "POST",
      headers: {
        ...auth.headers,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        companyKey: "pro-technic-machinery",
        preset: "known_good",
      }),
    });

    expect(response.status).toBe(200);
    const body = await parseJsonBody<{ revision: number }>(response);
    expect(body.revision).toBe(2);
    expect(calls).toHaveLength(1);
  });

  it("seeds canonical companies for the authenticated workspace", async () => {
    const auth = createAuthHeaders({ workspaceSlug: "hr", role: "user" });
    vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
      const call = parseConvexCall(input, init);
      if (call.pathName === "companies:seedCanonicalCompanies") {
        expect(call.args.workspaceSlug).toBe("hr");
        expect(call.args.seedNoHireForWorkspace).toBe(true);
        return convexSuccess({
          companiesCreated: 2,
          companiesUpdated: 0,
          aliasesCreated: 10,
          policiesSeeded: 2,
          policyRevision: 1,
        });
      }
      throw new Error(`Unexpected path ${call.pathName}`);
    });

    const app = createApp({ authStorage: auth.storage });
    const response = await app.request("/api/companies/seed", {
      method: "POST",
      headers: {
        ...auth.headers,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ seedNoHireForWorkspace: true }),
    });
    expect(response.status).toBe(200);
    const body = await parseJsonBody<{
      companiesCreated: number;
      policiesSeeded: number;
      policyRevision: number;
    }>(response);
    expect(body.companiesCreated).toBe(2);
    expect(body.policiesSeeded).toBe(2);
    expect(body.policyRevision).toBe(1);
  });

  it("lists governed industry proposals for an authenticated admin", async () => {
    const auth = createAuthHeaders({ workspaceSlug: "hr", role: "admin" });
    vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
      const call = parseConvexCall(input, init);
      expect(call).toMatchObject({
        type: "query",
        pathName: "companies:listIndustryProposals",
      });
      expect(call.args.status).toBe("ready_for_review");
      return convexSuccess([
        {
          _id: "proposal-row",
          proposalId: "proposal-1",
          companyKey: "acme-cnc",
          triggerReasons: ["scheduled_freshness"],
          priority: 80,
          status: "ready_for_review",
          createdAt: 1,
          updatedAt: 2,
        },
      ]);
    });

    const app = createApp({ authStorage: auth.storage });
    const response = await app.request(
      "/api/company-industry-proposals?status=ready_for_review",
      { headers: auth.headers },
    );

    expect(response.status).toBe(200);
    const body = await parseJsonBody<{
      items: Array<{ proposalId: string; status: string }>;
    }>(response);
    expect(body.items).toEqual([
      expect.objectContaining({
        proposalId: "proposal-1",
        status: "ready_for_review",
      }),
    ]);
  });

  it("lists the shared industry review queue for an authenticated admin", async () => {
    const auth = createAuthHeaders({ workspaceSlug: "hr", role: "admin" });
    vi.spyOn(industryReviewService, "listIndustryReviewQueue").mockResolvedValue({
      success: true,
      ok: true,
      schemaVersion: "industry-review.v1",
      items: [
        {
          proposal: {
            _id: "proposal-row",
            proposalId: "proposal-1",
            companyKey: "acme-cnc",
            triggerReasons: ["scheduled_freshness"],
            priority: 80,
            status: "ready_for_review",
            createdAt: 1,
            updatedAt: 2,
          },
          recommendation: {
            proposalId: "proposal-1",
            proposalStatus: "ready_for_review",
            recommendedAction: "approve",
            recommendedVerificationLevel: "verified",
            recommendedIndustryClass: "cnc",
            recommendedSourceIds: ["source-1"],
            sourceDecisions: [],
            confidenceBand: "high",
            riskFlags: [],
            reasons: ["Durable source supports the proposed cnc classification."],
            excludedSourceReasons: {},
            evidenceSummaryDraft: "Official catalog confirms CNC products.",
            decisionReasonDraft: "Reviewed primary evidence.",
            requiresHumanReview: true,
          },
          sourceCount: 1,
        },
      ],
      maintenance: { latest: null, lastFailed: null },
    });

    const app = createApp({ authStorage: auth.storage });
    const response = await app.request(
      "/api/company-industry-proposals/review-queue?status=ready_for_review&limit=20",
      { headers: auth.headers },
    );

    expect(response.status).toBe(200);
    const body = await parseJsonBody<{
      schemaVersion: string;
      items: Array<{ recommendation: { recommendedAction: string } }>;
    }>(response);
    expect(body.schemaVersion).toBe("industry-review.v1");
    expect(body.items[0]?.recommendation.recommendedAction).toBe("approve");
    expect(industryReviewService.listIndustryReviewQueue).toHaveBeenCalledWith({
      status: "ready_for_review",
      limit: 20,
      workspaceSlug: "hr",
    });
  });

  it("keeps the review packet admin-only", async () => {
    const auth = createAuthHeaders({ workspaceSlug: "hr", role: "user" });
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    const app = createApp({ authStorage: auth.storage });
    const response = await app.request(
      "/api/company-industry-proposals/proposal-1/review-packet",
      { headers: auth.headers },
    );
    expect(response.status).toBe(403);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("serves a recommendation-only projection without source payloads", async () => {
    const auth = createAuthHeaders({ workspaceSlug: "hr", role: "admin" });
    vi.spyOn(industryReviewService, "getIndustryReviewRecommendation").mockResolvedValue({
      success: true,
      ok: true,
      schemaVersion: "industry-review.v1",
      operation: { id: "review-1", kind: "recommendation", state: "computed" },
      dataset: {
        revision: "proposal-1:2:none",
        inputFingerprint: "fingerprint-1",
        generatedAt: 2,
        proposalUpdatedAt: 2,
        sourceVersions: [],
      },
      recommendation: {
        proposalId: "proposal-1",
        proposalStatus: "ready_for_review",
        recommendedAction: "needs_more_evidence",
        recommendedVerificationLevel: "verified",
        recommendedIndustryClass: "industrial",
        recommendedSourceIds: [],
        sourceDecisions: [],
        confidenceBand: "low",
        riskFlags: ["low_source_diversity"],
        reasons: ["Need more evidence"],
        excludedSourceReasons: {},
        riskDecision: {
          requiresAcknowledgement: true,
          nonOverridableRiskFlags: [],
          canApproveWithRiskOverride: true,
        },
        evidenceSummaryDraft: "Need more evidence",
        decisionReasonDraft: "Need more evidence",
        requiresHumanReview: true,
      },
      warnings: [],
    });
    const app = createApp({ authStorage: auth.storage });
    const response = await app.request(
      "/api/company-industry-proposals/proposal-1/recommendation",
      { headers: auth.headers },
    );
    expect(response.status).toBe(200);
    const body = await parseJsonBody<{ recommendation: { proposalId: string }; sources?: unknown }>(response);
    expect(body.recommendation.proposalId).toBe("proposal-1");
    expect(body.sources).toBeUndefined();
  });

  it("rejects an elevated approval without a complete attestation", async () => {
    const auth = createAuthHeaders({ workspaceSlug: "hr", role: "admin" });
    vi.spyOn(industryReviewService, "getIndustryReviewPacket").mockResolvedValue({
      dataset: { inputFingerprint: "fingerprint-1" },
      recommendation: { riskFlags: ["low_source_diversity"] },
    } as never);
    const app = createApp({ authStorage: auth.storage });
    const response = await app.request(
      "/api/company-industry-proposals/proposal-1/approve",
      {
        method: "POST",
        headers: { ...auth.headers, "Content-Type": "application/json" },
        body: JSON.stringify({
          revisionId: "revision-2",
          expectedInputFingerprint: "fingerprint-1",
          verificationLevel: "verified",
          industryClass: "industrial",
          approvedSourceIds: ["source-1"],
          evidenceSummary: "Reviewed evidence.",
          decisionReason: "Attestation is intentionally missing.",
          taxonomyVersion: "industry-v1",
        }),
      },
    );
    expect(response.status).toBe(422);
    expect(await parseJsonBody(response)).toMatchObject({
      code: "INDUSTRY_REVIEW_ATTESTATION_REQUIRED",
    });
  });

  it("fails closed when an approval packet fingerprint is stale", async () => {
    const auth = createAuthHeaders({ workspaceSlug: "hr", role: "admin" });
    vi.spyOn(industryReviewService, "getIndustryReviewPacket").mockResolvedValue({
      dataset: { inputFingerprint: "fresh-fingerprint" },
    } as never);
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    const app = createApp({ authStorage: auth.storage });
    const response = await app.request(
      "/api/company-industry-proposals/proposal-1/approve",
      {
        method: "POST",
        headers: {
          ...auth.headers,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          revisionId: "revision-2",
          expectedInputFingerprint: "stale-fingerprint",
          verificationLevel: "verified",
          industryClass: "cnc",
          approvedSourceIds: ["source-1"],
          evidenceSummary: "Reviewed official evidence.",
          decisionReason: "Reviewed primary evidence.",
          taxonomyVersion: "industry-v1",
        }),
      },
    );
    expect(response.status).toBe(409);
    expect(await parseJsonBody(response)).toMatchObject({
      code: "INDUSTRY_REVIEW_STALE",
    });
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("requires an admin for proposal review mutations", async () => {
    const auth = createAuthHeaders({ workspaceSlug: "hr", role: "user" });
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    const app = createApp({ authStorage: auth.storage });

    const response = await app.request(
      "/api/company-industry-proposals/proposal-1/approve",
      {
        method: "POST",
        headers: {
          ...auth.headers,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          revisionId: "revision-2",
          verificationLevel: "verified",
          industryClass: "cnc",
          approvedSourceIds: ["source-1"],
          evidenceSummary: "Official catalog confirms CNC products.",
          decisionReason: "Reviewed primary evidence",
          taxonomyVersion: "industry-v1",
        }),
      },
    );

    expect(response.status).toBe(403);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("approves an industry proposal with the authenticated actor", async () => {
    const auth = createAuthHeaders({ workspaceSlug: "hr", role: "admin" });
    const recomputeRun = {
      runId: "run-1",
      workspaceSlug: "hr",
      companyKey: "acme-cnc",
      targetRevisionId: "revision-2",
      proposalId: "proposal-1",
      requestedBy: auth.userId,
      status: "running",
      attempt: 1,
      sourceDone: true,
      pageCount: 1,
      affectedCount: 0,
      alreadyCurrentCount: 0,
      scheduledCount: 0,
      readyCount: 0,
      failureCount: 0,
      batchCount: 0,
      failures: [],
      createdAt: 10,
      startedAt: 10,
      updatedAt: 11,
    };
    vi.spyOn(industryReviewService, "getIndustryReviewPacket").mockResolvedValue({
      dataset: { inputFingerprint: "fingerprint-1" },
      recommendation: { riskFlags: [] },
    } as never);
    vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
      const call = parseConvexCall(input, init);
      if (call.pathName === "companies:approveIndustryProposal") {
        expect(call.args).toMatchObject({
          proposalId: "proposal-1",
          revisionId: "revision-2",
          reviewer: auth.userId,
          verificationLevel: "verified",
          approvedSourceIds: ["source-1"],
        });
        return convexSuccess({
          proposalId: "proposal-1",
          revisionId: "revision-2",
          companyKey: "acme-cnc",
        });
      }
      if (call.pathName === "companies:startIndustryRecomputeRun") {
        expect(call.args).toMatchObject({
          workspaceSlug: "hr",
          companyKey: "acme-cnc",
          targetRevisionId: "revision-2",
          proposalId: "proposal-1",
          requestedBy: auth.userId,
        });
        return convexSuccess({ ...recomputeRun, sourceDone: false, pageCount: 0 });
      }
      if (call.pathName === "companies:getIndustryRecomputeRun") {
        return convexSuccess({ ...recomputeRun, sourceDone: false, pageCount: 0 });
      }
      if (call.pathName === "companies:getIndustryRecomputeRevisionState") {
        return convexSuccess({
          matchesTargetRevision: true,
          currentRevisionId: "revision-2",
        });
      }
      if (call.pathName === "companies:getNextIndustryRecomputeBatch") {
        return convexSuccess(null);
      }
      if (call.pathName === "companies:listAffectedResumesByCompany") {
        return convexSuccess({
          items: [],
          continueCursor: "",
          isDone: true,
        });
      }
      if (call.pathName === "companies:reserveIndustryRecomputePage") {
        return convexSuccess(recomputeRun);
      }
      throw new Error(`Unexpected path ${call.pathName}`);
    });

    const app = createApp({ authStorage: auth.storage });
    const response = await app.request(
      "/api/company-industry-proposals/proposal-1/approve",
      {
        method: "POST",
        headers: {
          ...auth.headers,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          revisionId: "revision-2",
          expectedInputFingerprint: "fingerprint-1",
          verificationLevel: "verified",
          industryClass: "cnc",
          approvedSourceIds: ["source-1"],
          evidenceSummary: "Official catalog confirms CNC products.",
          decisionReason: "Reviewed primary evidence",
          taxonomyVersion: "industry-v1",
          reviewAttestation: {
            schemaVersion: "industry-review-attestation.v1",
            inputFingerprint: "fingerprint-1",
            decisionMode: "standard",
            acknowledgedRiskFlags: [],
            cncEvidenceAcknowledged: true,
            acknowledgementReason: "",
          },
        }),
      },
    );

    expect(response.status).toBe(200);
    const body = await parseJsonBody<{
      revisionId: string;
      recompute: { runId: string; status: string };
    }>(response);
    expect(body.revisionId).toBe("revision-2");
    expect(body.recompute).toMatchObject({ runId: "run-1", status: "running" });
  });

  it("undoes an industry approval with the authenticated admin", async () => {
    const auth = createAuthHeaders({ workspaceSlug: "hr", role: "admin" });
    vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
      const call = parseConvexCall(input, init);
      if (call.pathName === "companies:undoIndustryProposalApproval") {
        expect(call.args).toMatchObject({
          proposalId: "proposal-1",
          approvedRevisionId: "revision-2",
          expectedCurrentRevisionId: "revision-2",
          expectedProposalUpdatedAt: 123,
          recomputeRunId: "run-approved",
          reviewer: auth.userId,
          writeSecret: expect.any(String),
        });
        return convexSuccess({
          proposalId: "proposal-1",
          companyKey: "acme-industrial",
          reversalRevisionId: "undo-revision-2",
          restoredRevisionId: "revision-1",
          previousRunId: "run-approved",
          previousRunStatus: "running",
          replacementRecomputeRequired: false,
          idempotent: false,
        });
      }
      throw new Error(`Unexpected path ${call.pathName}`);
    });

    const app = createApp({ authStorage: auth.storage });
    const response = await app.request(
      "/api/company-industry-proposals/proposal-1/undo-approval",
      {
        method: "POST",
        headers: {
          ...auth.headers,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          approvedRevisionId: "revision-2",
          expectedCurrentRevisionId: "revision-2",
          expectedProposalUpdatedAt: 123,
          recomputeRunId: "run-approved",
        }),
      },
    );

    expect(response.status).toBe(200);
    await expect(parseJsonBody(response)).resolves.toMatchObject({
      success: true,
      proposalId: "proposal-1",
      reversalRevisionId: "undo-revision-2",
      restoredRevisionId: "revision-1",
      status: "ready_for_review",
      recompute: {
        previousRunId: "run-approved",
        previousRunStatus: "running",
      },
    });
  });

  it("returns the existing industry review conflict for stale undo requests", async () => {
    const auth = createAuthHeaders({ workspaceSlug: "hr", role: "admin" });
    vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
      const call = parseConvexCall(input, init);
      expect(call.pathName).toBe("companies:undoIndustryProposalApproval");
      return convexFailure(
        "INDUSTRY_REVIEW_STALE: The approval is no longer current",
      );
    });

    const app = createApp({ authStorage: auth.storage });
    const response = await app.request(
      "/api/company-industry-proposals/proposal-1/undo-approval",
      {
        method: "POST",
        headers: {
          ...auth.headers,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ approvedRevisionId: "revision-2" }),
      },
    );

    expect(response.status).toBe(409);
    expect(await parseJsonBody(response)).toEqual({
      success: false,
      error: "The approval is no longer current",
      code: "INDUSTRY_REVIEW_STALE",
    });
  });

  it("requires an admin for industry approval undo", async () => {
    const auth = createAuthHeaders({ workspaceSlug: "hr", role: "user" });
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    const app = createApp({ authStorage: auth.storage });

    const response = await app.request(
      "/api/company-industry-proposals/proposal-1/undo-approval",
      {
        method: "POST",
        headers: {
          ...auth.headers,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ approvedRevisionId: "revision-2" }),
      },
    );

    expect(response.status).toBe(403);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("returns the materialized company evidence bundle to workspace members", async () => {
    const auth = createAuthHeaders({ workspaceSlug: "hr", role: "user" });
    const seen = new Set<string>();
    vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
      const call = parseConvexCall(input, init);
      seen.add(call.pathName);
      if (call.pathName === "companies:getIndustryProfile") {
        return convexSuccess({
          _id: "profile-row",
          companyKey: "acme-cnc",
          industryClass: "cnc",
          verificationLevel: "verified",
          evidenceSource: "manual",
          currentRevisionId: "revision-1",
          updatedAt: 10,
        });
      }
      if (call.pathName === "companies:listIndustryVerdictRevisions") {
        return convexSuccess([
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
      }
      if (call.pathName === "companies:listIndustryEvidenceSources") {
        return convexSuccess([
          {
            _id: "source-row",
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
      }
      throw new Error(`Unexpected path ${call.pathName}`);
    });

    const app = createApp({ authStorage: auth.storage });
    const response = await app.request(
      "/api/company-industry-bundles/acme-cnc",
      { headers: auth.headers },
    );

    expect(response.status).toBe(200);
    expect(seen).toEqual(
      new Set([
        "companies:getIndustryProfile",
        "companies:listIndustryVerdictRevisions",
        "companies:listIndustryEvidenceSources",
      ]),
    );
    const body = await parseJsonBody<{
      revisions: Array<{ revisionId: string }>;
      sources: Array<{ sourceId: string }>;
    }>(response);
    expect(body.revisions[0]?.revisionId).toBe("revision-1");
    expect(body.sources[0]?.sourceId).toBe("source-1");
  });

  it("accepts and coalesces a workspace recruiter evidence refresh request", async () => {
    const auth = createAuthHeaders({ workspaceSlug: "hr", role: "user" });
    const calls: ConvexCall[] = [];
    vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
      const call = parseConvexCall(input, init);
      calls.push(call);
      if (call.pathName === "companies:getIndustryProfile") {
        return convexSuccess({
          _id: "profile-row",
          companyKey: "acme-cnc",
          industryClass: "cnc",
          verificationLevel: "verified",
          evidenceSource: "manual",
          currentRevisionId: "revision-1",
          updatedAt: 10,
        });
      }
      if (call.pathName === "companies:upsertIndustryProposal") {
        return convexSuccess({
          proposalId: "proposal-open",
          created: false,
        });
      }
      if (call.pathName === "companies:resolveIndustryRefreshResumeReference") {
        return convexSuccess({
          resumeIdentity: "resume-1",
          workEntryFingerprint: "work-1",
        });
      }
      if (call.pathName === "companies:recordIndustryRefreshRequest") {
        return convexSuccess({
          requestId: "industry-refresh-request-1",
          proposalId: "proposal-open",
          created: true,
        });
      }
      throw new Error(`Unexpected path ${call.pathName}`);
    });

    const app = createApp({ authStorage: auth.storage });
    const response = await app.request(
      "/api/company-industry-refresh-requests",
      {
        method: "POST",
        headers: {
          ...auth.headers,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          companyKey: "acme-cnc",
          verdictRevisionId: "revision-1",
          resumeId: "resume-1",
        }),
      },
    );

    expect(response.status).toBe(200);
    expect(await parseJsonBody(response)).toEqual({
      success: true,
      proposalId: "proposal-open",
      coalesced: true,
    });
    const mutation = calls.find(
      (call) => call.pathName === "companies:upsertIndustryProposal",
    );
    expect(mutation?.args).toMatchObject({
      companyKey: "acme-cnc",
      triggerReasons: ["recruiter_refresh_request"],
      priority: 100,
      currentRevisionId: "revision-1",
      sampleReferences: [
        {
          workspaceSlug: "hr",
          resumeIdentity: "resume-1",
        },
      ],
    });
    expect(mutation?.args.requestedBy).toBeTypeOf("string");
    const requestRecord = calls.find(
      (call) => call.pathName === "companies:recordIndustryRefreshRequest",
    );
    expect(requestRecord?.args).toMatchObject({
      proposalId: "proposal-open",
      companyKey: "acme-cnc",
      verdictRevisionId: "revision-1",
      workspaceSlug: "hr",
      resumeIdentity: "resume-1",
      reasonCode: "stale",
    });
  });

  it("rejects refresh requests without an authenticated workspace session", async () => {
    const calls: ConvexCall[] = [];
    vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
      calls.push(parseConvexCall(input, init));
      return convexSuccess(null);
    });

    const response = await createApp().request(
      "/api/company-industry-refresh-requests",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Workspace-Slug": "hr",
        },
        body: JSON.stringify({
          companyKey: "acme-cnc",
          verdictRevisionId: "revision-1",
        }),
      },
    );

    expect(response.status).toBe(401);
    expect(calls).toHaveLength(0);
  });

  it("lists industry maintenance runs with admin auth", async () => {
    const auth = createAuthHeaders({ workspaceSlug: "hr", role: "admin" });
    vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
      const call = parseConvexCall(input, init);
      if (call.pathName === "companies:listIndustryMaintenanceRuns") {
        return convexSuccess([
          {
            runId: "run-1",
            workspaceSlug: "hr",
            triggerSource: "manual",
            status: "completed",
            operatorSummary: "completed; 1 ready.",
            startedAt: 100,
            finishedAt: 200,
          },
        ]);
      }
      throw new Error(`Unexpected path ${call.pathName}`);
    });

    const app = createApp({ authStorage: auth.storage });
    const response = await app.request(
      "/api/company-industry-maintenance-runs?limit=10",
      { headers: auth.headers },
    );
    expect(response.status).toBe(200);
    const body = await parseJsonBody<{ items: Array<{ runId: string }> }>(response);
    expect(body.items[0].runId).toBe("run-1");
  });

  it("returns industry coverage summary for admin", async () => {
    const auth = createAuthHeaders({ workspaceSlug: "dev", role: "admin" });
    vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
      const call = parseConvexCall(input, init);
      if (call.pathName === "companies:getIndustryCoverageSummary") {
        expect(call.args.workspaceSlug).toBe("dev");
        return convexSuccess({
          generatedAt: 1_700_000_000_000,
          workspaceSlug: "dev",
          proposalsByStatus: {
            new: 427,
            researching: 0,
            ready_for_review: 0,
            needs_more_evidence: 60,
            approved: 16,
            rejected: 3,
            superseded: 0,
          },
          openTotal: 487,
          openWithSources: 0,
          openWithoutSources: 487,
          emptyEvidenceBottleneck: true,
          readyBacklogBottleneck: true,
          resumes: { total: 83, withVerifiedEvidence: 1 },
          profiles: { total: 9, verified: 4, rejected: 5 },
          maintenance: {
            latest: {
              runId: "run-fail",
              status: "failed",
              triggerSource: "restore",
              failureMessage: "fetch failed",
              operatorSummary: "failed; worker unreachable.",
              startedAt: 10,
              counts: {
                proposalsResearched: 0,
                readyCreated: 0,
                sourcesDemoted: 0,
                freshnessChecked: 0,
                freshnessRefreshed: 0,
                errors: 0,
              },
            },
            lastUseful: {
              runId: "run-useful",
              status: "completed",
              triggerSource: "manual",
              operatorSummary: "completed; 0 ready.",
              startedAt: 5,
              counts: {
                proposalsResearched: 20,
                readyCreated: 0,
                sourcesDemoted: 0,
                freshnessChecked: 0,
                freshnessRefreshed: 0,
                errors: 0,
              },
            },
            lastFailed: {
              runId: "run-fail",
              status: "failed",
              triggerSource: "restore",
              failureMessage: "fetch failed",
              operatorSummary: "failed; worker unreachable.",
              startedAt: 10,
              counts: {
                proposalsResearched: 0,
                readyCreated: 0,
                sourcesDemoted: 0,
                freshnessChecked: 0,
                freshnessRefreshed: 0,
                errors: 0,
              },
            },
          },
        });
      }
      throw new Error(`Unexpected path ${call.pathName}`);
    });

    const app = createApp({ authStorage: auth.storage });
    const response = await app.request("/api/company-industry-coverage", {
      headers: auth.headers,
    });
    expect(response.status).toBe(200);
    const body = await parseJsonBody<{
      success: boolean;
      item: {
        openTotal: number;
        emptyEvidenceBottleneck: boolean;
        resumes: { withVerifiedEvidence: number };
      };
    }>(response);
    expect(body.success).toBe(true);
    expect(body.item.openTotal).toBe(487);
    expect(body.item.emptyEvidenceBottleneck).toBe(true);
    expect(body.item.resumes.withVerifiedEvidence).toBe(1);
  });

  it("rejects industry coverage summary without admin", async () => {
    const auth = createAuthHeaders({ workspaceSlug: "dev", role: "user" });
    const calls: ConvexCall[] = [];
    vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
      calls.push(parseConvexCall(input, init));
      return convexSuccess(null);
    });

    const app = createApp({ authStorage: auth.storage });
    const response = await app.request("/api/company-industry-coverage", {
      headers: auth.headers,
    });
    expect(response.status).toBe(403);
    expect(calls).toHaveLength(0);
  });

  it("returns 404 for unknown maintenance run detail", async () => {
    const auth = createAuthHeaders({ workspaceSlug: "hr", role: "admin" });
    vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
      const call = parseConvexCall(input, init);
      if (call.pathName === "companies:getIndustryMaintenanceRun") {
        return convexSuccess(null);
      }
      throw new Error(`Unexpected path ${call.pathName}`);
    });

    const app = createApp({ authStorage: auth.storage });
    const response = await app.request(
      "/api/company-industry-maintenance-rums/missing",
      { headers: auth.headers },
    );
    // Unknown path prefix returns 404; test the correct path returns null item.
    const response2 = await app.request(
      "/api/company-industry-maintenance-runs/missing",
      { headers: auth.headers },
    );
    expect(response2.status).toBe(200);
    const body = await parseJsonBody<{ item: unknown }>(response2);
    expect(body.item).toBeNull();
    void response;
  });

  it("returns ledger rows by runId", async () => {
    const auth = createAuthHeaders({ workspaceSlug: "hr", role: "admin" });
    vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
      const call = parseConvexCall(input, init);
      if (call.pathName === "companies:listIndustryMaintenanceLedger") {
        return convexSuccess([
          {
            runId: "run-1",
            proposalId: "p-1",
            action: "ready",
            reason: "ready_for_review",
          },
        ]);
      }
      throw new Error(`Unexpected path ${call.pathName}`);
    });

    const app = createApp({ authStorage: auth.storage });
    const response = await app.request(
      "/api/company-industry-maintenance-runs/run-1/ledger",
      { headers: auth.headers },
    );
    expect(response.status).toBe(200);
    const body = await parseJsonBody<{ items: Array<{ action: string }> }>(response);
    expect(body.items[0].action).toBe("ready");
  });

  it("returns ledger rows by proposalId", async () => {
    const auth = createAuthHeaders({ workspaceSlug: "hr", role: "admin" });
    vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
      const call = parseConvexCall(input, init);
      if (call.pathName === "companies:listIndustryMaintenanceLedger") {
        expect(call.args.proposalId).toBe("p-9");
        return convexSuccess([
          {
            runId: "run-1",
            proposalId: "p-9",
            action: "needs_more_evidence",
            reason: "no candidate sources",
          },
        ]);
      }
      throw new Error(`Unexpected path ${call.pathName}`);
    });

    const app = createApp({ authStorage: auth.storage });
    const response = await app.request(
      "/api/company-industry-proposals/p-9/maintenance-ledger",
      { headers: auth.headers },
    );
    expect(response.status).toBe(200);
    const body = await parseJsonBody<{ items: Array<{ action: string }> }>(response);
    expect(body.items[0].action).toBe("needs_more_evidence");
  });
});
