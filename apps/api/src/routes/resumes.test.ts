import { afterEach, describe, expect, it, vi } from "vitest";

import { createApp } from "../app";
import { MatchStorage, type StoredMatch } from "../services/match-storage";
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
    location?: string;
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

  it("keeps source pagination when a keyword search uses a non-score sort", async () => {
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
    const response = await app.request("/api/resumes?source=convex&q=cnc%20sales&limit=2&offset=2&sortBy=name&sortOrder=desc");

    expect(response.status).toBe(200);
    const payload = await response.json();
    expect(payload.success).toBe(true);
    expect(calls[0]).toEqual(expect.objectContaining({
      pathName: "resumes:searchWithTagExpansionPage",
      args: expect.objectContaining({ limit: 2, offset: 2, sortBy: "name", sortOrder: "desc" }),
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

      if (call.pathName === "resumes:searchWithTagExpansionPage") {
        return convexSuccess({
          expansion: {
            original: "\"machine tools\"",
            expanded: [
              "machine tools",
              "机床",
              "机械设备",
              "加工设备",
              "加工中心",
              "cnc machine",
              "cnc machines",
              "precision machinery",
            ],
            groups: [
              {
                original: "machine tools",
                variants: [
                  "machine tools",
                  "机床",
                  "机械设备",
                  "加工设备",
                  "加工中心",
                  "cnc machine",
                  "cnc machines",
                  "precision machinery",
                ],
              },
            ],
            mode: "AND",
          },
          results: [
            {
              resume: keeKimLoong,
              provenance: [{ term: "machine tools", source: "searchText" }],
            },
            {
              resume: johnsonLeeWeiTao,
              provenance: [{ term: "precision machinery", source: "searchText", expandedFrom: "machine tools" }],
            },
          ],
          total: 2,
        });
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
      pathName: "resumes:searchWithTagExpansionPage",
      args: expect.objectContaining({
        limit: 5,
        locations: ["Kuala Lumpur MY"],
        jobDescriptionId: "seek-malaysia-sales",
        keywordGroups: expect.arrayContaining([
          expect.objectContaining({
            original: "machine tools",
            variants: expect.arrayContaining(["machine tools", "precision machinery"]),
          }),
        ]),
      }),
    }));
  });

  it("pushes required keywords into paged convex keyword searches", async () => {
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
          ],
          total: 1,
        });
      }

      throw new Error(`Unexpected convex path: ${call.pathName}`);
    });

    const app = createApp();
    const response = await app.request("/api/resumes?source=convex&q=cnc%20sales&limit=2&requiredKeywords=machine%20tools,CNC");

    expect(response.status).toBe(200);
    expect(calls[0]).toEqual(expect.objectContaining({
      pathName: "resumes:searchWithTagExpansionPage",
      args: expect.objectContaining({
        limit: 2,
        requiredKeywords: ["machine tools", "cnc"],
      }),
    }));
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
    ]);
    expect(calls.some((call) => call.pathName === "resumes:listWithIngestData")).toBe(false);
    expect(calls.some((call) => call.pathName === "resumes:searchWithTagExpansion")).toBe(false);
  });

  it("widens the convex fetch window when score-sorted keyword searches cannot use match-storage pagination", async () => {
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

      if (call.pathName === "resumes:searchWithTagExpansion") {
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
            { resume: buildConvexResumeRecord("resume-live-1", { name: "Alice" }), provenance: [{ term: "sales", source: "searchText" }] },
            { resume: buildConvexResumeRecord("resume-live-3", { name: "Carla" }), provenance: [{ term: "cnc", source: "searchText" }] },
          ],
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
      pathName: "resumes:searchWithTagExpansion",
      args: expect.objectContaining({ limit: 250, jobDescriptionId: "jd-1" }),
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
