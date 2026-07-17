import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("../middleware/maintenance.js", () => ({
  maintenanceGuard: async (_c: unknown, next: () => Promise<void>) => {
    await next();
  },
}));

import { createApp } from "../app";
import { resetResumeScreeningDb } from "../services/database";
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
    const companiesBody = await companies.json();
    const policiesBody = await policies.json();
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
    const body = await response.json();
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
    const body = await response.json();
    expect(body.companiesCreated).toBe(2);
    expect(body.policiesSeeded).toBe(2);
    expect(body.policyRevision).toBe(1);
  });
});
