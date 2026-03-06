import { internal } from "./_generated/api";
import { mutation, query, type MutationCtx } from "./_generated/server";
import { v } from "convex/values";

const DEFAULT_WORKSPACE_SLUG = "dev";

function normalizeWorkspaceSlug(input: string | undefined): string {
  const normalized = input?.trim();
  return normalized && normalized.length > 0 ? normalized : DEFAULT_WORKSPACE_SLUG;
}

function belongsToWorkspace(recordWorkspaceSlug: string | undefined, workspaceSlug: string): boolean {
  if (workspaceSlug === DEFAULT_WORKSPACE_SLUG) {
    return !recordWorkspaceSlug || recordWorkspaceSlug === DEFAULT_WORKSPACE_SLUG;
  }
  return recordWorkspaceSlug === workspaceSlug;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return null;
  }
  const record: Record<string, unknown> = {};
  for (const [key, item] of Object.entries(value)) {
    record[key] = item;
  }
  return record;
}

function readString(value: unknown): string | undefined {
  if (typeof value !== "string") {
    return undefined;
  }
  const normalized = value.trim();
  return normalized.length > 0 ? normalized : undefined;
}

function readStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }
  const normalized = value
    .map((item) => readString(item))
    .filter((item): item is string => Boolean(item));
  return Array.from(new Set(normalized));
}

function normalizeCriteria(profile: unknown): { keywords: string[]; locations: string[] } {
  const record = asRecord(profile);
  if (!record) {
    return {
      keywords: [],
      locations: [],
    };
  }

  const keywords = readStringArray(record.keywords);
  const location = readString(record.location);
  const filters = asRecord(record.filters);
  const locationsFromFilters = filters ? readStringArray(filters.locations) : [];
  const locations = Array.from(
    new Set([
      ...(location ? [location] : []),
      ...locationsFromFilters,
    ])
  );

  return {
    keywords,
    locations,
  };
}

const jobDescriptionSyncSchema = v.object({
  id: v.string(),
  content: v.string(),
  customKeywords: v.array(v.string()),
});

async function syncLinkedCustomJobDescription(
  ctx: MutationCtx,
  workspaceSlug: string,
  jobDescriptionSync: { id: string; content: string; customKeywords: string[] } | undefined,
): Promise<void> {
  if (!jobDescriptionSync) {
    return;
  }

  const jobDescriptions = await ctx.db.query("job_descriptions").collect();
  const linked = jobDescriptions.find((record) => String(record._id) === jobDescriptionSync.id);
  if (!linked) {
    return;
  }
  if (!belongsToWorkspace(linked.workspaceSlug, workspaceSlug)) {
    throw new Error("Cannot update linked job description from another workspace");
  }
  if (linked.type !== "custom") {
    return;
  }

  await ctx.db.patch(linked._id, {
    content: jobDescriptionSync.content,
    customKeywords: jobDescriptionSync.customKeywords,
    lastModified: Date.now(),
  });
  await ctx.scheduler.runAfter(0, internal.ingest_agent.reIngestAllResumes, {});
}

export const list = query({
  args: {
    workspaceSlug: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const workspaceSlug = normalizeWorkspaceSlug(args.workspaceSlug);
    const records = await ctx.db.query("search_profiles").collect();
    return records
      .filter((record) => belongsToWorkspace(record.workspaceSlug, workspaceSlug))
      .sort((left, right) => {
        const leftUpdated = left.updatedAt ?? left.lastRunAt ?? left._creationTime;
        const rightUpdated = right.updatedAt ?? right.lastRunAt ?? right._creationTime;
        return rightUpdated - leftUpdated;
      });
  },
});

export const getById = query({
  args: {
    id: v.string(),
    workspaceSlug: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const workspaceSlug = normalizeWorkspaceSlug(args.workspaceSlug);
    const records = await ctx.db.query("search_profiles").collect();
    const found = records.find((record) => String(record._id) === args.id);
    if (!found) {
      return null;
    }
    if (!belongsToWorkspace(found.workspaceSlug, workspaceSlug)) {
      return null;
    }
    return found;
  },
});

export const create = mutation({
  args: {
    profile: v.any(),
    workspaceSlug: v.optional(v.string()),
    jobDescriptionSync: v.optional(jobDescriptionSyncSchema),
  },
  handler: async (ctx, args) => {
    const workspaceSlug = normalizeWorkspaceSlug(args.workspaceSlug);
    const profile = asRecord(args.profile);
    const criteria = normalizeCriteria(args.profile);
    const name = readString(profile?.name) ?? "Profile";
    const profileId = readString(profile?.id);
    const now = Date.now();

    const id = await ctx.db.insert("search_profiles", {
      name,
      profileId,
      criteria,
      profile: profile ?? {},
      workspaceSlug,
      createdAt: now,
      updatedAt: now,
    });

    await syncLinkedCustomJobDescription(ctx, workspaceSlug, args.jobDescriptionSync);

    return await ctx.db.get(id);
  },
});

export const update = mutation({
  args: {
    id: v.string(),
    profile: v.any(),
    workspaceSlug: v.optional(v.string()),
    jobDescriptionSync: v.optional(jobDescriptionSyncSchema),
  },
  handler: async (ctx, args) => {
    const workspaceSlug = normalizeWorkspaceSlug(args.workspaceSlug);
    const records = await ctx.db.query("search_profiles").collect();
    const existing = records.find((record) => String(record._id) === args.id);
    if (!existing) {
      throw new Error(`Search profile not found: ${args.id}`);
    }
    if (!belongsToWorkspace(existing.workspaceSlug, workspaceSlug)) {
      throw new Error("Cannot update search profile from another workspace");
    }

    const profile = asRecord(args.profile);
    const criteria = normalizeCriteria(args.profile);
    const name = readString(profile?.name) ?? existing.name;
    const profileId = readString(profile?.id) ?? existing.profileId;
    const now = Date.now();

    await ctx.db.patch(existing._id, {
      name,
      profileId,
      criteria,
      profile: profile ?? {},
      updatedAt: now,
    });

    await syncLinkedCustomJobDescription(ctx, workspaceSlug, args.jobDescriptionSync);

    return await ctx.db.get(existing._id);
  },
});

export const remove = mutation({
  args: {
    id: v.string(),
    workspaceSlug: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const workspaceSlug = normalizeWorkspaceSlug(args.workspaceSlug);
    const records = await ctx.db.query("search_profiles").collect();
    const existing = records.find((record) => String(record._id) === args.id);
    if (!existing) {
      return false;
    }
    if (!belongsToWorkspace(existing.workspaceSlug, workspaceSlug)) {
      return false;
    }

    await ctx.db.delete(existing._id);
    return true;
  },
});
