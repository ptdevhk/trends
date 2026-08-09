import { v } from "convex/values";
import {
  mutation,
  query,
} from "./_generated/server";
import {
  MAX_RECRUITER_INDUSTRY_EVIDENCE_SOURCES,
  compareSourcePreviews,
  normalizeIndustryEvidenceUrl,
  parseSourcePreview,
} from "@trends/shared";
import {
  findIndustryEvidenceSource,
  industryClassValidator,
  mapWithConcurrency,
  normalizeCompanyKey,
  requireReadSecret,
  requireWriteSecret,
  uniqueSortedStrings,
  verificationLevelValidator,
} from "./lib/company_shared.js";

// ---------------------------------------------------------------------------
// Company industry profiles (reviewed catalog overlay)
// ---------------------------------------------------------------------------

const evidenceSourceValidator = v.union(
  v.literal("seed"),
  v.literal("manual"),
  v.literal("worker_web"),
);

const industryEvidenceFreshnessValidator = v.union(
  v.literal("fresh"),
  v.literal("refresh_due"),
  v.literal("checking"),
  v.literal("changed"),
  v.literal("unavailable"),
  v.literal("conflict"),
);

const industryCompatibilityStateValidator = v.union(
  v.literal("legacy_seed"),
  v.literal("reviewed"),
  v.literal("strict_reviewed"),
);

export const listIndustryProfiles = query({
  args: {
    writeSecret: v.optional(v.string()),
    verificationLevel: v.optional(verificationLevelValidator),
  },
  handler: async (ctx, args) => {
    requireReadSecret(args.writeSecret);
    const rows = args.verificationLevel
      ? await ctx.db
          .query("company_industry_profiles")
          .withIndex("by_verification", (q) => q.eq("verificationLevel", args.verificationLevel!))
          .collect()
      : await ctx.db.query("company_industry_profiles").collect();

    return rows.sort((left, right) => left.companyKey.localeCompare(right.companyKey));
  },
});

export const getIndustryProfile = query({
  args: {
    writeSecret: v.optional(v.string()),
    companyKey: v.string(),
  },
  handler: async (ctx, args) => {
    requireReadSecret(args.writeSecret);
    const key = normalizeCompanyKey(args.companyKey);
    const rows = await ctx.db
      .query("company_industry_profiles")
      .withIndex("by_company_key", (q) => q.eq("companyKey", key))
      .collect();
    return rows.length > 0 ? rows[0] : null;
  },
});

export const listVerifiedIndustryEmployerAliases = query({
  args: {
    writeSecret: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    requireReadSecret(args.writeSecret);
    const profiles = await ctx.db
      .query("company_industry_profiles")
      .withIndex("by_verification", (q) => q.eq("verificationLevel", "verified"))
      .collect();

    const items = await mapWithConcurrency(profiles, 12, async (profile) => {
      const [companies, aliases] = await Promise.all([
        ctx.db
          .query("companies")
          .withIndex("by_company_key", (q) =>
            q.eq("companyKey", profile.companyKey),
          )
          .collect(),
        ctx.db
          .query("company_aliases")
          .withIndex("by_company", (q) =>
            q.eq("companyKey", profile.companyKey),
          )
          .collect(),
      ]);
      const company = companies[0];
      if (!company) {
        return null;
      }
      return {
        companyKey: profile.companyKey,
        industryClass: profile.industryClass,
        displayName: company.displayName,
        aliases: aliases
          .map((alias) => alias.aliasDisplay)
          .filter((value) => typeof value === "string" && value.trim().length > 0)
          .sort((left, right) => left.localeCompare(right)),
        updatedAt: profile.updatedAt,
      };
    });

    return items
      .filter((item) => item !== null)
      .sort(
        (left, right) =>
          right.updatedAt - left.updatedAt ||
          left.companyKey.localeCompare(right.companyKey),
      )
      .slice(0, 500);
  },
});

export const getReviewedIndustryCatalogByKeys = query({
  args: {
    writeSecret: v.optional(v.string()),
    companyKeys: v.array(v.string()),
  },
  handler: async (ctx, args) => {
    requireReadSecret(args.writeSecret);
    const companyKeys = uniqueSortedStrings(
      args.companyKeys.map(normalizeCompanyKey),
    );
    if (companyKeys.length > 200) {
      throw new Error("Reviewed industry catalog lookup is limited to 200 companies");
    }

    const results = await mapWithConcurrency(companyKeys, 12, async (companyKey) => {
      const profiles = await ctx.db
        .query("company_industry_profiles")
        .withIndex("by_company_key", (index) => index.eq("companyKey", companyKey))
        .collect();
      const profile = profiles[0];
      if (!profile?.currentRevisionId) {
        return { companyKey, status: "missing" as const };
      }

      const [revisions, companies] = await Promise.all([
        ctx.db
          .query("company_industry_verdict_revisions")
          .withIndex("by_revision_id", (index) =>
            index.eq("revisionId", profile.currentRevisionId!),
          )
          .collect(),
        ctx.db
          .query("companies")
          .withIndex("by_company_key", (index) =>
            index.eq("companyKey", companyKey),
          )
          .collect(),
      ]);
      const revision = revisions[0];
      if (!revision || revision.companyKey !== companyKey) {
        return {
          companyKey,
          status: "invalid_current_revision" as const,
          currentRevisionId: profile.currentRevisionId,
        };
      }

      const companyName = companies[0]?.displayName ?? companyKey;
      const sourceRows = (
        await mapWithConcurrency(
          revision.approvedSourceIds,
          8,
          (sourceId) => findIndustryEvidenceSource(ctx, sourceId),
        )
      ).filter(
        (
          source,
        ): source is NonNullable<typeof source> =>
          Boolean(
            source &&
              source.reviewStatus === "approved" &&
              source.sourceState === "active" &&
              source.sourceType !== "search_result" &&
              source.trustTier !== "discovery" &&
              normalizeIndustryEvidenceUrl(source.url) !== null,
          ),
      );
      const sourcePreviews = sourceRows
        .map((source) => parseSourcePreview(source))
        .filter((source): source is NonNullable<typeof source> => source !== null)
        .sort(compareSourcePreviews)
        .slice(0, MAX_RECRUITER_INDUSTRY_EVIDENCE_SOURCES);

      return {
        companyKey,
        status: "reviewed" as const,
        profile: {
          companyKey,
          companyName,
          industryClass: revision.industryClass,
          verificationLevel: revision.verificationLevel,
          verdictRevisionId: revision.revisionId,
          evidenceSummary: revision.evidenceSummary,
          reviewedAt: revision.reviewedAt,
          reviewedBy: revision.reviewedBy,
          sourceCount: revision.approvedSourceIds.length,
          sourcePreviews,
          additionalSourceCount: Math.max(
            0,
            revision.approvedSourceIds.length - sourcePreviews.length,
          ),
          ...(profile.freshnessState
            ? { freshnessState: profile.freshnessState }
            : {}),
        },
      };
    });

    const byKey = new Map(results.map((result) => [result.companyKey, result]));
    return args.companyKeys
      .map(normalizeCompanyKey)
      .filter((companyKey, index, values) =>
        Boolean(companyKey) && values.indexOf(companyKey) === index,
      )
      .map((companyKey) => byKey.get(companyKey))
      .filter((result): result is NonNullable<typeof result> => result !== undefined);
  },
});

export const upsertIndustryProfile = mutation({
  args: {
    writeSecret: v.optional(v.string()),
    companyKey: v.string(),
    industryClass: industryClassValidator,
    verificationLevel: verificationLevelValidator,
    officialDomain: v.optional(v.string()),
    evidenceSource: v.optional(evidenceSourceValidator),
    summary: v.optional(v.string()),
    sourceUrl: v.optional(v.string()),
    sourceDomain: v.optional(v.string()),
    sourceType: v.optional(v.string()),
    msicCode: v.optional(v.string()),
    msicDescription: v.optional(v.string()),
    fetchedAt: v.optional(v.number()),
    currentRevisionId: v.optional(v.string()),
    reviewedAt: v.optional(v.number()),
    reviewedBy: v.optional(v.string()),
    sourceCount: v.optional(v.number()),
    freshnessState: v.optional(industryEvidenceFreshnessValidator),
    nextReviewAt: v.optional(v.number()),
    catalogVersion: v.optional(v.number()),
    compatibilityState: v.optional(industryCompatibilityStateValidator),
    updatedBy: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    requireWriteSecret(args.writeSecret);
    const companyKey = normalizeCompanyKey(args.companyKey);
    const now = Date.now();

    const existing = await ctx.db
      .query("company_industry_profiles")
      .withIndex("by_company_key", (q) => q.eq("companyKey", companyKey))
      .collect();

    const payload = {
      companyKey,
      industryClass: args.industryClass,
      verificationLevel: args.verificationLevel,
      ...(args.officialDomain !== undefined ? { officialDomain: args.officialDomain } : {}),
      evidenceSource: args.evidenceSource ?? "manual",
      ...(args.summary !== undefined ? { summary: args.summary } : {}),
      ...(args.sourceUrl !== undefined ? { sourceUrl: args.sourceUrl } : {}),
      ...(args.sourceDomain !== undefined ? { sourceDomain: args.sourceDomain } : {}),
      ...(args.sourceType !== undefined ? { sourceType: args.sourceType } : {}),
      ...(args.msicCode !== undefined ? { msicCode: args.msicCode } : {}),
      ...(args.msicDescription !== undefined ? { msicDescription: args.msicDescription } : {}),
      ...(args.fetchedAt !== undefined ? { fetchedAt: args.fetchedAt } : {}),
      ...(args.currentRevisionId !== undefined ? { currentRevisionId: args.currentRevisionId } : {}),
      ...(args.reviewedAt !== undefined ? { reviewedAt: args.reviewedAt } : {}),
      ...(args.reviewedBy !== undefined ? { reviewedBy: args.reviewedBy } : {}),
      ...(args.sourceCount !== undefined ? { sourceCount: args.sourceCount } : {}),
      ...(args.freshnessState !== undefined ? { freshnessState: args.freshnessState } : {}),
      ...(args.nextReviewAt !== undefined ? { nextReviewAt: args.nextReviewAt } : {}),
      ...(args.catalogVersion !== undefined ? { catalogVersion: args.catalogVersion } : {}),
      ...(args.compatibilityState !== undefined ? { compatibilityState: args.compatibilityState } : {}),
      updatedAt: now,
      updatedBy: args.updatedBy ?? "system",
    };

    if (existing.length > 0) {
      await ctx.db.patch(existing[0]._id, payload);
      return { companyKey, created: false, _id: existing[0]._id };
    }

    const id = await ctx.db.insert("company_industry_profiles", payload);
    return { companyKey, created: true, _id: id };
  },
});

export const deleteIndustryProfile = mutation({
  args: {
    writeSecret: v.optional(v.string()),
    companyKey: v.string(),
  },
  handler: async (ctx, args) => {
    requireWriteSecret(args.writeSecret);
    const companyKey = normalizeCompanyKey(args.companyKey);
    const rows = await ctx.db
      .query("company_industry_profiles")
      .withIndex("by_company_key", (q) => q.eq("companyKey", companyKey))
      .collect();
    for (const row of rows) {
      await ctx.db.delete(row._id);
    }
    return { deleted: rows.length };
  },
});
