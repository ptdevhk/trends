/// Shared helpers for the company / industry-evidence domain modules.
///
/// These helpers are used by two or more of the companies.ts successor
/// modules (company_registry, industry_profiles, company_resume_links,
/// industry_proposals, industry_evidence_sources, industry_verdicts,
/// industry_recompute, industry_research_requests, industry_identity,
/// industry_maintenance_runs, industry_data_entries, industry_coverage)
/// and live here so each module stays cohesive. Semantics are unchanged
/// from the original single-file definitions.
import { v } from "convex/values";
import { DEFAULT_WORKSPACE_SLUG } from "../sessions";

export function normalizeWorkspaceSlug(input: string | undefined): string {
  const normalized = input?.trim();
  return normalized && normalized.length > 0 ? normalized : DEFAULT_WORKSPACE_SLUG;
}

export function requireWriteSecret(writeSecret: string | undefined): void {
  const expected = process.env.CONVEX_WRITE_SECRET;
  if (!expected || writeSecret !== expected) {
    throw new Error("Unauthorized Convex write");
  }
}

export function requireReadSecret(writeSecret: string | undefined): void {
  const expected = process.env.CONVEX_WRITE_SECRET;
  if (!expected || writeSecret !== expected) {
    throw new Error("Unauthorized Convex read");
  }
}

export function normalizeCompanyKey(value: string): string {
  return value.trim().toLowerCase().replace(/\s+/g, "-");
}

export async function listAliasesForCompany(
  ctx: { db: any },
  companyKey: string,
): Promise<Array<{ aliasDisplay: string; aliasNormalized: string; source: string }>> {
  const rows = await ctx.db
    .query("company_aliases")
    .withIndex("by_company", (q: any) => q.eq("companyKey", companyKey))
    .collect();
  return rows.map((row: any) => ({
    aliasDisplay: row.aliasDisplay,
    aliasNormalized: row.aliasNormalized,
    source: row.source,
  }));
}

export const industryClassValidator = v.union(
  v.literal("cnc"),
  v.literal("automation"),
  v.literal("metrology"),
  v.literal("industrial"),
  v.literal("non_industry"),
  v.literal("unknown"),
);

export const machineOriginValidator = v.union(
  v.literal("international"),
  v.literal("domestic"),
  v.literal("unknown"),
);

export const verificationLevelValidator = v.union(
  v.literal("verified"),
  v.literal("candidate"),
  v.literal("rejected"),
);

export const INDUSTRY_REVIEW_STALE_PREFIX = "INDUSTRY_REVIEW_STALE:";

export const OPEN_INDUSTRY_PROPOSAL_STATUSES = new Set([
  "new",
  "researching",
  "ready_for_review",
  "needs_more_evidence",
]);

export const INDUSTRY_EVIDENCE_DAY_MS = 24 * 60 * 60 * 1_000;

export const industryMaintenanceRunModeValidator = v.union(
  v.literal("targeted"),
  v.literal("sweep"),
  v.literal("freshness"),
);

export const ACTIVE_RESEARCH_REQUEST_STATES = new Set([
  "queued",
  "leased",
  "retry_wait",
]);

export const REQUESTABLE_RESEARCH_PROPOSAL_STATUSES = new Set([
  "new",
  "researching",
  "ready_for_review",
  "needs_more_evidence",
]);

export function nextIndustryEvidenceReviewAt(
  sourceType: string,
  trustTier: string,
  from: number,
): number {
  let days = 90;
  if (
    sourceType === "official_site" ||
    sourceType === "registry" ||
    sourceType === "taxonomy"
  ) {
    days =
      trustTier === "primary" || trustTier === "authoritative" ? 180 : 120;
  } else if (sourceType === "oem_partner" || sourceType === "trade_body") {
    days = 120;
  } else if (sourceType === "directory" || sourceType === "reporting") {
    days = 60;
  } else if (sourceType === "search_result" || trustTier === "discovery") {
    days = 30;
  }
  return from + days * INDUSTRY_EVIDENCE_DAY_MS;
}

export function uniqueSortedStrings(values: string[]): string[] {
  return Array.from(
    new Set(values.map((value) => value.trim()).filter(Boolean)),
  ).sort((left, right) => left.localeCompare(right));
}

export async function mapWithConcurrency<T, R>(
  items: T[],
  concurrency: number,
  mapper: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  if (items.length === 0) return [];
  const results = new Array<R>(items.length);
  let nextIndex = 0;
  const workerCount = Math.min(
    items.length,
    Math.max(1, Math.floor(concurrency)),
  );
  await Promise.all(
    Array.from({ length: workerCount }, async () => {
      while (nextIndex < items.length) {
        const index = nextIndex;
        nextIndex += 1;
        results[index] = await mapper(items[index]!, index);
      }
    }),
  );
  return results;
}

export async function findIndustryProposal(ctx: { db: any }, proposalId: string) {
  const rows = await ctx.db
    .query("company_industry_review_proposals")
    .withIndex("by_proposal_id", (q: any) => q.eq("proposalId", proposalId))
    .collect();
  return rows[0] ?? null;
}

export function assertExpectedIndustryProposalUpdatedAt(
  proposal: { updatedAt: number },
  expectedUpdatedAt: number | undefined,
) {
  if (
    expectedUpdatedAt !== undefined &&
    proposal.updatedAt !== expectedUpdatedAt
  ) {
    throw new Error(`${INDUSTRY_REVIEW_STALE_PREFIX} proposal changed during review`);
  }
}

export async function findIndustryEvidenceSource(ctx: { db: any }, sourceId: string) {
  const rows = await ctx.db
    .query("company_industry_evidence_sources")
    .withIndex("by_source_id", (q: any) => q.eq("sourceId", sourceId))
    .collect();
  return rows[0] ?? null;
}

export const TERMINAL_INDUSTRY_RECOMPUTE_STATUSES = new Set([
  "completed",
  "partial_failed",
  "failed",
  "superseded",
]);

export async function findIndustryRecomputeRun(ctx: { db: any }, runId: string) {
  const rows = await ctx.db
    .query("company_industry_recompute_runs")
    .withIndex("by_run_id", (q: any) => q.eq("runId", runId))
    .collect();
  return rows[0] ?? null;
}

export async function currentIndustryRevisionId(
  ctx: { db: any },
  companyKey: string,
): Promise<string | undefined> {
  const rows = await ctx.db
    .query("company_industry_profiles")
    .withIndex("by_company_key", (q: any) => q.eq("companyKey", companyKey))
    .collect();
  return rows[0]?.currentRevisionId;
}

export async function findIndustryMaintenanceRun(ctx: { db: any }, runId: string) {
  const rows = await ctx.db.query("industry_maintenance_runs").collect();
  return rows.find((r: any) => r.runId === runId) ?? null;
}
