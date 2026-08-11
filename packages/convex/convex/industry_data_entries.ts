import { v } from "convex/values";
import {
  mutation,
  query,
} from "./_generated/server";
import {
  requireReadSecret,
  requireWriteSecret,
} from "./lib/company_shared.js";

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
