#!/usr/bin/env -S npx tsx
/**
 * One-time migration: sync SQLite candidate_actions → Convex candidate_status.
 *
 * For each resume_id in SQLite candidate_actions, finds the latest action,
 * maps it to a Convex status, and upserts into Convex candidate_status.
 *
 * Idempotent — safe to run multiple times. Existing Convex entries are
 * overwritten only if the SQLite action is newer.
 *
 * Usage:
 *   npx tsx scripts/backfill-candidate-status.ts [--dry-run] [--workspace dev]
 */

import Database from "better-sqlite3";
import { ConvexHttpClient } from "convex/browser";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { api } from "../packages/convex/convex/_generated/api.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.resolve(__dirname, "..");

const ACTION_TO_STATUS: Record<string, "new" | "shortlisted" | "rejected"> = {
  shortlist: "shortlisted",
  reject: "rejected",
  star: "new",
};

interface LatestAction {
  resume_id: string;
  action_type: string;
  created_at: string;
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

async function main() {
  const dryRun = process.argv.includes("--dry-run");
  const workspaceIdx = process.argv.indexOf("--workspace");
  const workspaceSlug = workspaceIdx >= 0 ? process.argv[workspaceIdx + 1] : "dev";

  const dbPath = path.join(PROJECT_ROOT, "output", "resume_screening.db");
  const db = new Database(dbPath, { readonly: true });

  const latestActions = db
    .prepare(
      `SELECT resume_id, action_type, created_at
       FROM candidate_actions
       WHERE action_type IN ('shortlist', 'reject', 'star')
       ORDER BY created_at DESC`
    )
    .all() as LatestAction[];

  // Deduplicate: keep only the latest action per resume_id
  const byResume = new Map<string, LatestAction>();
  for (const row of latestActions) {
    if (!byResume.has(row.resume_id)) {
      byResume.set(row.resume_id, row);
    }
  }

  const candidates = [...byResume.values()].filter(
    (r) => ACTION_TO_STATUS[r.action_type]
  );

  console.log(`Found ${candidates.length} candidates with actions to backfill.`);
  console.log(`Workspace: ${workspaceSlug}, Dry-run: ${dryRun}`);

  if (candidates.length === 0) {
    console.log("Nothing to backfill.");
    db.close();
    return;
  }

  if (dryRun) {
    for (const c of candidates) {
      console.log(`  [dry-run] ${c.resume_id}: ${c.action_type} → ${ACTION_TO_STATUS[c.action_type]}`);
    }
    db.close();
    console.log(`\nDry-run complete. ${candidates.length} candidates would be backfilled.`);
    return;
  }

  const convexUrl = resolveConvexUrl();
  const client = new ConvexHttpClient(convexUrl);

  let upserted = 0;
  let errors = 0;

  for (const candidate of candidates) {
    const status = ACTION_TO_STATUS[candidate.action_type];
    if (!status) continue;

    try {
      await client.mutation(api.candidate_status.upsert, {
        identityKey: candidate.resume_id,
        status,
        workspaceSlug,
        updatedBy: "backfill-script",
      });
      upserted++;
      if (upserted % 10 === 0) {
        console.log(`  Progress: ${upserted}/${candidates.length}`);
      }
    } catch (error) {
      console.error(
        `  Error: ${candidate.resume_id}: ${error instanceof Error ? error.message : error}`
      );
      errors++;
    }
  }

  db.close();
  console.log(`\nBackfill complete: ${upserted} upserted, ${errors} errors.`);
}

main().catch((error) => {
  console.error("Fatal:", error);
  process.exit(1);
});
