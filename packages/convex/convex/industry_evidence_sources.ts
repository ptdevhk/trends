import { v } from "convex/values";
import {
  mutation,
  query,
} from "./_generated/server";
import { normalizeIndustryEvidenceUrl } from "@trends/shared";
import {
  findIndustryEvidenceSource,
  findIndustryProposal,
  industryClassValidator,
  mapWithConcurrency,
  nextIndustryEvidenceReviewAt,
  normalizeCompanyKey,
  OPEN_INDUSTRY_PROPOSAL_STATUSES,
  requireReadSecret,
  requireWriteSecret,
} from "./lib/company_shared.js";

const industryEvidenceSourceTypeValidator = v.union(
  v.literal("official_site"),
  v.literal("registry"),
  v.literal("taxonomy"),
  v.literal("oem_partner"),
  v.literal("trade_body"),
  v.literal("directory"),
  v.literal("reporting"),
  v.literal("other"),
  v.literal("search_result"),
);

const industryEvidenceTrustTierValidator = v.union(
  v.literal("primary"),
  v.literal("authoritative"),
  v.literal("corroborating"),
  v.literal("discovery"),
);

const industryEvidenceFetchStatusValidator = v.union(
  v.literal("pending"),
  v.literal("fetched"),
  v.literal("failed"),
  v.literal("unavailable"),
);

const industryEvidenceCheckOutcomeValidator = v.union(
  v.literal("unchanged"),
  v.literal("changed"),
  v.literal("unavailable"),
  v.literal("conflict"),
);

export const upsertIndustryEvidenceSource = mutation({
  args: {
    writeSecret: v.optional(v.string()),
    sourceId: v.string(),
    companyKey: v.optional(v.string()),
    proposalId: v.optional(v.string()),
    url: v.string(),
    sourceType: industryEvidenceSourceTypeValidator,
    trustTier: industryEvidenceTrustTierValidator,
    title: v.optional(v.string()),
    evidenceExcerpt: v.optional(v.string()),
    fetchedAt: v.optional(v.number()),
    contentFingerprint: v.optional(v.string()),
    fetchStatus: industryEvidenceFetchStatusValidator,
    suggestedIndustryClass: v.optional(industryClassValidator),
    workerConfidence: v.optional(v.number()),
    relevanceDemoted: v.optional(v.boolean()),
  },
  handler: async (ctx, args) => {
    requireWriteSecret(args.writeSecret);
    const sourceId = args.sourceId.trim();
    const normalizedUrl = normalizeIndustryEvidenceUrl(args.url);
    if (!sourceId || !normalizedUrl) {
      throw new Error("sourceId and a safe public HTTP(S) URL are required");
    }
    if (
      args.sourceType === "search_result" &&
      args.trustTier !== "discovery"
    ) {
      throw new Error("search_result sources must use discovery trust");
    }
    const companyKey = args.companyKey
      ? normalizeCompanyKey(args.companyKey)
      : undefined;
    const proposalId = args.proposalId?.trim();
    if (proposalId) {
      const proposal = await findIndustryProposal(ctx, proposalId);
      if (!proposal) {
        throw new Error(`Unknown proposalId: ${proposalId}`);
      }
      if (
        companyKey &&
        proposal.companyKey &&
        proposal.companyKey !== companyKey
      ) {
        throw new Error("Evidence companyKey does not match proposal");
      }
    }

    const existing = await findIndustryEvidenceSource(ctx, sourceId);
    const now = Date.now();
    const material = {
      ...(companyKey ? { companyKey } : {}),
      ...(proposalId ? { proposalId } : {}),
      url: normalizedUrl.url,
      sourceDomain: normalizedUrl.sourceDomain,
      sourceType: args.sourceType,
      trustTier: args.trustTier,
      ...(args.title !== undefined ? { title: args.title.trim() } : {}),
      ...(args.evidenceExcerpt !== undefined
        ? { evidenceExcerpt: args.evidenceExcerpt.trim().slice(0, 800) }
        : {}),
      ...(args.fetchedAt !== undefined ? { fetchedAt: args.fetchedAt } : {}),
      ...(args.fetchStatus === "fetched"
        ? {
            lastSuccessfulFetchAt:
              args.fetchedAt ?? existing?.lastSuccessfulFetchAt ?? now,
          }
        : {}),
      ...(args.contentFingerprint !== undefined
        ? { contentFingerprint: args.contentFingerprint.trim() }
        : {}),
      fetchStatus: args.fetchStatus,
      ...(args.suggestedIndustryClass !== undefined
        ? { suggestedIndustryClass: args.suggestedIndustryClass }
        : {}),
      ...(args.workerConfidence !== undefined
        ? { workerConfidence: Math.max(0, Math.min(1, args.workerConfidence)) }
        : {}),
      ...(args.relevanceDemoted !== undefined
        ? { relevanceDemoted: args.relevanceDemoted }
        : {}),
      updatedAt: now,
    };

    if (existing) {
      if (
        existing.reviewStatus === "approved" &&
        (existing.url !== material.url ||
          existing.sourceType !== material.sourceType ||
          existing.trustTier !== material.trustTier ||
          (args.contentFingerprint !== undefined &&
            existing.contentFingerprint !== material.contentFingerprint))
      ) {
        throw new Error(
          "Approved evidence is immutable; create a new sourceId for material changes",
        );
      }
      await ctx.db.patch(existing._id, material);
      return { sourceId, created: false, _id: existing._id };
    }

    const id = await ctx.db.insert("company_industry_evidence_sources", {
      sourceId,
      ...material,
      reviewStatus: "unreviewed",
      sourceState: "active",
      createdAt: now,
    });
    return { sourceId, created: true, _id: id };
  },
});

export const listIndustryEvidenceSources = query({
  args: {
    writeSecret: v.optional(v.string()),
    companyKey: v.optional(v.string()),
    proposalId: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    requireReadSecret(args.writeSecret);
    let rows;
    if (args.proposalId) {
      rows = await ctx.db
        .query("company_industry_evidence_sources")
        .withIndex("by_proposal", (q) => q.eq("proposalId", args.proposalId))
        .collect();
    } else if (args.companyKey) {
      const companyKey = normalizeCompanyKey(args.companyKey);
      rows = await ctx.db
        .query("company_industry_evidence_sources")
        .withIndex("by_company_review", (q) => q.eq("companyKey", companyKey))
        .collect();
    } else {
      rows = await ctx.db.query("company_industry_evidence_sources").collect();
    }
    return rows.sort(
      (left, right) =>
        right.updatedAt - left.updatedAt ||
        left.sourceId.localeCompare(right.sourceId),
    );
  },
});

export const listDueIndustryEvidenceSources = query({
  args: {
    writeSecret: v.optional(v.string()),
    now: v.number(),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    requireReadSecret(args.writeSecret);
    const limit = Math.max(1, Math.min(100, Math.floor(args.limit ?? 50)));
    const [scheduledProfiles, explicitlyDueProfiles] = await Promise.all([
      ctx.db
        .query("company_industry_profiles")
        .withIndex("by_next_review", (q) => q.lte("nextReviewAt", args.now))
        .take(limit),
      ctx.db
        .query("company_industry_profiles")
        .withIndex("by_freshness", (q) => q.eq("freshnessState", "refresh_due"))
        .take(limit),
    ]);
    const dueProfiles = Array.from(
      new Map(
        [...scheduledProfiles, ...explicitlyDueProfiles].map((profile) => [
          profile.companyKey,
          profile,
        ]),
      ).values(),
    )
      .filter(
        (profile) =>
          Boolean(profile.currentRevisionId) &&
          (profile.freshnessState === "refresh_due" ||
            (typeof profile.nextReviewAt === "number" &&
              profile.nextReviewAt <= args.now)),
      )
      .sort(
        (left, right) =>
          (left.nextReviewAt ?? 0) - (right.nextReviewAt ?? 0) ||
          left.companyKey.localeCompare(right.companyKey),
      )
      .slice(0, limit);

    const profileItems = await mapWithConcurrency(
      dueProfiles,
      8,
      async (profile) => {
      const revisionRows = await ctx.db
        .query("company_industry_verdict_revisions")
        .withIndex("by_revision_id", (q) =>
          q.eq("revisionId", profile.currentRevisionId!),
        )
        .collect();
      const revision = revisionRows[0];
      if (!revision || revision.companyKey !== profile.companyKey) {
        return [];
      }
      const sources = (
        await mapWithConcurrency(
          revision.approvedSourceIds,
          8,
          (sourceId) => findIndustryEvidenceSource(ctx, sourceId),
        )
      ).filter(
        (source): source is NonNullable<typeof source> =>
          Boolean(
            source &&
              source.companyKey === profile.companyKey &&
              source.reviewStatus === "approved" &&
              source.sourceType !== "search_result" &&
              source.trustTier !== "discovery" &&
              normalizeIndustryEvidenceUrl(source.url),
          ),
      );
      sources.sort((left, right) => left.sourceId.localeCompare(right.sourceId));
      return sources.map((source) => ({
          sourceId: source.sourceId,
          companyKey: profile.companyKey,
          verdictRevisionId: revision.revisionId,
          currentIndustryClass: revision.industryClass,
          currentVerificationLevel: revision.verificationLevel,
          approvedSourceCount: sources.length,
          url: source.url,
          sourceDomain: source.sourceDomain,
          sourceType: source.sourceType,
          trustTier: source.trustTier,
          title: source.title,
          evidenceExcerpt: source.evidenceExcerpt,
          contentFingerprint: source.contentFingerprint,
          lastSuccessfulFetchAt: source.lastSuccessfulFetchAt,
          nextReviewAt: profile.nextReviewAt,
        }));
      },
    );
    return profileItems.flat().slice(0, limit);
  },
});

export const markIndustryEvidenceProfilesChecking = mutation({
  args: {
    writeSecret: v.optional(v.string()),
    profiles: v.array(
      v.object({
        companyKey: v.string(),
        verdictRevisionId: v.string(),
      }),
    ),
  },
  handler: async (ctx, args) => {
    requireWriteSecret(args.writeSecret);
    let marked = 0;
    const seen = new Set<string>();
    for (const item of args.profiles.slice(0, 100)) {
      const companyKey = normalizeCompanyKey(item.companyKey);
      if (!companyKey || seen.has(companyKey)) continue;
      seen.add(companyKey);
      const rows = await ctx.db
        .query("company_industry_profiles")
        .withIndex("by_company_key", (q) => q.eq("companyKey", companyKey))
        .collect();
      const profile = rows[0];
      if (!profile || profile.currentRevisionId !== item.verdictRevisionId) {
        continue;
      }
      await ctx.db.patch(profile._id, {
        freshnessState: "checking",
        updatedAt: Date.now(),
        updatedBy: "system:industry-evidence-freshness",
      });
      marked += 1;
    }
    return { marked };
  },
});

export const recordIndustryEvidenceFreshnessCheck = mutation({
  args: {
    writeSecret: v.optional(v.string()),
    checkId: v.string(),
    sourceId: v.string(),
    companyKey: v.string(),
    verdictRevisionId: v.string(),
    proposalId: v.optional(v.string()),
    checkedAt: v.number(),
    outcome: industryEvidenceCheckOutcomeValidator,
    observedUrl: v.optional(v.string()),
    observedTitle: v.optional(v.string()),
    observedExcerpt: v.optional(v.string()),
    observedContentFingerprint: v.optional(v.string()),
    fetchStatus: v.union(
      v.literal("fetched"),
      v.literal("failed"),
      v.literal("unavailable"),
    ),
    httpStatus: v.optional(v.number()),
    errorCode: v.optional(v.string()),
    materialChangeSummary: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    requireWriteSecret(args.writeSecret);
    const checkId = args.checkId.trim();
    const sourceId = args.sourceId.trim();
    const companyKey = normalizeCompanyKey(args.companyKey);
    const verdictRevisionId = args.verdictRevisionId.trim();
    if (!checkId || !sourceId || !companyKey || !verdictRevisionId) {
      throw new Error("Freshness check requires check, source, company, and revision IDs");
    }
    const existingChecks = await ctx.db
      .query("company_industry_evidence_checks")
      .withIndex("by_check_id", (q) => q.eq("checkId", checkId))
      .collect();
    if (existingChecks[0]) {
      return { checkId, created: false };
    }
    const source = await findIndustryEvidenceSource(ctx, sourceId);
    if (
      !source ||
      source.companyKey !== companyKey ||
      source.reviewStatus !== "approved"
    ) {
      throw new Error("Freshness checks require an approved source for the company");
    }
    const profileRows = await ctx.db
      .query("company_industry_profiles")
      .withIndex("by_company_key", (q) => q.eq("companyKey", companyKey))
      .collect();
    const profile = profileRows[0];
    if (!profile || profile.currentRevisionId !== verdictRevisionId) {
      throw new Error("Freshness check revision is stale");
    }
    const revisionRows = await ctx.db
      .query("company_industry_verdict_revisions")
      .withIndex("by_revision_id", (q) => q.eq("revisionId", verdictRevisionId))
      .collect();
    const revision = revisionRows[0];
    if (
      !revision ||
      revision.companyKey !== companyKey ||
      !revision.approvedSourceIds.includes(sourceId)
    ) {
      throw new Error("Freshness source is not part of the current revision");
    }
    const observedUrl = args.observedUrl
      ? normalizeIndustryEvidenceUrl(args.observedUrl)
      : null;
    if (args.observedUrl && !observedUrl) {
      throw new Error("Freshness observation URL must be a safe public HTTP(S) URL");
    }
    if (
      args.outcome === "unchanged" &&
      args.observedContentFingerprint &&
      source.contentFingerprint &&
      args.observedContentFingerprint !== source.contentFingerprint
    ) {
      throw new Error("Changed source fingerprint cannot be recorded as unchanged");
    }
    const proposalId = args.proposalId?.trim();
    if (args.outcome !== "unchanged") {
      if (!proposalId) {
        throw new Error("Changed, unavailable, or conflicting evidence requires a proposal");
      }
      const proposal = await findIndustryProposal(ctx, proposalId);
      if (
        !proposal ||
        proposal.companyKey !== companyKey ||
        proposal.currentRevisionId !== verdictRevisionId ||
        !OPEN_INDUSTRY_PROPOSAL_STATUSES.has(proposal.status)
      ) {
        throw new Error("Freshness proposal does not match current approved truth");
      }
    }

    const nextReviewAt =
      args.outcome === "unchanged"
        ? nextIndustryEvidenceReviewAt(
            source.sourceType,
            source.trustTier,
            args.checkedAt,
          )
        : undefined;
    const now = Date.now();
    await ctx.db.insert("company_industry_evidence_checks", {
      checkId,
      sourceId,
      companyKey,
      verdictRevisionId,
      ...(proposalId ? { proposalId } : {}),
      checkedAt: args.checkedAt,
      outcome: args.outcome,
      ...(observedUrl
        ? {
            observedUrl: observedUrl.url,
            observedDomain: observedUrl.sourceDomain,
          }
        : {}),
      ...(args.observedTitle?.trim()
        ? { observedTitle: args.observedTitle.trim().slice(0, 300) }
        : {}),
      ...(args.observedExcerpt?.trim()
        ? { observedExcerpt: args.observedExcerpt.trim().slice(0, 800) }
        : {}),
      ...(args.observedContentFingerprint?.trim()
        ? {
            observedContentFingerprint:
              args.observedContentFingerprint.trim(),
          }
        : {}),
      fetchStatus: args.fetchStatus,
      ...(args.httpStatus !== undefined ? { httpStatus: args.httpStatus } : {}),
      ...(args.errorCode?.trim()
        ? { errorCode: args.errorCode.trim().slice(0, 100) }
        : {}),
      ...(args.materialChangeSummary?.trim()
        ? {
            materialChangeSummary:
              args.materialChangeSummary.trim().slice(0, 800),
          }
        : {}),
      ...(nextReviewAt !== undefined ? { nextReviewAt } : {}),
      createdAt: now,
    });

    if (args.outcome === "unchanged") {
      await ctx.db.patch(source._id, {
        fetchedAt: args.checkedAt,
        lastSuccessfulFetchAt: args.checkedAt,
        fetchStatus: "fetched",
        updatedAt: now,
      });
    }
    const freshnessState =
      args.outcome === "unchanged"
        ? ("fresh" as const)
        : args.outcome === "changed"
          ? ("changed" as const)
          : args.outcome === "conflict"
            ? ("conflict" as const)
            : ("unavailable" as const);
    await ctx.db.patch(profile._id, {
      freshnessState,
      ...(nextReviewAt !== undefined ? { nextReviewAt } : {}),
      updatedAt: now,
      updatedBy: "system:industry-evidence-freshness",
    });
    return {
      checkId,
      created: true,
      companyKey,
      verdictRevisionId,
      freshnessState,
    };
  },
});

export const listIndustryEvidenceChecks = query({
  args: {
    writeSecret: v.optional(v.string()),
    companyKey: v.optional(v.string()),
    sourceId: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    requireReadSecret(args.writeSecret);
    const rows = args.sourceId
      ? await ctx.db
          .query("company_industry_evidence_checks")
          .withIndex("by_source_checked", (q) =>
            q.eq("sourceId", args.sourceId!.trim()),
          )
          .collect()
      : args.companyKey
        ? await ctx.db
            .query("company_industry_evidence_checks")
            .withIndex("by_company_checked", (q) =>
              q.eq("companyKey", normalizeCompanyKey(args.companyKey!)),
            )
            .collect()
        : await ctx.db.query("company_industry_evidence_checks").collect();
    return rows.sort(
      (left, right) =>
        right.checkedAt - left.checkedAt ||
        left.checkId.localeCompare(right.checkId),
    );
  },
});
