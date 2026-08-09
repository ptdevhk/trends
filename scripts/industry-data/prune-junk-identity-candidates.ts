#!/usr/bin/env npx tsx
/**
 * Prune junk-shape industry identity candidates (page-title extractions).
 *
 * Lists identity candidates whose normalized legal name violates the shape
 * contract now enforced at the persistence seam (8-80 char window; no " | "
 * separators; no multi-word ALL-CAPS headline lead before " - "). Junk like
 * "CNC MACHINIST CAREERS - GMI CORP" (observed 2026-08-09) entered the
 * queue before the gate existed; this script cleans the historical rows.
 *
 * Usage:
 *   npx tsx scripts/industry-data/prune-junk-identity-candidates.ts [--apply] [--convex-url <url>]
 *
 * Default: dry-run (lists candidates, deletes nothing). With --apply,
 * deletes the flagged rows via companies:deleteIndustryIdentityCandidates
 * (admin, write-secret, max 200 per call).
 *
 * Requires CONVEX_WRITE_SECRET (from packages/convex/.env.local or env).
 * The heuristic mirrors the convex gate `isJunkIdentityCandidateName`.
 */
import { execSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parseArgs } from "node:util";

type IdentityCandidate = {
  _id: string;
  proposalId: string;
  candidateFingerprint: string;
  normalizedLegalName: string;
  confidence: number;
  extractionVersion?: string;
  updatedAt?: number;
};

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
  const tmpDir = mkdtempSync(join(tmpdir(), "convex-prune-"));
  const tmpFile = join(tmpDir, "args.json");
  writeFileSync(tmpFile, JSON.stringify(fullArgs), { mode: 0o600 });
  const urlFlag = convexUrl ? ` --url "${convexUrl}"` : "";
  const cmd = `npx convex run ${functionName} "$(cat '${tmpFile}')"${urlFlag} 2>&1`;
  let output: string;
  try {
    output = execSync(cmd, {
      cwd: `${process.cwd()}/packages/convex`,
      encoding: "utf-8",
      timeout: 180000,
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
  return JSON.parse(lines.slice(jsonStart).join("\n")) as T;
}

/**
 * Mirror of the convex persistence gate (isJunkIdentityCandidateName).
 * Keep in sync with packages/convex/convex/companies.ts.
 */
function isJunkCandidateName(name: string): boolean {
  if (name.length < 8 || name.length > 80) return true;
  if (name.includes(" | ")) return true;
  if (name.includes(" - ")) {
    const lead = name.split(" - ")[0].trim();
    const words = lead.split(/\s+/).filter(Boolean);
    if (
      words.length >= 2 &&
      lead.length >= 8 &&
      /^[A-Z0-9&.'()/\- ]+$/.test(lead)
    ) {
      return true;
    }
  }
  return false;
}

function parseCliArgs() {
  const { values } = parseArgs({
    options: {
      apply: { type: "boolean", default: false },
      "convex-url": { type: "string", default: process.env.CONVEX_URL ?? "http://127.0.0.1:3210" },
      limit: { type: "string", default: "1000" },
    },
  });
  return values;
}

async function main() {
  const args = parseCliArgs();
  const convexUrl = args["convex-url"]!;
  const apply = args.apply === true;
  const limit = Number(args.limit);

  console.log("=== Junk identity-candidate prune ===");
  console.log(`  Convex: ${convexUrl}`);
  console.log(`  Mode: ${apply ? "APPLY (deletes flagged rows)" : "dry-run (lists only)"}`);
  console.log("");

  const candidates = await convexRun<IdentityCandidate[]>(
    convexUrl,
    "companies:listAllIndustryIdentityCandidates",
    { limit },
  );
  console.log(`  Candidates scanned: ${candidates.length}`);

  const junk = candidates.filter((candidate) => isJunkCandidateName(candidate.normalizedLegalName));
  console.log(`  Junk-shape candidates: ${junk.length}`);
  for (const candidate of junk) {
    console.log(
      `    - ${candidate.normalizedLegalName}  (proposal ${candidate.proposalId}, conf ${candidate.confidence.toFixed(2)})`,
    );
  }

  if (junk.length === 0) {
    console.log("\nNothing to prune.");
    return;
  }

  if (!apply) {
    console.log("\nDry-run: no rows deleted. Re-run with --apply to prune.");
    return;
  }

  let deleted = 0;
  for (let i = 0; i < junk.length; i += 200) {
    const batch = junk.slice(i, i + 200).map((candidate) => ({
      proposalId: candidate.proposalId,
      candidateFingerprint: candidate.candidateFingerprint,
    }));
    const result = await convexRun<{ deleted: number }>(
      convexUrl,
      "companies:deleteIndustryIdentityCandidates",
      { entries: batch },
    );
    deleted += result.deleted;
    console.log(`  Deleted batch ${i / 200 + 1}: ${result.deleted}`);
  }
  console.log(`\nDone: deleted ${deleted} junk-shape candidate(s).`);
}

main().catch((error) => {
  console.error(`FAIL: ${(error as Error).message}`);
  process.exit(1);
});
