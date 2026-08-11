import { OpenAPIHono } from "@hono/zod-openapi";
import JSZip from "jszip";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { workspaceMiddleware } from "../middleware/workspace";
import { parseJsonBody } from "../test-utils";
import { createAuthContext } from "./test-auth-helpers";

// The verified-employer catalog singleton fires a background Convex fetch
// (`companies:listVerifiedIndustryEmployerAliases`) on service construction.
// These route tests assert `fetch` is never called outside the tested flow,
// so the catalog must degrade to the empty (synonyms-only) state. Bridge
// behavior itself is covered by unified-search-service.test.ts with fakes.
vi.mock("../services/verified-employer-catalog-service.js", () => ({
  verifiedEmployerCatalog: {
    getVerifiedEmployers: () => [],
    warm: () => Promise.resolve(),
    refresh: () => Promise.resolve([]),
  },
}));

type ConvexCall = {
  pathName: string;
  args: Record<string, unknown>;
};

async function createTestApp(role: "user" | "admin" = "admin") {
  const [{ default: resumesRoutes }, { default: resumesImportRoutes }] = await Promise.all([
    import("./resumes"),
    import("./resumes_import"),
  ]);
  const app = new OpenAPIHono();
  app.use("*", workspaceMiddleware);
  app.use("*", async (c, next) => {
    c.set("auth", createAuthContext({ workspaceSlug: "hr", role }));
    await next();
  });
  app.route("/", resumesImportRoutes);
  app.route("/", resumesRoutes);
  return app;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function parseConvexCall(input: Request | string | URL, init?: RequestInit): ConvexCall {
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

async function createDocxFile(name: string, text: string): Promise<File> {
  const zip = new JSZip();
  const paragraphs = text
    .split("\n")
    .map((line) => line
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&apos;"))
    .map((line) => `    <w:p><w:r><w:t>${line}</w:t></w:r></w:p>`)
    .join("\n");
  zip.file("[Content_Types].xml", `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  <Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>
</Types>`);
  zip.folder("_rels")?.file(".rels", `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>
</Relationships>`);
  zip.folder("word")?.file("document.xml", `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
  <w:body>
${paragraphs}
  </w:body>
</w:document>`);

  // arraybuffer (not uint8array) so the value is an ArrayBuffer, which is a
  // valid BlobPart; a Uint8Array<ArrayBufferLike> from @types/node 25 is not.
  const buffer = await zip.generateAsync({ type: "arraybuffer" });
  return new File([buffer], name, { type: "application/vnd.openxmlformats-officedocument.wordprocessingml.document" });
}

function decodeTestDocxXml(value: string): string {
  return value
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, "&");
}

async function extractGeneratedDocxText(buffer: Buffer): Promise<string> {
  const zip = await JSZip.loadAsync(buffer);
  const documentXml = await zip.file("word/document.xml")?.async("string");
  if (!documentXml) {
    return "";
  }

  return Array.from(documentXml.matchAll(/<w:t[^>]*>([\s\S]*?)<\/w:t>/g))
    .map((match) => decodeTestDocxXml(match[1] ?? "").trim())
    .filter(Boolean)
    .join("\n");
}

function mockMammothDocxExtraction() {
  vi.doMock("mammoth", () => ({
    extractRawText: vi.fn(async ({ buffer }: { buffer: Buffer }) => ({
      value: await extractGeneratedDocxText(buffer),
      messages: [],
    })),
  }));
}

const DEFAULT_CONVEX_SUBMIT_RESULT = {
  submitted: 1,
  deduped: 0,
  inserted: 1,
  updated: 0,
  unchanged: 0,
} as const;

function mockSubmitResumes(calls: ConvexCall[]) {
  vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
    const call = parseConvexCall(input, init);
    calls.push(call);
    if (call.pathName === "resume_tasks:submitResumes") {
      return convexSuccess(DEFAULT_CONVEX_SUBMIT_RESULT);
    }
    throw new Error(`Unexpected convex path: ${call.pathName}`);
  });
}

async function requestManualImport(formData: FormData): Promise<Response> {
  const app = await createTestApp();
  return app.request("/api/resumes/manual-import", {
    method: "POST",
    headers: {
      "X-Workspace-Slug": "hr",
    },
    body: formData,
  });
}

function getSubmittedResume(calls: ConvexCall[]): Record<string, unknown> | undefined {
  return (calls[0]?.args.resumes as Array<Record<string, unknown>> | undefined)?.[0];
}

async function expectUnreadablePdfUploadFailure(options: {
  fileName: string;
  extractedText: string;
}) {
  const fetchSpy = vi.spyOn(globalThis, "fetch");
  const destroy = vi.fn(async () => undefined);

  vi.doMock("pdf-parse", () => ({
    PDFParse: vi.fn(function MockPdfParse() {
      return {
        getText: vi.fn(async () => ({ text: options.extractedText })),
        destroy,
      };
    }),
  }));

  const formData = new FormData();
  formData.append("files", new File([new Uint8Array([0x25, 0x50, 0x44, 0x46])], options.fileName, {
    type: "application/pdf",
  }));

  const response = await requestManualImport(formData);

  expect(response.status).toBe(200);
  expect(await response.json()).toMatchObject({
    success: true,
    summary: {
      uploadedFiles: 1,
      discoveredFiles: 1,
      parsedResumes: 0,
      imported: 0,
      failed: 1,
    },
    files: [
      expect.objectContaining({
        entryPath: options.fileName,
        status: "failed",
        error: "PDF text extraction produced unusable content",
      }),
    ],
  });
  expect(fetchSpy).not.toHaveBeenCalled();
  expect(destroy).toHaveBeenCalledTimes(1);
}

describe("manual resume import route", () => {
  beforeEach(() => {
    mockMammothDocxExtraction();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.doUnmock("mammoth");
    vi.resetModules();
  });

  it("allows hr workspace users to upload direct DOCX resumes", async () => {
    const calls: ConvexCall[] = [];
    const documentText = [
      "姓名：张三",
      "人才ID：123456",
      "区域：广东东莞",
      "应聘方向：销售工程师",
      "工作经验：5年",
      "最高学历：本科",
      "工作经历",
      "2021-03~至今 东莞精密机械有限公司 销售工程师",
      "工作描述：负责华南区机床销售与客户维护",
      "教育经历",
      "2015-09~2019-06 华南理工大学 机械设计制造及其自动化 本科",
      "个人优势",
      "熟悉CNC机床销售、客户跟进与方案沟通",
    ].join("\n");

    mockSubmitResumes(calls);

    const formData = new FormData();
    formData.append("files", await createDocxFile("51job_张三(123456).docx", documentText));
    formData.append("keyword", "销售工程师");

    const response = await requestManualImport(formData);

    expect(response.status).toBe(200);
    const payload = await response.json();
    expect(payload).toMatchObject({
      success: true,
      source: { key: "51job-manual", label: "51job-manual" },
      summary: {
        uploadedFiles: 1,
        discoveredFiles: 1,
        parsedResumes: 1,
        imported: 1,
        inserted: 1,
        updated: 0,
        unchanged: 0,
        deduped: 0,
        skipped: 0,
        failed: 0,
      },
      files: [
        {
          uploadName: "51job_张三(123456).docx",
          entryPath: "51job_张三(123456).docx",
          extension: ".docx",
          status: "imported",
          resumeName: "张三",
          profileId: "123456",
        },
      ],
    });
    expect(calls).toHaveLength(1);
    const submittedResume = getSubmittedResume(calls);
    expect(submittedResume).toMatchObject({
      source: "51job-manual",
      externalId: "51job-manual:profile:123456",
      tags: ["销售工程师"],
    });
    const content = submittedResume?.content;
    expect(content).toHaveProperty("name", "张三");
    expect(content).toHaveProperty("profileType", "51job-manual");
    expect(content).toHaveProperty("experience", "5年");
    expect(content).toHaveProperty("education", "本科");
    expect(content).toHaveProperty("location", "广东东莞");
    expect(content).toHaveProperty("jobIntention", "销售工程师");
    expect(content).toHaveProperty("selfIntro", "熟悉CNC机床销售、客户跟进与方案沟通");
    expect(content).toHaveProperty("resumeSnippet.text");
    expect(String((content as { resumeSnippet?: { text?: string } }).resumeSnippet?.text)).toContain("姓名：张三");
    expect(String((content as { resumeSnippet?: { text?: string } }).resumeSnippet?.text)).toContain("东莞精密机械有限公司 销售工程师");
    expect(content).toHaveProperty("locationHierarchy");
    expect(content).toHaveProperty("profileId", "123456");
    expect(content).toHaveProperty("workHistory.0.companyName", "东莞精密机械有限公司");
    expect(content).toHaveProperty("workHistory.0.jobTitle", "销售工程师");
    expect(content).toHaveProperty("workHistory.0.description", "负责华南区机床销售与客户维护");
    expect(content).toHaveProperty("workHistory.0.startDate", "2021-03");
    expect(content).toHaveProperty("workHistory.0.endDate", "至今");
    expect(String((content as { workHistory?: Array<{ raw?: string }> }).workHistory?.[0]?.raw)).toContain("东莞精密机械有限公司 销售工程师");
    expect(content).toHaveProperty("profileEducation.0.institution", "华南理工大学");
    expect(content).toHaveProperty("profileEducation.0.qualification", "本科");
    expect(content).toHaveProperty("profileEducation.0.fieldOfStudy", "机械设计制造及其自动化");
    expect(content).toHaveProperty("profileEducation.0.startDate", "2015-09");
    expect(content).toHaveProperty("profileEducation.0.endDate", "2019-06");
  });

  it("imports malformed 51job DOCX files via fallback XML extraction", async () => {
    const calls: ConvexCall[] = [];
    const fallbackText = [
      "姓名：王某",
      "人才ID: 987654321",
      "现居·广州",
      "应聘方向：销售工程师",
      "工作经历",
      "2020-01~2024-12 广州门窗设备有限公司 销售工程师",
      "工作描述：对门窗体验箱和气密性仪器进行销售",
      "个人优势",
      "熟悉门窗检测与客户跟进",
    ].join("\n");
    const fallbackFileName = "51job_王某(987654321).docx";

    vi.doMock("mammoth", () => ({
      extractRawText: vi.fn(async () => {
        throw new Error("Not implemented");
      }),
    }));

    mockSubmitResumes(calls);

    const formData = new FormData();
    formData.append("files", await createDocxFile(fallbackFileName, fallbackText));

    const response = await requestManualImport(formData);

    expect(response.status).toBe(200);
    const payload = await response.json();
    expect(payload).toMatchObject({
      success: true,
      summary: {
        uploadedFiles: 1,
        discoveredFiles: 1,
        parsedResumes: 1,
        imported: 1,
        skipped: 0,
        failed: 0,
      },
      files: [
        expect.objectContaining({
          uploadName: fallbackFileName,
          entryPath: fallbackFileName,
          status: "imported",
          resumeName: "王某",
          profileId: "987654321",
          warnings: expect.arrayContaining([expect.stringContaining("Used DOCX XML fallback parser: Not implemented")]),
        }),
      ],
    });
    expect(calls).toHaveLength(1);
    expect(calls[0]?.args).toMatchObject({
      resumes: [
        {
          source: "51job-manual",
          externalId: "51job-manual:profile:987654321",
          content: expect.objectContaining({
            name: "王某",
            profileType: "51job-manual",
            location: "广州",
            locationHierarchy: {
              country: "中国",
              province: "广东",
              city: "广州",
              matchedFrom: "location",
              confidence: "high",
            },
            jobIntention: "销售工程师",
            selfIntro: "熟悉门窗检测与客户跟进",
            resumeSnippet: { text: fallbackText },
            workHistory: [
              expect.objectContaining({
                companyName: "广州门窗设备有限公司",
                jobTitle: "销售工程师",
                description: "对门窗体验箱和气密性仪器进行销售",
                startDate: "2020-01",
                endDate: "2024-12",
              }),
            ],
          }),
        },
      ],
    });
  });

  it("fails unreadable PDF resumes instead of importing junk text", async () => {
    await expectUnreadablePdfUploadFailure({
      fileName: "东莞（加工中心）-周进佑.pdf",
      extractedText: "-- 1 of 1 --",
    });
  });

  it("fails garbled PDF resumes instead of importing control-character junk", async () => {
    await expectUnreadablePdfUploadFailure({
      fileName: "车床-龙雄-.pdf",
      extractedText: "\u0002\u0003\u0004\u0002\u0005\u0004\u0006\u0007\b \u000e\u000f \u0010\u0011\u0012\u0013",
    });
  });

  it("parses summary-style 51job resumes with split work-history blocks", async () => {
    const calls: ConvexCall[] = [];
    const documentText = [
      "曾先生 积极找工作（一个月内到岗）",
      "36岁\t14年经验\t高中\t现居·清远-英德市",
      "求职意向",
      "求职偏好： 单休\tTo B（企业/机构）\t面销/陌拜",
      "客户代表\t东莞\t全职\t8千-1万/月\t机械/设备/重工",
      "工作经历",
      "东莞市世川机械科技有限公司",
      "2022.02-至今（4年1个月）",
      "客户代表",
      "工作描述：主要负责销售津上设备。",
    ].join("\n");
    const fileName = "曾先生(227359817).docx";

    mockSubmitResumes(calls);

    const formData = new FormData();
    formData.append("files", await createDocxFile(fileName, documentText));

    const response = await requestManualImport(formData);

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      success: true,
      summary: {
        uploadedFiles: 1,
        discoveredFiles: 1,
        parsedResumes: 1,
        imported: 1,
        skipped: 0,
        failed: 0,
      },
      files: [
        expect.objectContaining({
          uploadName: fileName,
          entryPath: fileName,
          status: "imported",
          resumeName: "曾先生",
          profileId: "227359817",
        }),
      ],
    });
    expect(calls).toHaveLength(1);
    expect(calls[0]?.args).toMatchObject({
      resumes: [
        {
          source: "51job-manual",
          externalId: "51job-manual:profile:227359817",
          content: expect.objectContaining({
            name: "曾先生",
            profileType: "51job-manual",
            location: "清远-英德市",
            jobIntention: "客户代表 东莞 全职 8千-1万/月 机械/设备/重工",
            expectedSalary: "8千-1万/月",
            experience: "14年经验",
            education: "高中",
            resumeSnippet: expect.objectContaining({
              text: expect.stringContaining("客户代表\t东莞\t全职\t8千-1万/月\t机械/设备/重工"),
            }),
            workHistory: [
              expect.objectContaining({
                companyName: "东莞市世川机械科技有限公司",
                jobTitle: "客户代表",
                description: "主要负责销售津上设备",
                startDate: "2022-02",
                endDate: "至今",
              }),
            ],
          }),
        },
      ],
    });
  });

  it("prefers salary from the job-intention section over sales totals in the body", async () => {
    const calls: ConvexCall[] = [];
    const documentText = [
      "张先生 在职（一个月内到岗）",
      "38岁\t17年经验\t本科\t现居·东莞-茶山镇\t户口·东莞\t中共预备党员",
      "累计带领团队完成3000万销售额，超额达成既定目标。",
      "求职意向",
      "销售主管\t东莞、广州、深圳\t全职\t1.5-2.8万/月\t船舶/航空/航天、机械/设备/重工",
      "工作经历",
      "东莞市腾信精密制造股份有限公司",
      "2020.09-2025.09（5年）",
      "销售主管",
      "工作描述：负责刀具与高端设备销售。",
    ].join("\n");
    const fileName = "张先生(213422761).docx";

    mockSubmitResumes(calls);

    const formData = new FormData();
    formData.append("files", await createDocxFile(fileName, documentText));

    const response = await requestManualImport(formData);

    expect(response.status).toBe(200);
    expect(calls).toHaveLength(1);
    expect(calls[0]?.args).toMatchObject({
      resumes: [
        {
          source: "51job-manual",
          externalId: "51job-manual:profile:213422761",
          content: expect.objectContaining({
            name: "张先生",
            location: "东莞-茶山镇",
            jobIntention: "销售主管 东莞、广州、深圳 全职 1.5-2.8万/月 船舶/航空/航天、机械/设备/重工",
            expectedSalary: "1.5-2.8万/月",
            experience: "17年经验",
          }),
        },
      ],
    });
  });

  it("extracts unlabeled inline locations from summary profile headers", async () => {
    const calls: ConvexCall[] = [];
    const documentText = [
      "应聘职位：车床/加工中心销售工程师（东莞）",
      "李湘",
      "积极找工作（一个月内到岗）",
      "女 ｜ 25岁 ｜ 东莞-虎门镇 ｜ 6年工作经验 ｜ 普通公民",
      "求职意向",
      "销售 ｜ 8000-11000/月 ｜ 东莞 ｜ 全职",
      "工作经历",
      "东莞汇振精密机械有限公司",
      "2021.04 - 2023.04（2年）",
      "职位：销售",
      "工作描述：在职期间，自主开发成交客户。",
    ].join("\n");
    const fileName = "李湘(962477902).docx";

    mockSubmitResumes(calls);

    const formData = new FormData();
    formData.append("files", await createDocxFile(fileName, documentText));

    const response = await requestManualImport(formData);

    expect(response.status).toBe(200);
    expect(calls).toHaveLength(1);
    expect(calls[0]?.args).toMatchObject({
      resumes: [
        {
          source: "51job-manual",
          externalId: "51job-manual:profile:962477902",
          content: expect.objectContaining({
            name: "李湘",
            location: "东莞-虎门镇",
            jobIntention: "销售 ｜ 8000-11000/月 ｜ 东莞 ｜ 全职",
            expectedSalary: "8000-11000/月",
            experience: "6年工作经验",
          }),
        },
      ],
    });
  });

  it("splits real trailing employer lines during manual import", async () => {
    const calls: ConvexCall[] = [];
    const documentText = [
      "活跃时间：2026.03.18",
      "ID：285286425",
      "董先生",
      "在职（一个月内到岗）",
      "男 ｜ 31岁 ｜ 现居·深圳 ｜ 13年工作经验",
      "工作经历",
      "深圳市金承诺实业有限公司",
      "2021.03 - 至今（5年）",
      "机械/设备/重工",
      "职位：销售工程师",
      "工作描述：",
      "1、负责进口刀具:山特维克，伊斯卡，瓦尔特，肯纳、油品:嘉实多，好富顿，福斯，及机床:马扎克、等产品的销售工作，积极开拓市场，开发新客户，同时维护公司老客户，确保客户关系稳定。",
      "2、任职4年多期间，每年均超额完成公司设定的销售目标，展现出优秀的销售能力和业绩表现。",
      "3、成功维护稳定合作客户超过10家，其中年销售额超100万的中大型客户达2家，为公司带来持续稳定的收入来源。",
      "金合钻石刀具（深圳）有限公司",
      "2016.07 - 2021.02（4年7个月）",
      "汽车零部件",
      "职位：销售专员",
      "工作描述：",
      "1. 2016-2019年负责CNC数控编程与操机、CAD绘图及加工方案设计，熟练掌握五轴数控磨床编程及操机技术，2018年底升任部门生产主管。",
      "2. 2019-2021年专注非标刀具销售，针对3C行业自主开发市场，2020年起每年刀具销售额200万以上，超额达成公司目标，独立开发并维护2家大客户及10多家中型客户。",
      "教育经历",
    ].join("\n");
    const fileName = "董先生(285286425).docx";

    mockSubmitResumes(calls);

    const formData = new FormData();
    formData.append("files", await createDocxFile(fileName, documentText));

    const response = await requestManualImport(formData);

    expect(response.status).toBe(200);
    const submittedResume = getSubmittedResume(calls);
    const content = submittedResume?.content as {
      workHistory?: Array<{ companyName?: string; jobTitle?: string; startDate?: string; endDate?: string; description?: string }>;
    } | undefined;
    expect(content?.workHistory).toEqual([
      expect.objectContaining({
        companyName: "深圳市金承诺实业有限公司",
        jobTitle: "销售工程师",
        startDate: "2021-03",
        endDate: "至今",
      }),
      expect.objectContaining({
        companyName: "金合钻石刀具（深圳）有限公司",
        jobTitle: "销售专员",
        startDate: "2016-07",
        endDate: "2021-02",
      }),
    ]);
    expect(content?.workHistory?.[0]?.description).not.toContain("金合钻石刀具（深圳）有限公司");
  });

  it("dedupes project-augmented duplicate entries during manual import", async () => {
    const calls: ConvexCall[] = [];
    const documentText = [
      "应聘职位：车床/加工中心销售工程师（东莞）",
      "应聘公司：宝力机械有限公司",
      "应聘时间：2023.06.15 - 活跃时间：2023.06.15",
      "ID：962477902",
      "李湘",
      "积极找工作（一个月内到岗）",
      "女 ｜ 25岁 ｜ 东莞-虎门镇 ｜ 6年工作经验 ｜ 普通公民",
      "求职意向",
      "销售 ｜ 8000-11000/月 ｜ 东莞 ｜ 全职",
      "工作经历",
      "东莞汇振精密机械有限公司",
      "2021.04 - 2023.04（2年）",
      "机械/设备/重工 ｜ 少于50人 ｜ 民营",
      "职位：销售",
      "工作描述：",
      "在职期间，自主开发成交客户，维护成交客户。对精密模具，医疗零配件，汽车零配件客户等行业知名客户都有跟进成交（深圳市金大智能有限公司，东莞市达旺精密模具有限公司等），对进出口设备（牧野，罗德斯，雅思达，马扎克）机型和性能有一定了解   （本人有车）",
      "东莞市新法拉数控设备有限公司",
      "2018.01 - 2021.03（3年2个月）",
      "机械/设备/重工 ｜ 50-150人 ｜ 民营",
      "职位：销售经理",
      "工作描述：",
      "主要销售加工中心和加工中心，主要面对佛山片区业务，跟进开发所有佛山客户的成交，设备维护。",
      "广东凌盛科技有限公司",
      "2017.01 - 2018.03（1年2个月）",
      "计算机服务(系统、数据服务、维修) ｜ 少于50人 ｜ 民营",
      "职位：销售代表",
      "工作描述：",
      "通过电话销售向客户介绍我司产品 提升客户排名 增加单品手淘流量",
      "项目经验",
      "手机淘宝推广",
      "2017.01 - 2018.03",
      "所属公司：",
      "广东凌盛科技有限公司",
      "项目描述：",
      "通过电话销售手淘流量 手淘排行",
      "教育经历",
    ].join("\n");
    const fileName = "李湘(962477902).docx";

    mockSubmitResumes(calls);

    const formData = new FormData();
    formData.append("files", await createDocxFile(fileName, documentText));

    const response = await requestManualImport(formData);

    expect(response.status).toBe(200);
    const submittedResume = getSubmittedResume(calls);
    const content = submittedResume?.content as {
      workHistory?: Array<{ companyName?: string; jobTitle?: string; startDate?: string; endDate?: string }>;
    } | undefined;
    expect(content?.workHistory).toEqual([
      expect.objectContaining({
        companyName: "东莞汇振精密机械有限公司",
        jobTitle: "销售",
        startDate: "2021-04",
        endDate: "2023-04",
      }),
      expect.objectContaining({
        companyName: "东莞市新法拉数控设备有限公司",
        jobTitle: "销售经理",
        startDate: "2018-01",
        endDate: "2021-03",
      }),
      expect.objectContaining({
        companyName: "广东凌盛科技有限公司",
        jobTitle: "销售代表",
        startDate: "2017-01",
        endDate: "2018-03",
      }),
    ]);
    expect(content?.workHistory).toHaveLength(3);
  });

  it("repairs malformed manual 51job work history fields", async () => {
    const calls: ConvexCall[] = [];
    const documentText = [
      "活跃时间：2023.10.10",
      "ID：205191062",
      "王先生",
      "观望有好机会会考虑（一个月内到岗）",
      "男 ｜ 26岁 ｜ 东莞 ｜ 6年工作经验 ｜ 共青团员",
      "求职意向",
      "销售代表 ｜ 5000-7000/月 ｜ 东莞 ｜ 全职",
      "工作经历",
      "2018.05 - 2020.11（2年6个月）",
      "职位：销售代表",
      "工作描述：在该公司主要负责以电话开发客户。",
      "长沙冠聚信息技术有限公司",
      "2017.06 - 2018.01（7个月）",
      "职位：电话销售",
      "工作描述：通过公司提供的客户资源进行电话联系。",
    ].join("\n");
    const fileName = "王先生(205191062).docx";

    mockSubmitResumes(calls);

    const formData = new FormData();
    formData.append("files", await createDocxFile(fileName, documentText));

    const response = await requestManualImport(formData);

    expect(response.status).toBe(200);
    expect(calls).toHaveLength(1);
    expect(calls[0]?.args).toMatchObject({
      resumes: [
        {
          source: "51job-manual",
          externalId: "51job-manual:profile:205191062",
          content: expect.objectContaining({
            name: "王先生",
            profileType: "51job-manual",
            workHistory: expect.arrayContaining([
              expect.objectContaining({
                companyName: "长沙冠聚信息技术有限公司",
                jobTitle: "销售代表",
                startDate: "2018-05",
                endDate: "2020-11",
              }),
            ]),
          }),
        },
      ],
    });
  });

  it("skips timeline-only placeholder blocks and resolves labeled project/company work history", async () => {
    const calls: ConvexCall[] = [];
    const documentText = [
      "赖先生",
      "工作经历",
      "2019.06-至今（6年9个月）",
      "项目经验",
      "2019.03 - 2019.06",
      "所属公司：",
      "广州惠挺和数控设备有限公司",
      "项目描述：",
      "新能源汽车空调缸体缸盖机器人自动化生产线交钥匙项目",
      "9台哈挺车床9台哈挺加工中心6台fanuc机器人2台桁架机器人配合自动化年产35万台压缩机调试",
    ].join("\n");
    const fileName = "赖先生(912628720).docx";

    mockSubmitResumes(calls);

    const formData = new FormData();
    formData.append("files", await createDocxFile(fileName, documentText));

    const response = await requestManualImport(formData);

    expect(response.status).toBe(200);
    expect(calls).toHaveLength(1);
    const submittedResume = getSubmittedResume(calls);
    expect(submittedResume).toMatchObject({
      source: "51job-manual",
      externalId: "51job-manual:profile:912628720",
      content: expect.objectContaining({
        name: "赖先生",
        profileType: "51job-manual",
        workHistory: [
          expect.objectContaining({
            companyName: "广州惠挺和数控设备有限公司",
            description: "新能源汽车空调缸体缸盖机器人自动化生产线交钥匙项目 9台哈挺车床9台哈挺加工中心6台fanuc机器人2台桁架机器人配合自动化年产35万台压缩机调试",
            startDate: "2019-03",
            endDate: "2019-06",
          }),
        ],
      }),
    });
    const content = submittedResume?.content as { workHistory?: Array<{ jobTitle?: string }> } | undefined;
    expect(content?.workHistory).toHaveLength(1);
    expect(content?.workHistory?.[0]?.jobTitle).toBeUndefined();
  });

  it("does not promote real project-company lines into job titles during manual import", async () => {
    const calls: ConvexCall[] = [];
    const documentText = [
      "赖先生",
      "工作经历",
      "哈挺机床（上海）有限公司",
      "2021.09 - 至今（4年2个月）",
      "机械/设备/重工 ｜ 150-500人 ｜ 外资（欧美）",
      "职位：销售经理",
      "工作描述：",
      "主要负责哈挺机床在华南区域的销售工作，",
      "1.定期客户拜访，技术交流，订单获取，技术支持，订单跟进，货款收回，",
      "2.经销商的销售支持，机床选型、节拍计算、客户拜访、技术交流、产品打样和工艺方案！帮助经销商完成销售目标",
      "广州数控设备有限公司",
      "2019.07 - 至今（6年4个月）",
      "机械/设备/重工 ｜ 1000-5000人 ｜ 民营",
      "职位：IT技术支持",
      "工作描述：",
      "1、负责广东省（广州部、佛山部、东深部、江珠部）20多位销售经理及代理商的技术支持工作如下：对客户提供的图纸和产品，做技术分析，出加工工艺方案，机床选型，客户拜访、技术交流、产品打样、案例报告等",
      "2、负责机床事业部自动化交钥匙工程机床选型、出加工方案、编程加工、交付、培训（三条自动化产线项目、含一条军工产线项目）",
      "3、负责广东省（深圳展、中山展、珠海展、江门展、佛山展）各展会机床布展、现场加工样件、机床产品特点推广等",
      "广州惠挺和数控设备有限公司",
      "2017.03 - 2019.07（2年4个月）",
      "机械/设备/重工 ｜ 少于50人 ｜ 民营",
      "职位：售前技术支持经理/主管",
      "工作描述：",
      "主要负责美国哈挺机床在华南地区的售前及售后服务；",
      "1.负责（广东、广西、江西、湖南、湖北）8位销售经理及代理商的技术支持工作如下：机床选型、节拍计算、客户拜访、技术交流、产品打样和工艺方案！",
      "2.负责售后技术服务：对客户进行机床、系统操作、数控编程、机床维修保养培训，设备故障维修等",
      "3. 负责过3个以上客户交钥匙工程（包含两个汽车零配件行业自动化上下料项目）：从调试机床-产品加工-CPK验收-培训交付",
      "4.通过电话或现场支持，为客户解决设备、加工出现的问题，包括保内设备的故障维修，保外设备的故障维修等；",
      "卡尔蔡司（广州）太阳镜片有限公司",
      "2014.05 - 2017.03（2年10个月）",
      "机械/设备/重工 ｜ 50-150人 ｜ 外资（欧美）",
      "职位：高级技术员",
      "工作描述：",
      "负责厂内机床设备维修、保养、；",
      "1.空压机，空调，冷水机，注塑机，镀膜机，超声波清洗线，等设备维修保养；",
      "2.配合生产部门制造工装夹具（solidworks ,autocad）设计及加工（车 铣 磨 钳 焊）；",
      "3.编制年、季、月度设备预检计划、设备大中修计划、备件库存和供应计划；",
      "广州市腾马机电设备有限公司",
      "2009.10 - 2013.12（4年2个月）",
      "机械/设备/重工 ｜ 少于50人 ｜ 民营",
      "职位：CNC/数控编程",
      "工作描述：",
      "主要负责工厂机械零件加工生产；",
      "1.熟练使用普通车床数控车床加工及编程；",
      "2.熟练使用普通铣床和数控加工中心操作和编程；",
      "3.熟练使用cad  mastercam  solidworks等软件；",
      "4.有电工证、焊工证、高压电工证、有多年的机械加工工作经验，熟悉机械加工工艺和材料特性；",
      "项目经验",
      "柳州光裕新能源汽车空调有限公司",
      "2019.03 - 2019.06",
      "所属公司：",
      "广州惠挺和数控设备有限公司",
      "项目描述：",
      "新能源汽车空调缸体缸盖机器人自动化生产线交钥匙项目",
      "9台哈挺车床9台哈挺加工中心6台fanuc机器人2台桁架机器人配合自动化年产35万台压缩机调试",
      "教育经历",
    ].join("\n");
    const fileName = "赖先生(916716106).docx";

    mockSubmitResumes(calls);

    const formData = new FormData();
    formData.append("files", await createDocxFile(fileName, documentText));

    const response = await requestManualImport(formData);

    expect(response.status).toBe(200);
    const submittedResume = getSubmittedResume(calls);
    const content = submittedResume?.content as {
      workHistory?: Array<{ companyName?: string; jobTitle?: string; startDate?: string; endDate?: string; description?: string }>;
    } | undefined;
    const projectEntry = content?.workHistory?.find((entry) => entry.startDate === "2019-03" && entry.endDate === "2019-06");

    expect(content?.workHistory).toHaveLength(6);
    expect(projectEntry).toEqual(expect.objectContaining({
      companyName: "广州惠挺和数控设备有限公司",
      description: "新能源汽车空调缸体缸盖机器人自动化生产线交钥匙项目 9台哈挺车床9台哈挺加工中心6台fanuc机器人2台桁架机器人配合自动化年产35万台压缩机调试",
      startDate: "2019-03",
      endDate: "2019-06",
    }));
    expect(projectEntry?.jobTitle).toBeUndefined();
  });

  it("keeps 主要客户 blocks in descriptions without promoting client companies into workHistory.companyName", async () => {
    const calls: ConvexCall[] = [];
    const documentText = [
      "谷仍友",
      "工作经历",
      "2007.08 - 2014.03（6年7个月）",
      "职位：销售总监",
      "工作描述：",
      "主要销售日系，加工中心，车床，磨床，如日本泷泽，日本高松，兄弟机，法那科，LGMAZAK。",
      "工作内容：1，新客户业务开发",
      "主要客户：",
      "肇庆本田金属有限公司，日立汽车系统部件（广州）有限公司",
      "珠海松下马达有限公司，电装（广州南沙）有限公司",
    ].join("\n");
    const fileName = "谷仍友(265281996).docx";

    mockSubmitResumes(calls);

    const formData = new FormData();
    formData.append("files", await createDocxFile(fileName, documentText));

    const response = await requestManualImport(formData);

    expect(response.status).toBe(200);
    expect(calls).toHaveLength(1);
    const submittedResume = getSubmittedResume(calls);
    const content = submittedResume?.content as {
      workHistory?: Array<{ companyName?: string; description?: string; jobTitle?: string }>;
    } | undefined;
    expect(content?.workHistory).toEqual([
      expect.objectContaining({
        jobTitle: "销售总监",
        description: expect.stringContaining("主要客户 肇庆本田金属有限公司"),
      }),
    ]);
    expect(content?.workHistory?.[0]?.description).toContain("珠海松下马达有限公司");
    expect(content?.workHistory?.[0]?.description).toContain("电装 广州南沙 有限公司");
    expect(content?.workHistory?.[0]?.companyName).toBeUndefined();
  });

  it("does not invent missing employers from 应聘公司 headers or customer lists during manual import", async () => {
    const calls: ConvexCall[] = [];
    const documentText = [
      "应聘职位：车床销售工程师（东莞）",
      "应聘公司：宝力机械有限公司",
      "应聘时间：2025.06.03 - 活跃时间：2025.06.03",
      "ID：265281996",
      "仅供招聘专用，企业应尽保密义务，禁止外传",
      "谷仍友",
      "积极找工作（一个月内到岗）",
      "男 ｜ 42岁 ｜ 现居·广州-番禺区 ｜ 18年工作经验",
      "工作经历",
      "广州市振工机电设备有限公司",
      "2014.05 - 至今（11年1个月）",
      "职位：销售总监",
      "工作描述：",
      "主要销售日本津上数控车床，数控走心机，加工中心，外圆磨床，机床周边，刀柄，刀具，切削液销售。",
      "主要客户：",
      "广汽乘用车有限公司",
      "汤浅商事（上海）有限公司广州公司",
      "2007.08 - 2014.03（6年7个月）",
      "机械/设备/重工 ｜ 少于50人 ｜ 外资（非欧美）",
      "职位：销售总监",
      "工作描述：",
      "主要销售日系，加工中心，车床，磨床，如日本泷泽，日本高松，兄弟机，法那科，LGMAZAK。",
      "工作内容：1，新客户业务开发",
      "主要客户：",
      "肇庆本田金属有限公司，日立汽车系统部件（广州）有限公司",
      "珠海松下马达有限公司，电装（广州南沙）有限公司",
      "教育经历",
    ].join("\n");
    const fileName = "谷仍友(265281996).docx";

    mockSubmitResumes(calls);

    const formData = new FormData();
    formData.append("files", await createDocxFile(fileName, documentText));

    const response = await requestManualImport(formData);

    expect(response.status).toBe(200);
    expect(calls).toHaveLength(1);
    const submittedResume = getSubmittedResume(calls);
    const content = submittedResume?.content as {
      workHistory?: Array<{ companyName?: string; description?: string; jobTitle?: string; startDate?: string; endDate?: string }>;
    } | undefined;
    expect(content?.workHistory).toEqual([
      expect.objectContaining({
        companyName: "广州市振工机电设备有限公司",
        jobTitle: "销售总监",
        startDate: "2014-05",
        endDate: "至今",
      }),
      expect.objectContaining({
        jobTitle: "销售总监",
        description: expect.stringContaining("主要客户 肇庆本田金属有限公司"),
        startDate: "2007-08",
        endDate: "2014-03",
      }),
    ]);
    expect(content?.workHistory?.[1]?.companyName).toBeUndefined();
    expect(content?.workHistory?.some((entry) => entry.companyName === "宝力机械有限公司")).toBe(false);
    expect(content?.workHistory?.some((entry) => entry.companyName === "肇庆本田金属有限公司")).toBe(false);
    expect(content?.workHistory?.some((entry) => entry.companyName === "汤浅商事（上海）有限公司广州公司")).toBe(false);
  });

  it("starts a new work entry when the next employer line trails the previous description during manual import", async () => {
    const calls: ConvexCall[] = [];
    const documentText = [
      "唐先生",
      "工作经历",
      "蓝思仪器有限公司",
      "2025.02 - 2025.06（4个月）",
      "医疗设备/器械 ｜ 50-150人 ｜ 民营",
      "职位：销售工程师",
      "工作描述：",
      "对门窗体验箱和气密性仪器进行销售。",
      "通过线上线下的不同渠道，来了解客户的需求，进行对客户的推销",
      "湖南中南智能装备有限公司",
      "2021.09 - 2024.09（3年）",
      "汽车研发/制造 ｜ 150-500人 ｜ 国企",
      "职位：数控车床编程",
      "工作描述：",
      "根据工艺图纸进行基础要求加工，",
      "运用不同的编程程序应用，",
      "来配合不同的零件加工与测量，",
      "最后达到工艺图纸的要求。",
      "教育经历",
    ].join("\n");
    const fileName = "唐先生(286720462).docx";

    mockSubmitResumes(calls);

    const formData = new FormData();
    formData.append("files", await createDocxFile(fileName, documentText));

    const response = await requestManualImport(formData);

    expect(response.status).toBe(200);
    expect(calls).toHaveLength(1);
    const submittedResume = getSubmittedResume(calls);
    const content = submittedResume?.content as {
      workHistory?: Array<{ companyName?: string; description?: string; jobTitle?: string; startDate?: string; endDate?: string }>;
    } | undefined;
    expect(content?.workHistory).toEqual([
      expect.objectContaining({
        companyName: "蓝思仪器有限公司",
        jobTitle: "销售工程师",
        startDate: "2025-02",
        endDate: "2025-06",
      }),
      expect.objectContaining({
        companyName: "湖南中南智能装备有限公司",
        jobTitle: "数控车床编程",
        startDate: "2021-09",
        endDate: "2024-09",
      }),
    ]);
    expect(content?.workHistory?.[0]?.description).not.toContain("湖南中南智能装备有限公司");
  });

  it("dedupes repeated summary-style work entries during manual import", async () => {
    const calls: ConvexCall[] = [];
    const documentText = [
      "石文艺",
      "工作经历",
      "深圳中扬数控科技有限公司",
      "2022.12 - 2024.05（1年5个月）",
      "机械/设备/重工",
      "职位：销售经理",
      "工作描述：",
      "在中扬数控有着不错的业绩，T6钻攻机，车铣复合机，龙门加工中心，都有出机！",
      "深圳中扬数控科技有限公司",
      "2022.12 - 2024.05（1年5个月）",
      "机械/设备/重工",
      "职位：销售经理",
      "工作描述：",
      "工作描述:",
      "在中扬数控有着不错的业绩,T6钻攻机,车铣复合机,龙门加工中心,都有出机!",
    ].join("\n");
    const fileName = "石文艺(293834293).docx";

    mockSubmitResumes(calls);

    const formData = new FormData();
    formData.append("files", await createDocxFile(fileName, documentText));

    const response = await requestManualImport(formData);

    expect(response.status).toBe(200);
    const submittedResume = getSubmittedResume(calls);
    const content = submittedResume?.content as {
      workHistory?: Array<{ companyName?: string; jobTitle?: string; startDate?: string; endDate?: string }>;
    } | undefined;
    expect(content?.workHistory?.filter((entry) => entry.startDate === "2022-12" && entry.endDate === "2024-05")).toHaveLength(1);
    expect(content?.workHistory?.[0]).toEqual(expect.objectContaining({
      companyName: "深圳中扬数控科技有限公司",
      jobTitle: "销售经理",
      startDate: "2022-12",
      endDate: "2024-05",
    }));
  });

  it("falls back to 岗位经验 when 工作经历 only has placeholder lines", async () => {
    const calls: ConvexCall[] = [];
    const documentText = [
      "曾先生 积极找工作（一个月内到岗）",
      "36岁\t14年经验\t高中\t现居·清远-英德市",
      "工作经历",
      "2022.02-至今（4年1个月）",
      "走心机",
      "岗位经验",
      "东莞市世川机械科技有限公司\t客户代表",
      "机械/设备/重工 | 少于50人 | 民营",
      "1.主要负责销售津上设备，车床，加工中心。",
      "教育经历",
    ].join("\n");
    const fileName = "曾先生(227359817).docx";

    mockSubmitResumes(calls);

    const formData = new FormData();
    formData.append("files", await createDocxFile(fileName, documentText));

    const response = await requestManualImport(formData);

    expect(response.status).toBe(200);
    const submittedResume = getSubmittedResume(calls);
    const content = submittedResume?.content as {
      workHistory?: Array<{ companyName?: string; jobTitle?: string }>;
    } | undefined;
    expect(content?.workHistory).toEqual([
      expect.objectContaining({
        companyName: "东莞市世川机械科技有限公司",
        jobTitle: "客户代表",
      }),
    ]);
  });

  it("rebuilds structured work history from 岗位经验 plus timeline placeholders", async () => {
    const calls: ConvexCall[] = [];
    const documentText = [
      "曾先生 积极找工作（一个月内到岗）",
      "36岁\t14年经验\t高中\t现居·清远-英德市",
      "工作经历",
      "2022.02-至今（4年1个月）",
      "走心机",
      "2020.02-2021.12（1年10个月）",
      "东莞莞建强有限公司 客户代表",
      "2017.02-2020.09（3年7个月）",
      "广东大川机械有限公司 销售",
      "岗位经验",
      "东莞市世川机械科技有限公司\t客户代表",
      "东莞莞建强有限公司\t客户代表",
      "广东大川机械有限公司\t销售",
      "教育经历",
    ].join("\n");
    const fileName = "曾先生(227359817).docx";

    mockSubmitResumes(calls);

    const formData = new FormData();
    formData.append("files", await createDocxFile(fileName, documentText));

    const response = await requestManualImport(formData);

    expect(response.status).toBe(200);
    const submittedResume = getSubmittedResume(calls);
    const content = submittedResume?.content as {
      workHistory?: Array<{ companyName?: string; jobTitle?: string; startDate?: string; endDate?: string }>;
    } | undefined;
    expect(content?.workHistory).toEqual([
      expect.objectContaining({
        companyName: "东莞市世川机械科技有限公司",
        jobTitle: "客户代表",
        startDate: "2022-02",
        endDate: "至今",
      }),
      expect.objectContaining({
        companyName: "东莞莞建强有限公司",
        jobTitle: "客户代表",
        startDate: "2020-02",
        endDate: "2021-12",
      }),
      expect.objectContaining({
        companyName: "广东大川机械有限公司",
        jobTitle: "销售",
        startDate: "2017-02",
        endDate: "2020-09",
      }),
    ]);
  });

  it("dedupes augmenting project blocks when a richer work entry already exists", async () => {
    const calls: ConvexCall[] = [];
    const documentText = [
      "李湘",
      "工作经历",
      "广东凌盛科技有限公司",
      "2017.01 - 2018.03（1年2个月）",
      "计算机服务(系统、数据服务、维修) ｜ 少于50人 ｜ 民营",
      "职位：销售代表",
      "工作描述：",
      "通过电话销售向客户介绍我司产品 提升客户排名 增加单品手淘流量",
      "项目经验",
      "手机淘宝推广",
      "2017.01 - 2018.03",
      "所属公司：",
      "广东凌盛科技有限公司",
      "项目描述：",
      "通过电话销售手淘流量 手淘排行",
    ].join("\n");
    const fileName = "李湘(962477902).docx";

    mockSubmitResumes(calls);

    const formData = new FormData();
    formData.append("files", await createDocxFile(fileName, documentText));

    const response = await requestManualImport(formData);

    expect(response.status).toBe(200);
    const submittedResume = getSubmittedResume(calls);
    const content = submittedResume?.content as {
      workHistory?: Array<{ companyName?: string; jobTitle?: string; description?: string; startDate?: string; endDate?: string }>;
    } | undefined;
    expect(content?.workHistory).toEqual([
      expect.objectContaining({
        companyName: "广东凌盛科技有限公司",
        jobTitle: "销售代表",
        description: expect.stringContaining("通过电话销售向客户介绍我司产品"),
        startDate: "2017-01",
        endDate: "2018-03",
      }),
    ]);
  });

  it("rebuilds longer timeline-only histories from 岗位经验 summaries", async () => {
    const calls: ConvexCall[] = [];
    const documentText = [
      "/",
      "陈先生 离职（一周内到岗）",
      "岗位经验\tCNC/数控编程-8年4个月\t销售主管-3年3个月\t销售专员-1年",
      "广州市昊志机电股份有限公司\t编程操机",
      "500-1000人 | 已上市",
      "北京苏扬科技有限公司\t销售主管",
      "北京联龙博通电子商务技术有限公司\t销售专员",
      "深圳市聚精自动化设备有限公司\tcnc数控编程",
      "日东科技控股有限公司\tCNC/数控编程",
      "工作经历",
      "加工中心\t2025.05-2025.07（2个月）",
      "2022.01-2025.04（3年3个月）",
      "2021.01-2022.01（1年）",
      "2017.04-2020.12（3年8个月）",
      "加工中心",
      "2012.09-2017.03（4年6个月）",
      "教育经历",
    ].join("\n");
    const fileName = "陈先生(974815269).docx";

    mockSubmitResumes(calls);

    const formData = new FormData();
    formData.append("files", await createDocxFile(fileName, documentText));

    const response = await requestManualImport(formData);

    expect(response.status).toBe(200);
    const submittedResume = getSubmittedResume(calls);
    const content = submittedResume?.content as {
      workHistory?: Array<{ companyName?: string; jobTitle?: string; startDate?: string; endDate?: string }>;
    } | undefined;
    expect(content?.workHistory).toEqual([
      expect.objectContaining({
        companyName: "广州市昊志机电股份有限公司",
        jobTitle: "编程操机",
        startDate: "2025-05",
        endDate: "2025-07",
      }),
      expect.objectContaining({
        companyName: "北京苏扬科技有限公司",
        jobTitle: "销售主管",
        startDate: "2022-01",
        endDate: "2025-04",
      }),
      expect.objectContaining({
        companyName: "北京联龙博通电子商务技术有限公司",
        jobTitle: "销售专员",
        startDate: "2021-01",
        endDate: "2022-01",
      }),
      expect.objectContaining({
        companyName: "深圳市聚精自动化设备有限公司",
        jobTitle: "cnc数控编程",
        startDate: "2017-04",
        endDate: "2020-12",
      }),
      expect.objectContaining({
        companyName: "日东科技控股有限公司",
        jobTitle: "CNC/数控编程",
        startDate: "2012-09",
        endDate: "2017-03",
      }),
    ]);
  });

  it("rebuilds 岗位经验 timelines when the summary includes 系长 titles", async () => {
    const calls: ConvexCall[] = [];
    const documentText = [
      "/",
      "罗先生 离职（一周内到岗）",
      "岗位经验\t客户经理/主管-4年\t销售经理-1年11个月\t销售工程师-2年11个月\t建筑工程管理/项目经理-7年\t生产主管-2年",
      "米思米（中国）精密机械贸易有限公司\t客户经理/主管",
      "深圳市创世纪机械有限公司\t销售经理",
      "深圳硕方精密机械有限公司\t销售工程师",
      "佛山市铭晖投资有限公司\t工程主管",
      "佛山市华鹭自动控制器有限公司\t系长",
      "工作经历",
      "2022.03-至今（4年）",
      "2020.02-2022.01（1年11个月）",
      "走心机",
      "2017.02-2020.01（2年11个月）",
      "走心机",
      "2009.08-2016.08（7年）",
      "2007.07-2009.07（2年）",
      "教育经历",
    ].join("\n");
    const fileName = "罗先生(77205240).docx";

    mockSubmitResumes(calls);

    const formData = new FormData();
    formData.append("files", await createDocxFile(fileName, documentText));

    const response = await requestManualImport(formData);

    expect(response.status).toBe(200);
    const submittedResume = getSubmittedResume(calls);
    const content = submittedResume?.content as {
      workHistory?: Array<{ companyName?: string; jobTitle?: string; startDate?: string; endDate?: string }>;
    } | undefined;
    expect(content?.workHistory).toEqual([
      expect.objectContaining({
        companyName: "米思米（中国）精密机械贸易有限公司",
        jobTitle: "客户经理/主管",
        startDate: "2022-03",
        endDate: "至今",
      }),
      expect.objectContaining({
        companyName: "深圳市创世纪机械有限公司",
        jobTitle: "销售经理",
        startDate: "2020-02",
        endDate: "2022-01",
      }),
      expect.objectContaining({
        companyName: "深圳硕方精密机械有限公司",
        jobTitle: "销售工程师",
        startDate: "2017-02",
        endDate: "2020-01",
      }),
      expect.objectContaining({
        companyName: "佛山市铭晖投资有限公司",
        jobTitle: "工程主管",
        startDate: "2009-08",
        endDate: "2016-08",
      }),
      expect.objectContaining({
        companyName: "佛山市华鹭自动控制器有限公司",
        jobTitle: "系长",
        startDate: "2007-07",
        endDate: "2009-07",
      }),
    ]);
  });

  it("keeps 余先生 岗位经验 detail text when timeline placeholders rebuild the same entry", async () => {
    const calls: ConvexCall[] = [];
    const documentText = [
      "/",
      "2025-11-03",
      "余先生 在职（一个月内到岗）",
      "28岁\t7年经验\t本科\t现居·东莞-大岭山镇",
      "岗位经验\t销售工程师-6年9个月",
      "佛山友博机电科技有限公司\t销售工程师",
      "机械/设备/重工 | 少于50人 | 创业公司",
      "一、工作内容",
      "该公司销售的主要产品是 CNC 数控机床，本人担任销售工程师的职位。",
      "主要工作内容为：",
      "1.寻找和联系潜在客户",
      "2.预约拜访潜在客户",
      "3. 挖掘客户需求和了解采购计划",
      "4.为客户产品选型提供方案",
      "5.合同的签订和设备的发货以及货款的回收跟进",
      "6.定期回访了解客户设备使用情况以及后期的采购计划",
      "二、工作职责",
      "1.寻找精准的目标客户：通过渠道搜素精准的目标客户，例如渠道有百度搜索、展会、展厅、抖音、地推等各个渠道。",
      "2.规划和跟进客户群：对收集来的客户进行区域和行业的精细划分。联系和拜访潜在客户，挖掘客户需求并跟进为客户提供方案。",
      "3.订单的签订和后期的客户维系：客户确定订单，跟进发货和货款的回收，定期回访客户，了解设备使用情况和后期的设备采购计划",
      "求职意向",
      "销售工程师\t东莞、深圳\t全职\t1.2-1.5万/月",
      "工作经历",
      "2019.06-至今（6年9个月）",
      "项目经验",
      "教育经历",
    ].join("\n");
    const fileName = "余先生(912628720).docx";

    mockSubmitResumes(calls);

    const formData = new FormData();
    formData.append("files", await createDocxFile(fileName, documentText));

    const response = await requestManualImport(formData);

    expect(response.status).toBe(200);
    const submittedResume = getSubmittedResume(calls);
    const content = submittedResume?.content as {
      workHistory?: Array<{ companyName?: string; jobTitle?: string; description?: string; startDate?: string; endDate?: string }>;
    } | undefined;
    expect(content?.workHistory).toEqual([
      expect.objectContaining({
        companyName: "佛山友博机电科技有限公司",
        jobTitle: "销售工程师",
        startDate: "2019-06",
        endDate: "至今",
        description: expect.stringContaining("该公司销售的主要产品是 CNC 数控机床"),
      }),
    ]);
    expect(content?.workHistory?.[0]?.description).toContain("1.寻找和联系潜在客户");
  });

  it("rebuilds noisy multi-page 李先生 work history during direct import", async () => {
    const calls: ConvexCall[] = [];
    const documentText = [
      "/",
      "李先生 在职（到岗时间待定）",
      "35岁\t18年经验\t大专\t现居·东莞-南城区",
      "岗位经验\tCNC/数控编程-3年7个月\t生产主管-4年5个月\t生产经理/车间主任-1年8个月\t生产领班/组长-2年11个月",
      "CNC/数控操机-2年1个月\t客户代表-9个月\t仓库管理员-3个月\t理货员-5个月",
      "先进电子（珠海）有限公司\tCNC高级工程师",
      "主要负责数控车床与车铣复合和\t产品优化，程序优化，调机优化与产品工艺优化等。",
      "德玛电子有限公司\tCNC主管",
      "人才ID:974495233\t活跃时间:2026.03.16",
      "求职意向",
      "工作经历",
      "2024.07-2025.01（6个月）",
      "走心机",
      "2021.01-2024.06（3年5个月）",
      "广州宝力机械科技有限公司东莞分公司",
      "广州宝力机械科技有限公司东莞分公司",
      "聊",
      "天",
      "-- 1 of 3 --",
      "/",
      "沃克森模具有限公司\t机加车间主任",
      "东莞永耀传动科技有限公司\tCNC主管",
      "东莞培锋精密机械有限公司\tCNC/数控编程",
      "东莞卓蓝自动化有限公司\t组长",
      "宁波市鄞州佳祺电子制造有限公司\t数控车床",
      "东莞万田油墨有限公司\t客户代表",
      "2019.05-2021.01（1年8个月）",
      "2018.05-2019.05（1年）",
      "2015.03-2018.04（3年1个月）",
      "2012.03-2015.02（2年11个月）",
      "2010.01-2012.02（2年1个月）",
      "2009.04-2010.01（9个月）",
      "聊",
      "天",
      "-- 2 of 3 --",
      "/",
      "南良集团\t仓库管理员",
      "惠州响水河超市\t营业员",
      "广东南方职业学院",
      "大专 · 机电一体化技术",
      "2024.03-2026.07",
      "湛江艺术学校",
      "中技/中专 · 声乐",
      "2006.08-2008.05",
      "2008.12-2009.03（3个月）",
      "2008.07-2008.12（5个月）",
      "教育经历",
    ].join("\n");
    const fileName = "李先生(974495233).docx";

    mockSubmitResumes(calls);

    const formData = new FormData();
    formData.append("files", await createDocxFile(fileName, documentText));

    const response = await requestManualImport(formData);

    expect(response.status).toBe(200);
    const submittedResume = getSubmittedResume(calls);
    const content = submittedResume?.content as {
      workHistory?: Array<{ companyName?: string; jobTitle?: string; startDate?: string; endDate?: string }>;
    } | undefined;
    expect(content?.workHistory).toEqual([
      expect.objectContaining({
        companyName: "先进电子（珠海）有限公司",
        jobTitle: "CNC高级工程师",
        startDate: "2024-07",
        endDate: "2025-01",
      }),
      expect.objectContaining({
        companyName: "德玛电子有限公司",
        jobTitle: "CNC主管",
        startDate: "2021-01",
        endDate: "2024-06",
      }),
      expect.objectContaining({
        companyName: "沃克森模具有限公司",
        jobTitle: "机加车间主任",
        startDate: "2019-05",
        endDate: "2021-01",
      }),
      expect.objectContaining({
        companyName: "东莞永耀传动科技有限公司",
        jobTitle: "CNC主管",
        startDate: "2018-05",
        endDate: "2019-05",
      }),
      expect.objectContaining({
        companyName: "东莞培锋精密机械有限公司",
        jobTitle: "CNC/数控编程",
        startDate: "2015-03",
        endDate: "2018-04",
      }),
      expect.objectContaining({
        companyName: "东莞卓蓝自动化有限公司",
        jobTitle: "组长",
        startDate: "2012-03",
        endDate: "2015-02",
      }),
      expect.objectContaining({
        companyName: "宁波市鄞州佳祺电子制造有限公司",
        jobTitle: "数控车床",
        startDate: "2010-01",
        endDate: "2012-02",
      }),
      expect.objectContaining({
        companyName: "东莞万田油墨有限公司",
        jobTitle: "客户代表",
        startDate: "2009-04",
        endDate: "2010-01",
      }),
      expect.objectContaining({
        companyName: "南良集团",
        jobTitle: "仓库管理员",
        startDate: "2008-12",
        endDate: "2009-03",
      }),
      expect.objectContaining({
        companyName: "惠州响水河超市",
        jobTitle: "营业员",
        startDate: "2008-07",
        endDate: "2008-12",
      }),
    ]);
    expect(content?.workHistory).toHaveLength(10);
    expect(content?.workHistory?.some((entry) => entry.companyName === "广州宝力机械科技有限公司东莞分公司")).toBe(false);
    expect(content?.workHistory?.some((entry) => entry.jobTitle === "走心机")).toBe(false);
    expect(content?.workHistory?.some((entry) => entry.companyName === "广东南方职业学院")).toBe(false);
  });

  it("returns partial success for mixed supported and unsupported uploads", async () => {
    const calls: ConvexCall[] = [];

    mockSubmitResumes(calls);

    const formData = new FormData();
    formData.append("files", await createDocxFile("51job_李四(654321).docx", "李四 销售经理"));
    formData.append("files", new File(["notes"], "notes.txt", { type: "text/plain" }));
    formData.append("keyword", "销售经理");

    const response = await requestManualImport(formData);

    expect(response.status).toBe(200);
    const payload = await response.json();
    expect(payload).toMatchObject({
      success: true,
      summary: {
        uploadedFiles: 2,
        discoveredFiles: 2,
        parsedResumes: 1,
        imported: 1,
        skipped: 1,
        failed: 0,
      },
      files: [
        expect.objectContaining({
          entryPath: "51job_李四(654321).docx",
          status: "imported",
          profileId: "654321",
        }),
        expect.objectContaining({
          entryPath: "notes.txt",
          status: "skipped",
          error: "Unsupported file type",
        }),
      ],
    });
    expect(calls).toHaveLength(1);
  });

  it("returns 400 when no files are uploaded", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch");

    const formData = new FormData();
    const response = await requestManualImport(formData);

    expect(response.status).toBe(400);
    const body = await parseJsonBody<{ success: unknown; error: { name?: string } }>(response);
    expect(body.success).toBe(false);
    // zod v4 validation error from OpenAPI layer — handler's safeParse is unreachable
    expect(body.error).toMatchObject({ name: "ZodError" });
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("keeps the legacy JSON import route admin-only", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    const app = await createTestApp("user");

    const response = await app.request("/api/resumes/import", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Workspace-Slug": "hr",
      },
      body: JSON.stringify({
        metadata: {
          sourceUrl: "https://www.51job.com/",
          generatedBy: "manual-resume-import@1.0.0",
        },
        resumes: [
          {
            name: "张三",
          },
        ],
      }),
    });

    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({
      success: false,
      error: "Admin access required",
    });
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});
