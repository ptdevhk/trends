#!/usr/bin/env npx tsx
/**
 * Curated MY CNC employer bootstrap (option b).
 *
 * Seeds canonical companies, employer-surface aliases, and governed
 * industry proposals for MY employers that appear with real sales work
 * history in the resume corpus but have no web-verifiable presence (so the
 * worker's discovery lane cannot surface them on its own).
 *
 * Curation evidence = actual resume work entries (candidate name, job
 * title, years, work-entry fingerprint). Each company is suggested as
 * `cnc`; the explicit-CNC-evidence gate still protects the final approval,
 * so a "CNC AUTOMOBILE" that is really a car dealer cannot be approved
 * without a fetched source containing real CNC signals.
 *
 * Default is dry-run. Pass --apply to write via Convex mutations.
 * Requires CONVEX_WRITE_SECRET (from packages/convex/.env.local).
 *
 * Usage:
 *   npx tsx scripts/industry-data/curate-my-cnc-employers.ts            # dry run
 *   npx tsx scripts/industry-data/curate-my-cnc-employers.ts --apply    # write
 *   npx tsx scripts/industry-data/curate-my-cnc-employers.ts \
 *     --convex-url <url> [--apply]  # target a non-default Convex deployment
 *     (CONVEX_URL env is honored as a fallback; default: local deployment)
 *
 * After apply:
 *   1. Trigger targeted worker research:
 *      curl -s -X POST http://localhost:8000/worker/industry/maintenance \
 *        -H "Content-Type: application/json" \
 *        -d '{"trigger":"manual","proposalIds":["<id>", ...]}'
 *   2. Auto-verify approval-safe proposals:
 *      npx tsx scripts/industry-data/auto-verify-proposals.ts --limit 50 --apply
 *   3. Reingest:
 *      npx convex run migrations:reIngestAllResumes '{}'
 *   (For a non-default deployment, add --convex-url <url> to the script and
 *    auto-verify calls, and --url <url> to the npx convex run steps.)
 */
import { execSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import {
  CURATED,
  type CuratedEmployer,
  normalizeCompanyKey,
  proposalIdFor,
} from "./curated-my-cohort.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function convexRun<T>(
  functionName: string,
  args: Record<string, unknown>,
  convexUrl?: string,
): T {
  const tmpDir = mkdtempSync(path.join(tmpdir(), "curate-"));
  try {
    const tmpFile = path.join(tmpDir, "args.json");
    writeFileSync(tmpFile, JSON.stringify(args), { mode: 0o600 });
    // --url is only added when a non-default deployment is targeted; without
    // it, `npx convex run` uses its configured default (local :3210).
    const urlFlag = convexUrl ? ` --url "${convexUrl}"` : "";
    const cmd = `npx convex run ${functionName} "$(cat '${tmpFile}')"${urlFlag} 2>&1`;
    const output = execSync(cmd, {
      cwd: `${process.cwd()}/packages/convex`,
      encoding: "utf-8",
      timeout: 120000,
      maxBuffer: 100 * 1024 * 1024,
      env: { ...process.env },
      shell: "/bin/bash",
    });
    const lines = output.trim().split("\n");
    const jsonStart = lines.findIndex((l) => {
      const t = l.trim();
      return t.startsWith("[") || t.startsWith("{");
    });
    if (jsonStart === -1) {
      throw new Error(`Could not find JSON in Convex output: ${output.slice(-200)}`);
    }
    return JSON.parse(lines.slice(jsonStart).join("\n")) as T;
  } finally {
    rmSync(tmpDir, { recursive: true, force: true });
  }
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

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------
// --convex-url <url> (or --convex-url=<url>) targets a non-default Convex
// deployment; CONVEX_URL env is honored as a fallback. Absent both, convexRun
// uses the CLI's configured default (local :3210) — unchanged behavior.
function parseConvexUrl(): string | undefined {
  const args = process.argv;
  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--convex-url") {
      const value = args[i + 1];
      if (value && !value.startsWith("--")) return value;
    }
    if (args[i].startsWith("--convex-url=")) {
      return args[i].slice("--convex-url=".length);
    }
  }
  return process.env.CONVEX_URL || undefined;
}

const APPLY = process.argv.includes("--apply");
const convexUrl = parseConvexUrl();
const secret = getWriteSecret();

type PlanRow = {
  companyKey: string;
  employerName: string;
  industryClass: string;
  proposalId: string;
  action: "create_company+proposal" | "attach_key+alias" | "alias_only";
  existingProposalId?: string;
};

const plan: PlanRow[] = [];

console.log(`🔍 Curated MY CNC employer bootstrap (${APPLY ? "APPLY" : "DRY RUN"})`);
console.log(`   Convex: ${convexUrl ?? "default (local)"}`);
console.log(`   Cohort: ${CURATED.length} employers from resume work-history evidence\n`);

// Check existing proposals by surface to decide attach vs create.
const surfacesByCompany = new Map<string, string>();
for (const employer of CURATED) {
  const companyKey = normalizeCompanyKey(employer.employerName.replace(/,/g, ""));
  const existing = convexRun<Array<Record<string, unknown>>>(
    "companies:listIndustryProposals",
    { status: "ready_for_review", limit: 500, writeSecret: secret },
    convexUrl,
  ).filter((p) => {
    const s = String(p.normalizedEmployerSurface ?? "").toLowerCase().trim();
    if (!s) return false; // surface-less fixture proposals never match
    const n = employer.employerName.toLowerCase().replace(/,/g, "");
    return s === n || s.includes(n.slice(0, 20)) || n.includes(s.slice(0, 20));
  });

  if (existing[0]) {
    plan.push({
      companyKey,
      employerName: employer.employerName,
      industryClass: employer.industryClass,
      proposalId: String(existing[0].proposalId),
      action: "attach_key+alias",
      existingProposalId: String(existing[0].proposalId),
    });
  } else {
    plan.push({
      companyKey,
      employerName: employer.employerName,
      industryClass: employer.industryClass,
      proposalId: proposalIdFor(companyKey),
      action: "create_company+proposal",
    });
  }
}

let created = 0;
let attached = 0;
let errors = 0;

for (const row of plan) {
  try {
    if (row.action === "create_company+proposal") {
      const employer = CURATED.find((e) => normalizeCompanyKey(e.employerName.replace(/,/g, "")) === row.companyKey)!;
      if (APPLY) {
        convexRun("companies:upsert", {
          companyKey: row.companyKey,
          displayName: employer.employerName.replace(/,+$/, "").trim(),
          status: "confirmed",
          createdBy: "curate-my-cnc",
          writeSecret: secret,
        }, convexUrl);
        convexRun("companies:addAlias", {
          companyKey: row.companyKey,
          alias: employer.employerName,
          source: "observed",
          writeSecret: secret,
        }, convexUrl);
        convexRun("companies:upsertIndustryProposal", {
          proposalId: row.proposalId,
          companyKey: row.companyKey,
          triggerReasons: ["curated"],
          priority: employer.priority,
          suggestedIndustryClass: employer.industryClass,
          suggestedVerificationLevel: "verified",
          materialChangeSummary:
            `Curated from resume work history: ${employer.evidence.resumeName} (${employer.evidence.jobTitle}, ${employer.evidence.years}y)`,
          requestedBy: "curate-my-cnc",
          sampleReferences: [
            {
              workspaceSlug: "dev",
              resumeIdentity: employer.evidence.resumeIdentity ?? `curated:${employer.evidence.resumeName}`,
              workEntryFingerprint: employer.evidence.workEntryFingerprint,
            },
          ],
          writeSecret: secret,
        }, convexUrl);
      }
      created++;
      console.log(`  [${APPLY ? "✓" : "·"}] ${row.companyKey}  (${employer.evidence.jobTitle} · ${employer.evidence.years}y)`);
    } else {
      const employer = CURATED.find((e) => normalizeCompanyKey(e.employerName.replace(/,/g, "")) === row.companyKey)!;
      if (APPLY) {
        // Attach path: the company row may not exist yet — create it first,
        // then alias + key attachment. All calls are idempotent, so an
        // interrupted apply can be re-run safely.
        convexRun("companies:upsert", {
          companyKey: row.companyKey,
          displayName: employer.employerName.replace(/,+$/, "").trim(),
          status: "confirmed",
          createdBy: "curate-my-cnc",
          writeSecret: secret,
        }, convexUrl);
        convexRun("companies:attachProposalToCompany", {
          proposalId: row.existingProposalId!,
          companyKey: row.companyKey,
          writeSecret: secret,
        }, convexUrl);
        convexRun("companies:addAlias", {
          companyKey: row.companyKey,
          alias: employer.employerName,
          source: "observed",
          writeSecret: secret,
        }, convexUrl);
      }
      attached++;
      console.log(`  [${APPLY ? "✓" : "·"}] ${row.companyKey}  (attach key to existing proposal ${row.existingProposalId!.slice(-12)})`);
    }
  } catch (error) {
    errors++;
    console.error(`  [✗] ${row.companyKey} failed: ${(error as Error).message.slice(0, 160)}`);
  }
}

console.log(`\n${APPLY ? "Applied" : "Dry-run"}: ${created} created, ${attached} key-attached, ${errors} errors`);
if (!APPLY) {
  console.log("\nPass --apply to write. Then:");
  console.log("  1. Targeted research:");
  console.log("     curl -s -X POST http://localhost:8000/worker/industry/maintenance \\");
  console.log('       -H "Content-Type: application/json" \\');
  console.log(`       -d '{"trigger":"manual","proposalIds":["${plan[0]?.proposalId}", ...]}'`);
  console.log("  2. Auto-verify:  npx tsx scripts/industry-data/auto-verify-proposals.ts --limit 50 --apply");
  console.log("  3. Reingest:     npx convex run migrations:reIngestAllResumes '{}'");
  console.log("  (Non-default deployment? Rerun this script with --convex-url <url> (or CONVEX_URL env),");
  console.log("   pass --convex-url <url> to auto-verify-proposals.ts, and add --url <url> to the");
  console.log("   npx convex run steps above.)");
}
