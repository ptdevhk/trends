/**
 * Resume task helper functions extracted from resume_tasks.ts.
 *
 * Pure functions for merge/dedup, restore state management,
 * and patch application used by the submitResumes mutation.
 */
import type { Doc } from "../_generated/dataModel";
import { buildSearchText, mergeSearchTextWithIngestData } from "../search_text";
import { computeVerifiedRoleYears } from "@trends/shared";

// ---------------------------------------------------------------------------
// Tag merge helpers
// ---------------------------------------------------------------------------

export function mergeTags(existing: string[], incoming: string[]): string[] {
    return Array.from(new Set([...existing, ...incoming]));
}

export function areStringArraysEqual(left: string[], right: string[]): boolean {
    if (left.length !== right.length) {
        return false;
    }
    for (let index = 0; index < left.length; index += 1) {
        if (left[index] !== right[index]) {
            return false;
        }
    }
    return true;
}

// ---------------------------------------------------------------------------
// Age patch helper
// ---------------------------------------------------------------------------

export function applyParsedAgePatch(
    patch: { age?: number },
    parsedAge: number | null,
    existingAge?: number,
): void {
    if (parsedAge === null) {
        return;
    }
    if (typeof existingAge === "number" && existingAge === parsedAge) {
        return;
    }
    patch.age = parsedAge;
}

// ---------------------------------------------------------------------------
// Normalize helpers
// ---------------------------------------------------------------------------

export function normalizeOptionalPositiveInt(value: number | undefined): number | undefined {
    if (typeof value !== "number" || !Number.isFinite(value)) {
        return undefined;
    }
    const truncated = Math.trunc(value);
    if (truncated <= 0) {
        return undefined;
    }
    return truncated;
}

// ---------------------------------------------------------------------------
// Restore state
// ---------------------------------------------------------------------------

export type RestoreState = {
    crawledAt?: number;
    isArchived?: boolean;
    archivedAt?: number;
    searchText?: string;
    primaryRuleScore?: number;
    ingestData?: Doc<"resumes">["ingestData"];
    analysis?: Doc<"resumes">["analysis"];
    analyses?: Doc<"resumes">["analyses"];
};

export function resolveStoredSearchText(
    content: unknown,
    restoreState: RestoreState | undefined,
): string {
    const restored = typeof restoreState?.searchText === "string"
        ? restoreState.searchText.trim()
        : "";
    const baseText = restored || buildSearchText(content);
    // Merge ingest-derived search tokens when available
    if (restoreState?.ingestData) {
        return mergeSearchTextWithIngestData(baseText, {
            industryTags: restoreState.ingestData.industryTags,
            synonymHits: restoreState.ingestData.synonymHits,
            brandHits: restoreState.ingestData.brandHits,
            companyHits: restoreState.ingestData.companyHits,
        });
    }
    return baseText;
}

export function shallowEqualNumberRecord(
    a: Record<string, number> | undefined,
    b: Record<string, number>,
): boolean {
    if (!a) {
        return Object.keys(b).length === 0;
    }
    const aKeys = Object.keys(a);
    const bKeys = Object.keys(b);
    if (aKeys.length !== bKeys.length) return false;
    for (const key of aKeys) {
        if (a[key] !== b[key]) return false;
    }
    return true;
}

export function shouldScheduleIngest(restoreState: RestoreState | undefined): boolean {
    return restoreState?.ingestData === undefined;
}

/**
 * Restored analysis blob captured from restoreState (Phase 4 Step 3a):
 * applyRestoreStateFields returns it instead of writing it onto the hot
 * target, so callers can upsert it to the cold resume_analyses table.
 */
export type RestoredAnalysisBlob = {
    analysis?: Doc<"resumes">["analysis"];
    analyses?: Doc<"resumes">["analyses"];
};

export function applyRestoreStateFields(
    target: {
        isArchived?: boolean;
        archivedAt?: number;
        primaryRuleScore?: number;
        ingestData?: Doc<"resumes">["ingestData"];
    },
    restoreState: RestoreState | undefined,
): RestoredAnalysisBlob {
    if (!restoreState) {
        return {};
    }

    if (typeof restoreState.isArchived === "boolean") {
        target.isArchived = restoreState.isArchived;
        if (restoreState.isArchived) {
            if (typeof restoreState.archivedAt === "number" && Number.isFinite(restoreState.archivedAt)) {
                target.archivedAt = restoreState.archivedAt;
            }
        } else {
            target.archivedAt = undefined;
        }
    } else if (typeof restoreState.archivedAt === "number" && Number.isFinite(restoreState.archivedAt)) {
        target.archivedAt = restoreState.archivedAt;
    }

    if (typeof restoreState.primaryRuleScore === "number") {
        target.primaryRuleScore = restoreState.primaryRuleScore;
    }
    if (restoreState.ingestData !== undefined) {
        const hasRoleSignals = Array.isArray(restoreState.ingestData.roleSignals)
            && restoreState.ingestData.roleSignals.length > 0;
        if (hasRoleSignals) {
            const computed = computeVerifiedRoleYears(restoreState.ingestData.roleSignals);
            const existing = restoreState.ingestData.verifiedRoleYears;
            if (!shallowEqualNumberRecord(existing, computed)) {
                target.ingestData = {
                    ...restoreState.ingestData,
                    verifiedRoleYears: computed,
                };
            } else {
                target.ingestData = restoreState.ingestData;
            }
        } else {
            target.ingestData = restoreState.ingestData;
        }
    }
    // Phase 4 Step 3a: analysis/analyses no longer written to the hot doc.
    // Returned so the caller upserts them to the cold resume_analyses row.
    const restoredAnalysis: RestoredAnalysisBlob = {};
    if (restoreState.analysis !== undefined) {
        restoredAnalysis.analysis = restoreState.analysis;
    }
    if (restoreState.analyses !== undefined) {
        restoredAnalysis.analyses = restoreState.analyses;
    }
    return restoredAnalysis;
}
