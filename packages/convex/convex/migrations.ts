import { mutation } from "./_generated/server";
import type { Doc } from "./_generated/dataModel";
import { v } from "convex/values";
import { buildSearchText } from "./search_text";
import { deriveResumeIdentityKey } from "./lib/resume_identity";

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === "object" && value !== null;
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
