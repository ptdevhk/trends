import { afterEach, describe, expect, it, vi } from "vitest";

import { createApp } from "../app";
import { MatchStorage, type StoredMatch } from "../services/match-storage";
import { ResumeService } from "../services/resume-service";
import { SessionManager } from "../services/session-manager";

type ConvexCall = {
  pathName: string;
  args: Record<string, unknown>;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function parseConvexCall(
  input: RequestInfo | URL,
  init?: RequestInit,
  expectedEndpoint?: "/api/query" | "/api/mutation" | "/api/action",
): ConvexCall {
  const requestURL = typeof input === "string"
    ? input
    : input instanceof URL
      ? input.toString()
      : input.url;

  const endpoint = expectedEndpoint ?? (
    requestURL.includes("/api/action") ? "/api/action"
    : requestURL.includes("/api/mutation") ? "/api/mutation"
    : "/api/query"
  );

  if (!requestURL.includes(endpoint)) {
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
    location?: string;
    identityKey?: string;
    source?: string;
    primaryRuleScore?: number;
    ingestData?: Record<string, unknown>;
  } = {}
) {
  return {
    _id: resumeId,
    identityKey: overrides.identityKey,
    source: overrides.source ?? "seek",
    primaryRuleScore: overrides.primaryRuleScore ?? 0,
    content: {
      name: overrides.name ?? resumeId,
      location: overrides.location ?? "东莞",
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

function buildConvexExportResumeRecord(
  resumeId: string,
  overrides: {
    name?: string;
    location?: string;
    source?: string;
    ingestData?: Record<string, unknown>;
  } = {}
) {
  return {
    resumeId,
    resume: {
      name: overrides.name ?? resumeId,
      location: overrides.location ?? "东莞",
      experience: "5 years",
      education: "Bachelor",
      jobIntention: "Sales Engineer",
      profileUrl: `https://example.com/${resumeId}`,
      workHistory: [{ raw: "2020-2025 CNC 销售工程师" }],
      extractedAt: "2026-03-24T00:00:00.000Z",
      source: overrides.source ?? "seek",
      ingestData: overrides.ingestData,
    },
  };
}

function buildStoredMatch(
  resumeId: string,
  overrides: {
    id?: number;
    jobDescriptionId?: string;
    score?: number;
    recommendation?: StoredMatch["recommendation"];
  } = {}
): StoredMatch {
  return {
    id: overrides.id ?? 1,
    resumeId,
    jobDescriptionId: overrides.jobDescriptionId ?? "jd-1",
    score: overrides.score ?? 80,
    recommendation: overrides.recommendation ?? "match",
    highlights: [],
    concerns: [],
    summary: "",
    scoreSource: "ai",
    matchedAt: "2026-03-24T00:00:00.000Z",
  };
}

describe("resume routes", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("returns sample-backed resume detail with full work history", async () => {
    vi.spyOn(ResumeService.prototype, "loadSample").mockReturnValue({
      items: [
        {
          name: "Alice",
          profileUrl: "https://example.com/alice",
          source: "ehire.51job.com",
          activityStatus: "Active today",
          age: "32岁",
          experience: "8年",
          education: "本科",
          location: "东莞",
          selfIntro: "熟悉CNC设备销售与客户跟进。",
          jobIntention: "销售经理",
          expectedSalary: "20K",
          workHistory: [
            {
              raw: "2021-03 ~ 至今 Example Co. Sales Manager",
              companyName: "Example Co.",
              jobTitle: "Sales Manager",
              description: "Managed CNC accounts.",
              startDate: "2021-03",
              endDate: "至今",
            },
          ],
          extractedAt: "2026-04-02T00:00:00.000Z",
          resumeId: "sample-resume-1",
          externalId: "sample-resume-1",
        },
      ],
      sample: {
        name: "sample-initial",
        filename: "sample-initial.json",
        updatedAt: "2026-04-02T00:00:00.000Z",
        size: 123,
      },
      metadata: undefined,
      indexes: new Map(),
    });

    const app = createApp();
    const response = await app.request("/api/resumes/sample-resume-1?source=sample");

    expect(response.status).toBe(200);
    const payload = await response.json();
    expect(payload).toEqual(
      expect.objectContaining({
        success: true,
        source: "sample",
        sample: expect.objectContaining({ name: "sample-initial" }),
        data: expect.objectContaining({
          resumeId: "sample-resume-1",
          name: "Alice",
          workHistory: [
            expect.objectContaining({
              companyName: "Example Co.",
              description: "Managed CNC accounts.",
            }),
          ],
        }),
      }),
    );
  });

  it("returns convex-backed resume detail with full work history", async () => {
    vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
      const call = parseConvexCall(input, init);
      if (call.pathName !== "resumes:getResumeDetail") {
        throw new Error(`Unexpected convex path: ${call.pathName}`);
      }
      expect(call.args).toEqual({ resumeId: "resume-live-1" });
      return convexSuccess({
        _id: "resume-live-1",
        source: "seek",
        content: {
          name: "Alice",
          profileUrl: "https://example.com/alice",
          activityStatus: "Active today",
          age: "32岁",
          experience: "8年",
          education: "本科",
          location: "东莞",
          selfIntro: "熟悉CNC设备销售与客户跟进。",
          jobIntention: "销售经理",
          expectedSalary: "20K",
          workHistory: [
            {
              raw: "2021-03 ~ 至今 Example Co. Sales Manager",
              companyName: "Example Co.",
              jobTitle: "Sales Manager",
              description: "Managed CNC accounts.",
              startDate: "2021-03",
              endDate: "至今",
            },
          ],
          extractedAt: "2026-04-02T00:00:00.000Z",
          resumeId: "resume-live-1",
          externalId: "resume-live-1",
        },
        ingestData: {
          companyHits: ["fanuc"],
        },
      });
    });

    const app = createApp();
    const response = await app.request("/api/resumes/resume-live-1?source=convex");

    expect(response.status).toBe(200);
    const payload = await response.json();
    expect(payload).toEqual(
      expect.objectContaining({
        success: true,
        source: "convex",
        data: expect.objectContaining({
          resumeId: "resume-live-1",
          name: "Alice",
          source: "seek",
          workHistory: [
            expect.objectContaining({
              companyName: "Example Co.",
              description: "Managed CNC accounts.",
            }),
          ],
          ingestData: expect.objectContaining({
            companyHits: ["fanuc"],
          }),
        }),
      }),
    );
  });

  it("returns convex-backed live query results and expansion metadata", async () => {
    const calls: ConvexCall[] = [];

    vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
      const call = parseConvexCall(input, init);
      calls.push(call);

      // AND-mode queries use two-phase scan: phase 1 via scanResumePageSlim
      if (call.pathName === "resumes_search:scanResumePageSlim") {
        const cursor = typeof call.args.cursor === "string" ? call.args.cursor : null;
        // Phase 1: slim projection — only searchText and basic fields
        return convexSuccess({
          docs: cursor
            ? []
            : [
                {
                  _id: "resume-live-1",
                  source: "seek",
                  primaryRuleScore: 44,
                  searchText: "CNC 数值控制 销售 engineer fanuc",
                  isArchived: false,
                },
              ],
          isDone: !cursor,
          cursor: cursor ? null : "next-page",
        });
      }

      // Phase 2: fetch full docs by IDs
      if (call.pathName === "resumes_search:getResumeDocsByIds") {
        return convexSuccess([
          {
            _id: "resume-live-1",
            source: "seek",
            primaryRuleScore: 44,
            searchText: "CNC 数值控制 销售 engineer fanuc",
            isArchived: false,
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
        ]);
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
      pathName: "resumes_search:scanResumePageSlim",
    }));
  });

  it("keeps the static skills-version route from being shadowed by resume detail lookup", async () => {
    const app = createApp();
    const response = await app.request("/api/resumes/skills-version");

    expect(response.status).toBe(200);
    const payload = await response.json();
    expect(payload).toEqual(
      expect.objectContaining({
        success: true,
        version: expect.any(Number),
      }),
    );
  });

  it("lists diagnostics rows with archived and source-key filters", async () => {
    const calls: ConvexCall[] = [];

    vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
      const call = parseConvexCall(input, init);
      calls.push(call);

      if (call.pathName === "resumes_diagnostics:listArchivedDiagnostics") {
        expect(call.args).toEqual(expect.objectContaining({
          sourceKeys: ["51job-manual", "seek"],
        }));
        return convexSuccess({
          page: [
            {
              resumeId: "resume-archived-1",
              externalId: "external-1",
              source: "51job-manual",
              sourceKey: "51job-manual",
              name: "张三",
              jobIntention: "销售工程师",
              location: "东莞",
              archivedAt: 1_700_000_000_000,
              isArchived: true,
            },
          ],
          continueCursor: "",
          isDone: true,
        });
      }

      throw new Error(`Unexpected convex path: ${call.pathName}`);
    });

    const app = createApp();
    const response = await app.request(
      "/api/resumes/diagnostics?archived=true&sourceKey=51job-manual&sourceKey=seek&limit=25"
    );

    expect(response.status).toBe(200);
    const payload = await response.json();
    expect(payload).toEqual(expect.objectContaining({
      success: true,
      summary: expect.objectContaining({
        archived: true,
        limit: 25,
      }),
      data: [
        expect.objectContaining({
          resumeId: "resume-archived-1",
          sourceKey: "51job-manual",
        }),
      ],
    }));
    expect(calls[0]).toEqual(expect.objectContaining({
      pathName: "resumes_diagnostics:listArchivedDiagnostics",
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

      // AND-mode queries use two-phase scan: phase 1 via scanResumePageSlim
      if (call.pathName === "resumes_search:scanResumePageSlim") {
        const cursor = typeof call.args.cursor === "string" ? call.args.cursor : null;
        return convexSuccess({
          docs: cursor
            ? []
            : [
                { _id: "resume-live-1", source: "seek", searchText: "cnc sales engineer", isArchived: false },
                { _id: "resume-live-2", source: "seek", searchText: "cnc sales manager", isArchived: false },
                { _id: "resume-live-3", source: "seek", searchText: "cnc sales director", isArchived: false },
                { _id: "resume-live-4", source: "seek", searchText: "cnc sales vp", isArchived: false },
              ],
          isDone: !cursor,
          cursor: cursor ? null : "next-page",
        });
      }

      // Phase 2: fetch full docs by IDs
      if (call.pathName === "resumes_search:getResumeDocsByIds") {
        return convexSuccess([
          { ...buildConvexResumeRecord("resume-live-1", { name: "Alice" }), searchText: "cnc sales engineer", isArchived: false },
          { ...buildConvexResumeRecord("resume-live-2", { name: "Bob" }), searchText: "cnc sales manager", isArchived: false },
          { ...buildConvexResumeRecord("resume-live-3", { name: "Carla" }), searchText: "cnc sales director", isArchived: false },
          { ...buildConvexResumeRecord("resume-live-4", { name: "Dylan" }), searchText: "cnc sales vp", isArchived: false },
        ]);
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
      pathName: "resumes_search:scanResumePageSlim",
    }));
  });

  it("keeps source pagination when a keyword search uses a non-score sort", async () => {
    const calls: ConvexCall[] = [];

    vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
      const call = parseConvexCall(input, init);
      calls.push(call);

      // AND-mode queries use two-phase scan: phase 1 via scanResumePageSlim
      if (call.pathName === "resumes_search:scanResumePageSlim") {
        const cursor = typeof call.args.cursor === "string" ? call.args.cursor : null;
        return convexSuccess({
          docs: cursor
            ? []
            : [
                { _id: "resume-live-3", source: "seek", searchText: "cnc sales director", isArchived: false },
                { _id: "resume-live-4", source: "seek", searchText: "cnc sales vp", isArchived: false },
              ],
          isDone: !cursor,
          cursor: cursor ? null : "next-page",
        });
      }

      // Phase 2: fetch full docs by IDs
      if (call.pathName === "resumes_search:getResumeDocsByIds") {
        return convexSuccess([
          { ...buildConvexResumeRecord("resume-live-3", { name: "Carla" }), searchText: "cnc sales director", isArchived: false },
          { ...buildConvexResumeRecord("resume-live-4", { name: "Dylan" }), searchText: "cnc sales vp", isArchived: false },
        ]);
      }

      throw new Error(`Unexpected convex path: ${call.pathName}`);
    });

    const app = createApp();
    const response = await app.request("/api/resumes?source=convex&q=cnc%20sales&limit=2&offset=2&sortBy=name&sortOrder=desc");

    expect(response.status).toBe(200);
    const payload = await response.json();
    expect(payload.success).toBe(true);
    expect(calls[0]).toEqual(expect.objectContaining({
      pathName: "resumes_search:scanResumePageSlim",
    }));
  });

  it("keeps filtered keyword searches on the paged convex route for sparse seek lanes", async () => {
    const calls: ConvexCall[] = [];
    const keeKimLoong = buildConvexResumeRecord("resume-live-5", {
      name: "Kee Kim Loong",
      source: "hk.employer.seek.com",
      ingestData: {
        industryTags: ["机械", "销售"],
        companyHits: [],
        brandHits: [],
        roleSignals: [
          { type: "sales", matchedSignals: ["sales", "sales engineer"] },
          { type: "engineer", matchedSignals: ["engineer"] },
        ],
      },
    });
    keeKimLoong.content = {
      ...keeKimLoong.content,
      location: "Kuala Lumpur, MY",
    };
    const johnsonLeeWeiTao = buildConvexResumeRecord("resume-live-6", {
      name: "Johnson Lee Wei Tao",
      source: "hk.employer.seek.com",
      ingestData: {
        industryTags: ["销售"],
        companyHits: [],
        brandHits: [],
        roleSignals: [
          { type: "sales", matchedSignals: ["sales", "sales engineer", "account"] },
          { type: "engineer", matchedSignals: ["engineer", "design"] },
        ],
      },
    });
    johnsonLeeWeiTao.content = {
      ...johnsonLeeWeiTao.content,
      location: "Kuala Lumpur, MY",
    };

    vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
      const call = parseConvexCall(input, init);
      calls.push(call);

      // AND-mode queries use two-phase scan: phase 1 via scanResumePageSlim
      if (call.pathName === "resumes_search:scanResumePageSlim") {
        const cursor = typeof call.args.cursor === "string" ? call.args.cursor : null;
        return convexSuccess({
          docs: cursor
            ? []
            : [
                { _id: "resume-live-5", source: "hk.employer.seek.com", searchText: "machine tools precision machinery sales engineer", isArchived: false },
                { _id: "resume-live-6", source: "hk.employer.seek.com", searchText: "precision machinery sales engineer account design", isArchived: false },
              ],
          isDone: !cursor,
          cursor: cursor ? null : "next-page",
        });
      }

      // Phase 2: fetch full docs by IDs
      if (call.pathName === "resumes_search:getResumeDocsByIds") {
        return convexSuccess([
          { ...keeKimLoong, searchText: "machine tools precision machinery sales engineer", isArchived: false },
          { ...johnsonLeeWeiTao, searchText: "precision machinery sales engineer account design", isArchived: false },
        ]);
      }

      throw new Error(`Unexpected convex path: ${call.pathName}`);
    });

    const app = createApp();
    const response = await app.request(
      "/api/resumes?source=convex&q=%22machine%20tools%22&locations=Kuala%20Lumpur%20MY&jobDescriptionId=seek-malaysia-sales&limit=5"
    );

    expect(response.status).toBe(200);
    const payload = await response.json();
    expect(payload.success).toBe(true);
    expect(payload.summary).toEqual(expect.objectContaining({
      total: 2,
      returned: 2,
      source: "convex",
      query: "\"machine tools\"",
    }));
    expect(payload.data.map((item: { name: string }) => item.name)).toEqual([
      "Kee Kim Loong",
      "Johnson Lee Wei Tao",
    ]);
    expect(calls[0]).toEqual(expect.objectContaining({
      pathName: "resumes_search:scanResumePageSlim",
    }));
  });

  it("pushes required keywords into paged convex keyword searches", async () => {
    const calls: ConvexCall[] = [];

    vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
      const call = parseConvexCall(input, init);
      calls.push(call);

      // AND-mode queries use two-phase scan: phase 1 via scanResumePageSlim
      if (call.pathName === "resumes_search:scanResumePageSlim") {
        const cursor = typeof call.args.cursor === "string" ? call.args.cursor : null;
        return convexSuccess({
          docs: cursor
            ? []
            : [
                {
                  _id: "resume-live-3",
                  source: "seek",
                  searchText: "cnc sales machine tools",
                  isArchived: false,
                },
              ],
          isDone: !cursor,
          cursor: cursor ? null : "next-page",
        });
      }

      // Phase 2: fetch full docs by IDs
      if (call.pathName === "resumes_search:getResumeDocsByIds") {
        return convexSuccess([
          {
            ...buildConvexResumeRecord("resume-live-3", { name: "Carla" }),
            searchText: "cnc sales machine tools",
            isArchived: false,
          },
        ]);
      }

      throw new Error(`Unexpected convex path: ${call.pathName}`);
    });

    const app = createApp();
    const response = await app.request("/api/resumes?source=convex&q=cnc%20sales&limit=2&requiredKeywords=machine%20tools,CNC");

    expect(response.status).toBe(200);
    // AND-mode now uses scanResumePageSlim instead of the action
    expect(calls.some((c) => c.pathName === "resumes_search:scanResumePageSlim")).toBe(true);
    // Required keywords are applied as local filters in BFF AND-mode path
    const payload = await response.json();
    expect(payload.success).toBe(true);
  });

  it("keeps source pagination when resume filters are pushed into the convex page query", async () => {
    const calls: ConvexCall[] = [];

    vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
      const call = parseConvexCall(input, init);
      calls.push(call);

      if (call.pathName === "resumes:listWithIngestDataPage") {
        return convexSuccess({
          results: [
            buildConvexResumeRecord("resume-live-3", { name: "Carla" }),
            buildConvexResumeRecord("resume-live-4", { name: "Dylan" }),
          ],
          total: 2,
        });
      }

      throw new Error(`Unexpected convex path: ${call.pathName}`);
    });

    const app = createApp();
    const response = await app.request("/api/resumes?source=convex&limit=2&offset=2&locations=%E4%B8%9C%E8%8E%9E&requiredKeywords=CNC");

    expect(response.status).toBe(200);
    const payload = await response.json();
    expect(payload.success).toBe(true);
    expect(payload.data.map((item: { name: string }) => item.name)).toEqual(["Carla", "Dylan"]);
    expect(calls[0]).toEqual(expect.objectContaining({
      pathName: "resumes:listWithIngestDataPage",
      args: expect.objectContaining({ limit: 2, offset: 2, locations: ["东莞"], requiredKeywords: ["cnc"] }),
    }));
  });

  it("keeps source pagination when a non-score sort is pushed into the convex page query", async () => {
    const calls: ConvexCall[] = [];

    vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
      const call = parseConvexCall(input, init);
      calls.push(call);

      if (call.pathName === "resumes:listWithIngestDataPage") {
        return convexSuccess({
          results: [
            buildConvexResumeRecord("resume-live-3", { name: "Carla" }),
            buildConvexResumeRecord("resume-live-4", { name: "Dylan" }),
          ],
          total: 4,
        });
      }

      throw new Error(`Unexpected convex path: ${call.pathName}`);
    });

    const app = createApp();
    const response = await app.request("/api/resumes?source=convex&limit=2&offset=2&sortBy=experience");

    expect(response.status).toBe(200);
    const payload = await response.json();
    expect(payload.success).toBe(true);
    expect(calls[0]).toEqual(expect.objectContaining({
      pathName: "resumes:listWithIngestDataPage",
      args: expect.objectContaining({ limit: 2, offset: 2, sortBy: "experience", sortOrder: "asc" }),
    }));
  });

  it("pages score-sorted convex results through filtered match storage when local resume filters are present", async () => {
    const calls: ConvexCall[] = [];
    const getMatchesPageSpy = vi
      .spyOn(MatchStorage.prototype, "getMatchesPageForJob")
      .mockReturnValue({
        matches: [
          buildStoredMatch("resume-live-1", { id: 1, score: 96 }),
          buildStoredMatch("resume-live-2", { id: 2, score: 90 }),
          buildStoredMatch("resume-live-3", { id: 3, score: 81 }),
        ],
        total: 3,
      });
    const getMatchesByResumeIdsSpy = vi
      .spyOn(MatchStorage.prototype, "getMatchesByResumeIds")
      .mockReturnValue([]);

    vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
      const call = parseConvexCall(input, init);
      calls.push(call);

      if (call.pathName === "candidate_status:list") {
        return convexSuccess([]);
      }

      if (call.pathName === "resumes:getByIdsForExport") {
        return convexSuccess([
          buildConvexExportResumeRecord("resume-live-3", { name: "Carla" }),
          buildConvexExportResumeRecord("resume-live-2", {
            name: "Bob",
            location: "深圳",
          }),
          buildConvexExportResumeRecord("resume-live-1", { name: "Alice" }),
        ]);
      }

      throw new Error(`Unexpected convex path: ${call.pathName}`);
    });

    const app = createApp();
    const response = await app.request(
      "/api/resumes?source=convex&limit=1&offset=1&sortBy=score&jobDescriptionId=jd-1&locations=%E4%B8%9C%E8%8E%9E"
    );

    expect(response.status).toBe(200);
    const payload = await response.json();
    expect(payload.success).toBe(true);
    expect(payload.summary).toEqual(expect.objectContaining({
      total: 2,
      returned: 1,
      source: "convex",
    }));
    expect(payload.data.map((item: { name: string }) => item.name)).toEqual(["Carla"]);
    expect(getMatchesPageSpy).toHaveBeenCalledWith(expect.objectContaining({
      jobDescriptionId: "jd-1",
      limit: 250,
      offset: 0,
      sortOrder: "desc",
    }));
    expect(getMatchesByResumeIdsSpy).not.toHaveBeenCalled();
    expect(calls).toEqual([
      expect.objectContaining({
        pathName: "resumes:getByIdsForExport",
        args: expect.objectContaining({
          resumeIds: ["resume-live-1", "resume-live-2", "resume-live-3"],
        }),
      }),
      expect.objectContaining({
        pathName: "candidate_status:list",
        args: expect.objectContaining({
          workspaceSlug: "dev",
        }),
      }),
    ]);
    expect(calls.some((call) => call.pathName === "resumes:listWithIngestData")).toBe(false);
    expect(calls.some((call) => call.pathName === "resumes_search:searchWithTagExpansion")).toBe(false);
  });

  it("pages score-sorted keyword convex results through exact keyword scan pages when local resume filters are present", async () => {
    const calls: ConvexCall[] = [];
    const getMatchesPageSpy = vi.spyOn(MatchStorage.prototype, "getMatchesPageForJob");
    const getMatchesByResumeIdsSpy = vi
      .spyOn(MatchStorage.prototype, "getMatchesByResumeIds")
      .mockReturnValue([
        buildStoredMatch("resume-live-1", { id: 1, score: 96 }),
        buildStoredMatch("resume-live-3", { id: 3, score: 81 }),
      ]);

    vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
      const call = parseConvexCall(input, init);
      calls.push(call);

      if (call.pathName === "resumes_search:searchWithTagExpansionScanPage") {
        return convexSuccess({
          page: [
            { resume: buildConvexResumeRecord("resume-live-1", { name: "Alice" }), provenance: [{ term: "sales", source: "searchText" }] },
            { resume: buildConvexResumeRecord("resume-live-3", { name: "Carla" }), provenance: [{ term: "cnc", source: "searchText" }] },
          ],
          continueCursor: "",
          isDone: true,
        });
      }

      throw new Error(`Unexpected convex path: ${call.pathName}`);
    });

    const app = createApp();
    const response = await app.request(
      "/api/resumes?source=convex&limit=1&offset=1&sortBy=score&jobDescriptionId=jd-1&q=cnc%20sales&locations=%E4%B8%9C%E8%8E%9E"
    );

    expect(response.status).toBe(200);
    const payload = await response.json();
    expect(payload.success).toBe(true);
    expect(payload.summary).toEqual(expect.objectContaining({
      total: 2,
      returned: 1,
      source: "convex",
    }));
    expect(payload.data.map((item: { name: string }) => item.name)).toEqual(["Carla"]);
    expect(getMatchesPageSpy).not.toHaveBeenCalled();
    expect(getMatchesByResumeIdsSpy).toHaveBeenCalledWith(["resume-live-1", "resume-live-3"], "jd-1");
    expect(calls[0]).toEqual(expect.objectContaining({
      pathName: "resumes_search:searchWithTagExpansionScanPage",
      args: expect.objectContaining({
        paginationOpts: expect.objectContaining({ cursor: null, numItems: 250 }),
        locations: ["东莞"],
      }),
    }));
    expect(calls.some((call) => call.pathName === "resumes_search:searchWithTagExpansionPage")).toBe(false);
    expect(calls.some((call) => call.pathName === "resumes_search:searchWithTagExpansion")).toBe(false);
  });

  it("pages bounded score-sorted keyword convex results through exact keyword scan pages without source-side resume filters", async () => {
    const calls: ConvexCall[] = [];
    const getMatchesPageSpy = vi.spyOn(MatchStorage.prototype, "getMatchesPageForJob");
    const getMatchesByResumeIdsSpy = vi
      .spyOn(MatchStorage.prototype, "getMatchesByResumeIds")
      .mockReturnValue([
        buildStoredMatch("resume-live-1", { id: 1, score: 96 }),
        buildStoredMatch("resume-live-3", { id: 3, score: 81 }),
      ]);

    vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
      const call = parseConvexCall(input, init);
      calls.push(call);

      if (call.pathName === "resumes_search:searchWithTagExpansionScanPage") {
        return convexSuccess({
          page: [
            { resume: buildConvexResumeRecord("resume-live-1", { name: "Alice" }), provenance: [{ term: "sales", source: "searchText" }] },
            { resume: buildConvexResumeRecord("resume-live-3", { name: "Carla" }), provenance: [{ term: "cnc", source: "searchText" }] },
          ],
          continueCursor: "",
          isDone: true,
        });
      }

      throw new Error(`Unexpected convex path: ${call.pathName}`);
    });

    const app = createApp();
    const response = await app.request("/api/resumes?source=convex&limit=1&offset=1&sortBy=score&jobDescriptionId=jd-1&q=cnc%20sales");

    expect(response.status).toBe(200);
    const payload = await response.json();
    expect(payload.success).toBe(true);
    expect(payload.summary).toEqual(expect.objectContaining({
      total: 2,
      returned: 1,
      source: "convex",
    }));
    expect(payload.data.map((item: { name: string }) => item.name)).toEqual(["Carla"]);
    expect(getMatchesPageSpy).not.toHaveBeenCalled();
    expect(getMatchesByResumeIdsSpy).toHaveBeenCalledWith(["resume-live-1", "resume-live-3"], "jd-1");
    expect(calls[0]).toEqual(expect.objectContaining({
      pathName: "resumes_search:searchWithTagExpansionScanPage",
      args: expect.objectContaining({
        paginationOpts: expect.objectContaining({ cursor: null, numItems: 250 }),
      }),
    }));
    expect(calls.some((call) => call.pathName === "resumes_search:searchWithTagExpansionPage")).toBe(false);
    expect(calls.some((call) => call.pathName === "resumes_search:searchWithTagExpansion")).toBe(false);
  });

  it("scans oversized score-sorted keyword searches through exact cursor pages without fallback overfetch", async () => {
    const calls: ConvexCall[] = [];
    const getMatchesPageSpy = vi.spyOn(MatchStorage.prototype, "getMatchesPageForJob");
    const getMatchesByResumeIdsSpy = vi
      .spyOn(MatchStorage.prototype, "getMatchesByResumeIds")
      .mockReturnValue([
        buildStoredMatch("resume-live-3", { id: 3, score: 96 }),
        buildStoredMatch("resume-live-1", { id: 1, score: 81 }),
      ]);

    vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
      const call = parseConvexCall(input, init);
      calls.push(call);

      if (call.pathName === "resumes_search:searchWithTagExpansionScanPage") {
        return convexSuccess({
          page: call.args.paginationOpts && isRecord(call.args.paginationOpts) && call.args.paginationOpts.cursor === "scan-2"
            ? [
                { resume: buildConvexResumeRecord("resume-live-3", { name: "Carla" }), provenance: [{ term: "cnc", source: "searchText" }] },
              ]
            : [
                { resume: buildConvexResumeRecord("resume-live-1", { name: "Alice" }), provenance: [{ term: "sales", source: "searchText" }] },
              ],
          continueCursor: call.args.paginationOpts && isRecord(call.args.paginationOpts) && call.args.paginationOpts.cursor === "scan-2"
            ? ""
            : "scan-2",
          isDone: Boolean(call.args.paginationOpts && isRecord(call.args.paginationOpts) && call.args.paginationOpts.cursor === "scan-2"),
        });
      }

      throw new Error(`Unexpected convex path: ${call.pathName}`);
    });

    const app = createApp();
    const response = await app.request("/api/resumes?source=convex&limit=2&sortBy=score&jobDescriptionId=jd-1&q=cnc%20sales");

    expect(response.status).toBe(200);
    const payload = await response.json();
    expect(payload.success).toBe(true);
    expect(payload.data.map((item: { name: string }) => item.name)).toEqual(["Carla", "Alice"]);
    expect(getMatchesPageSpy).not.toHaveBeenCalled();
    expect(getMatchesByResumeIdsSpy).toHaveBeenCalledWith(["resume-live-1", "resume-live-3"], "jd-1");
    expect(calls[0]).toEqual(expect.objectContaining({
      pathName: "resumes_search:searchWithTagExpansionScanPage",
      args: expect.objectContaining({
        paginationOpts: expect.objectContaining({ cursor: null, numItems: 250 }),
      }),
    }));
    expect(calls[1]).toEqual(expect.objectContaining({
      pathName: "resumes_search:searchWithTagExpansionScanPage",
      args: expect.objectContaining({
        paginationOpts: expect.objectContaining({ cursor: "scan-2", numItems: 250 }),
      }),
    }));
    expect(calls.some((call) => call.pathName === "resumes_search:searchWithTagExpansionPage")).toBe(false);
    expect(calls.some((call) => call.pathName === "resumes_search:searchWithTagExpansion")).toBe(false);
  });

  it("keeps the best-scoring duplicate identity when oversized keyword scans merge exact cursor pages", async () => {
    const calls: ConvexCall[] = [];
    const getMatchesPageSpy = vi.spyOn(MatchStorage.prototype, "getMatchesPageForJob");
    const getMatchesByResumeIdsSpy = vi
      .spyOn(MatchStorage.prototype, "getMatchesByResumeIds")
      .mockImplementation((resumeIds) => {
        const ordered = Array.isArray(resumeIds) ? resumeIds : [];
        return ordered.flatMap((resumeId) => {
          if (resumeId === "resume-live-1") {
            return [buildStoredMatch("resume-live-1", { id: 1, score: 70 })];
          }
          if (resumeId === "resume-live-2") {
            return [buildStoredMatch("resume-live-2", { id: 2, score: 95 })];
          }
          if (resumeId === "resume-live-3") {
            return [buildStoredMatch("resume-live-3", { id: 3, score: 81 })];
          }
          return [];
        });
      });

    vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
      const call = parseConvexCall(input, init);
      calls.push(call);

      if (call.pathName === "resumes_search:searchWithTagExpansionPage") {
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
          total: 2501,
          results: [
            {
              resume: buildConvexResumeRecord("resume-live-1", {
                name: "Alice Older",
                identityKey: "dup-1",
                primaryRuleScore: 99,
              }),
              provenance: [{ term: "sales", source: "searchText" }],
            },
          ],
        });
      }

      if (call.pathName === "resumes_search:searchWithTagExpansionScanPage") {
        return convexSuccess({
          page: call.args.paginationOpts && isRecord(call.args.paginationOpts) && call.args.paginationOpts.cursor === "scan-2"
            ? [
                {
                  resume: buildConvexResumeRecord("resume-live-2", {
                    name: "Alice Better",
                    identityKey: "dup-1",
                    primaryRuleScore: 10,
                  }),
                  provenance: [{ term: "cnc", source: "searchText" }],
                },
                {
                  resume: buildConvexResumeRecord("resume-live-3", {
                    name: "Carla",
                    identityKey: "dup-2",
                    primaryRuleScore: 40,
                  }),
                  provenance: [{ term: "cnc", source: "searchText" }],
                },
              ]
            : [
                {
                  resume: buildConvexResumeRecord("resume-live-1", {
                    name: "Alice Older",
                    identityKey: "dup-1",
                    primaryRuleScore: 99,
                  }),
                  provenance: [{ term: "sales", source: "searchText" }],
                },
              ],
          continueCursor: call.args.paginationOpts && isRecord(call.args.paginationOpts) && call.args.paginationOpts.cursor === "scan-2"
            ? ""
            : "scan-2",
          isDone: Boolean(call.args.paginationOpts && isRecord(call.args.paginationOpts) && call.args.paginationOpts.cursor === "scan-2"),
        });
      }

      throw new Error(`Unexpected convex path: ${call.pathName}`);
    });

    const app = createApp();
    const response = await app.request("/api/resumes?source=convex&limit=2&sortBy=score&jobDescriptionId=jd-1&q=cnc%20sales");

    expect(response.status).toBe(200);
    const payload = await response.json();
    expect(payload.success).toBe(true);
    expect(payload.summary).toEqual(expect.objectContaining({
      total: 2,
      returned: 2,
      source: "convex",
    }));
    expect(payload.data.map((item: { name: string }) => item.name)).toEqual(["Alice Better", "Carla"]);
    expect(getMatchesPageSpy).not.toHaveBeenCalled();
    expect(getMatchesByResumeIdsSpy).toHaveBeenCalledWith(["resume-live-1", "resume-live-2", "resume-live-3"], "jd-1");
    expect(calls.some((call) => call.pathName === "resumes_search:searchWithTagExpansionScanPage")).toBe(true);
  });

  it("keeps explicit non-score keyword sorts when match filters require keyword scan pagination", async () => {
    const calls: ConvexCall[] = [];
    const getMatchesPageSpy = vi.spyOn(MatchStorage.prototype, "getMatchesPageForJob");
    const getMatchesByResumeIdsSpy = vi
      .spyOn(MatchStorage.prototype, "getMatchesByResumeIds")
      .mockImplementation((resumeIds) => {
        const ordered = Array.isArray(resumeIds) ? resumeIds : [];
        return ordered.flatMap((resumeId) => {
          if (resumeId === "resume-live-1") {
            return [buildStoredMatch("resume-live-1", { id: 1, score: 88 })];
          }
          if (resumeId === "resume-live-2") {
            return [buildStoredMatch("resume-live-2", { id: 2, score: 74 })];
          }
          if (resumeId === "resume-live-3") {
            return [buildStoredMatch("resume-live-3", { id: 3, score: 91 })];
          }
          return [];
        });
      });

    vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
      const call = parseConvexCall(input, init);
      calls.push(call);

      if (call.pathName === "resumes_search:searchWithTagExpansionScanPage") {
        return convexSuccess({
          page: [
            { resume: buildConvexResumeRecord("resume-live-1", { name: "Alice", location: "东莞" }), provenance: [{ term: "sales", source: "searchText" }] },
            { resume: buildConvexResumeRecord("resume-live-2", { name: "Bob", location: "东莞", primaryRuleScore: 10 }), provenance: [{ term: "cnc", source: "searchText" }] },
            { resume: buildConvexResumeRecord("resume-live-3", { name: "Carla", location: "东莞" }), provenance: [{ term: "cnc", source: "searchText" }] },
          ],
          continueCursor: "",
          isDone: true,
        });
      }

      throw new Error(`Unexpected convex path: ${call.pathName}`);
    });

    const app = createApp();
    const response = await app.request(
      "/api/resumes?source=convex&limit=2&jobDescriptionId=jd-1&q=cnc%20sales&minMatchScore=70&sortBy=name&sortOrder=desc"
    );

    expect(response.status).toBe(200);
    const payload = await response.json();
    expect(payload.success).toBe(true);
    expect(payload.summary).toEqual(expect.objectContaining({
      total: 3,
      returned: 2,
      source: "convex",
    }));
    expect(payload.data.map((item: { name: string }) => item.name)).toEqual(["Carla", "Bob"]);
    expect(getMatchesPageSpy).not.toHaveBeenCalled();
    expect(getMatchesByResumeIdsSpy).toHaveBeenCalledWith(["resume-live-1", "resume-live-2", "resume-live-3"], "jd-1");
    expect(calls[0]).toEqual(expect.objectContaining({
      pathName: "resumes_search:searchWithTagExpansionScanPage",
      args: expect.objectContaining({
        paginationOpts: expect.objectContaining({ cursor: null, numItems: 250 }),
      }),
    }));
  });

  it("pages score-sorted convex results through match storage and preserves explicit-id order", async () => {
    const calls: ConvexCall[] = [];
    const getMatchesPageSpy = vi
      .spyOn(MatchStorage.prototype, "getMatchesPageForJob")
      .mockReturnValue({
        matches: [
          buildStoredMatch("resume-live-3", { id: 3, score: 96 }),
          buildStoredMatch("resume-live-1", { id: 1, score: 81 }),
        ],
        total: 4,
      });
    const getMatchesByResumeIdsSpy = vi.spyOn(MatchStorage.prototype, "getMatchesByResumeIds");

    vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
      const call = parseConvexCall(input, init);
      calls.push(call);

      if (call.pathName === "candidate_status:list") {
        return convexSuccess([]);
      }

      if (call.pathName === "resumes:getByIdsForExport") {
        return convexSuccess([
          buildConvexExportResumeRecord("resume-live-1", { name: "Alice" }),
          buildConvexExportResumeRecord("resume-live-3", { name: "Carla" }),
        ]);
      }

      throw new Error(`Unexpected convex path: ${call.pathName}`);
    });

    const app = createApp();
    const response = await app.request("/api/resumes?source=convex&limit=2&offset=2&sortBy=score&jobDescriptionId=jd-1");

    expect(response.status).toBe(200);
    const payload = await response.json();
    expect(payload.success).toBe(true);
    expect(payload.summary).toEqual(expect.objectContaining({
      total: 4,
      returned: 2,
      source: "convex",
    }));
    expect(payload.data.map((item: { name: string }) => item.name)).toEqual(["Carla", "Alice"]);
    expect(getMatchesPageSpy).toHaveBeenCalledWith(expect.objectContaining({
      jobDescriptionId: "jd-1",
      limit: 2,
      offset: 2,
      sortOrder: "desc",
    }));
    expect(getMatchesByResumeIdsSpy).not.toHaveBeenCalled();
    expect(calls[0]).toEqual(expect.objectContaining({
      pathName: "resumes:getByIdsForExport",
      args: expect.objectContaining({ resumeIds: ["resume-live-3", "resume-live-1"] }),
    }));
  });

  it("pages minMatchScore convex filtering through match storage", async () => {
    const calls: ConvexCall[] = [];
    const getMatchesPageSpy = vi
      .spyOn(MatchStorage.prototype, "getMatchesPageForJob")
      .mockReturnValue({
        matches: [
          buildStoredMatch("resume-live-2", { id: 2, score: 88 }),
          buildStoredMatch("resume-live-4", { id: 4, score: 75 }),
        ],
        total: 2,
      });

    vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
      const call = parseConvexCall(input, init);
      calls.push(call);

      if (call.pathName === "candidate_status:list") {
        return convexSuccess([]);
      }

      if (call.pathName === "resumes:getByIdsForExport") {
        return convexSuccess([
          buildConvexExportResumeRecord("resume-live-4", { name: "Dylan" }),
          buildConvexExportResumeRecord("resume-live-2", { name: "Bob" }),
        ]);
      }

      throw new Error(`Unexpected convex path: ${call.pathName}`);
    });

    const app = createApp();
    const response = await app.request("/api/resumes?source=convex&limit=2&jobDescriptionId=jd-1&minMatchScore=70");

    expect(response.status).toBe(200);
    const payload = await response.json();
    expect(payload.success).toBe(true);
    expect(payload.summary).toEqual(expect.objectContaining({
      total: 2,
      returned: 2,
      source: "convex",
    }));
    expect(payload.data.map((item: { name: string }) => item.name)).toEqual(["Bob", "Dylan"]);
    expect(getMatchesPageSpy).toHaveBeenCalledWith(expect.objectContaining({
      jobDescriptionId: "jd-1",
      minScore: 70,
      sortOrder: "desc",
    }));
    expect(calls[0]).toEqual(expect.objectContaining({
      pathName: "resumes:getByIdsForExport",
      args: expect.objectContaining({ resumeIds: ["resume-live-2", "resume-live-4"] }),
    }));
  });

  it("pages recommendation-filtered convex results through match storage", async () => {
    const calls: ConvexCall[] = [];
    const getMatchesPageSpy = vi
      .spyOn(MatchStorage.prototype, "getMatchesPageForJob")
      .mockReturnValue({
        matches: [
          buildStoredMatch("resume-live-5", {
            id: 5,
            score: 93,
            recommendation: "strong_match",
          }),
          buildStoredMatch("resume-live-6", {
            id: 6,
            score: 84,
            recommendation: "match",
          }),
        ],
        total: 2,
      });

    vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
      const call = parseConvexCall(input, init);
      calls.push(call);

      if (call.pathName === "candidate_status:list") {
        return convexSuccess([]);
      }

      if (call.pathName === "resumes:getByIdsForExport") {
        return convexSuccess([
          buildConvexExportResumeRecord("resume-live-6", { name: "Fiona" }),
          buildConvexExportResumeRecord("resume-live-5", { name: "Evelyn" }),
        ]);
      }

      throw new Error(`Unexpected convex path: ${call.pathName}`);
    });

    const app = createApp();
    const response = await app.request(
      "/api/resumes?source=convex&limit=2&jobDescriptionId=jd-1&recommendation=strong_match,match"
    );

    expect(response.status).toBe(200);
    const payload = await response.json();
    expect(payload.success).toBe(true);
    expect(payload.summary).toEqual(expect.objectContaining({
      total: 2,
      returned: 2,
      source: "convex",
    }));
    expect(payload.data.map((item: { name: string }) => item.name)).toEqual(["Evelyn", "Fiona"]);
    expect(getMatchesPageSpy).toHaveBeenCalledWith(expect.objectContaining({
      jobDescriptionId: "jd-1",
      recommendation: ["strong_match", "match"],
      sortOrder: "desc",
    }));
    expect(calls[0]).toEqual(expect.objectContaining({
      pathName: "resumes:getByIdsForExport",
      args: expect.objectContaining({ resumeIds: ["resume-live-5", "resume-live-6"] }),
    }));
  });

  it("sends analyze location filters to the paginated convex query as locations", async () => {
    const calls: ConvexCall[] = [];

    vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
      const call = parseConvexCall(input, init);
      calls.push(call);

      if (call.pathName === "resumes_search:searchWithTagExpansionPaginated") {
        expect(call.args).toEqual(expect.objectContaining({
          query: "cnc 销售",
          locations: ["China"],
        }));
        expect(call.args).not.toHaveProperty("location");
        return convexSuccess({
          page: [
            {
              resume: buildConvexResumeRecord("resume-live-1", {
                name: "Alice",
                location: "China",
              }),
              provenance: [{ term: "销售", source: "searchText" }],
            },
          ],
          continuationCursor: null,
        });
      }

      throw new Error(`Unexpected convex path: ${call.pathName}`);
    });

    const app = createApp();
    const response = await app.request("/api/resumes/analyze", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        query: "CNC 销售",
        location: "China",
        dryRun: true,
      }),
    });

    expect(response.status).toBe(200);
    const payload = await response.json();
    expect(payload).toEqual(expect.objectContaining({
      success: true,
      dryRun: true,
      resumeCount: 1,
      config: expect.objectContaining({
        location: "China",
      }),
    }));
    expect(calls).toHaveLength(1);
    expect(calls[0]).toEqual(expect.objectContaining({
      pathName: "resumes_search:searchWithTagExpansionPaginated",
    }));
  });

  it("sends related experience context to convex analysis dispatch", async () => {
    const calls: ConvexCall[] = [];

    vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
      const call = parseConvexCall(input, init);
      calls.push(call);

      if (call.pathName === "resumes_search:searchWithTagExpansionPaginated") {
        return convexSuccess({
          page: [
            {
              resume: buildConvexResumeRecord("resume-live-1", {
                name: "Alice",
                location: "China",
              }),
              provenance: [{ term: "销售", source: "searchText" }],
            },
          ],
          continuationCursor: null,
        });
      }

      if (call.pathName === "analysis_tasks:dispatch") {
        expect(call.args).toEqual(expect.objectContaining({
          keywords: ["cnc", "销售"],
          resumeIds: ["resume-live-1"],
          relatedExpContext: {
            roleFilterType: "sales",
            minRoleYears: 1,
            market: "CN",
          },
        }));
        return convexSuccess("task-related-exp");
      }

      throw new Error(`Unexpected convex path: ${call.pathName}`);
    });

    const app = createApp();
    const response = await app.request("/api/resumes/analyze", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        query: "CNC 销售",
        limit: 500,
        roleFilterType: "sales",
        minRoleYears: 1,
        market: "CN",
      }),
    });

    expect(response.status).toBe(200);
    const payload = await response.json();
    expect(payload).toEqual(expect.objectContaining({
      success: true,
      taskId: "task-related-exp",
      resumeCount: 1,
    }));
    expect(calls.map((call) => call.pathName)).toEqual([
      "resumes_search:searchWithTagExpansionPaginated",
      "analysis_tasks:dispatch",
    ]);
  });

  it("omits a null cursor on the first dry-run clear-analyses mutation call", async () => {
    const calls: ConvexCall[] = [];

    vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
      const call = parseConvexCall(input, init, "/api/mutation");
      calls.push(call);

      if (call.pathName !== "resumes_mutations:clearAnalyses") {
        throw new Error(`Unexpected convex path: ${call.pathName}`);
      }

      if (calls.length === 1) {
        expect(call.args).toEqual(expect.objectContaining({
          batchSize: 50,
        }));
        expect(call.args).not.toHaveProperty("cursor");
        return convexSuccess({ cleared: 2, hasMore: true, cursor: "cursor-2" });
      }

      expect(call.args).toEqual(expect.objectContaining({
        batchSize: 50,
        cursor: "cursor-2",
      }));
      return convexSuccess({ cleared: 1, hasMore: false, cursor: null });
    });

    const app = createApp();
    const response = await app.request("/api/resumes/clear-analyses", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        dryRun: true,
      }),
    });

    expect(response.status).toBe(200);
    const payload = await response.json();
    expect(payload).toEqual(expect.objectContaining({
      success: true,
      dryRun: true,
      cleared: 0,
      wouldClear: 3,
      targeted: false,
    }));
    expect(calls).toHaveLength(2);
  });

  it("omits a null cursor on the first clear-analyses mutation call", async () => {
    const calls: ConvexCall[] = [];

    vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
      const call = parseConvexCall(input, init, "/api/mutation");
      calls.push(call);

      if (call.pathName !== "resumes_mutations:clearAnalyses") {
        throw new Error(`Unexpected convex path: ${call.pathName}`);
      }

      if (calls.length === 1) {
        expect(call.args).toEqual(expect.objectContaining({
          batchSize: 50,
        }));
        expect(call.args).not.toHaveProperty("cursor");
        return convexSuccess({ cleared: 2, hasMore: true, cursor: "cursor-2" });
      }

      expect(call.args).toEqual(expect.objectContaining({
        batchSize: 50,
        cursor: "cursor-2",
      }));
      return convexSuccess({ cleared: 1, hasMore: false, cursor: null });
    });

    const app = createApp();
    const response = await app.request("/api/resumes/clear-analyses", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({}),
    });

    expect(response.status).toBe(200);
    const payload = await response.json();
    expect(payload).toEqual(expect.objectContaining({
      success: true,
      cleared: 3,
      batches: 2,
      targeted: false,
    }));
    expect(calls).toHaveLength(2);
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

  describe("POST /api/resumes/explanation", () => {
    it("returns explanation from Convex when available", async () => {
      vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
        const call = parseConvexCall(input, init);
        if (call.pathName !== "audit:getExplanationForCandidate") {
          throw new Error(`Unexpected convex path: ${call.pathName}`);
        }
        expect(call.args).toEqual({ resumeId: "r1", workspaceSlug: "ws1" });
        return convexSuccess({
          summary: "Candidate scored 85/100 for CNC operator role.",
          keyFactors: [
            { factor: "skill_alignment", value: "5 years CNC experience" },
            { factor: "experience", value: "8 years total" },
          ],
          decidedAt: 1748200000000,
          decisionType: "score",
          scrubbedFields: ["age", "gender"],
          protectedAttributesExcluded: true,
        });
      });

      const app = createApp();
      const response = await app.request("/api/resumes/explanation", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ resumeId: "r1", workspaceSlug: "ws1" }),
      });

      expect(response.status).toBe(200);
      const payload = await response.json();
      expect(payload.success).toBe(true);
      expect(payload.data.summary).toBe("Candidate scored 85/100 for CNC operator role.");
      expect(payload.data.keyFactors.length).toBe(2);
      expect(payload.data.scrubbedFields).toEqual(["age", "gender"]);
      expect(payload.data.protectedAttributesExcluded).toBe(true);
    });

    it("returns null data when no explanation exists", async () => {
      vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
        parseConvexCall(input, init);
        return convexSuccess(null);
      });

      const app = createApp();
      const response = await app.request("/api/resumes/explanation", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ resumeId: "r2", workspaceSlug: "ws1" }),
      });

      expect(response.status).toBe(200);
      const payload = await response.json();
      expect(payload.success).toBe(true);
      expect(payload.data).toBeNull();
    });

    it("returns 400 when resumeId is missing", async () => {
      const app = createApp();
      const response = await app.request("/api/resumes/explanation", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ workspaceSlug: "ws1" }),
      });

      expect(response.status).toBe(400);
      const payload = await response.json();
      expect(payload.success).toBe(false);
    });

    it("returns 400 when workspaceSlug is missing", async () => {
      const app = createApp();
      const response = await app.request("/api/resumes/explanation", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ resumeId: "r1" }),
      });

      expect(response.status).toBe(400);
      const payload = await response.json();
      expect(payload.success).toBe(false);
    });

    it("returns 500 when Convex call fails", async () => {
      vi.spyOn(globalThis, "fetch").mockImplementation(async () => {
        return new Response(JSON.stringify({ status: "error", errorMessage: "Not found" }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      });

      const app = createApp();
      const response = await app.request("/api/resumes/explanation", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ resumeId: "r1", workspaceSlug: "ws1" }),
      });

      expect(response.status).toBe(500);
    });
  });

  describe("POST /api/resumes/audit-logs", () => {
    it("returns audit logs for a workspace", async () => {
      vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
        const call = parseConvexCall(input, init);
        if (call.pathName !== "audit:getAuditLogByWorkspace") {
          throw new Error(`Unexpected convex path: ${call.pathName}`);
        }
        expect(call.args.workspaceSlug).toBe("ws1");
        return convexSuccess([
          { _id: "al1", decisionType: "score", outcome: "pending", output: { score: 85 } },
          { _id: "al2", decisionType: "confirm", outcome: "pending", output: { score: 90 } },
        ]);
      });

      const app = createApp();
      const response = await app.request("/api/resumes/audit-logs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ workspaceSlug: "ws1" }),
      });

      expect(response.status).toBe(200);
      const payload = await response.json();
      expect(payload.success).toBe(true);
      expect(payload.data.length).toBe(2);
    });

    it("filters audit logs by decisionType", async () => {
      vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
        const call = parseConvexCall(input, init);
        expect(call.args).toEqual({ workspaceSlug: "ws1", decisionType: "score" });
        return convexSuccess([
          { _id: "al1", decisionType: "score", outcome: "pending" },
        ]);
      });

      const app = createApp();
      const response = await app.request("/api/resumes/audit-logs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ workspaceSlug: "ws1", decisionType: "score" }),
      });

      expect(response.status).toBe(200);
      const payload = await response.json();
      expect(payload.data.length).toBe(1);
    });

    it("returns 400 when workspaceSlug is missing", async () => {
      const app = createApp();
      const response = await app.request("/api/resumes/audit-logs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });

      expect(response.status).toBe(400);
    });

    it("returns 400 for invalid decisionType", async () => {
      const app = createApp();
      const response = await app.request("/api/resumes/audit-logs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ workspaceSlug: "ws1", decisionType: "invalid" }),
      });

      expect(response.status).toBe(400);
    });

    it("filters audit logs by outcome", async () => {
      vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
        const call = parseConvexCall(input, init);
        expect(call.args).toEqual({ workspaceSlug: "ws1", outcome: "pending" });
        return convexSuccess([
          { _id: "al1", decisionType: "score", outcome: "pending" },
        ]);
      });

      const app = createApp();
      const response = await app.request("/api/resumes/audit-logs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ workspaceSlug: "ws1", outcome: "pending" }),
      });

      expect(response.status).toBe(200);
      const payload = await response.json();
      expect(payload.data.length).toBe(1);
    });

    it("returns 400 for invalid outcome", async () => {
      const app = createApp();
      const response = await app.request("/api/resumes/audit-logs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ workspaceSlug: "ws1", outcome: "invalid" }),
      });

      expect(response.status).toBe(400);
    });
  });

  describe("POST /api/resumes/audit-outcome", () => {
    it("sets audit outcome to accepted", async () => {
      vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
        const call = parseConvexCall(input, init, "/api/mutation");
        expect(call.pathName).toBe("audit:setAuditOutcome");
        expect(call.args).toEqual({ auditLogId: "al1", outcome: "accepted" });
        return convexSuccess(null);
      });

      const app = createApp();
      const response = await app.request("/api/resumes/audit-outcome", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ auditLogId: "al1", outcome: "accepted" }),
      });

      expect(response.status).toBe(200);
      const payload = await response.json();
      expect(payload.success).toBe(true);
    });

    it("sets audit outcome to overridden with setBy", async () => {
      vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
        const call = parseConvexCall(input, init, "/api/mutation");
        expect(call.args).toEqual({ auditLogId: "al1", outcome: "overridden", setBy: "reviewer@example.com" });
        return convexSuccess(null);
      });

      const app = createApp();
      const response = await app.request("/api/resumes/audit-outcome", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ auditLogId: "al1", outcome: "overridden", setBy: "reviewer@example.com" }),
      });

      expect(response.status).toBe(200);
    });

    it("sets audit outcome to appealed", async () => {
      vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
        const call = parseConvexCall(input, init, "/api/mutation");
        expect(call.args.outcome).toBe("appealed");
        return convexSuccess(null);
      });

      const app = createApp();
      const response = await app.request("/api/resumes/audit-outcome", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ auditLogId: "al1", outcome: "appealed" }),
      });

      expect(response.status).toBe(200);
    });

    it("returns 400 when auditLogId is missing", async () => {
      const app = createApp();
      const response = await app.request("/api/resumes/audit-outcome", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ outcome: "accepted" }),
      });

      expect(response.status).toBe(400);
    });

    it("returns 400 for invalid outcome", async () => {
      const app = createApp();
      const response = await app.request("/api/resumes/audit-outcome", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ auditLogId: "al1", outcome: "invalid" }),
      });

      expect(response.status).toBe(400);
    });

    it("returns 500 when Convex call fails", async () => {
      vi.spyOn(globalThis, "fetch").mockImplementation(async () => {
        return new Response(JSON.stringify({ status: "error", errorMessage: "Not found" }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      });

      const app = createApp();
      const response = await app.request("/api/resumes/audit-outcome", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ auditLogId: "al1", outcome: "accepted" }),
      });

      expect(response.status).toBe(500);
    });
  });
});
