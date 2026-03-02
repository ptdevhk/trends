import { v } from "convex/values";
import { mutation, query } from "./_generated/server";

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

/**
 * Get the current active session for a given session key.
 * Creates one if it doesn't exist.
 */
export const getActiveSession = query({
    args: {
        sessionKey: v.string(),
        workspaceSlug: v.optional(v.string()),
    },
    handler: async (ctx, args) => {
        const workspaceSlug = normalizeWorkspaceSlug(args.workspaceSlug);
        const sessions = await ctx.db
            .query("screening_sessions")
            .withIndex("by_sessionKey", (q) => q.eq("sessionKey", args.sessionKey))
            .filter((q) => q.eq(q.field("status"), "active"))
            .collect();

        const filtered = sessions
            .filter((session) => belongsToWorkspace(session.workspaceSlug, workspaceSlug))
            .sort((left, right) => right.lastActive - left.lastActive);

        return filtered[0] ?? null;
    },
});

/**
 * Save or update a session.
 */
export const saveSession = mutation({
    args: {
        sessionKey: v.string(),
        workspaceSlug: v.optional(v.string()),
        location: v.string(),
        keywords: v.array(v.string()),
        jobDescriptionId: v.optional(v.string()),
        filters: v.optional(v.any()),
    },
    handler: async (ctx, args) => {
        const workspaceSlug = normalizeWorkspaceSlug(args.workspaceSlug);
        const existingSessions = await ctx.db
            .query("screening_sessions")
            .withIndex("by_sessionKey", (q) => q.eq("sessionKey", args.sessionKey))
            .filter((q) => q.eq(q.field("status"), "active"))
            .collect();
        const existing = existingSessions.find((session) => belongsToWorkspace(session.workspaceSlug, workspaceSlug));

        const sessionData = {
            sessionKey: args.sessionKey,
            status: "active" as const,
            config: {
                location: args.location,
                keywords: args.keywords,
                jobDescriptionId: args.jobDescriptionId,
                filters: args.filters,
            },
            workspaceSlug,
            lastActive: Date.now(),
        };

        if (existing) {
            await ctx.db.patch(existing._id, sessionData);
            return existing._id;
        } else {
            return await ctx.db.insert("screening_sessions", {
                ...sessionData,
                reviewedResumeIds: [],
            });
        }
    },
});

/**
 * Add a resume ID to the reviewed history of the active session.
 */
export const addReviewedItem = mutation({
    args: {
        sessionKey: v.string(),
        workspaceSlug: v.optional(v.string()),
        resumeId: v.string(),
    },
    handler: async (ctx, args) => {
        const workspaceSlug = normalizeWorkspaceSlug(args.workspaceSlug);
        const sessions = await ctx.db
            .query("screening_sessions")
            .withIndex("by_sessionKey", (q) => q.eq("sessionKey", args.sessionKey))
            .filter((q) => q.eq(q.field("status"), "active"))
            .collect();
        const session = sessions.find((item) => belongsToWorkspace(item.workspaceSlug, workspaceSlug));

        if (!session) {
            return null;
        }

        if (session.reviewedResumeIds.includes(args.resumeId)) {
            return session._id;
        }

        const reviewedResumeIds = [...session.reviewedResumeIds, args.resumeId];
        await ctx.db.patch(session._id, {
            reviewedResumeIds,
            lastActive: Date.now(),
        });

        return session._id;
    },
});

/**
 * Archive the current active session.
 */
export const archiveSession = mutation({
    args: {
        sessionKey: v.string(),
        workspaceSlug: v.optional(v.string()),
    },
    handler: async (ctx, args) => {
        const workspaceSlug = normalizeWorkspaceSlug(args.workspaceSlug);
        const sessions = await ctx.db
            .query("screening_sessions")
            .withIndex("by_sessionKey", (q) => q.eq("sessionKey", args.sessionKey))
            .filter((q) => q.eq(q.field("status"), "active"))
            .collect();
        const session = sessions.find((item) => belongsToWorkspace(item.workspaceSlug, workspaceSlug));

        if (session) {
            await ctx.db.patch(session._id, { status: "archived" });
        }
        return null;
    },
});
