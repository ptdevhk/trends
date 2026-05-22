import { describe, it, expect } from "vitest";
import {
  CsvStringArraySchema,
  OptionalIntParam,
  ResumeSubmitSummarySchema,
  ResumeBackupRequestSchema,
  RecommendationSchema,
  ScoreSourceSchema,
  ResumeManualImportFileResultSchema,
  ResumeManualImportSummarySchema,
  ResumesQuerySchema,
} from "../resumes.js";

describe("CsvStringArraySchema", () => {
  it("parses comma-separated string", () => {
    expect(CsvStringArraySchema.parse("a,b,c")).toEqual(["a", "b", "c"]);
  });

  it("parses Chinese comma-separated string", () => {
    expect(CsvStringArraySchema.parse("销售，管理")).toEqual(["销售", "管理"]);
  });

  it("parses ideographic comma (、) separated string", () => {
    expect(CsvStringArraySchema.parse("CNC、FANUC")).toEqual(["CNC", "FANUC"]);
  });

  it("trims whitespace around items", () => {
    expect(CsvStringArraySchema.parse(" a , b , c ")).toEqual(["a", "b", "c"]);
  });

  it("returns undefined for empty string after trimming", () => {
    expect(CsvStringArraySchema.parse("")).toBeUndefined();
    expect(CsvStringArraySchema.parse("  ")).toBeUndefined();
  });

  it("returns undefined for undefined input", () => {
    expect(CsvStringArraySchema.parse(undefined)).toBeUndefined();
  });

  it("passes through string array", () => {
    expect(CsvStringArraySchema.parse(["a", "b"])).toEqual(["a", "b"]);
  });

  it("filters out empty items", () => {
    expect(CsvStringArraySchema.parse("a,,b")).toEqual(["a", "b"]);
  });
});

describe("OptionalIntParam", () => {
  const param = OptionalIntParam({ name: "test" });

  it("parses valid number string", () => {
    expect(param.parse("42")).toBe(42);
  });

  it("returns undefined for undefined input", () => {
    expect(param.parse(undefined)).toBeUndefined();
  });

  it("returns undefined for empty string", () => {
    expect(param.parse("")).toBeUndefined();
  });

  it("rejects negative numbers by default (min=0)", () => {
    expect(() => param.parse("-1")).toThrow();
  });

  const rangedParam = OptionalIntParam({ name: "score", min: 0, max: 100 });

  it("respects max constraint", () => {
    expect(rangedParam.parse("100")).toBe(100);
    expect(() => rangedParam.parse("101")).toThrow();
  });

  it("respects min constraint", () => {
    expect(rangedParam.parse("0")).toBe(0);
    expect(() => rangedParam.parse("-1")).toThrow();
  });
});

describe("ResumeSubmitSummarySchema", () => {
  it("validates a correct summary", () => {
    const result = ResumeSubmitSummarySchema.parse({
      success: true,
      submitted: 10,
      inserted: 5,
      updated: 3,
      unchanged: 2,
      deduped: 0,
    });
    expect(result.success).toBe(true);
    expect(result.submitted).toBe(10);
  });

  it("rejects success: false", () => {
    expect(() =>
      ResumeSubmitSummarySchema.parse({
        success: false,
        submitted: 10,
        inserted: 5,
        updated: 3,
        unchanged: 2,
        deduped: 0,
      }),
    ).toThrow();
  });

  it("rejects missing fields", () => {
    expect(() =>
      ResumeSubmitSummarySchema.parse({
        success: true,
        submitted: 10,
      }),
    ).toThrow();
  });
});

describe("ResumeBackupRequestSchema", () => {
  it("validates with resumeIds", () => {
    const result = ResumeBackupRequestSchema.parse({
      resumeIds: ["resume_1", "resume_2"],
    });
    expect(result.resumeIds).toEqual(["resume_1", "resume_2"]);
  });

  it("validates with sourceHosts", () => {
    const result = ResumeBackupRequestSchema.parse({
      sourceHosts: ["host1"],
    });
    expect(result.sourceHosts).toEqual(["host1"]);
  });

  it("validates empty object (all optional)", () => {
    const result = ResumeBackupRequestSchema.parse({});
    expect(result.resumeIds).toBeUndefined();
    expect(result.sourceHosts).toBeUndefined();
  });

  it("rejects empty string resumeIds", () => {
    expect(() =>
      ResumeBackupRequestSchema.parse({ resumeIds: [""] }),
    ).toThrow();
  });
});

describe("RecommendationSchema", () => {
  it("accepts valid recommendations", () => {
    expect(RecommendationSchema.parse("strong_match")).toBe("strong_match");
    expect(RecommendationSchema.parse("match")).toBe("match");
    expect(RecommendationSchema.parse("potential")).toBe("potential");
    expect(RecommendationSchema.parse("no_match")).toBe("no_match");
  });

  it("rejects invalid recommendation", () => {
    expect(() => RecommendationSchema.parse("maybe")).toThrow();
  });
});

describe("ScoreSourceSchema", () => {
  it("accepts rule and ai", () => {
    expect(ScoreSourceSchema.parse("rule")).toBe("rule");
    expect(ScoreSourceSchema.parse("ai")).toBe("ai");
  });

  it("rejects invalid source", () => {
    expect(() => ScoreSourceSchema.parse("hybrid")).toThrow();
  });
});

describe("ResumeManualImportFileResultSchema", () => {
  it("validates imported result", () => {
    const result = ResumeManualImportFileResultSchema.parse({
      uploadName: "test.docx",
      entryPath: "test.docx",
      extension: ".docx",
      status: "imported",
      warnings: [],
    });
    expect(result.status).toBe("imported");
    expect(result.warnings).toEqual([]);
  });

  it("validates failed result with error", () => {
    const result = ResumeManualImportFileResultSchema.parse({
      uploadName: "test.pdf",
      entryPath: "test.pdf",
      extension: ".pdf",
      status: "failed",
      error: "Parse error",
      warnings: [],
    });
    expect(result.status).toBe("failed");
    expect(result.error).toBe("Parse error");
  });

  it("validates skipped result", () => {
    const result = ResumeManualImportFileResultSchema.parse({
      uploadName: "test.txt",
      entryPath: "test.txt",
      extension: ".txt",
      status: "skipped",
      warnings: [],
    });
    expect(result.status).toBe("skipped");
  });

  it("rejects invalid status", () => {
    expect(() =>
      ResumeManualImportFileResultSchema.parse({
        uploadName: "test.docx",
        entryPath: "test.docx",
        extension: ".docx",
        status: "pending",
        warnings: [],
      }),
    ).toThrow();
  });
});

describe("ResumeManualImportSummarySchema", () => {
  it("validates a complete summary", () => {
    const result = ResumeManualImportSummarySchema.parse({
      uploadedFiles: 1,
      discoveredFiles: 5,
      parsedResumes: 3,
      imported: 3,
      inserted: 2,
      updated: 1,
      unchanged: 0,
      deduped: 0,
      skipped: 1,
      failed: 1,
    });
    expect(result.uploadedFiles).toBe(1);
    expect(result.imported).toBe(3);
  });

  it("rejects missing fields", () => {
    expect(() =>
      ResumeManualImportSummarySchema.parse({
        uploadedFiles: 1,
      }),
    ).toThrow();
  });
});

describe("ResumesQuerySchema", () => {
  it("parses a minimal query", () => {
    const result = ResumesQuerySchema.parse({});
    expect(result.source).toBe("sample"); // default
    expect(result.q).toBeUndefined();
  });

  it("normalizes query string (fullwidth spaces, collapse)", () => {
    const result = ResumesQuerySchema.parse({ q: " hello　world  " });
    expect(result.q).toBe("hello world");
  });

  it("returns undefined for empty/whitespace query", () => {
    const result = ResumesQuerySchema.parse({ q: "  " });
    expect(result.q).toBeUndefined();
  });

  it("parses source enum", () => {
    expect(ResumesQuerySchema.parse({ source: "convex" }).source).toBe("convex");
    expect(ResumesQuerySchema.parse({}).source).toBe("sample");
  });

  it("parses recommendation as CSV string", () => {
    const result = ResumesQuerySchema.parse({ recommendation: "strong_match,match" });
    expect(result.recommendation).toEqual(["strong_match", "match"]);
  });

  it("parses minMatchScore string to number", () => {
    const result = ResumesQuerySchema.parse({ minMatchScore: "70" });
    expect(result.minMatchScore).toBe(70);
  });

  it("rejects minMatchScore > 100", () => {
    expect(() => ResumesQuerySchema.parse({ minMatchScore: "101" })).toThrow();
  });
});
