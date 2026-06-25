#!/usr/bin/env -S npx tsx
/**
 * Batch-reject candidates from a CSV export.
 *
 * The CSV Resume IDs (Convex _id) may not match prod if exported from
 * a different instance. This script matches by candidate NAME instead.
 *
 * Usage:
 *   npx tsx scripts/batch-reject-candidates.ts <csv-path> [options]
 *
 * Options:
 *   --verify           Match names against prod (read-only, no write secret needed)
 *   --dry-run          Preview without writing (default; pass --no-dry-run to execute)
 *   --workspace <slug> Workspace slug (default: dev)
 *   --reason <text>    Rejection reason stored in notes
 *   --batch-size <n>   Writes per batch (default: 50)
 *   --sleep-ms <n>     Pause between batches (default: 100)
 */

import { ConvexHttpClient } from "convex/browser";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { api } from "../packages/convex/convex/_generated/api.js";

// The search function lives under resumes_search, not resumes
const searchApi = api.resumes_search as typeof api.resumes_search;

declare const process: NodeJS.Process;

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.resolve(__dirname, "..");

const DEFAULT_WORKSPACE = "hr";
const DEFAULT_BATCH_SIZE = 50;
const DEFAULT_SLEEP_MS = 100;

interface CsvRow {
  resumeId: string;
  name: string;
  location: string;
  profileUrl: string;
}

interface MatchResult {
  csvRow: CsvRow;
  prodIdentityKey: string | null;
  prodStatus: string | null;
  matchMethod: "name" | "none";
}

interface CliOptions {
  csvPath: string;
  verify: boolean;
  dryRun: boolean;
  workspace: string;
  reason: string;
  batchSize: number;
  sleepMs: number;
}

function parseCliOptions(argv: string[]): CliOptions {
  const csvPath = argv.find((a) => !a.startsWith("--"));
  if (!csvPath) {
    console.error("Usage: batch-reject-candidates.ts <csv-path> [options]");
    process.exit(1);
  }

  function flag(name: string): string | undefined {
    const idx = argv.indexOf(name);
    return idx >= 0 ? argv[idx + 1] : undefined;
  }

  return {
    csvPath,
    verify: argv.includes("--verify"),
    dryRun: !argv.includes("--no-dry-run"),
    workspace: flag("--workspace") ?? DEFAULT_WORKSPACE,
    reason: flag("--reason") ?? "batch-rejected from CSV export",
    batchSize: Number(flag("--batch-size") ?? DEFAULT_BATCH_SIZE),
    sleepMs: Number(flag("--sleep-ms") ?? DEFAULT_SLEEP_MS),
  };
}

function readCsvRows(csvPath: string): CsvRow[] {
  const content = readFileSync(csvPath, "utf-8");
  const lines = content.split("\n").filter((line) => line.trim().length > 0);
  if (lines.length < 2) {
    throw new Error("CSV has no data rows");
  }

  // Parse with proper quote handling
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

  const rows: CsvRow[] = [];
  for (let i = 1; i < lines.length; i++) {
    const fields = parseCsvLine(lines[i]);
    rows.push({
      resumeId: fields[0]?.trim() ?? "",
      name: fields[1]?.trim() ?? "",
      location: fields[3]?.trim() ?? "",
      profileUrl: fields[18]?.trim() ?? "",
    });
  }
  return rows.filter((r) => r.name.length > 0);
}

function resolveConvexUrl(): string {
  const url = process.env.CONVEX_URL ?? process.env.VITE_CONVEX_URL;
  if (url) return url;
  for (const file of [".env.local", ".env", ".env.production"]) {
    try {
      const content = readFileSync(path.join(PROJECT_ROOT, file), "utf-8");
      const match = content.match(/^CONVEX_URL=(.+)$/m);
      if (match) return match[1].trim();
    } catch {
      // file doesn't exist
    }
  }
  throw new Error("CONVEX_URL not found in env or .env files");
}

function resolveWriteSecret(): string {
  const secret = process.env.CONVEX_WRITE_SECRET?.trim();
  if (!secret) {
    throw new Error("CONVEX_WRITE_SECRET is required for writes");
  }
  return secret;
}

async function sleepMsFn(ms: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

type StatusResult = { identityKey?: string; status?: string; updatedAt?: number } | null;

function buildExternalId(name: string, profileUrl: string): string {
  if (profileUrl.includes("seek.com")) {
    try {
      const url = new URL(profileUrl);
      const query = url.searchParams.get("searchQuery");
      if (query) return `seek:name:${decodeURIComponent(query).toLowerCase().trim()}`;
    } catch { /* fall through */ }
  }
  return `csv-import:${name.toLowerCase().trim()}`;
}

async function findProdIdentityKey(
  client: ConvexHttpClient,
  workspaceSlug: string,
  name: string,
  profileUrl: string,
  csvId: string,
): Promise<{ identityKey: string; status?: string; source: "search" | "externalId" } | null> {
  // Try search first
  try {
    const result = await client.query(searchApi.searchWithTagExpansion, {
      query: name,
      keywordGroups: [{ original: name, variants: [name] }],
      limit: 5,
    }) as { results: Array<{ resume: { _id: string; content?: { name?: string }; identityKey?: string } }> };

    if (result?.results?.length > 0) {
      const exact = result.results.find(
        (r) => (r.resume as any)?.content?.name?.toLowerCase().trim() === name.toLowerCase().trim()
      );
      if (exact?.resume) {
        const identityKey = (exact.resume as any).identityKey?.trim() || exact.resume._id;
        const existing = await client.query(api.candidate_status.getByIdentity, {
          workspaceSlug,
          identityKey,
        }) as StatusResult;
        return { identityKey, status: existing?.status, source: "search" };
      }
    }
  } catch { /* fall through to externalId */ }

  // Fallback: use externalId + csvId as identityKey (for newly imported resumes)
  // Preserves original CSV Resume ID for tracing
  const externalId = buildExternalId(name, profileUrl);
  const identityKey = `externalId:${externalId}:csvId:${csvId}`;
  try {
    const existing = await client.query(api.candidate_status.getByIdentity, {
      workspaceSlug,
      identityKey,
    }) as StatusResult;
    return { identityKey, status: existing?.status, source: "externalId" };
  } catch {
    return { identityKey, status: undefined, source: "externalId" };
  }
}

async function main(): Promise<void> {
  const options = parseCliOptions(process.argv.slice(2));
  const csvRows = readCsvRows(options.csvPath);

  console.log(`CSV: ${options.csvPath}`);
  console.log(`Candidates in CSV: ${csvRows.length}`);
  console.log(`Workspace: ${options.workspace}`);
  console.log(`Mode: ${options.verify ? "verify" : options.dryRun ? "dry-run" : "execute"}`);
  if (!options.verify) console.log(`Reason: ${options.reason}`);
  console.log("---");

  const convexUrl = resolveConvexUrl();
  const client = new ConvexHttpClient(convexUrl);

  // ---- VERIFY MODE: match names against prod ----
  if (options.verify) {
    const matches: MatchResult[] = [];
    let matched = 0;
    let notFound = 0;
    let alreadyRejected = 0;

    for (let i = 0; i < csvRows.length; i++) {
      const row = csvRows[i];
      const found = await findProdIdentityKey(client, options.workspace, row.name, row.profileUrl, row.resumeId);

      if (found) {
        matched++;
        if (found.status === "rejected") {
          alreadyRejected++;
        }
        matches.push({
          csvRow: row,
          prodIdentityKey: found.identityKey,
          prodStatus: found.status ?? "new",
          matchMethod: "name",
        });
      } else {
        notFound++;
        matches.push({
          csvRow: row,
          prodIdentityKey: null,
          prodStatus: null,
          matchMethod: "none",
        });
      }

      if ((i + 1) % 10 === 0 || i === csvRows.length - 1) {
        process.stdout.write(
          `\r  Matched ${matched}/${i + 1} (${notFound} not found, ${alreadyRejected} already rejected)`
        );
      }
    }

    console.log("\n---");
    console.log(`Matched on prod:     ${matched}`);
    console.log(`  already rejected:  ${alreadyRejected}`);
    console.log(`  need to reject:    ${matched - alreadyRejected}`);
    console.log(`Not found on prod:   ${notFound}`);

    const unmatched = matches.filter((m) => m.matchMethod === "none");
    if (unmatched.length > 0) {
      console.log(`\nNot found on prod (${unmatched.length}):`);
      for (const m of unmatched) {
        console.log(`  ${m.csvRow.name} (CSV ID: ${m.csvRow.resumeId})`);
      }
    }

    const needReject = matches.filter(
      (m) => m.prodIdentityKey && m.prodStatus !== "rejected"
    );
    if (needReject.length > 0) {
      console.log(`\nWill be rejected (${needReject.length}):`);
      for (const m of needReject) {
        console.log(`  ${m.csvRow.name} -> identityKey: ${m.prodIdentityKey}`);
      }
    }

    console.log(`\nRun with --no-dry-run to execute (needs CONVEX_WRITE_SECRET).`);
    return;
  }

  // ---- DRY RUN (default) ----
  if (options.dryRun) {
    console.log("DRY RUN — candidates to reject:");
    for (const row of csvRows.slice(0, 10)) {
      console.log(`  ${row.name} (CSV ID: ${row.resumeId})`);
    }
    if (csvRows.length > 10) {
      console.log(`  ... and ${csvRows.length - 10} more`);
    }
    console.log(`\nTotal: ${csvRows.length} candidates.`);
    console.log("NOTE: CSV IDs may not match prod. Run --verify first to check matches.");
    console.log("Run with --no-dry-run to execute.");
    return;
  }

  // ---- EXECUTE: match by name and reject ----
  const writeSecret = resolveWriteSecret();

  let writes = 0;
  let errors = 0;
  let notFound = 0;
  let alreadyRejected = 0;

  for (let i = 0; i < csvRows.length; i += options.batchSize) {
    const chunk = csvRows.slice(i, i + options.batchSize);
    for (const row of chunk) {
      const found = await findProdIdentityKey(client, options.workspace, row.name, row.profileUrl, row.resumeId);
      if (!found) {
        notFound++;
        console.error(`\n  NOT FOUND: ${row.name} (CSV ID: ${row.resumeId})`);
        continue;
      }
      if (found.status === "rejected") {
        alreadyRejected++;
        continue;
      }

      try {
        await client.mutation(api.candidate_status.upsert, {
          workspaceSlug: options.workspace,
          identityKey: found.identityKey,
          status: "rejected",
          notes: options.reason,
          updatedBy: "batch-reject-script",
          writeSecret,
        });
        writes++;
        process.stdout.write(
          `\r  Rejected ${writes} (skipped: ${alreadyRejected} already rejected, ${notFound} not found)`
        );
      } catch (err) {
        errors++;
        console.error(
          `\n  FAILED ${row.name} (${found.identityKey}): ${err instanceof Error ? err.message : String(err)}`
        );
      }
    }

    const hasMore = i + options.batchSize < csvRows.length;
    if (hasMore && options.sleepMs > 0) {
      await sleepMsFn(options.sleepMs);
    }
  }

  console.log(`\n---\nDone. Writes: ${writes}, Already rejected: ${alreadyRejected}, Not found: ${notFound}, Errors: ${errors}`);
  if (errors > 0) {
    process.exitCode = 1;
  }
}

void main().catch((error) => {
  console.error(error instanceof Error ? error.stack || error.message : String(error));
  process.exitCode = 1;
});
