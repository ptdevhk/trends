import { v } from "convex/values";
import { mutation, query } from "./_generated/server";

/**
 * Get the current active session for a given session key.
 * Creates one if it doesn't exist.
 */
export const getActiveSession = query({
    args: { sessionKey: v.string() },
    handler: async (ctx, args) => {
        const session = await ctx.db
            .query("screening_sessions")
            .withIndex("by_sessionKey", (q) => q.eq("sessionKey", args.sessionKey))
            .filter((q) => q.eq(q.field("status"), "active"))
            .unique();
        return session;
    },
});

/**
 * Save or update a session.
 */
export const saveSession = mutation({
    args: {
        sessionKey: v.string(),
        location: v.string(),
        keywords: v.array(v.string()),
        jobDescriptionId: v.optional(v.string()),
        filters: v.optional(v.any()),
    },
    handler: async (ctx, args) => {
        const existing = await ctx.db
            .query("screening_sessions")
            .withIndex("by_sessionKey", (q) => q.eq("sessionKey", args.sessionKey))
            .filter((q) => q.eq(q.field("status"), "active"))
            .unique();

        const sessionData = {
            sessionKey: args.sessionKey,
            status: "active" as const,
            config: {
                location: args.location,
                keywords: args.keywords,
                jobDescriptionId: args.jobDescriptionId,
                filters: args.filters,
            },
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
        resumeId: v.string(),
    },
    handler: async (ctx, args) => {
        const session = await ctx.db
            .query("screening_sessions")
            .withIndex("by_sessionKey", (q) => q.eq("sessionKey", args.sessionKey))
            .filter((q) => q.eq(q.field("status"), "active"))
            .unique();

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
    args: { sessionKey: v.string() },
    handler: async (ctx, args) => {
        const session = await ctx.db
            .query("screening_sessions")
            .withIndex("by_sessionKey", (q) => q.eq("sessionKey", args.sessionKey))
            .filter((q) => q.eq(q.field("status"), "active"))
            .unique();

        if (session) {
            await ctx.db.patch(session._id, { status: "archived" });
        }
        return null;
    },
});
