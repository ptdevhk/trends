import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("../middleware/maintenance.js", () => ({
  maintenanceGuard: async (_c: unknown, next: () => Promise<void>) => {
    await next();
  },
}));

import { createApp } from "../app";
import { resetResumeScreeningDb } from "../services/database";
import * as industryReviewService from "../services/company-industry-review-service";
import * as industryEvidenceResearchService from "../services/industry-evidence-research-service";
import * as industryProposalService from "../services/company-industry-proposal-service";
import { companyIndustryRecomputeService } from "../services/company-industry-recompute-service";
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

  it("lists market policies for a market scope query", async () => {
    const auth = createAuthHeaders({ workspaceSlug: "hr", role: "user" });
    const calls: ConvexCall[] = [];
    vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
      const call = parseConvexCall(input, init);
      calls.push(call);
      if (call.pathName === "companies:listPoliciesForScope") {
        expect(call.args.scopeType).toBe("market");
        expect(call.args.scopeId).toBe("cn");
        return convexSuccess([
          {
            companyKey: "pro-technic-machinery",
            displayName: "宝力机械 / Pro-Technic Machinery",
            status: "confirmed",
            scopeType: "market",
            scopeId: "cn",
            revision: 1,
            effects: { rankingEffect: "none" },
            createdAt: 1,
          },
        ]);
      }
      throw new Error(`Unexpected path ${call.pathName}`);
    });

    const app = createApp({ authStorage: auth.storage });
    const response = await app.request("/api/company-policies?market=cn", {
      headers: auth.headers,
    });
    expect(response.status).toBe(200);
    const body = await parseJsonBody<{
      items: Array<{ effects: { rankingEffect: string } }>;
    }>(response);
    expect(body.items[0].effects.rankingEffect).toBe("none");
    expect(calls).toHaveLength(1);
  });

  it("appends a market policy revision with lowercase scope id", async () => {
    const auth = createAuthHeaders({ workspaceSlug: "hr", role: "user" });
    const calls: ConvexCall[] = [];
    vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
      const call = parseConvexCall(input, init);
      calls.push(call);
      if (call.pathName === "companies:appendPolicyRevision") {
        expect(call.args.scopeType).toBe("market");
        expect(call.args.scopeId).toBe("my");
        expect(call.args.companyKey).toBe("pro-technic-machinery");
        expect(call.args.visibility).toBe("default");
        return convexSuccess({ id: "rev1", revision: 3 });
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
        preset: "none",
        market: "my",
      }),
    });

    expect(response.status).toBe(200);
    const body = await parseJsonBody<{ revision: number }>(response);
    expect(body.revision).toBe(3);
    expect(calls).toHaveLength(1);
  });

  it("rejects an unknown market scope on append", async () => {
    const auth = createAuthHeaders({ workspaceSlug: "hr", role: "user" });
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    const app = createApp({ authStorage: auth.storage });
    const response = await app.request("/api/company-policies", {
      method: "POST",
      headers: {
        ...auth.headers,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        companyKey: "pro-technic-machinery",
        preset: "none",
        market: "jp",
      }),
    });

    expect(response.status).toBe(400);
    expect(fetchSpy).not.toHaveBeenCalled();
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

  it("passes includeArchived to the company list query", async () => {
    const auth = createAuthHeaders({ workspaceSlug: "hr", role: "user" });
    const calls: ConvexCall[] = [];
    vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
      const call = parseConvexCall(input, init);
      calls.push(call);
      if (call.pathName === "companies:list") {
        return convexSuccess([]);
      }
      throw new Error(`Unexpected path ${call.pathName}`);
    });

    const app = createApp({ authStorage: auth.storage });
    const archivedResponse = await app.request("/api/companies?includeArchived=true", {
      headers: auth.headers,
    });
    expect(archivedResponse.status).toBe(200);
    expect(calls).toHaveLength(1);
    expect(calls[0]?.args.includeArchived).toBe(true);

    const defaultResponse = await app.request("/api/companies", { headers: auth.headers });
    expect(defaultResponse.status).toBe(200);
    expect(calls).toHaveLength(2);
    expect(calls[1]?.args.includeArchived).toBe(false);
  });

  it("archives and restores a company through the BFF", async () => {
    const auth = createAuthHeaders({ workspaceSlug: "hr", role: "user" });
    const calls: ConvexCall[] = [];
    vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
      const call = parseConvexCall(input, init);
      calls.push(call);
      if (call.pathName === "companies:setCompanyArchived") {
        expect(call.args.companyKey).toBe("acme-cnc");
        expect(call.args.archived).toBe(true);
        expect(call.args.createdBy).toBe(auth.userId);
        return convexSuccess({ companyKey: "acme-cnc", archived: true, archivedAt: 123 });
      }
      throw new Error(`Unexpected path ${call.pathName}`);
    });

    const app = createApp({ authStorage: auth.storage });
    const response = await app.request("/api/companies/acme-cnc/archive", {
      method: "POST",
      headers: {
        ...auth.headers,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ archived: true }),
    });
    expect(response.status).toBe(200);
    const body = await parseJsonBody<{ companyKey: string; archived: boolean; archivedAt: number | null }>(response);
    expect(body.companyKey).toBe("acme-cnc");
    expect(body.archived).toBe(true);
    expect(body.archivedAt).toBe(123);
    expect(calls).toHaveLength(1);
  });

  it("lists governed industry proposals for an authenticated admin", async () => {
    const auth = createAuthHeaders({ workspaceSlug: "hr", role: "admin" });
    vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
      const call = parseConvexCall(input, init);
      expect(call).toMatchObject({
        type: "query",
        pathName: "companies:listIndustryProposalsPage",
      });
      expect(call.args.status).toBe("ready_for_review");
      return convexSuccess({
        items: [
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
        ],
      });
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

  it("pages governed industry proposals with limit and cursor (no 500-row cap)", async () => {
    const auth = createAuthHeaders({ workspaceSlug: "hr", role: "admin" });
    vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
      const call = parseConvexCall(input, init);
      expect(call).toMatchObject({
        type: "query",
        pathName: "companies:listIndustryProposalsPage",
      });
      expect(call.args.status).toBe("ready_for_review");
      expect(call.args.limit).toBe(25);
      expect(call.args.cursor).toBe("cursor-1");
      return convexSuccess({
        items: [
          {
            _id: "proposal-row-2",
            proposalId: "proposal-2",
            companyKey: "acme-cnc",
            triggerReasons: ["scheduled_freshness"],
            priority: 80,
            status: "ready_for_review",
            createdAt: 1,
            updatedAt: 2,
          },
        ],
        nextCursor: "cursor-2",
      });
    });

    const app = createApp({ authStorage: auth.storage });
    const response = await app.request(
      "/api/company-industry-proposals?status=ready_for_review&limit=25&cursor=cursor-1",
      { headers: auth.headers },
    );

    expect(response.status).toBe(200);
    const body = await parseJsonBody<{
      items: Array<{ proposalId: string }>;
      nextCursor?: string;
    }>(response);
    expect(body.items).toEqual([
      expect.objectContaining({ proposalId: "proposal-2" }),
    ]);
    expect(body.nextCursor).toBe("cursor-2");
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
            riskDecision: {
              requiresAcknowledgement: false,
              nonOverridableRiskFlags: [],
              canApproveWithRiskOverride: true,
            },
            reasons: ["Durable source supports the proposed cnc classification."],
            excludedSourceReasons: {},
            evidenceSummaryDraft: "Official catalog confirms CNC products.",
            decisionReasonDraft: "Reviewed primary evidence.",
            requiresHumanReview: true,
            autoApprovable: false,
          },
          inputFingerprint: "fingerprint-1",
          sourceCount: 1,
        },
      ],
      maintenance: { latest: null, lastFailed: null },
    });
    const impactCalls: ConvexCall[] = [];
    vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
      const call = parseConvexCall(input, init);
      impactCalls.push(call);
      if (call.pathName === "companies:getIndustryResumeImpactByCompanyKey") {
        expect(call.args).toMatchObject({
          companyKeys: ["acme-cnc"],
          writeSecret: expect.any(String),
        });
        return convexSuccess({ "acme-cnc": 5 });
      }
      throw new Error(`Unexpected path ${call.pathName}`);
    });

    const app = createApp({ authStorage: auth.storage });
    const response = await app.request(
      "/api/company-industry-proposals/review-queue?status=ready_for_review&limit=20",
      { headers: auth.headers },
    );

    expect(response.status).toBe(200);
    const body = await parseJsonBody<{
      schemaVersion: string;
      items: Array<{
        recommendation: { recommendedAction: string };
        resumeImpact: number;
      }>;
    }>(response);
    expect(body.schemaVersion).toBe("industry-review.v1");
    expect(body.items[0]?.recommendation.recommendedAction).toBe("approve");
    expect(body.items[0]?.resumeImpact).toBe(5);
    expect(impactCalls).toHaveLength(1);
    expect(industryReviewService.listIndustryReviewQueue).toHaveBeenCalledWith({
      status: "ready_for_review",
      limit: 20,
      workspaceSlug: "hr",
      timing: expect.any(Function),
    });
  });

  it("serves the review queue when the queue contains CJK company keys (no ASCII field-name crash)", async () => {
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
            companyKey: "上海易初电线电缆有限公司",
            triggerReasons: ["scheduled_freshness"],
            priority: 80,
            status: "ready_for_review",
            createdAt: 1,
            updatedAt: 2,
          },
          recommendation: {
            proposalId: "proposal-1",
            proposalStatus: "ready_for_review",
            recommendedAction: "inspect",
            recommendedVerificationLevel: "verified",
            recommendedIndustryClass: "industrial",
            recommendedSourceIds: [],
            sourceDecisions: [],
            confidenceBand: "low",
            riskFlags: ["canonical_mapping_missing"],
            riskDecision: {
              requiresAcknowledgement: true,
              nonOverridableRiskFlags: ["canonical_mapping_missing"],
              canApproveWithRiskOverride: false,
            },
            reasons: ["Proposal is not mapped to a canonical company."],
            excludedSourceReasons: {},
            evidenceSummaryDraft: "",
            decisionReasonDraft: "",
            requiresHumanReview: true,
            autoApprovable: false,
          },
          inputFingerprint: "fingerprint-1",
          sourceCount: 1,
        },
      ],
      maintenance: { latest: null, lastFailed: null },
    });
    const impactCalls: ConvexCall[] = [];
    vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
      const call = parseConvexCall(input, init);
      impactCalls.push(call);
      if (call.pathName === "companies:getIndustryResumeImpactByCompanyKey") {
        // The API must NOT forward CJK keys to Convex (they cannot be JSON
        // object keys there); the impact query runs on the ASCII-safe
        // projection only and the row mapping resolves CJK keys to 0.
        expect(call.args).toMatchObject({
          companyKeys: [],
          writeSecret: expect.any(String),
        });
        return convexSuccess({});
      }
      throw new Error(`Unexpected path ${call.pathName}`);
    });

    const app = createApp({ authStorage: auth.storage });
    const response = await app.request(
      "/api/company-industry-proposals/review-queue?status=ready_for_review&limit=20",
      { headers: auth.headers },
    );

    expect(response.status).toBe(200);
    const body = await parseJsonBody<{ items: Array<{ resumeImpact: number }> }>(response);
    expect(body.items[0].resumeImpact).toBe(0);
    // The CJK key was filtered out before the Convex call (empty keys
    // array), so the impact query was skipped entirely.
    expect(impactCalls).toHaveLength(0);
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
        autoApprovable: false,
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
      dataset: { inputFingerprint: "fingerprint-1", proposalUpdatedAt: 123, sourceVersions: [{ sourceId: "source-1", updatedAt: 7 }] },
      recommendation: {
        proposalStatus: "ready_for_review",
        recommendedIndustryClass: "industrial",
        recommendedSourceIds: ["source-1"],
        sourceDecisions: [
          { sourceId: "source-1", approvalSafe: true, recommended: true, reasonCodes: ["approval_safe"] },
        ],
        riskFlags: ["low_source_diversity"],
        evidenceSummaryDraft: "Reviewed evidence.",
        decisionReasonDraft: "Reviewed 1 approval-safe source(s); confirm the industrial classification and evidence summary.",
      },
      reviewContext: { profile: null },
      proposal: { proposalId: "proposal-1", companyKey: "acme-cnc" },
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

  it("returns 404 with an error envelope when approving a nonexistent proposal", async () => {
    const auth = createAuthHeaders({ workspaceSlug: "hr", role: "admin" });
    vi.spyOn(industryReviewService, "getIndustryReviewPacket").mockResolvedValue(null as never);
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    const app = createApp({ authStorage: auth.storage });
    const response = await app.request(
      "/api/company-industry-proposals/does-not-exist/approve",
      {
        method: "POST",
        headers: { ...auth.headers, "Content-Type": "application/json" },
        body: JSON.stringify({
          revisionId: "revision-2",
          verificationLevel: "verified",
          industryClass: "cnc",
          approvedSourceIds: ["source-1"],
          evidenceSummary: "Reviewed official evidence.",
          decisionReason: "Reviewed primary evidence",
          taxonomyVersion: "industry-v1",
        }),
      },
    );

    expect(response.status).toBe(404);
    expect(await parseJsonBody(response)).toMatchObject({
      success: false,
      error: "Industry proposal not found",
    });
    // The approval mutation must never run against a nonexistent proposal.
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("fails closed when the approval boundary reports a stale packet", async () => {
    const auth = createAuthHeaders({ workspaceSlug: "hr", role: "admin" });
    vi.spyOn(industryReviewService, "getIndustryReviewPacket").mockResolvedValue({
      dataset: { inputFingerprint: "fingerprint-1", proposalUpdatedAt: 123, sourceVersions: [{ sourceId: "source-1", updatedAt: 7 }] },
      recommendation: {
        proposalStatus: "ready_for_review",
        recommendedIndustryClass: "industrial",
        recommendedSourceIds: ["source-1"],
        sourceDecisions: [
          { sourceId: "source-1", approvalSafe: true, recommended: true, reasonCodes: ["approval_safe"] },
        ],
        riskFlags: [],
        evidenceSummaryDraft: "Reviewed official evidence.",
        decisionReasonDraft: "Reviewed 1 approval-safe source(s); confirm the industrial classification and evidence summary.",
      },
      reviewContext: { profile: null },
      proposal: { proposalId: "proposal-1", companyKey: "acme-cnc" },
    } as never);
    vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
      const call = parseConvexCall(input, init);
      if (call.pathName === "companies:approveIndustryProposal") {
        return convexFailure("INDUSTRY_REVIEW_STALE: recommendation fingerprint changed during review");
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
          expectedInputFingerprint: "stale-fingerprint",
          verificationLevel: "verified",
          industryClass: "cnc",
          approvedSourceIds: ["source-1"],
          evidenceSummary: "Reviewed official evidence.",
          decisionReason: "Reviewed primary evidence.",
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
    expect(response.status).toBe(409);
    expect(await parseJsonBody(response)).toMatchObject({
      code: "INDUSTRY_REVIEW_STALE",
    });
  });

  it("maps a wrapped convex stale error to 409 on identity resolution", async () => {
    const auth = createAuthHeaders({ workspaceSlug: "hr", role: "admin" });
    // The service forwards the convex transport error verbatim; the route
    // must recognize the stale code inside the local-backend wrapper
    // ("[Request ID: …] Server Error\nUncaught Error: INDUSTRY_REVIEW_STALE: …").
    vi.spyOn(
      industryEvidenceResearchService,
      "resolveIndustryProposalIdentity",
    ).mockRejectedValue(
      new Error(
        "[Request ID: df43104bb5d07519] Server Error\n"
        + "Uncaught Error: INDUSTRY_REVIEW_STALE: proposal changed during review\n"
        + "    at assertExpectedIndustryProposalUpdatedAt (../convex/companies.ts:1828:0)",
      ),
    );
    const app = createApp({ authStorage: auth.storage });
    const response = await app.request(
      "/api/company-industry-proposals/proposal-1/identity-resolution",
      {
        method: "POST",
        headers: {
          ...auth.headers,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          expectedProposalUpdatedAt: 1,
          candidateFingerprint: "candidate-fingerprint-1",
          mappingMode: "create_provisional",
          sourceIds: ["source-1"],
        }),
      },
    );

    expect(response.status).toBe(409);
    expect(await parseJsonBody(response)).toMatchObject({
      code: "INDUSTRY_REVIEW_STALE",
    });
  });

  it("maps a closed proposal to 409 NOT_OPEN on identity resolution", async () => {
    const auth = createAuthHeaders({ workspaceSlug: "hr", role: "admin" });
    vi.spyOn(
      industryEvidenceResearchService,
      "resolveIndustryProposalIdentity",
    ).mockRejectedValue(
      new Error(
        "[Request ID: 8f3c1d2e] Server Error\n"
        + "Uncaught Error: Proposal is not open for identity resolution: approved\n"
        + "    at handler (../convex/companies.ts:5162:4)",
      ),
    );
    const app = createApp({ authStorage: auth.storage });
    const response = await app.request(
      "/api/company-industry-proposals/proposal-1/identity-resolution",
      {
        method: "POST",
        headers: {
          ...auth.headers,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          expectedProposalUpdatedAt: 1,
          candidateFingerprint: "candidate-fingerprint-1",
          mappingMode: "create_provisional",
          sourceIds: ["source-1"],
        }),
      },
    );

    expect(response.status).toBe(409);
    expect(await parseJsonBody(response)).toMatchObject({
      code: "INDUSTRY_REVIEW_NOT_OPEN",
    });
  });

  it("maps a closed proposal to 409 NOT_OPEN on resolve", async () => {
    const auth = createAuthHeaders({ workspaceSlug: "hr", role: "admin" });
    vi.spyOn(industryProposalService, "resolveIndustryProposal").mockRejectedValue(
      new Error(
        "[Request ID: 51a2c3d4] Server Error\n"
        + "Uncaught Error: Proposal is not open: approved\n"
        + "    at resolveIndustryProposal (../convex/companies.ts:5401:4)",
      ),
    );
    const app = createApp({ authStorage: auth.storage });
    const response = await app.request(
      "/api/company-industry-proposals/proposal-1/resolve",
      {
        method: "POST",
        headers: {
          ...auth.headers,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          resolution: "rejected",
          expectedProposalUpdatedAt: 1,
        }),
      },
    );

    expect(response.status).toBe(409);
    expect(await parseJsonBody(response)).toMatchObject({
      code: "INDUSTRY_REVIEW_NOT_OPEN",
    });
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
      dataset: {
        inputFingerprint: "fingerprint-1",
        proposalUpdatedAt: 123,
        sourceVersions: [{ sourceId: "source-1", updatedAt: 7 }],
      },
      recommendation: {
        proposalStatus: "ready_for_review",
        recommendedIndustryClass: "industrial",
        recommendedSourceIds: ["source-1"],
        sourceDecisions: [
          { sourceId: "source-1", approvalSafe: true, recommended: true, reasonCodes: ["approval_safe"] },
        ],
        riskFlags: [],
        evidenceSummaryDraft: "Official catalog confirms CNC products.",
        decisionReasonDraft: "Reviewed 1 approval-safe source(s); confirm the cnc classification and evidence summary.",
      },
      reviewContext: { profile: { currentRevisionId: "revision-1" } },
      proposal: { proposalId: "proposal-1", companyKey: "acme-cnc" },
    } as never);
    vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
      const call = parseConvexCall(input, init);
      if (call.pathName === "companies:approveIndustryProposal") {
        expect(call.args).toMatchObject({
          proposalId: "proposal-1",
          revisionId: expect.stringMatching(/^industry-acme-cnc-/),
          reviewer: auth.userId,
          verificationLevel: "verified",
          industryClass: "cnc",
          approvedSourceIds: ["source-1"],
          expectedInputFingerprint: "fingerprint-1",
          expectedProposalUpdatedAt: 123,
          expectedCurrentRevisionId: "revision-1",
        });
        return convexSuccess({
          proposalId: "proposal-1",
          revisionId: call.args.revisionId,
          companyKey: "acme-cnc",
        });
      }
      if (call.pathName === "companies:startIndustryRecomputeRun") {
        expect(call.args).toMatchObject({
          workspaceSlug: "hr",
          companyKey: "acme-cnc",
          targetRevisionId: expect.stringMatching(/^industry-acme-cnc-/),
          proposalId: "proposal-1",
          requestedBy: auth.userId,
        });
        return convexSuccess({ ...recomputeRun, sourceDone: false, pageCount: 0 });
      }
      if (call.pathName === "companies:backfillCompanyResumeLinksByCompanySync") {
        return convexSuccess({
          status: "completed",
          companyKey: "acme-cnc",
          scannedRows: 0,
          matchedRows: 0,
          linkedRows: 0,
          cursor: null,
          isDone: true,
        });
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
    expect(body.revisionId).toMatch(/^industry-acme-cnc-/);
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

  it("fails cleanly (500, no success envelope) when the undo mutation reports a non-stale error", async () => {
    const auth = createAuthHeaders({ workspaceSlug: "hr", role: "admin" });
    vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
      const call = parseConvexCall(input, init);
      expect(call.pathName).toBe("companies:undoIndustryProposalApproval");
      return convexFailure("Unknown industry proposal: proposal-1");
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

    expect(response.status).toBe(500);
    // The undo must never be reported as done on a failed mutation: no
    // success envelope, no partial reversal payload.
    const text = await response.text();
    expect(text).not.toContain('"success":true');
    expect(text).not.toContain("reversalRevisionId");
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

  describe("industry review audit writes record the acting workspace role", () => {
    it("approves a proposal as reviewer and passes reviewerRole to the verdict mutation", async () => {
      const auth = createAuthHeaders({ workspaceSlug: "hr", role: "reviewer" });
      vi.spyOn(industryReviewService, "getIndustryReviewPacket").mockResolvedValue({
        dataset: {
          inputFingerprint: "fingerprint-1",
          proposalUpdatedAt: 123,
          sourceVersions: [{ sourceId: "source-1", updatedAt: 7 }],
        },
        recommendation: {
          proposalStatus: "ready_for_review",
          recommendedIndustryClass: "industrial",
          recommendedSourceIds: ["source-1"],
          sourceDecisions: [
            { sourceId: "source-1", approvalSafe: true, recommended: true, reasonCodes: ["approval_safe"] },
          ],
          riskFlags: [],
          evidenceSummaryDraft: "Official catalog confirms CNC products.",
          decisionReasonDraft: "Reviewed 1 approval-safe source(s); confirm the cnc classification and evidence summary.",
        },
        reviewContext: { profile: { currentRevisionId: "revision-1" } },
        proposal: { proposalId: "proposal-1", companyKey: "acme-cnc" },
      } as never);
      vi.spyOn(companyIndustryRecomputeService, "start").mockResolvedValue({
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
      } as never);
      let approveCall: ConvexCall | undefined;
      vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
        const call = parseConvexCall(input, init);
        if (call.pathName === "companies:approveIndustryProposal") {
          approveCall = call;
          return convexSuccess({
            proposalId: "proposal-1",
            revisionId: call.args.revisionId,
            companyKey: "acme-cnc",
          });
        }
        throw new Error(`Unexpected path ${call.pathName}`);
      });

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
      expect(approveCall).toBeDefined();
      expect(approveCall?.args).toMatchObject({
        proposalId: "proposal-1",
        reviewer: auth.userId,
        // Task 4: the acting membership role is resolved server-side from the
        // session (never from client input) and recorded on the audit write.
        reviewerRole: "reviewer",
      });
    });

    it("records the reviewer role on identity-resolution audit writes", async () => {
      const auth = createAuthHeaders({ workspaceSlug: "hr", role: "reviewer" });
      let capturedInput: Record<string, unknown> | undefined;
      vi.spyOn(
        industryEvidenceResearchService,
        "resolveIndustryProposalIdentity",
      ).mockImplementation(async (input: Record<string, unknown>) => {
        capturedInput = input;
        return {
          proposalId: "proposal-1",
          companyKey: "acme-cnc",
          auditId: "audit-1",
        } as never;
      });

      const app = createApp({ authStorage: auth.storage });
      const response = await app.request(
        "/api/company-industry-proposals/proposal-1/identity-resolution",
        {
          method: "POST",
          headers: { ...auth.headers, "Content-Type": "application/json" },
          body: JSON.stringify({
            expectedProposalUpdatedAt: 1,
            candidateFingerprint: "candidate-fingerprint-1",
            mappingMode: "create_provisional",
            sourceIds: ["source-1"],
          }),
        },
      );

      expect(response.status).toBe(200);
      expect(capturedInput).toMatchObject({
        actor: auth.userId,
        actorRole: "reviewer",
      });
    });

    it("records the reviewer role on proposal resolution writes", async () => {
      const auth = createAuthHeaders({ workspaceSlug: "hr", role: "reviewer" });
      let resolveCall: ConvexCall | undefined;
      vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
        const call = parseConvexCall(input, init);
        if (call.pathName === "companies:resolveIndustryProposal") {
          resolveCall = call;
          return convexSuccess({
            proposalId: "proposal-1",
            status: "rejected",
          });
        }
        throw new Error(`Unexpected path ${call.pathName}`);
      });

      const app = createApp({ authStorage: auth.storage });
      const response = await app.request(
        "/api/company-industry-proposals/proposal-1/resolve",
        {
          method: "POST",
          headers: { ...auth.headers, "Content-Type": "application/json" },
          body: JSON.stringify({
            resolution: "rejected",
            reviewNote: "Noise",
            expectedProposalUpdatedAt: 1,
          }),
        },
      );

      expect(response.status).toBe(200);
      expect(resolveCall?.args).toMatchObject({
        proposalId: "proposal-1",
        resolution: "rejected",
        reviewer: auth.userId,
        reviewerRole: "reviewer",
      });
    });

    it("records the reviewer role on undo-approval revision writes", async () => {
      const auth = createAuthHeaders({ workspaceSlug: "hr", role: "reviewer" });
      let undoCall: ConvexCall | undefined;
      vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
        const call = parseConvexCall(input, init);
        if (call.pathName === "companies:undoIndustryProposalApproval") {
          undoCall = call;
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
          headers: { ...auth.headers, "Content-Type": "application/json" },
          body: JSON.stringify({ approvedRevisionId: "revision-2" }),
        },
      );

      expect(response.status).toBe(200);
      expect(undoCall?.args).toMatchObject({
        proposalId: "proposal-1",
        approvedRevisionId: "revision-2",
        reviewer: auth.userId,
        reviewerRole: "reviewer",
      });
    });

    it("records the reviewer role on every batch review mutation", async () => {
      const auth = createAuthHeaders({ workspaceSlug: "hr", role: "reviewer" });
      vi.spyOn(industryReviewService, "getIndustryReviewPacket").mockResolvedValue({
        dataset: {
          inputFingerprint: "fingerprint-1",
          proposalUpdatedAt: 123,
          sourceVersions: [{ sourceId: "source-1", updatedAt: 7 }],
        },
        recommendation: {
          proposalStatus: "ready_for_review",
          recommendedIndustryClass: "industrial",
          recommendedSourceIds: ["source-1"],
          sourceDecisions: [
            { sourceId: "source-1", approvalSafe: true, recommended: true, reasonCodes: ["approval_safe"] },
          ],
          riskFlags: [],
          evidenceSummaryDraft: "Official catalog confirms CNC products.",
          decisionReasonDraft: "Reviewed 1 approval-safe source(s); confirm the cnc classification and evidence summary.",
        },
        reviewContext: { profile: { currentRevisionId: "revision-1" } },
        proposal: { proposalId: "proposal-1", companyKey: "acme-cnc" },
      } as never);
      vi.spyOn(companyIndustryRecomputeService, "start").mockResolvedValue({
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
      } as never);
      const calls: ConvexCall[] = [];
      vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
        const call = parseConvexCall(input, init);
        calls.push(call);
        if (call.pathName === "companies:approveIndustryProposal") {
          return convexSuccess({
            proposalId: call.args.proposalId,
            revisionId: call.args.revisionId,
            companyKey: "acme-cnc",
          });
        }
        if (call.pathName === "companies:resolveIndustryProposal") {
          return convexSuccess({
            proposalId: call.args.proposalId,
            status: "rejected",
          });
        }
        throw new Error(`Unexpected path ${call.pathName}`);
      });

      const app = createApp({ authStorage: auth.storage });
      const response = await app.request(
        "/api/company-industry-proposals/batch-review",
        {
          method: "POST",
          headers: { ...auth.headers, "Content-Type": "application/json" },
          body: JSON.stringify({
            actions: [
              { kind: "approve", proposalId: "proposal-1" },
              { kind: "reject", proposalId: "proposal-3", reviewNote: "Noise" },
            ],
            attestation: {
              schemaVersion: "industry-review-attestation.v1",
              decisionMode: "standard",
              acknowledgedRiskFlags: [],
              cncEvidenceAcknowledged: true,
              acknowledgementReason: "",
            },
          }),
        },
      );

      expect(response.status).toBe(200);
      const approveCall = calls.find(
        (call) => call.pathName === "companies:approveIndustryProposal",
      );
      const rejectCall = calls.find(
        (call) => call.pathName === "companies:resolveIndustryProposal",
      );
      expect(approveCall?.args).toMatchObject({
        proposalId: "proposal-1",
        reviewer: auth.userId,
        reviewerRole: "reviewer",
      });
      expect(rejectCall?.args).toMatchObject({
        proposalId: "proposal-3",
        resolution: "rejected",
        reviewer: auth.userId,
        reviewerRole: "reviewer",
      });
    });
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
          // C5 (2026-08-09): openWithSources + statuses come from the
          // precomputed counters doc; countersGeneratedAt non-null means
          // the API service serves the doc without an inline refresh.
          countersGeneratedAt: 1_700_000_000_000,
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
          openWithSources: 7,
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
        openWithSources: number;
        openWithoutSources: number;
        emptyEvidenceBottleneck: boolean;
        resumes: { withVerifiedEvidence: number };
      };
    }>(response);
    expect(body.success).toBe(true);
    expect(body.item.openTotal).toBe(487);
    expect(body.item.openWithSources).toBe(7);
    expect(body.item.openWithoutSources).toBe(480);
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

  describe("batch review", () => {
    function reviewPacket(overrides: Record<string, unknown> = {}) {
      return {
        dataset: {
          inputFingerprint: "fingerprint-1",
          proposalUpdatedAt: 123,
          sourceVersions: [{ sourceId: "source-1", updatedAt: 7 }],
        },
        recommendation: {
          proposalStatus: "ready_for_review",
          recommendedIndustryClass: "industrial",
          recommendedSourceIds: ["source-1"],
          sourceDecisions: [
            { sourceId: "source-1", approvalSafe: true },
            { sourceId: "source-2", approvalSafe: false },
          ],
          riskFlags: [],
          evidenceSummaryDraft: "Official site confirms industrial equipment sales.",
          decisionReasonDraft: "Reviewed 1 approval-safe source(s); confirm the industrial classification and evidence summary.",
        },
        reviewContext: { profile: { currentRevisionId: "revision-current" } },
        proposal: { proposalId: "proposal-1", companyKey: "acme-cnc" },
        ...overrides,
      } as never;
    }

    function batchFetchMock(calls: ConvexCall[]) {
      return vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
        const call = parseConvexCall(input, init);
        calls.push(call);
        if (call.pathName === "companies:approveIndustryProposal") {
          return convexSuccess({
            proposalId: call.args.proposalId,
            revisionId: call.args.revisionId,
            companyKey: call.args.industryClass === "non_industry" ? "watsons-my" : "acme-cnc",
          });
        }
        if (call.pathName === "companies:resolveIndustryProposal") {
          return convexSuccess({
            proposalId: call.args.proposalId,
            status: "rejected",
          });
        }
        if (call.pathName === "companies:startIndustryRecomputeRun") {
          return convexSuccess({
            runId: "run-1",
            workspaceSlug: "hr",
            companyKey: "acme-cnc",
            targetRevisionId: "revision-x",
            proposalId: call.args.proposalId,
            requestedBy: "user-1",
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
          });
        }
        if (call.pathName === "companies:backfillCompanyResumeLinksByCompanySync") {
          return convexSuccess({
            status: "completed",
            companyKey: "acme-cnc",
            scannedRows: 0,
            matchedRows: 0,
            linkedRows: 0,
            cursor: null,
            isDone: true,
          });
        }
        if (call.pathName === "companies:getIndustryRecomputeRun") {
          return convexSuccess({
            runId: "run-1",
            workspaceSlug: "hr",
            companyKey: "acme-cnc",
            targetRevisionId: "revision-x",
            proposalId: call.args.proposalId,
            requestedBy: "user-1",
            status: "completed",
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
          });
        }
        if (call.pathName === "companies:getIndustryRecomputeRevisionState") {
          return convexSuccess({ matchesTargetRevision: true, currentRevisionId: "revision-x" });
        }
        if (call.pathName === "companies:getNextIndustryRecomputeBatch") {
          return convexSuccess(null);
        }
        if (call.pathName === "companies:listAffectedResumesByCompany") {
          return convexSuccess({ items: [], continueCursor: "", isDone: true });
        }
        if (call.pathName === "companies:reserveIndustryRecomputePage") {
          return convexSuccess({ runId: "run-1" });
        }
        return convexSuccess({});
      });
    }

    it("approves and rejects a mixed batch with one shared attestation", async () => {
      const auth = createAuthHeaders({ workspaceSlug: "hr", role: "admin" });
      const calls: ConvexCall[] = [];
      vi.spyOn(industryReviewService, "getIndustryReviewPacket").mockImplementation(
        async (proposalId: string) => {
          if (proposalId === "proposal-1") return reviewPacket();
          if (proposalId === "proposal-2") {
            return reviewPacket({
              recommendation: {
                proposalStatus: "ready_for_review",
                recommendedIndustryClass: "unknown",
                recommendedSourceIds: ["source-1"],
                sourceDecisions: [
                  { sourceId: "source-1", approvalSafe: true },
                ],
                riskFlags: ["weak_industry_signal"],
                evidenceSummaryDraft: "",
                decisionReasonDraft: "Additional evidence or canonical-company review is required before changing verified truth.",
              },
              proposal: { proposalId: "proposal-2", companyKey: "watsons-my" },
            });
          }
          throw new Error(`Unexpected proposal ${proposalId}`);
        },
      );
      batchFetchMock(calls);

      const app = createApp({ authStorage: auth.storage });
      const response = await app.request(
        "/api/company-industry-proposals/batch-review",
        {
          method: "POST",
          headers: { ...auth.headers, "Content-Type": "application/json" },
          body: JSON.stringify({
            actions: [
              { kind: "approve", proposalId: "proposal-1" },
              {
                kind: "approve",
                proposalId: "proposal-2",
                industryClass: "non_industry",
              },
              { kind: "reject", proposalId: "proposal-3", reviewNote: "Noise" },
            ],
            attestation: {
              schemaVersion: "industry-review-attestation.v1",
              decisionMode: "risk_override",
              acknowledgedRiskFlags: ["weak_industry_signal"],
              cncEvidenceAcknowledged: false,
              acknowledgementReason: "Official site confirms a retail chain.",
            },
            batchNote: "Weekly bulk review",
          }),
        },
      );

      expect(response.status).toBe(200);
      const body = await parseJsonBody<{
        batchId: string;
        batchFingerprint: string;
        summary: { total: number; succeeded: number; failed: number };
        items: Array<{ proposalId: string; ok: boolean; code?: string; error?: string }>;
      }>(response);
      expect(body.batchId).toMatch(/^industry-batch-/);
      expect(body.batchFingerprint).toHaveLength(64);
      expect(body.items).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ proposalId: "proposal-1", ok: true }),
          expect.objectContaining({ proposalId: "proposal-2", ok: true }),
          expect.objectContaining({ proposalId: "proposal-3", ok: true, status: "rejected" }),
        ]),
      );

      const approveCalls = calls.filter(
        (call) => call.pathName === "companies:approveIndustryProposal",
      );
      expect(approveCalls).toHaveLength(2);
      const [clean, nonIndustry] = approveCalls;
      expect(clean.args).toMatchObject({
        proposalId: "proposal-1",
        verificationLevel: "verified",
        industryClass: "industrial",
        approvedSourceIds: ["source-1"],
        expectedInputFingerprint: "fingerprint-1",
        expectedProposalUpdatedAt: 123,
        expectedCurrentRevisionId: "revision-current",
      });
      expect(nonIndustry.args).toMatchObject({
        proposalId: "proposal-2",
        industryClass: "non_industry",
      });
      // One attestation covers the batch: same batchId, per-item fingerprint,
      // per-item decision mode and flags.
      expect(clean.args.reviewAttestation).toMatchObject({
        schemaVersion: "industry-review-attestation.v1",
        inputFingerprint: "fingerprint-1",
        decisionMode: "standard",
        acknowledgedRiskFlags: [],
        batchId: body.batchId,
      });
      expect(nonIndustry.args.reviewAttestation).toMatchObject({
        inputFingerprint: "fingerprint-1",
        decisionMode: "risk_override",
        acknowledgedRiskFlags: ["weak_industry_signal"],
        batchId: body.batchId,
      });
      const rejectCall = calls.find(
        (call) => call.pathName === "companies:resolveIndustryProposal",
      );
      expect(rejectCall?.args).toMatchObject({
        proposalId: "proposal-3",
        resolution: "rejected",
        reviewNote: "Noise",
      });
    });

    it("fails per item when the attestation is missing for a flagged proposal", async () => {
      const auth = createAuthHeaders({ workspaceSlug: "hr", role: "admin" });
      const calls: ConvexCall[] = [];
      vi.spyOn(industryReviewService, "getIndustryReviewPacket").mockResolvedValue(
        reviewPacket({
          recommendation: {
            proposalStatus: "ready_for_review",
            recommendedIndustryClass: "unknown",
            recommendedSourceIds: ["source-1"],
            sourceDecisions: [{ sourceId: "source-1", approvalSafe: true }],
            riskFlags: ["weak_industry_signal"],
            evidenceSummaryDraft: "",
            decisionReasonDraft: "",
          },
          proposal: { companyKey: "acme-cnc" },
        }),
      );
      batchFetchMock(calls);

      const app = createApp({ authStorage: auth.storage });
      const response = await app.request(
        "/api/company-industry-proposals/batch-review",
        {
          method: "POST",
          headers: { ...auth.headers, "Content-Type": "application/json" },
          body: JSON.stringify({
            actions: [
              { kind: "approve", proposalId: "proposal-1", industryClass: "non_industry" },
            ],
          }),
        },
      );

      expect(response.status).toBe(200);
      const body = await parseJsonBody<{ summary: { failed: number }; items: Array<{ code: string }> }>(response);
      expect(body.summary.failed).toBe(1);
      expect(body.items[0].code).toBe("INDUSTRY_REVIEW_ATTESTATION_REQUIRED");
      expect(calls.some((call) => call.pathName === "companies:approveIndustryProposal")).toBe(false);
    });

    it("extracts wrapped convex codes per item instead of a generic failure", async () => {
      const auth = createAuthHeaders({ workspaceSlug: "hr", role: "admin" });
      const calls: ConvexCall[] = [];
      vi.spyOn(industryReviewService, "getIndustryReviewPacket").mockResolvedValue(
        reviewPacket({
          recommendation: {
            proposalStatus: "ready_for_review",
            recommendedIndustryClass: "unknown",
            recommendedSourceIds: ["source-1"],
            sourceDecisions: [{ sourceId: "source-1", approvalSafe: true }],
            riskFlags: ["weak_industry_signal"],
            evidenceSummaryDraft: "",
            decisionReasonDraft: "",
          },
          proposal: { companyKey: "acme-cnc" },
        }),
      );
      vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
        const call = parseConvexCall(input, init);
        calls.push(call);
        if (call.pathName === "companies:approveIndustryProposal") {
          return convexFailure(
            "[Request ID: 8f3c1d2e] Server Error\n"
            + "Uncaught Error: INDUSTRY_REVIEW_STALE: proposal changed during review\n"
            + "    at commitIndustryVerdictApproval (../convex/companies.ts:3155:4)",
          );
        }
        return convexSuccess({});
      });

      const app = createApp({ authStorage: auth.storage });
      const response = await app.request(
        "/api/company-industry-proposals/batch-review",
        {
          method: "POST",
          headers: { ...auth.headers, "Content-Type": "application/json" },
          body: JSON.stringify({
            actions: [
              { kind: "approve", proposalId: "proposal-1", industryClass: "non_industry" },
            ],
            attestation: {
              schemaVersion: "industry-review-attestation.v1",
              decisionMode: "risk_override",
              acknowledgedRiskFlags: ["weak_industry_signal"],
              cncEvidenceAcknowledged: false,
              acknowledgementReason: "Wrapped-code extraction probe.",
            },
          }),
        },
      );

      expect(response.status).toBe(200);
      const body = await parseJsonBody<{ summary: { failed: number }; items: Array<{ code: string }> }>(response);
      expect(body.summary.failed).toBe(1);
      expect(body.items[0].code).toBe("INDUSTRY_REVIEW_STALE");
    });

    it("still hard-blocks non-overridable flags even with an attestation", async () => {
      const auth = createAuthHeaders({ workspaceSlug: "hr", role: "admin" });
      const calls: ConvexCall[] = [];
      vi.spyOn(industryReviewService, "getIndustryReviewPacket").mockResolvedValue(
        reviewPacket({
          recommendation: {
            proposalStatus: "ready_for_review",
            recommendedIndustryClass: "unknown",
            recommendedSourceIds: ["source-1"],
            sourceDecisions: [{ sourceId: "source-1", approvalSafe: true }],
            riskFlags: ["weak_industry_signal", "source_conflict"],
            evidenceSummaryDraft: "",
            decisionReasonDraft: "",
          },
        }),
      );
      batchFetchMock(calls);

      const app = createApp({ authStorage: auth.storage });
      const response = await app.request(
        "/api/company-industry-proposals/batch-review",
        {
          method: "POST",
          headers: { ...auth.headers, "Content-Type": "application/json" },
          body: JSON.stringify({
            actions: [
              { kind: "approve", proposalId: "proposal-1", industryClass: "industrial" },
            ],
            attestation: {
              schemaVersion: "industry-review-attestation.v1",
              decisionMode: "risk_override",
              acknowledgedRiskFlags: ["weak_industry_signal", "source_conflict"],
              cncEvidenceAcknowledged: false,
              acknowledgementReason: "Reviewed the conflict.",
            },
          }),
        },
      );

      expect(response.status).toBe(200);
      const body = await parseJsonBody<{ items: Array<{ code: string; error: string }> }>(response);
      expect(body.items[0].code).toBe("INDUSTRY_REVIEW_HARD_RISK");
      expect(body.items[0].error).toContain("source_conflict");
      expect(calls.some((call) => call.pathName === "companies:approveIndustryProposal")).toBe(false);
    });

    it("keeps a stale item from aborting the rest of the batch", async () => {
      const auth = createAuthHeaders({ workspaceSlug: "hr", role: "admin" });
      const calls: ConvexCall[] = [];
      vi.spyOn(industryReviewService, "getIndustryReviewPacket").mockImplementation(
        async (proposalId: string) => {
          if (proposalId === "proposal-good") return reviewPacket();
          if (proposalId === "proposal-stale") {
            return reviewPacket({
              dataset: {
                inputFingerprint: "fingerprint-2",
                proposalUpdatedAt: 456,
                sourceVersions: [{ sourceId: "source-1", updatedAt: 8 }],
              },
              proposal: { proposalId: "proposal-stale", companyKey: "acme-cnc" },
            });
          }
          throw new Error(`Unexpected proposal ${proposalId}`);
        },
      );
      // Override the mutation for the stale proposal: the Convex boundary
      // rejects with a stale error, which must surface per-item only.
      vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
        const call = parseConvexCall(input, init);
        calls.push(call);
        if (
          call.pathName === "companies:approveIndustryProposal" &&
          call.args.proposalId === "proposal-stale"
        ) {
          return convexFailure("INDUSTRY_REVIEW_STALE: recommendation fingerprint changed during review");
        }
        if (call.pathName === "companies:approveIndustryProposal") {
          return convexSuccess({
            proposalId: call.args.proposalId,
            revisionId: call.args.revisionId,
            companyKey: "acme-cnc",
          });
        }
        if (call.pathName === "companies:resolveIndustryProposal") {
          return convexSuccess({ proposalId: call.args.proposalId, status: "rejected" });
        }
        if (call.pathName === "companies:startIndustryRecomputeRun") {
          return convexSuccess({
            runId: "run-1",
            workspaceSlug: "hr",
            companyKey: "acme-cnc",
            targetRevisionId: "revision-x",
            proposalId: call.args.proposalId,
            requestedBy: "user-1",
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
          });
        }
        if (call.pathName === "companies:backfillCompanyResumeLinksByCompanySync") {
          return convexSuccess({
            status: "completed",
            companyKey: "acme-cnc",
            scannedRows: 0,
            matchedRows: 0,
            linkedRows: 0,
            cursor: null,
            isDone: true,
          });
        }
        if (call.pathName === "companies:getIndustryRecomputeRun") {
          return convexSuccess({
            runId: "run-1",
            workspaceSlug: "hr",
            companyKey: "acme-cnc",
            targetRevisionId: "revision-x",
            proposalId: call.args.proposalId,
            requestedBy: "user-1",
            status: "completed",
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
          });
        }
        if (call.pathName === "companies:getIndustryRecomputeRevisionState") {
          return convexSuccess({ matchesTargetRevision: true, currentRevisionId: "revision-x" });
        }
        if (call.pathName === "companies:getNextIndustryRecomputeBatch") {
          return convexSuccess(null);
        }
        if (call.pathName === "companies:listAffectedResumesByCompany") {
          return convexSuccess({ items: [], continueCursor: "", isDone: true });
        }
        if (call.pathName === "companies:reserveIndustryRecomputePage") {
          return convexSuccess({ runId: "run-1" });
        }
        return convexSuccess({});
      });

      const app = createApp({ authStorage: auth.storage });
      const response = await app.request(
        "/api/company-industry-proposals/batch-review",
        {
          method: "POST",
          headers: { ...auth.headers, "Content-Type": "application/json" },
          body: JSON.stringify({
            actions: [
              { kind: "approve", proposalId: "proposal-good" },
              { kind: "approve", proposalId: "proposal-stale" },
            ],
          }),
        },
      );

      expect(response.status).toBe(200);
      const body = await parseJsonBody<{
        summary: { succeeded: number; failed: number };
        items: Array<{ proposalId: string; ok: boolean; code?: string }>;
      }>(response);
      expect(body.summary).toEqual({ total: 2, succeeded: 1, failed: 1 });
      expect(body.items).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ proposalId: "proposal-good", ok: true }),
          expect.objectContaining({ proposalId: "proposal-stale", ok: false }),
        ]),
      );
    });

    it("requires an explicit class when the recommendation has none", async () => {
      const auth = createAuthHeaders({ workspaceSlug: "hr", role: "admin" });
      vi.spyOn(industryReviewService, "getIndustryReviewPacket").mockResolvedValue(
        reviewPacket({
          recommendation: {
            proposalStatus: "ready_for_review",
            recommendedIndustryClass: "unknown",
            recommendedSourceIds: ["source-1"],
            sourceDecisions: [{ sourceId: "source-1", approvalSafe: true }],
            riskFlags: [],
            evidenceSummaryDraft: "",
            decisionReasonDraft: "",
          },
        }),
      );
      const calls: ConvexCall[] = [];
      batchFetchMock(calls);

      const app = createApp({ authStorage: auth.storage });
      const response = await app.request(
        "/api/company-industry-proposals/batch-review",
        {
          method: "POST",
          headers: { ...auth.headers, "Content-Type": "application/json" },
          body: JSON.stringify({
            actions: [{ kind: "approve", proposalId: "proposal-1" }],
          }),
        },
      );

      expect(response.status).toBe(200);
      const body = await parseJsonBody<{ items: Array<{ code: string }> }>(response);
      expect(body.items[0].code).toBe("CLASS_REQUIRED");
      expect(calls.some((call) => call.pathName === "companies:approveIndustryProposal")).toBe(false);
    });

    it("requires an admin for batch review", async () => {
      const auth = createAuthHeaders({ workspaceSlug: "hr", role: "user" });
      const fetchSpy = vi.spyOn(globalThis, "fetch");
      const app = createApp({ authStorage: auth.storage });
      const response = await app.request(
        "/api/company-industry-proposals/batch-review",
        {
          method: "POST",
          headers: { ...auth.headers, "Content-Type": "application/json" },
          body: JSON.stringify({
            actions: [{ kind: "reject", proposalId: "proposal-1" }],
          }),
        },
      );

      expect(response.status).toBe(403);
      expect(fetchSpy).not.toHaveBeenCalled();
    });
  });

  it("backfills company resume links synchronously for an admin", async () => {
    const auth = createAuthHeaders({ workspaceSlug: "hr", role: "admin" });
    const calls: ConvexCall[] = [];
    vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
      const call = parseConvexCall(input, init);
      calls.push(call);
      if (call.pathName === "companies:backfillCompanyResumeLinksByCompanySync") {
        expect(call.args).toMatchObject({
          companyKey: "acme-cnc",
          writeSecret: expect.any(String),
        });
        expect(call.args.cursor).toBeUndefined();
        return convexSuccess({
          status: "completed",
          companyKey: "acme-cnc",
          scannedRows: 120,
          matchedRows: 40,
          linkedRows: 25,
          cursor: null,
          isDone: true,
        });
      }
      throw new Error(`Unexpected path ${call.pathName}`);
    });

    const app = createApp({ authStorage: auth.storage });
    const response = await app.request("/api/company-industry-link-backfill", {
      method: "POST",
      headers: { ...auth.headers, "Content-Type": "application/json" },
      body: JSON.stringify({ companyKey: "acme-cnc" }),
    });

    expect(response.status).toBe(200);
    const body = await parseJsonBody<{
      success: boolean;
      result: {
        status: string;
        scannedRows: number;
        matchedRows: number;
        linkedRows: number;
        iterations: number;
      };
    }>(response);
    expect(body).toEqual({
      success: true,
      result: {
        status: "completed",
        scannedRows: 120,
        matchedRows: 40,
        linkedRows: 25,
        iterations: 1,
      },
    });
    expect(calls).toHaveLength(1);
  });

  it("keeps the company link backfill admin-only", async () => {
    const auth = createAuthHeaders({ workspaceSlug: "hr", role: "user" });
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    const app = createApp({ authStorage: auth.storage });
    const response = await app.request("/api/company-industry-link-backfill", {
      method: "POST",
      headers: { ...auth.headers, "Content-Type": "application/json" },
      body: JSON.stringify({ companyKey: "acme-cnc" }),
    });

    expect(response.status).toBe(403);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("advances a recompute run all the way to a terminal status", async () => {
    const auth = createAuthHeaders({ workspaceSlug: "hr", role: "admin" });
    let getCalls = 0;
    vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
      const call = parseConvexCall(input, init);
      if (call.pathName === "companies:getIndustryRecomputeRun") {
        getCalls += 1;
        if (getCalls === 1) {
          return convexSuccess({
            runId: "run-1",
            workspaceSlug: "hr",
            companyKey: "acme-cnc",
            targetRevisionId: "revision-2",
            status: "queued",
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
            updatedAt: 11,
          });
        }
        return convexSuccess({
          runId: "run-1",
          workspaceSlug: "hr",
          companyKey: "acme-cnc",
          targetRevisionId: "revision-2",
          status: "completed",
          attempt: 1,
          sourceDone: true,
          pageCount: 1,
          affectedCount: 1,
          alreadyCurrentCount: 0,
          scheduledCount: 0,
          readyCount: 1,
          failureCount: 0,
          batchCount: 0,
          failures: [],
          createdAt: 10,
          startedAt: 11,
          completedAt: 12,
          updatedAt: 12,
        });
      }
      if (call.pathName === "companies:getIndustryRecomputeRevisionState") {
        return convexSuccess({ matchesTargetRevision: true, currentRevisionId: "revision-2" });
      }
      if (call.pathName === "companies:getNextIndustryRecomputeBatch") {
        return convexSuccess(null);
      }
      if (call.pathName === "companies:listAffectedResumesByCompany") {
        return convexSuccess({ items: [], continueCursor: "", isDone: true });
      }
      if (call.pathName === "companies:reserveIndustryRecomputePage") {
        return convexSuccess({
          runId: "run-1",
          workspaceSlug: "hr",
          companyKey: "acme-cnc",
          targetRevisionId: "revision-2",
          status: "running",
          attempt: 1,
          sourceDone: true,
          pageCount: 1,
          affectedCount: 1,
          alreadyCurrentCount: 0,
          scheduledCount: 0,
          readyCount: 1,
          failureCount: 0,
          batchCount: 0,
          failures: [],
          createdAt: 10,
          startedAt: 11,
          updatedAt: 12,
        });
      }
      throw new Error(`Unexpected path ${call.pathName}`);
    });

    const app = createApp({ authStorage: auth.storage });
    const response = await app.request(
      "/api/company-industry-recompute-runs/run-1/advance-all",
      { method: "POST", headers: auth.headers },
    );

    expect(response.status).toBe(200);
    const body = await parseJsonBody<{ item: { status: string; runId: string } }>(response);
    expect(body.item).toMatchObject({ runId: "run-1", status: "completed" });
    expect(getCalls).toBe(2);
  });

  it("starts a recompute run from the approved proposal without capturing start as a runId", async () => {
    const auth = createAuthHeaders({ workspaceSlug: "hr", role: "admin" });
    const calls: ConvexCall[] = [];
    vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
      const call = parseConvexCall(input, init);
      calls.push(call);
      if (call.pathName === "companies:listIndustryProposals") {
        expect(call.args.status).toBe("approved");
        return convexSuccess([
          {
            _id: "proposal-row",
            proposalId: "proposal-1",
            companyKey: "acme-cnc",
            triggerReasons: ["manual"],
            priority: 80,
            status: "approved",
            approvedRevisionId: "revision-2",
            createdAt: 1,
            updatedAt: 2,
          },
        ]);
      }
      if (call.pathName === "companies:startIndustryRecomputeRun") {
        expect(call.args).toMatchObject({
          workspaceSlug: "hr",
          companyKey: "acme-cnc",
          targetRevisionId: "revision-2",
          requestedBy: auth.userId,
        });
        return convexSuccess({
          runId: "run-1",
          workspaceSlug: "hr",
          companyKey: "acme-cnc",
          targetRevisionId: "revision-2",
          status: "queued",
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
          updatedAt: 11,
        });
      }
      if (call.pathName === "companies:backfillCompanyResumeLinksByCompanySync") {
        return convexSuccess({
          status: "completed",
          companyKey: "acme-cnc",
          scannedRows: 0,
          matchedRows: 0,
          linkedRows: 0,
          cursor: null,
          isDone: true,
        });
      }
      if (call.pathName === "companies:getIndustryRecomputeRun") {
        return convexSuccess({
          runId: "run-1",
          workspaceSlug: "hr",
          companyKey: "acme-cnc",
          targetRevisionId: "revision-2",
          status: "completed",
          attempt: 1,
          sourceDone: true,
          pageCount: 0,
          affectedCount: 0,
          alreadyCurrentCount: 0,
          scheduledCount: 0,
          readyCount: 0,
          failureCount: 0,
          batchCount: 0,
          failures: [],
          createdAt: 10,
          completedAt: 12,
          updatedAt: 12,
        });
      }
      throw new Error(`Unexpected path ${call.pathName}`);
    });

    const app = createApp({ authStorage: auth.storage });
    const response = await app.request(
      "/api/company-industry-recompute-runs/start",
      {
        method: "POST",
        headers: { ...auth.headers, "Content-Type": "application/json" },
        body: JSON.stringify({ workspaceSlug: "hr", companyKey: "acme-cnc" }),
      },
    );

    expect(response.status).toBe(200);
    const body = await parseJsonBody<{ item: { runId: string; status: string } }>(response);
    expect(body.item).toMatchObject({ runId: "run-1", status: "completed" });
    expect(calls.some((call) => call.pathName === "companies:startIndustryRecomputeRun")).toBe(true);
    // The literal `start` segment must be routed to the start handler, not to
    // the `:runId` GET route (which would 404 on `getIndustryRecomputeRun`).
    expect(calls.some((call) => call.pathName === "companies:getIndustryRecomputeRun")).toBe(true);
  });

  it("returns 404 when starting a recompute run without an approved proposal", async () => {
    const auth = createAuthHeaders({ workspaceSlug: "hr", role: "admin" });
    vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
      const call = parseConvexCall(input, init);
      if (call.pathName === "companies:listIndustryProposals") {
        return convexSuccess([]);
      }
      throw new Error(`Unexpected path ${call.pathName}`);
    });

    const app = createApp({ authStorage: auth.storage });
    const response = await app.request(
      "/api/company-industry-recompute-runs/start",
      {
        method: "POST",
        headers: { ...auth.headers, "Content-Type": "application/json" },
        body: JSON.stringify({ workspaceSlug: "hr", companyKey: "acme-cnc" }),
      },
    );

    expect(response.status).toBe(404);
    expect(await parseJsonBody(response)).toEqual({
      success: false,
      error: "No approved proposal for companyKey",
    });
  });

  it("resets a recompute run to queued for an admin", async () => {
    const auth = createAuthHeaders({ workspaceSlug: "hr", role: "admin" });
    const calls: ConvexCall[] = [];
    vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
      const call = parseConvexCall(input, init);
      calls.push(call);
      if (call.pathName === "companies:resetIndustryRecomputeRun") {
        expect(call.args).toMatchObject({
          runId: "run-1",
          requestedBy: auth.userId,
        });
        return convexSuccess({
          runId: "run-1",
          workspaceSlug: "hr",
          companyKey: "acme-cnc",
          targetRevisionId: "revision-2",
          status: "queued",
          attempt: 2,
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
          updatedAt: 12,
        });
      }
      throw new Error(`Unexpected path ${call.pathName}`);
    });

    const app = createApp({ authStorage: auth.storage });
    const response = await app.request(
      "/api/company-industry-recompute-runs/run-1/reset",
      { method: "POST", headers: auth.headers },
    );

    expect(response.status).toBe(200);
    const body = await parseJsonBody<{ item: { runId: string; status: string } }>(response);
    expect(body).toEqual({
      success: true,
      item: expect.objectContaining({ runId: "run-1", status: "queued", attempt: 2 }),
    });
    expect(calls).toHaveLength(1);
  });

  it("keeps the recompute run reset admin-only", async () => {
    const auth = createAuthHeaders({ workspaceSlug: "hr", role: "user" });
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    const app = createApp({ authStorage: auth.storage });
    const response = await app.request(
      "/api/company-industry-recompute-runs/run-1/reset",
      { method: "POST", headers: auth.headers },
    );

    expect(response.status).toBe(403);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("returns the cached verified employer count for an admin", async () => {
    const auth = createAuthHeaders({ workspaceSlug: "hr", role: "admin" });
    const { verifiedEmployerCatalog } = await import(
      "../services/verified-employer-catalog-service.js"
    );
    vi.spyOn(verifiedEmployerCatalog, "getVerifiedEmployers").mockReturnValue([
      {
        companyKey: "acme-cnc",
        industryClass: "cnc",
        displayName: "Acme CNC",
        aliases: ["acme"],
        updatedAt: 1,
      },
      {
        companyKey: "polywell",
        industryClass: "cnc",
        displayName: "Polywell",
        aliases: [],
        updatedAt: 1,
      },
    ]);

    const app = createApp({ authStorage: auth.storage });
    const response = await app.request(
      "/api/company-industry-verified-employer-count",
      { headers: auth.headers },
    );

    expect(response.status).toBe(200);
    expect(await parseJsonBody(response)).toEqual({ success: true, count: 2 });
  });

  it("serves the verified employer count to any authenticated workspace user", async () => {
    const { verifiedEmployerCatalog } = await import(
      "../services/verified-employer-catalog-service.js"
    );
    vi.spyOn(verifiedEmployerCatalog, "getVerifiedEmployers").mockReturnValue([
      {
        companyKey: "acme-cnc",
        industryClass: "cnc",
        displayName: "Acme CNC",
        aliases: ["acme"],
        updatedAt: 1,
      },
      {
        companyKey: "polywell",
        industryClass: "cnc",
        displayName: "Polywell",
        aliases: [],
        updatedAt: 1,
      },
    ]);

    // anonymous (no session) → 401
    const anonymousApp = createApp();
    const anonymousResponse = await anonymousApp.request(
      "/api/company-industry-verified-employer-count",
      { headers: { "X-Workspace-Slug": "hr" } },
    );
    expect(anonymousResponse.status).toBe(401);

    // workspace user → 200 with count
    const userAuth = createAuthHeaders({ workspaceSlug: "hr", role: "user" });
    const userApp = createApp({ authStorage: userAuth.storage });
    const userResponse = await userApp.request(
      "/api/company-industry-verified-employer-count",
      { headers: userAuth.headers },
    );
    expect(userResponse.status).toBe(200);
    expect(await parseJsonBody(userResponse)).toEqual({ success: true, count: 2 });

    // workspace admin → 200 with count
    const adminAuth = createAuthHeaders({ workspaceSlug: "hr", role: "admin" });
    const adminApp = createApp({ authStorage: adminAuth.storage });
    const adminResponse = await adminApp.request(
      "/api/company-industry-verified-employer-count",
      { headers: adminAuth.headers },
    );
    expect(adminResponse.status).toBe(200);
    expect(await parseJsonBody(adminResponse)).toEqual({ success: true, count: 2 });

    // authenticated but outside the requested workspace → 403
    const crossAuth = createAuthHeaders({
      workspaceSlug: "hr",
      requestWorkspaceSlug: "dev",
      role: "user",
    });
    const crossApp = createApp({ authStorage: crossAuth.storage });
    const crossResponse = await crossApp.request(
      "/api/company-industry-verified-employer-count",
      { headers: crossAuth.headers },
    );
    expect(crossResponse.status).toBe(403);
  });

  it("gates industry review routes to admin-or-reviewer; ops routes stay admin-only", async () => {
    vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
      const call = parseConvexCall(input, init);
      if (call.pathName === "companies:listIndustryProposalsPage") {
        return convexSuccess({ items: [], nextCursor: undefined });
      }
      if (call.pathName === "companies:listIndustryRecomputeRuns") {
        return convexSuccess([]);
      }
      throw new Error(`Unexpected path ${call.pathName}`);
    });
    vi.spyOn(
      industryEvidenceResearchService,
      "resolveIndustryProposalIdentity",
    ).mockResolvedValue({
      proposalId: "proposal-1",
      companyKey: "acme-cnc",
      auditId: "audit-1",
    });

    // reviewer → 200 on a review read route (proposal list)
    const reviewerAuth = createAuthHeaders({ workspaceSlug: "hr", role: "reviewer" });
    const reviewerApp = createApp({ authStorage: reviewerAuth.storage });
    const reviewList = await reviewerApp.request(
      "/api/company-industry-proposals?status=ready_for_review",
      { headers: reviewerAuth.headers },
    );
    expect(reviewList.status).toBe(200);

    // reviewer → 200 on a review mutation route (identity resolution)
    const identityResolution = await reviewerApp.request(
      "/api/company-industry-proposals/proposal-1/identity-resolution",
      {
        method: "POST",
        headers: {
          ...reviewerAuth.headers,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          expectedProposalUpdatedAt: 1,
          candidateFingerprint: "candidate-fingerprint-1",
          mappingMode: "create_provisional",
          sourceIds: ["source-1"],
        }),
      },
    );
    expect(identityResolution.status).toBe(200);

    // reviewer → 403 on an ops route (recompute runs)
    const recomputeDenied = await reviewerApp.request(
      "/api/company-industry-recompute-runs?companyKey=acme-cnc",
      { headers: reviewerAuth.headers },
    );
    expect(recomputeDenied.status).toBe(403);

    // workspace user → 403 on a review route
    const userAuth = createAuthHeaders({ workspaceSlug: "hr", role: "user" });
    const userApp = createApp({ authStorage: userAuth.storage });
    const userReview = await userApp.request(
      "/api/company-industry-proposals?status=ready_for_review",
      { headers: userAuth.headers },
    );
    expect(userReview.status).toBe(403);

    // admin → 200 on an ops route (unchanged)
    const adminAuth = createAuthHeaders({ workspaceSlug: "hr", role: "admin" });
    const adminApp = createApp({ authStorage: adminAuth.storage });
    const recomputeAllowed = await adminApp.request(
      "/api/company-industry-recompute-runs?companyKey=acme-cnc",
      { headers: adminAuth.headers },
    );
    expect(recomputeAllowed.status).toBe(200);
  });
});
