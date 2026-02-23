import { internalMutation, internalQuery, query } from "./_generated/server";
import type { Doc } from "./_generated/dataModel";
import { v } from "convex/values";

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === "object" && value !== null;
}

function toRuleScores(value: unknown): Record<string, number> {
    if (!isRecord(value)) {
        return {};
    }

    const scores: Record<string, number> = {};
    for (const [key, rawScore] of Object.entries(value)) {
        if (typeof rawScore === "number" && Number.isFinite(rawScore)) {
            scores[key] = rawScore;
        }
    }
    return scores;
}

function getIngestRuleScore(resume: Doc<"resumes">, jobDescriptionId: string | undefined): number {
    if (!jobDescriptionId) {
        return 0;
    }

    const score = toRuleScores(resume.ingestData?.ruleScores)[jobDescriptionId];
    if (typeof score === "number" && Number.isFinite(score)) {
        return score;
    }
    return 0;
}

function sortByIngestRuleScore(
    resumes: Doc<"resumes">[],
    jobDescriptionId: string | undefined
): Doc<"resumes">[] {
    if (!jobDescriptionId) {
        return resumes;
    }

    return [...resumes].sort((left, right) => {
        const scoreDiff = getIngestRuleScore(right, jobDescriptionId) - getIngestRuleScore(left, jobDescriptionId);
        if (scoreDiff !== 0) {
            return scoreDiff;
        }
        return right.crawledAt - left.crawledAt;
    });
}

export const list = query({
    args: { limit: v.optional(v.number()) },
    handler: async (ctx, args) => {
        const limit = args.limit || 50;
        return await ctx.db.query("resumes").order("desc").take(limit);
    },
});

export const listWithIngestData = query({
    args: {
        limit: v.optional(v.number()),
        jobDescriptionId: v.optional(v.string()),
    },
    handler: async (ctx, args) => {
        const limit = args.limit || 50;
        const jobDescriptionId = args.jobDescriptionId?.trim() || undefined;

        const overfetchLimit = Math.max(limit * 3, limit);
        const candidates = await ctx.db
            .query("resumes")
            .withIndex("by_primaryRuleScore")
            .order("desc")
            .take(overfetchLimit);
        return sortByIngestRuleScore(candidates, jobDescriptionId).slice(0, limit);
    },
});

export const search = query({
    args: {
        query: v.string(),
        limit: v.optional(v.number())
    },
    handler: async (ctx, args) => {
        const limit = args.limit || 50;
        return await ctx.db
            .query("resumes")
            .withSearchIndex("search_body", (q) => q.search("searchText", args.query))
            .take(limit);
    },
});

export const searchWithIngestData = query({
    args: {
        query: v.string(),
        limit: v.optional(v.number()),
        jobDescriptionId: v.optional(v.string()),
    },
    handler: async (ctx, args) => {
        const limit = args.limit || 50;
        const jobDescriptionId = args.jobDescriptionId?.trim() || undefined;
        const fetchLimit = Math.max(limit, 200);

        const matches = await ctx.db
            .query("resumes")
            .withSearchIndex("search_body", (q) => q.search("searchText", args.query))
            .take(fetchLimit);

        if (!jobDescriptionId) {
            return matches.slice(0, limit);
        }

        return sortByIngestRuleScore(matches, jobDescriptionId).slice(0, limit);
    },
});

export const getResume = internalQuery({
    args: { resumeId: v.id("resumes") },
    handler: async (ctx, args) => {
        return await ctx.db.get(args.resumeId);
    },
});

export const getResumesByIds = internalQuery({
    args: {
        resumeIds: v.array(v.id("resumes")),
    },
    handler: async (ctx, args) => {
        const docs = await Promise.all(args.resumeIds.map((resumeId) => ctx.db.get(resumeId)));
        return docs.filter((doc): doc is NonNullable<typeof doc> => doc !== null);
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
        const resume = await ctx.db.get(args.resumeId);
        if (!resume) throw new Error("Resume not found");

        const analyses = resume.analyses || {};
        const jdId = args.analysis.jobDescriptionId || "default";

        // Update the specific JD analysis
        analyses[jdId] = args.analysis;

        await ctx.db.patch(args.resumeId, {
            analysis: args.analysis, // Keep current for backward compat / easy access
            analyses: analyses,      // Store in cache
        });
    },
});

export const updateAnalysisBatch = internalMutation({
    args: {
        updates: v.array(v.object({
            resumeId: v.id("resumes"),
            analysis: v.object({
                score: v.number(),
                summary: v.string(),
                highlights: v.array(v.string()),
                recommendation: v.string(),
                breakdown: v.optional(v.any()),
                jobDescriptionId: v.optional(v.string()),
            }),
        })),
    },
    handler: async (ctx, args) => {
        await Promise.all(args.updates.map(async (update) => {
            const resume = await ctx.db.get(update.resumeId);
            if (!resume) return;

            const analyses = resume.analyses || {};
            const jdId = update.analysis.jobDescriptionId || "default";
            analyses[jdId] = update.analysis;

            await ctx.db.patch(update.resumeId, {
                analysis: update.analysis,
                analyses: analyses,
            });
        }));
    },
});

export const updateIngestData = internalMutation({
    args: {
        resumeId: v.id("resumes"),
        ingestData: v.object({
            industryTags: v.array(v.string()),
            synonymHits: v.array(v.string()),
            companyHits: v.optional(v.array(v.string())),
            ruleScores: v.any(),
            experienceLevel: v.string(),
            computedAt: v.number(),
            skillsVersion: v.number(),
        }),
        companyAliasTokens: v.optional(v.string()),
        primaryRuleScore: v.optional(v.number()),
    },
    handler: async (ctx, args) => {
        const resume = await ctx.db.get(args.resumeId);
        if (!resume) throw new Error("Resume not found");

        const patch: Partial<Doc<"resumes">> = {
            ingestData: args.ingestData,
            primaryRuleScore: args.primaryRuleScore ?? 0,
        };

        const aliasTokens = args.companyAliasTokens?.trim().toLowerCase();
        if (aliasTokens) {
            const existingSearchText = resume.searchText || "";
            if (!existingSearchText.toLowerCase().includes(aliasTokens)) {
                patch.searchText = existingSearchText
                    ? `${existingSearchText} ${aliasTokens}`
                    : aliasTokens;
            }
        }

        await ctx.db.patch(args.resumeId, patch);
    },
});

export const updateIngestDataBatch = internalMutation({
    args: {
        updates: v.array(v.object({
            resumeId: v.id("resumes"),
            ingestData: v.object({
                industryTags: v.array(v.string()),
                synonymHits: v.array(v.string()),
                companyHits: v.optional(v.array(v.string())),
                ruleScores: v.any(),
                experienceLevel: v.string(),
                computedAt: v.number(),
                skillsVersion: v.number(),
            }),
            companyAliasTokens: v.optional(v.string()),
            primaryRuleScore: v.optional(v.number()),
        })),
    },
    handler: async (ctx, args) => {
        await Promise.all(args.updates.map(async (update) => {
            const resume = await ctx.db.get(update.resumeId);
            if (!resume) return;

            const patch: Partial<Doc<"resumes">> = {
                ingestData: update.ingestData,
                primaryRuleScore: update.primaryRuleScore ?? 0,
            };

            const aliasTokens = update.companyAliasTokens?.trim().toLowerCase();
            if (aliasTokens) {
                const existingSearchText = resume.searchText || "";
                if (!existingSearchText.toLowerCase().includes(aliasTokens)) {
                    patch.searchText = existingSearchText
                        ? `${existingSearchText} ${aliasTokens}`
                        : aliasTokens;
                }
            }

            await ctx.db.patch(update.resumeId, patch);
        }));
    },
});

export const listUnprocessed = internalQuery({
    args: {
        limit: v.optional(v.number()),
    },
    handler: async (ctx, args) => {
        const limit = args.limit || 100;
        const resumes = await ctx.db
            .query("resumes")
            .filter((q) => q.eq(q.field("ingestData"), undefined))
            .take(limit);
        return resumes;
    },
});

export const listProcessedIds = internalQuery({
    args: {},
    handler: async (ctx) => {
        const resumes = await ctx.db.query("resumes").collect();
        return resumes
            .filter((resume) => resume.ingestData !== undefined)
            .map((resume) => resume._id);
    },
});

export const listStaleResumes = internalQuery({
    args: {
        currentVersion: v.number(),
        limit: v.optional(v.number()),
    },
    handler: async (ctx, args) => {
        const limit = args.limit || 100;
        const resumes = await ctx.db
            .query("resumes")
            .filter((q) => q.neq(q.field("ingestData"), undefined))
            .take(limit * 5);

        return resumes
            .filter((resume) => {
                const version = resume.ingestData?.skillsVersion;
                return typeof version !== "number" || version < args.currentVersion;
            })
            .slice(0, limit)
            .map((resume) => ({ _id: resume._id }));
    },
});
