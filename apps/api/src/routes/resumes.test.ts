import { afterEach, describe, expect, it, vi } from "vitest";

import { createApp } from "../app";
import { MatchStorage } from "../services/match-storage";
import { SessionManager } from "../services/session-manager";

type ConvexCall = {
  pathName: string;
  args: Record<string, unknown>;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function parseConvexCall(input: RequestInfo | URL, init?: RequestInit): ConvexCall {
  const requestURL = typeof input === "string"
    ? input
    : input instanceof URL
      ? input.toString()
      : input.url;

  if (!requestURL.includes("/api/query")) {
    throw new Error(`Unexpected request URL: ${requestURL}`);
  }

  const body = typeof init?.body === "string" ? JSON.parse(init.body) : null;
  if (!isRecord(body)) {
    throw new Error("Missing convex request body");
  }

  const pathName = typeof body.path === "string" ? body.path : "";
  const args = isRecord(body.args) ? body.args : {};
  if (!pathName) {
    throw new Error("Missing convex path");
  }

  return { pathName, args };
}

function convexSuccess(value: unknown): Response {
  return new Response(
    JSON.stringify({
      status: "success",
      value,
    }),
    {
      status: 200,
      headers: {
        "Content-Type": "application/json",
      },
    }
  );
}

function buildConvexResumeRecord(
  resumeId: string,
  overrides: {
    name?: string;
    source?: string;
    primaryRuleScore?: number;
    ingestData?: Record<string, unknown>;
  } = {}
) {
  return {
    _id: resumeId,
    source: overrides.source ?? "seek",
    primaryRuleScore: overrides.primaryRuleScore ?? 0,
    content: {
      name: overrides.name ?? resumeId,
      location: "东莞",
      experience: "5 years",
      education: "Bachelor",
      jobIntention: "Sales Engineer",
      profileUrl: `https://example.com/${resumeId}`,
      workHistory: [{ raw: "2020-2025 CNC 销售工程师" }],
      extractedAt: "2026-03-24T00:00:00.000Z",
    },
    ingestData: overrides.ingestData,
  };
}

describe("resume routes", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("returns convex-backed live query results and expansion metadata", async () => {
    const calls: ConvexCall[] = [];

    vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
      const call = parseConvexCall(input, init);
      calls.push(call);

      if (call.pathName === "resumes:searchWithTagExpansionPage") {
        return convexSuccess({
          expansion: {
            original: "cnc 销售",
            expanded: ["cnc", "销售"],
            groups: [
              { original: "cnc", variants: ["cnc"] },
              { original: "销售", variants: ["销售", "业务"] },
            ],
            mode: "AND",
          },
          results: [
            {
              resume: {
                _id: "resume-live-1",
                source: "seek",
                primaryRuleScore: 44,
                content: {
                  name: "Alice",
                  location: "东莞",
                  experience: "5 years",
                  education: "Bachelor",
                  jobIntention: "Sales",
                  profileUrl: "https://example.com/alice",
                  workHistory: [{ raw: "2020-2025 CNC 销售工程师" }],
                },
                ingestData: {
                  companyHits: ["fanuc"],
                  brandHits: [],
                  roleSignals: [],
                },
              },
              provenance: [{ term: "销售", source: "searchText" }],
            },
          ],
          total: 1,
        });
      }

      throw new Error(`Unexpected convex path: ${call.pathName}`);
    });

    const app = createApp();
    const response = await app.request("/api/resumes?source=convex&q=CNC%20%E9%94%80%E5%94%AE&limit=5");

    expect(response.status).toBe(200);
    const payload = await response.json();
    expect(payload.success).toBe(true);
    expect(payload.summary.source).toBe("convex");
    expect(payload.summary.keywordGroups).toEqual(
      expect.arrayContaining([expect.objectContaining({ original: "cnc" })])
    );
    expect(payload.data[0]).toEqual(
      expect.objectContaining({
        resumeId: "resume-live-1",
        name: "Alice",
        location: "东莞",
      })
    );
    expect(calls[0]).toEqual(expect.objectContaining({
      pathName: "resumes:searchWithTagExpansionPage",
      args: expect.objectContaining({ limit: 5 }),
    }));
  });

  it("returns read-only convex query scores with debug metadata", async () => {
    const createSessionSpy = vi.spyOn(SessionManager.prototype, "createSession");
    const saveMatchesSpy = vi.spyOn(MatchStorage.prototype, "saveMatches");
    const createRunSpy = vi.spyOn(MatchStorage.prototype, "createMatchRun");

    vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
      const call = parseConvexCall(input, init);
      if (call.pathName === "resumes:getByIdsForExport") {
        return convexSuccess([
          {
            resumeId: "resume-convex-1",
            resume: {
              name: "Zhang Sales",
              location: "东莞",
              experience: "8 years",
              education: "Bachelor",
              jobIntention: "Sales Engineer",
              profileUrl: "https://example.com/zhang",
              workHistory: [{ raw: "2018-2026 CNC 销售工程师" }],
              ingestData: {
                companyHits: ["fanuc"],
                brandHits: [
                  {
                    brand: "fanuc",
                    role: "both",
                    source: "workHistory",
                    context: "employer",
                  },
                ],
                roleSignals: [
                  {
                    type: "sales",
                    matchedSignals: ["销售工程师", "销售"],
                    signalCount: 2,
                    occurrences: 2,
                    years: 8,
                    industryVerifiedYears: 8,
                    verifyIn: "workHistory",
                  },
                ],
              },
            },
          },
        ]);
      }

      throw new Error(`Unexpected convex path: ${call.pathName}`);
    });

    const app = createApp();
    const response = await app.request("/api/resumes/match", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        source: "convex",
        persist: false,
        mode: "rules_only",
        keywords: ["CNC", "销售"],
        location: "东莞",
        resumeIds: ["resume-convex-1"],
      }),
    });

    expect(response.status).toBe(200);
    const payload = await response.json();
    expect(payload.query).toEqual(
      expect.objectContaining({
        source: "convex",
        persisted: false,
      })
    );
    expect(payload.query.inferredRequiredRoles).toEqual(
      expect.arrayContaining([expect.objectContaining({ type: "sales", verifyIn: "workHistory" })])
    );
    expect(payload.results[0]).toEqual(
      expect.objectContaining({
        resumeId: "resume-convex-1",
        debug: expect.objectContaining({
          companyHits: ["fanuc"],
          roleSignals: expect.arrayContaining([expect.objectContaining({ type: "sales" })]),
          brandHits: expect.arrayContaining([expect.objectContaining({ brand: "fanuc" })]),
        }),
      })
    );
    expect(createSessionSpy).not.toHaveBeenCalled();
    expect(saveMatchesSpy).not.toHaveBeenCalled();
    expect(createRunSpy).not.toHaveBeenCalled();
  });

  it("fetches a large enough convex list window before applying offset pagination", async () => {
    const calls: ConvexCall[] = [];

    vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
      const call = parseConvexCall(input, init);
      calls.push(call);

      if (call.pathName === "resumes:listWithIngestDataPage") {
        return convexSuccess({
          results: [
            buildConvexResumeRecord("resume-live-3", {
              name: "Carla",
              ingestData: {
                industryTags: ["industrial-machinery"],
                companyHits: ["fanuc"],
                roleSignals: [
                  {
                    type: "sales",
                    matchedSignals: ["销售工程师"],
                    years: 4,
                    industryVerifiedYears: 4,
                    signalCount: 1,
                    occurrences: 1,
                    verifyIn: "workHistory",
                  },
                ],
              },
            }),
            buildConvexResumeRecord("resume-live-4", { name: "Dylan" }),
          ],
          total: 4,
        });
      }

      throw new Error(`Unexpected convex path: ${call.pathName}`);
    });

    const app = createApp();
    const response = await app.request("/api/resumes?source=convex&limit=2&offset=2");

    expect(response.status).toBe(200);
    const payload = await response.json();
    expect(payload.success).toBe(true);
    expect(payload.summary).toEqual(expect.objectContaining({
      total: 4,
      returned: 2,
      source: "convex",
    }));
    expect(payload.data.map((item: { name: string }) => item.name)).toEqual(["Carla", "Dylan"]);
    expect(payload.data[0]?.ingestData).toEqual(expect.objectContaining({
      industryTags: ["industrial-machinery"],
      companyHits: ["fanuc"],
      roleSignals: expect.arrayContaining([expect.objectContaining({ type: "sales" })]),
    }));
    expect(calls[0]).toEqual(expect.objectContaining({
      pathName: "resumes:listWithIngestDataPage",
      args: expect.objectContaining({ limit: 2, offset: 2 }),
    }));
  });

  it("fetches a large enough convex search window before applying offset pagination", async () => {
    const calls: ConvexCall[] = [];

    vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
      const call = parseConvexCall(input, init);
      calls.push(call);

      if (call.pathName === "resumes:searchWithTagExpansionPage") {
        return convexSuccess({
          expansion: {
            original: "cnc sales",
            expanded: ["cnc", "sales"],
            groups: [
              { original: "cnc", variants: ["cnc"] },
              { original: "sales", variants: ["sales"] },
            ],
            mode: "AND",
          },
          results: [
            { resume: buildConvexResumeRecord("resume-live-3", { name: "Carla" }), provenance: [{ term: "sales", source: "searchText" }] },
            { resume: buildConvexResumeRecord("resume-live-4", { name: "Dylan" }), provenance: [{ term: "cnc", source: "searchText" }] },
          ],
          total: 4,
        });
      }

      throw new Error(`Unexpected convex path: ${call.pathName}`);
    });

    const app = createApp();
    const response = await app.request("/api/resumes?source=convex&q=cnc%20sales&limit=2&offset=2");

    expect(response.status).toBe(200);
    const payload = await response.json();
    expect(payload.success).toBe(true);
    expect(payload.summary).toEqual(expect.objectContaining({
      total: 4,
      returned: 2,
      source: "convex",
    }));
    expect(payload.data.map((item: { name: string }) => item.name)).toEqual(["Carla", "Dylan"]);
    expect(calls[0]).toEqual(expect.objectContaining({
      pathName: "resumes:searchWithTagExpansionPage",
      args: expect.objectContaining({ limit: 2, offset: 2 }),
    }));
  });

  it("falls back to overfetch when local filters must run before paging", async () => {
    const calls: ConvexCall[] = [];

    vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
      const call = parseConvexCall(input, init);
      calls.push(call);

      if (call.pathName === "resumes:listWithIngestData") {
        return convexSuccess([
          buildConvexResumeRecord("resume-live-1", { name: "Alice" }),
          buildConvexResumeRecord("resume-live-2", { name: "Bob" }),
          buildConvexResumeRecord("resume-live-3", { name: "Carla" }),
          buildConvexResumeRecord("resume-live-4", { name: "Dylan" }),
        ]);
      }

      throw new Error(`Unexpected convex path: ${call.pathName}`);
    });

    const app = createApp();
    const response = await app.request("/api/resumes?source=convex&limit=2&offset=2&locations=%E4%B8%9C%E8%8E%9E");

    expect(response.status).toBe(200);
    const payload = await response.json();
    expect(payload.success).toBe(true);
    expect(payload.data.map((item: { name: string }) => item.name)).toEqual(["Carla", "Dylan"]);
    expect(calls[0]).toEqual(expect.objectContaining({
      pathName: "resumes:listWithIngestData",
      args: expect.objectContaining({ limit: 4 }),
    }));
  });

  it("rejects convex or read-only match-stream requests", async () => {
    const app = createApp();

    const convexResponse = await app.request("/api/resumes/match-stream", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        source: "convex",
        keywords: ["CNC"],
      }),
    });
    expect(convexResponse.status).toBe(400);

    const readOnlyResponse = await app.request("/api/resumes/match-stream", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        persist: false,
        keywords: ["CNC"],
      }),
    });
    expect(readOnlyResponse.status).toBe(400);
  });
});
