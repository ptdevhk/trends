import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("../middleware/maintenance.js", () => ({
  maintenanceGuard: async (_c: unknown, next: () => Promise<void>) => {
    await next();
  },
}));

import { createApp } from "../app";
import type { CandidatePolicyOverrideRecord } from "../services/candidate-policy-override-service";
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

function overrideRecord(
  overrides: Partial<CandidatePolicyOverrideRecord> & { _id: string }
): CandidatePolicyOverrideRecord {
  return {
    workspaceSlug: "hr",
    resumeId: "dev_resumes_abc123",
    resumeIdentity: "identity-123",
    companyKey: "polywell",
    effect: "allow",
    reason: "Valid experience",
    createdAt: 1_700_000_000_000,
    updatedAt: 1_700_000_000_000,
    ...overrides,
  };
}

describe("POST /api/policy-overrides", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("rejects empty resumeId without calling Convex", async () => {
    const auth = createAuthHeaders({ workspaceSlug: "hr", role: "admin" });
    const fetchSpy = vi.spyOn(globalThis, "fetch");

    const app = createApp({ authStorage: auth.storage });
    const response = await app.request("/api/policy-overrides", {
      method: "POST",
      headers: {
        ...auth.headers,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        resumeId: "",
        resumeIdentity: "identity-123",
        companyKey: "polywell",
        reason: "Valid experience",
      }),
    });

    expect(response.status).toBe(400);
    const body = await parseJsonBody<{ success: boolean; error: string }>(response);
    expect(body).toEqual({ success: false, error: "resumeId is required" });
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("rejects whitespace-only resumeId without calling Convex", async () => {
    const auth = createAuthHeaders({ workspaceSlug: "hr", role: "admin" });
    const fetchSpy = vi.spyOn(globalThis, "fetch");

    const app = createApp({ authStorage: auth.storage });
    const response = await app.request("/api/policy-overrides", {
      method: "POST",
      headers: {
        ...auth.headers,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        resumeId: "   ",
        resumeIdentity: "identity-123",
        companyKey: "polywell",
        reason: "Valid experience",
      }),
    });

    expect(response.status).toBe(400);
    const body = await parseJsonBody<{ success: boolean; error: string }>(response);
    expect(body).toEqual({ success: false, error: "resumeId is required" });
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("converts malformed resumeId validator error to 400", async () => {
    const auth = createAuthHeaders({ workspaceSlug: "hr", role: "admin" });
    const calls: ConvexCall[] = [];
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
      const call = parseConvexCall(input, init);
      calls.push(call);
      return new Response(
        JSON.stringify({
          status: "error",
          errorMessage: 'Value does not match validator. Path: .resumeId Validator: v.id("resumes")',
        }),
        {
          status: 400,
          headers: { "Content-Type": "application/json" },
        }
      );
    });

    const app = createApp({ authStorage: auth.storage });
    const response = await app.request("/api/policy-overrides", {
      method: "POST",
      headers: {
        ...auth.headers,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        resumeId: "not-a-convex-id",
        resumeIdentity: "identity-123",
        companyKey: "polywell",
        reason: "Valid experience",
      }),
    });

    expect(response.status).toBe(400);
    const body = await parseJsonBody<{ success: boolean; error: string }>(response);
    expect(body).toEqual({ success: false, error: "Invalid resumeId" });
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    expect(calls).toHaveLength(1);
    expect(calls[0].pathName).toBe("candidate_policy_overrides:set");
  });

  it("sets policy override on happy path with trimmed resumeId", async () => {
    const auth = createAuthHeaders({ workspaceSlug: "hr", role: "admin" });
    const calls: ConvexCall[] = [];
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
      const call = parseConvexCall(input, init);
      calls.push(call);
      return convexSuccess("dev_candidate_policy_overrides_xyz");
    });

    const app = createApp({ authStorage: auth.storage });
    const response = await app.request("/api/policy-overrides", {
      method: "POST",
      headers: {
        ...auth.headers,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        resumeId: "dev_resumes_abc123",
        resumeIdentity: "  identity-123  ",
        companyKey: "  polywell  ",
        reason: "  Valid experience  ",
      }),
    });

    expect(response.status).toBe(200);
    const body = await parseJsonBody<{ success: boolean; id: string }>(response);
    expect(body).toEqual({ success: true, id: "dev_candidate_policy_overrides_xyz" });
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    expect(calls).toHaveLength(1);
    expect(calls[0].pathName).toBe("candidate_policy_overrides:set");
    expect(calls[0].args).toEqual(
      expect.objectContaining({
        workspaceSlug: "hr",
        resumeId: "dev_resumes_abc123",
        resumeIdentity: "identity-123",
        companyKey: "polywell",
        reason: "Valid experience",
      })
    );
  });

  it("rejects missing/empty fields when resumeId is present", async () => {
    const auth = createAuthHeaders({ workspaceSlug: "hr", role: "admin" });
    const fetchSpy = vi.spyOn(globalThis, "fetch");

    const app = createApp({ authStorage: auth.storage });
    const response = await app.request("/api/policy-overrides", {
      method: "POST",
      headers: {
        ...auth.headers,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        resumeId: "dev_resumes_abc123",
        resumeIdentity: "",
        companyKey: "polywell",
        reason: "Valid experience",
      }),
    });

    expect(response.status).toBe(400);
    const body = await parseJsonBody<{ success: boolean; error: string }>(response);
    expect(body).toEqual({
      success: false,
      error: "resumeIdentity, companyKey, and reason are required",
    });
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});

describe("GET /api/policy-overrides", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("requires an authenticated workspace user", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    const app = createApp();

    const response = await app.request("/api/policy-overrides", { method: "GET" });

    expect(response.status).toBe(401);
    const body = await parseJsonBody<{ success: boolean; error: string }>(response);
    expect(body).toEqual({ success: false, error: "Authentication required" });
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("lists overrides for the actor workspace", async () => {
    const auth = createAuthHeaders({ workspaceSlug: "hr", role: "admin" });
    const calls: ConvexCall[] = [];
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
      const call = parseConvexCall(input, init);
      calls.push(call);
      return convexSuccess([
        overrideRecord({ _id: "over_1" }),
        overrideRecord({ _id: "over_2", resumeIdentity: "identity-456", companyKey: "fanuc" }),
      ]);
    });

    const app = createApp({ authStorage: auth.storage });
    const response = await app.request("/api/policy-overrides", {
      method: "GET",
      headers: auth.headers,
    });

    expect(response.status).toBe(200);
    const body = await parseJsonBody<{ success: boolean; items: CandidatePolicyOverrideRecord[] }>(response);
    expect(body.success).toBe(true);
    expect(body.items.map((item) => item._id)).toEqual(["over_1", "over_2"]);
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    expect(calls[0].type).toBe("query");
    expect(calls[0].pathName).toBe("candidate_policy_overrides:list");
    expect(calls[0].args.workspaceSlug).toBe("hr");
    expect(calls[0].args).toEqual(
      expect.objectContaining({
        paginationOpts: expect.objectContaining({ cursor: null, numItems: 500 }),
      })
    );
  });
});

describe("DELETE /api/policy-overrides", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("requires an authenticated workspace user", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    const app = createApp();

    const response = await app.request(
      "/api/policy-overrides?resumeIdentity=identity-123&companyKey=polywell",
      { method: "DELETE" }
    );

    expect(response.status).toBe(401);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("removes the override and reports removed=true", async () => {
    const auth = createAuthHeaders({ workspaceSlug: "hr", role: "admin" });
    const calls: ConvexCall[] = [];
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
      const call = parseConvexCall(input, init);
      calls.push(call);
      return convexSuccess(true);
    });

    const app = createApp({ authStorage: auth.storage });
    const response = await app.request(
      "/api/policy-overrides?resumeIdentity=identity-123&companyKey=polywell",
      { method: "DELETE", headers: auth.headers }
    );

    expect(response.status).toBe(200);
    const body = await parseJsonBody<{ success: boolean; removed: boolean }>(response);
    expect(body).toEqual({ success: true, removed: true });
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    expect(calls[0].type).toBe("mutation");
    expect(calls[0].pathName).toBe("candidate_policy_overrides:remove");
    expect(calls[0].args).toEqual(
      expect.objectContaining({
        workspaceSlug: "hr",
        resumeIdentity: "identity-123",
        companyKey: "polywell",
      })
    );
  });

  it("reports removed=false when nothing matched", async () => {
    const auth = createAuthHeaders({ workspaceSlug: "hr", role: "admin" });
    vi.spyOn(globalThis, "fetch").mockImplementation(async () => convexSuccess(false));

    const app = createApp({ authStorage: auth.storage });
    const response = await app.request(
      "/api/policy-overrides?resumeIdentity=identity-123&companyKey=polywell",
      { method: "DELETE", headers: auth.headers }
    );

    expect(response.status).toBe(200);
    const body = await parseJsonBody<{ success: boolean; removed: boolean }>(response);
    expect(body).toEqual({ success: true, removed: false });
  });

  it.each([false, "yes"])(
    "reports removed=false when the Convex payload is %p",
    async (payload) => {
      const auth = createAuthHeaders({ workspaceSlug: "hr", role: "admin" });
      vi.spyOn(globalThis, "fetch").mockImplementation(async () => convexSuccess(payload));

      const app = createApp({ authStorage: auth.storage });
      const response = await app.request(
        "/api/policy-overrides?resumeIdentity=identity-123&companyKey=polywell",
        { method: "DELETE", headers: auth.headers }
      );

      expect(response.status).toBe(200);
      const body = await parseJsonBody<{ success: boolean; removed: boolean }>(response);
      expect(body).toEqual({ success: true, removed: false });
    }
  );

  it("rejects requests missing query params without calling Convex", async () => {
    const auth = createAuthHeaders({ workspaceSlug: "hr", role: "admin" });
    const fetchSpy = vi.spyOn(globalThis, "fetch");

    const app = createApp({ authStorage: auth.storage });
    const response = await app.request("/api/policy-overrides?resumeIdentity=identity-123", {
      method: "DELETE",
      headers: auth.headers,
    });

    expect(response.status).toBe(400);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("surfaces a Convex mutation failure as a 500", async () => {
    const auth = createAuthHeaders({ workspaceSlug: "hr", role: "admin" });
    vi.spyOn(globalThis, "fetch").mockImplementation(async () =>
      new Response(JSON.stringify({ status: "error", errorMessage: "Unauthorized Convex write" }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      })
    );

    const app = createApp({ authStorage: auth.storage });
    const response = await app.request(
      "/api/policy-overrides?resumeIdentity=identity-123&companyKey=polywell",
      { method: "DELETE", headers: auth.headers }
    );

    expect(response.status).toBe(500);
  });
});
