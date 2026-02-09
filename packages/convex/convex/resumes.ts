import { internalMutation, internalQuery } from "./_generated/server";
import { v } from "convex/values";

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
        }),
    },
    handler: async (ctx, args) => {
        await ctx.db.patch(args.resumeId, {
            analysis: args.analysis,
        });
    },
});
