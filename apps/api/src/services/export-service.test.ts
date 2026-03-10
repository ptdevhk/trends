import ExcelJS from "exceljs";
import Papa from "papaparse";
import { describe, expect, it } from "vitest";

import { ExportService } from "./export-service";

import type { ResumeExportEntry } from "./export-service";

function buildEntry(age: string | undefined): ResumeExportEntry {
  return {
    key: "resume-1",
    resume: {
      name: "Alice",
      age,
      experience: "5年",
      education: "本科",
      location: "东莞",
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
});
