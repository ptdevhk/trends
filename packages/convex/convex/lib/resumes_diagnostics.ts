/**
 * Diagnostics helpers extracted from resumes.ts.
 *
 * Pure functions for resolving diagnostics source keys, building facet rows,
 * and projecting ingest diagnostics data for UI display.
 */
import type { Doc } from "../_generated/dataModel";
import {
    normalizeResumeLocationHierarchy,
    resolveResumeDiagnosticsSourceKey,
    isRecord,
    formatLocationHierarchyLabel,
} from "@trends/shared";
import {
    toStringValue,
    toOptionalStringValue,
    toRuleScores,
} from "../resume_helpers.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type IngestDiagnosticsBrandHit = {
    brand: string;
    role: string;
    source: string;
    context: string;
};

export type IngestDiagnosticsTaggingEntry = {
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
    source: string;
    sourceKey: string;
    name: string;
    jobIntention: string;
    location: string;
    isArchived?: boolean;
    archivedAt?: number;
    ingestData?: {
        industryTags: string[];
        companyHits: string[];
        brandHits: IngestDiagnosticsBrandHit[];
        experienceLevel: string;
        ruleScoreCount: number;
        computedAt: number;
        skillsVersion: number;
        ingestComputeEpoch?: number;
        taggingEntries: IngestDiagnosticsTaggingEntry[];
    };
};

export type DiagnosticsSourceFacetRow = {
    key: string;
    label: string;
    count: number;
};

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

export const MAX_INGEST_DIAGNOSTICS_PAGE_SIZE = 100;
export const MAX_INGEST_DIAGNOSTICS_TAGGING_ENTRIES = 8;
export const DIAGNOSTICS_SOURCE_FILTER_BATCH_MULTIPLIER = 3;

// ---------------------------------------------------------------------------
// Private helpers
// ---------------------------------------------------------------------------

function countRuleScores(value: unknown): number {
    return Object.keys(toRuleScores(value)).length;
}

function resolveDiagnosticsSourceLabel(sourceKey: string): string {
    switch (sourceKey) {
        case "job5156":
            return "Job5156";
        case "51job":
            return "51job";
        case "51job-manual":
            return "51job manual";
        case "seek":
            return "SEEK";
        default:
            return "Unknown";
    }
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

// ---------------------------------------------------------------------------
// Exported helpers
// ---------------------------------------------------------------------------

export function resolveDiagnosticsSourceKeyForResume(
    resume: {
        source: string;
        content: unknown;
    }
): string {
    const content = isRecord(resume.content) ? resume.content : {};
    return resolveResumeDiagnosticsSourceKey({
        sourceKey: toOptionalStringValue(content.profileType),
        source: resume.source,
    });
}

export function normalizeDiagnosticsSourceFilterValues(values: string[] | undefined): string[] | undefined {
    if (!Array.isArray(values)) {
        return undefined;
    }

    const normalized = Array.from(new Set(values
        .map((value) => value.trim())
        .filter((value) => value.length > 0)
        .map((value) => resolveResumeDiagnosticsSourceKey({ sourceKey: value, source: value }))
    ));

    return normalized.length > 0 ? normalized : undefined;
}

export function matchesDiagnosticsSourceKeys(
    resume: {
        source: string;
        content: unknown;
        sourceKey?: string;
    },
    sourceKeys: Set<string> | undefined
): boolean {
    if (!sourceKeys || sourceKeys.size === 0) {
        return true;
    }

    const key = resume.sourceKey ?? resolveDiagnosticsSourceKeyForResume(resume);
    return sourceKeys.has(key);
}

export function buildDiagnosticsSourceFacetRows(
    input: Array<{ source: string; content: unknown }> | Map<string, number>
): DiagnosticsSourceFacetRow[] {
    const counts = input instanceof Map ? input : new Map<string, number>();

    if (Array.isArray(input)) {
        for (const resume of input) {
            const sourceKey = resolveDiagnosticsSourceKeyForResume(resume);
            counts.set(sourceKey, (counts.get(sourceKey) ?? 0) + 1);
        }
    }

    return Array.from(counts.entries())
        .map(([key, count]) => ({
            key,
            label: resolveDiagnosticsSourceLabel(key),
            count,
        }))
        .sort((left, right) => right.count - left.count || left.key.localeCompare(right.key));
}

export function projectIngestDiagnosticsRow(
    resume: {
        _id: string;
        externalId: string;
        source: string;
        content: unknown;
        sourceKey?: string;
        ingestData?: Doc<"resumes">["ingestData"];
        isArchived?: boolean;
        archivedAt?: number;
    }
): IngestDiagnosticsRow {
    const content = isRecord(resume.content) ? resume.content : {};
    const ingestData = resume.ingestData;
    const locationHierarchy = normalizeResumeLocationHierarchy(content, resume.source);

    return {
        resumeId: resume._id,
        externalId: resume.externalId,
        source: resume.source,
        sourceKey: resume.sourceKey ?? resolveDiagnosticsSourceKeyForResume({
            source: resume.source,
            content: resume.content,
        }),
        name: toStringValue(content.name),
        jobIntention: toStringValue(content.jobIntention),
        location: toStringValue(content.location) || formatLocationHierarchyLabel(locationHierarchy),
        ...(resume.isArchived === true ? { isArchived: true, archivedAt: resume.archivedAt } : {}),
        ingestData: ingestData ? {
            industryTags: ingestData.industryTags,
            companyHits: ingestData.companyHits ?? [],
            brandHits: projectIngestDiagnosticsBrandHits(ingestData.brandHits),
            experienceLevel: ingestData.experienceLevel,
            ruleScoreCount: countRuleScores(ingestData.ruleScores),
            computedAt: ingestData.computedAt,
            skillsVersion: ingestData.skillsVersion,
            ...(typeof ingestData.ingestComputeEpoch === "number"
                ? { ingestComputeEpoch: ingestData.ingestComputeEpoch }
                : {}),
            taggingEntries: projectIngestDiagnosticsTaggingEntries(ingestData.taggingEnvelope),
        } : undefined,
    };
}
