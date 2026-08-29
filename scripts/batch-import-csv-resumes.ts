#!/usr/bin/env -S npx tsx
/**
 * Import resumes from a CSV export or Seek browser-extension JSON artifact directly into Convex.
 *
 * Constructs minimal resume documents and submits them via the
 * resume_tasks:submitResumes mutation, which handles dedup by externalId + source.
 *
 * Usage:
 *   npx tsx scripts/batch-import-csv-resumes.ts <file-path> [options]
 *
 * Options:
 *   --format=csv|extension-json   Input file format (default: csv)
 *   --dry-run                     Preview without importing (default; pass --no-dry-run to execute)
 */

import { ConvexHttpClient } from "convex/browser";
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { api } from "../packages/convex/convex/_generated/api.js";
import {
  type ExtensionJsonArtifact,
  type ExtensionResumeRow,
  type SubmitResumeDocument,
  extractEducationString,
  extractLocationString,
  normalizeExtensionWorkHistory,
  resolveRowExternalId,
} from "./lib/extension-resume-mapping.js";

declare const process: NodeJS.Process;

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.resolve(__dirname, "..");

export type ImportFormat = "csv" | "extension-json";

export interface CliOptions {
  filePath: string;
  format: ImportFormat;
  dryRun: boolean;
}

export interface CsvRow {
  resumeId: string;
  name: string;
  location: string;
  education: string;
  age: string;
  expectedSalary: string;
  profileUrl: string;
  workHistory: string;
  selfIntro: string;
}

export function parseCliOptions(argv: string[]): CliOptions {
  const filePath = argv.find((a) => !a.startsWith("--"));
  if (!filePath) {
    console.error("Usage: batch-import-csv-resumes.ts <file-path> [--format=csv|extension-json] [--no-dry-run]");
    process.exit(1);
  }

  let format: ImportFormat = "csv";
  const formatArg = argv.find((a) => a.startsWith("--format="));
  if (formatArg) {
    const rawVal = formatArg.slice("--format=".length).trim().toLowerCase();
    if (rawVal === "extension-json" || rawVal === "json") {
      format = "extension-json";
    } else if (rawVal === "csv") {
      format = "csv";
    } else {
      throw new Error(`Unsupported --format: ${rawVal}. Must be 'csv' or 'extension-json'`);
    }
  }

  const dryRun = !argv.includes("--no-dry-run");
  return { filePath, format, dryRun };
}

function parseCsvLine(line: string): string[] {
  const fields: string[] = [];
  let current = "";
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      inQuotes = !inQuotes;
    } else if (ch === "," && !inQuotes) {
      fields.push(current);
      current = "";
    } else {
      current += ch;
    }
  }
  fields.push(current);
  return fields;
}

export function readCsvRows(csvPath: string): CsvRow[] {
  const content = readFileSync(csvPath, "utf-8");
  const lines = content.split("\n").filter((line) => line.trim().length > 0);
  if (lines.length < 2) throw new Error("CSV has no data rows");

  const rows: CsvRow[] = [];
  for (let i = 1; i < lines.length; i++) {
    const f = parseCsvLine(lines[i]);
    rows.push({
      resumeId: f[0]?.trim() ?? "",
      name: f[1]?.trim() ?? "",
      location: f[3]?.trim() ?? "",
      education: f[5]?.trim() ?? "",
      age: f[6]?.trim() ?? "",
      expectedSalary: f[7]?.trim() ?? "",
      profileUrl: f[18]?.trim() ?? "",
      workHistory: f[19]?.trim() ?? "",
      selfIntro: f[20]?.trim() ?? "",
    });
  }
  return rows.filter((r) => r.name.length > 0);
}

export function buildCsvExternalId(row: CsvRow): string {
  if (row.profileUrl.includes("seek.com")) {
    try {
      const url = new URL(row.profileUrl);
      const query = url.searchParams.get("searchQuery");
      if (query) return `seek:name:${decodeURIComponent(query).toLowerCase().trim()}`;
    } catch { /* fall through */ }
  }
  const hash = createHash("sha256").update(`${row.name}|${row.location}`).digest("hex").slice(0, 16);
  return `csv-import:${hash}`;
}

export function mapCsvRowsToDocuments(rows: CsvRow[]): SubmitResumeDocument[] {
  return rows.map((row) => {
    const content: Record<string, unknown> = { name: row.name, location: row.location };
    if (row.education) content.education = row.education;
    if (row.age) content.age = row.age;
    if (row.expectedSalary) content.expectedSalary = row.expectedSalary;
    if (row.profileUrl) content.profileUrl = row.profileUrl;
    if (row.workHistory) content.workHistory = row.workHistory;
    if (row.selfIntro) content.selfIntro = row.selfIntro;

    return {
      externalId: buildCsvExternalId(row),
      content,
      hash: createHash("sha256").update(JSON.stringify(content)).digest("hex").slice(0, 32),
      source: "csv-import",
      tags: ["csv-import", "batch-reject"],
    };
  });
}

export function readExtensionJsonArtifact(jsonPath: string): {
  metadata?: ExtensionJsonArtifact["metadata"];
  resumes: ExtensionResumeRow[];
} {
  let parsed: unknown;
  try {
    const raw = readFileSync(jsonPath, "utf-8");
    parsed = JSON.parse(raw);
  } catch (err) {
    throw new Error(`Failed to parse JSON file at ${jsonPath}: ${err instanceof Error ? err.message : String(err)}`);
  }

  if (!parsed || typeof parsed !== "object") {
    throw new Error("Invalid JSON artifact: top-level value must be an object or array");
  }

  let resumes: ExtensionResumeRow[] = [];
  let metadata: ExtensionJsonArtifact["metadata"];

  if (Array.isArray(parsed)) {
    resumes = parsed as ExtensionResumeRow[];
  } else {
    const obj = parsed as ExtensionJsonArtifact;
    metadata = obj.metadata;
    if (Array.isArray(obj.resumes)) {
      resumes = obj.resumes;
    } else if (Array.isArray(obj.data)) {
      resumes = obj.data as ExtensionResumeRow[];
    }
  }

  if (!resumes || resumes.length === 0) {
    throw new Error("Invalid JSON artifact: no resume rows found (expected metadata.resumes or resumes array with >=1 row)");
  }

  return { metadata, resumes };
}

export function mapExtensionJsonToDocuments(
  artifact: { metadata?: ExtensionJsonArtifact["metadata"]; resumes: ExtensionResumeRow[] },
): { documents: SubmitResumeDocument[]; skippedDuplicates: string[] } {
  const source = artifact.metadata?.sourceKey || artifact.metadata?.source || "seek";
  const defaultTag = artifact.metadata?.searchProfileId || artifact.metadata?.keyword;
  const baseTags = defaultTag ? [String(defaultTag).trim(), "extension-import"] : ["seek", "extension-import"];

  const seenExternalIds = new Set<string>();
  const skippedDuplicates: string[] = [];
  const documents: SubmitResumeDocument[] = [];

  for (const row of artifact.resumes) {
    const rawExternalId = resolveRowExternalId(row);
    if (!rawExternalId) {
      console.warn(`[WARN] Skipping row without externalId/profileId/seekProfileGuid: ${JSON.stringify(row.name ?? "unnamed")}`);
      continue;
    }

    const externalId = String(rawExternalId).trim();
    if (seenExternalIds.has(externalId)) {
      skippedDuplicates.push(externalId);
      continue;
    }
    seenExternalIds.add(externalId);

    const name = typeof row.name === "string" ? row.name.trim() : "";
    const location = extractLocationString(row.location);
    const education = extractEducationString(row.education);
    const age = row.age !== undefined && row.age !== null && row.age !== "" ? row.age : undefined;
    const expectedSalary = row.expectedSalary !== undefined && row.expectedSalary !== null && row.expectedSalary !== "" ? row.expectedSalary : undefined;
    const profileUrl = typeof row.profileUrl === "string" ? row.profileUrl.trim() : undefined;
    const workHistory = row.workHistory !== undefined ? normalizeExtensionWorkHistory(row.workHistory) : undefined;
    const selfIntro = typeof row.selfIntro === "string" ? row.selfIntro.trim() : undefined;

    const content: Record<string, unknown> = {
      ...(name ? { name } : {}),
      ...(location ? { location } : {}),
      ...(education ? { education } : {}),
      ...(age !== undefined ? { age } : {}),
      ...(expectedSalary !== undefined ? { expectedSalary } : {}),
      ...(profileUrl ? { profileUrl } : {}),
      ...(workHistory !== undefined ? { workHistory } : {}),
      ...(selfIntro ? { selfIntro } : {}),
      ...(row.experience ? { experience: row.experience } : {}),
      ...(row.jobIntention ? { jobIntention: row.jobIntention } : {}),
      ...(row.language ? { language: row.language } : {}),
      ...(row.activityStatus ? { activityStatus: row.activityStatus } : {}),
      ...(row.extractedAt ? { extractedAt: row.extractedAt } : {}),
      ...(row.pageIndex !== undefined ? { pageIndex: row.pageIndex } : {}),
      ...(row.pageNumber !== undefined ? { pageNumber: row.pageNumber } : {}),
      ...(row.profileType ? { profileType: row.profileType } : {}),
      ...(row.searchProfileId ? { searchProfileId: row.searchProfileId } : {}),
    };

    const hash = createHash("sha256").update(JSON.stringify(content)).digest("hex").slice(0, 32);
    const itemSource = row.source ? String(row.source).trim() : source;

    documents.push({
      externalId,
      content,
      hash,
      source: itemSource,
      tags: baseTags,
    });
  }

  return { documents, skippedDuplicates };
}

export function isProductionConvexUrl(url: string): boolean {
  if (!url || typeof url !== "string") return false;
  const trimmed = url.trim().toLowerCase();

  // Any URL with pt-mes but without preview is considered production
  if (trimmed.includes("pt-mes") && !trimmed.includes("preview")) {
    return true;
  }

  // Explicit production domain check
  if (trimmed.includes("trends.pt-mes.com")) {
    return true;
  }

  return false;
}

export function assertSafeNonProductionTarget(convexUrl: string | undefined): void {
  if (!convexUrl || convexUrl.trim().length === 0) {
    throw new Error("PROD GUARD REFUSAL: CONVEX_URL is not set or empty. Ingestion requires an explicit non-prod CONVEX_URL.");
  }

  if (isProductionConvexUrl(convexUrl)) {
    throw new Error(`PROD GUARD REFUSAL: CONVEX_URL '${convexUrl}' matches production target. Batch import refuses to execute on production.`);
  }
}

export function resolveConvexUrl(): string {
  const url = process.env.CONVEX_URL ?? process.env.VITE_CONVEX_URL;
  if (url) return url;
  for (const file of [".env.local", ".env", ".env.preview", ".env.production"]) {
    try {
      const content = readFileSync(path.join(PROJECT_ROOT, file), "utf-8");
      const match = content.match(/^CONVEX_URL=(.+)$/m);
      if (match) return match[1].trim();
    } catch { /* file doesn't exist */ }
  }
  throw new Error("CONVEX_URL not found");
}

async function main(): Promise<void> {
  const { filePath, format, dryRun } = parseCliOptions(process.argv.slice(2));

  let resumes: SubmitResumeDocument[] = [];
  let skippedDuplicates: string[] = [];

  if (format === "extension-json") {
    const artifact = readExtensionJsonArtifact(filePath);
    const mapped = mapExtensionJsonToDocuments(artifact);
    resumes = mapped.documents;
    skippedDuplicates = mapped.skippedDuplicates;
  } else {
    const rows = readCsvRows(filePath);
    resumes = mapCsvRowsToDocuments(rows);
  }

  console.log(`Input file: ${filePath}`);
  console.log(`Format: ${format}`);
  console.log(`Resumes prepared: ${resumes.length}`);
  if (skippedDuplicates.length > 0) {
    console.log(`Skipped duplicate externalIds (${skippedDuplicates.length}): ${skippedDuplicates.join(", ")}`);
  }
  console.log(`Mode: ${dryRun ? "dry-run" : "execute"}`);
  console.log("---");

  if (dryRun) {
    console.log("DRY RUN — first 5 entries:");
    for (const r of resumes.slice(0, 5)) {
      console.log(`  [${r.source}] ${r.externalId} -> ${r.content.name ?? "unnamed"}`);
    }
    console.log(`\nTotal: ${resumes.length} resumes would be imported via resume_tasks:submitResumes.`);
    console.log("Run with --no-dry-run to execute.");
    return;
  }

  const convexUrl = resolveConvexUrl();
  assertSafeNonProductionTarget(convexUrl);

  const client = new ConvexHttpClient(convexUrl);

  console.log(`Convex: ${convexUrl}`);
  console.log(`Submitting ${resumes.length} resumes...`);

  const result = await client.mutation(api.resume_tasks.submitResumes, { resumes });

  console.log("\nResult:");
  console.log(JSON.stringify(result, null, 2));
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  void main().catch((error) => {
    console.error(error instanceof Error ? error.stack || error.message : String(error));
    process.exitCode = 1;
  });
}
