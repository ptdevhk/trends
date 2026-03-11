import { afterEach, describe, expect, it, vi } from "vitest";

import { normalizeResumeImportPayload, submitResumeImport } from "./resume-import-service";

type ConvexCall = {
  pathName: string;
  args: Record<string, unknown>;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function parseConvexCall(input: RequestInfo | URL, init?: RequestInit): ConvexCall {
  const requestUrl = typeof input === "string"
    ? input
    : input instanceof URL
      ? input.toString()
      : input.url;

  if (!requestUrl.includes("/api/mutation")) {
    throw new Error(`Unexpected request URL: ${requestUrl}`);
  }

  const body = typeof init?.body === "string" ? JSON.parse(init.body) : null;
  if (!isRecord(body)) {
    throw new Error("Missing convex request body");
  }

  const pathName = typeof body.path === "string" ? body.path : "";
  const args = isRecord(body.args) ? body.args : {};
  if (!pathName) {
    throw new Error("Missing convex path in request body");
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
    },
  );
}

describe("resume-import-service", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("normalizes legacy searchCriteria metadata into top-level fields", () => {
    const result = normalizeResumeImportPayload({
      metadata: {
        sourceUrl: "https://hr.job5156.com/search?keyword=%E9%94%80%E5%94%AE",
        generatedBy: "browser-extension@1.0.0",
        searchCriteria: {
          keyword: " 销售 ",
          location: " 东莞 ",
          filters: {},
        },
      },
      data: [
        {
          resumeId: 1079188,
          perUserId: 1079188,
          name: "骆先生",
          profileUrl: "javascript:;",
          activityStatus: "在线中",
          age: "42岁",
          experience: "20年",
          education: "高中",
          location: "东莞石碣镇",
          jobIntention: "东莞石碣镇机械制图员",
          expectedSalary: "6000-7999元/月",
          selfIntro: "...",
          workHistory: [{ raw: "2018-01 ~ 至今 Example Co." }],
          extractedAt: "2026-02-11T13:01:41.009Z",
        },
      ],
    });

    expect(result.metadata.keyword).toBe("销售");
    expect(result.metadata.location).toBe("东莞");
    expect(result.source).toBe("hr.job5156.com");
    expect(result.tags).toEqual(["销售"]);
    expect(result.resumes).toHaveLength(1);
    expect(result.convexResumes[0]).toMatchObject({
      externalId: "hr.job5156.com:resume:1079188",
      source: "hr.job5156.com",
      tags: ["销售"],
      content: expect.objectContaining({
        resumeId: "1079188",
        perUserId: "1079188",
        name: "骆先生",
      }),
    });
  });

  it("submits source-aware payloads through the shared Convex path", async () => {
    const calls: ConvexCall[] = [];

    vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
      const call = parseConvexCall(input, init);
      calls.push(call);

      if (call.pathName === "resume_tasks:submitResumes") {
        return convexSuccess({
          submitted: 1,
          deduped: 0,
          inserted: 1,
          updated: 0,
          unchanged: 0,
        });
      }

      throw new Error(`Unexpected convex path: ${call.pathName}`);
    });

    const result = await submitResumeImport({
      metadata: {
        sourceKey: "seek",
        sourceHost: "hk.employer.seek.com",
        sourceUrl: "https://hk.employer.seek.com/candidates/recommended?jobId=90842915&pageNumber=2",
        keyword: "sales engineer",
        generatedBy: "manual-import@1.0.0",
        collectionContext: {
          captureMode: "json-upload",
          operation: "manual-import",
          jobId: 90842915,
          pageNumber: 2,
          language: "en",
          profileType: "seek",
        },
      },
      resumes: [
        {
          profileId: 503033454,
          profileType: "seek",
          name: "yap kae wen",
          profileUrl: "https://hk.employer.seek.com/candidates/503033454",
          activityStatus: "Updated recently",
          location: "Shah Alam, Selangor, MY",
          jobIntention: "Senior Sales Engineer",
          workHistory: [{ raw: "Senior Sales Engineer · Example Co." }],
          extractedAt: "2026-03-12T01:02:03.000Z",
        },
      ],
    });

    expect(result).toEqual({
      success: true,
      submitted: 1,
      inserted: 1,
      updated: 0,
      unchanged: 0,
      deduped: 0,
    });
    expect(calls).toHaveLength(1);
    expect(calls[0]?.pathName).toBe("resume_tasks:submitResumes");
    expect(calls[0]?.args).toMatchObject({
      resumes: [
        {
          externalId: "hk.employer.seek.com:profile:503033454",
          source: "hk.employer.seek.com",
          tags: ["sales engineer"],
          content: expect.objectContaining({
            profileId: "503033454",
            profileType: "seek",
            name: "yap kae wen",
          }),
        },
      ],
    });
  });
});
