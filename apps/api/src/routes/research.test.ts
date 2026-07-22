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

const pulseMocks = vi.hoisted(() => ({
  getPulseKeywordsState: vi.fn(),
  putPulseKeywords: vi.fn(),
  getResearchPulse: vi.fn(),
}));

const platformMocks = vi.hoisted(() => ({
  getHotlistPlatformsState: vi.fn(),
  putHotlistPlatforms: vi.fn(),
}));

vi.mock("../services/research-showcase-service.js", () => ({
  getResearchShowcase: showcaseMocks.getResearchShowcase,
  seedResearchShowcase: showcaseMocks.seedResearchShowcase,
}));

vi.mock("../services/research-pulse-service.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../services/research-pulse-service.js")>();
  return {
    ...actual,
    getPulseKeywordsState: pulseMocks.getPulseKeywordsState,
    putPulseKeywords: pulseMocks.putPulseKeywords,
    getResearchPulse: pulseMocks.getResearchPulse,
  };
});

vi.mock("../services/research-hotlist-platforms-service.js", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("../services/research-hotlist-platforms-service.js")>();
  return {
    ...actual,
    getHotlistPlatformsState: platformMocks.getHotlistPlatformsState,
    putHotlistPlatforms: platformMocks.putHotlistPlatforms,
  };
});

import { createApp } from "../app";
import { resetResumeScreeningDb } from "../services/database";
import { PulseKeywordsValidationError } from "../services/research-pulse-service";
import { HotlistPlatformsValidationError } from "../services/research-hotlist-platforms-service";
import { parseJsonBody } from "../test-utils";
import { createAuthHeaders } from "./test-auth-helpers";

type ConvexCall = {
  type: "query" | "mutation";
  pathName: string;
  args: Record<string, unknown>;
};

type ResearchSignalItem = {
  kind: string;
  ingestRunId?: string;
  evidence: {
    platform: string;
    url?: string;
  };
};

type ResearchSignalsResponse = {
  success: boolean;
  persona: string;
  items: ResearchSignalItem[];
  meta: {
    liveCount: number;
    showcaseCount: number;
    liveFirst: boolean;
  };
};

type PurgeDemoResponse = {
  success: boolean;
  deleted: number;
};

type ResearchIngestRunResponse = {
  run: {
    runId: string;
    newsInserted?: number;
  } | null;
};

type ResearchParityResponse = {
  parity: {
    parityRunId: string;
    greenStreak: number;
  } | null;
};

type ResearchShowcaseCompany = {
  companyKey: string;
  signalCount: number;
};

type ResearchShowcaseResponse = {
  success: boolean;
  golden: ResearchShowcaseCompany[];
  fromResumeDesk: ResearchShowcaseCompany[];
  pulse: Array<Record<string, unknown>>;
};

type ResearchShowcaseSeedResponse = {
  success: boolean;
  signalsUpserted: number;
  signalsCreated: number;
  seedIngestRunId: string;
};

type ResearchIndustryItem = {
  companyKey: string;
  nameCn: string;
  nameEn?: string;
  displayName: string;
};

type ResearchIndustryResponse = {
  success: boolean;
  items: ResearchIndustryItem[];
};

type ResearchIndustryResolveResponse = {
  hit: {
    companyKey: string;
  } | null;
};

type ResearchPulseKeywordsResponse = {
  success: boolean;
  seed: {
    groups: Array<Record<string, unknown>>;
    defaultKeywords: string[];
  };
  workspace: {
    custom: string[];
  };
  effective: string[];
};

type ResearchPulseItem = {
  matchedKeywords: string[];
  resolvedCompanies?: Array<{
    companyKey: string;
    nameCn: string;
    nameEn?: string;
  }>;
};

type ResearchPulseResponse = {
  items: ResearchPulseItem[];
  meta: {
    filtered: boolean;
    keywordHits: Array<{
      keyword: string;
      hitCount: number;
      sampleTitles: string[];
    }>;
  };
};

type ResearchPlatformsResponse = {
  success: boolean;
  seed: {
    groups: Array<Record<string, unknown>>;
  };
  workspace: {
    enabled?: string[];
    excluded?: string[];
  };
  effective: string[];
};

type ResearchIngestTriggerResponse = {
  mode: string;
  platforms: string[];
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

const sampleKeywordsState = {
  seed: {
    version: "v1",
    groups: [{ id: "cnc-core", label: "数控机床", keywords: ["数控", "发那科"] }],
    defaultKeywords: ["数控", "发那科"],
  },
  workspace: { version: 1 as const, enabled: [] as string[], excluded: [] as string[], custom: [] as string[] },
  effective: ["数控", "发那科"],
};

const samplePlatformsState = {
  seed: {
    version: "v1",
    groups: [
      {
        id: "general-cn",
        label: "综合热榜",
        platforms: [
          { id: "weibo", name: "微博" },
          { id: "cls-hot", name: "财联社热门" },
        ],
      },
    ],
    defaults: ["weibo", "cls-hot"],
    catalogIds: ["weibo", "cls-hot"],
  },
  workspace: { version: 1 as const, enabled: [] as string[], excluded: [] as string[] },
  effective: ["weibo", "cls-hot"],
};

describe("research routes", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    showcaseMocks.getResearchShowcase.mockReset();
    showcaseMocks.seedResearchShowcase.mockReset();
    pulseMocks.getPulseKeywordsState.mockReset();
    pulseMocks.putPulseKeywords.mockReset();
    pulseMocks.getResearchPulse.mockReset();
    platformMocks.getHotlistPlatformsState.mockReset();
    platformMocks.putHotlistPlatforms.mockReset();
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
              ingestRunId: "research-live-1",
            },
            {
              _id: "s2",
              companyKey: "pro-technic-machinery",
              kind: "hiring_signal",
              title: "hire",
              evidence: { title: "hire", platform: "weibo", seenAt: 2 },
              capturedAt: 2,
              ingestRunId: "research-live-1",
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
    const body = await parseJsonBody<ResearchSignalsResponse>(response);
    expect(body.success).toBe(true);
    expect(body.persona).toBe("hr");
    expect(body.items[0].kind).toBe("hiring_signal");
    expect(body.items[1].kind).toBe("sales_trigger");
    expect(body.meta).toEqual({ liveCount: 2, showcaseCount: 0, liveFirst: true });
    expect(calls.some((c) => c.pathName === "research_signals:listByCompany")).toBe(true);
  });

  it("lists company signals live-first with meta when mixed showcase and live", async () => {
    const auth = createAuthHeaders({ workspaceSlug: "hr", role: "user" });
    vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
      const url =
        typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
      if (url.includes("/api/query") || url.includes("/api/mutation")) {
        const call = parseConvexCall(input, init);
        if (call.pathName === "research_signals:listByCompany") {
          return convexSuccess([
            {
              _id: "seed-sales",
              companyKey: "fanuc",
              kind: "sales_trigger",
              title: "seed sales",
              evidence: { title: "seed sales", platform: "showcase", seenAt: 1 },
              capturedAt: 9,
              ingestRunId: "showcase-seed-v1",
            },
            {
              _id: "live-hire",
              companyKey: "fanuc",
              kind: "hiring_signal",
              title: "live hire",
              evidence: {
                title: "live hire",
                platform: "weibo",
                url: "https://weibo.com/real/1",
                seenAt: 2,
              },
              capturedAt: 2,
              ingestRunId: "research-xyz",
            },
          ]);
        }
      }
      return convexSuccess(null);
    });

    const app = createApp();
    const response = await app.request("/api/research/companies/fanuc/signals?persona=hr", {
      headers: auth.headers,
    });
    expect(response.status).toBe(200);
    const body = await parseJsonBody<ResearchSignalsResponse>(response);
    expect(body.meta.liveCount).toBe(1);
    expect(body.meta.showcaseCount).toBe(1);
    expect(body.meta.liveFirst).toBe(true);
    expect(body.items[0].evidence.platform).not.toBe("showcase");
    expect(body.items[0].kind).toBe("hiring_signal");
    expect(body.items[1].evidence.platform).toBe("showcase");
  });

  it("POST /api/research/signals/purge-demo calls deleteByIngestRunPrefix with demo-", async () => {
    const auth = createAuthHeaders({ workspaceSlug: "hr", role: "user" });
    const calls: ConvexCall[] = [];
    vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
      const url =
        typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
      if (url.includes("/api/query") || url.includes("/api/mutation")) {
        const call = parseConvexCall(input, init);
        calls.push(call);
        if (call.pathName === "research_signals:deleteByIngestRunPrefix") {
          expect(call.args.ingestRunIdPrefix).toBe("demo-");
          return convexSuccess({ deleted: 3 });
        }
      }
      return convexSuccess(null);
    });

    const app = createApp();
    const response = await app.request("/api/research/signals/purge-demo", {
      method: "POST",
      headers: auth.headers,
    });
    expect(response.status).toBe(200);
    const body = await parseJsonBody<PurgeDemoResponse>(response);
    expect(body.success).toBe(true);
    expect(body.deleted).toBe(3);
    expect(calls.some((c) => c.pathName === "research_signals:deleteByIngestRunPrefix")).toBe(
      true,
    );
  });

  it("excludes demo-seed from live and omits synthetic from product items", async () => {
    const auth = createAuthHeaders({ workspaceSlug: "hr", role: "user" });
    vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
      const url =
        typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
      if (url.includes("/api/query") || url.includes("/api/mutation")) {
        const call = parseConvexCall(input, init);
        if (call.pathName === "research_signals:listByCompany") {
          return convexSuccess([
            {
              _id: "demo-hire",
              companyKey: "pro-technic-machinery",
              kind: "hiring_signal",
              title: "demo hire",
              evidence: {
                title: "demo hire",
                platform: "rss:demo",
                url: "https://example.com/news/2",
                seenAt: 1,
              },
              capturedAt: 5,
              ingestRunId: "demo-seed",
            },
            {
              _id: "seed-hire",
              companyKey: "pro-technic-machinery",
              kind: "hiring_signal",
              title: "seed hire",
              evidence: { title: "seed hire", platform: "showcase", seenAt: 2 },
              capturedAt: 4,
              ingestRunId: "showcase-seed-v1",
            },
            {
              _id: "live-hire",
              companyKey: "pro-technic-machinery",
              kind: "hiring_signal",
              title: "live hire",
              evidence: {
                title: "live hire",
                platform: "weibo",
                url: "https://weibo.com/real/1",
                seenAt: 3,
              },
              capturedAt: 3,
              ingestRunId: "research-xyz",
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
    const body = await parseJsonBody<ResearchSignalsResponse>(response);
    expect(body.meta.liveCount).toBe(1);
    expect(body.meta.showcaseCount).toBe(1);
    expect(body.items.length).toBe(2);
    expect(body.items[0].evidence.url).toBe("https://weibo.com/real/1");
    expect(body.items.some((i: { ingestRunId?: string }) => i.ingestRunId === "demo-seed")).toBe(
      false,
    );
    expect(
      body.items.some((i: { evidence?: { url?: string } }) =>
        String(i.evidence?.url ?? "").includes("example.com"),
      ),
    ).toBe(false);
  });

  it("proxies ingest trigger to worker research endpoint with effective platforms", async () => {
    const auth = createAuthHeaders({ workspaceSlug: "hr", role: "user" });
    platformMocks.getHotlistPlatformsState.mockResolvedValue({
      ...samplePlatformsState,
      effective: ["weibo", "cls-hot"],
    });
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
      const url =
        typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
      if (url.includes("/worker/research/ingest")) {
        const body = init?.body ? JSON.parse(String(init.body)) : {};
        expect(Array.isArray(body.platforms)).toBe(true);
        expect(body.platforms).toEqual(["weibo", "cls-hot"]);
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
    const body = await parseJsonBody<ResearchIngestTriggerResponse>(response);
    expect(body.mode).toBe("research-ingest");
    expect(body.platforms).toEqual(["weibo", "cls-hot"]);
    expect(platformMocks.getHotlistPlatformsState).toHaveBeenCalledWith("hr");
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
    const body = await parseJsonBody<ResearchIngestRunResponse>(response);
    expect(body.run).toBeTruthy();
    if (!body.run) {
      throw new Error("Expected latest ingest run");
    }
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
    const body = await parseJsonBody<ResearchParityResponse>(response);
    expect(body.parity).toBeTruthy();
    if (!body.parity) {
      throw new Error("Expected parity payload");
    }
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
    const body = await parseJsonBody<ResearchShowcaseResponse>(response);
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
      newsCreated: 12,
      signalsUpserted: 12,
      signalsCreated: 12,
      seedIngestRunId: "showcase-seed-v1",
    });
    const app = createApp();
    const response = await app.request("/api/research/showcase/seed", {
      method: "POST",
      headers: auth.headers,
    });
    expect(response.status).toBe(200);
    const body = await parseJsonBody<ResearchShowcaseSeedResponse>(response);
    expect(body.success).toBe(true);
    expect(body.signalsUpserted).toBe(12);
    expect(body.signalsCreated).toBe(12);
    expect(body.seedIngestRunId).toBe("showcase-seed-v1");
    expect(showcaseMocks.seedResearchShowcase).toHaveBeenCalled();
  });

  it("lists CNC industry browse with nameCn-first and fanuc / pro-technic keys", async () => {
    const auth = createAuthHeaders({ workspaceSlug: "hr", role: "user" });
    const app = createApp();
    const response = await app.request("/api/research/industry?limit=80", {
      headers: auth.headers,
    });
    expect(response.status).toBe(200);
    const body = await parseJsonBody<ResearchIndustryResponse>(response);
    expect(body.success).toBe(true);
    expect(Array.isArray(body.items)).toBe(true);
    expect(body.items.length).toBeGreaterThan(5);
    const fanuc = body.items.find((i: { companyKey: string }) => i.companyKey === "fanuc");
    const pro = body.items.find(
      (i: { companyKey: string }) => i.companyKey === "pro-technic-machinery",
    );
    expect(fanuc).toBeTruthy();
    if (!fanuc) {
      throw new Error("Expected fanuc industry row");
    }
    expect(fanuc.nameCn).toBe("发那科");
    expect(String(fanuc.displayName).startsWith("发那科")).toBe(true);
    expect(pro).toBeTruthy();
    if (!pro) {
      throw new Error("Expected pro-technic-machinery industry row");
    }
    expect(pro.nameCn).toBe("宝力机械");
  });

  it("filters industry browse by q for fanuc / 发那科", async () => {
    const auth = createAuthHeaders({ workspaceSlug: "hr", role: "user" });
    const app = createApp();
    const response = await app.request(
      `/api/research/industry?limit=40&q=${encodeURIComponent("发那")}`,
      { headers: auth.headers },
    );
    expect(response.status).toBe(200);
    const body = await parseJsonBody<ResearchIndustryResponse>(response);
    expect(body.items.some((i: { companyKey: string }) => i.companyKey === "fanuc")).toBe(true);
    for (const item of body.items) {
      const hay = `${item.companyKey} ${item.nameCn} ${item.nameEn ?? ""}`.toLowerCase();
      expect(hay.includes("fanuc") || hay.includes("发那") || item.nameCn.includes("发那")).toBe(true);
    }
  });

  it("resolves 发那科 → fanuc and 宝力机械 → pro-technic-machinery", async () => {
    const auth = createAuthHeaders({ workspaceSlug: "hr", role: "user" });
    const app = createApp();
    const r1 = await app.request(
      `/api/research/industry/resolve?q=${encodeURIComponent("发那科")}`,
      { headers: auth.headers },
    );
    expect(r1.status).toBe(200);
    const b1 = await parseJsonBody<ResearchIndustryResolveResponse>(r1);
    expect(b1.hit?.companyKey).toBe("fanuc");

    const r2 = await app.request(
      `/api/research/industry/resolve?q=${encodeURIComponent("宝力机械")}`,
      { headers: auth.headers },
    );
    expect(r2.status).toBe(200);
    const b2 = await parseJsonBody<ResearchIndustryResolveResponse>(r2);
    expect(b2.hit?.companyKey).toBe("pro-technic-machinery");
  });

  it("GET /api/research/pulse/keywords returns seed + workspace + effective", async () => {
    const auth = createAuthHeaders({ workspaceSlug: "hr", role: "user" });
    pulseMocks.getPulseKeywordsState.mockResolvedValue(sampleKeywordsState);
    const app = createApp();
    const response = await app.request("/api/research/pulse/keywords", {
      headers: auth.headers,
    });
    expect(response.status).toBe(200);
    const body = await parseJsonBody<ResearchPulseKeywordsResponse>(response);
    expect(body.success).toBe(true);
    expect(body.effective).toEqual(["数控", "发那科"]);
    expect(body.seed.defaultKeywords).toContain("数控");
    expect(pulseMocks.getPulseKeywordsState).toHaveBeenCalledWith("hr");
  });

  it("PUT /api/research/pulse/keywords upserts and returns state", async () => {
    const auth = createAuthHeaders({ workspaceSlug: "hr", role: "user" });
    pulseMocks.putPulseKeywords.mockResolvedValue({
      ...sampleKeywordsState,
      workspace: { version: 1, enabled: [], excluded: [], custom: ["刀塔"] },
      effective: [...sampleKeywordsState.effective, "刀塔"],
    });
    const app = createApp();
    const response = await app.request("/api/research/pulse/keywords", {
      method: "PUT",
      headers: { ...auth.headers, "Content-Type": "application/json" },
      body: JSON.stringify({ custom: ["刀塔"] }),
    });
    expect(response.status).toBe(200);
    const body = await parseJsonBody<ResearchPulseKeywordsResponse>(response);
    expect(body.success).toBe(true);
    expect(body.workspace.custom).toEqual(["刀塔"]);
    expect(body.effective).toContain("刀塔");
    expect(pulseMocks.putPulseKeywords).toHaveBeenCalledWith("hr", { custom: ["刀塔"] });
  });

  it("PUT /api/research/pulse/keywords returns 400 on validation error", async () => {
    const auth = createAuthHeaders({ workspaceSlug: "hr", role: "user" });
    pulseMocks.putPulseKeywords.mockRejectedValue(
      new PulseKeywordsValidationError("custom exceeds max of 20 keywords"),
    );
    const app = createApp();
    const response = await app.request("/api/research/pulse/keywords", {
      method: "PUT",
      headers: { ...auth.headers, "Content-Type": "application/json" },
      body: JSON.stringify({ custom: Array.from({ length: 21 }, (_, i) => `k${i}`) }),
    });
    expect(response.status).toBe(400);
    const body = await parseJsonBody(response);
    expect(body.success).toBe(false);
    expect(String(body.error)).toMatch(/20/);
  });

  it("GET /api/research/pulse returns filtered feed; all=1 unfiltered", async () => {
    const auth = createAuthHeaders({ workspaceSlug: "hr", role: "user" });
    pulseMocks.getResearchPulse
      .mockResolvedValueOnce({
        items: [
          {
            title: "发那科扩产",
            platform: "weibo",
            capturedAt: 1,
            matchedKeywords: ["发那科"],
            resolvedCompanies: [{ companyKey: "fanuc", nameCn: "发那科", nameEn: "FANUC" }],
          },
        ],
        meta: {
          filtered: true,
          effectiveKeywords: ["发那科"],
          rawCount: 10,
          matchedCount: 1,
          keywordHits: [{ keyword: "发那科", hitCount: 1, sampleTitles: ["发那科扩产"] }],
        },
      })
      .mockResolvedValueOnce({
        items: [
          {
            title: "发那科扩产",
            platform: "weibo",
            capturedAt: 1,
            matchedKeywords: ["发那科"],
            resolvedCompanies: [{ companyKey: "fanuc", nameCn: "发那科", nameEn: "FANUC" }],
          },
          { title: "娱乐", platform: "weibo", capturedAt: 0, matchedKeywords: [] },
        ],
        meta: {
          filtered: false,
          effectiveKeywords: ["发那科"],
          rawCount: 2,
          matchedCount: 1,
          keywordHits: [{ keyword: "发那科", hitCount: 1, sampleTitles: ["发那科扩产"] }],
        },
      });

    const app = createApp();
    const filtered = await app.request("/api/research/pulse?limit=12", {
      headers: auth.headers,
    });
    expect(filtered.status).toBe(200);
    const filteredBody = await parseJsonBody<ResearchPulseResponse>(filtered);
    expect(filteredBody.meta.filtered).toBe(true);
    expect(filteredBody.items[0].matchedKeywords).toContain("发那科");
    expect(filteredBody.items[0]?.resolvedCompanies?.[0]).toEqual({
      companyKey: "fanuc",
      nameCn: "发那科",
      nameEn: "FANUC",
    });
    expect(filteredBody.meta.keywordHits[0]).toEqual({
      keyword: "发那科",
      hitCount: 1,
      sampleTitles: ["发那科扩产"],
    });
    expect(pulseMocks.getResearchPulse).toHaveBeenCalledWith("hr", {
      limit: 12,
      all: false,
      hotlistOnly: false,
    });

    const all = await app.request("/api/research/pulse?all=1", {
      headers: auth.headers,
    });
    expect(all.status).toBe(200);
    const allBody = await parseJsonBody<ResearchPulseResponse>(all);
    expect(allBody.meta.filtered).toBe(false);
    expect(allBody.items.length).toBe(2);
    expect(allBody.meta.keywordHits[0].hitCount).toBe(1);
    expect(pulseMocks.getResearchPulse).toHaveBeenLastCalledWith("hr", {
      limit: undefined,
      all: true,
      hotlistOnly: false,
    });
  });

  it("rejects pulse keywords without session", async () => {
    const app = createApp();
    const response = await app.request("/api/research/pulse/keywords");
    expect(response.status).toBe(401);
  });

  it("GET /api/research/platforms returns seed + effective", async () => {
    const auth = createAuthHeaders({ workspaceSlug: "hr", role: "user" });
    platformMocks.getHotlistPlatformsState.mockResolvedValue(samplePlatformsState);
    const app = createApp();
    const response = await app.request("/api/research/platforms", {
      headers: auth.headers,
    });
    expect(response.status).toBe(200);
    const body = await parseJsonBody<ResearchPlatformsResponse>(response);
    expect(body.success).toBe(true);
    expect(body.effective).toContain("weibo");
    expect(body.seed.groups.length).toBeGreaterThan(0);
    expect(platformMocks.getHotlistPlatformsState).toHaveBeenCalledWith("hr");
  });

  it("PUT /api/research/platforms upserts overlay", async () => {
    const auth = createAuthHeaders({ workspaceSlug: "hr", role: "user" });
    platformMocks.putHotlistPlatforms.mockResolvedValue({
      ...samplePlatformsState,
      workspace: { version: 1, enabled: ["weibo", "cls-hot"], excluded: [] },
      effective: ["weibo", "cls-hot"],
    });
    const app = createApp();
    const response = await app.request("/api/research/platforms", {
      method: "PUT",
      headers: { ...auth.headers, "Content-Type": "application/json" },
      body: JSON.stringify({ enabled: ["weibo", "cls-hot"], excluded: [] }),
    });
    expect(response.status).toBe(200);
    const body = await parseJsonBody<ResearchPlatformsResponse>(response);
    expect(body.success).toBe(true);
    expect(body.effective).toEqual(["weibo", "cls-hot"]);
    expect(platformMocks.putHotlistPlatforms).toHaveBeenCalledWith("hr", {
      enabled: ["weibo", "cls-hot"],
      excluded: [],
    });
  });

  it("PUT /api/research/platforms returns 400 on unknown id", async () => {
    const auth = createAuthHeaders({ workspaceSlug: "hr", role: "user" });
    platformMocks.putHotlistPlatforms.mockRejectedValue(
      new HotlistPlatformsValidationError("enabled contains unknown platform id: nope"),
    );
    const app = createApp();
    const response = await app.request("/api/research/platforms", {
      method: "PUT",
      headers: { ...auth.headers, "Content-Type": "application/json" },
      body: JSON.stringify({ enabled: ["nope"] }),
    });
    expect(response.status).toBe(400);
    const body = await parseJsonBody(response);
    expect(body.success).toBe(false);
    expect(String(body.error)).toMatch(/unknown platform/i);
  });
});
