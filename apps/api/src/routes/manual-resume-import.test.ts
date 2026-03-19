import { OpenAPIHono } from "@hono/zod-openapi";
import JSZip from "jszip";
import { afterEach, describe, expect, it, vi } from "vitest";

import { workspaceMiddleware } from "../middleware/workspace";

type ConvexCall = {
  pathName: string;
  args: Record<string, unknown>;
};

async function createTestApp() {
  const { default: resumesRoutes } = await import("./resumes");
  const app = new OpenAPIHono();
  app.use("*", workspaceMiddleware);
  app.route("/", resumesRoutes);
  return app;
}

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

  const buffer = await zip.generateAsync({ type: "uint8array" });
  return new File([buffer], name, { type: "application/vnd.openxmlformats-officedocument.wordprocessingml.document" });
}

async function expectUnreadablePdfUploadFailure(options: {
  fileName: string;
  extractedText: string;
}) {
  const fetchSpy = vi.spyOn(globalThis, "fetch");
  const destroy = vi.fn(async () => undefined);

  vi.doMock("pdf-parse", () => ({
    PDFParse: vi.fn().mockImplementation(() => ({
      getText: vi.fn(async () => ({ text: options.extractedText })),
      destroy,
    })),
  }));

  const app = await createTestApp();
  const formData = new FormData();
  formData.append("files", new File([new Uint8Array([0x25, 0x50, 0x44, 0x46])], options.fileName, {
    type: "application/pdf",
  }));

  const response = await app.request("/api/resumes/manual-import", {
    method: "POST",
    headers: {
      "X-Workspace-Slug": "hr",
    },
    body: formData,
  });

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

    const app = await createTestApp();
    const formData = new FormData();
    formData.append("files", await createDocxFile("51job_张三(123456).docx", documentText));
    formData.append("keyword", "销售工程师");

    const response = await app.request("/api/resumes/manual-import", {
      method: "POST",
      headers: {
        "X-Workspace-Slug": "hr",
      },
      body: formData,
    });

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
    const submittedResume = (calls[0]?.args.resumes as Array<Record<string, unknown>> | undefined)?.[0];
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

    const app = await createTestApp();
    const formData = new FormData();
    formData.append("files", await createDocxFile(fallbackFileName, fallbackText));

    const response = await app.request("/api/resumes/manual-import", {
      method: "POST",
      headers: {
        "X-Workspace-Slug": "hr",
      },
      body: formData,
    });

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

    const app = await createTestApp();
    const formData = new FormData();
    formData.append("files", await createDocxFile(fileName, documentText));

    const response = await app.request("/api/resumes/manual-import", {
      method: "POST",
      headers: {
        "X-Workspace-Slug": "hr",
      },
      body: formData,
    });

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

    const app = await createTestApp();
    const formData = new FormData();
    formData.append("files", await createDocxFile(fileName, documentText));

    const response = await app.request("/api/resumes/manual-import", {
      method: "POST",
      headers: {
        "X-Workspace-Slug": "hr",
      },
      body: formData,
    });

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

    const app = await createTestApp();
    const formData = new FormData();
    formData.append("files", await createDocxFile(fileName, documentText));

    const response = await app.request("/api/resumes/manual-import", {
      method: "POST",
      headers: {
        "X-Workspace-Slug": "hr",
      },
      body: formData,
    });

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

    const app = await createTestApp();
    const formData = new FormData();
    formData.append("files", await createDocxFile(fileName, documentText));

    const response = await app.request("/api/resumes/manual-import", {
      method: "POST",
      headers: {
        "X-Workspace-Slug": "hr",
      },
      body: formData,
    });

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

  it("returns partial success for mixed supported and unsupported uploads", async () => {
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

    const app = await createTestApp();
    const formData = new FormData();
    formData.append("files", await createDocxFile("51job_李四(654321).docx", "李四 销售经理"));
    formData.append("files", new File(["notes"], "notes.txt", { type: "text/plain" }));
    formData.append("keyword", "销售经理");

    const response = await app.request("/api/resumes/manual-import", {
      method: "POST",
      headers: {
        "X-Workspace-Slug": "hr",
      },
      body: formData,
    });

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
    const app = await createTestApp();

    const formData = new FormData();
    const response = await app.request("/api/resumes/manual-import", {
      method: "POST",
      headers: {
        "X-Workspace-Slug": "hr",
      },
      body: formData,
    });

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({
      success: false,
      error: "Expected at least one uploaded file",
    });
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("keeps the legacy JSON import route admin-only", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    const app = await createTestApp();

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
