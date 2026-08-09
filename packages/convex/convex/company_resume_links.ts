import { v } from "convex/values";
import {
  internalAction,
  internalQuery,
  mutation,
  query,
} from "./_generated/server";
import { internal } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";
import {
  buildCompanyAliasIndex,
  resolveCompanyAlias,
} from "@trends/shared";
import { deriveWorkEntryFingerprint } from "./lib/company_resume_links.js";
import type { ResumeScanRow } from "./resumes_mutations.js";
import {
  currentIndustryRevisionId,
  listAliasesForCompany,
  normalizeCompanyKey,
  normalizeWorkspaceSlug,
  requireReadSecret,
  requireWriteSecret,
} from "./lib/company_shared.js";

export const listAffectedResumesByCompany = query({
  args: {
    writeSecret: v.optional(v.string()),
    workspaceSlug: v.string(),
    companyKey: v.string(),
    cursor: v.optional(v.string()),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    requireReadSecret(args.writeSecret);
    const workspaceSlug = normalizeWorkspaceSlug(args.workspaceSlug);
    const companyKey = normalizeCompanyKey(args.companyKey);
    if (!companyKey) {
      return {
        items: [],
        continueCursor: "",
        isDone: true,
      };
    }

    const requestedLimit = Math.floor(args.limit ?? 100);
    const limit = Math.min(200, Math.max(1, requestedLimit));
    const page = await ctx.db
      .query("company_resume_links")
      .withIndex("by_workspace_company", (index) =>
        index
          .eq("workspaceSlug", workspaceSlug)
          .eq("companyKey", companyKey),
      )
      .paginate({
        cursor: args.cursor ?? null,
        numItems: limit,
      });

    return {
      items: page.page,
      continueCursor: page.continueCursor,
      isDone: page.isDone,
    };
  },
});

// ---------------------------------------------------------------------------
// Company-link backfill (F1)
//
// company_resume_links are derived only from computed ingestData, so newly
// approved companies have zero links and every targeted recompute no-ops with
// processedCount 0. The backfill scans resumes, matches raw work-history
// employer surfaces against the company's display names + registered aliases
// (case/punctuation-insensitive, longest-alias soft match), and upserts
// idempotent links. It is bounded per invocation and self-chains via the
// scheduler until the corpus is done.
// ---------------------------------------------------------------------------

const BACKFILL_DEFAULT_MAX_PAGES = 10;

const BACKFILL_MAX_PAGES = 25;

const BACKFILL_SCAN_PAGE_SIZE = 100;

export type CompanyLinkBackfillHit = {
  resumeId: Id<"resumes">;
  matchedEmployerSurfaces: string[];
  workEntryFingerprints: string[];
  currentVerdictRevisionId?: string;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function normalizeToken(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const normalized = value.trim();
  return normalized ? normalized : undefined;
}

function collectIngestEmployerSurfaces(
  ingestData: Doc<"resumes">["ingestData"],
): Array<{ surface: string; fingerprint?: string; verdictRevisionId?: string }> {
  const out: Array<{ surface: string; fingerprint?: string; verdictRevisionId?: string }> = [];
  for (const roleSignal of ingestData?.roleSignals ?? []) {
    for (const entry of roleSignal.matchedWorkEntries ?? []) {
      const surface = normalizeToken(entry.companyName);
      if (!surface) continue;
      out.push({
        surface,
        fingerprint: deriveWorkEntryFingerprint(entry),
        verdictRevisionId: normalizeToken(entry.verdictRevisionId),
      });
    }
  }
  return out;
}

function collectContentEmployerSurfaces(
  content: unknown,
): Array<{ surface: string; fingerprint?: string; verdictRevisionId?: string }> {
  if (!isRecord(content) || !Array.isArray(content.workHistory)) {
    return [];
  }
  const out: Array<{ surface: string; fingerprint?: string; verdictRevisionId?: string }> = [];
  for (const entry of content.workHistory) {
    if (!isRecord(entry)) continue;
    const surface = normalizeToken(entry.companyName);
    if (!surface) continue;
    out.push({
      surface,
      fingerprint: deriveWorkEntryFingerprint({
        companyName: typeof entry.companyName === "string" ? entry.companyName : undefined,
        jobTitle: typeof entry.jobTitle === "string" ? entry.jobTitle : undefined,
      }),
    });
  }
  return out;
}

/**
 * Match one resume's employer surfaces against a company's alias index.
 * Returns null when no surface resolves to the company; otherwise the link
 * payload. currentVerdictRevisionId is set only when the resume's computed
 * entries carry exactly one verdict revision for this company (mirroring the
 * computed-path contract) — resumes never computed under the company stay
 * revision-less so a targeted recompute classifies them as stale.
 */

function matchResumeEmployerSurfaces(
  resume: ResumeScanRow,
  aliasIndex: Map<string, string>,
  companyKey: string,
): CompanyLinkBackfillHit | null {
  const surfaces = new Set<string>();
  const fingerprints = new Set<string>();
  const revisionIds = new Set<string>();

  for (const item of [
    ...collectIngestEmployerSurfaces(resume.ingestData),
    ...collectContentEmployerSurfaces(resume.content),
  ]) {
    if (resolveCompanyAlias(aliasIndex, item.surface) !== companyKey) {
      continue;
    }
    surfaces.add(item.surface);
    if (item.fingerprint) fingerprints.add(item.fingerprint);
    if (item.verdictRevisionId) revisionIds.add(item.verdictRevisionId);
  }

  if (surfaces.size === 0) {
    return null;
  }
  return {
    resumeId: resume._id,
    matchedEmployerSurfaces: [...surfaces],
    workEntryFingerprints: [...fingerprints],
    ...(revisionIds.size === 1 ? { currentVerdictRevisionId: [...revisionIds][0] } : {}),
  };
}

export const getCompanyBackfillCatalog = internalQuery({
  args: {
    companyKey: v.string(),
  },
  handler: async (ctx, args) => {
    const companyKey = normalizeCompanyKey(args.companyKey);
    if (!companyKey) return null;
    const companies = await ctx.db
      .query("companies")
      .withIndex("by_company_key", (q: any) => q.eq("companyKey", companyKey))
      .collect();
    const company = companies[0];
    if (!company) return null;
    const aliases = await listAliasesForCompany(ctx, companyKey);
    const currentRevisionId = await currentIndustryRevisionId(ctx, companyKey);
    return {
      companyKey,
      displayName: company.displayName,
      ...(company.nameCn ? { nameCn: company.nameCn } : {}),
      ...(company.nameEn ? { nameEn: company.nameEn } : {}),
      aliases: aliases.map((alias) => ({
        aliasDisplay: alias.aliasDisplay,
        aliasNormalized: alias.aliasNormalized,
      })),
      ...(currentRevisionId ? { currentRevisionId } : {}),
    };
  },
});

export type CompanyLinkBackfillResult = {
  status: "completed" | "continued" | "not_found";
  companyKey: string;
  scannedRows: number;
  matchedRows: number;
  linkedRows: number;
  cursor: string | null;
  isDone: boolean;
};

export const backfillCompanyResumeLinksByCompany = internalAction({
  args: {
    companyKey: v.string(),
    cursor: v.optional(v.string()),
    maxPages: v.optional(v.number()),
  },
  handler: async (ctx, args): Promise<CompanyLinkBackfillResult> => {
    const companyKey = normalizeCompanyKey(args.companyKey);
    if (!companyKey) {
      throw new Error("Backfill requires a companyKey");
    }
    const catalog = await ctx.runQuery(
      internal.companies.getCompanyBackfillCatalog,
      { companyKey },
    );
    if (!catalog) {
      return {
        status: "not_found",
        companyKey,
        scannedRows: 0,
        matchedRows: 0,
        linkedRows: 0,
        cursor: null,
        isDone: true,
      };
    }
    const aliasIndex = buildCompanyAliasIndex([catalog]);
    if (aliasIndex.size === 0) {
      return {
        status: "completed",
        companyKey,
        scannedRows: 0,
        matchedRows: 0,
        linkedRows: 0,
        cursor: null,
        isDone: true,
      };
    }

    const maxPages = Math.min(
      Math.max(Math.floor(args.maxPages ?? BACKFILL_DEFAULT_MAX_PAGES), 1),
      BACKFILL_MAX_PAGES,
    );
    let cursor = args.cursor ?? null;
    let pages = 0;
    let scannedRows = 0;
    const hits: CompanyLinkBackfillHit[] = [];

    while (pages < maxPages) {
      const batch: {
        continueCursor: string;
        isDone: boolean;
        page: ResumeScanRow[];
      } = await ctx.runQuery(internal.resumes.listResumeScanBatch, {
        ...(cursor ? { cursor } : {}),
        limit: BACKFILL_SCAN_PAGE_SIZE,
      });
      pages += 1;
      scannedRows += batch.page.length;

      for (const resume of batch.page) {
        const hit = matchResumeEmployerSurfaces(resume, aliasIndex, companyKey);
        if (hit) {
          hits.push(hit);
        }
      }

      if (batch.isDone) {
        cursor = null;
        break;
      }
      cursor = batch.continueCursor;
    }

    let linkedRows = 0;
    if (hits.length > 0) {
      const result = await ctx.runMutation(
        internal.resumes_mutations.upsertBackfilledCompanyResumeLinks,
        {
          companyKey,
          rows: hits.map((hit) => ({
            resumeId: hit.resumeId,
            matchedEmployerSurfaces: hit.matchedEmployerSurfaces,
            workEntryFingerprints: hit.workEntryFingerprints,
            ...(hit.currentVerdictRevisionId
              ? { currentVerdictRevisionId: hit.currentVerdictRevisionId }
              : {}),
          })),
        },
      );
      linkedRows = result.linkedRows;
    }

    if (cursor !== null) {
      await ctx.scheduler.runAfter(
        0,
        internal.companies.backfillCompanyResumeLinksByCompany,
        { companyKey, cursor },
      );
      return {
        status: "continued",
        companyKey,
        scannedRows,
        matchedRows: hits.length,
        linkedRows,
        cursor,
        isDone: false,
      };
    }

    return {
      status: "completed",
      companyKey,
      scannedRows,
      matchedRows: hits.length,
      linkedRows,
      cursor: null,
      isDone: true,
    };
  },
});

/**
 * Fire the link-backfill action after a verified verdict commits.
 * Shared by the human-approve lane and the governed auto-approve lane;
 * rejected verdicts never schedule a backfill.
 */

export async function scheduleCompanyLinkBackfill(
  ctx: {
    scheduler?: {
      runAfter(delay: number, fn: unknown, args: Record<string, unknown>): Promise<unknown>;
    };
  },
  args: { companyKey: string; verificationLevel: "verified" | "rejected" },
): Promise<boolean> {
  if (args.verificationLevel !== "verified") {
    return false;
  }
  if (!ctx.scheduler) {
    return false;
  }
  await ctx.scheduler.runAfter(
    0,
    internal.companies.backfillCompanyResumeLinksByCompany,
    { companyKey: args.companyKey },
  );
  return true;
}

export const backfillCompanyResumeLinks = mutation({
  args: {
    writeSecret: v.optional(v.string()),
    companyKey: v.string(),
  },
  handler: async (ctx, args) => {
    requireWriteSecret(args.writeSecret);
    const companyKey = normalizeCompanyKey(args.companyKey);
    if (!companyKey) {
      throw new Error("Backfill requires a companyKey");
    }
    const companies = await ctx.db
      .query("companies")
      .withIndex("by_company_key", (q: any) => q.eq("companyKey", companyKey))
      .collect();
    if (!companies[0]) {
      throw new Error(`Unknown companyKey: ${companyKey}`);
    }
    await ctx.scheduler.runAfter(
      0,
      internal.companies.backfillCompanyResumeLinksByCompany,
      { companyKey },
    );
    return { scheduled: true, companyKey };
  },
});

export const resolveIndustryRefreshResumeReference = query({
  args: {
    writeSecret: v.optional(v.string()),
    workspaceSlug: v.string(),
    companyKey: v.string(),
    verdictRevisionId: v.string(),
    resumeReference: v.string(),
  },
  handler: async (ctx, args) => {
    requireReadSecret(args.writeSecret);
    const workspaceSlug = normalizeWorkspaceSlug(args.workspaceSlug);
    const companyKey = normalizeCompanyKey(args.companyKey);
    const verdictRevisionId = args.verdictRevisionId.trim();
    const resumeReference = args.resumeReference.trim();
    if (!companyKey || !verdictRevisionId || !resumeReference) return null;
    const rows = await ctx.db
      .query("company_resume_links")
      .withIndex("by_workspace_company", (index) =>
        index
          .eq("workspaceSlug", workspaceSlug)
          .eq("companyKey", companyKey),
      )
      .take(201);
    if (rows.length > 200) {
      throw new Error("Resume reference lookup requires a narrower company link page");
    }
    const matching = rows
      .filter(
        (row) =>
          row.currentVerdictRevisionId === verdictRevisionId &&
          (String(row.resumeId) === resumeReference ||
            row.resumeIdentity === resumeReference),
      )
      .sort((left, right) => {
        const leftExact = String(left.resumeId) === resumeReference ? 0 : 1;
        const rightExact = String(right.resumeId) === resumeReference ? 0 : 1;
        return (
          leftExact - rightExact ||
          left.resumeIdentity.localeCompare(right.resumeIdentity)
        );
      });
    const match = matching[0];
    if (!match) return null;
    return {
      resumeIdentity: match.resumeIdentity,
      ...(match.workEntryFingerprints.length === 1
        ? { workEntryFingerprint: match.workEntryFingerprints[0] }
        : {}),
    };
  },
});
