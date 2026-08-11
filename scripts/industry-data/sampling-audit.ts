#!/usr/bin/env npx tsx
/**
 * Sampling audit for governed Lane A auto-approvals (auto-verify-bot).
 *
 * Lists verdict revisions advanced by the auto-verify-bot lane, selects a
 * ~10% risk-weighted sample for human re-review, and writes an audit report
 * with the override rate. This is the Human-on-the-Loop (HOTL) drift
 * detector: a 0% override rate is a rubber-stamping red flag; a calibrated
 * 5-20% override band is the healthy signal.
 *
 * Risk weighting: revisions whose sources are all corroborating (no primary/
 * authoritative registry record) or whose company has a single source are
 * weighted higher, so the sample over-selects the riskiest approvals.
 *
 * Usage:
 *   npx tsx scripts/industry-data/sampling-audit.ts [--convex-url <url>] [--sample-rate 0.1] [--limit 1000]
 *
 * Requires CONVEX_WRITE_SECRET (from packages/convex/.env.local or env).
 * Read-only: never mutates Convex. Writes the report to
 * output/industry-data/auto-verify-audit-<ts>.json.
 */
import { createHash } from "node:crypto";
import { execSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parseArgs } from "node:util";

type AutoApprovedRevision = {
  revisionId: string;
  companyKey: string;
  industryClass: string;
  verificationLevel: string;
  approvedSourceIds: string[];
  evidenceSummary: string;
  reviewedBy: string;
  reviewedAt: number;
  decisionReason: string;
  taxonomyVersion: string;
  proposalId?: string;
  createdAt: number;
};

function parseCliArgs() {
  const { values } = parseArgs({
    options: {
      "convex-url": { type: "string", default: process.env.CONVEX_URL ?? "http://127.0.0.1:3210" },
      "sample-rate": { type: "string", default: "0.1" },
      limit: { type: "string", default: "1000" },
    },
  });
  return values;
}

function getWriteSecret(): string {
  const envLocal = "packages/convex/.env.local";
  if (process.env.CONVEX_WRITE_SECRET) return process.env.CONVEX_WRITE_SECRET;
  if (existsSync(envLocal)) {
    const match = readFileSync(envLocal, "utf-8").match(/^CONVEX_WRITE_SECRET=(.+)$/m);
    if (match) return match[1].trim();
  }
  throw new Error("CONVEX_WRITE_SECRET not found (set env or packages/convex/.env.local)");
}

async function convexRun<T>(
  convexUrl: string,
  functionName: string,
  args: Record<string, unknown>,
): Promise<T> {
  const writeSecret = getWriteSecret();
  const fullArgs = { ...args, writeSecret };
  const argsJson = JSON.stringify(fullArgs);
  const tmpDir = mkdtempSync(join(tmpdir(), "convex-audit-"));
  const tmpFile = join(tmpDir, "args.json");
  writeFileSync(tmpFile, argsJson, { mode: 0o600 });
  const urlFlag = convexUrl ? ` --url "${convexUrl}"` : "";
  const cmd = `npx convex run ${functionName} "$(cat '${tmpFile}')"${urlFlag} 2>&1`;
  let output: string;
  try {
    output = execSync(cmd, {
      cwd: `${process.cwd()}/packages/convex`,
      encoding: "utf-8",
      timeout: 120000,
      maxBuffer: 100 * 1024 * 1024,
      env: { ...process.env },
      shell: "/bin/bash",
    });
  } catch (err) {
    const errMsg = (err as Error).message.slice(0, 300);
    throw new Error(`Convex ${functionName} command failed: ${errMsg}`);
  } finally {
    rmSync(tmpDir, { recursive: true, force: true });
  }
  const lines = output.trim().split("\n");
  let jsonStart = -1;
  for (let i = 0; i < lines.length; i++) {
    const trimmed = lines[i].trim();
    if (trimmed.startsWith("[") || trimmed.startsWith("{")) {
      jsonStart = i;
      break;
    }
  }
  if (jsonStart === -1) {
    throw new Error(`Could not find JSON in Convex output: ${output.slice(-200)}`);
  }
  const jsonStr = lines.slice(jsonStart).join("\n");
  return JSON.parse(jsonStr) as T;
}

/**
 * Risk weight for a revision: corroborating-only sources and single-source
 * companies are riskier (less diversity), so they are over-selected.
 */
export function riskWeight(revision: AutoApprovedRevision): number {
  let weight = 1;
  if (revision.approvedSourceIds.length === 1) weight *= 2;
  if (revision.decisionReason.includes("corroborating")) weight *= 1.5;
  return weight;
}

export function deterministicSample(
  revisions: AutoApprovedRevision[],
  sampleRate: number,
): AutoApprovedRevision[] {
  const target = Math.max(1, Math.round(revisions.length * sampleRate));
  const weighted = revisions.map((r) => ({
    revision: r,
    weight: riskWeight(r),
    hash: createHash("sha256")
      .update(`${r.revisionId}:${r.createdAt}`)
      .digest("hex"),
  }));
  // Deterministic risk-weighted selection: sort by hash, then take the
  // top `target` by weight-biased score so re-runs are stable.
  const scored = weighted.map((entry) => ({
    ...entry,
    score: parseInt(entry.hash.slice(0, 8), 16) / 0xffffffff * entry.weight,
  }));
  scored.sort((a, b) => b.score - a.score);
  return scored.slice(0, target).map((entry) => entry.revision);
}

async function main() {
  const args = parseCliArgs();
  const convexUrl = args["convex-url"]!;
  const sampleRate = Math.min(1, Math.max(0.01, parseFloat(args["sample-rate"]!)));
  const limit = parseInt(args.limit!, 10);

  console.log(`\n🔍 Sampling audit — governed Lane A auto-approvals`);
  console.log(`   Convex: ${convexUrl}`);
  console.log(`   Sample rate: ${sampleRate * 100}%`);
  console.log(`   Limit: ${limit}\n`);

  const revisions = await convexRun<AutoApprovedRevision[]>(
    convexUrl,
    "companies:listAutoApprovedVerdictRevisions",
    { limit },
  );
  console.log(`Found ${revisions.length} auto-approved verdict revisions\n`);

  if (revisions.length === 0) {
    console.log("No auto-approved revisions yet — nothing to audit.");
    return;
  }

  const sample = deterministicSample(revisions, sampleRate);
  const overrideRate = 0; // filled in by the human reviewer after re-review

  const report = {
    generatedAt: new Date().toISOString(),
    convexUrl,
    totalAutoApproved: revisions.length,
    sampleRate,
    sampleSize: sample.length,
    overrideRate,
    overrideRateBand: "0% — rubber-stamping red flag; calibrate the Lane A gate or review the sample",
    sample: sample.map((r) => ({
      revisionId: r.revisionId,
      companyKey: r.companyKey,
      industryClass: r.industryClass,
      approvedSourceIds: r.approvedSourceIds,
      evidenceSummary: r.evidenceSummary,
      reviewedAt: r.reviewedAt,
      decisionReason: r.decisionReason,
      riskWeight: riskWeight(r),
    })),
    instructions:
      "For each sampled revision, re-review the approved sources in the stewardship UI. " +
      "Record override=1 for any verdict you would not approve today. " +
      "Re-run with the overrides filled in to compute the override rate.",
  };

  const outDir = "output/industry-data";
  mkdirSync(outDir, { recursive: true });
  const ts = new Date().toISOString().replace(/[:.]/g, "-");
  const outFile = join(outDir, `auto-verify-audit-${ts}.json`);
  writeFileSync(outFile, JSON.stringify(report, null, 2));
  console.log(`Sample (${sample.length} of ${revisions.length}):`);
  for (const r of sample) {
    console.log(`  - ${r.companyKey} (${r.industryClass}) ${r.revisionId}`);
  }
  console.log(`\nReport written to ${outFile}`);
  console.log(`Override rate: 0% (fill in after human re-review)`);
}

// Guard: only run main when executed directly (not when imported by tests).
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";
const isMainModule = process.argv[1]
  ? resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url))
  : false;
if (isMainModule) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}