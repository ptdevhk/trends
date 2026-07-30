import { v } from "convex/values";
import { mutation, query } from "./_generated/server";
import {
  CANONICAL_SEED_COMPANIES,
  MAX_RECRUITER_INDUSTRY_EVIDENCE_SOURCES,
  compareSourcePreviews,
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

const OPEN_INDUSTRY_PROPOSAL_STATUSES = new Set([
  "new",
  "researching",
  "ready_for_review",
  "needs_more_evidence",
]);

const INDUSTRY_EVIDENCE_DAY_MS = 24 * 60 * 60 * 1_000;

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

async function findIndustryEvidenceSource(ctx: { db: any }, sourceId: string) {
  const rows = await ctx.db
    .query("company_industry_evidence_sources")
    .withIndex("by_source_id", (q: any) => q.eq("sourceId", sourceId))
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
    const existing = candidates.find((candidate) =>
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
  },
  handler: async (ctx, args) => {
    requireReadSecret(args.writeSecret);
    const rows = args.status
      ? await ctx.db
          .query("company_industry_review_proposals")
          .withIndex("by_status_priority", (q) => q.eq("status", args.status!))
          .collect()
      : await ctx.db.query("company_industry_review_proposals").collect();
    return rows.sort(
      (left, right) =>
        right.priority - left.priority ||
        right.updatedAt - left.updatedAt ||
        left.proposalId.localeCompare(right.proposalId),
    );
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
    verificationLevel: approvedVerificationLevelValidator,
    industryClass: industryClassValidator,
    approvedSourceIds: v.array(v.string()),
    evidenceSummary: v.string(),
    reviewer: v.string(),
    decisionReason: v.string(),
    taxonomyVersion: v.string(),
    ruleVersion: v.optional(v.string()),
    nextReviewAt: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    requireWriteSecret(args.writeSecret);
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
      .withIndex("by_company_key", (q) => q.eq("companyKey", companyKey))
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
        .withIndex("by_revision_id", (q) => q.eq("revisionId", revisionId))
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
      args.expectedCurrentRevisionId !== undefined &&
      currentRevisionId !== args.expectedCurrentRevisionId
    ) {
      throw new Error("Current industry revision changed during review");
    }
    if (
      proposal.currentRevisionId !== undefined &&
      currentRevisionId !== proposal.currentRevisionId
    ) {
      throw new Error("Proposal current revision is stale");
    }

    const existingRevisions = await ctx.db
      .query("company_industry_verdict_revisions")
      .withIndex("by_revision_id", (q) => q.eq("revisionId", revisionId))
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
        normalizeIndustryEvidenceUrl(source.url) === null
      ) {
        throw new Error(`Evidence source is not approval-safe: ${sourceId}`);
      }
      sources.push(source);
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
      reviewedAt: now,
      decisionReason,
      taxonomyVersion,
      ...(args.ruleVersion?.trim()
        ? { ruleVersion: args.ruleVersion.trim() }
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
