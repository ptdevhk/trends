import { v } from "convex/values";
import { mutation, query } from "./_generated/server";
import {
  CANONICAL_SEED_COMPANIES,
  INDUSTRY_RESEARCH_ORIGIN_PRIORITIES,
  MAX_RECRUITER_INDUSTRY_EVIDENCE_SOURCES,
  compareSourcePreviews,
  hasAutoApprovableEvidence,
  hasExplicitCncEvidence,
  normalizeIndustryEvidenceUrl,
  normalizeCompanyAlias,
  parseSourcePreview,
  policyEffectsFromPreset,
  type CompanyPolicyEffects,
} from "@trends/shared";

import { DEFAULT_WORKSPACE_SLUG } from "./sessions";

function normalizeWorkspaceSlug(input: string | undefined): string {
  const normalized = input?.trim();
  return normalized && normalized.length > 0 ? normalized : DEFAULT_WORKSPACE_SLUG;
}

function requireWriteSecret(writeSecret: string | undefined): void {
  const expected = process.env.CONVEX_WRITE_SECRET;
  if (!expected || writeSecret !== expected) {
    throw new Error("Unauthorized Convex write");
  }
}

function requireReadSecret(writeSecret: string | undefined): void {
  const expected = process.env.CONVEX_WRITE_SECRET;
  if (!expected || writeSecret !== expected) {
    throw new Error("Unauthorized Convex read");
  }
}

function normalizeCompanyKey(value: string): string {
  return value.trim().toLowerCase().replace(/\s+/g, "-");
}

const statusValidator = v.union(
  v.literal("provisional"),
  v.literal("confirmed"),
  v.literal("merged"),
);

const scopeTypeValidator = v.union(
  v.literal("workspace"),
  v.literal("market"),
  v.literal("global"),
);

const visibilityValidator = v.union(v.literal("default"), v.literal("hide"));
const workflowValidator = v.union(v.literal("default"), v.literal("blocked"));
const rankingEffectValidator = v.union(
  v.literal("none"),
  v.literal("band_known_good"),
  v.literal("band_known_bad"),
  v.literal("boost"),
  v.literal("demote"),
);

const effectsArgs = {
  visibility: v.optional(visibilityValidator),
  workflow: v.optional(workflowValidator),
  rankingEffect: v.optional(rankingEffectValidator),
  reasonCodes: v.optional(v.array(v.string())),
  summary: v.optional(v.string()),
};

async function listAliasesForCompany(
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

async function latestPolicyRevision(
  ctx: { db: any },
  args: { scopeType: string; scopeId: string; companyKey: string },
) {
  const rows = await ctx.db
    .query("company_policy_revisions")
    .withIndex("by_scope_company", (q: any) =>
      q
        .eq("scopeType", args.scopeType)
        .eq("scopeId", args.scopeId)
        .eq("companyKey", args.companyKey),
    )
    .collect();
  if (rows.length === 0) {
    return null;
  }
  rows.sort((left: any, right: any) => right.revision - left.revision || right.createdAt - left.createdAt);
  return rows[0];
}

function effectsFromRevision(row: any | null): CompanyPolicyEffects | null {
  if (!row) {
    return null;
  }
  return {
    ...(row.visibility ? { visibility: row.visibility } : {}),
    ...(row.workflow ? { workflow: row.workflow } : {}),
    ...(row.rankingEffect ? { rankingEffect: row.rankingEffect } : {}),
    ...(Array.isArray(row.reasonCodes) ? { reasonCodes: row.reasonCodes } : {}),
    ...(typeof row.summary === "string" ? { summary: row.summary } : {}),
  };
}

export const list = query({
  args: {
    writeSecret: v.optional(v.string()),
    status: v.optional(statusValidator),
  },
  handler: async (ctx, args) => {
    requireReadSecret(args.writeSecret);
    const rows = args.status
      ? await ctx.db
          .query("companies")
          .withIndex("by_status", (q) => q.eq("status", args.status!))
          .collect()
      : await ctx.db.query("companies").collect();

    rows.sort((left, right) => left.displayName.localeCompare(right.displayName));

    const items = [];
    for (const row of rows) {
      const aliases = await listAliasesForCompany(ctx, row.companyKey);
      items.push({
        _id: row._id,
        companyKey: row.companyKey,
        status: row.status,
        displayName: row.displayName,
        nameCn: row.nameCn,
        nameEn: row.nameEn,
        mergedIntoCompanyKey: row.mergedIntoCompanyKey,
        createdAt: row.createdAt,
        updatedAt: row.updatedAt,
        createdBy: row.createdBy,
        aliases,
      });
    }
    return items;
  },
});

export const getByKey = query({
  args: {
    companyKey: v.string(),
    writeSecret: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    requireReadSecret(args.writeSecret);
    const companyKey = normalizeCompanyKey(args.companyKey);
    if (!companyKey) {
      return null;
    }
    const rows = await ctx.db
      .query("companies")
      .withIndex("by_company_key", (q) => q.eq("companyKey", companyKey))
      .collect();
    const row = rows[0];
    if (!row) {
      return null;
    }
    const aliases = await listAliasesForCompany(ctx, row.companyKey);
    return {
      _id: row._id,
      companyKey: row.companyKey,
      status: row.status,
      displayName: row.displayName,
      nameCn: row.nameCn,
      nameEn: row.nameEn,
      mergedIntoCompanyKey: row.mergedIntoCompanyKey,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
      createdBy: row.createdBy,
      aliases,
    };
  },
});

export const resolveAlias = query({
  args: {
    alias: v.string(),
    writeSecret: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    requireReadSecret(args.writeSecret);
    const aliasNormalized = normalizeCompanyAlias(args.alias);
    if (!aliasNormalized) {
      return null;
    }
    const aliasRows = await ctx.db
      .query("company_aliases")
      .withIndex("by_alias", (q) => q.eq("aliasNormalized", aliasNormalized))
      .collect();
    const aliasRow = aliasRows[0];
    if (!aliasRow) {
      return null;
    }
    const companies = await ctx.db
      .query("companies")
      .withIndex("by_company_key", (q) => q.eq("companyKey", aliasRow.companyKey))
      .collect();
    const company = companies[0];
    if (!company) {
      return null;
    }
    return {
      companyKey: company.companyKey,
      displayName: company.displayName,
      status: company.status,
      matchedAlias: aliasRow.aliasDisplay,
    };
  },
});

export const resolveAliasesBatch = query({
  args: {
    aliases: v.array(v.string()),
    writeSecret: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    requireReadSecret(args.writeSecret);
    if (args.aliases.length > 200) {
      throw new Error("Company alias lookup is limited to 200 surfaces");
    }
    const seen = new Set<string>();
    const results = [];
    for (const alias of args.aliases) {
      const aliasNormalized = normalizeCompanyAlias(alias);
      if (!aliasNormalized || seen.has(aliasNormalized)) continue;
      seen.add(aliasNormalized);
      const aliasRows = await ctx.db
        .query("company_aliases")
        .withIndex("by_alias", (index) =>
          index.eq("aliasNormalized", aliasNormalized),
        )
        .collect();
      const aliasRow = aliasRows[0];
      if (!aliasRow) {
        results.push({
          employerSurface: alias,
          normalizedEmployerSurface: aliasNormalized,
          status: "missing" as const,
        });
        continue;
      }
      results.push({
        employerSurface: alias,
        normalizedEmployerSurface: aliasNormalized,
        status: "resolved" as const,
        companyKey: aliasRow.companyKey,
        matchedAlias: aliasRow.aliasDisplay,
      });
    }
    return results;
  },
});

export const upsert = mutation({
  args: {
    companyKey: v.string(),
    displayName: v.string(),
    nameCn: v.optional(v.string()),
    nameEn: v.optional(v.string()),
    status: v.optional(statusValidator),
    createdBy: v.optional(v.string()),
    writeSecret: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    requireWriteSecret(args.writeSecret);
    const companyKey = normalizeCompanyKey(args.companyKey);
    const displayName = args.displayName.trim();
    if (!companyKey || !displayName) {
      throw new Error("companyKey and displayName are required");
    }
    const now = Date.now();
    const existing = await ctx.db
      .query("companies")
      .withIndex("by_company_key", (q) => q.eq("companyKey", companyKey))
      .collect();
    const current = existing[0];
    if (current) {
      await ctx.db.patch(current._id, {
        displayName,
        nameCn: args.nameCn?.trim() || undefined,
        nameEn: args.nameEn?.trim() || undefined,
        status: args.status ?? current.status,
        updatedAt: now,
      });
      return { companyKey, id: current._id, created: false };
    }
    const id = await ctx.db.insert("companies", {
      companyKey,
      displayName,
      nameCn: args.nameCn?.trim() || undefined,
      nameEn: args.nameEn?.trim() || undefined,
      status: args.status ?? "confirmed",
      createdAt: now,
      updatedAt: now,
      createdBy: args.createdBy,
    });
    return { companyKey, id, created: true };
  },
});

export const addAlias = mutation({
  args: {
    companyKey: v.string(),
    alias: v.string(),
    source: v.optional(v.union(v.literal("seed"), v.literal("operator"), v.literal("observed"))),
    writeSecret: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    requireWriteSecret(args.writeSecret);
    const companyKey = normalizeCompanyKey(args.companyKey);
    const aliasDisplay = args.alias.trim();
    const aliasNormalized = normalizeCompanyAlias(aliasDisplay);
    if (!companyKey || !aliasNormalized) {
      throw new Error("companyKey and alias are required");
    }

    const companies = await ctx.db
      .query("companies")
      .withIndex("by_company_key", (q) => q.eq("companyKey", companyKey))
      .collect();
    if (!companies[0]) {
      throw new Error(`Unknown companyKey: ${companyKey}`);
    }

    const existing = await ctx.db
      .query("company_aliases")
      .withIndex("by_alias", (q) => q.eq("aliasNormalized", aliasNormalized))
      .collect();
    if (existing[0]) {
      if (existing[0].companyKey !== companyKey) {
        throw new Error(
          `Alias already mapped to ${existing[0].companyKey}; cannot reassign to ${companyKey}`,
        );
      }
      return { id: existing[0]._id, created: false };
    }

    const id = await ctx.db.insert("company_aliases", {
      companyKey,
      aliasNormalized,
      aliasDisplay,
      source: args.source ?? "operator",
      createdAt: Date.now(),
    });
    return { id, created: true };
  },
});

export const removeAlias = mutation({
  args: {
    companyKey: v.string(),
    alias: v.string(),
    writeSecret: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    requireWriteSecret(args.writeSecret);
    const companyKey = normalizeCompanyKey(args.companyKey);
    const aliasNormalized = normalizeCompanyAlias(args.alias);
    if (!companyKey || !aliasNormalized) {
      return { removed: false };
    }
    const existing = await ctx.db
      .query("company_aliases")
      .withIndex("by_alias", (q) => q.eq("aliasNormalized", aliasNormalized))
      .collect();
    const row = existing.find((item) => item.companyKey === companyKey);
    if (!row) {
      return { removed: false };
    }
    await ctx.db.delete(row._id);
    return { removed: true };
  },
});

export const listPoliciesForScope = query({
  args: {
    scopeType: scopeTypeValidator,
    scopeId: v.string(),
    writeSecret: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    requireReadSecret(args.writeSecret);
    const scopeId =
      args.scopeType === "workspace"
        ? normalizeWorkspaceSlug(args.scopeId)
        : args.scopeId.trim();
    if (!scopeId) {
      return [];
    }

    const revisions = await ctx.db
      .query("company_policy_revisions")
      .withIndex("by_scope", (q) =>
        q.eq("scopeType", args.scopeType).eq("scopeId", scopeId),
      )
      .collect();

    const latestByCompany = new Map<string, (typeof revisions)[number]>();
    for (const row of revisions) {
      const current = latestByCompany.get(row.companyKey);
      if (!current || row.revision > current.revision) {
        latestByCompany.set(row.companyKey, row);
      }
    }

    const items = [];
    for (const [companyKey, revision] of latestByCompany.entries()) {
      const companies = await ctx.db
        .query("companies")
        .withIndex("by_company_key", (q) => q.eq("companyKey", companyKey))
        .collect();
      const company = companies[0];
      items.push({
        companyKey,
        displayName: company?.displayName ?? companyKey,
        nameCn: company?.nameCn,
        nameEn: company?.nameEn,
        status: company?.status ?? "confirmed",
        scopeType: revision.scopeType,
        scopeId: revision.scopeId,
        revision: revision.revision,
        effects: effectsFromRevision(revision),
        createdAt: revision.createdAt,
        createdBy: revision.createdBy,
      });
    }

    items.sort((left, right) => left.displayName.localeCompare(right.displayName));
    return items;
  },
});

export const getEffectivePolicy = query({
  args: {
    companyKey: v.string(),
    workspaceSlug: v.optional(v.string()),
    market: v.optional(v.union(v.literal("CN"), v.literal("MY"))),
    writeSecret: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    requireReadSecret(args.writeSecret);
    const companyKey = normalizeCompanyKey(args.companyKey);
    if (!companyKey) {
      return null;
    }

    const workspaceSlug = normalizeWorkspaceSlug(args.workspaceSlug);
    const layers = [
      {
        scopeType: "workspace" as const,
        scopeId: workspaceSlug,
        revision: await latestPolicyRevision(ctx, {
          scopeType: "workspace",
          scopeId: workspaceSlug,
          companyKey,
        }),
      },
      ...(args.market
        ? [
            {
              scopeType: "market" as const,
              scopeId: args.market,
              revision: await latestPolicyRevision(ctx, {
                scopeType: "market",
                scopeId: args.market,
                companyKey,
              }),
            },
          ]
        : []),
      {
        scopeType: "global" as const,
        scopeId: "global",
        revision: await latestPolicyRevision(ctx, {
          scopeType: "global",
          scopeId: "global",
          companyKey,
        }),
      },
    ];

    const rank = { workspace: 3, market: 2, global: 1 } as const;
    const present = layers
      .filter((layer) => layer.revision != null)
      .sort((left, right) => rank[right.scopeType] - rank[left.scopeType]);
    const winner = present[0];
    if (!winner?.revision) {
      return {
        companyKey,
        effects: null,
        resolvedFrom: null,
      };
    }
    return {
      companyKey,
      effects: effectsFromRevision(winner.revision),
      resolvedFrom: {
        scopeType: winner.scopeType,
        scopeId: winner.scopeId,
        revision: winner.revision.revision,
      },
    };
  },
});

export const appendPolicyRevision = mutation({
  args: {
    companyKey: v.string(),
    scopeType: scopeTypeValidator,
    scopeId: v.string(),
    createdBy: v.optional(v.string()),
    writeSecret: v.optional(v.string()),
    ...effectsArgs,
  },
  handler: async (ctx, args) => {
    requireWriteSecret(args.writeSecret);
    const companyKey = normalizeCompanyKey(args.companyKey);
    const scopeId =
      args.scopeType === "workspace"
        ? normalizeWorkspaceSlug(args.scopeId)
        : args.scopeId.trim();
    if (!companyKey || !scopeId) {
      throw new Error("companyKey and scopeId are required");
    }

    const companies = await ctx.db
      .query("companies")
      .withIndex("by_company_key", (q) => q.eq("companyKey", companyKey))
      .collect();
    if (!companies[0]) {
      throw new Error(`Unknown companyKey: ${companyKey}`);
    }

    const existing = await latestPolicyRevision(ctx, {
      scopeType: args.scopeType,
      scopeId,
      companyKey,
    });
    const nextRevision = (existing?.revision ?? 0) + 1;
    const id = await ctx.db.insert("company_policy_revisions", {
      companyKey,
      scopeType: args.scopeType,
      scopeId,
      revision: nextRevision,
      visibility: args.visibility,
      workflow: args.workflow,
      rankingEffect: args.rankingEffect,
      reasonCodes: args.reasonCodes,
      summary: args.summary?.trim() || undefined,
      createdAt: Date.now(),
      createdBy: args.createdBy,
    });
    return { id, revision: nextRevision };
  },
});

export const seedCanonicalCompanies = mutation({
  args: {
    workspaceSlug: v.optional(v.string()),
    /**
     * When true, (re)apply workspace **no-hire** for both Pro-Technic and Polywell.
     * Seed button always means "reset these two to no-hire" — if the latest
     * policy is already no-hire, skip; otherwise append a new revision
     * (including after HR set them to "none" / known-good).
     */
    seedNoHireForWorkspace: v.optional(v.boolean()),
    createdBy: v.optional(v.string()),
    writeSecret: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    requireWriteSecret(args.writeSecret);
    const now = Date.now();
    let companiesCreated = 0;
    let companiesUpdated = 0;
    let aliasesCreated = 0;

    for (const seed of CANONICAL_SEED_COMPANIES) {
      const companyKey = seed.companyKey;
      const existing = await ctx.db
        .query("companies")
        .withIndex("by_company_key", (q) => q.eq("companyKey", companyKey))
        .collect();
      if (existing[0]) {
        await ctx.db.patch(existing[0]._id, {
          displayName: seed.displayName,
          nameCn: seed.nameCn,
          nameEn: seed.nameEn,
          status: "confirmed",
          updatedAt: now,
        });
        companiesUpdated += 1;
      } else {
        await ctx.db.insert("companies", {
          companyKey,
          displayName: seed.displayName,
          nameCn: seed.nameCn,
          nameEn: seed.nameEn,
          status: "confirmed",
          createdAt: now,
          updatedAt: now,
          createdBy: args.createdBy ?? "seed",
        });
        companiesCreated += 1;
      }

      for (const alias of seed.aliases) {
        const aliasDisplay = alias.trim();
        const aliasNormalized = normalizeCompanyAlias(aliasDisplay);
        if (!aliasNormalized) {
          continue;
        }
        const aliasRows = await ctx.db
          .query("company_aliases")
          .withIndex("by_alias", (q) => q.eq("aliasNormalized", aliasNormalized))
          .collect();
        if (aliasRows[0]) {
          if (aliasRows[0].companyKey !== companyKey) {
            // Do not reassign — preserve separate-company integrity.
            continue;
          }
          continue;
        }
        await ctx.db.insert("company_aliases", {
          companyKey,
          aliasNormalized,
          aliasDisplay,
          source: "seed",
          createdAt: now,
        });
        aliasesCreated += 1;
      }
    }

    let policiesSeeded = 0;
    let lastPolicyRevision: number | null = null;
    if (args.seedNoHireForWorkspace) {
      const workspaceSlug = normalizeWorkspaceSlug(args.workspaceSlug);
      const effects = policyEffectsFromPreset("no_hire");
      for (const seed of CANONICAL_SEED_COMPANIES) {
        const companyKey = seed.companyKey;
        const existing = await latestPolicyRevision(ctx, {
          scopeType: "workspace",
          scopeId: workspaceSlug,
          companyKey,
        });
        // Already at no-hire — leave as-is (idempotent re-seed).
        const alreadyNoHire =
          existing != null &&
          existing.visibility === "hide" &&
          existing.workflow === "blocked" &&
          existing.rankingEffect === "band_known_bad";
        if (alreadyNoHire) {
          continue;
        }
        // Re-apply no-hire after "none" / known_good / missing policy.
        const nextRevision = (existing?.revision ?? 0) + 1;
        await ctx.db.insert("company_policy_revisions", {
          companyKey,
          scopeType: "workspace",
          scopeId: workspaceSlug,
          revision: nextRevision,
          visibility: effects.visibility,
          workflow: effects.workflow,
          rankingEffect: effects.rankingEffect,
          reasonCodes: [...(effects.reasonCodes ?? []), "seed"],
          summary: `Seeded no-hire employer (${seed.displayName})`,
          createdAt: now,
          createdBy: args.createdBy ?? "seed",
        });
        policiesSeeded += 1;
        lastPolicyRevision = nextRevision;
      }
    }

    return {
      companiesCreated,
      companiesUpdated,
      aliasesCreated,
      policiesSeeded,
      policyRevision: lastPolicyRevision,
    };
  },
});

// ---------------------------------------------------------------------------
// Company industry profiles (reviewed catalog overlay)
// ---------------------------------------------------------------------------

const industryClassValidator = v.union(
  v.literal("cnc"),
  v.literal("automation"),
  v.literal("metrology"),
  v.literal("industrial"),
  v.literal("non_industry"),
  v.literal("unknown"),
);

const verificationLevelValidator = v.union(
  v.literal("verified"),
  v.literal("candidate"),
  v.literal("rejected"),
);

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

// ---------------------------------------------------------------------------
// Governed industry evidence proposals, sources, and immutable revisions
// ---------------------------------------------------------------------------

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

const industryProposalStatusValidator = v.union(
  v.literal("new"),
  v.literal("researching"),
  v.literal("ready_for_review"),
  v.literal("needs_more_evidence"),
  v.literal("approved"),
  v.literal("rejected"),
  v.literal("superseded"),
);

const industryProposalSampleReferenceValidator = v.object({
  workspaceSlug: v.string(),
  resumeIdentity: v.string(),
  workEntryFingerprint: v.optional(v.string()),
});

const industryRefreshReasonValidator = v.union(
  v.literal("stale"),
  v.literal("incomplete"),
  v.literal("incorrect"),
  v.literal("other"),
);

const approvedVerificationLevelValidator = v.union(
  v.literal("verified"),
  v.literal("rejected"),
);

const industryReviewRiskFlagValidator = v.union(
  v.literal("canonical_mapping_missing"),
  v.literal("only_discovery_sources"),
  v.literal("source_conflict"),
  v.literal("weak_industry_signal"),
  v.literal("cnc_claim_inferred"),
  v.literal("stale_or_failed_source"),
  v.literal("low_source_diversity"),
  v.literal("worker_unreachable"),
  v.literal("recompute_pending"),
);

const industryReviewAttestationValidator = v.object({
  schemaVersion: v.literal("industry-review-attestation.v1"),
  inputFingerprint: v.string(),
  decisionMode: v.union(v.literal("standard"), v.literal("risk_override")),
  acknowledgedRiskFlags: v.array(industryReviewRiskFlagValidator),
  cncEvidenceAcknowledged: v.boolean(),
  acknowledgementReason: v.string(),
});

const INDUSTRY_REVIEW_STALE_PREFIX = "INDUSTRY_REVIEW_STALE:";

const OPEN_INDUSTRY_PROPOSAL_STATUSES = new Set([
  "new",
  "researching",
  "ready_for_review",
  "needs_more_evidence",
]);

const INDUSTRY_EVIDENCE_DAY_MS = 24 * 60 * 60 * 1_000;

const industryResearchOriginValidator = v.union(
  v.literal("resume_detail"),
  v.literal("resume_search_batch"),
  v.literal("admin_review"),
  v.literal("refresh"),
  v.literal("scheduled_sweep"),
);

const industryResearchStateValidator = v.union(
  v.literal("queued"),
  v.literal("leased"),
  v.literal("completed"),
  v.literal("needs_identity_review"),
  v.literal("needs_more_evidence"),
  v.literal("retry_wait"),
  v.literal("failed"),
  v.literal("cancelled"),
);

const industryResearchFailureCodeValidator = v.union(
  v.literal("worker_unreachable"),
  v.literal("timeout"),
  v.literal("provider_limited"),
  v.literal("fetch_failed"),
  v.literal("identity_ambiguous"),
  v.literal("proposal_terminal"),
);

const industryMaintenanceRunModeValidator = v.union(
  v.literal("targeted"),
  v.literal("sweep"),
  v.literal("freshness"),
);

const identityMappingModeValidator = v.union(
  v.literal("existing"),
  v.literal("create_provisional"),
);

const ACTIVE_RESEARCH_REQUEST_STATES = new Set([
  "queued",
  "leased",
  "retry_wait",
]);

const REQUESTABLE_RESEARCH_PROPOSAL_STATUSES = new Set([
  "new",
  "researching",
  "ready_for_review",
  "needs_more_evidence",
]);

const MAX_RESEARCH_REQUEST_BATCH = 50;
const DEFAULT_RESEARCH_LEASE_MS = 5 * 60 * 1_000;
const MAX_RESEARCH_ATTEMPTS = 5;
const MAX_ACTIVE_RESEARCH_REQUESTS_PER_WORKSPACE = 100;
const MAX_ACTIVE_RESEARCH_REQUESTS_GLOBAL = 1_000;
const MAX_SCHEDULED_RESEARCH_PRODUCE = 20;
const SCHEDULED_RESEARCH_AGING_HOUR_MS = 60 * 60 * 1_000;

function researchPriorityForOrigin(origin: string): number {
  const priority = (INDUSTRY_RESEARCH_ORIGIN_PRIORITIES as Record<string, number>)[origin];
  return typeof priority === "number" ? priority : 10;
}

function safeResearchRequestSummary(row: any) {
  const retryableStates = new Set(["failed", "retry_wait", "needs_more_evidence"]);
  return {
    requestId: row.requestId,
    proposalId: row.proposalId,
    origin: row.origin,
    state: row.state,
    priority: row.priority,
    requestedAt: row.requestedAt,
    demandCount: row.demandCount,
    attemptCount: row.attemptCount,
    ...(row.nextAttemptAt !== undefined ? { nextAttemptAt: row.nextAttemptAt } : {}),
    ...(row.leaseExpiresAt !== undefined ? { leaseExpiresAt: row.leaseExpiresAt } : {}),
    ...(row.lastRunId ? { lastRunId: row.lastRunId } : {}),
    ...(row.lastOutcome ? { lastOutcome: row.lastOutcome } : {}),
    ...(row.lastErrorCode ? { lastErrorCode: row.lastErrorCode } : {}),
    updatedAt: row.updatedAt,
    canRetry:
      retryableStates.has(row.state) &&
      row.attemptCount < MAX_RESEARCH_ATTEMPTS,
    canCancel: ACTIVE_RESEARCH_REQUEST_STATES.has(row.state),
  };
}

async function findIndustryResearchRequest(ctx: { db: any }, requestId: string) {
  const rows = await ctx.db
    .query("industry_evidence_research_requests")
    .withIndex("by_request_id", (q: any) => q.eq("requestId", requestId))
    .collect();
  return rows[0] ?? null;
}

async function listIndustryResearchRequestsForWorkspaceProposal(
  ctx: { db: any },
  workspaceSlug: string,
  proposalId: string,
) {
  return ctx.db
    .query("industry_evidence_research_requests")
    .withIndex("by_workspace_proposal", (q: any) =>
      q.eq("workspaceSlug", workspaceSlug).eq("proposalId", proposalId),
    )
    .collect();
}

function nextIndustryEvidenceReviewAt(
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

function uniqueSortedStrings(values: string[]): string[] {
  return Array.from(
    new Set(values.map((value) => value.trim()).filter(Boolean)),
  ).sort((left, right) => left.localeCompare(right));
}

async function mapWithConcurrency<T, R>(
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

function mergeSampleReferences(
  current: Array<{
    workspaceSlug: string;
    resumeIdentity: string;
    workEntryFingerprint?: string;
  }> | undefined,
  incoming: Array<{
    workspaceSlug: string;
    resumeIdentity: string;
    workEntryFingerprint?: string;
  }> | undefined,
) {
  const byKey = new Map<
    string,
    {
      workspaceSlug: string;
      resumeIdentity: string;
      workEntryFingerprint?: string;
    }
  >();
  for (const reference of [...(current ?? []), ...(incoming ?? [])]) {
    const workspaceSlug = reference.workspaceSlug.trim();
    const resumeIdentity = reference.resumeIdentity.trim();
    const workEntryFingerprint = reference.workEntryFingerprint?.trim();
    if (!workspaceSlug || !resumeIdentity) {
      continue;
    }
    const key = `${workspaceSlug}\u0000${resumeIdentity}\u0000${workEntryFingerprint ?? ""}`;
    byKey.set(key, {
      workspaceSlug,
      resumeIdentity,
      ...(workEntryFingerprint ? { workEntryFingerprint } : {}),
    });
  }
  return Array.from(byKey.entries())
    .sort(([left], [right]) => left.localeCompare(right))
    .slice(0, 10)
    .map(([, reference]) => reference);
}

async function findIndustryProposal(ctx: { db: any }, proposalId: string) {
  const rows = await ctx.db
    .query("company_industry_review_proposals")
    .withIndex("by_proposal_id", (q: any) => q.eq("proposalId", proposalId))
    .collect();
  return rows[0] ?? null;
}

function assertExpectedIndustryProposalUpdatedAt(
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

async function findIndustryEvidenceSource(ctx: { db: any }, sourceId: string) {
  const rows = await ctx.db
    .query("company_industry_evidence_sources")
    .withIndex("by_source_id", (q: any) => q.eq("sourceId", sourceId))
    .collect();
  return rows[0] ?? null;
}

async function findIndustryVerdictRevision(
  ctx: { db: any },
  revisionId: string,
) {
  const rows = await ctx.db
    .query("company_industry_verdict_revisions")
    .withIndex("by_revision_id", (q: any) => q.eq("revisionId", revisionId))
    .collect();
  return rows[0] ?? null;
}

export const upsertIndustryProposal = mutation({
  args: {
    writeSecret: v.optional(v.string()),
    proposalId: v.string(),
    companyKey: v.optional(v.string()),
    normalizedEmployerSurface: v.optional(v.string()),
    triggerReasons: v.array(v.string()),
    priority: v.number(),
    sampleReferences: v.optional(v.array(industryProposalSampleReferenceValidator)),
    currentRevisionId: v.optional(v.string()),
    suggestedIndustryClass: v.optional(industryClassValidator),
    suggestedVerificationLevel: v.optional(verificationLevelValidator),
    materialChangeSummary: v.optional(v.string()),
    requestedBy: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    requireWriteSecret(args.writeSecret);
    const proposalId = args.proposalId.trim();
    const companyKey = args.companyKey
      ? normalizeCompanyKey(args.companyKey)
      : undefined;
    const normalizedEmployerSurface = args.normalizedEmployerSurface
      ? normalizeCompanyAlias(args.normalizedEmployerSurface)
      : undefined;
    if (!proposalId || (!companyKey && !normalizedEmployerSurface)) {
      throw new Error(
        "proposalId and either companyKey or normalizedEmployerSurface are required",
      );
    }

    if (companyKey) {
      const companies = await ctx.db
        .query("companies")
        .withIndex("by_company_key", (q) => q.eq("companyKey", companyKey))
        .collect();
      if (!companies[0]) {
        throw new Error(`Unknown companyKey: ${companyKey}`);
      }
    }

    const candidates = companyKey
      ? await ctx.db
          .query("company_industry_review_proposals")
          .withIndex("by_company_status", (q) => q.eq("companyKey", companyKey))
          .collect()
      : await ctx.db
          .query("company_industry_review_proposals")
          .withIndex("by_surface_status", (q) =>
            q.eq("normalizedEmployerSurface", normalizedEmployerSurface),
          )
          .collect();
    // When the caller resolved a canonical company AND supplied the employer
    // surface, also look up by surface so an existing unmapped proposal
    // (created before the company was resolved) is found and gets the
    // companyKey attached instead of spawning a duplicate.
    const surfaceCandidates =
      companyKey && normalizedEmployerSurface
        ? await ctx.db
            .query("company_industry_review_proposals")
            .withIndex("by_surface_status", (q) =>
              q.eq("normalizedEmployerSurface", normalizedEmployerSurface),
            )
            .collect()
        : [];
    const existing =
      candidates.find((candidate) =>
        OPEN_INDUSTRY_PROPOSAL_STATUSES.has(candidate.status),
      ) ??
      surfaceCandidates.find((candidate) =>
        OPEN_INDUSTRY_PROPOSAL_STATUSES.has(candidate.status),
      );
    const now = Date.now();
    const triggerReasons = uniqueSortedStrings([
      ...(existing?.triggerReasons ?? []),
      ...args.triggerReasons,
    ]);
    const sampleReferences = mergeSampleReferences(
      existing?.sampleReferences,
      args.sampleReferences,
    );

    if (existing) {
      await ctx.db.patch(existing._id, {
        triggerReasons,
        priority: Math.max(existing.priority, args.priority),
        ...(sampleReferences.length > 0 ? { sampleReferences } : {}),
        // Attach the canonical company when the caller resolved one — an
        // unmapped surface proposal becomes auto-approvable (Lane A) only
        // once it has a companyKey.
        ...(companyKey && !existing.companyKey ? { companyKey } : {}),
        ...(args.currentRevisionId !== undefined
          ? { currentRevisionId: args.currentRevisionId }
          : {}),
        ...(args.suggestedIndustryClass !== undefined
          ? { suggestedIndustryClass: args.suggestedIndustryClass }
          : {}),
        ...(args.suggestedVerificationLevel !== undefined
          ? { suggestedVerificationLevel: args.suggestedVerificationLevel }
          : {}),
        ...(args.materialChangeSummary !== undefined
          ? { materialChangeSummary: args.materialChangeSummary.trim() }
          : {}),
        ...(args.requestedBy !== undefined
          ? { requestedBy: args.requestedBy.trim() }
          : {}),
        updatedAt: now,
      });
      return {
        proposalId: existing.proposalId,
        created: false,
        _id: existing._id,
      };
    }

    const duplicateId = await findIndustryProposal(ctx, proposalId);
    if (duplicateId) {
      throw new Error(`proposalId already exists: ${proposalId}`);
    }

    const id = await ctx.db.insert("company_industry_review_proposals", {
      proposalId,
      ...(companyKey ? { companyKey } : {}),
      ...(normalizedEmployerSurface ? { normalizedEmployerSurface } : {}),
      triggerReasons,
      priority: args.priority,
      ...(sampleReferences.length > 0 ? { sampleReferences } : {}),
      ...(args.currentRevisionId !== undefined
        ? { currentRevisionId: args.currentRevisionId.trim() }
        : {}),
      ...(args.suggestedIndustryClass !== undefined
        ? { suggestedIndustryClass: args.suggestedIndustryClass }
        : {}),
      ...(args.suggestedVerificationLevel !== undefined
        ? { suggestedVerificationLevel: args.suggestedVerificationLevel }
        : {}),
      ...(args.materialChangeSummary !== undefined
        ? { materialChangeSummary: args.materialChangeSummary.trim() }
        : {}),
      ...(args.requestedBy !== undefined
        ? { requestedBy: args.requestedBy.trim() }
        : {}),
      status: "new",
      createdAt: now,
      updatedAt: now,
    });
    return { proposalId, created: true, _id: id };
  },
});

export const listIndustryProposals = query({
  args: {
    writeSecret: v.optional(v.string()),
    status: v.optional(industryProposalStatusValidator),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    requireReadSecret(args.writeSecret);
    const maxLimit = args.limit ?? 500;
    const rows = args.status
      ? await ctx.db
          .query("company_industry_review_proposals")
          .withIndex("by_status_priority", (q) => q.eq("status", args.status!))
          .take(maxLimit)
      : await ctx.db.query("company_industry_review_proposals").take(maxLimit);
    return rows.sort(
      (left, right) =>
        right.priority - left.priority ||
        right.updatedAt - left.updatedAt ||
        left.proposalId.localeCompare(right.proposalId),
    );
  },
});

/**
 * Resolve only exact legacy work-entry → industry-proposal relationships for
 * the current resume. This is intentionally secret-gated because proposal
 * sample references can otherwise reveal cross-workspace resume identities.
 */
export const resolveIndustryReviewTargetsForResume = query({
  args: {
    writeSecret: v.optional(v.string()),
    workspaceSlug: v.string(),
    resumeId: v.id("resumes"),
  },
  handler: async (ctx, args) => {
    requireReadSecret(args.writeSecret);
    const resume = await ctx.db.get(args.resumeId);
    if (!resume) {
      return null;
    }

    const workspaceSlug = normalizeWorkspaceSlug(args.workspaceSlug);
    if (normalizeWorkspaceSlug(resume.workspaceSlug) !== workspaceSlug) {
      return { targets: [] };
    }

    const resumeIdentities = new Set(
      [String(resume._id), resume.identityKey, resume.externalId]
        .map((value) => value?.trim())
        .filter((value): value is string => Boolean(value)),
    );
    const legacyEntries = new Map<string, { workEntryKey: string; employerLabel: string }>();
    for (const roleSignal of resume.ingestData?.roleSignals ?? []) {
      for (const workEntry of roleSignal.matchedWorkEntries ?? []) {
        const workEntryKey = workEntry.workEntryFingerprint?.trim();
        const employerLabel = workEntry.companyName?.trim();
        if (
          !workEntry.industryVerified ||
          workEntry.verdictRevisionId?.trim() ||
          !workEntryKey ||
          !employerLabel ||
          legacyEntries.has(workEntryKey)
        ) {
          continue;
        }
        legacyEntries.set(workEntryKey, { workEntryKey, employerLabel });
      }
    }

    if (legacyEntries.size === 0) {
      return { targets: [] };
    }

    const proposals = await ctx.db.query("company_industry_review_proposals").collect();
    const candidatesByWorkEntryKey = new Map<
      string,
      Map<string, (typeof proposals)[number]>
    >();
    for (const proposal of proposals) {
      for (const reference of proposal.sampleReferences ?? []) {
        const workEntryKey = reference.workEntryFingerprint;
        if (
          reference.workspaceSlug !== workspaceSlug ||
          !resumeIdentities.has(reference.resumeIdentity) ||
          !workEntryKey ||
          !legacyEntries.has(workEntryKey)
        ) {
          continue;
        }
        const candidates = candidatesByWorkEntryKey.get(workEntryKey)
          ?? new Map<string, (typeof proposals)[number]>();
        candidates.set(proposal.proposalId, proposal);
        candidatesByWorkEntryKey.set(workEntryKey, candidates);
      }
    }
    const targets = Array.from(legacyEntries.values()).map((entry) => {
      let openCandidate: (typeof proposals)[number] | undefined;
      let openCandidateCount = 0;
      for (const proposal of candidatesByWorkEntryKey.get(entry.workEntryKey)?.values() ?? []) {
        if (OPEN_INDUSTRY_PROPOSAL_STATUSES.has(proposal.status)) {
          openCandidate = proposal;
          openCandidateCount += 1;
        }
      }
      const selected = openCandidateCount === 1 ? openCandidate : undefined;

      if (!selected) {
        return {
          ...entry,
          availability: "not_linked" as const,
        };
      }

      return {
        ...entry,
        proposalId: selected.proposalId,
        status: selected.status,
        availability: "target_available" as const,
      };
    });

    return {
      targets: targets.sort(
        (left, right) =>
          left.employerLabel.localeCompare(right.employerLabel) ||
          left.workEntryKey.localeCompare(right.workEntryKey),
      ),
    };
  },
});

export const recordIndustryRefreshRequest = mutation({
  args: {
    writeSecret: v.optional(v.string()),
    requestId: v.string(),
    proposalId: v.string(),
    companyKey: v.string(),
    verdictRevisionId: v.string(),
    workspaceSlug: v.string(),
    requesterId: v.string(),
    reasonCode: industryRefreshReasonValidator,
    note: v.optional(v.string()),
    resumeIdentity: v.optional(v.string()),
    workEntryFingerprint: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    requireWriteSecret(args.writeSecret);
    const requestId = args.requestId.trim();
    const proposalId = args.proposalId.trim();
    const companyKey = normalizeCompanyKey(args.companyKey);
    const verdictRevisionId = args.verdictRevisionId.trim();
    const workspaceSlug = args.workspaceSlug.trim();
    const requesterId = args.requesterId.trim();
    const note = args.note?.trim();
    if (
      !requestId ||
      !proposalId ||
      !companyKey ||
      !verdictRevisionId ||
      !workspaceSlug ||
      !requesterId
    ) {
      throw new Error("Refresh request is missing governed identity fields");
    }
    if (note && note.length > 300) {
      throw new Error("Refresh request note is limited to 300 characters");
    }
    const existing = await ctx.db
      .query("company_industry_refresh_requests")
      .withIndex("by_request_id", (q) => q.eq("requestId", requestId))
      .collect();
    if (existing[0]) {
      return { requestId, created: false, proposalId: existing[0].proposalId };
    }
    const proposal = await findIndustryProposal(ctx, proposalId);
    if (
      !proposal ||
      proposal.companyKey !== companyKey ||
      proposal.currentRevisionId !== verdictRevisionId ||
      !OPEN_INDUSTRY_PROPOSAL_STATUSES.has(proposal.status)
    ) {
      throw new Error("Refresh request proposal does not match current approved truth");
    }
    const resumeIdentity = args.resumeIdentity?.trim();
    const workEntryFingerprint = args.workEntryFingerprint?.trim();
    if (resumeIdentity) {
      const links = await ctx.db
        .query("company_resume_links")
        .withIndex("by_workspace_company", (index) =>
          index
            .eq("workspaceSlug", workspaceSlug)
            .eq("companyKey", companyKey),
        )
        .take(201);
      if (links.length > 200) {
        throw new Error("Refresh request resume validation requires a narrower link page");
      }
      const matchingLink = links.find(
        (link) =>
          link.resumeIdentity === resumeIdentity &&
          link.currentVerdictRevisionId === verdictRevisionId &&
          (!workEntryFingerprint ||
            link.workEntryFingerprints.includes(workEntryFingerprint)),
      );
      if (!matchingLink) {
        throw new Error(
          "Refresh request resume reference does not match workspace, company, and revision",
        );
      }
    }
    await ctx.db.insert("company_industry_refresh_requests", {
      requestId,
      proposalId,
      companyKey,
      verdictRevisionId,
      workspaceSlug: workspaceSlug.slice(0, 80),
      requesterId: requesterId.slice(0, 200),
      reasonCode: args.reasonCode,
      ...(note ? { note } : {}),
      ...(resumeIdentity
        ? { resumeIdentity: resumeIdentity.slice(0, 200) }
        : {}),
      ...(workEntryFingerprint
        ? {
            workEntryFingerprint:
              workEntryFingerprint.slice(0, 160),
          }
        : {}),
      createdAt: Date.now(),
    });
    return { requestId, created: true, proposalId };
  },
});

export const listIndustryRefreshRequests = query({
  args: {
    writeSecret: v.optional(v.string()),
    proposalId: v.string(),
  },
  handler: async (ctx, args) => {
    requireReadSecret(args.writeSecret);
    const rows = await ctx.db
      .query("company_industry_refresh_requests")
      .withIndex("by_proposal_created", (q) =>
        q.eq("proposalId", args.proposalId.trim()),
      )
      .collect();
    return rows.sort(
      (left, right) =>
        right.createdAt - left.createdAt ||
        left.requestId.localeCompare(right.requestId),
    );
  },
});

export const getIndustryProposal = query({
  args: {
    writeSecret: v.optional(v.string()),
    proposalId: v.string(),
  },
  handler: async (ctx, args) => {
    requireReadSecret(args.writeSecret);
    return findIndustryProposal(ctx, args.proposalId.trim());
  },
});

export const setIndustryProposalResearchState = mutation({
  args: {
    writeSecret: v.optional(v.string()),
    proposalId: v.string(),
    status: v.union(
      v.literal("researching"),
      v.literal("ready_for_review"),
      v.literal("needs_more_evidence"),
    ),
    suggestedIndustryClass: v.optional(industryClassValidator),
    suggestedVerificationLevel: v.optional(verificationLevelValidator),
    materialChangeSummary: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    requireWriteSecret(args.writeSecret);
    const proposal = await findIndustryProposal(ctx, args.proposalId.trim());
    if (!proposal) {
      throw new Error(`Unknown proposalId: ${args.proposalId}`);
    }
    if (!OPEN_INDUSTRY_PROPOSAL_STATUSES.has(proposal.status)) {
      throw new Error(`Proposal is not open for research: ${proposal.status}`);
    }
    const now = Date.now();
    await ctx.db.patch(proposal._id, {
      status: args.status,
      ...(args.status === "researching" && proposal.researchStartedAt === undefined
        ? { researchStartedAt: now }
        : {}),
      ...(args.status === "ready_for_review"
        ? { readyForReviewAt: now }
        : {}),
      ...(args.suggestedIndustryClass !== undefined
        ? { suggestedIndustryClass: args.suggestedIndustryClass }
        : {}),
      ...(args.suggestedVerificationLevel !== undefined
        ? { suggestedVerificationLevel: args.suggestedVerificationLevel }
        : {}),
      ...(args.materialChangeSummary?.trim()
        ? { materialChangeSummary: args.materialChangeSummary.trim().slice(0, 800) }
        : {}),
      updatedAt: now,
    });
    return {
      proposalId: proposal.proposalId,
      status: args.status,
      companyKey: proposal.companyKey,
    };
  },
});

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

export const approveIndustryProposal = mutation({
  args: {
    writeSecret: v.optional(v.string()),
    proposalId: v.string(),
    revisionId: v.string(),
    expectedCurrentRevisionId: v.optional(v.string()),
    expectedProposalUpdatedAt: v.optional(v.number()),
    expectedInputFingerprint: v.optional(v.string()),
    expectedSourceVersions: v.optional(
      v.array(v.object({ sourceId: v.string(), updatedAt: v.number() })),
    ),
    verificationLevel: approvedVerificationLevelValidator,
    industryClass: industryClassValidator,
    approvedSourceIds: v.array(v.string()),
    evidenceSummary: v.string(),
    reviewer: v.string(),
    decisionReason: v.string(),
    taxonomyVersion: v.string(),
    ruleVersion: v.optional(v.string()),
    nextReviewAt: v.optional(v.number()),
    reviewAttestation: v.optional(industryReviewAttestationValidator),
  },
  handler: async (ctx, args) => {
    requireWriteSecret(args.writeSecret);
    return commitIndustryVerdictApproval(ctx, {
      proposalId: args.proposalId,
      revisionId: args.revisionId,
      expectedCurrentRevisionId: args.expectedCurrentRevisionId,
      expectedProposalUpdatedAt: args.expectedProposalUpdatedAt,
      expectedInputFingerprint: args.expectedInputFingerprint,
      expectedSourceVersions: args.expectedSourceVersions,
      verificationLevel: args.verificationLevel,
      industryClass: args.industryClass,
      approvedSourceIds: args.approvedSourceIds,
      evidenceSummary: args.evidenceSummary,
      reviewer: args.reviewer,
      reviewerType: "human",
      decisionReason: args.decisionReason,
      taxonomyVersion: args.taxonomyVersion,
      ruleVersion: args.ruleVersion,
      nextReviewAt: args.nextReviewAt,
      reviewAttestation: args.reviewAttestation,
    });
  },
});

/**
 * Governed Lane A auto-approval (auto-verify-bot).
 *
 * Automation may approve ONLY when every Lane A condition holds:
 *   - every selected source is a structured registry/taxonomy record with
 *     explicit CNC/industrial signal text (never prose — official sites,
 *     reporting, OEM pages, directories route to the human cockpit);
 *   - all sources fetched + active + unreviewed (not disputed/rejected);
 *   - the proposal has a canonical companyKey (no identity ambiguity);
 *   - verificationLevel is "verified" only — "rejected" is human-only;
 *   - the proposal is not already approved (idempotent re-run is a no-op).
 *
 * The revisionId is deterministic: derived from the proposal, the selected
 * source versions, and the input fingerprint, so re-approving the same
 * proposal is a no-op instead of creating a duplicate revision.
 */
export const autoApproveIndustryProposal = mutation({
  args: {
    writeSecret: v.optional(v.string()),
    proposalId: v.string(),
    industryClass: industryClassValidator,
    approvedSourceIds: v.array(v.string()),
    evidenceSummary: v.string(),
    decisionReason: v.string(),
    taxonomyVersion: v.string(),
    ruleVersion: v.optional(v.string()),
    expectedInputFingerprint: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    requireWriteSecret(args.writeSecret);
    const proposalId = args.proposalId.trim();
    const proposal = await findIndustryProposal(ctx, proposalId);
    if (!proposal || !proposal.companyKey) {
      throw new Error(`Proposal is missing a canonical company: ${proposalId}`);
    }
    if (proposal.status === "approved") {
      // Idempotent re-run: the deterministic revisionId already exists.
      const existing = await findIndustryVerdictRevision(
        ctx,
        deterministicAutoRevisionId(proposalId, args.approvedSourceIds, args.expectedInputFingerprint),
      );
      if (existing) {
        return {
          proposalId,
          revisionId: existing.revisionId,
          companyKey: proposal.companyKey,
          sourceCount: existing.approvedSourceIds.length,
          idempotent: true,
        };
      }
      throw new Error(`Proposal is not open for approval: ${proposal.status}`);
    }
    if (!OPEN_INDUSTRY_PROPOSAL_STATUSES.has(proposal.status)) {
      throw new Error(`Proposal is not open for approval: ${proposal.status}`);
    }
    if (args.industryClass === "cnc" && !args.expectedInputFingerprint) {
      throw new Error("Auto-approval requires the review input fingerprint");
    }

    const approvedSourceIds = uniqueSortedStrings(args.approvedSourceIds);
    if (approvedSourceIds.length === 0) {
      throw new Error("At least one approved evidence source is required");
    }
    const sources = [];
    for (const sourceId of approvedSourceIds) {
      const source = await findIndustryEvidenceSource(ctx, sourceId);
      if (!source) {
        throw new Error(`Unknown evidence source: ${sourceId}`);
      }
      if (
        (source.companyKey && source.companyKey !== proposal.companyKey) ||
        (source.proposalId && source.proposalId !== proposalId)
      ) {
        throw new Error(`Evidence source is not attached to this proposal: ${sourceId}`);
      }
      sources.push(source);
    }

    // Lane A gate: structured registry/taxonomy only, explicit CNC text,
    // fetched + active + unreviewed. Prose evidence is never auto-approvable.
    if (!hasAutoApprovableEvidence(sources)) {
      throw new Error(
        "AUTO_VERIFY_LANE_A_REQUIRED: every selected source must be a fetched, active, unreviewed registry/taxonomy record with explicit CNC evidence",
      );
    }

    const revisionId = deterministicAutoRevisionId(
      proposalId,
      approvedSourceIds,
      args.expectedInputFingerprint,
    );
    return commitIndustryVerdictApproval(ctx, {
      proposalId,
      revisionId,
      verificationLevel: "verified",
      industryClass: args.industryClass,
      approvedSourceIds,
      evidenceSummary: args.evidenceSummary,
      reviewer: "auto-verify-bot",
      reviewerType: "auto-verify-bot",
      decisionReason: args.decisionReason,
      taxonomyVersion: args.taxonomyVersion,
      ruleVersion: args.ruleVersion,
      reviewAttestation: args.expectedInputFingerprint
        ? {
            schemaVersion: "industry-review-attestation.v1",
            inputFingerprint: args.expectedInputFingerprint,
            decisionMode: "standard",
            acknowledgedRiskFlags: [],
            cncEvidenceAcknowledged: true,
            acknowledgementReason:
              "Governed Lane A auto-approval: structured registry/taxonomy evidence with explicit CNC signal text",
          }
        : undefined,
    });
  },
});

/**
 * Deterministic revisionId for governed auto-approval: derived from the
 * proposal, the selected source IDs, and the review input fingerprint so a
 * re-run of the same approval is a no-op (no duplicate revisions).
 */
function deterministicAutoRevisionId(
  proposalId: string,
  approvedSourceIds: string[],
  inputFingerprint: string | undefined,
): string {
  const material = [
    "auto",
    proposalId,
    ...approvedSourceIds,
    inputFingerprint ?? "",
  ].join("|");
  let hash = 2166136261;
  for (const char of material) {
    hash ^= char.codePointAt(0) ?? 0;
    hash = Math.imul(hash, 16777619);
  }
  return `auto-${(hash >>> 0).toString(16).padStart(8, "0")}`;
}

/**
 * Shared approval core used by the attended human mutation and the governed
 * auto-approve mutation. Validates the proposal/source state, writes the
 * immutable verdict revision (with reviewerType), patches sources + profile,
 * and marks the proposal approved with recompute pending.
 */
async function commitIndustryVerdictApproval(
  ctx: { db: any },
  args: {
    proposalId: string;
    revisionId: string;
    expectedCurrentRevisionId?: string;
    expectedProposalUpdatedAt?: number;
    expectedInputFingerprint?: string;
    expectedSourceVersions?: Array<{ sourceId: string; updatedAt: number }>;
    verificationLevel: "verified" | "rejected";
    industryClass: string;
    approvedSourceIds: string[];
    evidenceSummary: string;
    reviewer: string;
    reviewerType: "human" | "auto-verify-bot";
    decisionReason: string;
    taxonomyVersion: string;
    ruleVersion?: string;
    nextReviewAt?: number;
    reviewAttestation?: {
      schemaVersion: "industry-review-attestation.v1";
      inputFingerprint: string;
      decisionMode: "standard" | "risk_override";
      acknowledgedRiskFlags: string[];
      cncEvidenceAcknowledged: boolean;
      acknowledgementReason: string;
    };
  },
) {
  const proposalId = args.proposalId.trim();
  const revisionId = args.revisionId.trim();
  const reviewer = args.reviewer.trim();
  const decisionReason = args.decisionReason.trim();
  const evidenceSummary = args.evidenceSummary.trim();
  const taxonomyVersion = args.taxonomyVersion.trim();
  if (
    !proposalId ||
    !revisionId ||
    !reviewer ||
    !decisionReason ||
    !evidenceSummary ||
    !taxonomyVersion
  ) {
    throw new Error("Approval requires proposal, revision, reviewer, reason, summary, and taxonomy");
  }
  const proposal = await findIndustryProposal(ctx, proposalId);
  if (!proposal || !proposal.companyKey) {
    throw new Error(`Proposal is missing a canonical company: ${proposalId}`);
  }
  const companyKey = proposal.companyKey;
  const profiles = await ctx.db
    .query("company_industry_profiles")
    .withIndex("by_company_key", (q: any) => q.eq("companyKey", companyKey))
    .collect();
  const profile = profiles[0];
  const currentRevisionId = profile?.currentRevisionId;
  if (
    proposal.status === "approved" &&
    proposal.approvedRevisionId === revisionId &&
    currentRevisionId === revisionId
  ) {
    const revisions = await ctx.db
      .query("company_industry_verdict_revisions")
      .withIndex("by_revision_id", (q: any) => q.eq("revisionId", revisionId))
      .collect();
    const revision = revisions[0];
    if (
      !revision ||
      revision.companyKey !== companyKey ||
      revision.proposalId !== proposalId
    ) {
      throw new Error("Approved proposal revision is inconsistent");
    }
    return {
      proposalId,
      revisionId,
      companyKey,
      ...(revision.supersedesRevisionId
        ? { supersedesRevisionId: revision.supersedesRevisionId }
        : {}),
      sourceCount: revision.approvedSourceIds.length,
    };
  }
  if (!OPEN_INDUSTRY_PROPOSAL_STATUSES.has(proposal.status)) {
    throw new Error(`Proposal is not open for approval: ${proposal.status}`);
  }
  if (
    args.reviewAttestation &&
    args.expectedInputFingerprint !== undefined &&
    args.reviewAttestation.inputFingerprint !== args.expectedInputFingerprint
  ) {
    throw new Error(
      `${INDUSTRY_REVIEW_STALE_PREFIX} recommendation fingerprint changed during review`,
    );
  }
  if (
    args.reviewAttestation &&
    args.reviewAttestation.decisionMode === "risk_override" &&
    !args.reviewAttestation.acknowledgementReason.trim()
  ) {
    throw new Error("INDUSTRY_REVIEW_ATTESTATION_INVALID: risk override reason is required");
  }
  if (
    args.industryClass === "cnc" &&
    (!args.reviewAttestation || !args.reviewAttestation.cncEvidenceAcknowledged)
  ) {
    throw new Error(
      "INDUSTRY_REVIEW_CNC_ACK_REQUIRED: explicit CNC evidence acknowledgement is required",
    );
  }
  if (
    args.expectedCurrentRevisionId !== undefined &&
    currentRevisionId !== args.expectedCurrentRevisionId
  ) {
    throw new Error(
      `${INDUSTRY_REVIEW_STALE_PREFIX} current industry revision changed during review`,
    );
  }
  if (
    proposal.currentRevisionId !== undefined &&
    currentRevisionId !== proposal.currentRevisionId
  ) {
    throw new Error(
      `${INDUSTRY_REVIEW_STALE_PREFIX} proposal current revision changed during review`,
    );
  }
  assertExpectedIndustryProposalUpdatedAt(proposal, args.expectedProposalUpdatedAt);
  if (args.expectedSourceVersions !== undefined) {
    const currentSources = await ctx.db
      .query("company_industry_evidence_sources")
      .withIndex("by_proposal", (q: any) => q.eq("proposalId", proposalId))
      .collect();
    const expectedVersions = new Map(
      args.expectedSourceVersions.map((item) => [item.sourceId.trim(), item.updatedAt]),
    );
    if (
      expectedVersions.size !== args.expectedSourceVersions.length ||
      expectedVersions.size !== currentSources.length ||
      currentSources.some(
        (source: { sourceId: string; updatedAt: number }) =>
          expectedVersions.get(source.sourceId) !== source.updatedAt,
      )
    ) {
      throw new Error(
        `${INDUSTRY_REVIEW_STALE_PREFIX} evidence source changed during review`,
      );
    }
  }

  const existingRevisions = await ctx.db
    .query("company_industry_verdict_revisions")
    .withIndex("by_revision_id", (q: any) => q.eq("revisionId", revisionId))
    .collect();
  if (existingRevisions[0]) {
    throw new Error(`revisionId already exists: ${revisionId}`);
  }

  const approvedSourceIds = uniqueSortedStrings(args.approvedSourceIds);
  if (approvedSourceIds.length === 0) {
    throw new Error("At least one approved evidence source is required");
  }
  const sources = [];
  for (const sourceId of approvedSourceIds) {
    const source = await findIndustryEvidenceSource(ctx, sourceId);
    if (!source) {
      throw new Error(`Unknown evidence source: ${sourceId}`);
    }
    if (
      (source.companyKey && source.companyKey !== companyKey) ||
      (source.proposalId && source.proposalId !== proposalId)
    ) {
      throw new Error(`Evidence source is not attached to this proposal: ${sourceId}`);
    }
    if (
      source.sourceType === "search_result" ||
      source.trustTier === "discovery" ||
      normalizeIndustryEvidenceUrl(source.url) === null ||
      source.fetchStatus !== "fetched" ||
      source.sourceState !== "active" ||
      source.reviewStatus === "disputed" ||
      source.reviewStatus === "rejected"
    ) {
      throw new Error(`Evidence source is not approval-safe: ${sourceId}`);
    }
    sources.push(source);
  }

  if (
    args.industryClass === "cnc" &&
    !hasExplicitCncEvidence(sources)
  ) {
    throw new Error(
      "INDUSTRY_REVIEW_CNC_EVIDENCE_REQUIRED: selected sources do not contain explicit CNC evidence",
    );
  }

  const now = Date.now();
  await ctx.db.insert("company_industry_verdict_revisions", {
    revisionId,
    companyKey,
    industryClass: args.industryClass,
    verificationLevel: args.verificationLevel,
    approvedSourceIds,
    evidenceSummary,
    reviewedBy: reviewer,
    reviewerType: args.reviewerType,
    reviewedAt: now,
    decisionReason,
    taxonomyVersion,
    ...(args.ruleVersion?.trim()
      ? { ruleVersion: args.ruleVersion.trim() }
      : {}),
    ...(args.reviewAttestation
      ? { reviewAttestation: args.reviewAttestation }
      : {}),
    ...(currentRevisionId
      ? { supersedesRevisionId: currentRevisionId }
      : {}),
    proposalId,
    createdAt: now,
  });

  for (const source of sources) {
    await ctx.db.patch(source._id, {
      reviewStatus: "approved",
      reviewedAt: now,
      reviewedBy: reviewer,
      reviewerNote: decisionReason,
      updatedAt: now,
    });
  }

  const primarySource = sources[0];
  const nextReviewAt =
    args.nextReviewAt ??
    Math.min(
      ...sources.map((source) =>
        nextIndustryEvidenceReviewAt(
          source.sourceType,
          source.trustTier,
          now,
        ),
      ),
    );
  const profilePayload = {
    companyKey,
    industryClass: args.industryClass,
    verificationLevel: args.verificationLevel,
    evidenceSource: "manual" as const,
    summary: evidenceSummary,
    ...(primarySource
      ? {
          sourceUrl: primarySource.url,
          sourceDomain: primarySource.sourceDomain,
          sourceType: primarySource.sourceType,
        }
      : {}),
    currentRevisionId: revisionId,
    reviewedAt: now,
    reviewedBy: reviewer,
    sourceCount: approvedSourceIds.length,
    freshnessState: "fresh" as const,
    nextReviewAt,
    catalogVersion: (profile?.catalogVersion ?? 0) + 1,
    compatibilityState: "reviewed" as const,
    updatedAt: now,
    updatedBy: reviewer,
  };
  if (profile) {
    await ctx.db.patch(profile._id, profilePayload);
  } else {
    await ctx.db.insert("company_industry_profiles", profilePayload);
  }

  await ctx.db.patch(proposal._id, {
    status: "approved",
    reviewedAt: now,
    reviewedBy: reviewer,
    reviewNote: decisionReason,
    approvedRevisionId: revisionId,
    applicationState: "recompute_pending",
    updatedAt: now,
  });

  return {
    proposalId,
    revisionId,
    companyKey,
    ...(currentRevisionId
      ? { supersedesRevisionId: currentRevisionId }
      : {}),
    sourceCount: approvedSourceIds.length,
  };
}

export const undoIndustryProposalApproval = mutation({
  args: {
    writeSecret: v.optional(v.string()),
    proposalId: v.string(),
    approvedRevisionId: v.string(),
    expectedCurrentRevisionId: v.optional(v.string()),
    expectedProposalUpdatedAt: v.optional(v.number()),
    recomputeRunId: v.optional(v.string()),
    reviewer: v.string(),
  },
  handler: async (ctx, args) => {
    requireWriteSecret(args.writeSecret);
    const proposalId = args.proposalId.trim();
    const approvedRevisionId = args.approvedRevisionId.trim();
    const reviewer = args.reviewer.trim();
    if (!proposalId || !approvedRevisionId || !reviewer) {
      throw new Error("Undo requires proposal, approved revision, and reviewer");
    }

    const proposal = await findIndustryProposal(ctx, proposalId);
    if (!proposal || !proposal.companyKey) {
      throw new Error(`Unknown industry proposal: ${proposalId}`);
    }
    const companyKey = proposal.companyKey;
    const profiles = await ctx.db
      .query("company_industry_profiles")
      .withIndex("by_company_key", (q: any) => q.eq("companyKey", companyKey))
      .collect();
    const profile = profiles[0] ?? null;
    const currentRevisionId = profile?.currentRevisionId;
    const reversalRevisionId = `undo-${approvedRevisionId}`;
    const existingReversal = await findIndustryVerdictRevision(
      ctx,
      reversalRevisionId,
    );

    if (
      existingReversal &&
      existingReversal.supersedesRevisionId === approvedRevisionId &&
      existingReversal.proposalId === proposalId &&
      proposal.status === "ready_for_review" &&
      currentRevisionId === reversalRevisionId
    ) {
      const existingApprovedRevision = await findIndustryVerdictRevision(
        ctx,
        approvedRevisionId,
      );
      const previousRunId =
        args.recomputeRunId?.trim() || proposal.recomputeRunId;
      const previousRun = previousRunId
        ? await findIndustryRecomputeRun(ctx, previousRunId)
        : null;
      if (previousRun && previousRun.targetRevisionId !== approvedRevisionId) {
        throw new Error(
          `${INDUSTRY_REVIEW_STALE_PREFIX} recompute run no longer targets the approved revision`,
        );
      }
      return {
        proposalId,
        companyKey,
        reversalRevisionId,
        ...(existingApprovedRevision?.supersedesRevisionId
          ? { restoredRevisionId: existingApprovedRevision.supersedesRevisionId }
          : {}),
        ...(previousRun
          ? {
              previousRunId: previousRun.runId,
              previousRunStatus: previousRun.status,
            }
          : {}),
        replacementRecomputeRequired: previousRun?.status === "completed",
        idempotent: true,
      };
    }

    if (
      !profile ||
      currentRevisionId !== approvedRevisionId ||
      proposal.status !== "approved" ||
      proposal.approvedRevisionId !== approvedRevisionId
    ) {
      throw new Error(
        `${INDUSTRY_REVIEW_STALE_PREFIX} approved industry revision is no longer current`,
      );
    }
    if (
      args.expectedCurrentRevisionId !== undefined &&
      currentRevisionId !== args.expectedCurrentRevisionId
    ) {
      throw new Error(
        `${INDUSTRY_REVIEW_STALE_PREFIX} current industry revision changed during Undo`,
      );
    }
    assertExpectedIndustryProposalUpdatedAt(
      proposal,
      args.expectedProposalUpdatedAt,
    );

    const approvedRevision = await findIndustryVerdictRevision(
      ctx,
      approvedRevisionId,
    );
    if (
      !approvedRevision ||
      approvedRevision.companyKey !== companyKey ||
      approvedRevision.proposalId !== proposalId
    ) {
      throw new Error(
        `${INDUSTRY_REVIEW_STALE_PREFIX} approved revision does not belong to this proposal`,
      );
    }
    const previousRevisionId = approvedRevision.supersedesRevisionId;
    const previousRevision = previousRevisionId
      ? await findIndustryVerdictRevision(ctx, previousRevisionId)
      : null;
    if (previousRevisionId && !previousRevision) {
      throw new Error(
        `${INDUSTRY_REVIEW_STALE_PREFIX} previous industry revision is unavailable`,
      );
    }

    const previousRunId =
      args.recomputeRunId?.trim() || proposal.recomputeRunId;
    const previousRun = previousRunId
      ? await findIndustryRecomputeRun(ctx, previousRunId)
      : null;
    if (previousRunId && !previousRun) {
      throw new Error(
        `${INDUSTRY_REVIEW_STALE_PREFIX} recompute run is unavailable`,
      );
    }
    if (
      previousRun &&
      (previousRun.targetRevisionId !== approvedRevisionId ||
        (previousRun.proposalId && previousRun.proposalId !== proposalId) ||
        previousRun.companyKey !== companyKey)
    ) {
      throw new Error(
        `${INDUSTRY_REVIEW_STALE_PREFIX} recompute run no longer targets the approved revision`,
      );
    }

    const restoredSourceIds = previousRevision?.approvedSourceIds ?? [];
    const restoredSources = [];
    for (const sourceId of restoredSourceIds) {
      const source = await findIndustryEvidenceSource(ctx, sourceId);
      if (source && source.companyKey === companyKey) {
        restoredSources.push(source);
      }
    }
    const primarySource = restoredSources[0];
    const now = Date.now();
    const restoredIndustryClass = previousRevision?.industryClass ?? "unknown";
    const restoredVerificationLevel =
      previousRevision?.verificationLevel ?? "rejected";
    const restoredEvidenceSummary =
      previousRevision?.evidenceSummary ??
      `Undo restored no verified industry truth after ${approvedRevisionId}.`;
    const restoredDecisionReason = previousRevision
      ? `Undo approval ${approvedRevisionId}; restored revision ${previousRevision.revisionId}.`
      : `Undo approval ${approvedRevisionId}; no prior verified industry truth existed.`;
    const restoredNextReviewAt =
      restoredSources.length > 0
        ? Math.min(
            ...restoredSources.map((source) =>
              nextIndustryEvidenceReviewAt(
                source.sourceType,
                source.trustTier,
                now,
              ),
            ),
          )
        : undefined;

    await ctx.db.insert("company_industry_verdict_revisions", {
      revisionId: reversalRevisionId,
      companyKey,
      industryClass: restoredIndustryClass,
      verificationLevel: restoredVerificationLevel,
      approvedSourceIds: restoredSourceIds,
      evidenceSummary: restoredEvidenceSummary,
      reviewedBy: reviewer,
      reviewerType: "human",
      reviewedAt: now,
      decisionReason: restoredDecisionReason,
      taxonomyVersion: previousRevision?.taxonomyVersion ?? approvedRevision.taxonomyVersion,
      ...(previousRevision?.ruleVersion
        ? { ruleVersion: previousRevision.ruleVersion }
        : approvedRevision.ruleVersion
          ? { ruleVersion: approvedRevision.ruleVersion }
          : {}),
      supersedesRevisionId: approvedRevisionId,
      proposalId,
      createdAt: now,
    });

    const restoredProfile = {
      companyKey,
      industryClass: restoredIndustryClass,
      verificationLevel: restoredVerificationLevel,
      evidenceSource: "manual" as const,
      ...(profile.officialDomain
        ? { officialDomain: profile.officialDomain }
        : {}),
      summary: restoredEvidenceSummary,
      ...(primarySource
        ? {
            sourceUrl: primarySource.url,
            sourceDomain: primarySource.sourceDomain,
            sourceType: primarySource.sourceType,
          }
        : {}),
      ...(profile.msicCode ? { msicCode: profile.msicCode } : {}),
      ...(profile.msicDescription
        ? { msicDescription: profile.msicDescription }
        : {}),
      ...(profile.fetchedAt ? { fetchedAt: profile.fetchedAt } : {}),
      currentRevisionId: reversalRevisionId,
      reviewedAt: now,
      reviewedBy: reviewer,
      sourceCount: restoredSourceIds.length,
      freshnessState: restoredSourceIds.length > 0 ? ("fresh" as const) : ("changed" as const),
      ...(restoredNextReviewAt !== undefined
        ? { nextReviewAt: restoredNextReviewAt }
        : {}),
      catalogVersion: (profile.catalogVersion ?? 0) + 1,
      compatibilityState: "reviewed" as const,
      updatedAt: now,
      updatedBy: reviewer,
    };
    await ctx.db.replace(profile._id, restoredProfile);

    if (previousRun) {
      if (!TERMINAL_INDUSTRY_RECOMPUTE_STATUSES.has(previousRun.status)) {
        await ctx.db.patch(previousRun._id, {
          status: "superseded",
          supersededByRevisionId: reversalRevisionId,
          completedAt: now,
          updatedAt: now,
        });
      }
    }

    await ctx.db.patch(proposal._id, {
      status: "ready_for_review",
      reviewedAt: now,
      reviewedBy: reviewer,
      reviewNote: restoredDecisionReason,
      approvedRevisionId: undefined,
      applicationState: undefined,
      appliedRevisionId: undefined,
      appliedAt: undefined,
      updatedAt: now,
    });

    return {
      proposalId,
      companyKey,
      reversalRevisionId,
      ...(previousRevisionId ? { restoredRevisionId: previousRevisionId } : {}),
      ...(previousRun
        ? {
            previousRunId: previousRun.runId,
            previousRunStatus: previousRun.status,
          }
        : {}),
      replacementRecomputeRequired: previousRun?.status === "completed",
      idempotent: false,
    };
  },
});

export const resolveIndustryProposal = mutation({
  args: {
    writeSecret: v.optional(v.string()),
    proposalId: v.string(),
    resolution: v.union(
      v.literal("rejected"),
      v.literal("needs_more_evidence"),
      v.literal("superseded"),
    ),
    expectedProposalUpdatedAt: v.optional(v.number()),
    reviewer: v.string(),
    reviewNote: v.string(),
  },
  handler: async (ctx, args) => {
    requireWriteSecret(args.writeSecret);
    const proposal = await findIndustryProposal(ctx, args.proposalId.trim());
    if (!proposal) {
      throw new Error(`Unknown proposalId: ${args.proposalId}`);
    }
    if (!OPEN_INDUSTRY_PROPOSAL_STATUSES.has(proposal.status)) {
      throw new Error(`Proposal is not open: ${proposal.status}`);
    }
    assertExpectedIndustryProposalUpdatedAt(proposal, args.expectedProposalUpdatedAt);
    const now = Date.now();
    await ctx.db.patch(proposal._id, {
      status: args.resolution,
      reviewedAt: now,
      reviewedBy: args.reviewer.trim(),
      reviewNote: args.reviewNote.trim(),
      updatedAt: now,
    });
    return { proposalId: proposal.proposalId, status: args.resolution };
  },
});

export const listIndustryVerdictRevisions = query({
  args: {
    writeSecret: v.optional(v.string()),
    companyKey: v.string(),
  },
  handler: async (ctx, args) => {
    requireReadSecret(args.writeSecret);
    const companyKey = normalizeCompanyKey(args.companyKey);
    const rows = await ctx.db
      .query("company_industry_verdict_revisions")
      .withIndex("by_company_created", (q) => q.eq("companyKey", companyKey))
      .collect();
    return rows.sort(
      (left, right) =>
        right.createdAt - left.createdAt ||
        right.revisionId.localeCompare(left.revisionId),
    );
  },
});

/**
 * List verdict revisions advanced by the governed auto-verify-bot lane
 * (reviewerType = auto-verify-bot), newest first. Used by the sampling-audit
 * script to select ~10% of auto-approved verdicts for human re-review and to
 * track the override rate.
 *
 * Legacy rows (pre-Lane-A) lack reviewerType; they are treated as
 * auto-approved when reviewedBy is "auto-verify-bot" (the migration-bot
 * approvals from the v0.4.23 upgrade).
 */
export const listAutoApprovedVerdictRevisions = query({
  args: {
    writeSecret: v.optional(v.string()),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    requireReadSecret(args.writeSecret);
    const limit = Math.min(1000, Math.max(1, Math.floor(args.limit ?? 200)));
    const rows = await ctx.db
      .query("company_industry_verdict_revisions")
      .collect();
    return rows
      .filter(
        (row) =>
          row.reviewerType === "auto-verify-bot" ||
          (row.reviewerType === undefined && row.reviewedBy === "auto-verify-bot"),
      )
      .sort(
        (left, right) =>
          right.createdAt - left.createdAt ||
          right.revisionId.localeCompare(left.revisionId),
      )
      .slice(0, limit);
  },
});

// ---------------------------------------------------------------------------
// Durable targeted company-industry recompute orchestration
// ---------------------------------------------------------------------------

const INDUSTRY_RECOMPUTE_BATCH_SIZE = 50;
const INDUSTRY_RECOMPUTE_FAILURE_SAMPLE_LIMIT = 20;
const TERMINAL_INDUSTRY_RECOMPUTE_STATUSES = new Set([
  "completed",
  "partial_failed",
  "failed",
  "superseded",
]);

async function findIndustryRecomputeRun(ctx: { db: any }, runId: string) {
  const rows = await ctx.db
    .query("company_industry_recompute_runs")
    .withIndex("by_run_id", (q: any) => q.eq("runId", runId))
    .collect();
  return rows[0] ?? null;
}

async function findIndustryRecomputeBatch(ctx: { db: any }, batchId: string) {
  const rows = await ctx.db
    .query("company_industry_recompute_batches")
    .withIndex("by_batch_id", (q: any) => q.eq("batchId", batchId))
    .collect();
  return rows[0] ?? null;
}

async function currentIndustryRevisionId(
  ctx: { db: any },
  companyKey: string,
): Promise<string | undefined> {
  const rows = await ctx.db
    .query("company_industry_profiles")
    .withIndex("by_company_key", (q: any) => q.eq("companyKey", companyKey))
    .collect();
  return rows[0]?.currentRevisionId;
}

async function patchProposalRecomputeState(
  ctx: { db: any },
  proposalId: string | undefined,
  patch: Record<string, unknown>,
): Promise<void> {
  if (!proposalId) return;
  const proposal = await findIndustryProposal(ctx, proposalId);
  if (!proposal) return;
  await ctx.db.patch(proposal._id, patch);
}

function boundedRunFailures(
  existing: Array<{
    resumeId?: string;
    stage: string;
    message: string;
    occurredAt: number;
  }>,
  additions: Array<{
    resumeId?: string;
    stage: string;
    message: string;
    occurredAt: number;
  }>,
) {
  return [...existing, ...additions].slice(-INDUSTRY_RECOMPUTE_FAILURE_SAMPLE_LIMIT);
}

export const getIndustryRecomputeRevisionState = query({
  args: {
    writeSecret: v.optional(v.string()),
    companyKey: v.string(),
    targetRevisionId: v.string(),
  },
  handler: async (ctx, args) => {
    requireReadSecret(args.writeSecret);
    const companyKey = normalizeCompanyKey(args.companyKey);
    const targetRevisionId = args.targetRevisionId.trim();
    const currentRevisionId = await currentIndustryRevisionId(ctx, companyKey);
    return {
      currentRevisionId,
      matchesTargetRevision:
        Boolean(targetRevisionId) && currentRevisionId === targetRevisionId,
    };
  },
});

export const startIndustryRecomputeRun = mutation({
  args: {
    writeSecret: v.optional(v.string()),
    runId: v.string(),
    workspaceSlug: v.string(),
    companyKey: v.string(),
    targetRevisionId: v.string(),
    proposalId: v.optional(v.string()),
    requestedBy: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    requireWriteSecret(args.writeSecret);
    const runId = args.runId.trim();
    const workspaceSlug = normalizeWorkspaceSlug(args.workspaceSlug);
    const companyKey = normalizeCompanyKey(args.companyKey);
    const targetRevisionId = args.targetRevisionId.trim();
    if (!runId || !companyKey || !targetRevisionId) {
      throw new Error(
        "Industry recompute requires runId, companyKey, and targetRevisionId",
      );
    }

    const currentRevisionId = await currentIndustryRevisionId(ctx, companyKey);
    if (currentRevisionId !== targetRevisionId) {
      throw new Error(
        `Industry recompute target revision ${targetRevisionId} is not current for ${companyKey}`,
      );
    }

    const existing = await ctx.db
      .query("company_industry_recompute_runs")
      .withIndex("by_workspace_company_revision", (q) =>
        q
          .eq("workspaceSlug", workspaceSlug)
          .eq("companyKey", companyKey)
          .eq("targetRevisionId", targetRevisionId),
      )
      .collect();
    if (existing[0]) {
      return existing[0];
    }
    if (await findIndustryRecomputeRun(ctx, runId)) {
      throw new Error(`Industry recompute runId already exists: ${runId}`);
    }

    const now = Date.now();
    const normalizedProposalId = args.proposalId?.trim() || undefined;
    const id = await ctx.db.insert("company_industry_recompute_runs", {
      runId,
      workspaceSlug,
      companyKey,
      targetRevisionId,
      ...(normalizedProposalId ? { proposalId: normalizedProposalId } : {}),
      ...(args.requestedBy?.trim()
        ? { requestedBy: args.requestedBy.trim() }
        : {}),
      status: "queued",
      attempt: 1,
      sourceDone: false,
      pageCount: 0,
      affectedCount: 0,
      alreadyCurrentCount: 0,
      scheduledCount: 0,
      readyCount: 0,
      failureCount: 0,
      batchCount: 0,
      failures: [],
      createdAt: now,
      updatedAt: now,
    });
    await patchProposalRecomputeState(ctx, normalizedProposalId, {
      approvedRevisionId: targetRevisionId,
      recomputeRunId: runId,
      applicationState: "recompute_pending",
      updatedAt: now,
    });
    return ctx.db.get(id);
  },
});

export const getIndustryRecomputeRun = query({
  args: {
    writeSecret: v.optional(v.string()),
    runId: v.string(),
  },
  handler: async (ctx, args) => {
    requireReadSecret(args.writeSecret);
    return findIndustryRecomputeRun(ctx, args.runId.trim());
  },
});

export const listIndustryRecomputeRuns = query({
  args: {
    writeSecret: v.optional(v.string()),
    workspaceSlug: v.string(),
    companyKey: v.string(),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    requireReadSecret(args.writeSecret);
    const workspaceSlug = normalizeWorkspaceSlug(args.workspaceSlug);
    const companyKey = normalizeCompanyKey(args.companyKey);
    const limit = Math.min(100, Math.max(1, Math.floor(args.limit ?? 20)));
    return ctx.db
      .query("company_industry_recompute_runs")
      .withIndex("by_workspace_company_updated", (q) =>
        q.eq("workspaceSlug", workspaceSlug).eq("companyKey", companyKey),
      )
      .order("desc")
      .take(limit);
  },
});

export const getNextIndustryRecomputeBatch = query({
  args: {
    writeSecret: v.optional(v.string()),
    runId: v.string(),
  },
  handler: async (ctx, args) => {
    requireReadSecret(args.writeSecret);
    const runId = args.runId.trim();
    for (const status of ["dispatched", "planned"] as const) {
      const rows = await ctx.db
        .query("company_industry_recompute_batches")
        .withIndex("by_run_status", (q) =>
          q.eq("runId", runId).eq("status", status),
        )
        .collect();
      rows.sort(
        (left, right) =>
          left.pageNumber - right.pageNumber ||
          left.batchId.localeCompare(right.batchId),
      );
      if (rows[0]) return rows[0];
    }
    return null;
  },
});

export const reserveIndustryRecomputePage = mutation({
  args: {
    writeSecret: v.optional(v.string()),
    runId: v.string(),
    expectedCursor: v.optional(v.string()),
    items: v.array(
      v.object({
        resumeId: v.id("resumes"),
        currentVerdictRevisionId: v.optional(v.string()),
      }),
    ),
    continueCursor: v.string(),
    isDone: v.boolean(),
  },
  handler: async (ctx, args) => {
    requireWriteSecret(args.writeSecret);
    const run = await findIndustryRecomputeRun(ctx, args.runId.trim());
    if (!run) throw new Error(`Unknown industry recompute run: ${args.runId}`);
    if (TERMINAL_INDUSTRY_RECOMPUTE_STATUSES.has(run.status)) return run;
    if (args.items.length > 200) {
      throw new Error("Industry recompute pages are limited to 200 resumes");
    }
    if ((run.cursor ?? "") !== (args.expectedCursor ?? "")) {
      return run;
    }
    const currentRevisionId = await currentIndustryRevisionId(
      ctx,
      run.companyKey,
    );
    if (currentRevisionId !== run.targetRevisionId) {
      throw new Error("Industry recompute revision was superseded");
    }

    const seenResumeIds = new Set<string>();
    const uniqueItems = args.items.filter((item) => {
      const resumeId = String(item.resumeId);
      if (seenResumeIds.has(resumeId)) return false;
      seenResumeIds.add(resumeId);
      return true;
    });
    const alreadyCurrent = uniqueItems.filter(
      (item) => item.currentVerdictRevisionId === run.targetRevisionId,
    );
    const staleResumeIds = uniqueItems
      .filter(
        (item) => item.currentVerdictRevisionId !== run.targetRevisionId,
      )
      .map((item) => item.resumeId);
    const now = Date.now();
    const pageNumber = run.pageCount + 1;
    let createdBatches = 0;
    for (
      let index = 0;
      index < staleResumeIds.length;
      index += INDUSTRY_RECOMPUTE_BATCH_SIZE
    ) {
      const batchNumber = Math.floor(index / INDUSTRY_RECOMPUTE_BATCH_SIZE) + 1;
      const batchId = `${run.runId}:${run.attempt}:${pageNumber}:${batchNumber}`;
      if (!(await findIndustryRecomputeBatch(ctx, batchId))) {
        await ctx.db.insert("company_industry_recompute_batches", {
          batchId,
          runId: run.runId,
          pageNumber,
          status: "planned",
          resumeIds: staleResumeIds.slice(
            index,
            index + INDUSTRY_RECOMPUTE_BATCH_SIZE,
          ),
          createdAt: now,
          updatedAt: now,
        });
        createdBatches += 1;
      }
    }
    await ctx.db.patch(run._id, {
      status: staleResumeIds.length > 0 ? "running" : run.status,
      cursor: args.continueCursor,
      sourceDone: args.isDone,
      pageCount: pageNumber,
      affectedCount: run.affectedCount + uniqueItems.length,
      alreadyCurrentCount:
        run.alreadyCurrentCount + alreadyCurrent.length,
      readyCount: run.readyCount + alreadyCurrent.length,
      ...(run.startedAt === undefined ? { startedAt: now } : {}),
      updatedAt: now,
    });
    if (createdBatches > 0) {
      await patchProposalRecomputeState(ctx, run.proposalId, {
        applicationState: "recompute_running",
        updatedAt: now,
      });
    }
    return ctx.db.get(run._id);
  },
});

export const recordIndustryRecomputeBatchDispatch = mutation({
  args: {
    writeSecret: v.optional(v.string()),
    runId: v.string(),
    batchId: v.string(),
    dispatchedAt: v.number(),
    expectedSkillsVersion: v.number(),
  },
  handler: async (ctx, args) => {
    requireWriteSecret(args.writeSecret);
    const run = await findIndustryRecomputeRun(ctx, args.runId.trim());
    const batch = await findIndustryRecomputeBatch(ctx, args.batchId.trim());
    if (!run || !batch || batch.runId !== run.runId) {
      throw new Error("Unknown industry recompute batch");
    }
    if (batch.status !== "planned") return run;
    const now = Date.now();
    await ctx.db.patch(batch._id, {
      status: "dispatched",
      dispatchedAt: args.dispatchedAt,
      expectedSkillsVersion: args.expectedSkillsVersion,
      updatedAt: now,
    });
    await ctx.db.patch(run._id, {
      status: "waiting",
      scheduledCount: run.scheduledCount + batch.resumeIds.length,
      batchCount: run.batchCount + 1,
      updatedAt: now,
    });
    return ctx.db.get(run._id);
  },
});

export const recordIndustryRecomputeBatchFailure = mutation({
  args: {
    writeSecret: v.optional(v.string()),
    runId: v.string(),
    batchId: v.string(),
    stage: v.string(),
    message: v.string(),
  },
  handler: async (ctx, args) => {
    requireWriteSecret(args.writeSecret);
    const run = await findIndustryRecomputeRun(ctx, args.runId.trim());
    const batch = await findIndustryRecomputeBatch(ctx, args.batchId.trim());
    if (!run || !batch || batch.runId !== run.runId) {
      throw new Error("Unknown industry recompute batch");
    }
    if (
      batch.status === "completed" ||
      batch.status === "partial_failed" ||
      batch.status === "failed"
    ) {
      return run;
    }
    const stage = args.stage.trim() || "unknown";
    const message = args.message.trim() || "Unknown recompute failure";
    const now = Date.now();
    const failures: Array<{
      resumeId: string;
      stage: string;
      message: string;
    }> = batch.resumeIds.map((resumeId: unknown) => ({
      resumeId: String(resumeId),
      stage,
      message,
    }));
    await ctx.db.patch(batch._id, {
      status: "failed",
      readyCount: 0,
      failureCount: failures.length,
      failures,
      updatedAt: now,
    });
    await ctx.db.patch(run._id, {
      status: "running",
      failureCount: run.failureCount + failures.length,
      failures: boundedRunFailures(
        run.failures,
        failures.map((failure: {
          resumeId: string;
          stage: string;
          message: string;
        }) => ({ ...failure, occurredAt: now })),
      ),
      lastError: message,
      updatedAt: now,
    });
    return ctx.db.get(run._id);
  },
});

export const recordIndustryRecomputeBatchReadiness = mutation({
  args: {
    writeSecret: v.optional(v.string()),
    runId: v.string(),
    batchId: v.string(),
    readyResumeIds: v.array(v.id("resumes")),
    failures: v.array(
      v.object({
        resumeId: v.optional(v.string()),
        stage: v.string(),
        message: v.string(),
      }),
    ),
  },
  handler: async (ctx, args) => {
    requireWriteSecret(args.writeSecret);
    const run = await findIndustryRecomputeRun(ctx, args.runId.trim());
    const batch = await findIndustryRecomputeBatch(ctx, args.batchId.trim());
    if (!run || !batch || batch.runId !== run.runId) {
      throw new Error("Unknown industry recompute batch");
    }
    if (
      batch.status === "completed" ||
      batch.status === "partial_failed" ||
      batch.status === "failed"
    ) {
      return run;
    }
    if (batch.status !== "dispatched") {
      throw new Error("Industry recompute batch has not been dispatched");
    }

    const batchResumeIds = new Set(batch.resumeIds.map(String));
    const readyResumeIds = Array.from(
      new Set(args.readyResumeIds.map(String)),
    );
    if (readyResumeIds.some((resumeId) => !batchResumeIds.has(resumeId))) {
      throw new Error("Industry recompute readiness contains an unrelated resume");
    }
    const failureResumeIds = new Set(
      args.failures
        .map((failure) => failure.resumeId)
        .filter((resumeId): resumeId is string => Boolean(resumeId)),
    );
    const coveredResumeIds = new Set([...readyResumeIds, ...failureResumeIds]);
    if (coveredResumeIds.size !== batch.resumeIds.length) {
      throw new Error("Industry recompute readiness does not cover the batch");
    }

    const now = Date.now();
    const status =
      args.failures.length === 0
        ? ("completed" as const)
        : readyResumeIds.length > 0
          ? ("partial_failed" as const)
          : ("failed" as const);
    await ctx.db.patch(batch._id, {
      status,
      readyCount: readyResumeIds.length,
      failureCount: args.failures.length,
      failures: args.failures,
      updatedAt: now,
    });
    await ctx.db.patch(run._id, {
      status: "running",
      readyCount: run.readyCount + readyResumeIds.length,
      failureCount: run.failureCount + args.failures.length,
      failures: boundedRunFailures(
        run.failures,
        args.failures.map((failure) => ({ ...failure, occurredAt: now })),
      ),
      ...(args.failures[0]?.message
        ? { lastError: args.failures[0].message }
        : {}),
      updatedAt: now,
    });
    return ctx.db.get(run._id);
  },
});

export const finalizeIndustryRecomputeRun = mutation({
  args: {
    writeSecret: v.optional(v.string()),
    runId: v.string(),
  },
  handler: async (ctx, args) => {
    requireWriteSecret(args.writeSecret);
    const run = await findIndustryRecomputeRun(ctx, args.runId.trim());
    if (!run) throw new Error(`Unknown industry recompute run: ${args.runId}`);
    if (TERMINAL_INDUSTRY_RECOMPUTE_STATUSES.has(run.status)) return run;

    const currentRevisionId = await currentIndustryRevisionId(
      ctx,
      run.companyKey,
    );
    if (currentRevisionId !== run.targetRevisionId) {
      const now = Date.now();
      await ctx.db.patch(run._id, {
        status: "superseded",
        supersededByRevisionId: currentRevisionId,
        completedAt: now,
        updatedAt: now,
      });
      await patchProposalRecomputeState(ctx, run.proposalId, {
        applicationState: "superseded",
        updatedAt: now,
      });
      return ctx.db.get(run._id);
    }
    if (!run.sourceDone) return run;

    const batches = await ctx.db
      .query("company_industry_recompute_batches")
      .withIndex("by_run", (q) => q.eq("runId", run.runId))
      .collect();
    if (
      batches.some(
        (batch) =>
          batch.status === "planned" || batch.status === "dispatched",
      )
    ) {
      return run;
    }

    const now = Date.now();
    const status =
      run.failureCount === 0
        ? ("completed" as const)
        : run.readyCount > 0
          ? ("partial_failed" as const)
          : ("failed" as const);
    await ctx.db.patch(run._id, {
      status,
      completedAt: now,
      updatedAt: now,
    });
    await patchProposalRecomputeState(
      ctx,
      run.proposalId,
      status === "completed"
        ? {
            applicationState: "applied",
            appliedRevisionId: run.targetRevisionId,
            appliedAt: now,
            updatedAt: now,
          }
        : {
            applicationState: "partial_failure",
            updatedAt: now,
          },
    );
    return ctx.db.get(run._id);
  },
});

export const markIndustryRecomputeRunSuperseded = mutation({
  args: {
    writeSecret: v.optional(v.string()),
    runId: v.string(),
    observedRevisionId: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    requireWriteSecret(args.writeSecret);
    const run = await findIndustryRecomputeRun(ctx, args.runId.trim());
    if (!run) throw new Error(`Unknown industry recompute run: ${args.runId}`);
    if (run.status === "superseded") return run;
    if (
      run.status === "completed" ||
      run.status === "partial_failed" ||
      run.status === "failed"
    ) {
      return run;
    }
    const observedRevisionId =
      args.observedRevisionId?.trim() ||
      (await currentIndustryRevisionId(ctx, run.companyKey));
    if (observedRevisionId === run.targetRevisionId) {
      return run;
    }
    const now = Date.now();
    await ctx.db.patch(run._id, {
      status: "superseded",
      supersededByRevisionId: observedRevisionId,
      completedAt: now,
      updatedAt: now,
    });
    await patchProposalRecomputeState(ctx, run.proposalId, {
      applicationState: "superseded",
      updatedAt: now,
    });
    return ctx.db.get(run._id);
  },
});

export const retryIndustryRecomputeRun = mutation({
  args: {
    writeSecret: v.optional(v.string()),
    runId: v.string(),
    requestedBy: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    requireWriteSecret(args.writeSecret);
    const run = await findIndustryRecomputeRun(ctx, args.runId.trim());
    if (!run) throw new Error(`Unknown industry recompute run: ${args.runId}`);
    if (
      run.status === "queued" ||
      run.status === "running" ||
      run.status === "waiting" ||
      run.status === "completed"
    ) {
      return run;
    }
    if (run.status === "superseded") {
      throw new Error(
        "Cannot retry an industry recompute for a superseded revision",
      );
    }
    const currentRevisionId = await currentIndustryRevisionId(
      ctx,
      run.companyKey,
    );
    if (currentRevisionId !== run.targetRevisionId) {
      throw new Error(
        "Cannot retry an industry recompute for a superseded revision",
      );
    }

    const batches = await ctx.db
      .query("company_industry_recompute_batches")
      .withIndex("by_run", (q) => q.eq("runId", run.runId))
      .collect();
    for (const batch of batches) {
      await ctx.db.delete(batch._id);
    }

    const now = Date.now();
    await ctx.db.patch(run._id, {
      status: "queued",
      attempt: run.attempt + 1,
      cursor: undefined,
      sourceDone: false,
      pageCount: 0,
      affectedCount: 0,
      alreadyCurrentCount: 0,
      scheduledCount: 0,
      readyCount: 0,
      failureCount: 0,
      batchCount: 0,
      failures: [],
      lastError: undefined,
      completedAt: undefined,
      ...(args.requestedBy?.trim()
        ? { requestedBy: args.requestedBy.trim() }
        : {}),
      updatedAt: now,
    });
    await patchProposalRecomputeState(ctx, run.proposalId, {
      applicationState: "recompute_pending",
      updatedAt: now,
    });
    return ctx.db.get(run._id);
  },
});

// ---------------------------------------------------------------------------
// Targeted industry-evidence research request queue.
// ---------------------------------------------------------------------------

export const enqueueIndustryEvidenceResearchRequest = mutation({
  args: {
    writeSecret: v.optional(v.string()),
    workspaceSlug: v.string(),
    proposalId: v.string(),
    origin: industryResearchOriginValidator,
    requestedBy: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    requireWriteSecret(args.writeSecret);
    const workspaceSlug = normalizeWorkspaceSlug(args.workspaceSlug);
    const proposalId = args.proposalId.trim();
    if (!proposalId) throw new Error("Research request requires a proposalId");
    const proposal = await findIndustryProposal(ctx, proposalId);
    if (!proposal) throw new Error(`Unknown proposalId: ${proposalId}`);
    if (!REQUESTABLE_RESEARCH_PROPOSAL_STATUSES.has(proposal.status)) {
      throw new Error(`Proposal is not requestable: ${proposal.status}`);
    }

    const now = Date.now();
    const incomingPriority = researchPriorityForOrigin(args.origin);
    const rows = await listIndustryResearchRequestsForWorkspaceProposal(
      ctx,
      workspaceSlug,
      proposalId,
    );
    const active = rows
      .filter((row: any) => ACTIVE_RESEARCH_REQUEST_STATES.has(row.state))
      .sort((left: any, right: any) => right.updatedAt - left.updatedAt)[0];
    if (active) {
      const nextPriority = Math.max(active.priority, incomingPriority);
      const nextState = active.state === "retry_wait" ? "queued" : active.state;
      await ctx.db.patch(active._id, {
        origin:
          nextPriority > active.priority ? args.origin : active.origin,
        priority: nextPriority,
        state: nextState,
        demandCount: active.demandCount + 1,
        ...(nextState === "queued" ? { nextAttemptAt: undefined } : {}),
        updatedAt: now,
      });
      return {
        ...safeResearchRequestSummary({
          ...active,
          origin: nextPriority > active.priority ? args.origin : active.origin,
          priority: nextPriority,
          state: nextState,
          demandCount: active.demandCount + 1,
          updatedAt: now,
        }),
        created: false,
        disposition: nextPriority > active.priority ? "reprioritized" : "already_queued",
      };
    }

    const workspaceActiveRows = await ctx.db
      .query("industry_evidence_research_requests")
      .withIndex("by_workspace_created", (q: any) => q.eq("workspaceSlug", workspaceSlug))
      .collect();
    const workspaceActiveCount = workspaceActiveRows.filter((row: any) =>
      ACTIVE_RESEARCH_REQUEST_STATES.has(row.state),
    ).length;
    if (workspaceActiveCount >= MAX_ACTIVE_RESEARCH_REQUESTS_PER_WORKSPACE) {
      throw new Error("Industry research workspace queue limit reached");
    }
    const globalQueuedRows = await ctx.db
      .query("industry_evidence_research_requests")
      .withIndex("by_state", (q: any) => q.eq("state", "queued"))
      .collect();
    if (globalQueuedRows.length >= MAX_ACTIVE_RESEARCH_REQUESTS_GLOBAL) {
      throw new Error("Industry research global queue limit reached");
    }

    const requestId = `industry-research-${workspaceSlug}-${proposalId}-${now}-${Math.random().toString(36).slice(2, 8)}`;
    await ctx.db.insert("industry_evidence_research_requests", {
      requestId,
      workspaceSlug,
      proposalId,
      origin: args.origin,
      state: "queued",
      priority: incomingPriority,
      requestedAt: now,
      ...(args.requestedBy?.trim() ? { requestedBy: args.requestedBy.trim() } : {}),
      demandCount: 1,
      attemptCount: 0,
      createdAt: now,
      updatedAt: now,
    });
    return {
      requestId,
      proposalId,
      origin: args.origin,
      state: "queued" as const,
      priority: incomingPriority,
      requestedAt: now,
      demandCount: 1,
      attemptCount: 0,
      updatedAt: now,
      canRetry: false,
      canCancel: true,
      created: true,
      disposition: "created" as const,
    };
  },
});

/**
 * Bounded background producer for the low-priority scheduled lane. It only
 * materializes requests for open proposals that currently have no active
 * request and stops at a small fixed cap; user-originated requests always
 * retain their higher priority and are never rewritten here.
 */
export const enqueueScheduledIndustryEvidenceResearchSweep = mutation({
  args: {
    writeSecret: v.optional(v.string()),
    workspaceSlug: v.string(),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    requireWriteSecret(args.writeSecret);
    const workspaceSlug = normalizeWorkspaceSlug(args.workspaceSlug);
    const limit = Math.min(
      MAX_SCHEDULED_RESEARCH_PRODUCE,
      Math.max(1, Math.floor(args.limit ?? MAX_SCHEDULED_RESEARCH_PRODUCE)),
    );
    const proposalsById = new Map<string, any>();
    for (const status of ["new", "researching", "needs_more_evidence"] as const) {
      const rows = await ctx.db
        .query("company_industry_review_proposals")
        .withIndex("by_status_priority", (q: any) => q.eq("status", status))
        .collect();
      for (const row of rows) {
        if (row.proposalId) proposalsById.set(row.proposalId, row);
      }
    }
    const proposals = [...proposalsById.values()]
      .sort((left: any, right: any) =>
        (right.priority ?? 0) - (left.priority ?? 0) ||
        String(left.proposalId).localeCompare(String(right.proposalId)),
      )
      .slice(0, limit * 3);
    const activeRows = await ctx.db
      .query("industry_evidence_research_requests")
      .withIndex("by_workspace_created", (q: any) => q.eq("workspaceSlug", workspaceSlug))
      .collect();
    const activeProposalIds = new Set(
      activeRows
        .filter((row: any) => ACTIVE_RESEARCH_REQUEST_STATES.has(row.state))
        .map((row: any) => row.proposalId),
    );
    const created: Array<{ requestId: string; proposalId: string }> = [];
    const now = Date.now();
    const globalQueuedCount = (await ctx.db
      .query("industry_evidence_research_requests")
      .withIndex("by_state", (q: any) => q.eq("state", "queued"))
      .collect()).length;
    if (globalQueuedCount >= MAX_ACTIVE_RESEARCH_REQUESTS_GLOBAL) {
      return { created, limit, capped: true };
    }
    for (const proposal of proposals) {
      if (created.length >= limit || activeProposalIds.has(proposal.proposalId)) continue;
      if (activeRows.filter((row: any) => ACTIVE_RESEARCH_REQUEST_STATES.has(row.state)).length + created.length >= MAX_ACTIVE_RESEARCH_REQUESTS_PER_WORKSPACE) break;
      if (globalQueuedCount + created.length >= MAX_ACTIVE_RESEARCH_REQUESTS_GLOBAL) break;
      const requestId = `industry-scheduled-${workspaceSlug}-${proposal.proposalId}-${now}-${created.length}`;
      await ctx.db.insert("industry_evidence_research_requests", {
        requestId,
        workspaceSlug,
        proposalId: proposal.proposalId,
        origin: "scheduled_sweep",
        state: "queued",
        priority: INDUSTRY_RESEARCH_ORIGIN_PRIORITIES.scheduled_sweep,
        requestedAt: now,
        demandCount: 1,
        attemptCount: 0,
        createdAt: now,
        updatedAt: now,
      });
      activeProposalIds.add(proposal.proposalId);
      created.push({ requestId, proposalId: proposal.proposalId });
    }
    return { created, limit, capped: globalQueuedCount + created.length >= MAX_ACTIVE_RESEARCH_REQUESTS_GLOBAL };
  },
});

export const getIndustryEvidenceResearchRequestSummary = query({
  args: {
    writeSecret: v.optional(v.string()),
    workspaceSlug: v.string(),
    proposalId: v.string(),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    requireReadSecret(args.writeSecret);
    const rows = await listIndustryResearchRequestsForWorkspaceProposal(
      ctx,
      normalizeWorkspaceSlug(args.workspaceSlug),
      args.proposalId.trim(),
    );
    rows.sort((left: any, right: any) => right.updatedAt - left.updatedAt);
    const limit = Math.min(20, Math.max(1, Math.floor(args.limit ?? 10)));
    const active = rows.find((row: any) => ACTIVE_RESEARCH_REQUEST_STATES.has(row.state));
    return {
      active: active ? safeResearchRequestSummary(active) : null,
      history: rows.slice(0, limit).map((row: any) => safeResearchRequestSummary(row)),
    };
  },
});

export const listIndustryEvidenceResearchRequests = query({
  args: {
    writeSecret: v.optional(v.string()),
    workspaceSlug: v.string(),
    state: v.optional(industryResearchStateValidator),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    requireReadSecret(args.writeSecret);
    const workspaceSlug = normalizeWorkspaceSlug(args.workspaceSlug);
    const rows = await ctx.db
      .query("industry_evidence_research_requests")
      .withIndex("by_workspace_created", (q: any) => q.eq("workspaceSlug", workspaceSlug))
      .collect();
    const filtered = args.state ? rows.filter((row: any) => row.state === args.state) : rows;
    filtered.sort((left: any, right: any) => right.updatedAt - left.updatedAt);
    const limit = Math.min(100, Math.max(1, Math.floor(args.limit ?? 50)));
    return filtered.slice(0, limit).map((row: any) => safeResearchRequestSummary(row));
  },
});

async function claimIndustryEvidenceResearchRequestsInternal(
  ctx: { db: any },
  args: {
    writeSecret?: string;
    runId: string;
    workspaceSlug?: string;
    requestIds?: string[];
    proposalIds?: string[];
    limit?: number;
    leaseId?: string;
    leaseMs?: number;
  },
) {
  const now = Date.now();
  const limit = Math.min(
    MAX_RESEARCH_REQUEST_BATCH,
    Math.max(1, Math.floor(args.limit ?? 10)),
  );
  const requestIdSet = new Set((args.requestIds ?? []).map((id) => id.trim()).filter(Boolean));
  const proposalIdSet = new Set((args.proposalIds ?? []).map((id) => id.trim()).filter(Boolean));
  const rows = await ctx.db.query("industry_evidence_research_requests").collect();
  const candidates = rows.filter((row: any) => {
    if (!ACTIVE_RESEARCH_REQUEST_STATES.has(row.state) || row.state === "leased") return false;
    if (row.state === "retry_wait" && row.nextAttemptAt !== undefined && row.nextAttemptAt > now) {
      return false;
    }
    if (args.workspaceSlug && row.workspaceSlug !== normalizeWorkspaceSlug(args.workspaceSlug)) return false;
    if (requestIdSet.size > 0 && !requestIdSet.has(row.requestId)) return false;
    if (proposalIdSet.size > 0 && !proposalIdSet.has(row.proposalId)) return false;
    return true;
  });
  const effectivePriority = (row: any): number => {
    const aging = row.origin === "scheduled_sweep"
      ? Math.min(
          20,
          Math.max(0, Math.floor((now - row.requestedAt) / SCHEDULED_RESEARCH_AGING_HOUR_MS)),
        )
      : 0;
    return row.priority + aging;
  };
  candidates.sort(
    (left: any, right: any) =>
      effectivePriority(right) - effectivePriority(left) ||
      left.requestedAt - right.requestedAt ||
      left.requestId.localeCompare(right.requestId),
  );

  const selectedProposalIds: string[] = [];
  const selected = new Set<string>();
  for (const row of candidates) {
    if (selected.has(row.proposalId)) continue;
    if (selectedProposalIds.length >= limit) break;
    selected.add(row.proposalId);
    selectedProposalIds.push(row.proposalId);
  }
  const selectedRows = candidates.filter((row: any) => selected.has(row.proposalId));
  const leaseBase = args.leaseId?.trim() || `lease-${args.runId}-${now}`;
  const leaseMs = Math.min(
    15 * 60 * 1_000,
    Math.max(30_000, Math.floor(args.leaseMs ?? DEFAULT_RESEARCH_LEASE_MS)),
  );
  const requests: Array<{ requestId: string; proposalId: string; leaseId: string }> = [];
  for (const [index, row] of selectedRows.entries()) {
    const leaseId = `${leaseBase}-${index}`;
    await ctx.db.patch(row._id, {
      state: "leased",
      leaseId,
      leaseExpiresAt: now + leaseMs,
      attemptCount: row.attemptCount + 1,
      lastRunId: args.runId.trim(),
      nextAttemptAt: undefined,
      updatedAt: now,
    });
    requests.push({ requestId: row.requestId, proposalId: row.proposalId, leaseId });
  }
  return {
    runId: args.runId.trim(),
    proposalIds: selectedProposalIds,
    requests,
  };
}

export const claimIndustryEvidenceResearchRequests = mutation({
  args: {
    writeSecret: v.optional(v.string()),
    runId: v.string(),
    workspaceSlug: v.optional(v.string()),
    requestIds: v.optional(v.array(v.string())),
    proposalIds: v.optional(v.array(v.string())),
    limit: v.optional(v.number()),
    leaseId: v.optional(v.string()),
    leaseMs: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    requireWriteSecret(args.writeSecret);
    return claimIndustryEvidenceResearchRequestsInternal(ctx, args);
  },
});

export const startAndClaimIndustryEvidenceMaintenanceRun = mutation({
  args: {
    writeSecret: v.optional(v.string()),
    runId: v.string(),
    workspaceSlug: v.string(),
    triggerSource: v.union(
      v.literal("schedule"),
      v.literal("restore"),
      v.literal("approval"),
      v.literal("manual"),
    ),
    triggerContext: v.optional(v.string()),
    mode: industryMaintenanceRunModeValidator,
    requestIds: v.optional(v.array(v.string())),
    proposalIds: v.optional(v.array(v.string())),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    requireWriteSecret(args.writeSecret);
    const runId = args.runId.trim();
    const workspaceSlug = normalizeWorkspaceSlug(args.workspaceSlug);
    if (!runId) throw new Error("Industry maintenance run requires a runId");
    const targetedLimit = args.mode === "targeted"
      ? Math.min(
          MAX_RESEARCH_REQUEST_BATCH,
          Math.max(1, args.limit ?? args.requestIds?.length ?? args.proposalIds?.length ?? 1),
        )
      : args.limit;
    const claimArgs = { ...args, limit: targetedLimit };
    const existing = await findIndustryMaintenanceRun(ctx, runId);
    if (existing) {
      const claimed = await claimIndustryEvidenceResearchRequestsInternal(ctx, claimArgs);
      return { ...claimed, created: false };
    }
    await ctx.db.insert("industry_maintenance_runs", {
      runId,
      workspaceSlug,
      triggerSource: args.triggerSource,
      ...(args.triggerContext?.trim() ? { triggerContext: args.triggerContext.trim() } : {}),
      mode: args.mode,
      claimedRequestCount: 0,
      targetProposalCount: 0,
      status: "queued",
    });
    const claimed = await claimIndustryEvidenceResearchRequestsInternal(ctx, claimArgs);
    const run = await findIndustryMaintenanceRun(ctx, runId);
    if (run) {
      await ctx.db.patch(run._id, {
        claimedRequestCount: claimed.requests.length,
        targetProposalCount: claimed.proposalIds.length,
      });
    }
    return { ...claimed, created: true };
  },
});

export const renewIndustryEvidenceResearchRequestLease = mutation({
  args: {
    writeSecret: v.optional(v.string()),
    requestId: v.string(),
    leaseId: v.string(),
    leaseMs: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    requireWriteSecret(args.writeSecret);
    const request = await findIndustryResearchRequest(ctx, args.requestId.trim());
    if (!request || request.state !== "leased" || request.leaseId !== args.leaseId.trim()) {
      return { renewed: false };
    }
    const leaseMs = Math.min(
      15 * 60 * 1_000,
      Math.max(30_000, Math.floor(args.leaseMs ?? DEFAULT_RESEARCH_LEASE_MS)),
    );
    const leaseExpiresAt = Date.now() + leaseMs;
    await ctx.db.patch(request._id, { leaseExpiresAt, updatedAt: Date.now() });
    return { renewed: true, requestId: request.requestId, leaseExpiresAt };
  },
});

export const completeIndustryEvidenceResearchRequest = mutation({
  args: {
    writeSecret: v.optional(v.string()),
    requestId: v.string(),
    leaseId: v.string(),
    runId: v.optional(v.string()),
    state: v.union(
      v.literal("completed"),
      v.literal("needs_identity_review"),
      v.literal("needs_more_evidence"),
      v.literal("failed"),
      v.literal("cancelled"),
    ),
    outcome: v.string(),
    failureCode: v.optional(industryResearchFailureCodeValidator),
  },
  handler: async (ctx, args) => {
    requireWriteSecret(args.writeSecret);
    const request = await findIndustryResearchRequest(ctx, args.requestId.trim());
    if (!request) throw new Error(`Unknown research request: ${args.requestId}`);
    if (request.state !== "leased" || request.leaseId !== args.leaseId.trim()) {
      return { completed: false, reason: "lease_mismatch" };
    }
    const now = Date.now();
    await ctx.db.patch(request._id, {
      state: args.state,
      ...(args.runId?.trim() ? { lastRunId: args.runId.trim() } : {}),
      lastOutcome: args.outcome.trim().slice(0, 300),
      ...(args.failureCode ? { lastErrorCode: args.failureCode } : {}),
      leaseId: undefined,
      leaseExpiresAt: undefined,
      nextAttemptAt: undefined,
      updatedAt: now,
    });
    return { completed: true, requestId: request.requestId, state: args.state };
  },
});

export const releaseIndustryEvidenceResearchRequests = mutation({
  args: {
    writeSecret: v.optional(v.string()),
    runId: v.string(),
    requests: v.array(v.object({ requestId: v.string(), leaseId: v.string() })),
    failureCode: industryResearchFailureCodeValidator,
    outcome: v.string(),
  },
  handler: async (ctx, args) => {
    requireWriteSecret(args.writeSecret);
    const now = Date.now();
    const updated: string[] = [];
    for (const item of args.requests.slice(0, MAX_RESEARCH_REQUEST_BATCH)) {
      const request = await findIndustryResearchRequest(ctx, item.requestId.trim());
      if (
        !request ||
        request.state !== "leased" ||
        request.leaseId !== item.leaseId.trim() ||
        request.lastRunId !== args.runId.trim()
      ) {
        continue;
      }
      const attempt = request.attemptCount;
      const terminal = attempt >= MAX_RESEARCH_ATTEMPTS;
      const backoffMs = Math.min(30 * 60 * 1_000, 30_000 * 2 ** Math.max(0, attempt - 1));
      await ctx.db.patch(request._id, {
        state: terminal ? "failed" : "retry_wait",
        nextAttemptAt: terminal ? undefined : now + backoffMs,
        lastOutcome: args.outcome.trim().slice(0, 300),
        lastErrorCode: args.failureCode,
        leaseId: undefined,
        leaseExpiresAt: undefined,
        updatedAt: now,
      });
      updated.push(request.requestId);
    }
    return { updated };
  },
});

export const recoverExpiredIndustryEvidenceResearchLeases = mutation({
  args: {
    writeSecret: v.optional(v.string()),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    requireWriteSecret(args.writeSecret);
    const now = Date.now();
    const limit = Math.min(MAX_RESEARCH_REQUEST_BATCH, Math.max(1, Math.floor(args.limit ?? 20)));
    const rows = await ctx.db
      .query("industry_evidence_research_requests")
      .withIndex("by_lease_expiry", (q: any) => q.eq("state", "leased"))
      .collect();
    const recovered: string[] = [];
    for (const request of rows
      .filter((row: any) => row.leaseExpiresAt !== undefined && row.leaseExpiresAt <= now)
      .sort((left: any, right: any) => (left.leaseExpiresAt ?? 0) - (right.leaseExpiresAt ?? 0))
      .slice(0, limit)) {
      const terminal = request.attemptCount >= MAX_RESEARCH_ATTEMPTS;
      await ctx.db.patch(request._id, {
        state: terminal ? "failed" : "retry_wait",
        nextAttemptAt: terminal ? undefined : now + 30_000,
        lastOutcome: "lease expired before research completed",
        lastErrorCode: "timeout",
        leaseId: undefined,
        leaseExpiresAt: undefined,
        updatedAt: now,
      });
      recovered.push(request.requestId);
    }
    return { recovered };
  },
});

export const retryIndustryEvidenceResearchRequest = mutation({
  args: {
    writeSecret: v.optional(v.string()),
    workspaceSlug: v.string(),
    proposalId: v.string(),
    requestId: v.string(),
  },
  handler: async (ctx, args) => {
    requireWriteSecret(args.writeSecret);
    const request = await findIndustryResearchRequest(ctx, args.requestId.trim());
    if (
      !request ||
      request.workspaceSlug !== normalizeWorkspaceSlug(args.workspaceSlug) ||
      request.proposalId !== args.proposalId.trim()
    ) {
      throw new Error("Unknown research request");
    }
    if (!(request.state === "failed" || request.state === "retry_wait" || request.state === "needs_more_evidence")) {
      throw new Error(`Research request is not retryable: ${request.state}`);
    }
    if (request.attemptCount >= MAX_RESEARCH_ATTEMPTS) {
      throw new Error("Research request retry limit reached");
    }
    await ctx.db.patch(request._id, {
      state: "queued",
      nextAttemptAt: undefined,
      lastErrorCode: undefined,
      updatedAt: Date.now(),
    });
    return { requestId: request.requestId, state: "queued" as const };
  },
});

export const cancelIndustryEvidenceResearchRequest = mutation({
  args: {
    writeSecret: v.optional(v.string()),
    workspaceSlug: v.string(),
    proposalId: v.string(),
    requestId: v.string(),
  },
  handler: async (ctx, args) => {
    requireWriteSecret(args.writeSecret);
    const request = await findIndustryResearchRequest(ctx, args.requestId.trim());
    if (
      !request ||
      request.workspaceSlug !== normalizeWorkspaceSlug(args.workspaceSlug) ||
      request.proposalId !== args.proposalId.trim()
    ) {
      throw new Error("Unknown research request");
    }
    if (!ACTIVE_RESEARCH_REQUEST_STATES.has(request.state)) {
      return { requestId: request.requestId, state: request.state, cancelled: false };
    }
    await ctx.db.patch(request._id, {
      state: "cancelled",
      leaseId: undefined,
      leaseExpiresAt: undefined,
      nextAttemptAt: undefined,
      lastOutcome: "cancelled by administrator",
      updatedAt: Date.now(),
    });
    return { requestId: request.requestId, state: "cancelled" as const, cancelled: true };
  },
});

export const upsertIndustryIdentityCandidate = mutation({
  args: {
    writeSecret: v.optional(v.string()),
    proposalId: v.string(),
    candidateFingerprint: v.string(),
    normalizedLegalName: v.string(),
    jurisdiction: v.optional(v.string()),
    registrationNumber: v.optional(v.string()),
    sourceIds: v.array(v.string()),
    confidence: v.number(),
    conflictCodes: v.array(v.string()),
    extractionVersion: v.string(),
  },
  handler: async (ctx, args) => {
    requireWriteSecret(args.writeSecret);
    const proposalId = args.proposalId.trim();
    const proposal = await findIndustryProposal(ctx, proposalId);
    if (!proposal) throw new Error(`Unknown proposalId: ${proposalId}`);
    const candidateFingerprint = args.candidateFingerprint.trim();
    const normalizedLegalName = args.normalizedLegalName.trim();
    const sourceIds = [...new Set(args.sourceIds.map((sourceId) => sourceId.trim()).filter(Boolean))].slice(0, 20);
    if (sourceIds.length === 0) {
      throw new Error("Identity resolution requires at least one evidence source");
    }
    if (!candidateFingerprint || !normalizedLegalName || sourceIds.length === 0) {
      throw new Error("Identity candidate requires name, fingerprint, and sourceIds");
    }
    for (const sourceId of sourceIds) {
      const source = await findIndustryEvidenceSource(ctx, sourceId);
      if (
        !source ||
        source.proposalId !== proposalId ||
        source.fetchStatus !== "fetched" ||
        source.sourceState !== "active" ||
        source.sourceType === "search_result" ||
        source.trustTier === "discovery"
      ) {
        throw new Error(`Identity source is not an allowed fetched proposal source: ${sourceId}`);
      }
    }
    const now = Date.now();
    const existing = await ctx.db
      .query("company_identity_candidates")
      .withIndex("by_proposal_fingerprint", (q: any) =>
        q.eq("proposalId", proposalId).eq("candidateFingerprint", candidateFingerprint),
      )
      .collect();
    const material = {
      normalizedLegalName,
      ...(args.jurisdiction?.trim() ? { jurisdiction: args.jurisdiction.trim() } : {}),
      ...(args.registrationNumber?.trim() ? { registrationNumber: args.registrationNumber.trim() } : {}),
      sourceIds,
      confidence: Math.max(0, Math.min(1, args.confidence)),
      conflictCodes: [...new Set(args.conflictCodes.map((code) => code.trim()).filter(Boolean))].slice(0, 20),
      extractionVersion: args.extractionVersion.trim().slice(0, 80) || "unknown",
      updatedAt: now,
    };
    if (existing[0]) {
      await ctx.db.patch(existing[0]._id, material);
      return { candidateFingerprint, created: false };
    }
    await ctx.db.insert("company_identity_candidates", {
      candidateFingerprint,
      proposalId,
      ...material,
      reviewState: "candidate",
      createdAt: now,
    });
    return { candidateFingerprint, created: true };
  },
});

export const listIndustryIdentityCandidates = query({
  args: {
    writeSecret: v.optional(v.string()),
    proposalId: v.string(),
  },
  handler: async (ctx, args) => {
    requireReadSecret(args.writeSecret);
    const rows = await ctx.db
      .query("company_identity_candidates")
      .withIndex("by_proposal", (q: any) => q.eq("proposalId", args.proposalId.trim()))
      .collect();
    rows.sort((left: any, right: any) => right.confidence - left.confidence || right.updatedAt - left.updatedAt);
    return rows;
  },
});

export const resolveIndustryProposalIdentity = mutation({
  args: {
    writeSecret: v.optional(v.string()),
    workspaceSlug: v.string(),
    actor: v.string(),
    proposalId: v.string(),
    expectedProposalUpdatedAt: v.number(),
    candidateFingerprint: v.string(),
    mappingMode: identityMappingModeValidator,
    companyKey: v.optional(v.string()),
    provisionalDisplayName: v.optional(v.string()),
    provisionalAlias: v.optional(v.string()),
    sourceIds: v.array(v.string()),
    reviewNote: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    requireWriteSecret(args.writeSecret);
    const actor = args.actor.trim();
    const workspaceSlug = normalizeWorkspaceSlug(args.workspaceSlug);
    const proposalId = args.proposalId.trim();
    if (!actor) throw new Error("Identity resolution actor is required");
    const proposal = await findIndustryProposal(ctx, proposalId);
    if (!proposal) throw new Error(`Unknown proposalId: ${proposalId}`);
    if (!REQUESTABLE_RESEARCH_PROPOSAL_STATUSES.has(proposal.status)) {
      throw new Error(`Proposal is not open for identity resolution: ${proposal.status}`);
    }
    assertExpectedIndustryProposalUpdatedAt(proposal, args.expectedProposalUpdatedAt);
    const candidateRows = await ctx.db
      .query("company_identity_candidates")
      .withIndex("by_proposal_fingerprint", (q: any) =>
        q.eq("proposalId", proposalId).eq("candidateFingerprint", args.candidateFingerprint.trim()),
      )
      .collect();
    const candidate = candidateRows[0];
    if (!candidate || candidate.reviewState === "rejected") {
      throw new Error("Identity candidate is unavailable for resolution");
    }
    const sourceIds = [...new Set(args.sourceIds.map((sourceId) => sourceId.trim()).filter(Boolean))].slice(0, 20);
    const candidateSourceIds = new Set(candidate.sourceIds);
    if (sourceIds.some((sourceId) => !candidateSourceIds.has(sourceId))) {
      throw new Error("Identity source is not attached to the selected candidate");
    }
    const now = Date.now();
    let targetCompanyKey = "";
    if (args.mappingMode === "existing") {
      targetCompanyKey = normalizeCompanyKey(args.companyKey ?? "");
      if (!targetCompanyKey) throw new Error("Existing identity mapping requires companyKey");
      const targetRows = await ctx.db
        .query("companies")
        .withIndex("by_company_key", (q: any) => q.eq("companyKey", targetCompanyKey))
        .collect();
      if (!targetRows[0] || targetRows[0].status === "merged") {
        throw new Error("Target canonical company is unavailable");
      }
    } else {
      targetCompanyKey = `candidate-${candidate.candidateFingerprint.slice(0, 24)}`;
      const displayName = (args.provisionalDisplayName?.trim() || candidate.normalizedLegalName).slice(0, 200);
      const existingRows = await ctx.db
        .query("companies")
        .withIndex("by_company_key", (q: any) => q.eq("companyKey", targetCompanyKey))
        .collect();
      if (!existingRows[0]) {
        await ctx.db.insert("companies", {
          companyKey: targetCompanyKey,
          status: "provisional",
          displayName,
          nameEn: displayName,
          createdAt: now,
          updatedAt: now,
          createdBy: actor,
        });
      }
      const aliasDisplay = (args.provisionalAlias?.trim() || candidate.normalizedLegalName).slice(0, 200);
      const aliasNormalized = normalizeCompanyAlias(aliasDisplay);
      if (aliasNormalized) {
        const aliases = await ctx.db
          .query("company_aliases")
          .withIndex("by_alias", (q: any) => q.eq("aliasNormalized", aliasNormalized))
          .collect();
        if (aliases[0] && aliases[0].companyKey !== targetCompanyKey) {
          throw new Error("Provisional identity alias is already mapped to another company");
        }
        if (!aliases[0]) {
          await ctx.db.insert("company_aliases", {
            companyKey: targetCompanyKey,
            aliasNormalized,
            aliasDisplay,
            source: "operator",
            createdAt: now,
          });
        }
      }
    }

    for (const sourceId of sourceIds) {
      const source = await findIndustryEvidenceSource(ctx, sourceId);
      if (
        !source ||
        source.proposalId !== proposalId ||
        source.fetchStatus !== "fetched" ||
        source.sourceState !== "active" ||
        source.sourceType === "search_result" ||
        source.trustTier === "discovery"
      ) {
        throw new Error("Identity source changed or is not an allowed fetched source");
      }
      if (source.companyKey && source.companyKey !== targetCompanyKey) {
        throw new Error("Identity source is already attached to another company");
      }
      await ctx.db.patch(source._id, {
        companyKey: targetCompanyKey,
        proposalId,
        updatedAt: now,
      });
    }
    await ctx.db.patch(proposal._id, {
      companyKey: targetCompanyKey,
      reviewedBy: actor,
      ...(args.reviewNote?.trim() ? { reviewNote: args.reviewNote.trim().slice(0, 800) } : {}),
      updatedAt: now,
    });
    await ctx.db.patch(candidate._id, { reviewState: "reviewed", updatedAt: now });
    const pendingRequests = await ctx.db
      .query("industry_evidence_research_requests")
      .withIndex("by_workspace_created", (q: any) => q.eq("workspaceSlug", workspaceSlug))
      .collect();
    for (const request of pendingRequests.filter(
      (row: any) => row.proposalId === proposalId && row.state === "needs_identity_review",
    )) {
      await ctx.db.patch(request._id, {
        state: "completed",
        lastOutcome: "identity mapped by administrator",
        updatedAt: now,
      });
    }
    const auditId = `industry-identity-${proposalId}-${now}-${candidate.candidateFingerprint.slice(0, 8)}`;
    await ctx.db.insert("industry_identity_resolution_audits", {
      auditId,
      proposalId,
      workspaceSlug,
      actor,
      candidateFingerprint: candidate.candidateFingerprint,
      mappingMode: args.mappingMode,
      targetCompanyKey,
      sourceIds,
      previousProposalUpdatedAt: args.expectedProposalUpdatedAt,
      ...(args.reviewNote?.trim() ? { reviewNote: args.reviewNote.trim().slice(0, 800) } : {}),
      createdAt: now,
    });
    return { proposalId, companyKey: targetCompanyKey, auditId };
  },
});

export const attachProposalToCompany = mutation({
  args: {
    proposalId: v.string(),
    companyKey: v.string(),
    sourceCompanyKey: v.optional(v.string()),
    writeSecret: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    requireWriteSecret(args.writeSecret);
    const proposal = await findIndustryProposal(ctx, args.proposalId.trim());
    if (!proposal) throw new Error(`Unknown proposalId: ${args.proposalId}`);
    const companyKey = normalizeCompanyKey(args.companyKey);
    const sources = await ctx.db
      .query("company_industry_evidence_sources")
      .withIndex("by_proposal", (q) => q.eq("proposalId", proposal.proposalId))
      .collect();
    const extraSources = args.sourceCompanyKey
      ? (
          await ctx.db
            .query("company_industry_evidence_sources")
            .withIndex("by_company_review", (q) =>
              q.eq("companyKey", args.sourceCompanyKey),
            )
            .collect()
        )
      : [];
    const now = Date.now();
    await ctx.db.patch(proposal._id, { companyKey, updatedAt: now });
    const seen = new Set<string>();
    let patchedSources = 0;
    for (const source of [...sources, ...extraSources]) {
      if (seen.has(source._id)) continue;
      seen.add(source._id);
      await ctx.db.patch(source._id, {
        companyKey,
        proposalId: proposal.proposalId,
        updatedAt: now,
      });
      patchedSources += 1;
    }
    return { proposalId: proposal.proposalId, companyKey, patchedSources };
  },
});

// ---------------------------------------------------------------------------
// Industry evidence maintenance run registry + per-proposal ledger.
// Mirrors the recompute-run architecture: the worker writes runs/ledger rows
// during maintenance; the API pipeline + admin UI read them. All writes are
// write-secret gated; reads are read-secret gated. Ledger writes from the
// worker are best-effort (observability never aborts maintenance).
// ---------------------------------------------------------------------------

async function findIndustryMaintenanceRun(ctx: { db: any }, runId: string) {
  const rows = await ctx.db.query("industry_maintenance_runs").collect();
  return rows.find((r: any) => r.runId === runId) ?? null;
}

export const startIndustryMaintenanceRun = mutation({
  args: {
    writeSecret: v.optional(v.string()),
    runId: v.string(),
    workspaceSlug: v.string(),
    triggerSource: v.union(
      v.literal("schedule"),
      v.literal("restore"),
      v.literal("approval"),
      v.literal("manual"),
    ),
    triggerContext: v.optional(v.string()),
    mode: v.optional(industryMaintenanceRunModeValidator),
    claimedRequestCount: v.optional(v.number()),
    targetProposalCount: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    requireWriteSecret(args.writeSecret);
    const runId = args.runId.trim();
    if (!runId) throw new Error("Industry maintenance run requires a runId");
    const workspaceSlug = normalizeWorkspaceSlug(args.workspaceSlug);

    const id = await ctx.db.insert("industry_maintenance_runs", {
      runId,
      workspaceSlug,
      triggerSource: args.triggerSource,
      ...(args.triggerContext?.trim()
        ? { triggerContext: args.triggerContext.trim() }
        : {}),
      ...(args.mode ? { mode: args.mode } : {}),
      ...(args.claimedRequestCount !== undefined
        ? { claimedRequestCount: Math.max(0, Math.floor(args.claimedRequestCount)) }
        : {}),
      ...(args.targetProposalCount !== undefined
        ? { targetProposalCount: Math.max(0, Math.floor(args.targetProposalCount)) }
        : {}),
      status: "queued",
    });
    void id;
    return { runId };
  },
});

export const claimNextIndustryMaintenanceRun = mutation({
  args: {
    writeSecret: v.optional(v.string()),
    runId: v.string(),
  },
  handler: async (ctx, args) => {
    requireWriteSecret(args.writeSecret);
    const runId = args.runId.trim();
    const run = await findIndustryMaintenanceRun(ctx, runId);
    if (!run || run.status !== "queued") return false;
    await ctx.db.patch(run._id, {
      status: "running",
      startedAt: Date.now(),
    });
    return true;
  },
});

export const patchIndustryMaintenanceRunContext = mutation({
  args: {
    writeSecret: v.optional(v.string()),
    runId: v.string(),
    triggerContext: v.string(),
  },
  handler: async (ctx, args) => {
    requireWriteSecret(args.writeSecret);
    const run = await findIndustryMaintenanceRun(ctx, args.runId.trim());
    if (!run) throw new Error(`Unknown industry maintenance run: ${args.runId}`);
    const next = args.triggerContext.trim();
    if (!next) return { runId: run.runId, triggerContext: run.triggerContext };
    const prior = run.triggerContext?.trim();
    const triggerContext = prior ? `${prior}; ${next}` : next;
    await ctx.db.patch(run._id, { triggerContext });
    return { runId: run.runId, triggerContext };
  },
});

export const appendIndustryMaintenanceLedger = mutation({
  args: {
    writeSecret: v.optional(v.string()),
    runId: v.string(),
    proposalId: v.string(),
    companyKey: v.optional(v.string()),
    action: v.union(
      v.literal("researched"),
      v.literal("ready"),
      v.literal("demoted"),
      v.literal("recycled"),
      v.literal("needs_more_evidence"),
      v.literal("freshness_ok"),
      v.literal("freshness_refreshed"),
      v.literal("error"),
    ),
    reason: v.string(),
    detail: v.optional(v.any()),
  },
  handler: async (ctx, args) => {
    requireWriteSecret(args.writeSecret);
    const runId = args.runId.trim();
    const proposalId = args.proposalId.trim();
    if (!runId || !proposalId) {
      throw new Error("Industry maintenance ledger requires runId and proposalId");
    }
    await ctx.db.insert("industry_maintenance_ledger", {
      runId,
      proposalId,
      ...(args.companyKey?.trim()
        ? { companyKey: args.companyKey.trim() }
        : {}),
      action: args.action,
      reason: args.reason,
      ...(args.detail !== undefined ? { detail: args.detail } : {}),
    });
    return { ok: true };
  },
});

export const finishIndustryMaintenanceRun = mutation({
  args: {
    writeSecret: v.optional(v.string()),
    runId: v.string(),
    status: v.union(
      v.literal("completed"),
      v.literal("failed"),
      v.literal("skipped"),
    ),
    counts: v.optional(v.any()),
    failureMessage: v.optional(v.string()),
    partial: v.optional(v.boolean()),
    operatorSummary: v.string(),
  },
  handler: async (ctx, args) => {
    requireWriteSecret(args.writeSecret);
    const runId = args.runId.trim();
    const run = await findIndustryMaintenanceRun(ctx, runId);
    if (!run) throw new Error(`Unknown industry maintenance run: ${runId}`);
    await ctx.db.patch(run._id, {
      status: args.status,
      finishedAt: Date.now(),
      ...(args.counts !== undefined ? { counts: args.counts } : {}),
      ...(args.failureMessage?.trim()
        ? { failureMessage: args.failureMessage.trim() }
        : {}),
      ...(args.partial !== undefined ? { partial: args.partial } : {}),
      operatorSummary: args.operatorSummary,
    });
    return { runId, status: args.status };
  },
});

export const listIndustryMaintenanceRuns = query({
  args: {
    writeSecret: v.optional(v.string()),
    workspaceSlug: v.string(),
    status: v.optional(
      v.union(
        v.literal("queued"),
        v.literal("running"),
        v.literal("completed"),
        v.literal("failed"),
        v.literal("skipped"),
      ),
    ),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    requireReadSecret(args.writeSecret);
    const workspaceSlug = normalizeWorkspaceSlug(args.workspaceSlug);
    const limit = Math.min(100, Math.max(1, Math.floor(args.limit ?? 20)));
    const rows = await ctx.db
      .query("industry_maintenance_runs")
      .withIndex("by_workspace_time", (q: any) =>
        q.eq("workspaceSlug", workspaceSlug),
      )
      .collect();
    const filtered = args.status
      ? rows.filter((r: any) => r.status === args.status)
      : rows;
    // Newest-first: prefer startedAt, fall back to _creationTime.
    filtered.sort(
      (left: any, right: any) =>
        (right.startedAt ?? right._creationTime) -
        (left.startedAt ?? left._creationTime),
    );
    return filtered.slice(0, limit);
  },
});

export const getIndustryMaintenanceRun = query({
  args: {
    writeSecret: v.optional(v.string()),
    runId: v.string(),
  },
  handler: async (ctx, args) => {
    requireReadSecret(args.writeSecret);
    return findIndustryMaintenanceRun(ctx, args.runId.trim());
  },
});

export const listIndustryMaintenanceLedger = query({
  args: {
    writeSecret: v.optional(v.string()),
    runId: v.optional(v.string()),
    proposalId: v.optional(v.string()),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    requireReadSecret(args.writeSecret);
    const runId = args.runId?.trim();
    const proposalId = args.proposalId?.trim();
    if (!runId && !proposalId) {
      throw new Error(
        "Industry maintenance ledger requires runId or proposalId",
      );
    }
    const limit = Math.min(500, Math.max(1, Math.floor(args.limit ?? 200)));
    const rows = runId
      ? await ctx.db
          .query("industry_maintenance_ledger")
          .withIndex("by_run", (q: any) => q.eq("runId", runId))
          .collect()
      : await ctx.db
          .query("industry_maintenance_ledger")
          .withIndex("by_proposal", (q: any) => q.eq("proposalId", proposalId))
          .collect();
    // Newest-first by creation time.
    rows.sort((left: any, right: any) => right._creationTime - left._creationTime);
    return rows.slice(0, limit);
  },
});

export const findActiveIndustryMaintenanceRun = query({
  args: {
    writeSecret: v.optional(v.string()),
    workspaceSlug: v.string(),
  },
  handler: async (ctx, args) => {
    requireReadSecret(args.writeSecret);
    const workspaceSlug = normalizeWorkspaceSlug(args.workspaceSlug);
    const rows = await ctx.db
      .query("industry_maintenance_runs")
      .withIndex("by_workspace_time", (q: any) =>
        q.eq("workspaceSlug", workspaceSlug),
      )
      .collect();
    const active = rows.filter(
      (r: any) => r.status === "queued" || r.status === "running",
    );
    if (active.length === 0) return null;
    active.sort(
      (left: any, right: any) =>
        (right.startedAt ?? right._creationTime) -
        (left.startedAt ?? left._creationTime),
    );
    return active[0];
  },
});

// ---------------------------------------------------------------------------
// Industry data admin: CRUD over industry_data_entries, an append-only
// industry_data_change_log with before/after snapshots, and the
// industryMaintenanceSchedulePaused system_settings flag. All writes are
// write-secret gated; reads are read-secret gated.
// ---------------------------------------------------------------------------

const INDUSTRY_MAINTENANCE_SCHEDULE_PAUSED_KEY =
  "industryMaintenanceSchedulePaused";

async function findIndustryDataEntry(ctx: { db: any }, entryId: string) {
  const rows = await ctx.db
    .query("industry_data_entries")
    .withIndex("by_entry_id", (q: any) => q.eq("entryId", entryId))
    .collect();
  return rows[0] ?? null;
}

export const upsertIndustryDataEntry = mutation({
  args: {
    writeSecret: v.optional(v.string()),
    entryType: v.union(
      v.literal("company"),
      v.literal("keyword"),
      v.literal("brand"),
      v.literal("url"),
    ),
    entryId: v.string(),
    data: v.any(),
    sortOrder: v.optional(v.number()),
    actor: v.string(),
  },
  handler: async (ctx, args) => {
    requireWriteSecret(args.writeSecret);
    const entryId = args.entryId.trim();
    if (!entryId) throw new Error("Industry data entry requires an entryId");
    const actor = args.actor.trim() || "unknown";
    const now = Date.now();

    const existing = await findIndustryDataEntry(ctx, entryId);
    if (existing) {
      await ctx.db.patch(existing._id, {
        entryType: args.entryType,
        data: args.data,
        ...(args.sortOrder !== undefined ? { sortOrder: args.sortOrder } : {}),
        updatedAt: now,
        updatedBy: actor,
      });
      return { entryId };
    }

    await ctx.db.insert("industry_data_entries", {
      entryType: args.entryType,
      entryId,
      data: args.data,
      ...(args.sortOrder !== undefined ? { sortOrder: args.sortOrder } : {}),
      createdAt: now,
      updatedAt: now,
      updatedBy: actor,
    });
    return { entryId };
  },
});

export const deleteIndustryDataEntry = mutation({
  args: {
    writeSecret: v.optional(v.string()),
    entryId: v.string(),
    actor: v.string(),
  },
  handler: async (ctx, args) => {
    requireWriteSecret(args.writeSecret);
    const entryId = args.entryId.trim();
    const entry = await findIndustryDataEntry(ctx, entryId);
    if (entry) {
      await ctx.db.delete(entry._id);
    }
    return { ok: true };
  },
});

export const listIndustryDataEntries = query({
  args: {
    writeSecret: v.optional(v.string()),
    entryType: v.optional(
      v.union(
        v.literal("company"),
        v.literal("keyword"),
        v.literal("brand"),
        v.literal("url"),
      ),
    ),
  },
  handler: async (ctx, args) => {
    requireReadSecret(args.writeSecret);
    if (args.entryType) {
      return ctx.db
        .query("industry_data_entries")
        .withIndex("by_type", (q: any) => q.eq("entryType", args.entryType))
        .collect();
    }
    return ctx.db.query("industry_data_entries").collect();
  },
});

export const getIndustryDataEntry = query({
  args: {
    writeSecret: v.optional(v.string()),
    entryId: v.string(),
  },
  handler: async (ctx, args) => {
    requireReadSecret(args.writeSecret);
    return findIndustryDataEntry(ctx, args.entryId.trim());
  },
});

export const appendIndustryDataChange = mutation({
  args: {
    writeSecret: v.optional(v.string()),
    changeId: v.string(),
    entryType: v.string(),
    entryId: v.string(),
    action: v.union(
      v.literal("create"),
      v.literal("update"),
      v.literal("delete"),
    ),
    actor: v.string(),
    before: v.optional(v.any()),
    after: v.optional(v.any()),
    companyKey: v.optional(v.string()),
    gitSha: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    requireWriteSecret(args.writeSecret);
    const changeId = args.changeId.trim();
    if (!changeId) {
      throw new Error("Industry data change log requires a changeId");
    }
    await ctx.db.insert("industry_data_change_log", {
      changeId,
      entryType: args.entryType,
      entryId: args.entryId,
      action: args.action,
      actor: args.actor,
      ...(args.before !== undefined ? { before: args.before } : {}),
      ...(args.after !== undefined ? { after: args.after } : {}),
      ...(args.companyKey?.trim()
        ? { companyKey: args.companyKey.trim() }
        : {}),
      ...(args.gitSha?.trim() ? { gitSha: args.gitSha.trim() } : {}),
      createdAt: Date.now(),
    });
    return { changeId };
  },
});

export const setIndustryDataChangeGitSha = mutation({
  args: {
    writeSecret: v.optional(v.string()),
    changeId: v.string(),
    gitSha: v.string(),
  },
  handler: async (ctx, args) => {
    requireWriteSecret(args.writeSecret);
    const changeId = args.changeId.trim();
    const rows = await ctx.db
      .query("industry_data_change_log")
      .collect();
    const change = rows.find((r: any) => r.changeId === changeId) ?? null;
    if (!change) {
      throw new Error(`Unknown industry data change: ${changeId}`);
    }
    await ctx.db.patch(change._id, { gitSha: args.gitSha.trim() });
    return { ok: true };
  },
});

export const listIndustryDataChanges = query({
  args: {
    writeSecret: v.optional(v.string()),
    entryType: v.optional(v.string()),
    entryId: v.optional(v.string()),
    companyKey: v.optional(v.string()),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    requireReadSecret(args.writeSecret);
    const limit = Math.min(200, Math.max(1, Math.floor(args.limit ?? 50)));
    const entryType = args.entryType?.trim();
    const entryId = args.entryId?.trim();
    const companyKey = args.companyKey?.trim();

    let rows;
    if (companyKey) {
      rows = await ctx.db
        .query("industry_data_change_log")
        .withIndex("by_company_key", (q: any) => q.eq("companyKey", companyKey))
        .collect();
    } else if (entryType && entryId) {
      rows = await ctx.db
        .query("industry_data_change_log")
        .withIndex("by_entry", (q: any) =>
          q.eq("entryType", entryType).eq("entryId", entryId),
        )
        .collect();
    } else {
      rows = await ctx.db.query("industry_data_change_log").collect();
    }

    if (entryType) {
      rows = rows.filter((r: any) => r.entryType === entryType);
    }
    if (entryId) {
      rows = rows.filter((r: any) => r.entryId === entryId);
    }
    if (companyKey) {
      rows = rows.filter((r: any) => r.companyKey === companyKey);
    }
    // Newest-first by createdAt; break ties with Convex _creationTime so
    // same-ms appends (common in fast tests) stay deterministic.
    rows.sort((left: any, right: any) => {
      const byCreated = right.createdAt - left.createdAt;
      if (byCreated !== 0) return byCreated;
      return (right._creationTime ?? 0) - (left._creationTime ?? 0);
    });
    return rows.slice(0, limit);
  },
});

export const setIndustryMaintenanceSchedulePaused = mutation({
  args: {
    writeSecret: v.optional(v.string()),
    paused: v.boolean(),
  },
  handler: async (ctx, args) => {
    requireWriteSecret(args.writeSecret);
    const existing = await ctx.db
      .query("system_settings")
      .withIndex("by_key", (q: any) =>
        q.eq("key", INDUSTRY_MAINTENANCE_SCHEDULE_PAUSED_KEY),
      )
      .unique();
    if (existing) {
      await ctx.db.patch(existing._id, {
        value: args.paused,
        updatedAt: Date.now(),
      });
    } else {
      await ctx.db.insert("system_settings", {
        key: INDUSTRY_MAINTENANCE_SCHEDULE_PAUSED_KEY,
        value: args.paused,
        updatedAt: Date.now(),
        updatedBy: "industry-data-admin",
      });
    }
    return { paused: args.paused };
  },
});

export const getIndustryMaintenanceSchedulePaused = query({
  args: {
    writeSecret: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    requireReadSecret(args.writeSecret);
    const row = await ctx.db
      .query("system_settings")
      .withIndex("by_key", (q: any) =>
        q.eq("key", INDUSTRY_MAINTENANCE_SCHEDULE_PAUSED_KEY),
      )
      .unique();
    return { paused: row?.value === true };
  },
});

/**
 * Operator coverage snapshot for Industry verification.
 * Aggregates proposal pipeline, open-proposal evidence fill, resume card
 * projection coverage, profile truth counts, and recent maintenance health.
 */
export const getIndustryCoverageSummary = query({
  args: {
    writeSecret: v.optional(v.string()),
    workspaceSlug: v.string(),
    maintenanceLimit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    requireReadSecret(args.writeSecret);
    const workspaceSlug = normalizeWorkspaceSlug(args.workspaceSlug);
    const maintenanceLimit = Math.min(
      50,
      Math.max(1, Math.floor(args.maintenanceLimit ?? 20)),
    );

    const proposals = await ctx.db
      .query("company_industry_review_proposals")
      .collect();
    const proposalsByStatus: Record<string, number> = {
      new: 0,
      researching: 0,
      ready_for_review: 0,
      needs_more_evidence: 0,
      approved: 0,
      rejected: 0,
      superseded: 0,
    };
    const openProposals: Array<{ proposalId: string; status: string }> = [];
    for (const proposal of proposals) {
      const status =
        typeof proposal.status === "string" ? proposal.status : "unknown";
      proposalsByStatus[status] = (proposalsByStatus[status] ?? 0) + 1;
      if (OPEN_INDUSTRY_PROPOSAL_STATUSES.has(status)) {
        openProposals.push({
          proposalId: proposal.proposalId,
          status,
        });
      }
    }

    const sources = await ctx.db
      .query("company_industry_evidence_sources")
      .collect();
    const proposalIdsWithSources = new Set<string>();
    for (const source of sources) {
      const proposalId =
        typeof source.proposalId === "string" ? source.proposalId.trim() : "";
      if (proposalId) proposalIdsWithSources.add(proposalId);
    }
    let openWithSources = 0;
    for (const proposal of openProposals) {
      if (proposalIdsWithSources.has(proposal.proposalId)) openWithSources += 1;
    }
    const openTotal = openProposals.length;
    const openWithoutSources = Math.max(0, openTotal - openWithSources);

    const digests = await ctx.db.query("resume_digests").collect();
    let withVerifiedEvidence = 0;
    for (const digest of digests) {
      const summaries = (digest as { verifiedIndustryEvidenceSummaries?: unknown })
        .verifiedIndustryEvidenceSummaries;
      if (Array.isArray(summaries) && summaries.length > 0) {
        withVerifiedEvidence += 1;
      }
    }

    const profiles = await ctx.db
      .query("company_industry_profiles")
      .collect();
    let verifiedProfiles = 0;
    let rejectedProfiles = 0;
    for (const profile of profiles) {
      if (profile.verificationLevel === "verified") verifiedProfiles += 1;
      else if (profile.verificationLevel === "rejected") rejectedProfiles += 1;
    }

    const maintenanceRows = await ctx.db
      .query("industry_maintenance_runs")
      .withIndex("by_workspace_time", (q: any) =>
        q.eq("workspaceSlug", workspaceSlug),
      )
      .collect();
    maintenanceRows.sort(
      (left: any, right: any) =>
        (right.startedAt ?? right._creationTime) -
        (left.startedAt ?? left._creationTime),
    );
    const recentMaintenance = maintenanceRows.slice(0, maintenanceLimit);

    const researchRequests = await ctx.db
      .query("industry_evidence_research_requests")
      .withIndex("by_workspace_created", (q: any) => q.eq("workspaceSlug", workspaceSlug))
      .collect();
    const activeResearchRequests = researchRequests.filter((row: any) =>
      ACTIVE_RESEARCH_REQUEST_STATES.has(row.state),
    );
    const researchByOrigin: Record<string, number> = {};
    for (const request of activeResearchRequests) {
      researchByOrigin[request.origin] = (researchByOrigin[request.origin] ?? 0) + 1;
    }
    const oldestResearch = [...activeResearchRequests].sort(
      (left: any, right: any) => left.requestedAt - right.requestedAt,
    )[0];
    const oldestDirectResearch = [...activeResearchRequests]
      .filter((row: any) => row.origin === "resume_detail" || row.origin === "admin_review")
      .sort((left: any, right: any) => left.requestedAt - right.requestedAt)[0];
    const retryRequests = researchRequests.filter((row: any) => row.attemptCount > 1);
    const providerLimitedBacklog = researchRequests.filter(
      (row: any) => row.lastErrorCode === "provider_limited" && ACTIVE_RESEARCH_REQUEST_STATES.has(row.state),
    ).length;
    const workerUnreachableRuns = recentMaintenance.filter(
      (run: any) => typeof run.failureMessage === "string" && run.failureMessage.toLowerCase().includes("worker"),
    ).length;

    const summarizeRun = (run: any) => {
      const counts = run?.counts && typeof run.counts === "object" ? run.counts : {};
      return {
        runId: String(run.runId ?? ""),
        status: typeof run.status === "string" ? run.status : undefined,
        triggerSource:
          typeof run.triggerSource === "string" ? run.triggerSource : undefined,
        triggerContext:
          typeof run.triggerContext === "string" ? run.triggerContext : undefined,
        operatorSummary:
          typeof run.operatorSummary === "string"
            ? run.operatorSummary
            : undefined,
        failureMessage:
          typeof run.failureMessage === "string"
            ? run.failureMessage
            : undefined,
        partial: typeof run.partial === "boolean" ? run.partial : undefined,
        startedAt:
          typeof run.startedAt === "number"
            ? run.startedAt
            : typeof run._creationTime === "number"
              ? run._creationTime
              : undefined,
        finishedAt:
          typeof run.finishedAt === "number" ? run.finishedAt : undefined,
        counts: {
          proposalsResearched:
            typeof counts.proposalsResearched === "number"
              ? counts.proposalsResearched
              : 0,
          readyCreated:
            typeof counts.readyCreated === "number" ? counts.readyCreated : 0,
          sourcesDemoted:
            typeof counts.sourcesDemoted === "number"
              ? counts.sourcesDemoted
              : 0,
          freshnessChecked:
            typeof counts.freshnessChecked === "number"
              ? counts.freshnessChecked
              : 0,
          freshnessRefreshed:
            typeof counts.freshnessRefreshed === "number"
              ? counts.freshnessRefreshed
              : 0,
          errors: typeof counts.errors === "number" ? counts.errors : 0,
        },
      };
    };

    const latest = recentMaintenance[0]
      ? summarizeRun(recentMaintenance[0])
      : null;

    let lastUseful: ReturnType<typeof summarizeRun> | null = null;
    for (const run of recentMaintenance) {
      if (run.status !== "completed") continue;
      const counts = run.counts && typeof run.counts === "object" ? run.counts : {};
      const researched =
        typeof counts.proposalsResearched === "number"
          ? counts.proposalsResearched
          : 0;
      const ready =
        typeof counts.readyCreated === "number" ? counts.readyCreated : 0;
      if (researched > 0 || ready > 0) {
        lastUseful = summarizeRun(run);
        break;
      }
    }

    let lastFailed: ReturnType<typeof summarizeRun> | null = null;
    for (const run of recentMaintenance) {
      if (run.status === "failed") {
        lastFailed = summarizeRun(run);
        break;
      }
    }

    // Treat "none" and "near-empty fill" as the same operator bottleneck:
    // research is not producing steward-ready evidence for the open backlog.
    const evidenceFillRatio =
      openTotal > 0 ? openWithSources / openTotal : 1;
    const emptyEvidenceBottleneck =
      openTotal > 0 && (openWithSources === 0 || evidenceFillRatio < 0.05);
    const readyBacklogBottleneck =
      (proposalsByStatus.ready_for_review ?? 0) === 0 &&
      ((proposalsByStatus.new ?? 0) > 0 ||
        (proposalsByStatus.needs_more_evidence ?? 0) > 0);

    return {
      generatedAt: Date.now(),
      workspaceSlug,
      proposalsByStatus,
      openTotal,
      openWithSources,
      openWithoutSources,
      emptyEvidenceBottleneck,
      readyBacklogBottleneck,
      resumes: {
        total: digests.length,
        withVerifiedEvidence,
      },
      profiles: {
        total: profiles.length,
        verified: verifiedProfiles,
        rejected: rejectedProfiles,
      },
      maintenance: {
        latest,
        lastUseful,
        lastFailed,
      },
      researchQueue: {
        active: activeResearchRequests.length,
        queued: activeResearchRequests.filter((row: any) => row.state === "queued").length,
        leased: activeResearchRequests.filter((row: any) => row.state === "leased").length,
        retryWait: activeResearchRequests.filter((row: any) => row.state === "retry_wait").length,
        needsIdentityReview: researchRequests.filter((row: any) => row.state === "needs_identity_review").length,
        failed: researchRequests.filter((row: any) => row.state === "failed").length,
        byOrigin: researchByOrigin,
        oldestRequestedAt: oldestResearch?.requestedAt ?? null,
        oldestPriority: oldestResearch?.priority ?? null,
        alerts: {
          oldestDirectDemandAgeMs: oldestDirectResearch
            ? Math.max(0, Date.now() - oldestDirectResearch.requestedAt)
            : 0,
          highRetryRate: researchRequests.length > 0 && retryRequests.length / researchRequests.length >= 0.25,
          providerLimitedBacklog,
          workerUnreachableRuns,
        },
      },
    };
  },
});
