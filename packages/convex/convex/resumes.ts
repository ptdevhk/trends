import { internalMutation, internalQuery, query } from "./_generated/server";
import { v } from "convex/values";

export const list = query({
    args: { limit: v.optional(v.number()) },
    handler: async (ctx, args) => {
        const limit = args.limit || 50;
        return await ctx.db.query("resumes").order("desc").take(limit);
    },
});

export const getResume = internalQuery({
    args: { resumeId: v.id("resumes") },
    handler: async (ctx, args) => {
        return await ctx.db.get(args.resumeId);
    },
});

export const updateAnalysis = internalMutation({
    args: {
        resumeId: v.id("resumes"),
        analysis: v.object({
            score: v.number(),
            summary: v.string(),
            highlights: v.array(v.string()),
            recommendation: v.string(),
            breakdown: v.optional(v.any()),
            jobDescriptionId: v.optional(v.string()),
        }),
    },
    handler: async (ctx, args) => {
        await ctx.db.patch(args.resumeId, {
            analysis: args.analysis,
        });
    },
});
