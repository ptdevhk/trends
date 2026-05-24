import { action, internalAction, internalMutation, internalQuery, query } from "./_generated/server";
import { api, internal } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";
import { v } from "convex/values";

// ---------------------------------------------------------------------------
// Embedding generation helpers
// ---------------------------------------------------------------------------

const EMBEDDING_MODEL = "text-embedding-3-small";
const EMBEDDING_DIMENSIONS = 1536;
const BATCH_SIZE = 100;

// ---------------------------------------------------------------------------
// RRF (Reciprocal Rank Fusion) merge — exported for testing
// ---------------------------------------------------------------------------

const RRF_K = 60;

export function rrfMerge(params: {
    bm25Results: Array<{ id: string; data: Record<string, unknown> }>;
    vectorResults: Array<{ id: string }>;
    bm25Weight: number;
    semanticWeight: number;
}): {
    merged: Array<{ id: string; score: number; data: Record<string, unknown> }>;
    bm25Count: number;
    vectorCount: number;
} {
    const { bm25Results, vectorResults, bm25Weight, semanticWeight } = params;
    const rrfScores = new Map<string, number>();
    const dataMap = new Map<string, Record<string, unknown>>();

    // BM25 contribution
    bm25Results.forEach((result, idx) => {
        const rank = idx + 1;
        rrfScores.set(result.id, bm25Weight / (RRF_K + rank));
        dataMap.set(result.id, result.data);
    });

    // Vector contribution
    vectorResults.forEach((result, idx) => {
        const rank = idx + 1;
        const current = rrfScores.get(result.id) ?? 0;
        rrfScores.set(result.id, current + semanticWeight / (RRF_K + rank));
    });

    // Sort by RRF score descending
    const merged = [...rrfScores.entries()]
        .sort((a, b) => b[1] - a[1])
        .map(([id, score]) => ({
            id,
            score,
            data: dataMap.get(id) ?? {},
        }));

    return {
        merged,
        bm25Count: bm25Results.length,
        vectorCount: vectorResults.length,
    };
}

function getApiKey(): string {
    const key = process.env.AI_API_KEY || process.env.OPENAI_API_KEY;
    if (!key) throw new Error("AI_API_KEY/OPENAI_API_KEY is not set in Convex environment variables.");
    return key;
}

function getApiBase(): string {
    return process.env.AI_API_BASE || process.env.OPENAI_API_BASE || "https://api.openai.com/v1";
}

async function fetchEmbedding(text: string): Promise<number[]> {
    const response = await fetch(`${getApiBase()}/embeddings`, {
        method: "POST",
        headers: {
            "Authorization": `Bearer ${getApiKey()}`,
            "Content-Type": "application/json",
        },
        body: JSON.stringify({
            model: EMBEDDING_MODEL,
            input: text,
            dimensions: EMBEDDING_DIMENSIONS,
        }),
    });

    if (!response.ok) {
        const body = await response.text();
        throw new Error(`Embedding API error (${response.status}): ${body}`);
    }

    const data = await response.json();
    return (data as { data: Array<{ embedding: number[] }> }).data[0].embedding;
}

/** Build the text to embed from a resume's searchText. */
function buildEmbeddingText(resume: { searchText?: string }): string {
    // Truncate to ~8000 tokens (~32000 chars) for embedding API limits
    const text = resume.searchText ?? "";
    return text.slice(0, 32000);
}

// ---------------------------------------------------------------------------
// Public action: generateEmbedding
// ---------------------------------------------------------------------------

export const generateEmbedding = action({
    args: {
        resumeId: v.id("resumes"),
    },
    handler: async (ctx, args): Promise<{ embeddingId?: Id<"resume_embeddings">; dimensions?: number; skipped?: boolean; reason?: string }> => {
        const resume = await ctx.runQuery(internal.embeddings.getResumeForEmbedding, {
            resumeId: args.resumeId,
        });
        if (!resume) throw new Error(`Resume ${args.resumeId} not found`);

        const text = buildEmbeddingText(resume);
        if (!text.trim()) {
            return { skipped: true, reason: "empty_search_text" };
        }

        const embedding = await fetchEmbedding(text);

        const embeddingId = await ctx.runMutation(internal.embeddings.storeEmbedding, {
            resumeId: args.resumeId,
            embedding,
            model: EMBEDDING_MODEL,
            sourceKey: resume.sourceKey ?? undefined,
        });

        return { embeddingId, dimensions: embedding.length };
    },
});

// ---------------------------------------------------------------------------
// Internal query/mutation: resume lookup + embedding storage
// ---------------------------------------------------------------------------

export const getResumeForEmbedding = internalQuery({
    args: { resumeId: v.id("resumes") },
    handler: async (ctx, args) => {
        return await ctx.db.get(args.resumeId);
    },
});

export const storeEmbedding = internalMutation({
    args: {
        resumeId: v.id("resumes"),
        embedding: v.array(v.float64()),
        model: v.string(),
        sourceKey: v.optional(v.string()),
    },
    handler: async (ctx, args): Promise<Id<"resume_embeddings">> => {
        // Check for existing embedding for this resume
        const existing = await ctx.db
            .query("resume_embeddings")
            .withIndex("by_resumeId", (q) => q.eq("resumeId", args.resumeId))
            .first();

        if (existing) {
            // Replace existing embedding
            await ctx.db.patch(existing._id, {
                embedding: args.embedding,
                model: args.model,
                sourceKey: args.sourceKey,
                generatedAt: Date.now(),
            });
            // Update back-link on resume
            await ctx.db.patch(args.resumeId, { embeddingId: existing._id });
            return existing._id;
        }

        const embeddingId = await ctx.db.insert("resume_embeddings", {
            resumeId: args.resumeId,
            embedding: args.embedding,
            model: args.model,
            sourceKey: args.sourceKey,
            generatedAt: Date.now(),
        });

        // Set back-link on resume
        await ctx.db.patch(args.resumeId, { embeddingId });

        return embeddingId;
    },
});

// ---------------------------------------------------------------------------
// Internal action: batchGenerateEmbeddings — for backfill
// ---------------------------------------------------------------------------

interface BatchResult {
    generated: number;
    skipped: number;
    hasMore: boolean;
    cursor: string | null;
}

export const batchGenerateEmbeddings = internalAction({
    args: {
        cursor: v.optional(v.string()),
        limit: v.optional(v.number()),
    },
    handler: async (ctx, args): Promise<BatchResult> => {
        const limit = Math.min(args.limit ?? BATCH_SIZE, BATCH_SIZE);

        // Fetch resumes without embeddings, paginated
        const page = await ctx.runQuery(internal.embeddings.getResumesWithoutEmbeddings, {
            cursor: args.cursor,
            numItems: limit,
        });

        let generated = 0;
        let skipped = 0;

        for (const resume of page.resumes) {
            const text = buildEmbeddingText(resume);
            if (!text.trim()) {
                skipped++;
                continue;
            }

            try {
                const embedding = await fetchEmbedding(text);
                await ctx.runMutation(internal.embeddings.storeEmbedding, {
                    resumeId: resume._id,
                    embedding,
                    model: EMBEDDING_MODEL,
                    sourceKey: resume.sourceKey ?? undefined,
                });
                generated++;
            } catch (err) {
                console.error(`Failed to generate embedding for resume ${resume._id}:`, err);
                skipped++;
            }
        }

        return {
            generated,
            skipped,
            hasMore: page.hasMore,
            cursor: page.nextCursor,
        };
    },
});

export const getResumesWithoutEmbeddings = internalQuery({
    args: {
        cursor: v.optional(v.string()),
        numItems: v.number(),
    },
    handler: async (ctx, args) => {
        // Scan resumes where embeddingId is undefined
        const results = await ctx.db
            .query("resumes")
            .filter((q) => q.eq(q.field("embeddingId"), undefined))
            .paginate({ cursor: args.cursor ?? null, numItems: args.numItems });

        return {
            resumes: results.page,
            hasMore: results.continueCursor !== null && results.page.length === args.numItems,
            nextCursor: results.continueCursor,
        };
    },
});

// ---------------------------------------------------------------------------
// Public action: hybridSearchResumes — BM25 + vector RRF merge
// ---------------------------------------------------------------------------

interface HybridSearchResult {
    expansion: {
        original: string;
        expanded: string[];
        groups: Array<{ original: string; variants: string[] }>;
        mode: "AND";
    };
    total: number;
    results: Array<{
        resume: Record<string, unknown>;
        provenance: Record<string, unknown>;
    }>;
    searchMode: "bm25" | "bm25_fallback" | "bm25_only_no_vectors" | "hybrid";
    debug?: {
        bm25Count: number;
        vectorCount: number;
        mergedCount: number;
        semanticWeight: number;
    };
}

export const hybridSearchResumes = action({
    args: {
        query: v.string(),
        keywordGroups: v.array(v.object({
            original: v.string(),
            variants: v.array(v.string()),
        })),
        sourceMappings: v.optional(v.array(v.object({
            term: v.string(),
            expandedFrom: v.string(),
        }))),
        minExperience: v.optional(v.number()),
        maxExperience: v.optional(v.number()),
        minRoleYears: v.optional(v.number()),
        roleFilterType: v.optional(v.string()),
        minAge: v.optional(v.number()),
        maxAge: v.optional(v.number()),
        education: v.optional(v.array(v.string())),
        skills: v.optional(v.array(v.string())),
        requiredKeywords: v.optional(v.array(v.string())),
        locations: v.optional(v.array(v.string())),
        minSalary: v.optional(v.number()),
        maxSalary: v.optional(v.number()),
        showArchived: v.optional(v.boolean()),
        sources: v.optional(v.array(v.string())),
        jobDescriptionId: v.optional(v.string()),
        sortBy: v.optional(v.union(v.literal("name"), v.literal("experience"), v.literal("extractedAt"))),
        sortOrder: v.optional(v.union(v.literal("asc"), v.literal("desc"))),
        // Hybrid search params
        semanticWeight: v.optional(v.number()), // 0-1, default 0.5
        semanticLimit: v.optional(v.number()),  // max vector results, default 50
        enableSemantic: v.optional(v.boolean()), // toggle, default true
    },
    handler: async (ctx, args): Promise<HybridSearchResult> => {
        const enableSemantic = args.enableSemantic ?? true;
        const semanticWeight = args.semanticWeight ?? 0.5;
        const semanticLimit = Math.min(args.semanticLimit ?? 50, 256);
        const bm25Weight = 1 - semanticWeight;

        // 1. Run existing BM25 search
        const bm25Result = (await ctx.runAction(api.resumes.searchWithTagExpansionAndMode, {
            query: args.query,
            keywordGroups: args.keywordGroups,
            sourceMappings: args.sourceMappings,
            minExperience: args.minExperience,
            maxExperience: args.maxExperience,
            minRoleYears: args.minRoleYears,
            roleFilterType: args.roleFilterType,
            minAge: args.minAge,
            maxAge: args.maxAge,
            education: args.education,
            skills: args.skills,
            requiredKeywords: args.requiredKeywords,
            locations: args.locations,
            minSalary: args.minSalary,
            maxSalary: args.maxSalary,
            showArchived: args.showArchived,
            sources: args.sources,
            jobDescriptionId: args.jobDescriptionId,
            sortBy: args.sortBy,
            sortOrder: args.sortOrder,
        })) as unknown as HybridSearchResult;

        // If semantic search disabled or query empty, return BM25 results as-is
        if (!enableSemantic || !args.query.trim()) {
            return {
                ...bm25Result,
                searchMode: "bm25" as const,
            };
        }

        // 2. Generate query embedding
        let vectorIds: Id<"resume_embeddings">[] = [];
        try {
            const queryEmbedding = await fetchEmbedding(args.query);

            // 3. Vector search
            const sourceKeys = args.sources?.length ? args.sources : undefined;
            const vectorResults = await ctx.vectorSearch("resume_embeddings", "by_embedding", {
                vector: queryEmbedding,
                limit: semanticLimit,
                ...(sourceKeys ? {
                    filter: (q) => q.or(...sourceKeys.map((sk) => q.eq("sourceKey", sk))),
                } : {}),
            });

            vectorIds = vectorResults.map((r) => r._id);
        } catch (err) {
            console.error("Vector search failed, falling back to BM25 only:", err);
            return {
                ...bm25Result,
                searchMode: "bm25_fallback" as const,
            };
        }

        if (vectorIds.length === 0) {
            return {
                ...bm25Result,
                searchMode: "bm25_only_no_vectors" as const,
            };
        }

        // 4. Fetch resume IDs for vector results
        const embeddings = await ctx.runQuery(internal.embeddings.getEmbeddingsByIds, {
            embeddingIds: vectorIds,
        });
        const vectorResults = embeddings.map((emb: Doc<"resume_embeddings">) => ({
            id: String(emb.resumeId),
        }));

        // 5. RRF merge
        const bm25Merged = bm25Result.results.map((result: HybridSearchResult["results"][number]) => ({
            id: String((result.resume as { _id: string })._id),
            data: result as Record<string, unknown>,
        }));

        const { merged: rrfMerged, bm25Count, vectorCount } = rrfMerge({
            bm25Results: bm25Merged,
            vectorResults,
            bm25Weight,
            semanticWeight,
        });

        // 6. Fetch docs for vector-only results (not in BM25 results)
        const bm25Ids = new Set(bm25Merged.map((r) => r.id));
        const vectorOnlyIds = vectorResults.map((v) => v.id).filter((id) => !bm25Ids.has(id));

        const resumeDocMap = new Map<string, HybridSearchResult["results"][number]>();
        // Seed with BM25 results
        bm25Result.results.forEach((result: HybridSearchResult["results"][number]) => {
            const resumeId = String((result.resume as { _id: string })._id);
            resumeDocMap.set(resumeId, result);
        });

        if (vectorOnlyIds.length > 0) {
            const additionalDocs = await ctx.runQuery(internal.resumes.getResumesByIds, {
                resumeIds: vectorOnlyIds.map((id) => id as unknown as Id<"resumes">),
            });
            for (const doc of additionalDocs) {
                resumeDocMap.set(String(doc._id), {
                    resume: {
                        _id: doc._id,
                        _creationTime: doc._creationTime,
                        externalId: doc.externalId,
                        identityKey: doc.identityKey,
                        age: doc.age,
                        source: doc.source,
                        sourceKey: doc.sourceKey,
                        tags: doc.tags,
                        crawledAt: doc.crawledAt,
                        searchText: doc.searchText,
                        primaryRuleScore: doc.primaryRuleScore,
                        isArchived: doc.isArchived,
                    } as Record<string, unknown>,
                    provenance: { groups: [], matchedKeywords: [], mode: "semantic" } as Record<string, unknown>,
                });
            }
        }

        // 7. Build merged results from RRF ordering
        const mergedResults = rrfMerged
            .map((entry) => resumeDocMap.get(entry.id))
            .filter((r): r is NonNullable<typeof r> => r !== undefined);

        return {
            expansion: bm25Result.expansion,
            total: mergedResults.length,
            results: mergedResults,
            searchMode: "hybrid" as const,
            debug: {
                bm25Count,
                vectorCount,
                mergedCount: mergedResults.length,
                semanticWeight,
            },
        };
    },
});

// ---------------------------------------------------------------------------
// Internal query: fetch embeddings by IDs
// ---------------------------------------------------------------------------

export const getEmbeddingsByIds = internalQuery({
    args: { embeddingIds: v.array(v.id("resume_embeddings")) },
    handler: async (ctx, args) => {
        const results = await Promise.all(args.embeddingIds.map((id) => ctx.db.get(id)));
        return results.filter((r): r is Doc<"resume_embeddings"> => r !== null);
    },
});

// ---------------------------------------------------------------------------
// Public query: embedding stats
// ---------------------------------------------------------------------------

export const getEmbeddingStats = query({
    args: {},
    handler: async (ctx) => {
        const sample = await ctx.db
            .query("resume_embeddings")
            .order("desc")
            .take(1);

        return {
            hasEmbeddings: sample.length > 0,
            latestModel: sample[0]?.model ?? null,
            latestGeneratedAt: sample[0]?.generatedAt ?? null,
        };
    },
});
