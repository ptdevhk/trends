import { v } from "convex/values";
import { mutation, query, type MutationCtx } from "./_generated/server";
import { resumeFiltersValidator } from "./validators.js";

export const DEFAULT_WORKSPACE_SLUG = "dev";

type CollectionSource = {
    type: "job5156" | "51job" | "seek";
    exactUrl?: string;
};

function normalizeWorkspaceSlug(input: string | undefined): string {
    const normalized = input?.trim();
    return normalized && normalized.length > 0 ? normalized : DEFAULT_WORKSPACE_SLUG;
}

function normalizeOptionalString(input: string | undefined): string | undefined {
    const normalized = input?.trim();
    return normalized && normalized.length > 0 ? normalized : undefined;
}

function normalizeStringList(values: string[] | undefined): string[] {
    if (!Array.isArray(values) || values.length === 0) {
        return [];
    }

    const seen = new Set<string>();
    const normalized: string[] = [];

    values.forEach((value) => {
        const token = value.trim();
        if (!token || seen.has(token)) {
            return;
        }
        seen.add(token);
        normalized.push(token);
    });

    return normalized;
}

function normalizeCollectionSource(
    input: CollectionSource | undefined,
): CollectionSource | undefined {
    const type = input?.type;
    if (type === "job5156" || type === "51job") {
        return { type };
    }

    const exactUrl = normalizeOptionalString(
        type === "seek" ? input?.exactUrl : undefined,
    );
    if (type === "seek") {
        return exactUrl ? { type, exactUrl } : { type };
    }

    return undefined;
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

function buildHistoryTitle(location: string, keywords: string[]): string {
    const normalizedLocation = location.trim();
    const normalizedKeywords = normalizeStringList(keywords);
    const parts = [normalizedLocation, normalizedKeywords.join(" ")].filter((value) => value.length > 0);
    return parts.join(" · ") || "Untitled search";
}

function sortByHistoryRecency<T extends { createdAt: number; lastOpenedAt?: number }>(records: T[]): T[] {
    return [...records].sort((left, right) => {
        const leftTimestamp = left.lastOpenedAt ?? left.createdAt;
        const rightTimestamp = right.lastOpenedAt ?? right.createdAt;
        return rightTimestamp - leftTimestamp;
    });
}

const INDUSTRY_DB_V2_COHORT_MAX_SIZE = 2000;
const INDUSTRY_DB_V2_HISTOGRAM_SIZE = 51;

function roundTo2(value: number): number {
    return Number(value.toFixed(2));
}

function clampIndustryDbV2RawScore(value: number): number {
    if (!Number.isFinite(value)) {
        return 0;
    }
    return Math.max(0, Math.min(50, value));
}

function quantile(sorted: number[], q: number): number {
    if (sorted.length === 0) {
        return 0;
    }

    const clampedQ = Math.max(0, Math.min(1, q));
    const position = (sorted.length - 1) * clampedQ;
    const lowerIndex = Math.floor(position);
    const upperIndex = Math.ceil(position);
    if (lowerIndex === upperIndex) {
        return sorted[lowerIndex];
    }

    const weight = position - lowerIndex;
    return sorted[lowerIndex] * (1 - weight) + sorted[upperIndex] * weight;
}

async function buildIndustryDbV2Cohort(
    ctx: MutationCtx,
    resumeIds: string[],
): Promise<{
    size: number;
    min: number;
    max: number;
    p50: number;
    p80: number;
    mean: number;
    stddev: number;
    histogram50: number[];
} | null> {
    const limitedResumeIds = normalizeStringList(resumeIds).slice(0, INDUSTRY_DB_V2_COHORT_MAX_SIZE);
    if (limitedResumeIds.length === 0) {
        return null;
    }

    const resumes = await Promise.all(limitedResumeIds.map((resumeId) => ctx.db.get(resumeId as never)));
    const sorted = resumes
        .map((resume) => clampIndustryDbV2RawScore((resume as { ingestData?: { industryDbV2Raw?: number } } | null)?.ingestData?.industryDbV2Raw ?? 0))
        .sort((left: number, right: number) => left - right);
    const histogram50 = Array.from({ length: INDUSTRY_DB_V2_HISTOGRAM_SIZE }, () => 0);
    sorted.forEach((score: number) => {
        histogram50[Math.round(score)] += 1;
    });
    const mean = sorted.reduce((total: number, score: number) => total + score, 0) / sorted.length;
    const variance = sorted.reduce((total: number, score: number) => total + ((score - mean) ** 2), 0) / sorted.length;

    return {
        size: sorted.length,
        min: roundTo2(sorted[0] ?? 0),
        max: roundTo2(sorted[sorted.length - 1] ?? 0),
        p50: roundTo2(quantile(sorted, 0.5)),
        p80: roundTo2(quantile(sorted, 0.8)),
        mean: roundTo2(mean),
        stddev: roundTo2(Math.sqrt(variance)),
        histogram50,
    };
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
            .withIndex("by_sessionKey_workspace", (q) => q.eq("sessionKey", args.sessionKey).eq("workspaceSlug", workspaceSlug))
            .filter((q) => q.eq(q.field("status"), "active"))
            .take(10);

        return sessions
            .sort((left, right) => right.lastActive - left.lastActive)[0] ?? null;
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
        collectionSource: v.optional(v.object({
            type: v.union(v.literal("job5156"), v.literal("51job"), v.literal("seek")),
            exactUrl: v.optional(v.string()),
        })),
        filters: resumeFiltersValidator,
    },
    handler: async (ctx, args) => {
        const workspaceSlug = normalizeWorkspaceSlug(args.workspaceSlug);
        const existingSessions = await ctx.db
            .query("screening_sessions")
            .withIndex("by_sessionKey_workspace", (q) => q.eq("sessionKey", args.sessionKey).eq("workspaceSlug", workspaceSlug))
            .filter((q) => q.eq(q.field("status"), "active"))
            .collect();
        const existing = existingSessions[0];

        const sessionData = {
            sessionKey: args.sessionKey,
            status: "active" as const,
            config: {
                location: args.location,
                keywords: args.keywords,
                jobDescriptionId: args.jobDescriptionId,
                collectionSource: normalizeCollectionSource(args.collectionSource),
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
            .withIndex("by_sessionKey_workspace", (q) => q.eq("sessionKey", args.sessionKey).eq("workspaceSlug", workspaceSlug))
            .filter((q) => q.eq(q.field("status"), "active"))
            .take(10);
        const session = sessions[0];

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
            .withIndex("by_sessionKey_workspace", (q) => q.eq("sessionKey", args.sessionKey).eq("workspaceSlug", workspaceSlug))
            .filter((q) => q.eq(q.field("status"), "active"))
            .take(10);
        const session = sessions[0];

        if (session) {
            await ctx.db.patch(session._id, { status: "archived" });
        }
        return null;
    },
});

export const listSearchHistory = query({
    args: {
        workspaceSlug: v.optional(v.string()),
    },
    handler: async (ctx, args) => {
        const workspaceSlug = normalizeWorkspaceSlug(args.workspaceSlug);
        const records = await ctx.db
            .query("search_history")
            .withIndex("by_workspace", (q) => q.eq("workspaceSlug", workspaceSlug))
            .order("desc")
            .take(200);

        const cohorts = await ctx.db
            .query("industry_db_cohorts")
            .withIndex("by_workspace", (q) => q.eq("workspaceSlug", workspaceSlug))
            .take(200);
        const cohortBySearchHistoryId = new Map(cohorts.map((cohort) => [String(cohort.searchHistoryId), cohort]));

        return sortByHistoryRecency(records
            .map((record) => {
                const cohort = cohortBySearchHistoryId.get(String(record._id));
                return {
                    ...record,
                    industryDbV2Stats: cohort
                        ? {
                            size: cohort.size,
                            min: cohort.min,
                            max: cohort.max,
                            p50: cohort.p50,
                            p80: cohort.p80,
                            mean: cohort.mean,
                            stddev: cohort.stddev,
                            histogram50: cohort.histogram50,
                        }
                        : undefined,
                };
            }));
    },
});

export const recentSearches = query({
    args: {
        sessionKey: v.string(),
        workspaceSlug: v.optional(v.string()),
        limit: v.optional(v.number()),
    },
    handler: async (ctx, args) => {
        const workspaceSlug = normalizeWorkspaceSlug(args.workspaceSlug);
        const limit = Math.max(1, Math.min(Math.floor(args.limit ?? 10), 10));
        const records = await ctx.db
            .query("search_history")
            .withIndex("by_sessionKey_workspace", (q) => q.eq("sessionKey", args.sessionKey).eq("workspaceSlug", workspaceSlug))
            .take(limit * 2);

        return sortByHistoryRecency(records).slice(0, limit);
    },
});

export const saveSearchHistory = mutation({
    args: {
        sessionKey: v.string(),
        workspaceSlug: v.optional(v.string()),
        title: v.optional(v.string()),
        location: v.string(),
        keywords: v.array(v.string()),
        jobDescriptionId: v.optional(v.string()),
        collectionSource: v.optional(v.object({
            type: v.union(v.literal("job5156"), v.literal("51job"), v.literal("seek")),
            exactUrl: v.optional(v.string()),
        })),
        filters: resumeFiltersValidator,
        selectedTags: v.optional(v.array(v.string())),
        selectedCompanies: v.optional(v.array(v.string())),
        selectedExperienceLevel: v.optional(v.string()),
        collectionTaskId: v.optional(v.string()),
        analysisTaskId: v.optional(v.string()),
        notes: v.optional(v.string()),
        resumeIds: v.optional(v.array(v.string())),
    },
    handler: async (ctx, args) => {
        const workspaceSlug = normalizeWorkspaceSlug(args.workspaceSlug);
        const location = args.location.trim();
        const keywords = normalizeStringList(args.keywords);
        const title = normalizeOptionalString(args.title) ?? buildHistoryTitle(location, keywords);
        const jobDescriptionId = normalizeOptionalString(args.jobDescriptionId);
        const collectionSource = normalizeCollectionSource(args.collectionSource);
        const selectedTags = normalizeStringList(args.selectedTags);
        const selectedCompanies = normalizeStringList(args.selectedCompanies);
        const selectedExperienceLevel = normalizeOptionalString(args.selectedExperienceLevel);
        const collectionTaskId = normalizeOptionalString(args.collectionTaskId);
        const analysisTaskId = normalizeOptionalString(args.analysisTaskId);
        const notes = normalizeOptionalString(args.notes);
        const now = Date.now();

        const searchHistoryId = await ctx.db.insert("search_history", {
            sessionKey: args.sessionKey,
            title,
            location,
            keywords,
            jobDescriptionId,
            collectionSource,
            filters: args.filters,
            selectedTags,
            selectedCompanies,
            selectedExperienceLevel,
            collectionTaskId,
            analysisTaskId,
            notes,
            workspaceSlug,
            createdAt: now,
            lastOpenedAt: undefined,
        });

        const cohort = await buildIndustryDbV2Cohort(ctx, args.resumeIds ?? []);
        if (cohort) {
            await ctx.db.insert("industry_db_cohorts", {
                searchHistoryId,
                workspaceSlug,
                computedAt: now,
                size: cohort.size,
                min: cohort.min,
                max: cohort.max,
                p50: cohort.p50,
                p80: cohort.p80,
                mean: cohort.mean,
                stddev: cohort.stddev,
                histogram50: cohort.histogram50,
            });
        }

        return searchHistoryId;
    },
});

export const markSearchHistoryOpened = mutation({
    args: {
        id: v.id("search_history"),
        workspaceSlug: v.optional(v.string()),
    },
    handler: async (ctx, args) => {
        const workspaceSlug = normalizeWorkspaceSlug(args.workspaceSlug);
        const record = await ctx.db.get(args.id);

        if (!record || !belongsToWorkspace(record.workspaceSlug, workspaceSlug)) {
            return null;
        }

        await ctx.db.patch(record._id, {
            lastOpenedAt: Date.now(),
        });

        return record._id;
    },
});
