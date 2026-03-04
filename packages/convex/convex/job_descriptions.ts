import { internal } from "./_generated/api";
import { mutation, query } from "./_generated/server";
import { v } from "convex/values";

const DEFAULT_WORKSPACE_SLUG = "dev";

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

export const list = query({
    args: {
        userId: v.optional(v.string()),
        workspaceSlug: v.optional(v.string()),
    },
    handler: async (ctx, args) => {
        const workspaceSlug = normalizeWorkspaceSlug(args.workspaceSlug);
        // Fetch all system JDs
        const systemJDs = await ctx.db
            .query("job_descriptions")
            .filter((q) => q.eq(q.field("type"), "system"))
            .collect();

        // Fetch custom JDs (for now, all enabled custom JDs or user specific)
        let customJDs = await ctx.db
            .query("job_descriptions")
            .filter((q) => q.eq(q.field("type"), "custom"))
            .collect();

        if (args.userId) {
            customJDs = customJDs.filter(jd => jd.userId === args.userId || !jd.userId);
        }

        customJDs = customJDs.filter((jd) => belongsToWorkspace(jd.workspaceSlug, workspaceSlug));

        return [...systemJDs, ...customJDs].filter(jd => jd.enabled !== false).sort((a, b) => b.lastModified - a.lastModified);
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
            industryTags: args.industryTags,
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
        location: v.optional(v.string()),
        industryTags: v.optional(v.array(v.string())),
        customKeywords: v.optional(v.array(v.string())),
        minExperience: v.optional(v.number()),
        maxExperience: v.optional(v.number()),
        minAge: v.optional(v.number()),
        maxAge: v.optional(v.number()),
    },
    handler: async (ctx, args) => {
        const { id, ...updates } = args;
        await ctx.db.patch(id, {
            ...updates,
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
        return await ctx.db.get(args.id);
    },
});

export const list_all = query({
    args: { workspaceSlug: v.optional(v.string()) },
    handler: async (ctx, args) => {
        const workspaceSlug = normalizeWorkspaceSlug(args.workspaceSlug);
        const jds = await ctx.db.query("job_descriptions").collect();

        return jds.filter((jd) => {
            if (jd.type === "system") {
                return true;
            }
            return belongsToWorkspace(jd.workspaceSlug, workspaceSlug);
        });
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
    handler: async (ctx, args) => {
        const workspaceSlug = normalizeWorkspaceSlug(args.workspaceSlug);
        const jds = await ctx.db.query("job_descriptions").collect();
        const resumes = await ctx.db.query("resumes").collect();
        const scopedJds = jds.filter((jd) => {
            if (jd.type === "system") {
                return true;
            }
            return belongsToWorkspace(jd.workspaceSlug, workspaceSlug);
        });

        return scopedJds.map(jd => {
            const jdIdStr = String(jd._id);
            const jdSlug = jd.slug;

            const usageCount = resumes.filter(r => {
                const analysisJdId = r.analysis?.jobDescriptionId;
                // Check in legacy analysis field - match by Convex _id or by slug
                if (analysisJdId === jdIdStr) return true;
                if (jdSlug && analysisJdId === jdSlug) return true;
                // Check in multi-JD analyses map - match by Convex _id or by slug
                if (r.analyses && r.analyses[jdIdStr]) return true;
                if (jdSlug && r.analyses && r.analyses[jdSlug]) return true;
                return false;
            }).length;

            return {
                ...jd,
                usageCount
            };
        });
    }
});
