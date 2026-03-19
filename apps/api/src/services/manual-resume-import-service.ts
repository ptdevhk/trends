import path from "node:path";

import { unzipSync } from "fflate";
import * as unrar from "node-unrar-js";
import { PDFParse } from "pdf-parse";
import { z } from "@hono/zod-openapi";

import {
  hasReadableManual51jobText,
  normalizeOptionalString,
  parse51jobManualResume,
  stripManual51jobUnreadableControlCharacters,
} from "@trends/shared";

import {
  type ResumeImportItem,
  type ResumeSubmitSummary,
  normalizeResumeImportPayload,
  submitNormalizedResumeImport,
} from "./resume-import-service.js";
import {
  ResumeImportMetadataSchema,
  ResumeManualImportResponseSchema,
} from "../schemas/resumes.js";

type ResumeImportMetadata = z.infer<typeof ResumeImportMetadataSchema>;
export type ResumeManualImportResponse = z.infer<typeof ResumeManualImportResponseSchema>;

type ManualResumeImportFileResult = ResumeManualImportResponse["files"][number];

type ManualResumeImportSummary = ResumeManualImportResponse["summary"];

type ManualResumeImportInput = {
  files: File[];
  searchProfileId?: string;
  keyword?: string;
  location?: string;
};

type EnumeratedImportFile = {
  uploadName: string;
  entryPath: string;
  extension: string;
  data: Uint8Array;
  extractionMethod: "direct" | "zip" | "rar";
};

type ParsedImportCandidate = {
  result: ManualResumeImportFileResult;
  resume: ResumeImportItem | null;
};

type UploadExpansionResult = {
  entries: EnumeratedImportFile[];
  fileResult?: ManualResumeImportFileResult;
};

const MANUAL_SOURCE_KEY = "51job-manual";
const MANUAL_SOURCE_URL = "https://www.51job.com/";
const MANUAL_GENERATED_BY = "manual-resume-import@1.0.0";
const MAX_UPLOAD_FILE_SIZE = 25 * 1024 * 1024;
const MAX_ARCHIVE_ENTRY_SIZE = 25 * 1024 * 1024;
const MAX_TOTAL_EXTRACTED_SIZE = 150 * 1024 * 1024;
const MAX_UPLOAD_REQUEST_SIZE = MAX_TOTAL_EXTRACTED_SIZE;
const MAX_PARALLEL_FILE_OPERATIONS = 4;
const SUPPORTED_FILE_EXTENSIONS = new Set([".pdf", ".doc", ".docx"]);
const DOCX_MESSAGE_WARNING_TYPES = new Set(["warning", "error"]);
const DOCX_TEXT_ENTRY_PATH_PATTERN = /^word\/(?:document|header\d+|footer\d+|footnotes|endnotes)\.xml$/i;
const DOCX_TEXT_RUN_PATTERN = /<w:t\b[^>]*>((?:(?!<\/w:t>)(?:[^<]|<w:(?:br|cr|tab|noBreakHyphen|softHyphen)\b[^>]*\/>))*)<\/w:t>/gis;

function normalizeWhitespace(value: string): string {
  return value.replace(/\r/g, "\n").replace(/\u0000/g, "").replace(/\n{3,}/g, "\n\n").trim();
}

function decodeXmlEntities(value: string): string {
  return value.replace(/&(?:#x([0-9a-fA-F]+)|#(\d+)|amp|lt|gt|quot|apos);/g, (match, hex, decimal) => {
    if (typeof hex === "string") {
      return String.fromCodePoint(Number.parseInt(hex, 16));
    }
    if (typeof decimal === "string") {
      return String.fromCodePoint(Number.parseInt(decimal, 10));
    }
    switch (match) {
      case "&amp;":
        return "&";
      case "&lt;":
        return "<";
      case "&gt;":
        return ">";
      case "&quot;":
        return '"';
      case "&apos;":
        return "'";
      default:
        return match;
    }
  });
}

function extractDocxTextFromXml(xml: string): string {
  const fragments = Array.from(xml.matchAll(DOCX_TEXT_RUN_PATTERN), (match) => {
    return decodeXmlEntities(match[1])
      .replace(/<w:tab\b[^>]*\/>/g, "\t")
      .replace(/<w:(?:br|cr)\b[^>]*\/>/g, "\n")
      .replace(/<w:noBreakHyphen\b[^>]*\/>/g, "-")
      .replace(/<w:softHyphen\b[^>]*\/>/g, "");
  }).filter((fragment) => fragment.trim().length > 0);

  return normalizeWhitespace(fragments.join("\n"));
}

function extractDocxTextFallback(file: EnumeratedImportFile): string {
  const archiveEntries = unzipSync(file.data);
  const decoder = new TextDecoder("utf-8");
  const text = Object.entries(archiveEntries)
    .filter(([entryPath]) => DOCX_TEXT_ENTRY_PATH_PATTERN.test(entryPath))
    .map(([, data]) => extractDocxTextFromXml(decoder.decode(data)))
    .join("\n\n");

  return normalizeWhitespace(text);
}

function buildBaseMetadata(input: ManualResumeImportInput): ResumeImportMetadata {
  const keyword = normalizeOptionalString(input.keyword);
  const location = normalizeOptionalString(input.location);
  const searchProfileId = normalizeOptionalString(input.searchProfileId);

  return {
    sourceUrl: MANUAL_SOURCE_URL,
    generatedBy: MANUAL_GENERATED_BY,
    sourceKey: MANUAL_SOURCE_KEY,
    sourceHost: MANUAL_SOURCE_KEY,
    ...(keyword ? { keyword } : {}),
    ...(location ? { location } : {}),
    ...(searchProfileId ? { searchProfileId } : {}),
    collectionContext: {
      captureMode: "manual-upload",
      operation: "manual-import",
      profileType: MANUAL_SOURCE_KEY,
    },
    generatedAt: new Date().toISOString(),
    totalPages: 1,
    totalResumes: 0,
    reproduction: "Upload resume bundles or documents from 51job manual export",
  };
}

function toUint8Array(value: ArrayBuffer): Uint8Array {
  return new Uint8Array(value);
}

function toArrayBuffer(value: Uint8Array): ArrayBuffer {
  const copy = new Uint8Array(value.byteLength);
  copy.set(value);
  return copy.buffer;
}

function getExtension(name: string): string {
  return path.extname(name).toLowerCase();
}

function sanitizeEntryPath(entryPath: string): string {
  return entryPath.replace(/\\/g, "/").replace(/^\/+/, "").trim();
}

function isSupportedResumeFile(entryPath: string): boolean {
  return SUPPORTED_FILE_EXTENSIONS.has(getExtension(entryPath));
}

function ensureFileSizeWithinLimit(name: string, size: number, limit: number): void {
  if (!Number.isFinite(size) || size < 0) {
    throw new Error(`Invalid file size for ${name}`);
  }
  if (size > limit) {
    throw new Error(`${name} exceeds the ${Math.round(limit / (1024 * 1024))}MB limit`);
  }
}

async function readUploadFile(file: File): Promise<Uint8Array> {
  ensureFileSizeWithinLimit(file.name, file.size, MAX_UPLOAD_FILE_SIZE);
  return toUint8Array(await file.arrayBuffer());
}

function enumerateZipEntries(uploadName: string, archiveData: Uint8Array): EnumeratedImportFile[] {
  const unzipped = unzipSync(archiveData);
  const entries: EnumeratedImportFile[] = [];
  let totalExtractedSize = 0;

  for (const [entryPath, data] of Object.entries(unzipped)) {
    const normalizedPath = sanitizeEntryPath(entryPath);
    if (!normalizedPath || normalizedPath.endsWith("/")) {
      continue;
    }

    totalExtractedSize += data.byteLength;
    ensureFileSizeWithinLimit(normalizedPath, data.byteLength, MAX_ARCHIVE_ENTRY_SIZE);
    ensureFileSizeWithinLimit(uploadName, totalExtractedSize, MAX_TOTAL_EXTRACTED_SIZE);

    entries.push({
      uploadName,
      entryPath: normalizedPath,
      extension: getExtension(normalizedPath),
      data,
      extractionMethod: "zip",
    });
  }

  return entries;
}

async function extractRarEntries(uploadName: string, archiveData: Uint8Array): Promise<EnumeratedImportFile[]> {
  // node-unrar-js works with the provided RAR v5 sample, but DOCX buffers extracted from RAR
  // are not yet compatible with Mammoth in this runtime. Keep RAR enumeration/import enabled,
  // and report DOCX entries as file-level failures until that parser lane is hardened.
  const extractor = await unrar.createExtractorFromData({
    data: toArrayBuffer(archiveData),
  });
  const list = extractor.getFileList();
  const fileHeaders = [...list.fileHeaders];
  const archiveEntries = fileHeaders.filter((entry) => !entry.flags.directory);
  const paths = archiveEntries.map((entry) => entry.name);
  const extracted = extractor.extract({ files: paths });
  const extractedFiles = [...extracted.files];

  const entries: EnumeratedImportFile[] = [];
  let totalExtractedSize = 0;

  for (const file of extractedFiles) {
    const normalizedPath = sanitizeEntryPath(file.fileHeader.name);
    if (!normalizedPath || file.fileHeader.flags.directory) {
      continue;
    }

    const extraction = file.extraction;
    if (!(extraction instanceof Uint8Array)) {
      throw new Error(`Failed to extract ${normalizedPath} from ${uploadName}`);
    }

    totalExtractedSize += extraction.byteLength;
    ensureFileSizeWithinLimit(normalizedPath, extraction.byteLength, MAX_ARCHIVE_ENTRY_SIZE);
    ensureFileSizeWithinLimit(uploadName, totalExtractedSize, MAX_TOTAL_EXTRACTED_SIZE);

    entries.push({
      uploadName,
      entryPath: normalizedPath,
      extension: getExtension(normalizedPath),
      data: extraction,
      extractionMethod: "rar",
    });
  }

  return entries;
}

async function expandUploadedFile(file: File): Promise<UploadExpansionResult> {
  try {
    const data = await readUploadFile(file);
    const extension = getExtension(file.name);

    if (extension === ".zip") {
      return { entries: enumerateZipEntries(file.name, data) };
    }

    if (extension === ".rar") {
      return { entries: await extractRarEntries(file.name, data) };
    }

    return {
      entries: [{
        uploadName: file.name,
        entryPath: file.name,
        extension,
        data,
        extractionMethod: "direct",
      }],
    };
  } catch (error) {
    return {
      entries: [],
      fileResult: {
        uploadName: file.name,
        entryPath: file.name,
        extension: getExtension(file.name),
        status: "failed",
        error: error instanceof Error ? error.message : String(error),
        warnings: ["Archive expansion failed"],
      },
    };
  }
}

async function mapInBatches<TItem, TResult>(
  items: readonly TItem[],
  mapper: (item: TItem) => Promise<TResult>,
): Promise<TResult[]> {
  const results: TResult[] = [];

  for (let index = 0; index < items.length; index += MAX_PARALLEL_FILE_OPERATIONS) {
    const batch = items.slice(index, index + MAX_PARALLEL_FILE_OPERATIONS);
    results.push(...await Promise.all(batch.map((item) => mapper(item))));
  }

  return results;
}

async function enumerateUploadedFiles(files: File[]): Promise<{
  entries: EnumeratedImportFile[];
  fileResults: ManualResumeImportFileResult[];
}> {
  const expandedFiles = await mapInBatches(files, expandUploadedFile);
  const entries: EnumeratedImportFile[] = [];
  const fileResults: ManualResumeImportFileResult[] = [];

  for (const expanded of expandedFiles) {
    entries.push(...expanded.entries);
    if (expanded.fileResult) {
      fileResults.push(expanded.fileResult);
    }
  }

  return { entries, fileResults };
}

function fileResultBase(file: EnumeratedImportFile): Omit<ManualResumeImportFileResult, "status"> {
  return {
    uploadName: file.uploadName,
    entryPath: file.entryPath,
    extension: file.extension,
    warnings: [],
  };
}

function buildImportedResumeCandidate(
  file: EnumeratedImportFile,
  text: string,
  warnings: string[],
): ParsedImportCandidate {
  const parsed = parse51jobManualResume({
    text,
    entryPath: file.entryPath,
  });
  const resumeName = parsed.name ?? path.basename(file.entryPath, file.extension);
  const resume: ResumeImportItem = {
    name: resumeName,
    extractedAt: new Date().toISOString(),
    profileType: MANUAL_SOURCE_KEY,
    workHistory: parsed.workHistory,
    resumeSnippet: parsed.resumeSnippet,
    ...(parsed.profileId ? { profileId: parsed.profileId } : {}),
    ...(parsed.location ? { location: parsed.location } : {}),
    ...(parsed.jobIntention ? { jobIntention: parsed.jobIntention } : {}),
    ...(parsed.expectedSalary ? { expectedSalary: parsed.expectedSalary } : {}),
    ...(parsed.experience ? { experience: parsed.experience } : {}),
    ...(parsed.education ? { education: parsed.education } : {}),
    ...(parsed.selfIntro ? { selfIntro: parsed.selfIntro } : {}),
    ...(parsed.profileEducation ? { profileEducation: parsed.profileEducation } : {}),
  };

  return {
    result: {
      ...fileResultBase(file),
      status: "imported",
      resumeName,
      ...(parsed.profileId ? { profileId: parsed.profileId } : {}),
      warnings,
    },
    resume,
  };
}

async function parseDocxFile(file: EnumeratedImportFile): Promise<ParsedImportCandidate> {
  let text = "";
  let warnings: string[] = [];
  let mammothError: unknown;

  try {
    const mammoth = await import("mammoth");
    const result = await mammoth.extractRawText({ buffer: Buffer.from(file.data) });
    text = normalizeWhitespace(result.value);
    warnings = result.messages
      .filter((message) => DOCX_MESSAGE_WARNING_TYPES.has(message.type))
      .map((message) => message.message);
  } catch (error) {
    mammothError = error;
  }

  if (!text) {
    try {
      text = extractDocxTextFallback(file);
      if (text) {
        warnings = mammothError
          ? [`Used DOCX XML fallback parser: ${mammothError instanceof Error ? mammothError.message : String(mammothError)}`]
          : warnings;
      }
    } catch (fallbackError) {
      if (mammothError) {
        return {
          result: {
            ...fileResultBase(file),
            status: "failed",
            error: mammothError instanceof Error ? mammothError.message : String(mammothError),
            warnings: [
              `DOCX fallback extraction failed: ${fallbackError instanceof Error ? fallbackError.message : String(fallbackError)}`,
            ],
          },
          resume: null,
        };
      }

      return {
        result: {
          ...fileResultBase(file),
          status: "failed",
          error: fallbackError instanceof Error ? fallbackError.message : String(fallbackError),
          warnings,
        },
        resume: null,
      };
    }
  }

  if (!text) {
    return {
      result: {
        ...fileResultBase(file),
        status: "failed",
        warnings,
        error: mammothError instanceof Error ? mammothError.message : "No extractable text found in DOCX file",
      },
      resume: null,
    };
  }

  return buildImportedResumeCandidate(file, text, warnings);
}

async function parsePdfFile(file: EnumeratedImportFile): Promise<ParsedImportCandidate> {
  const parser = new PDFParse({ data: Buffer.from(file.data) });

  try {
    const result = await parser.getText();
    const rawText = normalizeWhitespace(result.text);
    if (!rawText) {
      return {
        result: {
          ...fileResultBase(file),
          status: "failed",
          error: "No extractable text found in PDF file",
          warnings: [],
        },
        resume: null,
      };
    }

    const text = normalizeWhitespace(stripManual51jobUnreadableControlCharacters(rawText));
    if (!text || !hasReadableManual51jobText(text)) {
      return {
        result: {
          ...fileResultBase(file),
          status: "failed",
          error: "PDF text extraction produced unusable content",
          warnings: [],
        },
        resume: null,
      };
    }

    return buildImportedResumeCandidate(file, text, []);
  } catch (error) {
    return {
      result: {
        ...fileResultBase(file),
        status: "failed",
        error: error instanceof Error ? error.message : String(error),
        warnings: [],
      },
      resume: null,
    };
  } finally {
    await parser.destroy().catch((error) => {
      console.error("Failed to destroy PDF parser", error);
    });
  }
}

async function parseResumeFile(file: EnumeratedImportFile): Promise<ParsedImportCandidate> {
  if (!isSupportedResumeFile(file.entryPath)) {
    return {
      result: {
        ...fileResultBase(file),
        status: "skipped",
        error: "Unsupported file type",
        warnings: [],
      },
      resume: null,
    };
  }

  if (file.extension === ".doc") {
    return {
      result: {
        ...fileResultBase(file),
        status: "failed",
        error: "Legacy .doc parsing is not supported yet",
        warnings: [],
      },
      resume: null,
    };
  }

  if (file.extension === ".docx") {
    return parseDocxFile(file);
  }

  return parsePdfFile(file);
}

function buildSummary(
  uploadedFiles: number,
  discoveredFiles: number,
  parsedResumes: number,
  submitSummary: ResumeSubmitSummary,
  fileResults: ManualResumeImportFileResult[],
): ManualResumeImportSummary {
  const skipped = fileResults.filter((file) => file.status === "skipped").length;
  const failed = fileResults.filter((file) => file.status === "failed").length;

  return {
    uploadedFiles,
    discoveredFiles,
    parsedResumes,
    imported: submitSummary.submitted,
    inserted: submitSummary.inserted,
    updated: submitSummary.updated,
    unchanged: submitSummary.unchanged,
    deduped: submitSummary.deduped,
    skipped,
    failed,
  };
}

export async function importManualResumes(input: ManualResumeImportInput): Promise<ResumeManualImportResponse> {
  const metadata = buildBaseMetadata(input);
  const { entries: enumeratedFiles, fileResults } = await enumerateUploadedFiles(input.files);
  const resumes: ResumeImportItem[] = [];
  const warnings: string[] = [];

  const parsedFiles = await mapInBatches(enumeratedFiles, parseResumeFile);

  for (const parsed of parsedFiles) {
    fileResults.push(parsed.result);
    if (parsed.result.warnings.length > 0) {
      warnings.push(...parsed.result.warnings.map((warning) => `${parsed.result.entryPath}: ${warning}`));
    }
    if (parsed.resume) {
      resumes.push(parsed.resume);
    }
  }

  const submitSummary: ResumeSubmitSummary = resumes.length > 0
    ? await submitNormalizedResumeImport(normalizeResumeImportPayload({
      metadata: {
        ...metadata,
        totalResumes: resumes.length,
      },
      resumes,
    }))
    : { success: true, submitted: 0, inserted: 0, updated: 0, unchanged: 0, deduped: 0 };

  return ResumeManualImportResponseSchema.parse({
    success: true,
    source: {
      key: MANUAL_SOURCE_KEY,
      label: MANUAL_SOURCE_KEY,
    },
    summary: buildSummary(input.files.length, enumeratedFiles.length, resumes.length, submitSummary, fileResults),
    files: fileResults,
    warnings: Array.from(new Set(warnings)),
  });
}

export function getManualResumeImportMaxUploadBytes(): number {
  return MAX_UPLOAD_REQUEST_SIZE;
}
