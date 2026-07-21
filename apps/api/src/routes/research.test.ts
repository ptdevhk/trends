import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("../middleware/maintenance.js", () => ({
  maintenanceGuard: async (_c: unknown, next: () => Promise<void>) => {
    await next();
  },
}));

import { createApp } from "../app";
import { resetResumeScreeningDb } from "../services/database";
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

describe("research routes", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    resetResumeScreeningDb();
  });

  it("rejects research news without session", async () => {
    const app = createApp();
    const response = await app.request("/api/research/news");
    expect(response.status).toBe(401);
  });

  it("lists company signals with persona query param and ranks for hr", async () => {
    const auth = createAuthHeaders({ workspaceSlug: "hr", role: "user" });
    const calls: ConvexCall[] = [];
    vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
      const url =
        typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
      if (url.includes("/api/query") || url.includes("/api/mutation")) {
        const call = parseConvexCall(input, init);
        calls.push(call);
        if (call.pathName === "research_signals:listByCompany") {
          expect(call.args.companyKey).toBe("pro-technic-machinery");
          return convexSuccess([
            {
              _id: "s1",
              companyKey: "pro-technic-machinery",
              kind: "sales_trigger",
              title: "sales",
              evidence: { title: "sales", platform: "weibo", seenAt: 1 },
              capturedAt: 1,
            },
            {
              _id: "s2",
              companyKey: "pro-technic-machinery",
              kind: "hiring_signal",
              title: "hire",
              evidence: { title: "hire", platform: "weibo", seenAt: 2 },
              capturedAt: 2,
            },
          ]);
        }
      }
      return convexSuccess(null);
    });

    const app = createApp();
    const response = await app.request(
      "/api/research/companies/pro-technic-machinery/signals?persona=hr",
      { headers: auth.headers },
    );
    expect(response.status).toBe(200);
    const body = await parseJsonBody(response);
    expect(body.success).toBe(true);
    expect(body.persona).toBe("hr");
    expect(body.items[0].kind).toBe("hiring_signal");
    expect(body.items[1].kind).toBe("sales_trigger");
    expect(calls.some((c) => c.pathName === "research_signals:listByCompany")).toBe(true);
  });

  it("proxies ingest trigger to worker research endpoint", async () => {
    const auth = createAuthHeaders({ workspaceSlug: "hr", role: "user" });
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
      const url =
        typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
      if (url.includes("/worker/research/ingest")) {
        return new Response(
          JSON.stringify({
            success: true,
            mode: "research-ingest",
            started_at: "t0",
            finished_at: "t1",
            message: "ok",
          }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        );
      }
      return convexSuccess(null);
    });

    const app = createApp();
    const response = await app.request("/api/research/ingest/run", {
      method: "POST",
      headers: auth.headers,
    });
    expect(response.status).toBe(200);
    const body = await parseJsonBody(response);
    expect(body.mode).toBe("research-ingest");
    expect(
      fetchSpy.mock.calls.some((call) => {
        const url =
          typeof call[0] === "string"
            ? call[0]
            : call[0] instanceof URL
              ? call[0].toString()
              : call[0].url;
        return url.includes("/worker/research/ingest");
      }),
    ).toBe(true);
  });

  it("returns parity payload from Convex ops", async () => {
    const auth = createAuthHeaders({ workspaceSlug: "hr", role: "user" });
    vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
      const call = parseConvexCall(input, init);
      if (call.pathName === "research_ops:latestParity") {
        return convexSuccess({ parityRunId: "p1", green: true, greenStreak: 2 });
      }
      return convexSuccess(null);
    });
    const app = createApp();
    const response = await app.request("/api/research/parity", { headers: auth.headers });
    expect(response.status).toBe(200);
    const body = await parseJsonBody(response);
    expect(body.parity.parityRunId).toBe("p1");
    expect(body.parity.greenStreak).toBe(2);
  });
});
