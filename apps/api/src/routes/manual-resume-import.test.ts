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
    <w:p><w:r><w:t>${text}</w:t></w:r></w:p>
  </w:body>
</w:document>`);

  const buffer = await zip.generateAsync({ type: "uint8array" });
  return new File([buffer], name, { type: "application/vnd.openxmlformats-officedocument.wordprocessingml.document" });
}

describe("manual resume import route", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.doUnmock("mammoth");
    vi.resetModules();
  });

  it("allows hr workspace users to upload direct DOCX resumes", async () => {
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
    formData.append("files", await createDocxFile("51job_张三(123456).docx", "张三 销售工程师 CNC"));
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
    expect(calls[0]?.args).toMatchObject({
      resumes: [
        {
          source: "51job-manual",
          externalId: "51job-manual:profile:123456",
          tags: ["销售工程师"],
          content: expect.objectContaining({
            name: "张三",
            profileType: "51job-manual",
            selfIntro: "张三 销售工程师 CNC",
            resumeSnippet: { text: "张三 销售工程师 CNC" },
          }),
        },
      ],
    });
  });

  it("imports malformed 51job DOCX files via fallback XML extraction", async () => {
    const calls: ConvexCall[] = [];
    const fallbackText = [
      "王某",
      "人才ID: 987654321",
      "对门窗体验箱和气密性仪器进行销售",
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
            selfIntro: fallbackText,
            resumeSnippet: { text: fallbackText },
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
