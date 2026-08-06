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
import { existsSync, readFileSync } from "node:fs";
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
  const url =
    `http://localhost:3000/api/resumes?q=${q}&location=${location}` +
    `&source=convex&paged=true&limit=200&workspaceSlug=hr`;

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

  if (APPLY) {
    getWriteSecret(); // validate early (Task 2 will use it)
  }

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
    console.log("Apply path not yet implemented");
  } else {
    console.log("\nPass --apply to write proposals + evidence sources (Task 2).");
  }
}

main().catch(console.error);
