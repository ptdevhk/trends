import ExcelJS from "exceljs";
import Papa from "papaparse";
import { describe, expect, it } from "vitest";

import { ExportService } from "./export-service";

import type { ResumeExportEntry, ExportBatchMeta } from "./export-service";

function buildEntry(age: string | undefined): ResumeExportEntry {
  return {
    key: "resume-1",
    resume: {
      name: "Alice",
      age,
      experience: "5年",
      education: "本科",
      location: "东莞",
      source: "hr.job5156.com",
      profileUrl: "https://example.com/resume-1",
      workHistory: [{ raw: "Test work history" }],
      selfIntro: "Test intro",
      ingestData: {
        industryTags: ["cnc"],
        companyHits: ["FANUC"],
      },
    },
    match: {
      score: 88,
      recommendation: "strong_match",
      scoreSource: "rule",
      summary: "Great fit",
    },
    action: "follow_up",
    status: "new",
    ruleScore: 91,
  };
}

describe("ExportService", () => {
  it("exports normalized age values in CSV output", async () => {
    const service = new ExportService();
    const file = await service.exportResumes("csv", [buildEntry(" 29 岁 "), buildEntry("invalid")]);
    const csv = file.content.toString("utf8");
    const parsed = Papa.parse<Record<string, string>>(csv, { header: true });

    expect(file.extension).toBe("csv");
    expect(file.contentType).toBe("text/csv; charset=utf-8");
    expect(parsed.data[0]?.age).toBe("29");
    expect(parsed.data[1]?.age).toBe("");
  });

  it("exports normalized age values in XLSX output", async () => {
    const service = new ExportService();
    const file = await service.exportResumes("xlsx", [buildEntry("31"), buildEntry("abc")]);
    const workbook = new ExcelJS.Workbook();

    await workbook.xlsx.load(file.content);
    const sheet = workbook.getWorksheet("Resumes");

    expect(file.extension).toBe("xlsx");
    expect(file.contentType).toBe(
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
    );
    expect(sheet).toBeDefined();
    expect(sheet?.getRow(1).values).toContain("Age");
    expect(sheet?.getCell("G2").value).toBe(31);
    expect(sheet?.getCell("G3").value).toBe("");
  });

  it("includes per-entry userComment and referenceNote in CSV", async () => {
    const service = new ExportService();
    const entry: ResumeExportEntry = {
      ...buildEntry("25"),
      userComment: "Excellent candidate",
      referenceNote: "Referred by HR dept",
    };
    const file = await service.exportResumes("csv", [entry]);
    const csv = file.content.toString("utf8");
    const parsed = Papa.parse<Record<string, string>>(csv, { header: true });

    expect(parsed.data[0]?.userComment).toBe("Excellent candidate");
    expect(parsed.data[0]?.referenceNote).toBe("Referred by HR dept");
  });

  it("applies batch-level userComment/referenceNote to every exported row", async () => {
    const service = new ExportService();
    const entryWithComment: ResumeExportEntry = {
      ...buildEntry("28"),
      userComment: "Per-entry comment",
      referenceNote: "Per-entry note",
    };
    const entryWithout: ResumeExportEntry = buildEntry("30");
    const batchMeta: ExportBatchMeta = {
      userComment: "Batch comment",
      referenceNote: "Batch ref note",
    };

    const file = await service.exportResumes("csv", [entryWithComment, entryWithout], batchMeta);
    const csv = file.content.toString("utf8");
    const parsed = Papa.parse<Record<string, string>>(csv, { header: true });

    expect(parsed.data[0]?.userComment).toBe("Batch comment");
    expect(parsed.data[0]?.referenceNote).toBe("Batch ref note");
    expect(parsed.data[1]?.userComment).toBe("Batch comment");
    expect(parsed.data[1]?.referenceNote).toBe("Batch ref note");
  });

  it("includes User Comment and Reference Note columns in XLSX header", async () => {
    const service = new ExportService();
    const entry: ResumeExportEntry = {
      ...buildEntry("26"),
      userComment: "Test comment",
      referenceNote: "Test note",
    };
    const file = await service.exportResumes("xlsx", [entry]);
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(file.content);
    const sheet = workbook.getWorksheet("Resumes");

    expect(sheet).toBeDefined();
    const headers = sheet?.getRow(1).values as unknown[];
    expect(headers).toContain("User Comment");
    expect(headers).toContain("Reference Note");
  });

  it("keeps non-Job5156 profile URLs unchanged during export", async () => {
    const service = new ExportService();
    const entry: ResumeExportEntry = {
      ...buildEntry("27"),
      resume: {
        ...buildEntry("27").resume,
        source: "hk.employer.seek.com",
        profileUrl: "https://hk.employer.seek.com/candidates/503033454",
      },
    };

    const file = await service.exportResumes("csv", [entry]);
    const csv = file.content.toString("utf8");
    const parsed = Papa.parse<Record<string, string>>(csv, { header: true });

    expect(parsed.data[0]?.profileUrl).toBe("https://hk.employer.seek.com/candidates/503033454");
  });
});
