import { internalMutation, internalQuery, mutation, query } from "./_generated/server";
import type { Doc } from "./_generated/dataModel";
import { paginationOptsValidator } from "convex/server";
import { v } from "convex/values";

import { mergeSearchTextWithIngestData } from "./search_text";

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === "object" && value !== null;
}

function toStringValue(value: unknown): string {
    if (typeof value === "string") {
        return value.trim();
    }
    if (value === null || value === undefined) {
        return "";
    }
    return String(value).trim();
}

function toOptionalStringValue(value: unknown): string | undefined {
    const normalized = toStringValue(value);
    return normalized.length > 0 ? normalized : undefined;
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

type TagExpansionKeywordGroup = {
    original: string;
    variants: string[];
};

type MatchSource = "searchText" | "industryTags" | "companyHits" | "synonymHits";

type SearchProvenance = {
    term: string;
    source: MatchSource;
    expandedFrom?: string;
};

type IngestDiagnosticsBrandHit = {
    brand: string;
    role: string;
    source: string;
    context: string;
};

type IngestDiagnosticsTaggingEntry = {
    tag: string;
    source: string;
    confidence: number;
    provenance: {
        stage: string;
        evidence: string[];
    };
};

export type IngestDiagnosticsRow = {
    resumeId: string;
    externalId: string;
    name: string;
    jobIntention: string;
    location: string;
    ingestData?: {
        industryTags: string[];
        companyHits: string[];
        brandHits: IngestDiagnosticsBrandHit[];
        experienceLevel: string;
        ruleScoreCount: number;
        computedAt: number;
        skillsVersion: number;
        taggingEntries: IngestDiagnosticsTaggingEntry[];
    };
};

export type ResumeScanRow = {
    _id: Doc<"resumes">["_id"];
    content: Doc<"resumes">["content"];
    ingestData: Doc<"resumes">["ingestData"];
    primaryRuleScore: Doc<"resumes">["primaryRuleScore"];
    searchText: Doc<"resumes">["searchText"];
};

const DEFAULT_RESUME_LIMIT = 50;
export const MAX_SAFE_LIST_WITH_INGEST_LIMIT = 200;
export const MAX_SAFE_LIST_WITH_INGEST_OVERFETCH = 400;
const MAX_INGEST_DIAGNOSTICS_PAGE_SIZE = 100;
const MAX_INGEST_DIAGNOSTICS_TAGGING_ENTRIES = 8;
const DEFAULT_RESUME_SCAN_BATCH_SIZE = 25;
const MAX_RESUME_SCAN_BATCH_SIZE = 50;

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

function countRuleScores(value: unknown): number {
    return Object.keys(toRuleScores(value)).length;
}

function projectIngestDiagnosticsBrandHits(
    brandHits: NonNullable<Doc<"resumes">["ingestData"]>["brandHits"]
): IngestDiagnosticsBrandHit[] {
    return (brandHits ?? []).map((hit) => ({
        brand: hit.brand,
        role: hit.role,
        source: hit.source,
        context: hit.context,
    }));
}

function projectIngestDiagnosticsTaggingEntries(
    taggingEnvelope: NonNullable<Doc<"resumes">["ingestData"]>["taggingEnvelope"]
): IngestDiagnosticsTaggingEntry[] {
    return taggingEnvelope?.entries.slice(0, MAX_INGEST_DIAGNOSTICS_TAGGING_ENTRIES).map((entry) => ({
        tag: entry.tag,
        source: entry.source,
        confidence: entry.confidence,
        provenance: {
            stage: entry.provenance.stage,
            evidence: entry.provenance.evidence,
        },
    })) ?? [];
}

export function projectIngestDiagnosticsRow(
    resume: {
        _id: string;
        externalId: string;
        content: unknown;
        ingestData?: Doc<"resumes">["ingestData"];
    }
): IngestDiagnosticsRow {
    const content = isRecord(resume.content) ? resume.content : {};
    const ingestData = resume.ingestData;

    return {
        resumeId: resume._id,
        externalId: resume.externalId,
        name: toStringValue(content.name),
        jobIntention: toStringValue(content.jobIntention),
        location: toStringValue(content.location),
        ingestData: ingestData ? {
            industryTags: ingestData.industryTags,
            companyHits: ingestData.companyHits ?? [],
            brandHits: projectIngestDiagnosticsBrandHits(ingestData.brandHits),
            experienceLevel: ingestData.experienceLevel,
            ruleScoreCount: countRuleScores(ingestData.ruleScores),
            computedAt: ingestData.computedAt,
            skillsVersion: ingestData.skillsVersion,
            taggingEntries: projectIngestDiagnosticsTaggingEntries(ingestData.taggingEnvelope),
        } : undefined,
    };
}

export function resolveListWithIngestWindow(requestedLimit: number | undefined): {
    limit: number;
    overfetchLimit: number;
} {
    const limit = Math.min(Math.max(requestedLimit || DEFAULT_RESUME_LIMIT, 1), MAX_SAFE_LIST_WITH_INGEST_LIMIT);
    return {
        limit,
        overfetchLimit: Math.min(Math.max(limit * 3, limit), MAX_SAFE_LIST_WITH_INGEST_OVERFETCH),
    };
}

export function resolveResumeScanBatchSize(requestedLimit: number | undefined): number {
    const normalizedLimit = typeof requestedLimit === "number" && Number.isFinite(requestedLimit)
        ? Math.trunc(requestedLimit)
        : DEFAULT_RESUME_SCAN_BATCH_SIZE;
    return Math.min(Math.max(normalizedLimit, 1), MAX_RESUME_SCAN_BATCH_SIZE);
}

function normalizeTagExpansionKeywordGroups(
    keywordGroups: Array<{ original: string; variants: string[] }>
): TagExpansionKeywordGroup[] {
    return keywordGroups
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
}

function collectExpandedTerms(keywordGroups: TagExpansionKeywordGroup[]): string[] {
    return Array.from(new Set(keywordGroups.flatMap((group) => group.variants)));
}

function selectTagExpansionAnchorGroup(keywordGroups: TagExpansionKeywordGroup[]): TagExpansionKeywordGroup {
    const [firstGroup, ...remainingGroups] = keywordGroups;
    if (!firstGroup) {
        throw new Error("Keyword groups are required for tag expansion search");
    }

    return remainingGroups.reduce((selected, candidate) => {
        if (candidate.variants.length !== selected.variants.length) {
            return candidate.variants.length < selected.variants.length ? candidate : selected;
        }
        return candidate.original.length > selected.original.length ? candidate : selected;
    }, firstGroup);
}

export function buildTagExpansionSearchQuery(
    keywordGroups: TagExpansionKeywordGroup[],
    mode: "AND" | "OR"
): string {
    if (keywordGroups.length === 0) {
        return "";
    }

    if (mode === "AND") {
        return selectTagExpansionAnchorGroup(keywordGroups).variants.join(" ");
    }

    return collectExpandedTerms(keywordGroups).join(" ");
}

function matchesTagExpansionGroup(searchText: string, group: TagExpansionKeywordGroup): boolean {
    return group.variants.some((variant) => searchText.includes(variant));
}

export function matchesTagExpansionSearchText(
    searchText: string,
    keywordGroups: TagExpansionKeywordGroup[],
    mode: "AND" | "OR"
): boolean {
    return mode === "AND"
        ? keywordGroups.every((group) => matchesTagExpansionGroup(searchText, group))
        : keywordGroups.some((group) => matchesTagExpansionGroup(searchText, group));
}

export function collectSearchTextProvenance(
    searchText: string,
    keywordGroups: TagExpansionKeywordGroup[],
    sourceMapping: Record<string, string>
): SearchProvenance[] {
    const matches: SearchProvenance[] = [];
    const seen = new Set<string>();

    for (const group of keywordGroups) {
        for (const term of group.variants) {
            if (!searchText.includes(term)) {
                continue;
            }
            if (seen.has(term)) {
                continue;
            }
            seen.add(term);
            matches.push({
                term,
                source: "searchText",
                expandedFrom: sourceMapping[term],
            });
        }
    }

    return matches;
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
        const limit = args.limit || DEFAULT_RESUME_LIMIT;
        return await ctx.db.query("resumes").order("desc").take(limit);
    },
});

export const listWithIngestData = query({
    args: {
        limit: v.optional(v.number()),
        jobDescriptionId: v.optional(v.string()),
    },
    handler: async (ctx, args) => {
        const { limit, overfetchLimit } = resolveListWithIngestWindow(args.limit);
        const jobDescriptionId = args.jobDescriptionId?.trim() || undefined;
        const candidates = await ctx.db
            .query("resumes")
            .withIndex("by_primaryRuleScore")
            .order("desc")
            .take(overfetchLimit);
        return sortByIngestRuleScore(candidates, jobDescriptionId).slice(0, limit);
    },
});

export const listIngestDiagnostics = query({
    args: {
        paginationOpts: paginationOptsValidator,
    },
    handler: async (ctx, args) => {
        const page = await ctx.db
            .query("resumes")
            .withIndex("by_primaryRuleScore")
            .order("desc")
            .paginate({
                ...args.paginationOpts,
                numItems: Math.min(args.paginationOpts.numItems, MAX_INGEST_DIAGNOSTICS_PAGE_SIZE),
            });

        return {
            ...page,
            page: page.page.map(projectIngestDiagnosticsRow),
        };
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
        const keywordGroups = normalizeTagExpansionKeywordGroups(args.keywordGroups);
        const expandedTerms = collectExpandedTerms(keywordGroups);

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
        const fetchLimit = Math.min(Math.max(limit * 2, 100), 400);
        const searchQuery = buildTagExpansionSearchQuery(keywordGroups, mode);

        const matches = searchQuery
            ? await ctx.db
                .query("resumes")
                .withSearchIndex("search_body", (q) => q.search("searchText", searchQuery))
                .take(fetchLimit)
            : [];

        const filteredDocs = matches.filter((doc) => {
            const normalizedSearchText = (doc.searchText || "").toLowerCase();
            const matched = matchesTagExpansionSearchText(normalizedSearchText, keywordGroups, mode);

            if (!matched) {
                return false;
            }

            const provenance = collectSearchTextProvenance(normalizedSearchText, keywordGroups, sourceMapping);
            if (provenance.length === 0) {
                return false;
            }

            provenanceByResumeId.set(String(doc._id), provenance);
            return true;
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

export const getByIdsForExport = query({
    args: {
        resumeIds: v.array(v.id("resumes")),
    },
    handler: async (ctx, args) => {
        const docs = await Promise.all(args.resumeIds.map((resumeId) => ctx.db.get(resumeId)));
        return docs
            .filter((doc): doc is NonNullable<typeof doc> => doc !== null)
            .map((doc) => {
                const content = isRecord(doc.content) ? doc.content : {};
                return {
                    resumeId: String(doc._id),
                    resume: {
                        name: toOptionalStringValue(content.name),
                        jobIntention: toOptionalStringValue(content.jobIntention),
                        location: toOptionalStringValue(content.location),
                        age: toOptionalStringValue(content.age) ?? (typeof doc.age === "number" ? String(doc.age) : undefined),
                        experience: toOptionalStringValue(content.experience),
                        education: toOptionalStringValue(content.education),
                        expectedSalary: toOptionalStringValue(content.expectedSalary),
                        profileUrl: toOptionalStringValue(content.profileUrl)
                            ?? toOptionalStringValue(content.profile_url)
                            ?? toOptionalStringValue(content.profileURL)
                            ?? toOptionalStringValue(content.url),
                        source: doc.source,
                        selfIntro: toOptionalStringValue(content.selfIntro),
                        workHistory: Array.isArray(content.workHistory) ? content.workHistory : undefined,
                        ingestData: doc.ingestData ? {
                            industryTags: doc.ingestData.industryTags,
                            companyHits: doc.ingestData.companyHits,
                            roleSignals: doc.ingestData.roleSignals,
                        } : undefined,
                    },
                };
            });
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
            industryDbV2Raw: v.optional(v.number()),
            industryDbV2RawComponents: v.optional(v.object({
                companyScore: v.number(),
                brandScore: v.number(),
                weightedBrandUnits: v.number(),
                uniqueCompanies: v.number(),
                brandUnitCount: v.number(),
            })),
            roleSignals: v.optional(v.array(v.object({
                type: v.string(),
                matchedSignals: v.array(v.string()),
                signalCount: v.number(),
                occurrences: v.number(),
                years: v.number(),
                industryVerifiedYears: v.optional(v.number()),
                roleRelevantYears: v.optional(v.number()),
                industryVerifiedRelevantYears: v.optional(v.number()),
                matchedWorkEntries: v.optional(v.array(v.object({
                    companyName: v.optional(v.string()),
                    jobTitle: v.optional(v.string()),
                    years: v.number(),
                    industryVerified: v.boolean(),
                    matchedSignals: v.array(v.string()),
                }))),
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
                industryDbV2Raw: v.optional(v.number()),
                industryDbV2RawComponents: v.optional(v.object({
                    companyScore: v.number(),
                    brandScore: v.number(),
                    weightedBrandUnits: v.number(),
                    uniqueCompanies: v.number(),
                    brandUnitCount: v.number(),
                })),
                roleSignals: v.optional(v.array(v.object({
                    type: v.string(),
                    matchedSignals: v.array(v.string()),
                    signalCount: v.number(),
                    occurrences: v.number(),
                    years: v.number(),
                    industryVerifiedYears: v.optional(v.number()),
                    roleRelevantYears: v.optional(v.number()),
                    industryVerifiedRelevantYears: v.optional(v.number()),
                    matchedWorkEntries: v.optional(v.array(v.object({
                        companyName: v.optional(v.string()),
                        jobTitle: v.optional(v.string()),
                        years: v.number(),
                        industryVerified: v.boolean(),
                        matchedSignals: v.array(v.string()),
                    }))),
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

export const listResumeScanBatch = internalQuery({
    args: {
        cursor: v.optional(v.string()),
        limit: v.optional(v.number()),
    },
    handler: async (ctx, args) => {
        const page = await ctx.db
            .query("resumes")
            .order("desc")
            .paginate({
                cursor: args.cursor ?? null,
                numItems: resolveResumeScanBatchSize(args.limit),
            });

        return {
            continueCursor: page.continueCursor,
            isDone: page.isDone,
            page: page.page.map((resume): ResumeScanRow => ({
                _id: resume._id,
                content: resume.content,
                ingestData: resume.ingestData,
                primaryRuleScore: resume.primaryRuleScore,
                searchText: resume.searchText,
            })),
        };
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

export const hardResetIngestData = mutation({
    args: {
        cursor: v.optional(v.string()),
        batchSize: v.optional(v.number()),
    },
    handler: async (ctx, args) => {
        const resumes = await ctx.db
            .query("resumes")
            .order("desc")
            .paginate({
                cursor: args.cursor ?? null,
                numItems: resolveResumeScanBatchSize(args.batchSize),
            });
        let cleared = 0;

        for (const resume of resumes.page) {
            const hasComputedFields = resume.ingestData !== undefined
                || resume.analysis !== undefined
                || resume.analyses !== undefined
                || resume.primaryRuleScore !== undefined
                || resume.searchText !== undefined;

            if (!hasComputedFields) {
                continue;
            }

            await ctx.db.patch(resume._id, {
                ingestData: undefined,
                analysis: undefined,
                analyses: undefined,
                primaryRuleScore: undefined,
                searchText: undefined,
            });
            cleared += 1;
        }

        return {
            cleared,
            hasMore: !resumes.isDone,
            cursor: resumes.isDone ? null : resumes.continueCursor,
        };
    },
});
