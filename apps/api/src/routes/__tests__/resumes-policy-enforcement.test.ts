import { afterEach, describe, expect, it, vi } from "vitest";

import { createApp } from "../../app";
import { parseJsonBody } from "../../test-utils";
import { createAuthContext } from "../test-auth-helpers";

type ConvexCall = {
  pathName: string;
  args: Record<string, unknown>;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function parseConvexCall(input: Request | string | URL, init?: RequestInit): ConvexCall {
  const body = typeof init?.body === "string" ? JSON.parse(init.body) : null;
  if (!isRecord(body)) throw new Error("Missing convex request body");

  const pathName = typeof body.path === "string" ? body.path : "";
  const args = isRecord(body.args) ? body.args : {};
  return { pathName, args };
}

function convexSuccess(value: unknown): Response {
  return new Response(JSON.stringify({ status: "success", value }), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
}

function buildDigestRow(resumeId: string, overrides: Record<string, unknown> = {}) {
  return {
    _id: `digest-${resumeId}`,
    resumeId,
    source: "seek",
    sourceKey: "seek",
    searchText: "cnc 销售工程师",
    isArchived: false,
    primaryRuleScore: 0,
    age: 30,
    ...overrides,
  };
}

function buildResumeDoc(
  resumeId: string,
  overrides: {
    name?: string;
    identityKey?: string;
    externalId?: string;
    companyKey?: string;
    companyHits?: string[];
    sourceKey?: string;
  } = {}
) {
  return {
    _id: resumeId,
    identityKey: overrides.identityKey ?? `key-${resumeId}`,
    externalId: overrides.externalId ?? `ext-${resumeId}`,
    source: "seek",
    ...(overrides.sourceKey ? { sourceKey: overrides.sourceKey } : {}),
    primaryRuleScore: 0,
    searchText: "cnc 销售工程师",
    isArchived: false,
    crawledAt: Date.now(),
    tags: [],
    content: {
      name: overrides.name ?? resumeId,
      location: "东莞",
      experience: "5年",
      education: "本科",
      jobIntention: "CNC销售",
      profileUrl: `https://example.com/${resumeId}`,
      workHistory: overrides.companyKey
        ? [{ raw: "2020-2025 销售工程师", companyName: "宝力机械", companyKey: overrides.companyKey }]
        : [{ raw: "2020-2025 销售工程师", companyName: "其他公司" }],
      extractedAt: "2026-03-24T00:00:00.000Z",
    },
    ingestData: {
      industryTags: ["制造业"],
      ...(overrides.companyHits ? { companyHits: overrides.companyHits } : {}),
    },
  };
}

const mockCompany = {
  _id: "comp-1",
  companyKey: "baoli-machinery",
  displayName: "宝力机械",
  status: "confirmed",
  createdAt: 0,
  updatedAt: 0,
  aliases: [{ aliasDisplay: "宝力机械", aliasNormalized: "宝力机械", source: "operator" }],
};

const mockPolicy = {
  companyKey: "baoli-machinery",
  displayName: "宝力机械",
  status: "confirmed",
  scopeType: "workspace",
  scopeId: "dev",
  revision: 1,
  effects: {
    visibility: "hide",
    workflow: "blocked",
    rankingEffect: "no_hire",
    reasonCodes: ["POLICY_TEST"],
    summary: "test",
  },
  createdAt: 0,
};

function setupMockConvex(options: {
  overrides?: Array<{
    resumeIdentity: string;
    companyKey: string;
    effect: string;
  }>;
  resumeDocs?: ReturnType<typeof buildResumeDoc>[];
  digestDocs?: ReturnType<typeof buildDigestRow>[];
  workspacePolicies?: Array<Record<string, unknown>>;
  marketPolicies?: Record<string, Array<Record<string, unknown>>>;
}) {
  const resumeDocs = options.resumeDocs ?? [
    buildResumeDoc("r-hidden", { name: "Hidden Resume", identityKey: "key-1", companyKey: "baoli-machinery" }),
    buildResumeDoc("r-visible", { name: "Visible Resume", identityKey: "key-2" }),
  ];
  const digestDocs = options.digestDocs ?? [
    buildDigestRow("r-hidden"),
    buildDigestRow("r-visible"),
  ];
  const overrides = (options.overrides ?? []).map((item, idx) => ({
    _id: `override-${idx}`,
    workspaceSlug: "dev",
    resumeId: "r-hidden",
    resumeIdentity: item.resumeIdentity,
    companyKey: item.companyKey,
    effect: item.effect,
    createdAt: 0,
    updatedAt: 0,
  }));
  const workspacePolicies = options.workspacePolicies ?? [mockPolicy];
  const marketPolicies = options.marketPolicies ?? {};

  vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
    const call = parseConvexCall(input, init);
    if (call.pathName === "resumes_search:scanResumeDigestPage") {
      return convexSuccess({
        docs: digestDocs,
        isDone: true,
        cursor: null,
      });
    }
    if (call.pathName === "resumes_search:getResumeDocsByIds") {
      const ids = (call.args.ids as string[]) ?? [];
      const matched = resumeDocs.filter((doc) => ids.includes(doc._id));
      return convexSuccess(matched);
    }
    if (call.pathName === "candidate_status:list" || call.pathName === "candidate_blocks:list") {
      return convexSuccess([]);
    }
    if (call.pathName === "companies:list") {
      return convexSuccess([mockCompany]);
    }
    if (call.pathName === "companies:listPoliciesForScope") {
      if (call.args.scopeType === "market") {
        return convexSuccess(marketPolicies[String(call.args.scopeId)] ?? []);
      }
      if (call.args.scopeType === "workspace") {
        return convexSuccess(workspacePolicies);
      }
      return convexSuccess([]);
    }
    if (call.pathName === "candidate_policy_overrides:list") {
      return convexSuccess(overrides);
    }
    if (call.pathName === "resumes:getResumeDetail") {
      const resumeId = String(call.args.resumeId ?? "");
      const doc = resumeDocs.find((d) => d._id === resumeId);
      if (!doc) {
        return convexSuccess(null);
      }
      return convexSuccess({
        ...doc,
        ...doc.content,
        resumeId: doc._id,
        workHistory: doc.content.workHistory,
      });
    }
    if (call.pathName === "companies:listVerifiedIndustryEmployerAliases") {
      return convexSuccess([]);
    }
    throw new Error(`Unexpected convex path: ${call.pathName}`);
  });
}

describe("Resumes Policy Enforcement (server-side hide)", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe("List Route (resumes_search)", () => {
    it("1. Plain user: hidden row absent from list response; visible row present", async () => {
      setupMockConvex({});
      const app = createApp({
        authContext: createAuthContext({ workspaceSlug: "dev", role: "user" }),
      });
      const res = await app.request("/api/resumes?source=convex&q=CNC%20销售&limit=5");
      expect(res.status).toBe(200);
      const body = await parseJsonBody<{ success: boolean; data: Array<{ name: string; resumeId: string }> }>(res);
      expect(body.success).toBe(true);
      const names = body.data.map((item) => item.name);
      expect(names).toContain("Visible Resume");
      expect(names).not.toContain("Hidden Resume");
    });

    it("2. Reviewer + ?includeHidden=true: hidden row present", async () => {
      setupMockConvex({});
      const app = createApp({
        authContext: createAuthContext({ workspaceSlug: "dev", role: "reviewer" }),
      });
      const res = await app.request("/api/resumes?source=convex&q=CNC%20销售&limit=5&includeHidden=true");
      expect(res.status).toBe(200);
      const body = await parseJsonBody<{ success: boolean; data: Array<{ name: string }> }>(res);
      expect(body.success).toBe(true);
      const names = body.data.map((item) => item.name);
      expect(names).toContain("Visible Resume");
      expect(names).toContain("Hidden Resume");
    });

    it("3. Reviewer WITHOUT ?includeHidden=true: hidden row absent", async () => {
      setupMockConvex({});
      const app = createApp({
        authContext: createAuthContext({ workspaceSlug: "dev", role: "reviewer" }),
      });
      const res = await app.request("/api/resumes?source=convex&q=CNC%20销售&limit=5");
      expect(res.status).toBe(200);
      const body = await parseJsonBody<{ success: boolean; data: Array<{ name: string }> }>(res);
      expect(body.success).toBe(true);
      const names = body.data.map((item) => item.name);
      expect(names).toContain("Visible Resume");
      expect(names).not.toContain("Hidden Resume");
    });

    it("4. Plain user + ?includeHidden=true: hidden row still absent (param ignored)", async () => {
      setupMockConvex({});
      const app = createApp({
        authContext: createAuthContext({ workspaceSlug: "dev", role: "user" }),
      });
      const res = await app.request("/api/resumes?source=convex&q=CNC%20销售&limit=5&includeHidden=true");
      expect(res.status).toBe(200);
      const body = await parseJsonBody<{ success: boolean; data: Array<{ name: string }> }>(res);
      expect(body.success).toBe(true);
      const names = body.data.map((item) => item.name);
      expect(names).toContain("Visible Resume");
      expect(names).not.toContain("Hidden Resume");
    });

    it("5. Plain user + active override: hidden row present", async () => {
      setupMockConvex({
        overrides: [
          { resumeIdentity: "key-1", companyKey: "baoli-machinery", effect: "allow" },
        ],
      });
      const app = createApp({
        authContext: createAuthContext({ workspaceSlug: "dev", role: "user" }),
      });
      const res = await app.request("/api/resumes?source=convex&q=CNC%20销售&limit=5");
      expect(res.status).toBe(200);
      const body = await parseJsonBody<{ success: boolean; data: Array<{ name: string }> }>(res);
      expect(body.success).toBe(true);
      const names = body.data.map((item) => item.name);
      expect(names).toContain("Visible Resume");
      expect(names).toContain("Hidden Resume");
    });
  });

  describe("Detail Route (resumes.ts)", () => {
    it("6a. Plain user GET /api/resumes/:id for hidden resume → 404", async () => {
      setupMockConvex({});
      const app = createApp({
        authContext: createAuthContext({ workspaceSlug: "dev", role: "user" }),
      });
      const res = await app.request("/api/resumes/r-hidden?source=convex");
      expect(res.status).toBe(404);
      const body = await parseJsonBody<{ success: boolean; error: string }>(res);
      expect(body.success).toBe(false);
      expect(body.error).toContain("Resume not found: r-hidden");
    });

    it("6b. Admin + ?includeHidden=true for hidden resume → 200", async () => {
      setupMockConvex({});
      const app = createApp({
        authContext: createAuthContext({ workspaceSlug: "dev", role: "admin" }),
      });
      const res = await app.request("/api/resumes/r-hidden?source=convex&includeHidden=true");
      expect(res.status).toBe(200);
      const body = await parseJsonBody<{ success: boolean; data: { name: string } }>(res);
      expect(body.success).toBe(true);
      expect(body.data.name).toBe("Hidden Resume");
    });

    it("6c. Admin + active override for hidden resume → 200 (without includeHidden)", async () => {
      setupMockConvex({
        overrides: [
          { resumeIdentity: "key-1", companyKey: "baoli-machinery", effect: "allow" },
        ],
      });
      const app = createApp({
        authContext: createAuthContext({ workspaceSlug: "dev", role: "admin" }),
      });
      const res = await app.request("/api/resumes/r-hidden?source=convex");
      expect(res.status).toBe(200);
      const body = await parseJsonBody<{ success: boolean; data: { name: string } }>(res);
      expect(body.success).toBe(true);
      expect(body.data.name).toBe("Hidden Resume");
    });
  });

  describe("Partial Override", () => {
    it("7. Partial-override (override for 1 of 2 hidden companies) still hidden for plain user", async () => {
      const docMultiHidden = {
        _id: "r-multi",
        identityKey: "key-multi",
        externalId: "ext-multi",
        source: "seek",
        primaryRuleScore: 0,
        searchText: "cnc 销售工程师",
        isArchived: false,
        crawledAt: Date.now(),
        tags: [],
        content: {
          name: "Multi Hidden Resume",
          location: "东莞",
          experience: "5年",
          education: "本科",
          jobIntention: "CNC销售",
          profileUrl: "https://example.com/r-multi",
          workHistory: [
            { raw: "2020-2022 宝力机械", companyName: "宝力机械", companyKey: "baoli-machinery" },
            { raw: "2022-2025 宝惠", companyName: "宝惠", companyKey: "polywell" },
          ],
          extractedAt: "2026-03-24T00:00:00.000Z",
        },
        ingestData: {
          industryTags: ["制造业"],
        },
      };

      const polywellCompany = {
        _id: "comp-2",
        companyKey: "polywell",
        displayName: "宝惠",
        status: "confirmed",
        createdAt: 0,
        updatedAt: 0,
        aliases: [{ aliasDisplay: "宝惠", aliasNormalized: "宝惠", source: "operator" }],
      };

      const polywellPolicy = {
        companyKey: "polywell",
        displayName: "宝惠",
        status: "confirmed",
        scopeType: "workspace",
        scopeId: "dev",
        revision: 1,
        effects: {
          visibility: "hide",
          workflow: "blocked",
          rankingEffect: "no_hire",
          reasonCodes: ["POLICY_TEST"],
          summary: "test",
        },
        createdAt: 0,
      };

      vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
        const call = parseConvexCall(input, init);
        if (call.pathName === "resumes_search:scanResumeDigestPage") {
          return convexSuccess({
            docs: [buildDigestRow("r-multi")],
            isDone: true,
            cursor: null,
          });
        }
        if (call.pathName === "resumes_search:getResumeDocsByIds") {
          return convexSuccess([docMultiHidden]);
        }
        if (call.pathName === "candidate_status:list" || call.pathName === "candidate_blocks:list") {
          return convexSuccess([]);
        }
        if (call.pathName === "companies:list") {
          return convexSuccess([mockCompany, polywellCompany]);
        }
        if (call.pathName === "companies:listPoliciesForScope") {
          return convexSuccess([mockPolicy, polywellPolicy]);
        }
        if (call.pathName === "candidate_policy_overrides:list") {
          // Only override baoli-machinery, not polywell
          return convexSuccess([
            {
              _id: "override-1",
              workspaceSlug: "dev",
              resumeId: "r-multi",
              resumeIdentity: "key-multi",
              companyKey: "baoli-machinery",
              effect: "allow",
              createdAt: 0,
              updatedAt: 0,
            },
          ]);
        }
        if (call.pathName === "companies:listVerifiedIndustryEmployerAliases") {
          return convexSuccess([]);
        }
        throw new Error(`Unexpected convex path: ${call.pathName}`);
      });

      const app = createApp({
        authContext: createAuthContext({ workspaceSlug: "dev", role: "user" }),
      });
      const res = await app.request("/api/resumes?source=convex&q=CNC%20销售&limit=5");
      expect(res.status).toBe(200);
      const body = await parseJsonBody<{ success: boolean; data: Array<{ name: string }> }>(res);
      expect(body.success).toBe(true);
      const names = body.data.map((item) => item.name);
      expect(names).not.toContain("Multi Hidden Resume");
    });
  });

  describe("Market Scope Enforcement", () => {
    const marketNoneEffects = {
      visibility: "default",
      workflow: "default",
      rankingEffect: "none",
      reasonCodes: [],
      summary: "",
    };

    it("8. CN market policy hides a CN-source resume; MY-source resume unaffected", async () => {
      setupMockConvex({
        workspacePolicies: [],
        marketPolicies: {
          cn: [{ ...mockPolicy, scopeType: "market", scopeId: "cn" }],
        },
        resumeDocs: [
          buildResumeDoc("r-cn", {
            name: "CN Market Resume",
            identityKey: "key-cn",
            companyKey: "baoli-machinery",
            sourceKey: "job5156",
          }),
          buildResumeDoc("r-my", {
            name: "MY Market Resume",
            identityKey: "key-my",
            companyKey: "baoli-machinery",
            sourceKey: "seek",
          }),
        ],
        digestDocs: [buildDigestRow("r-cn"), buildDigestRow("r-my")],
      });
      const app = createApp({
        authContext: createAuthContext({ workspaceSlug: "dev", role: "user" }),
      });
      const res = await app.request("/api/resumes?source=convex&q=CNC%20销售&limit=5");
      expect(res.status).toBe(200);
      const body = await parseJsonBody<{ success: boolean; data: Array<{ name: string }> }>(res);
      expect(body.success).toBe(true);
      const names = body.data.map((item) => item.name);
      expect(names).toContain("MY Market Resume");
      expect(names).not.toContain("CN Market Resume");
    });

    it("9. MY market explicit none overrides workspace hide for MY-source resume only", async () => {
      setupMockConvex({
        workspacePolicies: [mockPolicy],
        marketPolicies: {
          my: [
            {
              ...mockPolicy,
              scopeType: "market",
              scopeId: "my",
              effects: marketNoneEffects,
            },
          ],
        },
        resumeDocs: [
          buildResumeDoc("r-my", {
            name: "MY Market Resume",
            identityKey: "key-my",
            companyKey: "baoli-machinery",
            sourceKey: "seek",
          }),
          buildResumeDoc("r-cn", {
            name: "CN Market Resume",
            identityKey: "key-cn",
            companyKey: "baoli-machinery",
            sourceKey: "job5156",
          }),
        ],
        digestDocs: [buildDigestRow("r-my"), buildDigestRow("r-cn")],
      });
      const app = createApp({
        authContext: createAuthContext({ workspaceSlug: "dev", role: "user" }),
      });
      const res = await app.request("/api/resumes?source=convex&q=CNC%20销售&limit=5");
      expect(res.status).toBe(200);
      const body = await parseJsonBody<{ success: boolean; data: Array<{ name: string }> }>(res);
      expect(body.success).toBe(true);
      const names = body.data.map((item) => item.name);
      expect(names).toContain("MY Market Resume");
      expect(names).not.toContain("CN Market Resume");
    });

    it("10. CN market none does not leak into MY enforcement", async () => {
      setupMockConvex({
        workspacePolicies: [mockPolicy],
        marketPolicies: {
          cn: [
            {
              ...mockPolicy,
              scopeType: "market",
              scopeId: "cn",
              effects: marketNoneEffects,
            },
          ],
        },
        resumeDocs: [
          buildResumeDoc("r-my", {
            name: "MY Market Resume",
            identityKey: "key-my",
            companyKey: "baoli-machinery",
            sourceKey: "seek",
          }),
        ],
        digestDocs: [buildDigestRow("r-my")],
      });
      const app = createApp({
        authContext: createAuthContext({ workspaceSlug: "dev", role: "user" }),
      });
      const res = await app.request("/api/resumes?source=convex&q=CNC%20销售&limit=5");
      expect(res.status).toBe(200);
      const body = await parseJsonBody<{ success: boolean; data: Array<{ name: string }> }>(res);
      expect(body.success).toBe(true);
      const names = body.data.map((item) => item.name);
      expect(names).not.toContain("MY Market Resume");
    });

    it("11. Detail route applies market policy: CN-source hidden resume 404s for plain user", async () => {
      setupMockConvex({
        workspacePolicies: [],
        marketPolicies: {
          cn: [{ ...mockPolicy, scopeType: "market", scopeId: "cn" }],
        },
        resumeDocs: [
          buildResumeDoc("r-cn", {
            name: "CN Market Resume",
            identityKey: "key-cn",
            companyKey: "baoli-machinery",
            sourceKey: "job5156",
          }),
        ],
      });
      const app = createApp({
        authContext: createAuthContext({ workspaceSlug: "dev", role: "user" }),
      });
      const res = await app.request("/api/resumes/r-cn?source=convex");
      expect(res.status).toBe(404);
      const body = await parseJsonBody<{ success: boolean; error: string }>(res);
      expect(body.success).toBe(false);
      expect(body.error).toContain("Resume not found: r-cn");
    });
  });
});
