/**
 * T3: durable company-key projection snapshots.
 *
 * Work-history → companyKey projections were computed on the fly; this module
 * persists them on the resume doc (companyKeyProjection column) with a
 * recompute epoch and drains stale rows after an epoch bump. The drain mirrors
 * reIngestStaleResumes but deliberately WITHOUT the BFF skills-version fetch:
 * staleness here is a pure function of the projection epoch constant, so the
 * hot path makes no external calls.
 */
import { internalAction, internalMutation } from "./_generated/server";
import { internal } from "./_generated/api";
import { v } from "convex/values";
import type { Id } from "./_generated/dataModel";
import { CURRENT_COMPANY_KEY_PROJECTION_EPOCH, isCompanyKeyProjectionStale } from "@trends/shared";
import { computeCompanyKeyProjection } from "./lib/resume_identity.js";
import type { ResumeScanRow } from "./resumes_mutations.js";

export type RecomputeCompanyKeyProjectionResult = {
    dryRun: boolean;
    scheduled: number;
    batches: number;
    currentEpoch: number;
    hasMore: boolean;
    cursor: string | null;
    scannedRows: number;
    staleCount: number;
};

const BATCH_SIZE = 100;

export const recomputeCompanyKeyProjections = internalAction({
    args: {
        limit: v.optional(v.number()),
        cursor: v.optional(v.string()),
        /** When true, scan and count only — do not schedule recompute chunks. */
        dryRun: v.optional(v.boolean()),
    },
    handler: async (ctx, args): Promise<RecomputeCompanyKeyProjectionResult> => {
        const limit = Math.max(1, Math.min(args.limit ?? 200, 1000));
        const dryRun = args.dryRun === true;
        const currentEpoch = CURRENT_COMPANY_KEY_PROJECTION_EPOCH;

        let cursor = args.cursor;
        let nextCursor: string | null = null;
        const resumeIds: Id<"resumes">[] = [];
        let batches = 0;
        let scannedRows = 0;
        let staleCount = 0;

        while (resumeIds.length < limit) {
            const batch: {
                continueCursor: string;
                isDone: boolean;
                page: ResumeScanRow[];
            } = await ctx.runQuery(internal.resumes.listResumeScanBatch, {
                cursor,
                limit: Math.min(BATCH_SIZE, limit - resumeIds.length),
            });

            if (!batch.isDone && !batch.continueCursor) {
                throw new Error("Resume scan returned an unfinished page without a continuation cursor");
            }
            nextCursor = batch.isDone ? null : batch.continueCursor;
            scannedRows += batch.page.length;

            for (const resume of batch.page) {
                if (resume.isArchived === true) {
                    // Archived docs are intentionally never stamped (see
                    // recomputeCompanyKeyProjectionForResume), so they must
                    // not count as stale — otherwise the drain can never
                    // settle to 0 on a corpus with archived rows.
                    continue;
                }
                if (!isCompanyKeyProjectionStale(resume.companyKeyProjection, currentEpoch)) {
                    continue;
                }
                staleCount += 1;
                resumeIds.push(resume._id);
            }

            if (resumeIds.length >= limit) {
                break;
            }

            if (batch.isDone) {
                break;
            }

            cursor = batch.continueCursor;
        }

        const hasMore = nextCursor !== null;

        if (dryRun || resumeIds.length === 0) {
            return {
                dryRun,
                scheduled: 0,
                batches: 0,
                currentEpoch,
                hasMore,
                cursor: nextCursor,
                scannedRows,
                staleCount,
            };
        }

        for (let index = 0; index < resumeIds.length; index += BATCH_SIZE) {
            await ctx.scheduler.runAfter(0, internal.company_key_projection.recomputeCompanyKeyProjectionForResume, {
                resumeIds: resumeIds.slice(index, index + BATCH_SIZE),
            });
            batches += 1;
        }

        return {
            dryRun: false,
            scheduled: resumeIds.length,
            batches,
            currentEpoch,
            hasMore,
            cursor: nextCursor,
            scannedRows,
            staleCount,
        };
    },
});

export const recomputeCompanyKeyProjectionForResume = internalMutation({
    args: {
        resumeIds: v.array(v.id("resumes")),
    },
    handler: async (ctx, args): Promise<{ patched: number }> => {
        let patched = 0;
        for (const resumeId of args.resumeIds) {
            const resume = await ctx.db.get(resumeId);
            if (!resume || resume.isArchived === true) {
                continue;
            }
            await ctx.db.patch(resumeId, {
                companyKeyProjection: computeCompanyKeyProjection(
                    resume.content,
                    CURRENT_COMPANY_KEY_PROJECTION_EPOCH,
                ),
            });
            patched += 1;
        }
        return { patched };
    },
});
