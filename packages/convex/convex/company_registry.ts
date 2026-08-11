import { v } from "convex/values";
import {
  mutation,
  query,
} from "./_generated/server";
import {
  CANONICAL_SEED_COMPANIES,
  normalizeCompanyAlias,
  policyEffectsFromPreset,
  type CompanyPolicyEffects,
} from "@trends/shared";
import {
  listAliasesForCompany,
  normalizeCompanyKey,
  normalizeWorkspaceSlug,
  requireReadSecret,
  requireWriteSecret,
} from "./lib/company_shared.js";

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
    includeArchived: v.optional(v.boolean()),
  },
  handler: async (ctx, args) => {
    requireReadSecret(args.writeSecret);
    let rows = args.status
      ? await ctx.db
          .query("companies")
          .withIndex("by_status", (q) => q.eq("status", args.status!))
          .collect()
      : await ctx.db.query("companies").collect();

    // Soft-deleted companies are hidden by default; `includeArchived` opts in.
    if (args.includeArchived !== true) {
      rows = rows.filter((row) => !row.archivedAt);
    }

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
        archivedAt: row.archivedAt,
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
      archivedAt: row.archivedAt,
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

/**
 * Archive (soft delete) or restore a company registry entry.
 * Archived companies are hidden from `companies:list` by default and never
 * enter the resume-policy alias index, so their policies stop applying.
 * Setting `archivedAt` to undefined removes the field (Convex patch delete).
 */

export const setCompanyArchived = mutation({
  args: {
    companyKey: v.string(),
    archived: v.boolean(),
    writeSecret: v.optional(v.string()),
    createdBy: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    requireWriteSecret(args.writeSecret);
    const companyKey = normalizeCompanyKey(args.companyKey);
    if (!companyKey) {
      throw new Error("companyKey is required");
    }
    const existing = await ctx.db
      .query("companies")
      .withIndex("by_company_key", (q) => q.eq("companyKey", companyKey))
      .collect();
    const row = existing[0];
    if (!row) {
      throw new Error(`Unknown companyKey: ${companyKey}`);
    }
    const now = Date.now();
    await ctx.db.patch(row._id, {
      archivedAt: args.archived ? now : undefined,
      updatedAt: now,
    });
    return {
      companyKey,
      archived: args.archived,
      archivedAt: args.archived ? now : null,
    };
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
