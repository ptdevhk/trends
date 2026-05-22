import ExcelJS from "exceljs";
import Papa from "papaparse";
import { describe, expect, it } from "vitest";

import { ExportService } from "./export-service";

import type { ResumeExportEntry, ExportBatchMeta } from "./export-service";
import { buildSeekNameSearchUrl } from "@trends/shared";

function buildEntry(age: string | undefined): ResumeExportEntry {
  return {
    key: "resume-1",
    resume: {
      externalId: "job5156:resume:12345",
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
        industryDbV2Raw: 20,
        brandHits: [
          {
            brand: "fanuc",
            role: "equipment",
            source: "workHistory",
            context: "equipment",
          },
          {
            brand: "fanuc",
            role: "equipment",
            source: "workHistory",
            context: "equipment",
          },
        ],
        roleSignals: [
          {
            type: "sales",
            matchedSignals: ["销售工程师"],
            years: 4.5,
            industryVerifiedYears: 3.5,
            roleRelevantYears: 4.5,
            industryVerifiedRelevantYears: 3.5,
            matchedWorkEntries: [
              {
                companyName: "Example Co.",
                jobTitle: "Sales Engineer",
                years: 3.5,
                industryVerified: true,
                matchedSignals: ["销售工程师"],
              },
            ],
          },
        ],
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

  it("exports aiScore aligned with industryDb and relatedExp in standard CSV output", async () => {
    const service = new ExportService();
    // firstEntry: match reflects what the web sends after overrideIndustryDbBreakdown.
    const firstEntry: ResumeExportEntry = {
      ...buildEntry("25"),
      match: {
        ...buildEntry("25").match!,
        score: 68,
        breakdown: {
          related_exp: 18,
          industry_db: 50,
        },
      },
    };
    // secondEntry: no AI match, so aiScore should be empty and industryDb falls back to raw direct scoring.
    const secondEntry: ResumeExportEntry = {
      ...buildEntry("26"),
      key: "resume-2",
      resume: {
        ...buildEntry("26").resume,
        ingestData: {
          industryTags: ["cnc"],
          companyHits: [],
          brandHits: [],
          industryDbV2Raw: 25,
        },
      },
      match: undefined,
    };

    const file = await service.exportResumes("csv", [firstEntry, secondEntry], undefined, {
      size: 50,
      p80: 20,
      histogram50: Array.from({ length: 51 }, (_, index) => {
        if (index === 20) return 40;
        if (index === 25) return 10;
        return 0;
      }),
    });
    const csv = file.content.toString("utf8");
    const parsed = Papa.parse<Record<string, string>>(csv, { header: true });

    expect(parsed.meta.fields).toContain("industryDb");
    expect(parsed.meta.fields).toContain("relatedExp");
    expect(parsed.meta.fields).not.toContain("industryDbV2Raw");
    expect(parsed.meta.fields).not.toContain("industryDbV2Normalized");
    expect(parsed.meta.fields).not.toContain("externalId");
    expect(parsed.meta.fields).not.toContain("source");
    expect(parsed.data[0]?.aiScore).toBe("68");
    expect(parsed.data[0]?.industryDb).toBe("50");
    expect(parsed.data[0]?.relatedExp).toBe("18");
    expect(Number(parsed.data[0]?.aiScore)).toBe(Number(parsed.data[0]?.industryDb) + Number(parsed.data[0]?.relatedExp));
    expect(parsed.data[1]?.aiScore).toBe("");
    expect(parsed.data[1]?.industryDb).toBe("25");
    expect(parsed.data[1]?.relatedExp).toBe("");
  });

  it("uses the direct fallback for hit-driven industryDb when no match payload is sent", async () => {
    const service = new ExportService();
    const file = await service.exportResumes("csv", [
      {
        ...buildEntry("27"),
        key: "resume-hit",
        resume: {
          ...buildEntry("27").resume,
          ingestData: {
            industryTags: ["cnc"],
            companyHits: ["fanuc"],
            brandHits: [],
            industryDbV2Raw: 15,
          },
        },
        match: undefined,
      },
      {
        ...buildEntry("28"),
        key: "resume-employer-only",
        resume: {
          ...buildEntry("28").resume,
          ingestData: {
            industryTags: ["cnc"],
            companyHits: [],
            brandHits: [
              {
                brand: "fanuc",
                role: "employer",
                source: "workHistory",
                context: "employer",
              },
            ],
            industryDbV2Raw: 15,
          },
        },
        match: undefined,
      },
    ]);
    const csv = file.content.toString("utf8");
    const parsed = Papa.parse<Record<string, string>>(csv, { header: true });

    expect(parsed.data[0]?.industryDb).toBe("50");
    expect(parsed.data[1]?.industryDb).toBe("15");
  });

  it("exports industryDbV2Raw and industryDbV2Normalized columns in debug CSV output", async () => {
    const service = new ExportService();
    const firstEntry = buildEntry("25");
    const secondEntry: ResumeExportEntry = {
      ...buildEntry("26"),
      key: "resume-2",
      resume: {
        ...buildEntry("26").resume,
        ingestData: {
          industryTags: ["cnc"],
          companyHits: [],
          brandHits: [],
          industryDbV2Raw: 25,
        },
      },
    };

    const file = await service.exportResumes("csv", [firstEntry, secondEntry], undefined, {
      size: 50,
      p80: 20,
      histogram50: Array.from({ length: 51 }, (_, index) => {
        if (index === 20) return 40;
        if (index === 25) return 10;
        return 0;
      }),
    }, true);
    const csv = file.content.toString("utf8");
    const parsed = Papa.parse<Record<string, string>>(csv, { header: true });

    expect(parsed.meta.fields).toContain("industryDbV2Raw");
    expect(parsed.meta.fields).toContain("industryDbV2Normalized");
    expect(parsed.meta.fields).toContain("externalId");
    expect(parsed.meta.fields).toContain("source");
    expect(parsed.data[0]?.industryDbV2Raw).toBe("50");
    expect(parsed.data[0]?.industryDbV2Normalized).toBe("50");
    expect(parsed.data[1]?.industryDbV2Raw).toBe("25");
    expect(parsed.data[1]?.industryDbV2Normalized).toBe("45");
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

  it("upgrades Seek UUID profile URLs to talentsearch name-search URLs in export", async () => {
    const service = new ExportService();
    const entry: ResumeExportEntry = {
      ...buildEntry("27"),
      resume: {
        ...buildEntry("27").resume,
        name: "KHA LEONG CH'NG",
        source: "hk.employer.seek.com",
        profileUrl: "https://hk.employer.seek.com/candidates/891b1444-efa1-11e3-99bd-5e95a6174ad3",
      },
    };

    const file = await service.exportResumes("csv", [entry]);
    const csv = file.content.toString("utf8");
    const parsed = Papa.parse<Record<string, string>>(csv, { header: true });

    const expectedUrl = buildSeekNameSearchUrl("KHA LEONG CH'NG", "MY");
    expect(parsed.data[0]?.profileUrl).toBe(expectedUrl);
  });

  it("keeps Seek UUID profile URL when candidate name is missing", async () => {
    const service = new ExportService();
    const entry: ResumeExportEntry = {
      ...buildEntry("27"),
      resume: {
        ...buildEntry("27").resume,
        name: undefined,
        source: "hk.employer.seek.com",
        profileUrl: "https://hk.employer.seek.com/candidates/503033454",
      },
    };

    const file = await service.exportResumes("csv", [entry]);
    const csv = file.content.toString("utf8");
    const parsed = Papa.parse<Record<string, string>>(csv, { header: true });

    expect(parsed.data[0]?.profileUrl).toBe("https://hk.employer.seek.com/candidates/503033454");
  });

  it("renders structured work history fields in export output", async () => {
    const service = new ExportService();
    const entry: ResumeExportEntry = {
      ...buildEntry("27"),
      resume: {
        ...buildEntry("27").resume,
        workHistory: [
          {
            raw: "2021-03 ~ 2023-08 Example Co. Sales Manager",
            companyName: "Example Co.",
            jobTitle: "Sales Manager",
            startDate: "2021-03",
            endDate: "2023-08",
          },
        ],
      },
    };

    const file = await service.exportResumes("csv", [entry]);
    const csv = file.content.toString("utf8");
    const parsed = Papa.parse<Record<string, string>>(csv, { header: true });

    expect(parsed.data[0]?.workHistory).toContain("2021-03 ~ 2023-08 Example Co. Sales Manager");
  });

  it("includes role evidence fields in CSV output", async () => {
    const service = new ExportService();
    const file = await service.exportResumes("csv", [buildEntry("27")], undefined, undefined, true);
    const csv = file.content.toString("utf8");
    const parsed = Papa.parse<Record<string, string>>(csv, { header: true });

    expect(parsed.data[0]?.roleEvidence).toContain("sales:4.5y");
    expect(parsed.data[0]?.roleEvidence).toContain("verified 3.5y");
    expect(parsed.data[0]?.matchedWorkEntries).toContain("sales · Example Co. · Sales Engineer");
    expect(parsed.data[0]?.matchedWorkEntries).toContain("verified");
  });

  it("formats brand hits into a dedicated export column", async () => {
    const service = new ExportService({
      resolveZhHans: (brandId: string) => `zh-${brandId.toLowerCase()}`,
      toJSON: () => ({}),
    });
    const file = await service.exportResumes("csv", [buildEntry("27")]);
    const csv = file.content.toString("utf8");
    const parsed = Papa.parse<Record<string, string>>(csv, { header: true });

    expect(parsed.meta.fields).toContain("brandHits");
    expect(parsed.data[0]?.brandHits).toBe("zh-fanuc");
  });

  it("summarizes brand hits as deduped names-only evidence with alias expansion", async () => {
    const service = new ExportService(
      {
        resolveZhHans: (brandId: string) => {
          if (brandId.toLowerCase() === "fanuc") return "发那科";
          if (brandId.toLowerCase() === "mitsubishi") return "三菱";
          return brandId.toUpperCase();
        },
        toJSON: () => ({}),
      },
      [
        {
          name: "fanuc",
          displayName: "FANUC",
          aliases: ["发那科", "宝力机械有限公司"],
          displayAliases: ["发那科", "宝力机械有限公司"],
          allNames: ["fanuc", "发那科", "宝力机械有限公司"],
          role: "both",
        },
        {
          name: "mitsubishi",
          displayName: "MITSUBISHI",
          aliases: ["三菱"],
          displayAliases: ["三菱"],
          allNames: ["mitsubishi", "三菱"],
          role: "both",
        },
      ]
    );
    const entry = buildEntry("27");
    entry.resume.ingestData = {
      ...entry.resume.ingestData,
      brandHits: [
        { brand: "fanuc", role: "equipment", source: "workHistory", context: "equipment" },
        { brand: "宝力机械有限公司", role: "equipment", source: "selfIntro", context: "sales" },
        { brand: "mitsubishi", role: "equipment", source: "workHistory", context: "technical" },
        { brand: "fanuc", role: "employer", source: "workHistory", context: "employer" },
      ],
    };

    const file = await service.exportResumes("csv", [entry]);
    const csv = file.content.toString("utf8");
    const parsed = Papa.parse<Record<string, string>>(csv, { header: true });

    expect(parsed.data[0]?.brandHits).toBe("发那科, 三菱");
    expect(parsed.data[0]?.brandHits).not.toContain("source");
    expect(parsed.data[0]?.brandHits).not.toContain("context");
    expect(parsed.data[0]?.brandHits).not.toContain("role");
  });

  it("keeps CSV and XLSX headers aligned", async () => {
    const service = new ExportService();
    const csvFile = await service.exportResumes("csv", [buildEntry("27")]);
    const xlsxFile = await service.exportResumes("xlsx", [buildEntry("27")]);
    const csvParsed = Papa.parse<Record<string, string>>(csvFile.content.toString("utf8"), { header: true });
    const csvHeaders = csvParsed.meta.fields ?? [];

    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(xlsxFile.content);
    const sheet = workbook.getWorksheet("Resumes");
    const xlsxHeaders = ((sheet?.getRow(1).values as unknown[]) ?? [])
      .filter((value): value is string => typeof value === "string");

    const normalizedCsvHeaders = csvHeaders.map((header) =>
      header
        .replace(/([A-Z]+)/g, " $1")
        .trim()
        .split(/\s+/)
        .map((part) => {
          const lower = part.toLowerCase();
          if (lower === "id") return "ID";
          if (lower === "ai") return "AI";
          if (lower === "db") return "DB";
          if (lower === "v2") return "V2";
          if (lower === "url") return "URL";
          return part.charAt(0).toUpperCase() + part.slice(1).toLowerCase();
        })
        .join(" ")
    );

    expect(xlsxHeaders).toEqual(normalizedCsvHeaders);
  });
});
