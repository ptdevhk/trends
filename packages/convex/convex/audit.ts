import { internalMutation, internalQuery, internalAction, query } from "./_generated/server";
import { internal } from "./_generated/api";
import type { Doc } from "./_generated/dataModel";
import { v } from "convex/values";
import { fnvHash, ageToBracket } from "./lib/bias_metrics.js";

// ---------------------------------------------------------------------------
// Internal mutation: logAnalysisDecision
// ---------------------------------------------------------------------------

export const logAnalysisDecision = internalMutation({
    args: {
        resumeId: v.id("resumes"),
        identityKey: v.optional(v.string()),
        workspaceSlug: v.string(),
        decisionType: v.union(
            v.literal("score"),
            v.literal("tag"),
            v.literal("rank"),
            v.literal("filter"),
            v.literal("confirm"),
        ),
        actionRef: v.string(),
        inputSnapshot: v.object({
            jobDescriptionId: v.optional(v.string()),
            profileKey: v.optional(v.string()),
            promptVersion: v.optional(v.string()),
            fieldUsagePolicyVersion: v.optional(v.number()),
            scrubbedFields: v.optional(v.array(v.string())),
            searchKeywords: v.optional(v.array(v.string())),
            searchLocation: v.optional(v.string()),
        }),
        modelMeta: v.object({
            model: v.string(),
            provider: v.string(),
            apiBase: v.optional(v.string()),
            promptTokens: v.optional(v.number()),
            completionTokens: v.optional(v.number()),
            latencyMs: v.optional(v.number()),
        }),
        output: v.object({
            score: v.optional(v.number()),
            recommendation: v.optional(v.string()),
            roleFit: v.optional(v.string()),
            confidence: v.optional(v.number()),
            tags: v.optional(v.array(v.string())),
        }),
        protectedAttributeHashes: v.optional(v.object({
            ageBracketHash: v.optional(v.string()),
            genderHash: v.optional(v.string()),
            locationHash: v.optional(v.string()),
            sourceHash: v.optional(v.string()),
        })),
        explanation: v.optional(v.object({
            summary: v.string(),
            keyFactors: v.array(v.object({
                factor: v.string(),
                weight: v.optional(v.number()),
                value: v.string(),
            })),
            modelReasoning: v.optional(v.string()),
        })),
        decidedAt: v.number(),
        expiresAt: v.optional(v.number()),
        actorId: v.optional(v.string()),
        actorRole: v.optional(v.union(
            v.literal("admin"),
            v.literal("operator"),
            v.literal("system"),
        )),
    },
    handler: async (ctx, args) => {
        await ctx.db.insert("analysis_audit_log", {
            resumeId: args.resumeId,
            identityKey: args.identityKey,
            workspaceSlug: args.workspaceSlug,
            decisionType: args.decisionType,
            actionRef: args.actionRef,
            inputSnapshot: args.inputSnapshot,
            modelMeta: args.modelMeta,
            output: args.output,
            protectedAttributeHashes: args.protectedAttributeHashes,
            explanation: args.explanation,
            outcome: "pending",
            decidedAt: args.decidedAt,
            expiresAt: args.expiresAt ?? args.decidedAt + 2 * 365 * 24 * 60 * 60 * 1000,
            actorId: args.actorId,
            actorRole: args.actorRole,
        });
    },
});

// ---------------------------------------------------------------------------
// Public query: getExplanationForCandidate (Right to Explanation)
// ---------------------------------------------------------------------------

export const getExplanationForCandidate = query({
    args: {
        resumeId: v.id("resumes"),
        workspaceSlug: v.string(),
    },
    handler: async (ctx, args) => {
        const auditLog = await ctx.db
            .query("analysis_audit_log")
            .withIndex("by_resume", (q) => q.eq("resumeId", args.resumeId))
            .filter((q) => q.eq(q.field("workspaceSlug"), args.workspaceSlug))
            .first();

        if (!auditLog?.explanation) {
            return null;
        }

        // Return ONLY the human-facing explanation, not internal model reasoning
        return {
            summary: auditLog.explanation.summary,
            keyFactors: auditLog.explanation.keyFactors.map((f) => ({
                factor: f.factor,
                value: f.value,
                // Do NOT expose weight — internal detail
            })),
            decidedAt: auditLog.decidedAt,
            decisionType: auditLog.decisionType,
            scrubbedFields: auditLog.inputSnapshot.scrubbedFields,
            protectedAttributesExcluded: (auditLog.inputSnapshot.scrubbedFields?.length ?? 0) > 0,
        };
    },
});

// ---------------------------------------------------------------------------
// Public mutation: setAuditOutcome
// ---------------------------------------------------------------------------

export const setAuditOutcome = internalMutation({
    args: {
        auditLogId: v.id("analysis_audit_log"),
        outcome: v.union(
            v.literal("accepted"),
            v.literal("overridden"),
            v.literal("appealed"),
        ),
        setBy: v.optional(v.string()),
    },
    handler: async (ctx, args) => {
        await ctx.db.patch(args.auditLogId, {
            outcome: args.outcome,
            outcomeSetBy: args.setBy,
            outcomeSetAt: Date.now(),
            reviewedAt: Date.now(),
        });
    },
});

// ---------------------------------------------------------------------------
// Public query: getAuditLogByWorkspace
// ---------------------------------------------------------------------------

export const getAuditLogByWorkspace = query({
    args: {
        workspaceSlug: v.string(),
        decisionType: v.optional(v.union(
            v.literal("score"),
            v.literal("tag"),
            v.literal("rank"),
            v.literal("filter"),
            v.literal("confirm"),
        )),
        limit: v.optional(v.number()),
    },
    handler: async (ctx, args) => {
        const limit = Math.min(args.limit ?? 50, 200);

        if (args.decisionType) {
            return ctx.db
                .query("analysis_audit_log")
                .withIndex("by_workspace_decision", (q) =>
                    q.eq("workspaceSlug", args.workspaceSlug).eq("decisionType", args.decisionType!)
                )
                .order("desc")
                .take(limit);
        }

        return ctx.db
            .query("analysis_audit_log")
            .withIndex("by_workspace", (q) => q.eq("workspaceSlug", args.workspaceSlug))
            .order("desc")
            .take(limit);
    },
});

// ---------------------------------------------------------------------------
// Helper: compute protected attribute hashes from resume data
// ---------------------------------------------------------------------------

export function computeProtectedAttributeHashes(data: {
    age?: number;
    gender?: string;
    location?: string;
    source?: string;
}): {
    ageBracketHash?: string;
    genderHash?: string;
    locationHash?: string;
    sourceHash?: string;
} {
    return {
        ageBracketHash: data.age !== undefined ? fnvHash(ageToBracket(data.age)) : undefined,
        genderHash: data.gender ? fnvHash(data.gender) : undefined,
        locationHash: data.location ? fnvHash(data.location) : undefined,
        sourceHash: data.source ? fnvHash(data.source) : undefined,
    };
}

// ---------------------------------------------------------------------------
// Internal action: cleanupExpiredAuditLogs (2-year retention, GDPR/EU AI Act)
// ---------------------------------------------------------------------------

export const cleanupExpiredAuditLogs = internalAction({
    args: {
        maxDeletes: v.optional(v.number()),
    },
    handler: async (ctx, args): Promise<{ deleted: number; checked: number; hasMore: boolean }> => {
        const maxDeletes = Math.min(args.maxDeletes ?? 500, 2000);
        const now = Date.now();

        const expired = await ctx.runQuery(internal.audit.getExpiredAuditLogs, {
            before: now,
            limit: maxDeletes,
        });

        let deleted = 0;
        for (const log of expired) {
            await ctx.runMutation(internal.audit.deleteAuditLog, {
                auditLogId: log._id,
            });
            deleted += 1;
        }

        return { deleted, checked: expired.length, hasMore: expired.length === maxDeletes };
    },
});

// ---------------------------------------------------------------------------
// Internal query: getExpiredAuditLogs (used by cleanup action)
// ---------------------------------------------------------------------------

export const getExpiredAuditLogs = internalQuery({
    args: {
        before: v.number(),
        limit: v.optional(v.number()),
    },
    handler: async (ctx, args): Promise<Array<Doc<"analysis_audit_log">>> => {
        const limit = Math.min(args.limit ?? 500, 2000);
        return ctx.db
            .query("analysis_audit_log")
            .withIndex("by_expires_at", (q) => q.lte("expiresAt", args.before))
            .take(limit);
    },
});

// ---------------------------------------------------------------------------
// Internal mutation: deleteAuditLog
// ---------------------------------------------------------------------------

export const deleteAuditLog = internalMutation({
    args: {
        auditLogId: v.id("analysis_audit_log"),
    },
    handler: async (ctx, args): Promise<void> => {
        await ctx.db.delete(args.auditLogId);
    },
});
