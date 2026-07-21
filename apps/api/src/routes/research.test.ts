import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("../middleware/maintenance.js", () => ({
  maintenanceGuard: async (_c: unknown, next: () => Promise<void>) => {
    await next();
  },
}));

const showcaseMocks = vi.hoisted(() => ({
  getResearchShowcase: vi.fn(),
  seedResearchShowcase: vi.fn(),
}));

vi.mock("../services/research-showcase-service.js", () => ({
  getResearchShowcase: showcaseMocks.getResearchShowcase,
  seedResearchShowcase: showcaseMocks.seedResearchShowcase,
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
    showcaseMocks.getResearchShowcase.mockReset();
    showcaseMocks.seedResearchShowcase.mockReset();
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

  it("returns latest ingest run from Convex ops", async () => {
    const auth = createAuthHeaders({ workspaceSlug: "hr", role: "user" });
    vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
      const call = parseConvexCall(input, init);
      if (call.pathName === "research_ops:latestIngestRun") {
        return convexSuccess({ runId: "run-9", status: "success", newsInserted: 2 });
      }
      return convexSuccess(null);
    });
    const app = createApp();
    const response = await app.request("/api/research/ingest/latest", { headers: auth.headers });
    expect(response.status).toBe(200);
    const body = await parseJsonBody(response);
    expect(body.run.runId).toBe("run-9");
    expect(body.run.newsInserted).toBe(2);
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

  it("returns showcase hub payload from service", async () => {
    const auth = createAuthHeaders({ workspaceSlug: "hr", role: "user" });
    showcaseMocks.getResearchShowcase.mockResolvedValue({
      golden: [
        {
          companyKey: "pro-technic-machinery",
          displayName: "Pro-Technic",
          kindCounts: { hiring_signal: 1, sales_trigger: 1 },
          signalCount: 2,
          showcase: true,
          href: "/hr/research/pro-technic-machinery?persona=hr",
        },
      ],
      fromResumeDesk: [
        {
          companyKey: "globalfoundries",
          displayName: "GlobalFoundries",
          kindCounts: { hiring_signal: 1 },
          signalCount: 1,
          showcase: true,
          href: "/hr/research/globalfoundries?persona=hr",
        },
      ],
      pulse: [{ title: "t", platform: "showcase", capturedAt: 1 }],
      meta: {
        lastIngest: null,
        showcaseSeedVersion: "v1",
        seedIngestRunId: "showcase-seed-v1",
      },
    });
    const app = createApp();
    const response = await app.request("/api/research/showcase", { headers: auth.headers });
    expect(response.status).toBe(200);
    const body = await parseJsonBody(response);
    expect(body.success).toBe(true);
    expect(body.golden[0].companyKey).toBe("pro-technic-machinery");
    expect(body.golden[0].signalCount).toBe(2);
    expect(body.fromResumeDesk.length).toBe(1);
    expect(Array.isArray(body.pulse)).toBe(true);
    expect(showcaseMocks.getResearchShowcase).toHaveBeenCalled();
  });

  it("seeds showcase via POST", async () => {
    const auth = createAuthHeaders({ workspaceSlug: "hr", role: "user" });
    showcaseMocks.seedResearchShowcase.mockResolvedValue({
      companiesUpserted: 6,
      aliasesCreated: 10,
      newsUpserted: 12,
      signalsUpserted: 12,
      seedIngestRunId: "showcase-seed-v1",
    });
    const app = createApp();
    const response = await app.request("/api/research/showcase/seed", {
      method: "POST",
      headers: auth.headers,
    });
    expect(response.status).toBe(200);
    const body = await parseJsonBody(response);
    expect(body.success).toBe(true);
    expect(body.signalsUpserted).toBe(12);
    expect(body.seedIngestRunId).toBe("showcase-seed-v1");
    expect(showcaseMocks.seedResearchShowcase).toHaveBeenCalled();
  });
});
