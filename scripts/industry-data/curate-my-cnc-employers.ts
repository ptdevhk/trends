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

// ---------------------------------------------------------------------------
// Curated cohort: MY employers with real sales work history in the corpus,
// no existing canonical company. years = verified-eligible sales years.
// ---------------------------------------------------------------------------
type CuratedEmployer = {
  employerName: string; // exact surface as it appears in work history
  industryClass: "cnc" | "industrial";
  priority: number;
  evidence: {
    resumeName: string;
    jobTitle: string;
    years: number;
    workEntryFingerprint?: string;
    resumeIdentity?: string;
  };
};

const CURATED: CuratedEmployer[] = [
  { employerName: "Edge precision technology sdn bhd", industryClass: "cnc", priority: 100, evidence: { resumeName: "Vincent Saw wei kean", jobTitle: "Senior Sales Manager", years: 14.58, workEntryFingerprint: "work-61466751", resumeIdentity: "externalId:hk.employer.seek.com:profile:6677b787-1c2a-36d3-d321-de3b00000000" } },
  { employerName: "CNC AUTOMOBILE", industryClass: "cnc", priority: 90, evidence: { resumeName: "Suraya Mohd Yusof", jobTitle: "Sales & Marketing", years: 13.17, workEntryFingerprint: "work-faf02529", resumeIdentity: "externalId:hk.employer.seek.com:profile:46478268-7510-42d0-b613-eaf15ae45064" } },
  { employerName: "Seco Tools Sdn Bhd", industryClass: "cnc", priority: 100, evidence: { resumeName: "Wei Kiat Ng", jobTitle: "Technical Sales Engineer", years: 11.17, workEntryFingerprint: "work-6d908507", resumeIdentity: "externalId:hk.employer.seek.com:profile:594ac7b6-0f63-11e2-9b7b-5a02dd2498d8" } },
  { employerName: "BMT Engineering Sdn Bhd,", industryClass: "cnc", priority: 95, evidence: { resumeName: "muhammad suffian sidek", jobTitle: "Sales Role", years: 10.67, workEntryFingerprint: "work-889abc87", resumeIdentity: "externalId:hk.employer.seek.com:profile:5be37020-4360-11ea-97cd-00505680053b" } },
  { employerName: "NSL PRECISION ENGINEERING SERVICES SDN. BHD.", industryClass: "cnc", priority: 100, evidence: { resumeName: "Mohammad Zul Afiq Mohd Amin", jobTitle: "CNC Milling Machinist and Sales Engineer", years: 9.5, workEntryFingerprint: "work-466078df", resumeIdentity: "externalId:hk.employer.seek.com:profile:dc91d05a-94e4-11e6-8284-005056a2749b" } },
  { employerName: "Seng Heng Precision Tools Sdn.Bhd", industryClass: "cnc", priority: 95, evidence: { resumeName: "Kelvin Tan Shen Yeon", jobTitle: "Mechanical Designer cum CNC Programmer & Salesperson", years: 7.67, workEntryFingerprint: "work-f1864d7f", resumeIdentity: "profileUrl:hk.employer.seek.com/candidates/298c3830-3988-11e7-96c0-005056b15d2d" } },
  { employerName: "T.E.M Engineering (JB) Sdn. Bhd.", industryClass: "cnc", priority: 90, evidence: { resumeName: "zheyong pang", jobTitle: "Sales Executive", years: 6.16, workEntryFingerprint: "work-dafc9f8e", resumeIdentity: "externalId:hk.employer.seek.com:profile:dc359597-c090-42d0-9ba5-4cf13bda647f" } },
  { employerName: "SFE machinery sdn bhd", industryClass: "cnc", priority: 95, evidence: { resumeName: "kee hoo ooi", jobTitle: "Sales Engineer", years: 6.0, workEntryFingerprint: "work-ef8dc447", resumeIdentity: "externalId:hk.employer.seek.com:profile:9973d916-55cc-47a6-af0f-b9647f75e8a9" } },
  { employerName: "Midas Precision sdn bhd", industryClass: "cnc", priority: 95, evidence: { resumeName: "Redzaudin Sariman", jobTitle: "Sales Coordinator, CNC Turning Programmer", years: 5.58, workEntryFingerprint: "work-4bf148b7", resumeIdentity: "profileUrl:hk.employer.seek.com/candidates/94a0bd2a-01d9-11e8-9577-005056b16351" } },
  { employerName: "Smart Tools Marketing Enterprise", industryClass: "cnc", priority: 90, evidence: { resumeName: "HONG LIANG LIM", jobTitle: "Admin CUM Sales Assistant", years: 5.5, workEntryFingerprint: "work-cb87171d", resumeIdentity: "externalId:hk.employer.seek.com:profile:90e2d134-9566-11ed-98f1-005056a2502e" } },
  { employerName: "Leesonmech Engineering (M) Sdn. Bhd", industryClass: "cnc", priority: 95, evidence: { resumeName: "Johnson Lee Wei Tao", jobTitle: "Technical Sales Engineer", years: 5.25, workEntryFingerprint: "work-25d8d458", resumeIdentity: "profileUrl:hk.employer.seek.com/candidates/584114693" } },
  { employerName: "Newbillion Precision Metal", industryClass: "cnc", priority: 95, evidence: { resumeName: "Jeremy Tong", jobTitle: "Business Development cum Operations Manager (CNC)", years: 5.08, workEntryFingerprint: "work-f0e63e6f", resumeIdentity: "externalId:hk.employer.seek.com:profile:ddd17641-5962-4b6a-a31a-89e34672a822" } },
  { employerName: "Redstar Engineering", industryClass: "cnc", priority: 90, evidence: { resumeName: "Cheng Yee Hoong", jobTitle: "Sales Manager", years: 5.0, workEntryFingerprint: "work-634ecdf7", resumeIdentity: "externalId:hk.employer.seek.com:profile:68187143-448c-64f4-6242-774e00000000" } },
  { employerName: "YD Laser Technologies Co. Ltd", industryClass: "cnc", priority: 90, evidence: { resumeName: "CHET SEONG HOOI", jobTitle: "Senior Sales Manager", years: 2.08, workEntryFingerprint: "work-600bee25", resumeIdentity: "externalId:hk.employer.seek.com:profile:9b4ae141-e2d8-4541-98d3-5cef954888e0" } },
  { employerName: "Robo Tech Machinery Sdn Bhd.", industryClass: "cnc", priority: 90, evidence: { resumeName: "Luiz Lim Eu Hock", jobTitle: "Sales Manager", years: 1.25, workEntryFingerprint: "work-0c33de59", resumeIdentity: "externalId:hk.employer.seek.com:profile:ffc3ec44-e02b-11df-9d5a-001ec9b02997" } },
  { employerName: "COOLTECH ENGINEERING SDN BHD", industryClass: "cnc", priority: 85, evidence: { resumeName: "Neo Kangzhen", jobTitle: "Sales Engineer", years: 1.08, workEntryFingerprint: "work-d6a005e7", resumeIdentity: "externalId:hk.employer.seek.com:profile:9d673e90-e727-11e9-97a2-00505680053b" } },
  { employerName: "Prosdata Engineering", industryClass: "cnc", priority: 85, evidence: { resumeName: "Tan Yong Hong", jobTitle: "Sales Engineer", years: 1.08, workEntryFingerprint: "work-396b1fd6", resumeIdentity: "profileUrl:hk.employer.seek.com/candidates/503955779" } },
];

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
function normalizeCompanyKey(value: string): string {
  return value.trim().toLowerCase().replace(/\s+/g, "-");
}

function proposalIdFor(companyKey: string): string {
  return `curated-my-${companyKey.replace(/[^a-z0-9-]/g, "")}`;
}

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
