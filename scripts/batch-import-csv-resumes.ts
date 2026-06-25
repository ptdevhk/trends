#!/usr/bin/env -S npx tsx
/**
 * Import resumes from a CSV export directly into Convex.
 *
 * Constructs minimal resume documents from CSV data and submits them
 * via the resume_tasks:submitResumes mutation, which handles dedup
 * by externalId + source.
 *
 * Usage:
 *   npx tsx scripts/batch-import-csv-resumes.ts <csv-path> [options]
 *
 * Options:
 *   --dry-run          Preview without importing (default; pass --no-dry-run to execute)
 */

import { ConvexHttpClient } from "convex/browser";
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { api } from "../packages/convex/convex/_generated/api.js";

declare const process: NodeJS.Process;

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.resolve(__dirname, "..");

interface CsvRow {
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

function parseCliOptions(argv: string[]): { csvPath: string; dryRun: boolean } {
  const csvPath = argv.find((a) => !a.startsWith("--"));
  if (!csvPath) {
    console.error("Usage: batch-import-csv-resumes.ts <csv-path> [--no-dry-run]");
    process.exit(1);
  }
  return { csvPath, dryRun: !argv.includes("--no-dry-run") };
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

function readCsvRows(csvPath: string): CsvRow[] {
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

function buildExternalId(row: CsvRow): string {
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

function resolveConvexUrl(): string {
  const url = process.env.CONVEX_URL ?? process.env.VITE_CONVEX_URL;
  if (url) return url;
  for (const file of [".env.local", ".env", ".env.production"]) {
    try {
      const content = readFileSync(path.join(PROJECT_ROOT, file), "utf-8");
      const match = content.match(/^CONVEX_URL=(.+)$/m);
      if (match) return match[1].trim();
    } catch { /* file doesn't exist */ }
  }
  throw new Error("CONVEX_URL not found");
}

async function main(): Promise<void> {
  const { csvPath, dryRun } = parseCliOptions(process.argv.slice(2));
  const rows = readCsvRows(csvPath);

  const resumes = rows.map((row) => {
    const content: Record<string, unknown> = { name: row.name, location: row.location };
    if (row.education) content.education = row.education;
    if (row.age) content.age = row.age;
    if (row.expectedSalary) content.expectedSalary = row.expectedSalary;
    if (row.profileUrl) content.profileUrl = row.profileUrl;
    if (row.workHistory) content.workHistory = row.workHistory;
    if (row.selfIntro) content.selfIntro = row.selfIntro;

    return {
      externalId: buildExternalId(row),
      content,
      hash: createHash("sha256").update(JSON.stringify(content)).digest("hex").slice(0, 32),
      source: "csv-import",
      tags: ["csv-import", "batch-reject"],
    };
  });

  console.log(`CSV: ${csvPath}`);
  console.log(`Resumes: ${resumes.length}`);
  console.log(`Mode: ${dryRun ? "dry-run" : "execute"}`);
  console.log("---");

  if (dryRun) {
    console.log("DRY RUN — first 5 entries:");
    for (const r of resumes.slice(0, 5)) {
      console.log(`  ${r.externalId} -> ${r.content.name}`);
    }
    console.log(`\nTotal: ${resumes.length} resumes would be imported via resume_tasks:submitResumes.`);
    console.log("Run with --no-dry-run to execute.");
    return;
  }

  const convexUrl = resolveConvexUrl();
  const client = new ConvexHttpClient(convexUrl);

  console.log(`Convex: ${convexUrl}`);
  console.log(`Submitting ${resumes.length} resumes...`);

  const result = await client.mutation(api.resume_tasks.submitResumes, { resumes });

  console.log("\nResult:");
  console.log(JSON.stringify(result, null, 2));
}

void main().catch((error) => {
  console.error(error instanceof Error ? error.stack || error.message : String(error));
  process.exitCode = 1;
});
