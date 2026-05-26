/**
 * Backup helpers for resume export/backup queries.
 *
 * Extracted from resumes.ts to reduce its size and centralize
 * backup projection, filtering, and normalization logic.
 */
import type { Doc } from "../_generated/dataModel";
import { isRecord } from "@trends/shared";
import { deriveResumeIdentity } from "./resume_identity.js";
import { toOptionalStringValue } from "../resume_helpers.js";

// --- Types ---

export type ResumeBackupRow = {
    _id: Doc<"resumes">["_id"];
    externalId: string;
    source: string;
    tags: string[];
    crawledAt: number;
    content: Doc<"resumes">["content"];
    searchText?: Doc<"resumes">["searchText"];
    primaryRuleScore?: Doc<"resumes">["primaryRuleScore"];
    ingestData?: Doc<"resumes">["ingestData"];
    analysis?: Doc<"resumes">["analysis"];
    analyses?: Doc<"resumes">["analyses"];
    isArchived?: boolean;
    archivedAt?: number;
};

export type ResumeBackupFilterArgs = {
    resumeIds?: string[];
    sourceHosts?: string[];
    limit?: number;
};

type ResumeBackupFilterSets = {
    resumeIds?: Set<string>;
    sourceHosts?: Set<string>;
};

// --- Projection ---

export function projectResumeBackupRow(resume: Doc<"resumes">): ResumeBackupRow {
    return {
        _id: resume._id,
        externalId: resume.externalId,
        source: resume.source,
        tags: resume.tags,
        crawledAt: resume.crawledAt,
        content: resume.content,
        searchText: resume.searchText,
        primaryRuleScore: resume.primaryRuleScore,
        ingestData: resume.ingestData,
        analysis: resume.analysis,
        analyses: resume.analyses,
        ...(resume.isArchived === true ? { isArchived: true, archivedAt: resume.archivedAt } : {}),
    };
}

// --- Normalization ---

export function normalizeResumeBackupFilterValues(values: string[] | undefined): string[] | undefined {
    if (!Array.isArray(values)) {
        return undefined;
    }

    const normalized = Array.from(new Set(
        values
            .map((value) => value.trim())
            .filter((value) => value.length > 0)
    ));

    return normalized.length > 0 ? normalized : undefined;
}

export function normalizeResumeBackupSourceHosts(values: string[] | undefined): string[] | undefined {
    const normalized = normalizeResumeBackupFilterValues(values);
    return normalized?.map((value) => value.toLowerCase());
}

export function normalizeResumeBackupFetchLimit(limit: number | undefined, requestedResumeIds: string[] | undefined): number | undefined {
    if (requestedResumeIds && requestedResumeIds.length > 0) {
        return undefined;
    }
    return limit;
}

export function normalizeResumeBackupRequestedLimit(limit: number | undefined): number | undefined {
    if (typeof limit !== "number" || !Number.isFinite(limit)) {
        return undefined;
    }
    return Math.max(1, Math.trunc(limit));
}

export function normalizeResumeBackupArgs(args: ResumeBackupFilterArgs): ResumeBackupFilterArgs {
    return {
        resumeIds: normalizeResumeBackupFilterValues(args.resumeIds),
        sourceHosts: normalizeResumeBackupSourceHosts(args.sourceHosts),
        limit: normalizeResumeBackupRequestedLimit(args.limit),
    };
}

// --- Sorting ---

export function compareResumeBackupRows(left: ResumeBackupRow, right: ResumeBackupRow): number {
    const crawledDiff = right.crawledAt - left.crawledAt;
    if (crawledDiff !== 0) {
        return crawledDiff;
    }

    const externalDiff = left.externalId.localeCompare(right.externalId);
    if (externalDiff !== 0) {
        return externalDiff;
    }

    return String(left._id).localeCompare(String(right._id));
}

// --- Filtering ---

function createResumeBackupFilterSets(args: ResumeBackupFilterArgs): ResumeBackupFilterSets {
    return {
        resumeIds: args.resumeIds && args.resumeIds.length > 0 ? new Set(args.resumeIds) : undefined,
        sourceHosts: args.sourceHosts && args.sourceHosts.length > 0 ? new Set(args.sourceHosts) : undefined,
    };
}

function matchesResumeBackupSourceHosts(resume: Doc<"resumes">, sourceHosts: Set<string> | undefined): boolean {
    if (!sourceHosts || sourceHosts.size === 0) {
        return true;
    }
    return sourceHosts.has(resume.source.trim().toLowerCase());
}

function matchesResumeBackupResumeId(resume: Doc<"resumes">, resumeIds: Set<string> | undefined): boolean {
    if (!resumeIds || resumeIds.size === 0) {
        return true;
    }

    const identity = deriveResumeIdentity({
        content: resume.content,
        externalId: resume.externalId,
        source: resume.source,
    });
    if (resumeIds.has(resume.externalId) || resumeIds.has(identity.rawValue) || resumeIds.has(identity.normalizedValue)) {
        return true;
    }

    const content = isRecord(resume.content) ? resume.content : {};
    const candidateValues = [
        toOptionalStringValue(content.resumeId),
        toOptionalStringValue(content.perUserId),
        toOptionalStringValue(content.profileId),
        toOptionalStringValue(content.externalId),
    ].filter((value): value is string => Boolean(value));
    return candidateValues.some((value) => resumeIds.has(value));
}

export function applyResumeBackupFilters(resumes: Doc<"resumes">[], filterSets: ResumeBackupFilterSets): ResumeBackupRow[] {
    const filtered: ResumeBackupRow[] = [];
    for (const resume of resumes) {
        if (!matchesResumeBackupSourceHosts(resume, filterSets.sourceHosts)) {
            continue;
        }
        if (!matchesResumeBackupResumeId(resume, filterSets.resumeIds)) {
            continue;
        }
        filtered.push(projectResumeBackupRow(resume));
    }
    return filtered;
}

export { createResumeBackupFilterSets, matchesResumeBackupSourceHosts, matchesResumeBackupResumeId };
