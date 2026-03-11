import { internalMutation, internalQuery, mutation, query } from "./_generated/server";
import type { Doc } from "./_generated/dataModel";
import { v } from "convex/values";

import { mergeSearchTextWithIngestData } from "./search_text";

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

function splitQueryTokens(query: string): string[] {
    return query
        .trim()
        .toLowerCase()
        .split(/\s+/)
        .filter((token) => token.length >= 1);
}

function matchesAllTokens(searchText: string | undefined, tokens: string[]): boolean {
    if (tokens.length <= 1) {
        return true;
    }
    const normalizedText = (searchText || "").toLowerCase();
    return tokens.every((token) => normalizedText.includes(token));
}

type MatchSource = "searchText" | "industryTags" | "companyHits" | "synonymHits";

type SearchProvenance = {
    term: string;
    source: MatchSource;
    expandedFrom?: string;
};

function dedupeProvenance(items: SearchProvenance[]): SearchProvenance[] {
    const seen = new Set<string>();
    const deduped: SearchProvenance[] = [];

    for (const item of items) {
        const key = `${item.source}|${item.term}|${item.expandedFrom ?? ""}`;
        if (seen.has(key)) {
            continue;
        }
        seen.add(key);
        deduped.push(item);
    }

    return deduped;
}

function addProvenance(
    target: Map<string, SearchProvenance[]>,
    key: string,
    provenance: SearchProvenance
): void {
    const existing = target.get(key);
    if (existing) {
        existing.push(provenance);
        return;
    }
    target.set(key, [provenance]);
}

function compareResumes(
    left: Doc<"resumes">,
    right: Doc<"resumes">,
    jobDescriptionId: string | undefined
): number {
    const ruleDiff = getIngestRuleScore(right, jobDescriptionId) - getIngestRuleScore(left, jobDescriptionId);
    if (ruleDiff !== 0) {
        return ruleDiff;
    }

    const primaryRuleDiff = (right.primaryRuleScore || 0) - (left.primaryRuleScore || 0);
    if (primaryRuleDiff !== 0) {
        return primaryRuleDiff;
    }

    return right.crawledAt - left.crawledAt;
}

function mergeResumeDocs(
    docs: Doc<"resumes">[],
    provenanceByResumeId: Map<string, SearchProvenance[]>,
    jobDescriptionId: string | undefined,
    limit: number
): Array<{ resume: Doc<"resumes">; provenance: SearchProvenance[] }> {
    const merged = new Map<string, { resume: Doc<"resumes">; provenance: SearchProvenance[] }>();

    for (const doc of docs) {
        const identityKey = typeof doc.identityKey === "string" && doc.identityKey.trim().length > 0
            ? doc.identityKey
            : String(doc._id);
        const incomingProvenance = provenanceByResumeId.get(String(doc._id)) ?? [];
        const existing = merged.get(identityKey);

        if (!existing) {
            merged.set(identityKey, {
                resume: doc,
                provenance: dedupeProvenance(incomingProvenance),
            });
            continue;
        }

        const preferredResume = compareResumes(existing.resume, doc, jobDescriptionId) <= 0
            ? existing.resume
            : doc;
        merged.set(identityKey, {
            resume: preferredResume,
            provenance: dedupeProvenance([...existing.provenance, ...incomingProvenance]),
        });
    }

    return Array.from(merged.values())
        .sort((left, right) => {
            if (right.provenance.length !== left.provenance.length) {
                return right.provenance.length - left.provenance.length;
            }
            return compareResumes(left.resume, right.resume, jobDescriptionId);
        })
        .slice(0, limit);
}

export const count = query({
    args: {},
    handler: async (ctx) => {
        const docs = await ctx.db.query("resumes").collect();
        return docs.length;
    },
});

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
        const tokens = splitQueryTokens(args.query);
        const fetchLimit = tokens.length > 1 ? Math.max(limit * 5, 500) : limit;

        const matches = await ctx.db
            .query("resumes")
            .withSearchIndex("search_body", (q) => q.search("searchText", args.query))
            .take(fetchLimit);

        // Convex full-text search uses OR. Post-filter to enforce AND.
        const filtered = tokens.length > 1
            ? matches.filter((doc) => matchesAllTokens(doc.searchText, tokens))
            : matches;

        return filtered.slice(0, limit);
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
        const tokens = splitQueryTokens(args.query);
        // Over-fetch to compensate for AND post-filtering on OR results
        const fetchLimit = tokens.length > 1 ? Math.max(limit * 5, 500) : Math.max(limit, 200);

        const matches = await ctx.db
            .query("resumes")
            .withSearchIndex("search_body", (q) => q.search("searchText", args.query))
            .take(fetchLimit);

        // Convex full-text search uses OR. Post-filter to enforce AND.
        const filtered = tokens.length > 1
            ? matches.filter((doc) => matchesAllTokens(doc.searchText, tokens))
            : matches;

        if (!jobDescriptionId) {
            return filtered.slice(0, limit);
        }

        return sortByIngestRuleScore(filtered, jobDescriptionId).slice(0, limit);
    },
});

export const searchWithTagExpansion = query({
    args: {
        query: v.string(),
        keywordGroups: v.array(v.object({
            original: v.string(),
            variants: v.array(v.string()),
        })),
        mode: v.optional(v.union(v.literal("AND"), v.literal("OR"))),
        sourceMappings: v.optional(v.array(v.object({
            term: v.string(),
            expandedFrom: v.string(),
        }))),
        limit: v.optional(v.number()),
        jobDescriptionId: v.optional(v.string()),
    },
    handler: async (ctx, args) => {
        const limit = args.limit || 50;
        const jobDescriptionId = args.jobDescriptionId?.trim() || undefined;
        const mode = args.mode ?? "AND";
        const keywordGroups = args.keywordGroups
            .map((group) => ({
                original: group.original.trim().toLowerCase(),
                variants: Array.from(
                    new Set(
                        group.variants
                            .map((term) => term.trim().toLowerCase())
                            .filter((term) => term.length >= 2)
                    )
                ),
            }))
            .filter((group) => group.original.length >= 1 && group.variants.length > 0);
        const expandedTerms = Array.from(new Set(keywordGroups.flatMap((group) => group.variants)));

        if (expandedTerms.length === 0 || keywordGroups.length === 0) {
            return {
                expansion: {
                    original: args.query,
                    expanded: [],
                    groups: [],
                    mode,
                },
                results: [],
            };
        }

        const sourceMapping = Object.fromEntries(
            (args.sourceMappings ?? []).map((entry) => [entry.term, entry.expandedFrom])
        );
        const provenanceByResumeId = new Map<string, SearchProvenance[]>();
        const matchedDocsById = new Map<string, Doc<"resumes">>();
        const fetchLimit = Math.max(limit * Math.max(keywordGroups.length, 2), 100);

        for (const term of expandedTerms) {
            const matches = await ctx.db
                .query("resumes")
                .withSearchIndex("search_body", (q) => q.search("searchText", term))
                .take(fetchLimit);

            for (const match of matches) {
                const matchId = String(match._id);
                matchedDocsById.set(matchId, match);
                addProvenance(provenanceByResumeId, matchId, {
                    term,
                    source: "searchText",
                    expandedFrom: sourceMapping[term],
                });
            }
        }

        const filteredDocs = Array.from(matchedDocsById.values()).filter((doc) => {
            const normalizedSearchText = (doc.searchText || "").toLowerCase();

            const groupMatched = (group: { variants: string[] }): boolean =>
                group.variants.some((variant) => normalizedSearchText.includes(variant));

            return mode === "AND"
                ? keywordGroups.every(groupMatched)
                : keywordGroups.some(groupMatched);
        });

        return {
            expansion: {
                original: args.query,
                expanded: expandedTerms,
                groups: keywordGroups,
                mode,
            },
            results: mergeResumeDocs(filteredDocs, provenanceByResumeId, jobDescriptionId, limit),
        };
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
            analyzedAt: v.optional(v.number()),
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
                analyzedAt: v.optional(v.number()),
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
            evidenceText: v.optional(v.string()),
            industryTags: v.array(v.string()),
            synonymHits: v.array(v.string()),
            brandHits: v.optional(v.array(v.object({
                brand: v.string(),
                role: v.string(),
                source: v.string(),
                context: v.string(),
                companyId: v.optional(v.number()),
            }))),
            companyHits: v.optional(v.array(v.string())),
            roleSignals: v.optional(v.array(v.object({
                type: v.string(),
                matchedSignals: v.array(v.string()),
                signalCount: v.number(),
                occurrences: v.number(),
                years: v.number(),
                industryVerifiedYears: v.optional(v.number()),
                verifyIn: v.string(),
            }))),
            tagEnvelope: v.optional(v.array(v.object({
                tag: v.string(),
                source: v.string(),
                confidence: v.number(),
                evidence: v.array(v.string()),
                version: v.number(),
            }))),
            taggingEnvelope: v.optional(v.object({
                schemaVersion: v.number(),
                generatedAt: v.number(),
                entries: v.array(v.object({
                    tag: v.string(),
                    source: v.string(),
                    confidence: v.number(),
                    version: v.number(),
                    provenance: v.object({
                        stage: v.string(),
                        generatedBy: v.string(),
                        evidence: v.array(v.string()),
                    }),
                })),
            })),
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

        const existingSearchText = resume.searchText || "";
        const nextSearchText = mergeSearchTextWithIngestData(existingSearchText, {
            industryTags: args.ingestData.industryTags,
            synonymHits: args.ingestData.synonymHits,
            companyHits: args.ingestData.companyHits,
            companyAliasTokens: args.companyAliasTokens?.trim().toLowerCase(),
        });

        if (nextSearchText !== existingSearchText) {
            patch.searchText = nextSearchText;
        }

        await ctx.db.patch(args.resumeId, patch);
    },
});

export const updateIngestDataBatch = internalMutation({
    args: {
        updates: v.array(v.object({
            resumeId: v.id("resumes"),
            ingestData: v.object({
                evidenceText: v.optional(v.string()),
                industryTags: v.array(v.string()),
                synonymHits: v.array(v.string()),
                brandHits: v.optional(v.array(v.object({
                    brand: v.string(),
                    role: v.string(),
                    source: v.string(),
                    context: v.string(),
                    companyId: v.optional(v.number()),
                }))),
                companyHits: v.optional(v.array(v.string())),
                roleSignals: v.optional(v.array(v.object({
                    type: v.string(),
                    matchedSignals: v.array(v.string()),
                    signalCount: v.number(),
                    occurrences: v.number(),
                    years: v.number(),
                    industryVerifiedYears: v.optional(v.number()),
                    verifyIn: v.string(),
                }))),
                tagEnvelope: v.optional(v.array(v.object({
                    tag: v.string(),
                    source: v.string(),
                    confidence: v.number(),
                    evidence: v.array(v.string()),
                    version: v.number(),
                }))),
                taggingEnvelope: v.optional(v.object({
                    schemaVersion: v.number(),
                    generatedAt: v.number(),
                    entries: v.array(v.object({
                        tag: v.string(),
                        source: v.string(),
                        confidence: v.number(),
                        version: v.number(),
                        provenance: v.object({
                            stage: v.string(),
                            generatedBy: v.string(),
                            evidence: v.array(v.string()),
                        }),
                    })),
                })),
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

            const existingSearchText = resume.searchText || "";
            const nextSearchText = mergeSearchTextWithIngestData(existingSearchText, {
                industryTags: update.ingestData.industryTags,
                synonymHits: update.ingestData.synonymHits,
                companyHits: update.ingestData.companyHits,
                companyAliasTokens: update.companyAliasTokens?.trim().toLowerCase(),
            });

            if (nextSearchText !== existingSearchText) {
                patch.searchText = nextSearchText;
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

export const clearAnalyses = mutation({
    args: {
        resumeIds: v.optional(v.array(v.id("resumes"))),
        jobDescriptionId: v.optional(v.string()),
    },
    handler: async (ctx, args) => {
        const resumes = args.resumeIds
            ? await Promise.all(args.resumeIds.map((id) => ctx.db.get(id)))
            : await ctx.db.query("resumes").collect();

        let cleared = 0;
        for (const resume of resumes) {
            if (!resume) continue;
            if (!resume.analysis && !resume.analyses) continue;

            if (args.jobDescriptionId && resume.analyses) {
                const analyses = { ...resume.analyses };
                if (analyses[args.jobDescriptionId]) {
                    delete analyses[args.jobDescriptionId];
                    const isCurrentAnalysis = resume.analysis?.jobDescriptionId === args.jobDescriptionId;
                    await ctx.db.patch(resume._id, {
                        analyses,
                        ...(isCurrentAnalysis ? { analysis: undefined } : {}),
                    });
                    cleared += 1;
                }
            } else {
                await ctx.db.patch(resume._id, {
                    analysis: undefined,
                    analyses: undefined,
                });
                cleared += 1;
            }
        }

        return { cleared };
    },
});
