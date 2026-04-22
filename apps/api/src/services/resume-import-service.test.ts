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
        locationHierarchy: {
          country: "中国",
          province: "广东",
          city: "东莞",
          district: "石碣",
          matchedFrom: "location",
          confidence: "high",
        },
      }),
    });
  });

  it("fills missing Job5156 locations from the derived hierarchy", () => {
    const result = normalizeResumeImportPayload({
      metadata: {
        sourceKey: "job5156",
        sourceHost: "hr.job5156.com",
        sourceUrl: "https://hr.job5156.com/resume/view/555555",
        keyword: "销售",
        generatedBy: "browser-extension@1.1.1",
      },
      resumes: [
        {
          resumeId: 555555,
          name: "空位置候选人",
          profileUrl: "https://hr.job5156.com/resume/view/555555",
          activityStatus: "在线中",
          location: "",
          jobIntention: "销售工程师",
          workHistory: [
            {
              raw: "2020-01~2024-01 东莞富佳机械设备有限公司 销售工程师",
              companyName: "东莞富佳机械设备有限公司",
              jobTitle: "销售工程师",
            },
          ],
          extractedAt: "2026-03-12T01:02:03.000Z",
        },
      ],
    });

    expect(result.convexResumes[0]).toMatchObject({
      content: expect.objectContaining({
        location: "广东东莞",
        locationHierarchy: {
          country: "中国",
          province: "广东",
          city: "东莞",
          matchedFrom: "workHistory",
          confidence: "high",
        },
      }),
    });
  });

  it("uses per-item sourceHost and tags for mixed-source backup payloads", () => {
    const result = normalizeResumeImportPayload({
      metadata: {
        sourceUrl: "https://backup.example.com/api/resumes/backup",
        generatedBy: "trends-api backup",
        keyword: "backup",
      },
      resumes: [
        {
          resumeId: "1001",
          name: "Alice",
          profileUrl: "https://hr.job5156.com/resume/view/1001",
          activityStatus: "Active",
          age: "30",
          experience: "5 years",
          education: "Bachelor",
          location: "东莞",
          jobIntention: "Sales",
          expectedSalary: "10k-20k",
          selfIntro: "Intro",
          workHistory: [{ raw: "Test work history" }],
          extractedAt: "2026-03-17T00:00:00.000Z",
          sourceHost: "hr.job5156.com",
          tags: ["job5156", "sales"],
          restoreState: {
            crawledAt: 1763942400000,
            isArchived: true,
            archivedAt: 1763942400000,
            searchText: "alice sales dongguan",
            primaryRuleScore: 91,
            ingestData: {
              industryTags: ["machine tools"],
            },
            analysis: {
              score: 88,
            },
            analyses: {
              "source:job5156|analysis:lathe-sales": { score: 88 },
            },
          },
        },
        {
          profileId: "2002",
          profileType: "seek",
          name: "Bob",
          profileUrl: "https://hk.employer.seek.com/candidates/2002",
          activityStatus: "Active",
          age: "31",
          experience: "6 years",
          education: "Bachelor",
          location: "Kuala Lumpur",
          jobIntention: "Sales Engineer",
          expectedSalary: "8k-12k",
          selfIntro: "Intro",
          workHistory: [{ raw: "Test work history" }],
          extractedAt: "2026-03-17T00:00:00.000Z",
          sourceHost: "hk.employer.seek.com",
          tags: ["seek"],
        },
      ],
    });

    expect(result.source).toBe("backup.example.com");
    expect(result.tags).toEqual(["backup"]);
    expect(result.convexResumes).toHaveLength(2);
    expect(result.convexResumes[0]).toMatchObject({
      source: "hr.job5156.com",
      tags: ["job5156", "sales"],
      externalId: "hr.job5156.com:resume:1001",
      restoreState: {
        crawledAt: 1763942400000,
        isArchived: true,
        archivedAt: 1763942400000,
        searchText: "alice sales dongguan",
        primaryRuleScore: 91,
        ingestData: {
          industryTags: ["machine tools"],
        },
        analysis: {
          score: 88,
        },
        analyses: {
          "source:job5156|analysis:lathe-sales": { score: 88 },
        },
      },
    });
    expect(result.convexResumes[1]).toMatchObject({
      source: "hk.employer.seek.com",
      tags: ["seek"],
      externalId: "hk.employer.seek.com:profile:2002",
    });
    expect(result.convexResumes[0].content).not.toHaveProperty("sourceHost");
    expect(result.convexResumes[0].content).not.toHaveProperty("tags");
    expect(result.convexResumes[1].content).not.toHaveProperty("sourceHost");
    expect(result.convexResumes[1].content).not.toHaveProperty("tags");
  });

  it("preserves Job5156 detail-page work history fields during normalization", () => {
    const result = normalizeResumeImportPayload({
      metadata: {
        sourceKey: "job5156",
        sourceHost: "hr.job5156.com",
        sourceUrl: "https://hr.job5156.com/resume/view/987654",
        keyword: "销售工程师",
        generatedBy: "browser-extension@1.1.1",
        collectionContext: {
          captureMode: "detail-page",
          operation: "auto-sync",
        },
      },
      resumes: [
        {
          resumeId: 987654,
          perUserId: 123456,
          name: "李先生",
          profileUrl: "https://hr.job5156.com/resume/view/987654",
          activityStatus: "在线中",
          location: "东莞",
          jobIntention: "销售工程师",
          workHistory: [
            {
              raw: "2021-03~至今(4年)东莞某设备公司销售工程师\n负责华南区机床销售与客户维护",
              companyName: "东莞某设备公司",
              jobTitle: "销售工程师",
              startDate: "2021-03",
              endDate: "至今",
              description: "负责华南区机床销售与客户维护。\n离职原因：寻求更大平台。",
            },
          ],
          extractedAt: "2026-03-12T01:02:03.000Z",
        },
      ],
    });

    expect(result.source).toBe("hr.job5156.com");
    expect(result.tags).toEqual(["销售工程师"]);
    expect(result.resumes).toHaveLength(1);
    expect(result.convexResumes[0]).toMatchObject({
      externalId: "hr.job5156.com:resume:987654",
      source: "hr.job5156.com",
      tags: ["销售工程师"],
      content: expect.objectContaining({
        resumeId: "987654",
        perUserId: "123456",
        profileUrl: "https://hr.job5156.com/resume/view/987654",
        workHistory: [
          {
            raw: "2021-03~至今(4年)东莞某设备公司销售工程师\n负责华南区机床销售与客户维护",
            companyName: "东莞某设备公司",
            jobTitle: "销售工程师",
            startDate: "2021-03",
            endDate: "至今",
            description: "负责华南区机床销售与客户维护。\n离职原因：寻求更大平台。",
          },
        ],
      }),
    });
  });

  it("preserves structured manual 51job fields through shared normalization", () => {
    const result = normalizeResumeImportPayload({
      metadata: {
        sourceKey: "51job-manual",
        sourceHost: "51job-manual",
        sourceUrl: "https://www.51job.com/",
        keyword: "销售工程师",
        generatedBy: "manual-import@1.0.0",
      },
      resumes: [
        {
          profileId: "123456",
          profileType: "51job-manual",
          name: "张三",
          location: "广东东莞",
          experience: "5年",
          education: "本科",
          jobIntention: "销售工程师",
          selfIntro: "熟悉CNC机床销售、客户跟进与方案沟通",
          workHistory: [
            {
              raw: "2021-03~至今 东莞精密机械有限公司 销售工程师",
              companyName: "东莞精密机械有限公司",
              jobTitle: "销售工程师",
              description: "负责华南区机床销售与客户维护",
              startDate: "2021-03",
              endDate: "至今",
            },
          ],
          profileEducation: [
            {
              institution: "华南理工大学",
              qualification: "本科",
              fieldOfStudy: "机械设计制造及其自动化",
              startDate: "2015-09",
              endDate: "2019-06",
            },
          ],
          resumeSnippet: {
            text: "姓名：张三\n工作经历\n2021-03~至今 东莞精密机械有限公司 销售工程师",
          },
          extractedAt: "2026-03-19T00:00:00.000Z",
        },
      ],
    });

    expect(result.convexResumes[0]).toMatchObject({
      externalId: "51job-manual:profile:123456",
      source: "51job-manual",
      tags: ["销售工程师"],
      content: expect.objectContaining({
        profileType: "51job-manual",
        name: "张三",
        experience: "5年",
        education: "本科",
        jobIntention: "销售工程师",
        selfIntro: "熟悉CNC机床销售、客户跟进与方案沟通",
        resumeSnippet: {
          text: "姓名：张三\n工作经历\n2021-03~至今 东莞精密机械有限公司 销售工程师",
        },
        locationHierarchy: {
          country: "中国",
          province: "广东",
          city: "东莞",
          matchedFrom: "location",
          confidence: "high",
        },
        workHistory: [
          {
            raw: "2021-03~至今 东莞精密机械有限公司 销售工程师",
            companyName: "东莞精密机械有限公司",
            jobTitle: "销售工程师",
            description: "负责华南区机床销售与客户维护",
            startDate: "2021-03",
            endDate: "至今",
          },
        ],
        profileEducation: [
          {
            institution: "华南理工大学",
            qualification: "本科",
            fieldOfStudy: "机械设计制造及其自动化",
            startDate: "2015-09",
            endDate: "2019-06",
          },
        ],
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
          workHistory: [
            {
              raw: "Senior Sales Engineer · Example Co.",
              companyName: "Example Co.",
              jobTitle: "Senior Sales Engineer",
              description: "Managed CNC machine accounts across Malaysia.",
            },
          ],
          profileEducation: [
            {
              institution: "Universiti Malaya",
              qualification: "Bachelor of Engineering",
            },
          ],
          skills: ["CNC", { name: "Key account management" }],
          languages: ["English", { name: "Mandarin", proficiency: "professional" }],
          licences: [{ name: "Class D" }],
          resumeSnippet: {
            text: "Experienced sales engineer covering machine tools.",
          },
          currentIndustry: { name: "Industrial machinery" },
          currentSubindustry: "Machine tools",
          rightToWork: { status: "citizen" },
          digitalIdentity: { linkedinUrl: "https://www.linkedin.com/in/example" },
          noticePeriodDays: 30,
          extractedAt: "2026-03-12T01:02:03.000Z",
          restoreState: {
            crawledAt: 1763942400000,
            searchText: "yap kae wen cnc sales engineer selangor",
            primaryRuleScore: 72,
            ingestData: {
              industryTags: ["machine tools"],
            },
          },
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
      statusReplayed: 0,
      actionsReplayed: 0,
      actionsDeduped: 0,
    });
    expect(calls).toHaveLength(1);
    expect(calls[0]?.pathName).toBe("resume_tasks:submitResumes");
    expect(calls[0]?.args).toMatchObject({
      resumes: [
        {
          externalId: "hk.employer.seek.com:profile:503033454",
          source: "hk.employer.seek.com",
          tags: ["sales engineer"],
          restoreState: {
            crawledAt: 1763942400000,
            searchText: "yap kae wen cnc sales engineer selangor",
            primaryRuleScore: 72,
            ingestData: {
              industryTags: ["machine tools"],
            },
          },
          content: expect.objectContaining({
            profileId: "503033454",
            profileType: "seek",
            name: "yap kae wen",
            profileEducation: [
              {
                institution: "Universiti Malaya",
                qualification: "Bachelor of Engineering",
              },
            ],
            skills: ["CNC", { name: "Key account management" }],
            languages: ["English", { name: "Mandarin", proficiency: "professional" }],
            licences: [{ name: "Class D" }],
            resumeSnippet: {
              text: "Experienced sales engineer covering machine tools.",
            },
            currentIndustry: { name: "Industrial machinery" },
            currentSubindustry: "Machine tools",
            rightToWork: { status: "citizen" },
            digitalIdentity: { linkedinUrl: "https://www.linkedin.com/in/example" },
            noticePeriodDays: 30,
          }),
        },
      ],
    });
  });

  it("chunks large imports into multiple Convex submissions", async () => {
    const batchLengths: number[] = [];

    vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
      const call = parseConvexCall(input, init);
      if (call.pathName !== "resume_tasks:submitResumes") {
        throw new Error(`Unexpected convex path: ${call.pathName}`);
      }

      const resumes = Array.isArray(call.args.resumes) ? call.args.resumes : [];
      batchLengths.push(resumes.length);

      return convexSuccess({
        submitted: resumes.length,
        deduped: 0,
        inserted: resumes.length,
        updated: 0,
        unchanged: 0,
      });
    });

    const result = await submitResumeImport({
      metadata: {
        sourceUrl: "https://backup.example.com/api/resumes/backup",
        generatedBy: "trends-api backup",
      },
      resumes: Array.from({ length: 201 }, (_, index) => ({
        name: `Resume ${index + 1}`,
        profileUrl: `https://example.com/resumes/${index + 1}`,
        activityStatus: "Active",
        extractedAt: "2026-03-19T05:34:12.000Z",
      })),
    });

    expect(batchLengths).toEqual([200, 1]);
    expect(result).toEqual({
      success: true,
      submitted: 201,
      inserted: 201,
      updated: 0,
      unchanged: 0,
      deduped: 0,
      statusReplayed: 0,
      actionsReplayed: 0,
      actionsDeduped: 0,
    });
  });
});
