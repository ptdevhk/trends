import { internalMutation, internalQuery, query } from "./_generated/server";
import { v } from "convex/values";

export const list = query({
    handler: async (ctx) => {
        return await ctx.db.query("resumes").order("desc").take(50);
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
        }),
    },
    handler: async (ctx, args) => {
        await ctx.db.patch(args.resumeId, {
            analysis: args.analysis,
        });
    },
});
