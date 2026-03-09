import { internal } from "./_generated/api";
import { action, mutation } from "./_generated/server";
import type { Doc, Id } from "./_generated/dataModel";
import { v } from "convex/values";
import { buildWorkHistoryEvidence } from "@trends/shared";

import { buildSearchText } from "./search_text";
import { deriveResumeIdentityKey } from "./lib/resume_identity";
import { parseAgeFromContent } from "./lib/age";
import { DEFAULT_WORKSPACE_SLUG } from "./sessions";

const JOB5156_HOST = "hr.job5156.com";
const JOB5156_PROFILE_DISPLAY_PREFIX = `https://${JOB5156_HOST}/resume/view/`;
const PROFILE_URL_CONTENT_KEYS = ["profileUrl", "profile_url", "profileURL", "url"];

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === "object" && value !== null;
}

function decodeURIComponentSafe(value: string): string {
    try {
        return decodeURIComponent(value);
    } catch {
        return value;
    }
}

function extractJob5156ResumeId(pathname: string): string | null {
    const oldRouteMatch = pathname.match(/^\/api\/com\/resume\/([^/?#]+)/i);
    if (oldRouteMatch && oldRouteMatch[1]) {
        return decodeURIComponentSafe(oldRouteMatch[1]);
    }

    const viewRouteMatch = pathname.match(/^\/resume\/view\/([^/?#]+)/i);
    if (viewRouteMatch && viewRouteMatch[1]) {
        return decodeURIComponentSafe(viewRouteMatch[1]);
    }

    return null;
}

function normalizeJob5156ProfileUrlForDisplay(value: string): string | null {
    const trimmed = value.trim();
    if (!trimmed) {
        return null;
    }

    const directResumeId = extractJob5156ResumeId(trimmed);
    if (directResumeId) {
        return `${JOB5156_PROFILE_DISPLAY_PREFIX}${encodeURIComponent(directResumeId)}`;
    }

    let parsed: URL | null = null;
    try {
        parsed = new URL(trimmed);
    } catch {
        try {
            parsed = new URL(`https://${trimmed}`);
        } catch {
            parsed = null;
        }
    }

    if (!parsed || parsed.hostname.toLowerCase() !== JOB5156_HOST) {
        return null;
    }

    const resumeId = extractJob5156ResumeId(parsed.pathname);
    if (!resumeId) {
        return null;
    }

    return `${JOB5156_PROFILE_DISPLAY_PREFIX}${encodeURIComponent(resumeId)}`;
}

function rewriteJob5156ProfileUrlsInContent(content: unknown): {
    content: Record<string, unknown> | null;
    updatedFields: string[];
} {
    if (!isRecord(content)) {
        return {
            content: null,
            updatedFields: [],
        };
    }

    let nextContent: Record<string, unknown> | null = null;
    const updatedFields: string[] = [];

    for (const key of PROFILE_URL_CONTENT_KEYS) {
        const rawValue = content[key];
        if (typeof rawValue !== "string") {
            continue;
        }

        const normalized = normalizeJob5156ProfileUrlForDisplay(rawValue);
        if (!normalized || normalized === rawValue.trim()) {
            continue;
        }

        if (!nextContent) {
            nextContent = { ...content };
        }
        nextContent[key] = normalized;
        updatedFields.push(key);
    }

    return {
        content: nextContent,
        updatedFields,
    };
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

function analysisRichness(resume: Doc<"resumes">): number {
    let richness = 0;
    if (resume.analysis !== undefined) {
        richness += 1;
    }
    if (isRecord(resume.analyses)) {
        richness += Object.keys(resume.analyses).length;
    }
    return richness;
}

function resumeIdentityKey(resume: Doc<"resumes">): string {
    return resume.identityKey ?? deriveResumeIdentityKey({
        content: resume.content,
        externalId: resume.externalId,
    });
}

function sortForCanonical(resumes: Doc<"resumes">[]): Doc<"resumes">[] {
    return [...resumes].sort((left, right) => {
        if (left.crawledAt !== right.crawledAt) {
            return right.crawledAt - left.crawledAt;
        }
        const richnessDiff = analysisRichness(right) - analysisRichness(left);
        if (richnessDiff !== 0) {
            return richnessDiff;
        }
        return String(left._id).localeCompare(String(right._id));
    });
}

function mergeAnalyses(resumes: Doc<"resumes">[]): {
    analyses: Record<string, unknown>;
    analysis: Doc<"resumes">["analysis"];
} {
    const mergedAnalyses: Record<string, unknown> = {};
    let primaryAnalysis: Doc<"resumes">["analysis"] = undefined;

    for (const resume of resumes) {
        if (primaryAnalysis === undefined && resume.analysis !== undefined) {
            primaryAnalysis = resume.analysis;
        }

        if (!isRecord(resume.analyses)) {
            continue;
        }
        for (const [key, value] of Object.entries(resume.analyses)) {
            if (!(key in mergedAnalyses)) {
                mergedAnalyses[key] = value;
            }
        }
    }

    return {
        analyses: mergedAnalyses,
        analysis: primaryAnalysis,
    };
}

function groupDuplicatesByIdentity(resumes: Doc<"resumes">[]): Array<{
    identityKey: string;
    resumes: Doc<"resumes">[];
}> {
    const groups = new Map<string, Doc<"resumes">[]>();
    for (const resume of resumes) {
        const identityKey = resumeIdentityKey(resume);
        const bucket = groups.get(identityKey);
        if (bucket) {
            bucket.push(resume);
            continue;
        }
        groups.set(identityKey, [resume]);
    }

    return Array.from(groups.entries())
        .map(([identityKey, docs]) => ({ identityKey, resumes: docs }))
        .filter((group) => group.resumes.length > 1)
        .sort((left, right) => {
            if (left.resumes.length !== right.resumes.length) {
                return right.resumes.length - left.resumes.length;
            }
            return left.identityKey.localeCompare(right.identityKey);
        });
}

type BackfillIngestDataResult = {
    scheduled: number;
    batches: number;
    hasMore: boolean;
    message: string;
};

type ReIngestStaleSkillsVersionResult = {
    scheduled: number;
    batches: number;
    currentVersion: number;
    hasMore: boolean;
};

type ReIngestAllResumesResult = {
    scheduled: number;
    batches: number;
};

export const backfillSearchText = mutation({
    args: {},
    handler: async (ctx) => {
        const resumes = await ctx.db.query("resumes").collect();
        let count = 0;
        for (const resume of resumes) {
            if (resume.searchText) continue;

            const searchText = buildSearchText(resume.content);

            await ctx.db.patch(resume._id, { searchText });
            count++;
        }
        return `Backfilled ${count} resumes`;
    },
});

export const reindexSearchText = mutation({
    args: {},
    handler: async (ctx) => {
        const resumes = await ctx.db.query("resumes").collect();
        let count = 0;
        for (const resume of resumes) {
            const searchText = buildSearchText(resume.content);
            if (searchText !== resume.searchText) {
                await ctx.db.patch(resume._id, { searchText });
                count++;
            }
        }
        return `Reindexed ${count} resumes`;
    },
});

export const backfillAge = mutation({
    args: {},
    handler: async (ctx) => {
        const resumes = await ctx.db.query("resumes").collect();
        let updated = 0;

        for (const resume of resumes) {
            const parsedAge = parseAgeFromContent(resume.content);
            if (parsedAge === null || resume.age === parsedAge) {
                continue;
            }

            await ctx.db.patch(resume._id, { age: parsedAge });
            updated += 1;
        }

        return {
            scannedResumes: resumes.length,
            updated,
        };
    },
});

export const backfillWorkspaceSlugs = mutation({
    args: {},
    handler: async (ctx) => {
        const defaultWorkspace = DEFAULT_WORKSPACE_SLUG;
        let patchedJobDescriptions = 0;
        let patchedSearchProfiles = 0;
        let patchedScreeningSessions = 0;
        let patchedSearchHistory = 0;

        const customJobDescriptions = await ctx.db
            .query("job_descriptions")
            .filter((q) => q.eq(q.field("type"), "custom"))
            .collect();

        for (const record of customJobDescriptions) {
            if (typeof record.workspaceSlug === "string" && record.workspaceSlug.trim()) {
                continue;
            }
            await ctx.db.patch(record._id, { workspaceSlug: defaultWorkspace });
            patchedJobDescriptions += 1;
        }

        const searchProfiles = await ctx.db.query("search_profiles").collect();
        for (const record of searchProfiles) {
            if (typeof record.workspaceSlug === "string" && record.workspaceSlug.trim()) {
                continue;
            }
            await ctx.db.patch(record._id, { workspaceSlug: defaultWorkspace });
            patchedSearchProfiles += 1;
        }

        const screeningSessions = await ctx.db.query("screening_sessions").collect();
        for (const record of screeningSessions) {
            if (typeof record.workspaceSlug === "string" && record.workspaceSlug.trim()) {
                continue;
            }
            await ctx.db.patch(record._id, { workspaceSlug: defaultWorkspace });
            patchedScreeningSessions += 1;
        }

        const searchHistory = await ctx.db.query("search_history").collect();
        for (const record of searchHistory) {
            if (typeof record.workspaceSlug === "string" && record.workspaceSlug.trim()) {
                continue;
            }
            await ctx.db.patch(record._id, { workspaceSlug: defaultWorkspace });
            patchedSearchHistory += 1;
        }

        return {
            defaultWorkspace,
            patchedJobDescriptions,
            patchedSearchProfiles,
            patchedScreeningSessions,
            patchedSearchHistory,
        };
    },
});

export const backfillIngestData = action({
    args: {
        limit: v.optional(v.number()),
    },
    handler: async (ctx, args): Promise<BackfillIngestDataResult> => {
        const limit = Math.max(1, Math.min(args.limit ?? 100, 500));
        const unprocessed: Array<Pick<Doc<"resumes">, "_id">> = await ctx.runQuery(internal.resumes.listUnprocessed, { limit });
        const resumeIds: Id<"resumes">[] = unprocessed.map((resume: Pick<Doc<"resumes">, "_id">) => resume._id);

        if (resumeIds.length === 0) {
            return {
                scheduled: 0,
                batches: 0,
                hasMore: false,
                message: "No unprocessed resumes remaining",
            };
        }

        const batchSize = 50;
        let batches = 0;

        for (let index = 0; index < resumeIds.length; index += batchSize) {
            const chunk = resumeIds.slice(index, index + batchSize);
            await ctx.scheduler.runAfter(0, internal.ingest_agent.processNewResumes, {
                resumeIds: chunk,
            });
            batches += 1;
        }

        return {
            scheduled: resumeIds.length,
            batches,
            hasMore: resumeIds.length === limit,
            message: `Scheduled ingest backfill for ${resumeIds.length} resumes in ${batches} batch(es)`,
        };
    },
});

export const backfillPrimaryRuleScore = mutation({
    args: {},
    handler: async (ctx) => {
        const resumes = await ctx.db.query("resumes").collect();
        let updated = 0;

        for (const resume of resumes) {
            if (resume.primaryRuleScore !== undefined) {
                continue;
            }

            const scores = toRuleScores(resume.ingestData?.ruleScores);
            const values = Object.values(scores);
            const primaryRuleScore = values.length > 0 ? Math.max(...values) : 0;
            await ctx.db.patch(resume._id, { primaryRuleScore });
            updated += 1;
        }

        return `Backfilled ${updated} resumes`;
    },
});

export const backfillEvidenceText = mutation({
    args: {},
    handler: async (ctx) => {
        const resumes = await ctx.db.query("resumes").collect();
        let patched = 0;

        for (const resume of resumes) {
            if (!resume.ingestData || typeof resume.ingestData.evidenceText === "string") {
                continue;
            }

            await ctx.db.patch(resume._id, {
                ingestData: {
                    ...resume.ingestData,
                    evidenceText: buildWorkHistoryEvidence(resume.content).text,
                },
            });
            patched += 1;
        }

        return {
            scannedResumes: resumes.length,
            patched,
        };
    },
});

export const backfillJob5156ProfileUrls = mutation({
    args: {},
    handler: async (ctx) => {
        const resumes = await ctx.db.query("resumes").collect();
        let updatedResumes = 0;
        let updatedProfileFields = 0;

        for (const resume of resumes) {
            const rewritten = rewriteJob5156ProfileUrlsInContent(resume.content);
            if (!rewritten.content) {
                continue;
            }

            const searchText = buildSearchText(rewritten.content);
            await ctx.db.patch(resume._id, {
                content: rewritten.content,
                searchText,
            });

            updatedResumes += 1;
            updatedProfileFields += rewritten.updatedFields.length;
        }

        return {
            scannedResumes: resumes.length,
            updatedResumes,
            updatedProfileFields,
        };
    },
});

export const reIngestStaleSkillsVersion = action({
    args: {
        limit: v.optional(v.number()),
    },
    handler: async (ctx, args): Promise<ReIngestStaleSkillsVersionResult> => {
        return await ctx.runAction(internal.ingest_agent.reIngestStaleResumes, {
            limit: args.limit,
        });
    },
});

export const reIngestAllResumes = action({
    args: {},
    handler: async (ctx): Promise<ReIngestAllResumesResult> => {
        return await ctx.runAction(internal.ingest_agent.reIngestAllResumes, {});
    },
});

export const auditDuplicateResumesByIdentity = mutation({
    args: {},
    handler: async (ctx) => {
        const resumes = await ctx.db.query("resumes").collect();
        const duplicateGroups = groupDuplicatesByIdentity(resumes);

        const groups = duplicateGroups.map((group) => {
            const ordered = sortForCanonical(group.resumes);
            const canonical = ordered[0];
            const duplicates = ordered.slice(1);
            return {
                identityKey: group.identityKey,
                count: group.resumes.length,
                canonicalId: String(canonical._id),
                duplicateIds: duplicates.map((resume) => String(resume._id)),
            };
        });

        return {
            scannedResumes: resumes.length,
            duplicateGroupCount: groups.length,
            duplicateResumeCount: groups.reduce((sum, group) => sum + group.duplicateIds.length, 0),
            groups,
        };
    },
});

export const mergeDuplicateResumesByIdentity = mutation({
    args: {
        dryRun: v.boolean(),
        batchSize: v.number(),
    },
    handler: async (ctx, args) => {
        const resumes = await ctx.db.query("resumes").collect();
        const duplicateGroups = groupDuplicatesByIdentity(resumes);
        const effectiveBatchSize = Math.max(1, Math.trunc(args.batchSize));
        const targetGroups = duplicateGroups.slice(0, effectiveBatchSize);

        let deleted = 0;
        let patchedCanonicals = 0;

        const groups: Array<{
            identityKey: string;
            canonicalId: string;
            duplicateIds: string[];
            duplicateCount: number;
            mergedTagCount: number;
            mergedAnalysisCount: number;
        }> = [];
        for (const group of targetGroups) {
            const ordered = sortForCanonical(group.resumes);
            const canonical = ordered[0];
            const duplicates = ordered.slice(1);

            const mergedTags = Array.from(new Set(ordered.flatMap((resume) => resume.tags)));
            const mergedAnalysis = mergeAnalyses(ordered);

            if (!args.dryRun) {
                const patch: {
                    identityKey: string;
                    tags: string[];
                    analyses?: Record<string, unknown>;
                    analysis?: Doc<"resumes">["analysis"];
                } = {
                    identityKey: group.identityKey,
                    tags: mergedTags,
                };

                if (Object.keys(mergedAnalysis.analyses).length > 0) {
                    patch.analyses = mergedAnalysis.analyses;
                }
                if (mergedAnalysis.analysis !== undefined) {
                    patch.analysis = mergedAnalysis.analysis;
                }

                await ctx.db.patch(canonical._id, patch);
                patchedCanonicals += 1;

                for (const duplicate of duplicates) {
                    await ctx.db.delete(duplicate._id);
                    deleted += 1;
                }
            }

            groups.push({
                identityKey: group.identityKey,
                canonicalId: String(canonical._id),
                duplicateIds: duplicates.map((resume) => String(resume._id)),
                duplicateCount: duplicates.length,
                mergedTagCount: mergedTags.length,
                mergedAnalysisCount: Object.keys(mergedAnalysis.analyses).length,
            });
        }

        return {
            dryRun: args.dryRun,
            scannedResumes: resumes.length,
            duplicateGroupCount: duplicateGroups.length,
            processedGroupCount: targetGroups.length,
            patchedCanonicals,
            deleted,
            groups,
        };
    },
});
