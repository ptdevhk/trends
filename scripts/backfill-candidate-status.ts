#!/usr/bin/env -S npx tsx
/**
 * One-time migration: sync SQLite candidate_actions → Convex candidate_status.
 *
 * For each resume_id in SQLite candidate_actions, finds the latest action,
 * maps it to a Convex status, and upserts into Convex candidate_status.
 *
 * Idempotent — safe to run multiple times. Existing Convex entries are skipped
 * when their updatedAt is newer than the SQLite action timestamp.
 *
 * Usage:
 *   npx tsx scripts/backfill-candidate-status.ts [--dry-run] [--workspace dev]
 */

import Database from "better-sqlite3";
import { ConvexHttpClient } from "convex/browser";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { api } from "../packages/convex/convex/_generated/api.js";
import { parsePositiveInteger } from "./resume/operator-utils.ts";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.resolve(__dirname, "..");
const DEFAULT_WORKSPACE_SLUG = "dev";
const DEFAULT_MAX_ROWS = 10_000;
const DEFAULT_BATCH_SIZE = 50;
const DEFAULT_SLEEP_MS = 100;
const DEFAULT_REPORT_DIR = path.join(PROJECT_ROOT, "output", "backfill-reports");

const ACTION_TO_STATUS: Record<string, "new" | "shortlisted" | "rejected"> = {
  shortlist: "shortlisted",
  reject: "rejected",
  star: "new",
};

export interface LatestAction {
  resume_id: string;
  action_type: string;
  created_at: string;
}

export interface BackfillCandidate {
  identityKey: string;
  actionType: keyof typeof ACTION_TO_STATUS;
  status: (typeof ACTION_TO_STATUS)[keyof typeof ACTION_TO_STATUS];
  actedAt: string;
}

interface BackfillSkipped {
  unsupportedAction: number;
  missingResumeId: number;
}

export interface BackfillPlan {
  candidates: BackfillCandidate[];
  intended: number;
  skipped: BackfillSkipped;
  byAction: Partial<Record<keyof typeof ACTION_TO_STATUS, number>>;
  byStatus: Partial<Record<BackfillCandidate["status"], number>>;
}

export interface BackfillReportOptions {
  outputDir: string;
  timestamp: string;
  dryRun: boolean;
  workspaceSlug: string;
  plan: BackfillPlan;
  writes: number;
  errors: number;
  skippedExisting?: number;
}

export interface BackfillWriteOptions {
  candidates: BackfillCandidate[];
  workspaceSlug: string;
  writeSecret: string;
  batchSize: number;
  sleepMs: number;
  mutate: CandidateStatusMutate;
  getExistingStatus?: CandidateStatusLookup;
  sleep?: (ms: number) => Promise<void>;
}

interface CliOptions {
  dryRun: boolean;
  workspaceSlug: string;
  maxRows: number;
  batchSize: number;
  sleepMs: number;
  dbPath: string;
  reportDir: string;
}

interface CandidateStatusMutationArgs {
  workspaceSlug: string;
  identityKey: string;
  status: BackfillCandidate["status"];
  updatedBy: string;
  writeSecret: string;
}

interface ExistingCandidateStatus {
  status?: string;
  updatedAt?: number;
}

export type CandidateStatusMutate = (args: CandidateStatusMutationArgs) => Promise<unknown>;
export type CandidateStatusLookup = (candidate: BackfillCandidate) => Promise<ExistingCandidateStatus | null | undefined>;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readStringField(row: Record<string, unknown>, field: keyof LatestAction): string | undefined {
  const value = row[field];
  if (typeof value === "string") {
    return value;
  }
  if (typeof value === "number") {
    return String(value);
  }
  return undefined;
}

function parseLatestActionRow(row: unknown): LatestAction | undefined {
  if (!isRecord(row)) {
    return undefined;
  }
  const resumeId = readStringField(row, "resume_id");
  const actionType = readStringField(row, "action_type");
  const createdAt = readStringField(row, "created_at");
  if (!resumeId || !actionType || !createdAt) {
    return undefined;
  }
  return {
    resume_id: resumeId,
    action_type: actionType,
    created_at: createdAt,
  };
}

function timestampOf(value: string): number {
  const parsed = Date.parse(value);
  return Number.isNaN(parsed) ? 0 : parsed;
}

function incrementCounter<T extends string>(counter: Partial<Record<T, number>>, key: T): void {
  counter[key] = (counter[key] ?? 0) + 1;
}

function isSupportedAction(value: string): value is keyof typeof ACTION_TO_STATUS {
  return value in ACTION_TO_STATUS;
}

function readCliValue(argv: string[], name: string): string | undefined {
  const index = argv.indexOf(name);
  if (index < 0) {
    return undefined;
  }
  return argv[index + 1];
}

function parseRequiredPositiveInteger(raw: string | undefined, fallback: number, label: string): number {
  const parsed = parsePositiveInteger(raw ?? String(fallback));
  if (parsed === undefined) {
    throw new Error(`${label} must be a positive integer`);
  }
  return parsed;
}

function parseCliOptions(argv: string[]): CliOptions {
  return {
    dryRun: argv.includes("--dry-run"),
    workspaceSlug: readCliValue(argv, "--workspace") ?? DEFAULT_WORKSPACE_SLUG,
    maxRows: parseRequiredPositiveInteger(readCliValue(argv, "--max-rows"), DEFAULT_MAX_ROWS, "--max-rows"),
    batchSize: parseRequiredPositiveInteger(readCliValue(argv, "--batch-size"), DEFAULT_BATCH_SIZE, "--batch-size"),
    sleepMs: parseRequiredPositiveInteger(readCliValue(argv, "--sleep-ms"), DEFAULT_SLEEP_MS, "--sleep-ms"),
    dbPath: readCliValue(argv, "--db") ?? path.join(PROJECT_ROOT, "output", "resume_screening.db"),
    reportDir: readCliValue(argv, "--report-dir") ?? DEFAULT_REPORT_DIR,
  };
}

function resolveConvexUrl(): string {
  const url = process.env.CONVEX_URL ?? process.env.VITE_CONVEX_URL;
  if (url) return url;
  for (const file of [".env.local", ".env"]) {
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
  const writeSecret = process.env.CONVEX_WRITE_SECRET?.trim();
  if (!writeSecret) {
    throw new Error("CONVEX_WRITE_SECRET is required for live candidate_status writes");
  }
  return writeSecret;
}

function parseExistingCandidateStatus(value: unknown): ExistingCandidateStatus | null {
  if (!isRecord(value)) {
    return null;
  }
  const status = typeof value.status === "string" ? value.status : undefined;
  const updatedAt = typeof value.updatedAt === "number" ? value.updatedAt : undefined;
  return { status, updatedAt };
}

function readLatestActions(dbPath: string): LatestAction[] {
  const db = new Database(dbPath, { readonly: true });

  try {
    return db
      .prepare(
        `SELECT resume_id, action_type, created_at
         FROM candidate_actions
         ORDER BY created_at DESC`
      )
      .all()
      .map((row) => parseLatestActionRow(row))
      .filter((row): row is LatestAction => row !== undefined);
  } finally {
    db.close();
  }
}

export function createBackfillPlan(
  latestActions: LatestAction[],
  options: { maxRows: number },
): BackfillPlan {
  // Deduplicate: keep only the latest action per resume_id
  const byResume = new Map<string, LatestAction>();
  for (const row of latestActions) {
    const identityKey = row.resume_id.trim();
    if (!identityKey) {
      continue;
    }
    const previous = byResume.get(identityKey);
    if (!previous || timestampOf(row.created_at) > timestampOf(previous.created_at)) {
      byResume.set(identityKey, row);
    }
  }

  const candidates: BackfillCandidate[] = [];
  const skipped: BackfillSkipped = {
    unsupportedAction: 0,
    missingResumeId: latestActions.filter((row) => row.resume_id.trim().length === 0).length,
  };
  const byAction: BackfillPlan["byAction"] = {};
  const byStatus: BackfillPlan["byStatus"] = {};

  for (const [identityKey, row] of byResume) {
    if (!isSupportedAction(row.action_type)) {
      skipped.unsupportedAction += 1;
      continue;
    }
    const status = ACTION_TO_STATUS[row.action_type];
    incrementCounter(byAction, row.action_type);
    incrementCounter(byStatus, status);
    candidates.push({
      identityKey,
      actionType: row.action_type,
      status,
      actedAt: row.created_at,
    });
  }

  candidates.sort((a, b) => a.identityKey.localeCompare(b.identityKey));

  if (candidates.length > options.maxRows) {
    throw new Error(`Backfill exceeds max rows sanity limit: ${candidates.length} > ${options.maxRows}`);
  }

  return {
    candidates,
    intended: candidates.length,
    skipped,
    byAction,
    byStatus,
  };
}

export function writeBackfillReport(options: BackfillReportOptions): { path: string } {
  mkdirSync(options.outputDir, { recursive: true });
  const timestampSlug = options.timestamp.replace(/[:.]/g, "-");
  const reportPath = path.join(options.outputDir, `candidate-status-${timestampSlug}.json`);
  const payload = {
    generatedAt: options.timestamp,
    dryRun: options.dryRun,
    workspaceSlug: options.workspaceSlug,
    intended: options.plan.intended,
    writes: options.writes,
    errors: options.errors,
    skippedExisting: options.skippedExisting ?? 0,
    skipped: options.plan.skipped,
    byAction: options.plan.byAction,
    byStatus: options.plan.byStatus,
    candidates: options.plan.candidates,
  };
  writeFileSync(reportPath, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
  return { path: reportPath };
}

async function defaultSleep(ms: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

function shouldSkipExisting(candidate: BackfillCandidate, existing: ExistingCandidateStatus | null | undefined): boolean {
  if (!existing) {
    return false;
  }
  const actedAt = timestampOf(candidate.actedAt);
  if (typeof existing.updatedAt === "number" && existing.updatedAt >= actedAt) {
    return true;
  }
  return actedAt === 0 && existing.status === candidate.status;
}

export async function runCandidateStatusWrites(options: BackfillWriteOptions): Promise<{ writes: number; errors: number; skippedExisting: number }> {
  let writes = 0;
  let errors = 0;
  let skippedExisting = 0;
  const sleep = options.sleep ?? defaultSleep;

  for (let index = 0; index < options.candidates.length; index += options.batchSize) {
    const chunk = options.candidates.slice(index, index + options.batchSize);
    for (const candidate of chunk) {
      try {
        if (options.getExistingStatus) {
          const existing = await options.getExistingStatus(candidate);
          if (shouldSkipExisting(candidate, existing)) {
            skippedExisting += 1;
            continue;
          }
        }

        await options.mutate({
          workspaceSlug: options.workspaceSlug,
          identityKey: candidate.identityKey,
          status: candidate.status,
          updatedBy: "backfill-script",
          writeSecret: options.writeSecret,
        });
        writes += 1;
      } catch (error) {
        console.error(
          `candidate_status backfill failed for ${candidate.identityKey}: ${error instanceof Error ? error.message : String(error)}`
        );
        errors += 1;
      }
    }

    const hasMore = index + options.batchSize < options.candidates.length;
    if (hasMore && options.sleepMs > 0) {
      await sleep(options.sleepMs);
    }
  }

  return { writes, errors, skippedExisting };
}

async function main(): Promise<void> {
  const options = parseCliOptions(process.argv.slice(2));
  const latestActions = readLatestActions(options.dbPath);
  const plan = createBackfillPlan(latestActions, { maxRows: options.maxRows });

  let writes = 0;
  let errors = 0;
  let skippedExisting = 0;

  if (!options.dryRun && plan.intended > 0) {
    const convexUrl = resolveConvexUrl();
    const writeSecret = resolveWriteSecret();
    const client = new ConvexHttpClient(convexUrl);
    const result = await runCandidateStatusWrites({
      candidates: plan.candidates,
      workspaceSlug: options.workspaceSlug,
      writeSecret,
      batchSize: options.batchSize,
      sleepMs: options.sleepMs,
      mutate: async (args) => await client.mutation(api.candidate_status.upsert, args),
      getExistingStatus: async (candidate) => parseExistingCandidateStatus(await client.query(api.candidate_status.getByIdentity, {
        workspaceSlug: options.workspaceSlug,
        identityKey: candidate.identityKey,
      })),
    });
    writes = result.writes;
    errors = result.errors;
    skippedExisting = result.skippedExisting;
  }

  const report = writeBackfillReport({
    outputDir: options.reportDir,
    timestamp: new Date().toISOString(),
    dryRun: options.dryRun,
    workspaceSlug: options.workspaceSlug,
    plan,
    writes,
    errors,
    skippedExisting,
  });

  console.log(JSON.stringify({
    success: errors === 0,
    dryRun: options.dryRun,
    workspaceSlug: options.workspaceSlug,
    intended: plan.intended,
    writes,
    errors,
    skippedExisting,
    skipped: plan.skipped,
    report: report.path,
  }, null, 2));

  if (errors > 0) {
    process.exitCode = 1;
  }
}

const isMainModule = process.argv[1]
  ? path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url))
  : false;

if (isMainModule) {
  void main().catch((error) => {
    console.error(error instanceof Error ? error.stack || error.message : String(error));
    process.exitCode = 1;
  });
}
