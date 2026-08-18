import { internalMutation, query } from "./_generated/server";
import type { Doc, Id } from "./_generated/dataModel";
import { v } from "convex/values";
import {
    deriveResumeSignalKey,
    deriveResumeDisplayName,
    collectResumeCompanyNames,
    collectResumeEducationSchools,
    deriveResumeTimelineYears,
    companyNameTokens,
} from "./lib/resume_identity";

// ---------------------------------------------------------------------------
// Resume dedup heuristics (item #9)
//
// Capture-time contact-signal normalization + blocking keys feed a read-only
// suggested-merge review surface. Nothing in this module mutates identityKey:
// suggestions are advisory only — there is no merge action.
// ---------------------------------------------------------------------------

export const maintainResumeDedupBlocks = internalMutation({
    args: {
        entries: v.array(
            v.object({
                resumeId: v.id("resumes"),
                source: v.string(),
                blockKeys: v.array(v.string()),
            })
        ),
    },
    handler: async (ctx, args) => {
        for (const entry of args.entries) {
            const existingBlocks = await ctx.db
                .query("resume_dedup_blocks")
                .withIndex("by_resumeId", (q) => q.eq("resumeId", entry.resumeId))
                .collect();
            for (const block of existingBlocks) {
                await ctx.db.delete(block._id);
            }
            const seen = new Set<string>();
            for (const blockKey of entry.blockKeys) {
                if (seen.has(blockKey)) {
                    continue;
                }
                seen.add(blockKey);
                await ctx.db.insert("resume_dedup_blocks", {
                    blockKey,
                    signalKey: deriveResumeSignalKey(blockKey),
                    resumeId: entry.resumeId,
                    source: entry.source,
                    createdAt: Date.now(),
                });
            }
        }
    },
});

export type MergePairScore = {
    score: number;
    evidence: string[];
};

type ScoreableResume = Pick<Doc<"resumes">, "contactSignals" | "content">;

function sharedValues(left: string[], right: string[]): string[] {
    return left.filter((value) => right.includes(value));
}

export function scoreMergePair(
    left: ScoreableResume,
    right: ScoreableResume,
): MergePairScore {
    let score = 0;
    const evidence: string[] = [];

    const leftSignals = left.contactSignals;
    const rightSignals = right.contactSignals;
    if (leftSignals?.email && leftSignals.email === rightSignals?.email) {
        score += 2;
        evidence.push(`shared email: ${leftSignals.email}`);
    }
    if (leftSignals?.phone && leftSignals.phone === rightSignals?.phone) {
        score += 2;
        evidence.push(`shared phone: ${leftSignals.phone}`);
    }
    if (leftSignals?.linkedin && leftSignals.linkedin === rightSignals?.linkedin) {
        score += 2;
        evidence.push(`shared linkedin: ${leftSignals.linkedin}`);
    }

    const leftName = deriveResumeDisplayName(left.content);
    const rightName = deriveResumeDisplayName(right.content);
    if (leftName && rightName && leftName.toLowerCase() === rightName.toLowerCase()) {
        score += 1.5;
        evidence.push(`shared name: ${leftName}`);
    }

    const leftCompanyTokens = companyNameTokens(collectResumeCompanyNames(left.content));
    const rightCompanyTokens = companyNameTokens(collectResumeCompanyNames(right.content));
    const sharedCompanyTokens = Array.from(leftCompanyTokens).filter((token) => rightCompanyTokens.has(token));
    if (sharedCompanyTokens.length > 0) {
        score += 1;
        evidence.push(`shared company tokens: ${sharedCompanyTokens.slice(0, 3).join(", ")}`);
    }

    const overlappingYears = sharedValues(
        deriveResumeTimelineYears(left.content).map(String),
        deriveResumeTimelineYears(right.content).map(String),
    );
    if (overlappingYears.length > 0) {
        score += 0.75;
        evidence.push(`overlapping timeline years: ${overlappingYears.slice(0, 3).join(", ")}`);
    }

    const sharedSchools = sharedValues(
        collectResumeEducationSchools(left.content),
        collectResumeEducationSchools(right.content),
    );
    if (sharedSchools.length > 0) {
        score += 0.5;
        evidence.push(`shared education: ${sharedSchools.slice(0, 3).join(", ")}`);
    }

    return { score, evidence };
}

function summarizeResume(resume: Doc<"resumes">) {
    return {
        resumeId: resume._id,
        name: deriveResumeDisplayName(resume.content),
        source: resume.source,
        externalId: resume.externalId,
        identityKey: resume.identityKey,
        contactSignals: resume.contactSignals,
    };
}

export const suggestMergeCandidates = query({
    args: {
        limit: v.optional(v.number()),
        minScore: v.optional(v.number()),
    },
    handler: async (ctx, args) => {
        const limit = Math.min(Math.max(args.limit ?? 50, 1), 200);
        const minScore = args.minScore ?? 1.5;
        const blocks = await ctx.db.query("resume_dedup_blocks").take(2000);

        const grouped = new Map<string, Doc<"resume_dedup_blocks">[]>();
        for (const block of blocks) {
            const group = grouped.get(block.signalKey);
            if (group) {
                group.push(block);
            } else {
                grouped.set(block.signalKey, [block]);
            }
        }

        const resumeCache = new Map<Id<"resumes">, Doc<"resumes"> | null>();
        const loadResume = async (resumeId: Id<"resumes">): Promise<Doc<"resumes"> | null> => {
            if (resumeCache.has(resumeId)) {
                return resumeCache.get(resumeId) ?? null;
            }
            const resume = await ctx.db.get(resumeId);
            resumeCache.set(resumeId, resume ?? null);
            return resume ?? null;
        };

        const pairs = new Map<string, { left: Doc<"resumes">; right: Doc<"resumes">; score: number; evidence: string[] }>();
        for (const entries of grouped.values()) {
            if (entries.length < 2) {
                continue;
            }
            for (let i = 0; i < entries.length; i += 1) {
                for (let j = i + 1; j < entries.length; j += 1) {
                    const leftBlock = entries[i];
                    const rightBlock = entries[j];
                    // Same-source pairs are already deduped by identity/externalId
                    // at submit time — only cross-source pairs are interesting.
                    if (leftBlock.source === rightBlock.source) {
                        continue;
                    }
                    const left = await loadResume(leftBlock.resumeId);
                    const right = await loadResume(rightBlock.resumeId);
                    if (!left || !right) {
                        continue;
                    }
                    if (left.identityKey && right.identityKey && left.identityKey === right.identityKey) {
                        continue;
                    }
                    const pairKey = [left._id, right._id].sort().join("|");
                    if (pairs.has(pairKey)) {
                        continue;
                    }
                    const { score, evidence } = scoreMergePair(left, right);
                    if (score < minScore) {
                        continue;
                    }
                    pairs.set(pairKey, { left, right, score, evidence });
                }
            }
        }

        const candidates = Array.from(pairs.values())
            .sort((a, b) => b.score - a.score)
            .slice(0, limit)
            .map(({ left, right, score, evidence }) => ({
                score,
                evidence,
                left: summarizeResume(left),
                right: summarizeResume(right),
            }));

        return {
            candidates,
            scannedBlocks: blocks.length,
        };
    },
});
