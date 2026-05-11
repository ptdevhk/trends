import { internal } from "./_generated/api";
import { action, internalQuery, mutation, query } from "./_generated/server";
import type { Doc } from "./_generated/dataModel";
import { v } from "convex/values";

import { isResumeAnalysisKeyForJobDescription, normalizeIndustryTags } from "@trends/shared";

import { DEFAULT_WORKSPACE_SLUG } from "./sessions";

function normalizeWorkspaceSlug(input: string | undefined): string {
    const normalized = input?.trim();
    return normalized && normalized.length > 0 ? normalized : DEFAULT_WORKSPACE_SLUG;
}

function belongsToWorkspace(
    recordWorkspaceSlug: string | undefined,
    workspaceSlug: string
): boolean {
    if (workspaceSlug === DEFAULT_WORKSPACE_SLUG) {
        return !recordWorkspaceSlug || recordWorkspaceSlug === DEFAULT_WORKSPACE_SLUG;
    }
    return recordWorkspaceSlug === workspaceSlug;
}

function sanitizeIndustryTags(input: string[] | undefined | null): string[] | undefined {
    const normalized = normalizeIndustryTags(input);
    return normalized.length > 0 ? normalized : undefined;
}

function normalizeJobDescriptionRecord<T extends { industryTags?: string[] | undefined }>(record: T): T {
    const industryTags = sanitizeIndustryTags(record.industryTags);
    return {
        ...record,
        industryTags,
    };
}

type JobDescriptionWithUsage = Doc<"job_descriptions"> & {
    usageCount: number;
};

export const list = query({
    args: {
        userId: v.optional(v.string()),
        workspaceSlug: v.optional(v.string()),
    },
    handler: async (ctx, args) => {
        const workspaceSlug = normalizeWorkspaceSlug(args.workspaceSlug);
        // Fetch all system JDs via index
        const systemJDs = await ctx.db
            .query("job_descriptions")
            .withIndex("by_type", (q) => q.eq("type", "system"))
            .collect();

        // Fetch custom JDs via workspace index, then filter by userId
        const allCustomJDs = await ctx.db
            .query("job_descriptions")
            .withIndex("by_type", (q) => q.eq("type", "custom"))
            .collect();

        let customJDs = allCustomJDs.filter((jd) => belongsToWorkspace(jd.workspaceSlug, workspaceSlug));

        if (args.userId) {
            customJDs = customJDs.filter(jd => jd.userId === args.userId || !jd.userId);
        }

        return [...systemJDs, ...customJDs]
            .filter(jd => jd.enabled !== false)
            .map(normalizeJobDescriptionRecord)
            .sort((a, b) => b.lastModified - a.lastModified);
    },
});

export const create = mutation({
    args: {
        title: v.string(),
        content: v.string(),
        type: v.union(v.literal("system"), v.literal("custom")),
        userId: v.optional(v.string()),
        workspaceSlug: v.optional(v.string()),
        location: v.optional(v.string()),
        industryTags: v.optional(v.array(v.string())),
        customKeywords: v.optional(v.array(v.string())),
        minExperience: v.optional(v.number()),
        maxExperience: v.optional(v.number()),
        minAge: v.optional(v.number()),
        maxAge: v.optional(v.number()),
    },
    handler: async (ctx, args) => {
        const workspaceSlug = normalizeWorkspaceSlug(args.workspaceSlug);
        const id = await ctx.db.insert("job_descriptions", {
            title: args.title,
            content: args.content,
            type: args.type,
            userId: args.userId,
            workspaceSlug,
            enabled: true,
            lastModified: Date.now(),
            location: args.location,
            industryTags: sanitizeIndustryTags(args.industryTags),
            customKeywords: args.customKeywords,
            minExperience: args.minExperience,
            maxExperience: args.maxExperience,
            minAge: args.minAge,
            maxAge: args.maxAge,
        });
        await ctx.scheduler.runAfter(0, internal.ingest_agent.reIngestAllResumes, {});
        return id;
    },
});

export const update = mutation({
    args: {
        id: v.id("job_descriptions"),
        title: v.optional(v.string()),
        content: v.optional(v.string()),
        enabled: v.optional(v.boolean()),
        location: v.optional(v.union(v.string(), v.null())),
        industryTags: v.optional(v.union(v.array(v.string()), v.null())),
        customKeywords: v.optional(v.union(v.array(v.string()), v.null())),
        minExperience: v.optional(v.union(v.number(), v.null())),
        maxExperience: v.optional(v.union(v.number(), v.null())),
        minAge: v.optional(v.union(v.number(), v.null())),
        maxAge: v.optional(v.union(v.number(), v.null())),
    },
    handler: async (ctx, args) => {
        const { id, ...updates } = args;
        await ctx.db.patch(id, {
            ...(updates.title !== undefined ? { title: updates.title } : {}),
            ...(updates.content !== undefined ? { content: updates.content } : {}),
            ...(updates.enabled !== undefined ? { enabled: updates.enabled } : {}),
            ...(updates.location !== undefined ? { location: updates.location ?? undefined } : {}),
            ...(updates.industryTags !== undefined ? { industryTags: sanitizeIndustryTags(updates.industryTags) } : {}),
            ...(updates.customKeywords !== undefined ? { customKeywords: updates.customKeywords ?? undefined } : {}),
            ...(updates.minExperience !== undefined ? { minExperience: updates.minExperience ?? undefined } : {}),
            ...(updates.maxExperience !== undefined ? { maxExperience: updates.maxExperience ?? undefined } : {}),
            ...(updates.minAge !== undefined ? { minAge: updates.minAge ?? undefined } : {}),
            ...(updates.maxAge !== undefined ? { maxAge: updates.maxAge ?? undefined } : {}),
            lastModified: Date.now(),
        });

        if (args.content !== undefined) {
            await ctx.scheduler.runAfter(0, internal.ingest_agent.reIngestAllResumes, {});
        }
    },
});

export const get = query({
    args: { id: v.id("job_descriptions") },
    handler: async (ctx, args) => {
        const record = await ctx.db.get(args.id);
        return record ? normalizeJobDescriptionRecord(record) : record;
    },
});

export const list_all = query({
    args: { workspaceSlug: v.optional(v.string()) },
    handler: async (ctx, args) => {
        const workspaceSlug = normalizeWorkspaceSlug(args.workspaceSlug);
        const systemJDs = await ctx.db
            .query("job_descriptions")
            .withIndex("by_type", (q) => q.eq("type", "system"))
            .collect();
        const customJDs = await ctx.db
            .query("job_descriptions")
            .withIndex("by_type", (q) => q.eq("type", "custom"))
            .collect();

        const workspaceCustom = customJDs.filter((jd) => belongsToWorkspace(jd.workspaceSlug, workspaceSlug));

        return [...systemJDs, ...workspaceCustom]
            .map(normalizeJobDescriptionRecord);
    },
});

export const listAllForWorkspace = internalQuery({
    args: { workspaceSlug: v.optional(v.string()) },
    handler: async (ctx, args) => {
        const workspaceSlug = normalizeWorkspaceSlug(args.workspaceSlug);
        const systemJDs = await ctx.db
            .query("job_descriptions")
            .withIndex("by_type", (q) => q.eq("type", "system"))
            .collect();
        const customJDs = await ctx.db
            .query("job_descriptions")
            .withIndex("by_type", (q) => q.eq("type", "custom"))
            .collect();

        const workspaceCustom = customJDs.filter((jd) => belongsToWorkspace(jd.workspaceSlug, workspaceSlug));

        return [...systemJDs, ...workspaceCustom]
            .map(normalizeJobDescriptionRecord);
    },
});


export const delete_jd = mutation({
    args: {
        id: v.id("job_descriptions"),
        workspaceSlug: v.optional(v.string()),
    },
    handler: async (ctx, args) => {
        const workspaceSlug = normalizeWorkspaceSlug(args.workspaceSlug);
        const jd = await ctx.db.get(args.id);
        if (!jd) throw new Error("Job description not found");
        if (jd.type === "system") throw new Error("Cannot delete system job descriptions");
        if (!belongsToWorkspace(jd.workspaceSlug, workspaceSlug)) {
            throw new Error("Cannot delete job descriptions from another workspace");
        }
        await ctx.db.delete(args.id);
    },
});

export const delete_batch = mutation({
    args: {
        ids: v.array(v.id("job_descriptions")),
        workspaceSlug: v.optional(v.string()),
    },
    handler: async (ctx, args) => {
        const workspaceSlug = normalizeWorkspaceSlug(args.workspaceSlug);
        // 1. Validate all are custom
        for (const id of args.ids) {
            const jd = await ctx.db.get(id);
            if (jd && jd.type === 'system') {
                throw new Error(`Cannot delete System JD: ${jd.title}`);
            }
            if (jd && !belongsToWorkspace(jd.workspaceSlug, workspaceSlug)) {
                throw new Error(`Cannot delete JD from another workspace: ${jd.title}`);
            }
        }

        // 2. Delete all
        await Promise.all(args.ids.map(id => ctx.db.delete(id)));

        return { success: true, count: args.ids.length };
    }
});

export const list_with_usage = query({
    args: { workspaceSlug: v.optional(v.string()) },
    handler: async () => {
        throw new Error("job_descriptions:list_with_usage is no longer available as a query; call the action instead");
    },
});

export const list_with_usage_action = action({
    args: { workspaceSlug: v.optional(v.string()) },
    handler: async (ctx, args): Promise<JobDescriptionWithUsage[]> => {
        const workspaceSlug = normalizeWorkspaceSlug(args.workspaceSlug);
        const scopedJds: Doc<"job_descriptions">[] = await ctx.runQuery(internal.job_descriptions.listAllForWorkspace, {
            workspaceSlug,
        });

        const usageCounts = new Map<string, number>();
        for (const jd of scopedJds) {
            usageCounts.set(String(jd._id), 0);
        }

        let cursor: string | undefined;
        while (true) {
            const page = await ctx.runQuery(internal.resumes.listResumeUsageBatch, {
                cursor,
            });

            for (const resume of page.page) {
                for (const jd of scopedJds) {
                    const jdId = String(jd._id);
                    const jdSlug = jd.slug;
                    const analysisJdId = resume.analysis?.jobDescriptionId;
                    const matchesCurrentAnalysis = analysisJdId === jdId || (jdSlug ? analysisJdId === jdSlug : false);
                    const analysisKeys = resume.analyses ? Object.keys(resume.analyses) : [];
                    const matchesCachedAnalysis = analysisKeys.some((key) =>
                        isResumeAnalysisKeyForJobDescription(key, jdId)
                        || (jdSlug ? isResumeAnalysisKeyForJobDescription(key, jdSlug) : false)
                    );

                    if (matchesCurrentAnalysis || matchesCachedAnalysis) {
                        usageCounts.set(jdId, (usageCounts.get(jdId) ?? 0) + 1);
                    }
                }
            }

            if (page.isDone) {
                break;
            }

            cursor = page.continueCursor ?? undefined;
            if (!cursor) {
                throw new Error("listResumeUsageBatch returned an unfinished page without a continueCursor");
            }
        }

        return scopedJds.map((jd): JobDescriptionWithUsage => normalizeJobDescriptionRecord({
            ...jd,
            usageCount: usageCounts.get(String(jd._id)) ?? 0,
        }));
    }
});
