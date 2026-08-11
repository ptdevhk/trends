#!/usr/bin/env npx tsx
/**
 * Promote stuck MY industry proposals from `needs_more_evidence` to
 * `ready_for_review` by attaching in-repo corpus evidence sources.
 *
 * Background: on the preview environment, 17 MY industry proposals are
 * stuck at `needs_more_evidence` because the worker's web-research lane
 * found no reviewable sources. In-repo corpus evidence exists for all 17:
 *   - 12 `curated-my-*` proposals — evidence in the CURATED cohort
 *     (scripts/industry-data/curated-my-cohort.ts)
 *   - 5 `my-bootstrap-*` proposals — evidence in the reviewed catalog
 *     (scripts/industry-data/evidence/my-reviewed-catalog-2026-08-07.json)
 *
 * Each target gets one `registry`/`corroborating`/`fetched` evidence source
 * per corpus record (unreviewed/active defaults — no reviewStatus/sourceState
 * passed) and is promoted with suggestedIndustryClass `cnc`. Source ids are
 * deterministic, so re-runs are idempotent.
 *
 * Default is dry-run. Pass --apply to write via Convex mutations.
 * Requires CONVEX_WRITE_SECRET env (from packages/convex/.env.local).
 *
 * Usage:
 *   npx tsx scripts/industry-data/promote-curated-my-proposals.ts            # dry run
 *   npx tsx scripts/industry-data/promote-curated-my-proposals.ts --apply    # write
 *   npx tsx scripts/industry-data/promote-curated-my-proposals.ts \
 *     --convex-url <url> [--apply]  # target a non-default Convex deployment
 */
import { parseArgs } from "node:util";
import { execSync } from "node:child_process";
import { writeFileSync, mkdtempSync, rmSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { pathToFileURL } from "node:url";

import {
  CURATED,
  type CuratedEmployer,
  fnv1aHex,
  idSuffix,
  normalizeCompanyKey,
  proposalIdFor,
  resumeSearchUrl,
} from "./curated-my-cohort.js";

const CATALOG_PATH = "scripts/industry-data/evidence/my-reviewed-catalog-2026-08-07.json";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type RawProposal = {
  proposalId: string;
  companyKey?: string;
  status: string;
};

export type CatalogSource = {
  url: string;
  sourceType: string;
  trustTier: string;
  title?: string;
  evidenceExcerpt?: string;
  fetchedAt?: number;
  contentFingerprint?: string;
};

export type CatalogEntry = {
  companyKey: string;
  employerName?: string;
  sources: CatalogSource[];
};

/** Evidence source record as passed to companies:upsertIndustryEvidenceSource. */
export type EvidenceSourceRecord = {
  sourceId: string;
  companyKey: string;
  proposalId: string;
  url: string;
  sourceType: string;
  trustTier: string;
  title?: string;
  evidenceExcerpt?: string;
  fetchedAt: number;
  fetchStatus: string;
  contentFingerprint?: string;
};

export type PromotionTarget = {
  proposal: RawProposal;
  evidenceSourceRecords: EvidenceSourceRecord[];
};

export type PromotionPlanRow = {
  proposalId: string;
  companyKey: string;
  status: string;
  sources: EvidenceSourceRecord[];
};

// ---------------------------------------------------------------------------
// Pure helpers
// ---------------------------------------------------------------------------

function formatYears(years: number): string {
  return `${Math.round(years * 100) / 100}y`;
}

/** One evidence source per curated entry (keyed on evidence.resumeName). */
export function buildCuratedSourceRecords(
  entry: CuratedEmployer,
  proposalId: string,
  proposalCompanyKey: string,
  now: number,
): EvidenceSourceRecord[] {
  const resumeName = entry.evidence.resumeName;
  const fingerprint = entry.evidence.workEntryFingerprint ?? fnv1aHex(resumeName);
  return [
    {
      sourceId: `corpus-src-${idSuffix(proposalCompanyKey)}-${idSuffix(fingerprint)}`,
      companyKey: proposalCompanyKey,
      proposalId,
      url: resumeSearchUrl(resumeName),
      sourceType: "registry",
      trustTier: "corroborating",
      title: `CNC corpus evidence: ${entry.evidence.jobTitle} (${formatYears(entry.evidence.years)}) at ${entry.employerName}`,
      evidenceExcerpt: `CNC machining industry sales role: ${entry.evidence.jobTitle}, ${formatYears(entry.evidence.years)}`,
      fetchedAt: now,
      fetchStatus: "fetched",
      contentFingerprint: `corpus-${fingerprint}`,
    },
  ];
}

/** One evidence source per catalog `sources[]` entry (fields passed through). */
export function buildCatalogSourceRecords(
  catalogEntry: CatalogEntry,
  proposalId: string,
  proposalCompanyKey: string,
  now: number,
): EvidenceSourceRecord[] {
  return catalogEntry.sources.map((source) => ({
    sourceId:
      `corpus-src-${idSuffix(proposalCompanyKey)}-` +
      `${idSuffix(source.contentFingerprint ?? fnv1aHex(source.url))}`,
    companyKey: proposalCompanyKey,
    proposalId,
    url: source.url,
    sourceType: source.sourceType,
    trustTier: source.trustTier,
    ...(source.title !== undefined ? { title: source.title } : {}),
    ...(source.evidenceExcerpt !== undefined
      ? { evidenceExcerpt: source.evidenceExcerpt }
      : {}),
    fetchedAt: now,
    fetchStatus: "fetched",
    ...(source.contentFingerprint !== undefined
      ? { contentFingerprint: source.contentFingerprint }
      : {}),
  }));
}

function curatedCohortIndex(): {
  byProposalId: Map<string, CuratedEmployer>;
  byCompanyKey: Map<string, CuratedEmployer>;
} {
  const byProposalId = new Map<string, CuratedEmployer>();
  const byCompanyKey = new Map<string, CuratedEmployer>();
  for (const employer of CURATED) {
    const companyKey = normalizeCompanyKey(employer.employerName.replace(/,/g, ""));
    byCompanyKey.set(companyKey, employer);
    byProposalId.set(proposalIdFor(companyKey), employer);
  }
  return { byProposalId, byCompanyKey };
}

/**
 * Select promotion targets: proposals stuck at `needs_more_evidence` that
 * belong to the curated cohort (proposalId AND normalized companyKey must
 * both resolve to the same curated employer — defensive) or to the reviewed
 * catalog (normalized companyKey present in catalogByKey). Dedupes by
 * proposalId, preserving input order.
 */
export function selectPromotionTargets(
  proposals: RawProposal[],
  catalogByKey: ReadonlyMap<string, CatalogEntry>,
  now: number = Date.now(),
): PromotionTarget[] {
  const { byProposalId, byCompanyKey } = curatedCohortIndex();
  const seen = new Set<string>();
  const targets: PromotionTarget[] = [];
  for (const proposal of proposals) {
    if (proposal.status !== "needs_more_evidence") continue;
    if (seen.has(proposal.proposalId)) continue;
    const normalizedKey = normalizeCompanyKey(proposal.companyKey ?? "");
    const curatedEmployer = byProposalId.get(proposal.proposalId);
    const curatedHit =
      curatedEmployer !== undefined && byCompanyKey.get(normalizedKey) === curatedEmployer;
    const catalogEntry = normalizedKey ? catalogByKey.get(normalizedKey) : undefined;
    if (!curatedHit && !catalogEntry) continue;
    seen.add(proposal.proposalId);
    const evidenceSourceRecords = curatedHit
      ? buildCuratedSourceRecords(curatedEmployer!, proposal.proposalId, normalizedKey, now)
      : buildCatalogSourceRecords(catalogEntry!, proposal.proposalId, normalizedKey, now);
    targets.push({ proposal, evidenceSourceRecords });
  }
  return targets;
}

/** Ordered promotion plan rows for the CLI. */
export function buildPromotionPlan(
  proposals: RawProposal[],
  catalogByKey: ReadonlyMap<string, CatalogEntry>,
  now: number,
): PromotionPlanRow[] {
  return selectPromotionTargets(proposals, catalogByKey, now).map((target) => ({
    proposalId: target.proposal.proposalId,
    companyKey: target.proposal.companyKey ?? "",
    status: target.proposal.status,
    sources: target.evidenceSourceRecords,
  }));
}

// ---------------------------------------------------------------------------
// Convex plumbing
// ---------------------------------------------------------------------------

function getWriteSecret(): string {
  const writeSecret = process.env.CONVEX_WRITE_SECRET;
  if (!writeSecret) {
    throw new Error("CONVEX_WRITE_SECRET env var is required");
  }
  return writeSecret;
}

/**
 * Run a Convex function via `npx convex run` from the packages/convex directory.
 * Args are written to a temp file and read via $(cat) to avoid shell escaping
 * issues with proposalIds containing slashes.
 */
async function convexRun<T>(
  convexUrl: string,
  functionName: string,
  args: Record<string, unknown>,
): Promise<T> {
  const writeSecret = getWriteSecret();
  const fullArgs = { ...args, writeSecret };
  const argsJson = JSON.stringify(fullArgs);

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

  // npx convex run prints JSON to stdout (after any warnings/log lines).
  // Find the first line that starts a JSON value and parse the rest.
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

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

function loadCatalog(): Map<string, CatalogEntry> {
  let raw: string;
  try {
    raw = readFileSync(CATALOG_PATH, "utf-8");
  } catch (error) {
    throw new Error(`Cannot read catalog at ${CATALOG_PATH}: ${(error as Error).message}`);
  }
  const entries = JSON.parse(raw) as CatalogEntry[];
  return new Map(entries.map((entry) => [normalizeCompanyKey(entry.companyKey), entry]));
}

async function main(): Promise<void> {
  const { values } = parseArgs({
    options: {
      "convex-url": {
        type: "string",
        default: process.env.CONVEX_URL ?? "http://127.0.0.1:3210",
      },
      apply: { type: "boolean", default: false },
    },
  });
  const convexUrl = values["convex-url"]!;
  const apply = values.apply === true;
  getWriteSecret(); // fail fast: required for listing and writes

  console.log(`\n${apply ? "🔧 APPLYING" : "👀 DRY RUN"} - Promote curated MY proposals from needs_more_evidence`);
  console.log(`   Convex: ${convexUrl}\n`);

  const catalogByKey = loadCatalog();
  console.log(`   Catalog: ${CATALOG_PATH} (${catalogByKey.size} companies)\n`);

  const result = await convexRun<{ items?: RawProposal[]; nextCursor?: string }>(
    convexUrl,
    "companies:listIndustryProposalsPage",
    { status: "needs_more_evidence", limit: 200 },
  );
  const proposals = result.items ?? [];
  console.log(`Found ${proposals.length} proposals in needs_more_evidence\n`);

  const plan = buildPromotionPlan(proposals, catalogByKey, Date.now());
  console.log(`${plan.length} cohort targets:\n`);

  let sourcesUpserted = 0;
  let promoted = 0;
  let errors = 0;

  for (const row of plan) {
    if (!apply) {
      console.log(
        `  [·] ${row.proposalId}  (${row.companyKey || "no companyKey"})  ${row.sources.length} source(s)`,
      );
      continue;
    }
    try {
      for (const source of row.sources) {
        await convexRun(convexUrl, "companies:upsertIndustryEvidenceSource", { ...source });
        sourcesUpserted++;
      }
      await convexRun(convexUrl, "companies:setIndustryProposalResearchState", {
        proposalId: row.proposalId,
        status: "ready_for_review",
        suggestedIndustryClass: "cnc",
      });
      promoted++;
      console.log(
        `  [✓] ${row.proposalId}  (${row.companyKey || "no companyKey"})  ${row.sources.length} source(s) attached, promoted`,
      );
    } catch (error) {
      errors++;
      console.error(`  [✗] ${row.proposalId} failed: ${(error as Error).message.slice(0, 160)}`);
    }
  }

  console.log(
    `\n${apply ? "Applied" : "Dry-run"}: ${plan.length} targets, ${sourcesUpserted} sources upserted, ${promoted} promoted, ${errors} errors`,
  );
  if (!apply) {
    console.log("\nPass --apply to attach evidence sources and promote to ready_for_review.");
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error("Fatal error:", error);
    process.exit(1);
  });
}
