import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("../middleware/maintenance.js", () => ({
  maintenanceGuard: async (_c: unknown, next: () => Promise<void>) => {
    await next();
  },
}));

import { createApp } from "../app";
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
