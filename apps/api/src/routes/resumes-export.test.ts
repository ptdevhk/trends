import ExcelJS from "exceljs";
import Papa from "papaparse";
import { afterEach, describe, expect, it, vi } from "vitest";

import { createApp } from "../app";
import { ResumeService } from "../services/resume-service";

import type { ResumeItem } from "../types/resume";

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

  if (!requestUrl.includes("/api/query")) {
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
    }
  );
}

function buildSampleResume(overrides: Partial<ResumeItem> & { resumeId: string; name: string }): ResumeItem {
  return {
    resumeId: overrides.resumeId,
    name: overrides.name,
    profileUrl: overrides.profileUrl ?? `https://example.com/${overrides.resumeId}`,
    activityStatus: overrides.activityStatus ?? "Active",
    age: overrides.age ?? "30",
    experience: overrides.experience ?? "5 years",
    education: overrides.education ?? "Bachelor",
    location: overrides.location ?? "Dongguan",
    selfIntro: overrides.selfIntro ?? "Test intro",
    jobIntention: overrides.jobIntention ?? "Sales Engineer",
    expectedSalary: overrides.expectedSalary ?? "10k-20k",
    workHistory: overrides.workHistory ?? [{ raw: "Test work history" }],
    extractedAt: overrides.extractedAt ?? "2026-03-01T00:00:00.000Z",
    perUserId: overrides.perUserId,
    profileId: overrides.profileId,
    profileType: overrides.profileType,
    externalId: overrides.externalId,
    profileEducation: overrides.profileEducation,
    skills: overrides.skills,
    languages: overrides.languages,
    licences: overrides.licences,
    resumeSnippet: overrides.resumeSnippet,
    currentIndustry: overrides.currentIndustry,
    currentSubindustry: overrides.currentSubindustry,
    rightToWork: overrides.rightToWork,
    digitalIdentity: overrides.digitalIdentity,
    noticePeriodDays: overrides.noticePeriodDays,
    ingestData: overrides.ingestData,
  };
}

function expectAttachmentHeaders(response: Response, extension: "csv" | "xlsx") {
  expect(response.headers.get("content-type")).toBe(
    extension === "csv"
      ? "text/csv; charset=utf-8"
      : "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
  );
  expect(response.headers.get("content-disposition")).toMatch(
    extension === "csv"
      ? /^attachment; filename="resumes-export-.+\.csv"$/
      : /^attachment; filename="resumes-export-.+\.xlsx"$/
  );
  expect(response.headers.get("cache-control")).toBe("no-store");
  expect(response.headers.get("content-length")).toBeTruthy();
}

function findColumnIndex(sheet: ExcelJS.Worksheet | undefined, header: string): number {
  if (!sheet) {
    return -1;
  }

  const headers = (sheet.getRow(1).values as unknown[]) ?? [];
  return headers.findIndex((value) => value === header);
}

describe("resume export route", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("exports sample-backed requests by resumeId and preserves request order", async () => {
    vi.spyOn(ResumeService.prototype, "loadSample").mockReturnValue({
      items: [
        buildSampleResume({
          resumeId: "resume-a",
          name: "Alice",
          ingestData: {
            industryTags: ["sales"],
            brandHits: [
              {
                brand: "fanuc",
                role: "equipment",
                source: "workHistory",
                context: "equipment",
              },
            ],
            companyHits: ["fanuc"],
          },
        }),
        buildSampleResume({ resumeId: "resume-b", name: "Bob" }),
      ],
      sample: {
        name: "sample-test",
        filename: "sample-test.json",
        updatedAt: "2026-03-01T00:00:00.000Z",
        size: 1,
      },
      metadata: undefined,
      indexes: new Map(),
    });

    const app = createApp();
    const response = await app.request("/api/resumes/export", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        format: "csv",
        source: "sample",
        sample: "sample-test",
        entries: [
          { resumeId: "resume-b", status: "contacted", userComment: "Call Bob" },
          { resumeId: "resume-a", status: "new" },
        ],
      }),
    });

    expect(response.status).toBe(200);
    expectAttachmentHeaders(response, "csv");
    const parsed = Papa.parse<Record<string, string>>(await response.text(), { header: true });
    expect(parsed.data[0]?.resumeId).toBe("resume-b");
    expect(parsed.data[0]?.name).toBe("Bob");
    expect(parsed.data[0]?.userComment).toBe("Call Bob");
    expect(parsed.data[1]?.resumeId).toBe("resume-a");
    expect(parsed.data[1]?.name).toBe("Alice");
    expect(parsed.data[1]?.brandHits).toBe("发那科");
  });

  it("exports sample-backed brand hits as names-only summaries with alias dedupe", async () => {
    vi.spyOn(ResumeService.prototype, "loadSample").mockReturnValue({
      items: [
        buildSampleResume({
          resumeId: "resume-brand",
          name: "Brand Candidate",
          ingestData: {
            industryTags: ["sales"],
            brandHits: [
              {
                brand: "fanuc",
                role: "equipment",
                source: "workHistory",
                context: "equipment",
              },
              {
                brand: "发那科",
                role: "equipment",
                source: "selfIntro",
                context: "sales",
              },
              {
                brand: "mitsubishi",
                role: "equipment",
                source: "workHistory",
                context: "technical",
              },
            ],
            companyHits: ["fanuc"],
          },
        }),
      ],
      sample: {
        name: "sample-test",
        filename: "sample-test.json",
        updatedAt: "2026-03-01T00:00:00.000Z",
        size: 1,
      },
      metadata: undefined,
      indexes: new Map(),
    });

    const app = createApp();
    const response = await app.request("/api/resumes/export", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        format: "csv",
        source: "sample",
        sample: "sample-test",
        entries: [{ resumeId: "resume-brand", status: "new" }],
      }),
    });

    expect(response.status).toBe(200);
    const parsed = Papa.parse<Record<string, string>>(await response.text(), { header: true });
    expect(parsed.data[0]?.brandHits).toBe("发那科, 三菱");
  });

  it("exports convex-backed requests via server-side Convex resolution", async () => {
    const calls: ConvexCall[] = [];
    vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
      const call = parseConvexCall(input, init);
      calls.push(call);
      if (call.pathName === "resumes:getByIdsForExport") {
        return convexSuccess([
          {
            resumeId: "convex-a",
            resume: {
              name: "Alice",
              age: "30",
              experience: "5 years",
              education: "Bachelor",
              location: "Dongguan",
              jobIntention: "Sales",
              expectedSalary: "10k-20k",
              selfIntro: "Intro A",
              profileUrl: "https://example.com/a",
              source: "seek",
              workHistory: [{ raw: "Alice history" }],
              ingestData: {
                industryTags: ["machinery"],
                industryDbV2Raw: 25,
                brandHits: [
                  {
                    brand: "fanuc",
                    role: "equipment",
                    source: "workHistory",
                    context: "equipment",
                  },
                  {
                    brand: "发那科",
                    role: "equipment",
                    source: "selfIntro",
                    context: "sales",
                  },
                ],
                companyHits: ["fanuc"],
              },
            },
          },
          {
            resumeId: "convex-b",
            resume: {
              name: "Bob",
              age: "32",
              experience: "6 years",
              education: "Bachelor",
              location: "Shenzhen",
              jobIntention: "Sales",
              expectedSalary: "12k-24k",
              selfIntro: "Intro B",
              profileUrl: "https://example.com/b",
              source: "seek",
              workHistory: [{ raw: "Bob history" }],
              ingestData: {
                industryDbV2Raw: 20,
              },
            },
          },
        ]);
      }
      throw new Error(`Unexpected convex path: ${call.pathName}`);
    });

    const app = createApp();
    const response = await app.request("/api/resumes/export", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        format: "xlsx",
        source: "convex",
        debug: true,
        industryDbV2Stats: {
          size: 50,
          p80: 20,
          histogram50: Array.from({ length: 51 }, (_, index) => {
            if (index === 20) return 40;
            if (index === 25) return 10;
            return 0;
          }),
        },
        entries: [
          { resumeId: "convex-b", status: "contacted" },
          { resumeId: "convex-a", status: "new" },
        ],
      }),
    });

    expect(response.status).toBe(200);
    expectAttachmentHeaders(response, "xlsx");
    expect(calls).toHaveLength(1);
    expect(calls[0]).toMatchObject({
      pathName: "resumes:getByIdsForExport",
      args: {
        resumeIds: ["convex-b", "convex-a"],
      },
    });

    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(Buffer.from(await response.arrayBuffer()));
    const sheet = workbook.getWorksheet("Resumes");
    const brandHitsColumn = findColumnIndex(sheet, "Brand Hits");
    const industryDbColumn = findColumnIndex(sheet, "Industry DB");
    const industryDbRawColumn = findColumnIndex(sheet, "Industry DB V2 Raw");
    const industryDbNormalizedColumn = findColumnIndex(sheet, "Industry DB V2 Normalized");
    expect(sheet?.getCell("A2").value).toBe("convex-b");
    expect(sheet?.getCell("B2").value).toBe("Bob");
    expect(sheet?.getCell("A3").value).toBe("convex-a");
    expect(sheet?.getCell("B3").value).toBe("Alice");
    expect(brandHitsColumn).toBeGreaterThan(0);
    expect(industryDbColumn).toBeGreaterThan(0);
    expect(industryDbRawColumn).toBeGreaterThan(0);
    expect(industryDbNormalizedColumn).toBeGreaterThan(0);
    expect(sheet?.getRow(2).getCell(industryDbColumn).value).toBe(38);
    expect(sheet?.getRow(2).getCell(industryDbRawColumn).value).toBe(20);
    expect(sheet?.getRow(2).getCell(industryDbNormalizedColumn).value).toBe(38);
    expect(sheet?.getRow(3).getCell(industryDbColumn).value).toBe(50);
    expect(sheet?.getRow(3).getCell(industryDbRawColumn).value).toBe(50);
    expect(sheet?.getRow(3).getCell(industryDbNormalizedColumn).value).toBe(50);
    expect(sheet?.getRow(3).getCell(brandHitsColumn).value).toBe("发那科");
  });

  it("returns a clear 404 when any requested resume cannot be resolved", async () => {
    vi.spyOn(ResumeService.prototype, "loadSample").mockReturnValue({
      items: [buildSampleResume({ resumeId: "resume-a", name: "Alice" })],
      sample: {
        name: "sample-test",
        filename: "sample-test.json",
        updatedAt: "2026-03-01T00:00:00.000Z",
        size: 1,
      },
      metadata: undefined,
      indexes: new Map(),
    });

    const app = createApp();
    const response = await app.request("/api/resumes/export", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        format: "csv",
        source: "sample",
        sample: "sample-test",
        entries: [
          { resumeId: "resume-a" },
          { resumeId: "missing-resume" },
        ],
      }),
    });

    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({
      success: false,
      error: "Unable to resolve resumes for export: missing-resume",
    });
  });

  it("keeps legacy embedded-resume payloads working during migration", async () => {
    const app = createApp();
    const response = await app.request("/api/resumes/export", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        format: "csv",
        entries: [
          {
            key: "legacy-1",
            status: "new",
            resume: {
              name: "Legacy Alice",
              age: "29",
              experience: "4 years",
              education: "Bachelor",
              location: "Dongguan",
              jobIntention: "Sales",
              expectedSalary: "10k-15k",
              selfIntro: "Legacy intro",
              profileUrl: "https://example.com/legacy-1",
              source: "seek",
              workHistory: [{ raw: "Legacy history" }],
              ingestData: {
                industryTags: ["sales"],
                brandHits: [
                  {
                    brand: "haas",
                    role: "equipment",
                    source: "selfIntro",
                    context: "sales",
                  },
                  {
                    brand: "哈斯",
                    role: "equipment",
                    source: "workHistory",
                    context: "technical",
                  },
                ],
                companyHits: ["haas"],
              },
            },
          },
        ],
      }),
    });

    expect(response.status).toBe(200);
    expectAttachmentHeaders(response, "csv");
    const parsed = Papa.parse<Record<string, string>>(await response.text(), { header: true });
    expect(parsed.data[0]?.resumeId).toBe("legacy-1");
    expect(parsed.data[0]?.name).toBe("Legacy Alice");
    expect(parsed.data[0]?.brandHits).toBe("哈斯");
  });
});
