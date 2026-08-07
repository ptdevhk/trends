#!/usr/bin/env npx tsx
/**
 * Corpus-evidence fast-track for industry-proof accuracy.
 *
 * Scans the resume corpus for unverified employers with CNC/industrial
 * job-title tokens. Classifies into Tier 1 (2+ resumes), Tier 2
 * (1 resume + explicit CNC title), or Tier 3 (defer to worker).
 *
 * Dry-run by default. Pass --apply to write proposals + evidence sources.
 * Requires CONVEX_WRITE_SECRET (from packages/convex/.env.local).
 *
 * Usage:
 *   npx tsx scripts/industry-data/corpus-fast-track.ts            # dry run
 *   npx tsx scripts/industry-data/corpus-fast-track.ts --apply    # write
 */
import { createHash } from "node:crypto";
import { execSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { parseArgs } from "node:util";

// ---------------------------------------------------------------------------
// Token sets (Gate 1: title-token gate)
// ---------------------------------------------------------------------------
const EXPLICIT_CNC_TOKENS = [
  "cnc", "machinist", "milling", "turning", "machine tool",
  "precision engineering", "tooling", "mechatronics",
  "数控", "机床", "机加工", "加工中心", "模具", "刀具", "精密机械",
];

const ENGINEER_TOKENS = [
  "technical sales engineer", "sales engineer", "application engineer",
  "field engineer", "技术销售", "销售工程师",
];

// Gate 2: employer-name exclusion (the "CNC AUTOMOBILE" trap)
const EXCLUSION_TOKENS = [
  "automobile", "car", "auto parts", "automotive", "汽车",
  "food", "beverage", "食品", "饮料",
  "retail", "mart", "shop", "store", "零售",
  "real estate", "property", "地产",
];

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------
type Market = "my" | "cn";

type WorkEntry = {
  companyName: string;
  jobTitle: string;
  years: number;
  industryVerified: boolean;
  workEntryFingerprint?: string;
};

type CollectedEntry = {
  market: Market;
  companyName: string;
  jobTitle: string;
  years: number;
  workEntryFingerprint?: string;
  profileUrl: string;
  identityKey: string;
  resumeName: string;
};

type EmployerGroup = {
  companyKey: string;
  displayName: string;
  market: Market;
  entries: CollectedEntry[];
  identityKeys: Set<string>;
  totalYears: number;
};

type Classification =
  | { tier: "tier1" }
  | { tier: "tier2" }
  | { tier: "excluded"; matchedToken: string }
  | { tier: "defer" };

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
function normalizeCompanyKey(value: string): string {
  return value.trim().toLowerCase().replace(/\s+/g, "-");
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

/**
 * Run a Convex function via `npx convex run` from the packages/convex directory.
 * Args are written to a temp file and read via $(cat) to avoid shell escaping
 * issues with proposalIds containing slashes.
 */
async function convexRun<T>(
  functionName: string,
  args: Record<string, unknown>,
): Promise<T> {
  const convexUrl = process.env.CONVEX_URL ?? "http://127.0.0.1:3210";
  const tmpDir = mkdtempSync(path.join(tmpdir(), "convex-run-"));
  try {
    const tmpFile = path.join(tmpDir, "args.json");
    writeFileSync(tmpFile, JSON.stringify(args), { mode: 0o600 });
    const urlFlag = ` --url "${convexUrl}"`;
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
      const anyErr = err as { stdout?: string | Buffer; stderr?: string | Buffer };
      const raw = [anyErr.stdout ?? "", anyErr.stderr ?? ""].map(s =>
        typeof s === "string" ? s : Buffer.from(s).toString("utf-8")
      ).join("");
      // Surface the actual Convex error (not the wrapped shell command).
      const uncaught = raw.match(/Uncaught Error: [^\n]+/);
      const first = raw.match(/Error: [^\n]+/);
      const detail = (uncaught ?? first)?.[0].replace(/^Uncaught /, "") ?? raw.slice(-200).trim();
      throw new Error(detail || `Convex ${functionName} command failed`);
    } finally {
      rmSync(tmpDir, { recursive: true, force: true });
    }
    // npx convex run prints JSON to stdout (after any warnings/log lines).
    // Find the first line that starts a JSON value and parse the rest.
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

type IndustryProposal = {
  proposalId: string;
  companyKey?: string;
  normalizedEmployerSurface?: string;
  status: string;
};

const OPEN_PROPOSAL_STATUSES = new Set(["new", "researching", "ready_for_review", "needs_more_evidence"]);

const PROPOSAL_STATUSES = [
  "new",
  "researching",
  "ready_for_review",
  "needs_more_evidence",
  "approved",
  "rejected",
  "superseded",
];

/**
 * Stable id-suffix for a company key. ASCII keys pass through as-is
 * (minus punctuation); CJK keys strip to an empty string, so fall back
 * to a short content hash to keep ids unique per employer.
 */
function idSuffix(companyKey: string): string {
  const ascii = companyKey.replace(/[^a-z0-9-]/g, "");
  if (ascii.length > 0) return ascii;
  return createHash("sha1").update(companyKey).digest("hex").slice(0, 8);
}

function normalizeAlias(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[\s\u3000]+/g, " ")
    .replace(/[()（）[\]【】.,，。·・'"`]/g, "");
}

const MARKET_QUERIES: Record<Market, { q: string; location: string }> = {
  my: { q: "CNC+Sales", location: "Malaysia" },
  cn: { q: "CNC+%E9%94%80%E5%94%AE", location: "China" },
};

type ResumeApiResponse = {
  success: boolean;
  summary: { total: number; returned: number };
  data: Array<Record<string, unknown>>;
};

type RoleSignal = {
  type?: string;
  matchedWorkEntries?: Array<Record<string, unknown>>;
};

async function scanMarket(market: Market): Promise<CollectedEntry[]> {
  const { q, location } = MARKET_QUERIES[market];
  const bffBase = process.env.BFF_API_URL?.replace(/\/$/, "") ?? "http://localhost:3000";
  const url =
    `${bffBase}/api/resumes?q=${q}&location=${location}` +
    `&source=convex&paged=true&limit=200&workspaceSlug=hr&minRoleYears=1&roleType=sales`;

  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`[${market}] API ${res.status} for ${url}`);
  }
  const body = (await res.json()) as ResumeApiResponse;
  if (!body.success || !Array.isArray(body.data)) {
    throw new Error(`[${market}] API returned success=false or no data array`);
  }

  const collected: CollectedEntry[] = [];
  for (const resume of body.data) {
    const ingestData = (resume.ingestData ?? {}) as Record<string, unknown>;
    const roleSignals = Array.isArray(ingestData.roleSignals) ? (ingestData.roleSignals as RoleSignal[]) : [];
    const profileUrl = String(resume.profileUrl ?? "");
    const identityKey = String(resume.identityKey ?? resume.resumeId ?? "");
    const resumeName = String(resume.name ?? "");

    for (const signal of roleSignals) {
      if (signal.type !== "sales") continue;
      for (const entry of signal.matchedWorkEntries ?? []) {
        const industryVerified = entry.industryVerified === true;
        if (industryVerified) continue; // only unverified entries
        const companyName = String(entry.companyName ?? "").trim();
        const jobTitle = String(entry.jobTitle ?? "").trim();
        if (!companyName || !jobTitle) continue;
        collected.push({
          market,
          companyName,
          jobTitle,
          years: typeof entry.years === "number" ? entry.years : 0,
          workEntryFingerprint: entry.workEntryFingerprint ? String(entry.workEntryFingerprint) : undefined,
          profileUrl,
          identityKey,
          resumeName,
        });
      }
    }
  }
  return collected;
}

function hasAnyToken(title: string, tokens: string[]): boolean {
  const lower = title.toLowerCase();
  return tokens.some((token) => lower.includes(token.toLowerCase()));
}

function classify(group: EmployerGroup): Classification {
  const distinctResumes = group.identityKeys.size;

  // Gate 2 first: employer name contradicting CNC industry always defers.
  const lowerName = group.displayName.toLowerCase();
  const exclusion = EXCLUSION_TOKENS.find((token) => lowerName.includes(token.toLowerCase()));
  if (exclusion) {
    return { tier: "excluded", matchedToken: exclusion };
  }

  const titleHasCnc = group.entries.some((e) => hasAnyToken(e.jobTitle, EXPLICIT_CNC_TOKENS));
  const titleHasEngineer = group.entries.some((e) => hasAnyToken(e.jobTitle, ENGINEER_TOKENS));

  if (distinctResumes >= 2 && (titleHasCnc || titleHasEngineer)) {
    return { tier: "tier1" };
  }
  if (distinctResumes === 1 && titleHasCnc) {
    return { tier: "tier2" };
  }
  return { tier: "defer" };
}

function formatYears(years: number): string {
  return `${Math.round(years * 100) / 100}y`;
}

function printReport(
  groupsByTier: Record<"tier1" | "tier2" | "excluded" | "defer", EmployerGroup[]>,
  totals: Record<"tier1" | "tier2" | "excluded" | "defer", number>,
): void {
  const fmtGroup = (g: EmployerGroup, indent: string) => {
    const resumes = g.identityKeys.size;
    const years = formatYears(g.totalYears);
    const titles = Array.from(new Set(g.entries.map((e) => e.jobTitle))).join(", ");
    console.log(`${indent}${resumes} resume${resumes > 1 ? "s" : ""} | ${years} | ${g.displayName}`);
    console.log(`${indent}  titles: ${titles}`);
  };

  console.log(`Tier 1 (2+ resumes, CNC/engineer titles):`);
  for (const g of groupsByTier.tier1) fmtGroup(g, "  ");
  console.log();

  console.log("Tier 2 (1 resume, explicit CNC title):");
  for (const g of groupsByTier.tier2) fmtGroup(g, "  ");
  console.log();

  console.log("Excluded (employer name matches exclusion tokens):");
  for (const g of groupsByTier.excluded) fmtGroup(g, "  ");
  console.log();

  console.log("Deferred (Tier 3 - worker research):");
  for (const g of groupsByTier.defer) fmtGroup(g, "  ");
  console.log();

  console.log("Summary:");
  console.log(`  Tier 1: ${totals.tier1} employers`);
  console.log(`  Tier 2: ${totals.tier2} employers`);
  console.log(`  Excluded: ${totals.excluded} employer${totals.excluded === 1 ? "" : "s"}`);
  console.log(`  Deferred: ${totals.defer} employers`);
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------
async function main(): Promise<void> {
  const { values } = parseArgs({
    options: {
      apply: { type: "boolean", default: false },
      market: { type: "string", default: "both" },
    },
  });
  const APPLY = values.apply === true;
  const marketArg = String(values.market ?? "both");
  const markets: Market[] =
    marketArg === "my" ? ["my"] : marketArg === "cn" ? ["cn"] : ["my", "cn"];

  const secret = APPLY ? getWriteSecret() : ""; // validate early (Task 2 will use it)

  console.log(`🔍 Corpus-evidence fast-track (${APPLY ? "APPLY" : "DRY RUN"})`);
  console.log(`   Markets: ${markets.join(", ")}\n`);

  // 1. Scan
  const allEntries: CollectedEntry[] = [];
  for (const market of markets) {
    const entries = await scanMarket(market);
    console.log(`   [${market}] scanned ${entries.length} unverified sales work entries`);
    allEntries.push(...entries);
  }
  console.log();

  // 2. Group by normalized employer surface
  const groups = new Map<string, EmployerGroup>();
  for (const entry of allEntries) {
    const companyKey = normalizeCompanyKey(entry.companyName);
    let group = groups.get(companyKey);
    if (!group) {
      group = {
        companyKey,
        displayName: entry.companyName,
        market: entry.market,
        entries: [],
        identityKeys: new Set(),
        totalYears: 0,
      };
      groups.set(companyKey, group);
    }
    group.entries.push(entry);
    group.identityKeys.add(entry.identityKey);
    group.totalYears += entry.years;
  }

  // 3. Classify
  const groupsByTier: Record<"tier1" | "tier2" | "excluded" | "defer", EmployerGroup[]> = {
    tier1: [],
    tier2: [],
    excluded: [],
    defer: [],
  };
  for (const group of groups.values()) {
    const result = classify(group);
    groupsByTier[result.tier].push(group);
  }
  const totals: Record<"tier1" | "tier2" | "excluded" | "defer", number> = {
    tier1: groupsByTier.tier1.length,
    tier2: groupsByTier.tier2.length,
    excluded: groupsByTier.excluded.length,
    defer: groupsByTier.defer.length,
  };

  // 4. Dry-run report
  printReport(groupsByTier, totals);

  if (APPLY) {
    await applyFastTrack(groupsByTier, secret);
  } else {
    console.log("\nPass --apply to write proposals + evidence sources (Task 2).");
  }
}

async function applyFastTrack(
  groupsByTier: Record<"tier1" | "tier2" | "excluded" | "defer", EmployerGroup[]>,
  secret: string,
): Promise<void> {
  // 1. Load existing proposals to dedupe by surface and companyKey.
  //    Fetch per-status buckets (each sorted by priority/updatedAt and
  //    well under the take limit) rather than one status-less scan, which
  //    silently drops the newest rows once the table exceeds 5000.
  const existing: IndustryProposal[] = [];
  for (const status of PROPOSAL_STATUSES) {
    const bucket = await convexRun<IndustryProposal[]>("companies:listIndustryProposals", {
      status,
      limit: 5000,
      writeSecret: secret,
    });
    existing.push(...bucket);
  }
  const bySurface = new Map<string, IndustryProposal>();
  const byCompanyKey = new Map<string, IndustryProposal>();
  for (const proposal of existing) {
    if (proposal.normalizedEmployerSurface) {
      const key = normalizeAlias(proposal.normalizedEmployerSurface);
      if (!bySurface.has(key)) bySurface.set(key, proposal);
    }
    if (proposal.companyKey && !byCompanyKey.has(proposal.companyKey)) {
      byCompanyKey.set(proposal.companyKey, proposal);
    }
  }
  console.log(`   Loaded ${existing.length} existing proposals\n`);

  let upserted = 0;
  let upgraded = 0;
  let skipped = 0;
  let errors = 0;

  const fastTrackGroups = [...groupsByTier.tier1, ...groupsByTier.tier2];
  for (const group of fastTrackGroups) {
    const tier = groupsByTier.tier1.includes(group) ? 1 : 2;
    const resumeCount = group.identityKeys.size;
    const cleanName = group.displayName.replace(/,+$/, "").trim();
    try {
      // Dedupe against existing proposals by normalized surface, then companyKey.
      const surfaceKey = normalizeAlias(group.displayName);
      const bySurfaceHit = bySurface.get(surfaceKey);
      const byKeyHit = byCompanyKey.get(group.companyKey);

      // Skip if the matched proposal is terminal (approved/rejected).
      const terminalHit = [bySurfaceHit, byKeyHit].find(
        (p) => p && !OPEN_PROPOSAL_STATUSES.has(p.status),
      );
      if (terminalHit) {
        console.log(`[→] ${group.companyKey} already ${terminalHit!.status}, skipping`);
        skipped++;
        continue;
      }

      const existingProposal = bySurfaceHit ?? byKeyHit;
      const proposalId = existingProposal
        ? existingProposal.proposalId
        : `corpus-ft-${idSuffix(group.companyKey)}`;

      if (!existingProposal) {
        // a) No existing proposal: create company + alias + proposal, then upgrade.
        await convexRun("companies:upsert", {
          companyKey: group.companyKey,
          displayName: cleanName,
          status: "confirmed",
          createdBy: "corpus-fast-track",
          writeSecret: secret,
        });
        await convexRun("companies:addAlias", {
          companyKey: group.companyKey,
          alias: group.displayName,
          source: "observed",
          writeSecret: secret,
        });
        // upsertIndustryProposal patches any open proposal matching the
        // companyKey/surface and returns its real proposalId (which can
        // differ from the precomputed one) — use the returned id.
        const proposalResult = await convexRun<{ proposalId: string }>(
          "companies:upsertIndustryProposal",
          {
            proposalId,
            companyKey: group.companyKey,
            normalizedEmployerSurface: group.displayName,
            triggerReasons: ["corpus_evidence"],
            priority: tier === 1 ? 95 : 85,
            suggestedIndustryClass: "cnc",
            suggestedVerificationLevel: "verified",
            materialChangeSummary: `Corpus evidence: ${resumeCount} resume(s) with CNC-relevant titles`,
            requestedBy: "corpus-fast-track",
            sampleReferences: [
              {
                workspaceSlug: "dev",
                resumeIdentity: group.entries[0].identityKey,
                workEntryFingerprint: group.entries[0].workEntryFingerprint,
              },
            ],
            writeSecret: secret,
          },
        );
        const createdProposalId = proposalResult.proposalId;
        await convexRun("companies:setIndustryProposalResearchState", {
          proposalId: createdProposalId,
          status: "ready_for_review",
          suggestedIndustryClass: "cnc",
          writeSecret: secret,
        });
        upserted++;

        // Evidence sources attach to the real proposal id.
        await addEvidenceSources(group, createdProposalId, secret);
        console.log(`[✓] ${group.companyKey} tier=${tier} resumes=${resumeCount} sources=${group.identityKeys.size}`);
        continue;
      } else if (
        existingProposal.status === "new" ||
        existingProposal.status === "needs_more_evidence"
      ) {
        // b) Existing open proposal that needs promotion.
        await convexRun("companies:setIndustryProposalResearchState", {
          proposalId: existingProposal.proposalId,
          status: "ready_for_review",
          suggestedIndustryClass: "cnc",
          writeSecret: secret,
        });
        upgraded++;

        // Evidence sources attach to the existing proposal id.
        await addEvidenceSources(group, existingProposal.proposalId, secret);
        console.log(`[✓] ${group.companyKey} tier=${tier} resumes=${resumeCount} sources=${group.identityKeys.size}`);
        continue;
      } else {
        // c) Existing open proposal (researching / ready_for_review):
        //    no status change needed, but attach the canonical companyKey
        //    when the proposal is still unmapped (created before the company
        //    was resolved) and evidence sources still attach (idempotent by
        //    sourceId) so corpus evidence is complete.
        if (!existingProposal.companyKey) {
          await convexRun("companies:upsertIndustryProposal", {
            proposalId: existingProposal.proposalId,
            companyKey: group.companyKey,
            normalizedEmployerSurface: group.displayName,
            triggerReasons: ["corpus_evidence"],
            priority: tier === 1 ? 95 : 85,
            suggestedIndustryClass: "cnc",
            suggestedVerificationLevel: "verified",
            materialChangeSummary: `Corpus evidence: ${resumeCount} resume(s) with CNC-relevant titles`,
            requestedBy: "corpus-fast-track",
            writeSecret: secret,
          });
        }
        await addEvidenceSources(group, existingProposal.proposalId, secret);
        console.log(`[✓] ${group.companyKey} tier=${tier} resumes=${resumeCount} sources=${group.identityKeys.size} (existing ${existingProposal.status})`);
        skipped++;
        continue;
      }
    } catch (error) {
      errors++;
      console.error(`[✗] ${group.companyKey} failed: ${(error as Error).message.slice(0, 160)}`);
    }
  }

  console.log(`\nApplied: ${upserted} upserted, ${upgraded} upgraded, ${skipped} skipped, ${errors} errors`);
}

/**
 * One evidence source per distinct resume that contributed to the employer.
 * Sources are unreviewed/active, which passes the approval-safe filter.
 */
async function addEvidenceSources(
  group: EmployerGroup,
  proposalId: string,
  secret: string,
): Promise<void> {
  const seenIdentities = new Set<string>();
  for (const entry of group.entries) {
    if (seenIdentities.has(entry.identityKey)) continue;
    seenIdentities.add(entry.identityKey);
    const sourceId =
      `corpus-src-${idSuffix(group.companyKey)}-` +
      `${entry.workEntryFingerprint ?? entry.identityKey.slice(-8)}`;
    await convexRun("companies:upsertIndustryEvidenceSource", {
      sourceId,
      companyKey: group.companyKey,
      proposalId,
      url: entry.profileUrl,
      sourceType: "registry",
      trustTier: "corroborating",
      title: `CNC corpus evidence: ${entry.jobTitle} (${formatYears(entry.years)}) at ${group.displayName}`,
      evidenceExcerpt: `CNC machining industry sales role: ${entry.jobTitle}, ${formatYears(entry.years)}`,
      fetchStatus: "fetched",
      fetchedAt: Date.now(),
      contentFingerprint: `corpus-${entry.workEntryFingerprint ?? entry.identityKey}`,
      writeSecret: secret,
    });
  }
}

main().catch(console.error);
