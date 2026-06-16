import type { QueryCtx, MutationCtx } from "../_generated/server.js";
import type { Id, Doc } from "../_generated/dataModel.js";

/**
 * The analysis blobs that historically lived on the hot `resumes` doc
 * (`analysis` + `analyses`). Phase 4 Step 3a moves every read to the cold
 * `resume_analyses` table; this type is the resolved view a reader needs.
 */
export type ResumeAnalysisBlob = {
    analysis?: Doc<"resume_analyses">["analysis"];
    analyses?: Doc<"resume_analyses">["analyses"];
};

/**
 * Read the ACTIVE analysis blob for a resume.
 *
 * Resolution order (Phase 4 Step 3a transitional):
 *   1. The cold `resume_analyses` row, IF it exists and is NOT archived.
 *      (Archived rows retain stale analysis/analyses — a non-surgical clear
 *      flips `status` to "archived" only — and MUST be filtered, else we
 *      over-count cleared resumes.)
 *   2. Otherwise the legacy hot `resume.analysis`/`resume.analyses` fields,
 *      as a transitional fallback for pre-Phase-3 resumes that have no cold
 *      row yet. Removed in Step 3c once the prod backfill (3b) confirms 100%
 *      cold coverage.
 *
 * `undefined` status is treated as active (matches the repo invariant for
 * cold readers — see resumes_list_projections.ts).
 *
 * Returns `{}` (empty) when there is no analysis at all, OR when the only
 * cold row is archived. Callers that distinguish "no analysis" from
 * "archived" should check the cold row directly.
 */
export async function readActiveResumeAnalysis(
    ctx: QueryCtx,
    resume: Pick<Doc<"resumes">, "_id" | "analysis" | "analyses">,
): Promise<ResumeAnalysisBlob> {
    const coldRow = await ctx.db
        .query("resume_analyses")
        .withIndex("by_resume", (q) => q.eq("resumeId", resume._id))
        .unique();

    if (coldRow && coldRow.status !== "archived") {
        return {
            analysis: coldRow.analysis,
            analyses: coldRow.analyses,
        };
    }

    // Transitional fallback: legacy resume with no active cold row.
    // (Archived cold rows intentionally fall through here too — but the
    // hot fields on an archived-and-then-cleared resume are already stale
    // from the prior clear path, matching pre-3a behavior exactly.)
    return {
        analysis: resume.analysis,
        analyses: resume.analyses,
    };
}

/**
 * Same as {@link readActiveResumeAnalysis} but keyed by resumeId only (for
 * callers that have an Id, not the doc). Performs the hot-doc fetch itself.
 */
export async function readActiveResumeAnalysisById(
    ctx: QueryCtx,
    resumeId: Id<"resumes">,
): Promise<ResumeAnalysisBlob> {
    const resume = await ctx.db.get(resumeId);
    if (!resume) return {};
    return readActiveResumeAnalysis(ctx, resume);
}

/**
 * Whether a resume has ANY analysis state worth syncing/clearing.
 * True if an active cold row exists OR legacy hot fields are present.
 * (MutationCtx variant — used by clear/restore writers.)
 */
export async function hasResumeAnalysisState(
    ctx: MutationCtx,
    resume: Pick<Doc<"resumes">, "_id" | "analysis" | "analyses">,
): Promise<boolean> {
    const blob = await readActiveResumeAnalysis(ctx, resume);
    return blob.analysis !== undefined
        || (blob.analyses !== undefined && Object.keys(blob.analyses).length > 0);
}

/**
 * Resolve the active cold row directly (no fallback), returning the doc.
 * Used by writers that need to patch the cold row (archive / upsert).
 */
export async function getActiveColdAnalysisRow(
    ctx: QueryCtx,
    resumeId: Id<"resumes">,
): Promise<Doc<"resume_analyses"> | null> {
    const coldRow = await ctx.db
        .query("resume_analyses")
        .withIndex("by_resume", (q) => q.eq("resumeId", resumeId))
        .unique();
    if (!coldRow || coldRow.status === "archived") return null;
    return coldRow;
}
