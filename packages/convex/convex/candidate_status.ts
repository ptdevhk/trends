import { v } from "convex/values";
import { paginationOptsValidator } from "convex/server";
import { mutation, query, type MutationCtx } from "./_generated/server";
import type { Doc, Id } from "./_generated/dataModel";

import { DEFAULT_WORKSPACE_SLUG } from "./sessions";
import { belongsToWorkspace } from "./search_profiles";
import { deriveResumeIdentityKey } from "./lib/resume_identity";

type CandidateStatus =
    | "new" | "shortlisted" | "rejected" | "contacted"
    | "interviewing" | "interviewed_pass" | "interviewed_reject"
    | "appeal_submitted" | "human_review" | "upheld" | "reversed"
    | "offer" | "hired" | "withdrawn";

const candidateStatusValidator = v.union(
    v.literal("new"),
    v.literal("shortlisted"),
    v.literal("rejected"),
    v.literal("contacted"),
    v.literal("interviewing"),
    v.literal("interviewed_pass"),
    v.literal("interviewed_reject"),
    v.literal("appeal_submitted"),
    v.literal("human_review"),
    v.literal("upheld"),
    v.literal("reversed"),
    v.literal("offer"),
    v.literal("hired"),
    v.literal("withdrawn"),
);

const candidateStatusHistoryValidator = v.array(v.object({
    status: v.string(),
    updatedAt: v.number(),
    notes: v.optional(v.string()),
}));

async function upsertDigestStatusForResume(
    ctx: MutationCtx,
    args: {
        resumeId: Id<"resumes">;
        workspaceSlug: string;
        identityKey: string;
        legacyIdentityKey?: string;
        status: CandidateStatus;
        updatedAt: number;
    },
): Promise<void> {
    const portable = await ctx.db
        .query("resume_digest_statuses")
        .withIndex("by_workspace_identity", (q) =>
            q.eq("workspaceSlug", args.workspaceSlug).eq("identityKey", args.identityKey)
        )
        .unique();
    const legacyIdentityKey = args.legacyIdentityKey;
    const legacy = legacyIdentityKey && legacyIdentityKey !== args.identityKey
        ? await ctx.db
            .query("resume_digest_statuses")
            .withIndex("by_workspace_identity", (q) =>
                q.eq("workspaceSlug", args.workspaceSlug).eq("identityKey", legacyIdentityKey)
            )
            .unique()
        : null;
    const existing = legacy ?? portable;

    if (existing) {
        await ctx.db.patch(existing._id, {
            resumeId: args.resumeId,
            identityKey: args.identityKey,
            status: args.status,
            updatedAt: args.updatedAt,
        });
        if (legacy && portable) {
            await ctx.db.delete(portable._id);
        }
        return;
    }

    await ctx.db.insert("resume_digest_statuses", {
        resumeId: args.resumeId,
        workspaceSlug: args.workspaceSlug,
        identityKey: args.identityKey,
        status: args.status,
        updatedAt: args.updatedAt,
    });
}

function mergeCandidateStatusHistory(
    primary: Doc<"candidate_status">["history"],
    duplicate: Doc<"candidate_status">["history"],
): Doc<"candidate_status">["history"] {
    if (!primary && !duplicate) {
        return undefined;
    }

    const merged = [...(primary ?? [])];
    for (const entry of duplicate ?? []) {
        const alreadyPresent = merged.some((existing) =>
            existing.status === entry.status
            && existing.updatedAt === entry.updatedAt
            && existing.notes === entry.notes
        );
        if (!alreadyPresent) {
            merged.push(entry);
        }
    }
    return merged;
}

async function migrateLegacyCandidateStatus(
    ctx: MutationCtx,
    args: {
        workspaceSlug: string;
        legacyIdentityKey: string | undefined;
        identityKey: string;
    },
): Promise<Doc<"candidate_status"> | null> {
    const portable = await ctx.db
        .query("candidate_status")
        .withIndex("by_workspace_identity", (q) =>
            q.eq("workspaceSlug", args.workspaceSlug).eq("identityKey", args.identityKey)
        )
        .unique();
    const legacyIdentityKey = args.legacyIdentityKey;
    if (!legacyIdentityKey || legacyIdentityKey === args.identityKey) {
        return portable;
    }

    const legacy = await ctx.db
        .query("candidate_status")
        .withIndex("by_workspace_identity", (q) =>
            q.eq("workspaceSlug", args.workspaceSlug).eq("identityKey", legacyIdentityKey)
        )
        .unique();
    if (!legacy) {
        return portable;
    }

    // The document-ID row predates portable duplicates created by the old note path,
    // so it owns the lifecycle while unique duplicate history is retained.
    const history = mergeCandidateStatusHistory(legacy.history, portable?.history);
    if (portable) {
        await ctx.db.delete(portable._id);
    }
    await ctx.db.patch(legacy._id, {
        identityKey: args.identityKey,
        history,
    });
    return {
        ...legacy,
        identityKey: args.identityKey,
        history,
    };
}

async function repairResumeIdentityProjections(
    ctx: MutationCtx,
    resume: Doc<"resumes">,
    identityKey: string,
): Promise<void> {
    if (resume.identityKey !== identityKey) {
        await ctx.db.patch(resume._id, { identityKey });
    }
    const digests = await ctx.db
        .query("resume_digests")
        .withIndex("by_resumeId", (q) => q.eq("resumeId", resume._id))
        .collect();
    for (const digest of digests) {
        if (digest.identityKey !== identityKey) {
            await ctx.db.patch(digest._id, { identityKey });
        }
    }
}

/**
 * Propagate a status change into the hot resume_digest_statuses overlay.
 * Called from candidate_status.upsert and audit.submitAppeal after writing
 * candidate_status. Looks up the resume via resume_digests.by_identityKey,
 * then upserts the workspace-scoped status overlay row.
 */
export async function upsertDigestStatusForIdentity(
    ctx: MutationCtx,
    args: {
        workspaceSlug: string;
        identityKey: string;
        status: CandidateStatus;
        updatedAt: number;
    },
): Promise<void> {
    const digest = await ctx.db
        .query("resume_digests")
        .withIndex("by_identityKey", (q) => q.eq("identityKey", args.identityKey))
        .first();
    const resume = digest
        ? null
        : await ctx.db
            .query("resumes")
            .withIndex("by_identityKey", (q) => q.eq("identityKey", args.identityKey))
            .first();
    const resumeId = digest?.resumeId ?? resume?._id;
    if (!resumeId) {
        return;
    }

    await upsertDigestStatusForResume(ctx, { ...args, resumeId });
}

function normalizeWorkspaceSlug(input: string | undefined): string {
    const normalized = input?.trim();
    return normalized && normalized.length > 0 ? normalized : DEFAULT_WORKSPACE_SLUG;
}

function normalizeIdentityKey(value: string): string {
    return value.trim();
}

function requireWriteSecret(writeSecret: string | undefined): void {
    const expected = process.env.CONVEX_WRITE_SECRET;
    if (!expected || writeSecret !== expected) {
        throw new Error("Unauthorized Convex write");
    }
}

function requireReadSecret(writeSecret: string | undefined): void {
    const expected = process.env.CONVEX_WRITE_SECRET;
    if (!expected || writeSecret !== expected) {
        throw new Error("Unauthorized Convex read");
    }
}

export const listPage = query({
    args: {
        workspaceSlug: v.optional(v.string()),
        paginationOpts: paginationOptsValidator,
        writeSecret: v.optional(v.string()),
    },
    handler: async (ctx, args) => {
        requireReadSecret(args.writeSecret);
        const workspaceSlug = normalizeWorkspaceSlug(args.workspaceSlug);
        return await ctx.db
            .query("candidate_status")
            .withIndex("by_workspace_status", (q) => q.eq("workspaceSlug", workspaceSlug))
            .paginate(args.paginationOpts);
    },
});

export const getByIdentities = query({
    args: {
        workspaceSlug: v.optional(v.string()),
        identityKeys: v.array(v.string()),
        writeSecret: v.optional(v.string()),
    },
    handler: async (ctx, args) => {
        requireReadSecret(args.writeSecret);
        if (args.identityKeys.length > 100) {
            throw new Error("getByIdentities supports at most 100 identities");
        }
        const workspaceSlug = normalizeWorkspaceSlug(args.workspaceSlug);
        const identityKeys = Array.from(new Set(
            args.identityKeys.map((identityKey) => normalizeIdentityKey(identityKey)).filter(Boolean),
        ));
        const rows = await Promise.all(identityKeys.map(async (identityKey) =>
            await ctx.db
                .query("candidate_status")
                .withIndex("by_workspace_identity", (q) =>
                    q.eq("workspaceSlug", workspaceSlug).eq("identityKey", identityKey)
                )
                .unique()
        ));
        return rows.filter((row) => row !== null);
    },
});

export const listForBackup = query({
    args: {
        workspaceSlug: v.optional(v.string()),
    },
    handler: async (ctx, args) => {
        const workspaceSlug = normalizeWorkspaceSlug(args.workspaceSlug);
        const rows = await ctx.db
            .query("candidate_status")
            .withIndex("by_workspace_status", (q) => q.eq("workspaceSlug", workspaceSlug))
            .take(1000);
        return rows.map((row) => ({
            identityKey: row.identityKey,
            status: row.status,
            notes: row.notes,
            updatedBy: row.updatedBy,
            updatedAt: row.updatedAt,
            history: row.history,
        }));
    },
});

export const list = query({
    args: {
        workspaceSlug: v.optional(v.string()),
    },
    handler: async (ctx, args) => {
        const workspaceSlug = normalizeWorkspaceSlug(args.workspaceSlug);
        return await ctx.db
            .query("candidate_status")
            .withIndex("by_workspace_status", (q) => q.eq("workspaceSlug", workspaceSlug))
            .take(500);
    },
});

export const getByIdentity = query({
    args: {
        workspaceSlug: v.optional(v.string()),
        identityKey: v.string(),
    },
    handler: async (ctx, args) => {
        const workspaceSlug = normalizeWorkspaceSlug(args.workspaceSlug);
        const identityKey = normalizeIdentityKey(args.identityKey);
        if (!identityKey) {
            return null;
        }

        return await ctx.db
            .query("candidate_status")
            .withIndex("by_workspace_identity", (q) =>
                q.eq("workspaceSlug", workspaceSlug).eq("identityKey", identityKey)
            )
            .unique();
    },
});

export const upsert = mutation({
    args: {
        workspaceSlug: v.optional(v.string()),
        identityKey: v.string(),
        status: candidateStatusValidator,
        notes: v.optional(v.string()),
        updatedBy: v.optional(v.string()),
        writeSecret: v.optional(v.string()),
    },
    handler: async (ctx, args) => {
        requireWriteSecret(args.writeSecret);
        const workspaceSlug = normalizeWorkspaceSlug(args.workspaceSlug);
        const identityKey = normalizeIdentityKey(args.identityKey);
        if (!identityKey) {
            throw new Error("identityKey is required");
        }

        const now = Date.now();
        const existing = await ctx.db
            .query("candidate_status")
            .withIndex("by_workspace_identity", (q) =>
                q.eq("workspaceSlug", workspaceSlug).eq("identityKey", identityKey)
            )
            .unique();

        if (existing) {
            const nextHistory = [...(existing.history ?? [])];
            const statusChanged = existing.status !== args.status;
            if (statusChanged) {
                nextHistory.push({
                    status: existing.status,
                    updatedAt: existing.updatedAt,
                    notes: existing.notes,
                });
            }

            await ctx.db.patch(existing._id, {
                status: args.status,
                notes: args.notes,
                updatedBy: args.updatedBy,
                updatedAt: now,
                history: nextHistory,
            });

            await upsertDigestStatusForIdentity(ctx, {
                workspaceSlug,
                identityKey,
                status: args.status,
                updatedAt: now,
            });

            return existing._id;
        }

        const statusValue: CandidateStatus = args.status;
        const newId = await ctx.db.insert("candidate_status", {
            workspaceSlug,
            identityKey,
            status: statusValue,
            notes: args.notes,
            updatedBy: args.updatedBy,
            updatedAt: now,
            history: [],
        });

        await upsertDigestStatusForIdentity(ctx, {
            workspaceSlug,
            identityKey,
            status: statusValue,
            updatedAt: now,
        });

        return newId;
    },
});

export const importNotesBatch = mutation({
    args: {
        workspaceSlug: v.optional(v.string()),
        items: v.array(v.object({
            resumeId: v.string(),
            comments: v.string(),
        })),
        updatedBy: v.optional(v.string()),
        writeSecret: v.optional(v.string()),
    },
    handler: async (ctx, args) => {
        requireWriteSecret(args.writeSecret);
        if (args.items.length > 100) {
            throw new Error("importNotesBatch supports at most 100 items");
        }
        const workspaceSlug = normalizeWorkspaceSlug(args.workspaceSlug);
        const normalizedItems = args.items.map((item) => ({
            resumeId: item.resumeId.trim(),
            comments: item.comments.trim(),
        }));
        const lastNonemptyIndex = new Map<string, number>();
        normalizedItems.forEach((item, index) => {
            if (item.comments) {
                lastNonemptyIndex.set(item.resumeId, index);
            }
        });

        let applied = 0;
        let unchanged = 0;
        let notFound = 0;
        let skipped = 0;
        const results: Array<{
            resumeId: string;
            identityKey?: string;
            outcome: "applied" | "unchanged" | "notFound" | "skipped";
            reason?: "empty_comments" | "superseded_by_later_duplicate" | "resume_not_found";
        }> = [];
        const now = Date.now();

        for (let index = 0; index < normalizedItems.length; index += 1) {
            const item = normalizedItems[index];
            if (!item.comments) {
                skipped += 1;
                results.push({ resumeId: item.resumeId, outcome: "skipped", reason: "empty_comments" });
                continue;
            }
            if (lastNonemptyIndex.get(item.resumeId) !== index) {
                skipped += 1;
                results.push({
                    resumeId: item.resumeId,
                    outcome: "skipped",
                    reason: "superseded_by_later_duplicate",
                });
                continue;
            }

            const normalizedResumeId = ctx.db.normalizeId("resumes", item.resumeId);
            const resume = normalizedResumeId ? await ctx.db.get(normalizedResumeId) : null;
            if (!resume || !belongsToWorkspace(resume.workspaceSlug, workspaceSlug)) {
                notFound += 1;
                results.push({ resumeId: item.resumeId, outcome: "notFound", reason: "resume_not_found" });
                continue;
            }

            const storedIdentityKey = resume.identityKey?.trim();
            const identityKey = storedIdentityKey || deriveResumeIdentityKey({
                content: resume.content,
                externalId: resume.externalId,
                source: resume.source,
            });
            const resumeDocumentId = String(resume._id);
            const legacyIdentityKey = resumeDocumentId === identityKey ? undefined : resumeDocumentId;
            await repairResumeIdentityProjections(ctx, resume, identityKey);
            const existing = await migrateLegacyCandidateStatus(ctx, {
                workspaceSlug,
                legacyIdentityKey,
                identityKey,
            });

            if (existing?.notes === item.comments) {
                if (legacyIdentityKey) {
                    await upsertDigestStatusForResume(ctx, {
                        resumeId: resume._id,
                        workspaceSlug,
                        identityKey,
                        legacyIdentityKey,
                        status: existing.status,
                        updatedAt: existing.updatedAt,
                    });
                }
                unchanged += 1;
                results.push({ resumeId: item.resumeId, identityKey, outcome: "unchanged" });
                continue;
            }

            const status: CandidateStatus = existing?.status ?? "new";
            if (existing) {
                await ctx.db.patch(existing._id, {
                    notes: item.comments,
                    updatedBy: args.updatedBy,
                    updatedAt: now,
                });
            } else {
                await ctx.db.insert("candidate_status", {
                    workspaceSlug,
                    identityKey,
                    status,
                    notes: item.comments,
                    updatedBy: args.updatedBy,
                    updatedAt: now,
                    history: [],
                });
            }
            await upsertDigestStatusForResume(ctx, {
                resumeId: resume._id,
                workspaceSlug,
                identityKey,
                legacyIdentityKey,
                status,
                updatedAt: now,
            });
            applied += 1;
            results.push({ resumeId: item.resumeId, identityKey, outcome: "applied" });
        }

        return {
            requested: normalizedItems.length,
            applied,
            unchanged,
            notFound,
            skipped,
            results,
        };
    },
});

export const restoreBatch = mutation({
    args: {
        workspaceSlug: v.optional(v.string()),
        allowOrphan: v.optional(v.boolean()),
        items: v.array(v.object({
            identityKey: v.string(),
            status: candidateStatusValidator,
            notes: v.optional(v.string()),
            updatedBy: v.optional(v.string()),
            updatedAt: v.number(),
            history: v.optional(candidateStatusHistoryValidator),
        })),
        writeSecret: v.optional(v.string()),
    },
    handler: async (ctx, args) => {
        requireWriteSecret(args.writeSecret);
        if (args.items.length > 100) {
            throw new Error("restoreBatch supports at most 100 items");
        }
        const workspaceSlug = normalizeWorkspaceSlug(args.workspaceSlug);
        let restored = 0;
        let inserted = 0;
        let updated = 0;
        const unresolvedIdentityKeys: string[] = [];

        for (const item of args.items) {
            const identityKey = normalizeIdentityKey(item.identityKey);
            if (!identityKey) {
                unresolvedIdentityKeys.push(identityKey);
                continue;
            }
            const candidateResume = await ctx.db
                .query("resumes")
                .withIndex("by_identityKey", (q) => q.eq("identityKey", identityKey))
                .unique();
            const resume = candidateResume && belongsToWorkspace(candidateResume.workspaceSlug, workspaceSlug)
                ? candidateResume
                : null;
            if (!resume && !args.allowOrphan) {
                unresolvedIdentityKeys.push(identityKey);
                continue;
            }

            const existing = await ctx.db
                .query("candidate_status")
                .withIndex("by_workspace_identity", (q) =>
                    q.eq("workspaceSlug", workspaceSlug).eq("identityKey", identityKey)
                )
                .unique();
            const restoredFields = {
                status: item.status,
                notes: item.notes,
                updatedBy: item.updatedBy,
                updatedAt: item.updatedAt,
                history: item.history,
            };
            if (existing) {
                await ctx.db.patch(existing._id, restoredFields);
                updated += 1;
            } else {
                await ctx.db.insert("candidate_status", {
                    workspaceSlug,
                    identityKey,
                    ...restoredFields,
                });
                inserted += 1;
            }
            if (resume) {
                await upsertDigestStatusForResume(ctx, {
                    resumeId: resume._id,
                    workspaceSlug,
                    identityKey,
                    status: item.status,
                    updatedAt: item.updatedAt,
                });
            }
            restored += 1;
        }

        return {
            requested: args.items.length,
            restored,
            inserted,
            updated,
            unresolvedIdentityKeys,
        };
    },
});
