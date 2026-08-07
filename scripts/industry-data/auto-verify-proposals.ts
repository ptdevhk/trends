/**
 * Batch auto-approve industry proposals that are `ready_for_review`.
 *
 * Designed for users upgrading from pre-v0.4.23 (where the verified-only
 * minRoleYears gate didn't exist). The upgrade suddenly drops search results
 * because most companies lack verified profiles. This script batch-approves
 * high-confidence proposals that the worker has already researched, so
 * upgrading users don't lose 80% of their search results.
 *
 * Safety rails:
 *   - Only approves `ready_for_review` proposals (worker has gathered evidence)
 *   - Only approves proposals with `suggestedIndustryClass` matching target industries
 *   - Skips proposals without evidence sources
 *   - Requires --apply flag (default is dry-run)
 *   - Caps batch size (default 50)
 *
 * Uses Convex API directly with CONVEX_WRITE_SECRET (bypasses admin auth).
 *
 * Usage:
 *   CONVEX_WRITE_SECRET=... npx tsx scripts/industry-data/auto-verify-proposals.ts [options]
 *
 * Options:
 *   --convex-url <url>   Convex URL (default http://127.0.0.1:3210)
 *   --industry <class>   Filter by industry class: cnc, automation, industrial (default: all target)
 *   --limit <n>          Max proposals to approve (default 50)
 *   --apply              Actually approve (default is dry-run)
 *   --reviewer <name>    Reviewer name (default: auto-verify-bot)
 */

import { parseArgs } from "node:util";
import { randomUUID } from "node:crypto";
import { execSync } from "node:child_process";
import { writeFileSync, mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

type Proposal = {
  proposalId: string;
  companyKey?: string;
  status: string;
  suggestedIndustryClass?: string;
  suggestedVerificationLevel?: string;
  triggerReasons?: string[];
  updatedAt?: number;
};

type EvidenceSource = {
  sourceId: string;
  companyKey?: string;
  proposalId?: string;
  reviewStatus?: string;
  trustTier?: string;
  fetchStatus?: string;
  sourceState?: string;
  updatedAt: number;
};

const TARGET_INDUSTRIES = ["cnc", "automation", "industrial", "metrology"];
const TAXONOMY_VERSION = "industry-v1";
const ATTESTATION_SCHEMA = "industry-review-attestation.v1";

function parseCliArgs() {
  const { values } = parseArgs({
    options: {
      "convex-url": { type: "string", default: process.env.CONVEX_URL ?? "http://127.0.0.1:3210" },
      industry: { type: "string", default: "" },
      limit: { type: "string", default: "50" },
      apply: { type: "boolean", default: false },
      reviewer: { type: "string", default: "auto-verify-bot" },
    },
  });
  return values;
}

/**
 * Run a Convex function via `npx convex run` from the packages/convex directory.
 */
async function convexRun<T>(
  convexUrl: string,
  functionName: string,
  args: Record<string, unknown>,
): Promise<T> {
  const writeSecret = process.env.CONVEX_WRITE_SECRET;
  if (!writeSecret) {
    throw new Error("CONVEX_WRITE_SECRET env var is required");
  }

  const fullArgs = { ...args, writeSecret };
  const argsJson = JSON.stringify(fullArgs);

  // Write args to a temp file and read via $(cat) to avoid shell escaping
  // issues with proposalIds containing slashes (e.g., "cnc-cockpit-uat/keyword-only")
  const tmpDir = mkdtempSync(join(tmpdir(), "convex-run-"));
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

  // npx convex run prints JSON to stdout (after any warnings/log lines)
  // The JSON can be an array (starting with [) or object (starting with {)
  // Find the first line that starts a JSON value and collect until it ends
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
  // Join all lines from jsonStart to end and parse
  const jsonStr = lines.slice(jsonStart).join("\n");
  return JSON.parse(jsonStr) as T;
}

async function main() {
  const args = parseCliArgs();
  const convexUrl = args["convex-url"]!;
  const industryFilter = args.industry!;
  const limit = parseInt(args.limit!, 10);
  const apply = args.apply;
  const reviewer = args.reviewer!;

  console.log(`\n${apply ? "🔧 APPLYING" : "👀 DRY RUN"} - Auto-verify industry proposals`);
  console.log(`   Convex: ${convexUrl}`);
  console.log(`   Industry filter: ${industryFilter || "all target industries"}`);
  console.log(`   Limit: ${limit}`);
  console.log(`   Reviewer: ${reviewer}\n`);

  // List ready_for_review proposals
  const proposals = await convexRun<Proposal[]>(
    convexUrl,
    "companies:listIndustryProposals",
    { status: "ready_for_review" },
  );
  console.log(`Found ${proposals.length} proposals in ready_for_review status\n`);

  // Filter by industry class + must have companyKey
  const targetIndustries = industryFilter ? [industryFilter] : TARGET_INDUSTRIES;
  const filtered = proposals.filter(
    (p) =>
      p.suggestedIndustryClass &&
      targetIndustries.includes(p.suggestedIndustryClass) &&
      p.companyKey,
  );
  console.log(`${filtered.length} proposals match industry filter [${targetIndustries.join(", ")}]`);
  console.log(`${proposals.length - filtered.length} proposals skipped (wrong industry or no companyKey)\n`);

  // Cap at limit
  const batch = filtered.slice(0, limit);
  if (batch.length === 0) {
    console.log("No proposals to approve. Exiting.");
    return;
  }

  console.log(`Processing ${batch.length} proposals:\n`);

  let approved = 0;
  let skipped = 0;
  let failed = 0;
  const approvedCompanies: string[] = [];

  for (const proposal of batch) {
    const companyKey = proposal.companyKey ?? "?";
    const industry = proposal.suggestedIndustryClass ?? "?";
    process.stdout.write(`  ${companyKey} (${industry})... `);

    // Get evidence sources for this proposal
    let sources: EvidenceSource[];
    try {
      sources = await convexRun<EvidenceSource[]>(
        convexUrl,
        "companies:listIndustryEvidenceSources",
        { proposalId: proposal.proposalId },
      );
    } catch (err) {
      console.log(`✗ Could not load evidence sources: ${(err as Error).message}`);
      failed++;
      continue;
    }

    if (sources.length === 0) {
      console.log("⚠ Skipped: no evidence sources");
      skipped++;
      continue;
    }

    // Filter to approval-safe sources:
    // - Must be non-discovery trust tier (primary or corroborating)
    // - Must be successfully fetched (not failed)
    // - Must not be rejected/disputed
    const approvableSources = sources.filter(
      (s) =>
        s.trustTier !== "discovery" &&
        s.reviewStatus !== "rejected" &&
        s.reviewStatus !== "disputed" &&
        s.fetchStatus !== "failed" &&
        s.sourceState === "active",
    );

    if (approvableSources.length === 0) {
      console.log("⚠ Skipped: no approval-safe sources (need fetched primary/corroborating)");
      skipped++;
      continue;
    }

    const approvedSourceIds = approvableSources.map((s) => s.sourceId);

    if (!apply) {
      console.log(`DRY RUN - would approve (${approvedSourceIds.length} sources)`);
      approved++;
      approvedCompanies.push(companyKey);
      continue;
    }

    // Approve via Convex mutation
    const revisionId = `auto-${proposal.proposalId.slice(0, 12)}-${Date.now().toString(36)}`;
    const inputFingerprint = `auto-fp-${randomUUID().slice(0, 16)}`;

    try {
      const result = await convexRun<Record<string, unknown>>(
        convexUrl,
        "companies:approveIndustryProposal",
        {
          proposalId: proposal.proposalId,
          revisionId,
          verificationLevel: "verified",
          industryClass: industry,
          approvedSourceIds,
          evidenceSummary: `Auto-approved ${industry} industry company with ${approvedSourceIds.length} evidence source(s)`,
          decisionReason: `Batch auto-approval for upgrade migration (reviewer: ${reviewer})`,
          taxonomyVersion: TAXONOMY_VERSION,
          reviewer,
          reviewAttestation: {
            schemaVersion: ATTESTATION_SCHEMA,
            inputFingerprint,
            decisionMode: "standard",
            acknowledgedRiskFlags: [],
            cncEvidenceAcknowledged: true,
            acknowledgementReason: `Auto-verified batch approval for ${industry} industry`,
          },
        },
      );

      const resultRevision = typeof result.revisionId === "string" ? result.revisionId : "?";
      const resultCompany = typeof result.companyKey === "string" ? result.companyKey : companyKey;
      console.log(`✓ Approved (revision: ${resultRevision.slice(0, 16)}...)`);
      approved++;
      approvedCompanies.push(resultCompany);
    } catch (err) {
      const msg = (err as Error).message;
      if (msg.includes("INDUSTRY_REVIEW_CNC_ACK_REQUIRED")) {
        console.log(`✗ CNC attestation required (try manual review)`);
      } else if (msg.includes("not open for approval")) {
        console.log(`⚠ Already processed (not open)`);
        skipped++;
      } else {
        console.log(`✗ ${msg.slice(0, 100)}`);
      }
      failed++;
    }

    // Small delay to avoid overwhelming Convex
    await new Promise((resolve) => setTimeout(resolve, 100));
  }

  console.log(`\n${"=".repeat(60)}`);
  console.log(`Results: ${approved} approved, ${skipped} skipped, ${failed} failed`);

  if (approvedCompanies.length > 0) {
    console.log(`\nApproved companies:`);
    for (const company of approvedCompanies) {
      console.log(`  - ${company}`);
    }
  }

  if (apply && approved > 0) {
    console.log(`\n⚠ Next steps:`);
    console.log(`  1. Trigger reingest to update verifiedRoleYears on affected resumes:`);
    console.log(`     ./bin/trends migrate validate-consistency --force`);
    console.log(`  2. Re-run search to verify improved results.`);
  }

  if (!apply) {
    console.log(`\nThis was a DRY RUN. Pass --apply to actually approve.`);
  }
}

main().catch((error) => {
  console.error("Fatal error:", error);
  process.exit(1);
});
