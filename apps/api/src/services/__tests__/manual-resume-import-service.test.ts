import { describe, it, expect } from "vitest";
import {
  normalizeWhitespace,
  decodeXmlEntities,
  extractDocxTextFromXml,
  buildBaseMetadata,
  getExtension,
  sanitizeEntryPath,
  isSupportedResumeFile,
  ensureFileSizeWithinLimit,
  fileResultBase,
  buildImportedResumeCandidate,
  buildSummary,
  buildParsedSummary,
  resolveImportLimit,
} from "../manual-resume-import-service.js";

describe("normalizeWhitespace", () => {
  it("replaces carriage returns with newlines", () => {
    expect(normalizeWhitespace("hello\rworld")).toBe("hello\nworld");
  });
  it("removes null bytes", () => {
    expect(normalizeWhitespace("hello\u0000world")).toBe("helloworld");
  });
  it("collapses 3+ consecutive newlines to 2", () => {
    expect(normalizeWhitespace("a\n\n\nb")).toBe("a\n\nb");
    expect(normalizeWhitespace("a\n\n\n\n\nb")).toBe("a\n\nb");
  });
  it("trims leading and trailing whitespace", () => {
    expect(normalizeWhitespace("  hello  ")).toBe("hello");
  });
  it("preserves single newlines", () => {
    expect(normalizeWhitespace("a\nb")).toBe("a\nb");
  });
  it("preserves double newlines", () => {
    expect(normalizeWhitespace("a\n\nb")).toBe("a\n\nb");
  });
});

describe("decodeXmlEntities", () => {
  it("decodes named entities", () => {
    expect(decodeXmlEntities("&amp;")).toBe("&");
    expect(decodeXmlEntities("&lt;")).toBe("<");
    expect(decodeXmlEntities("&gt;")).toBe(">");
    expect(decodeXmlEntities("&quot;")).toBe('"');
    expect(decodeXmlEntities("&apos;")).toBe("'");
  });
  it("decodes hex character references", () => {
    expect(decodeXmlEntities("&#x41;")).toBe("A");
    expect(decodeXmlEntities("&#x26;")).toBe("&");
  });
  it("decodes decimal character references", () => {
    expect(decodeXmlEntities("&#65;")).toBe("A");
    expect(decodeXmlEntities("&#38;")).toBe("&");
  });
  it("handles mixed text", () => {
    expect(decodeXmlEntities("a &lt; b &amp; c &gt; d")).toBe("a < b & c > d");
  });
  it("returns original text for non-entity ampersands", () => {
    expect(decodeXmlEntities("hello &world foo")).toBe("hello &world foo");
  });
});

describe("extractDocxTextFromXml", () => {
  it("extracts text from w:t elements", () => {
    const xml = '<w:r><w:t>Hello World</w:t></w:r>';
    expect(extractDocxTextFromXml(xml)).toBe("Hello World");
  });
  it("extracts text from multiple w:t elements", () => {
    const xml = '<w:r><w:t>Hello</w:t></w:r><w:r><w:t>World</w:t></w:r>';
    expect(extractDocxTextFromXml(xml)).toBe("Hello\nWorld");
  });
  it("handles w:br as newline", () => {
    const xml = '<w:r><w:t>Hello<w:br/>World</w:t></w:r>';
    expect(extractDocxTextFromXml(xml)).toBe("Hello\nWorld");
  });
  it("handles w:tab as tab", () => {
    const xml = '<w:r><w:t>Hello<w:tab/>World</w:t></w:r>';
    expect(extractDocxTextFromXml(xml)).toBe("Hello\tWorld");
  });
  it("handles XML entities in text", () => {
    const xml = '<w:r><w:t>A &amp; B</w:t></w:r>';
    expect(extractDocxTextFromXml(xml)).toBe("A & B");
  });
  it("skips empty w:t elements", () => {
    const xml = '<w:r><w:t>   </w:t></w:r><w:r><w:t>Hello</w:t></w:r>';
    expect(extractDocxTextFromXml(xml)).toBe("Hello");
  });
});

describe("buildBaseMetadata", () => {
  it("builds metadata with all optional fields", () => {
    const result = buildBaseMetadata({
      files: [],
      keyword: "CNC",
      location: "深圳",
      searchProfileId: "sp_123",
    });
    expect(result.sourceKey).toBe("51job-manual");
    expect(result.sourceUrl).toBe("https://www.51job.com/");
    expect(result.keyword).toBe("CNC");
    expect(result.location).toBe("深圳");
    expect(result.searchProfileId).toBe("sp_123");
    expect(result.collectionContext.captureMode).toBe("manual-upload");
  });
  it("omits optional fields when not provided", () => {
    const result = buildBaseMetadata({ files: [] });
    expect(result.keyword).toBeUndefined();
    expect(result.location).toBeUndefined();
    expect(result.searchProfileId).toBeUndefined();
  });
  it("omits optional fields for empty strings", () => {
    const result = buildBaseMetadata({ files: [], keyword: "", location: "  " });
    expect(result.keyword).toBeUndefined();
    expect(result.location).toBeUndefined();
  });
});

describe("getExtension", () => {
  it("returns lowercase extension", () => {
    expect(getExtension("resume.PDF")).toBe(".pdf");
    expect(getExtension("file.docx")).toBe(".docx");
  });
  it("returns empty string for no extension", () => {
    expect(getExtension("resume")).toBe("");
  });
});

describe("sanitizeEntryPath", () => {
  it("replaces backslashes with forward slashes", () => {
    expect(sanitizeEntryPath("folder\\file.docx")).toBe("folder/file.docx");
  });
  it("removes leading slashes", () => {
    expect(sanitizeEntryPath("/root/file.docx")).toBe("root/file.docx");
    expect(sanitizeEntryPath("///file.docx")).toBe("file.docx");
  });
  it("trims whitespace", () => {
    expect(sanitizeEntryPath("  file.docx  ")).toBe("file.docx");
  });
});

describe("isSupportedResumeFile", () => {
  it("returns true for supported extensions", () => {
    expect(isSupportedResumeFile("resume.pdf")).toBe(true);
    expect(isSupportedResumeFile("resume.doc")).toBe(true);
    expect(isSupportedResumeFile("resume.docx")).toBe(true);
    expect(isSupportedResumeFile("resume.PDF")).toBe(true);
  });
  it("returns false for unsupported extensions", () => {
    expect(isSupportedResumeFile("resume.txt")).toBe(false);
    expect(isSupportedResumeFile("image.png")).toBe(false);
    expect(isSupportedResumeFile("data.xlsx")).toBe(false);
  });
});

describe("ensureFileSizeWithinLimit", () => {
  it("does not throw for files within limit", () => {
    expect(() => ensureFileSizeWithinLimit("test.pdf", 100, 200)).not.toThrow();
    expect(() => ensureFileSizeWithinLimit("test.pdf", 200, 200)).not.toThrow();
  });
  it("throws for files exceeding limit", () => {
    expect(() => ensureFileSizeWithinLimit("test.pdf", 201, 200)).toThrow(/exceeds the 0MB limit/);
  });
  it("throws for invalid file size", () => {
    expect(() => ensureFileSizeWithinLimit("test.pdf", -1, 200)).toThrow(/Invalid file size/);
    expect(() => ensureFileSizeWithinLimit("test.pdf", Infinity, 200)).toThrow(/Invalid file size/);
    expect(() => ensureFileSizeWithinLimit("test.pdf", NaN, 200)).toThrow(/Invalid file size/);
  });
});

describe("fileResultBase", () => {
  it("builds base file result from enumerated file", () => {
    const result = fileResultBase({
      uploadName: "archive.zip",
      entryPath: "resume.docx",
      extension: ".docx",
      data: new Uint8Array(0),
      extractionMethod: "zip",
    });
    expect(result).toEqual({
      uploadName: "archive.zip",
      entryPath: "resume.docx",
      extension: ".docx",
      warnings: [],
    });
  });
});

describe("buildImportedResumeCandidate", () => {
  it("builds candidate from file and parsed text", () => {
    const file = {
      uploadName: "test.zip",
      entryPath: "张三_销售.doc",
      extension: ".doc",
      data: new Uint8Array(0),
      extractionMethod: "zip",
    };
    // Minimal 51job text that parse51jobManualResume can extract a name from
    const text = "姓名：张三\n工作经验：5年\n求职意向：销售经理";
    const result = buildImportedResumeCandidate(file, text, []);
    expect(result.result.status).toBe("imported");
    expect(result.resume).toBeDefined();
    expect(result.resume.profileType).toBe("51job-manual");
  });
  it("uses entryPath basename as fallback name", () => {
    const file = {
      uploadName: "test.zip",
      entryPath: "unknown.doc",
      extension: ".doc",
      data: new Uint8Array(0),
      extractionMethod: "direct",
    };
    const text = "some unstructured text";
    const result = buildImportedResumeCandidate(file, text, ["warning1"]);
    expect(result.result.warnings).toEqual(["warning1"]);
  });
});

describe("buildSummary", () => {
  it("merges parsed and submit summaries", () => {
    const result = buildSummary(
      { uploadedFiles: 2, discoveredFiles: 5, parsedResumes: 3, imported: 3, skipped: 1, failed: 1 },
      { submitted: 3, inserted: 2, updated: 1, unchanged: 0, deduped: 0 },
    );
    expect(result).toEqual({
      uploadedFiles: 2,
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
  });
});

describe("buildParsedSummary", () => {
  it("counts statuses from file results", () => {
    const result = buildParsedSummary(2, 5, 3, [
      { uploadName: "a", entryPath: "a", extension: ".pdf", status: "imported", warnings: [] },
      { uploadName: "b", entryPath: "b", extension: ".doc", status: "skipped", warnings: [] },
      { uploadName: "c", entryPath: "c", extension: ".docx", status: "failed", warnings: [], error: "parse error" },
    ]);
    expect(result).toEqual({
      uploadedFiles: 2,
      discoveredFiles: 5,
      parsedResumes: 3,
      imported: 3,
      skipped: 1,
      failed: 1,
    });
  });
});

describe("resolveImportLimit", () => {
  it("returns truncated positive number", () => {
    expect(resolveImportLimit(10)).toBe(10);
    expect(resolveImportLimit(10.9)).toBe(10);
  });
  it("returns undefined for non-positive results", () => {
    expect(resolveImportLimit(0)).toBeUndefined();
    expect(resolveImportLimit(-5)).toBeUndefined();
  });
  it("returns undefined for non-finite or non-number", () => {
    expect(resolveImportLimit(undefined)).toBeUndefined();
    expect(resolveImportLimit(Infinity)).toBeUndefined();
    expect(resolveImportLimit(NaN)).toBeUndefined();
    expect(resolveImportLimit("10" as unknown as number)).toBeUndefined();
  });
});
