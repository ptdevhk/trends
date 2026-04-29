import { action, internalMutation, internalQuery, mutation, query, type QueryCtx } from "./_generated/server";
import { api, internal } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";
import { paginationOptsValidator } from "convex/server";
import { v } from "convex/values";

import {
    buildResumeAnalysisStorageKey,
    buildWorkHistoryEntryText,
    computeVerifiedRoleYears,
    formatLocationHierarchySearchText,
    formatLocationHierarchyLabel,
    getVerifiedRoleSignalYears,
    isResumeAnalysisKeyForJobDescription,
    isLocationMatch,
    KNOWN_DIAGNOSTICS_SOURCE_KEYS,
    normalizeKeywordPhrases,
    resolveResumeDiagnosticsSourceKey,
    normalizeResumeLocationHierarchy,
    resolveResumeAnalysisSourceKey,
    selectLatestWorkHistory,
} from "@trends/shared";
import { parseAgeFromContent } from "./lib/age";
import { deriveResumeIdentity } from "./lib/resume_identity";
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

function hasNonEmptyArray(value: unknown): boolean {
    return Array.isArray(value) && value.length > 0;
}

function readRecordArray(value: unknown): Record<string, unknown>[] {
    if (!Array.isArray(value)) {
        return [];
    }
    return value.filter(isRecord);
}

function hasResumeFieldValue(content: Record<string, unknown>, keys: string[]): boolean {
    return keys.some((key) => Boolean(toOptionalStringValue(content[key])));
}

function hasWorkHistoryDescriptionEntries(value: unknown): boolean {
    return readRecordArray(value).some((entry) => Boolean(toOptionalStringValue(entry.description)));
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

function resolveRuleScoreLookupKeys(jobDescriptionId: string | undefined): string[] {
    const normalized = toOptionalStringValue(jobDescriptionId);
    if (!normalized) {
        return [];
    }

    const keys = new Set<string>([normalized]);
    if (normalized.startsWith("jd-")) {
        const legacySlug = normalized.slice(3).trim();
        if (legacySlug) {
            keys.add(legacySlug);
        }
    } else {
        keys.add(`jd-${normalized}`);
    }

    return Array.from(keys);
}

function getIngestRuleScore(resume: Doc<"resumes">, jobDescriptionId: string | undefined): number {
    const ruleScores = toRuleScores(resume.ingestData?.ruleScores);
    for (const key of resolveRuleScoreLookupKeys(jobDescriptionId)) {
        const score = ruleScores[key];
        if (typeof score === "number" && Number.isFinite(score)) {
            return score;
        }
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

export type DiagnosticsSourceFacetRow = {
    key: string;
    label: string;
    count: number;
};

export type ResumeUsageScanRow = {
    analysis?: Doc<"resumes">["analysis"];
    analyses?: Doc<"resumes">["analyses"];
};

export type ResumeWorkflowDatasetRow = {
    source: Doc<"resumes">["source"];
    content?: {
        profileType?: string;
    };
};

export type ResumeFieldCoverageDatasetRow = {
    source: Doc<"resumes">["source"];
    profileType?: string;
    profileUrl: boolean;
    resumeId: boolean;
    workHistoryCount: number;
    workHistoryHasDescription: boolean;
    profileEducation: boolean;
    jobIntention: boolean;
    expectedSalary: boolean;
    selfIntro: boolean;
    skills: boolean;
};

type ResumeBackupRow = {
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

type ResumeBackupFilterArgs = {
    resumeIds?: string[];
    sourceHosts?: string[];
    limit?: number;
};

type ResumeBackupFilterSets = {
    resumeIds?: Set<string>;
    sourceHosts?: Set<string>;
};

type ResumeListProjectedDoc = {
    _id: Doc<"resumes">["_id"];
    externalId: string;
    identityKey?: string;
    age?: number;
    content: Record<string, unknown>;
    crawledAt: number;
    source: string;
    tags: string[];
    analysis?: Doc<"resumes">["analysis"];
    analyses?: Doc<"resumes">["analyses"];
    primaryRuleScore?: number;
    isArchived?: boolean;
    archivedAt?: number;
    ingestData?: {
        industryTags: string[];
        brandHits?: Array<{
            brand: string;
            role: string;
            source: string;
            context: string;
        }>;
        companyHits?: string[];
        industryDbV2Raw?: number;
        roleSignals?: Array<{
            type: string;
            matchedSignals: string[];
            signalCount: number;
            occurrences: number;
            years: number;
            industryVerifiedYears?: number;
            roleRelevantYears?: number;
            industryVerifiedRelevantYears?: number;
            matchedWorkEntries?: Array<{
                companyName?: string;
                jobTitle?: string;
                years: number;
                industryVerified: boolean;
                matchedSignals: string[];
                directRoleMatch?: boolean;
            }>;
            verifyIn: string;
        }>;
        ruleScores: unknown;
        experienceLevel: string;
        computedAt: number;
        skillsVersion: number;
    };
};

type ResumeListFilterArgs = {
    minExperience?: number;
    maxExperience?: number;
    minRoleYears?: number;
    roleFilterType?: string;
    minAge?: number;
    maxAge?: number;
    education?: string[];
    skills?: string[];
    requiredKeywords?: string[];
    locations?: string[];
    minSalary?: number;
    maxSalary?: number;
    showArchived?: boolean;
    sources?: string[];
};

type ResumeListSortBy = "name" | "experience" | "extractedAt";
type ResumeListSortOrder = "asc" | "desc";

type ResumeListPageArgs = ResumeListFilterArgs & {
    limit?: number;
    offset?: number;
    jobDescriptionId?: string;
    sortBy?: ResumeListSortBy;
    sortOrder?: ResumeListSortOrder;
};

type SearchWithTagExpansionPageArgs = ResumeListPageArgs & {
    query: string;
    keywordGroups: Array<{
        original: string;
        variants: string[];
    }>;
    mode?: "AND" | "OR";
    sourceMappings?: Array<{
        term: string;
        expandedFrom: string;
    }>;
};

type SearchWithTagExpansionScanPageArgs = ResumeListFilterArgs & {
    paginationOpts: {
        cursor: string | null;
        numItems: number;
    };
    query: string;
    keywordGroups: Array<{
        original: string;
        variants: string[];
    }>;
    mode?: "AND" | "OR";
    sourceMappings?: Array<{
        term: string;
        expandedFrom: string;
    }>;
};

type DeleteResumesResult = {
    requested: number;
    deleted: number;
    missingResumeIds: string[];
    deletedAiTaggingResults: number;
    patchedScreeningSessions: number;
};

const DEFAULT_RESUME_LIMIT = 50;
export const MAX_SAFE_LIST_WITH_INGEST_LIMIT = 2000;
export const MAX_SAFE_LIST_WITH_INGEST_OVERFETCH = 4000;
const FILTERED_PAGINATE_OVERFETCH_MULTIPLIER = 3;
const MAX_SAFE_JD_PAGINATE_SCAN = 250;
// Convex enforces 16 MiB total data read per query function.
// Resume docs average ~27KB but some exceed 500KB on later search index pages.
// With post-filter attrition (filtered path), overfetch is needed but output shrinks.
// Without attrition (no-filter path), each doc contributes full size to the read budget.
// 16 × 500KB = ~8MB worst case; 128 × 27KB = ~3.5MB filtered avg — both safe.
const MAX_SAFE_SEARCH_PAGINATE_SCAN = 128;
const MAX_SAFE_SEARCH_PAGINATE_SCAN_UNFILTERED = 16;
// Convex search index scans up to 1024 results; 1024 × 27KB = 27MB > 16 MiB.
// Cap .take() path to 400 docs × 30KB = ~12MB, safely under 16 MiB limit.
const MAX_SAFE_SEARCH_TAKE_LIMIT = 400;
const MAX_INGEST_DIAGNOSTICS_PAGE_SIZE = 100;
const MAX_INGEST_DIAGNOSTICS_TAGGING_ENTRIES = 8;
const DIAGNOSTICS_SOURCE_FILTER_BATCH_MULTIPLIER = 3;
const DEFAULT_RESUME_SCAN_BATCH_SIZE = 25;
const MAX_RESUME_SCAN_BATCH_SIZE = 50;
const DEFAULT_RESUME_BACKUP_PAGE_SIZE = 25;
const MAX_RESUME_BACKUP_PAGE_SIZE = 25;

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

function normalizeDiagnosticsSourceFilterValues(values: string[] | undefined): string[] | undefined {
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

function normalizeRequestedResumeIds(resumeIds: string[]): string[] {
    const normalizedIds: string[] = [];
    const seen = new Set<string>();

    for (const resumeId of resumeIds) {
        const token = resumeId.trim();
        if (!token || seen.has(token)) {
            continue;
        }
        seen.add(token);
        normalizedIds.push(token);
    }

    return normalizedIds;
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

export function resolveSearchWithTagExpansionTakeLimit(params: {
    limit: number | undefined;
    offset: number | undefined;
    hasFilters: boolean;
    jobDescriptionId?: string;
}): number {
    const { offset, pageLimit, overfetchLimit } = resolveListWithIngestPageWindow(params.limit, params.offset);
    const requestedWindow = offset + pageLimit;

    if (!params.hasFilters && !params.jobDescriptionId?.trim()) {
        return Math.min(overfetchLimit, MAX_SAFE_SEARCH_TAKE_LIMIT);
    }

    return Math.min(
        Math.max(overfetchLimit, requestedWindow, MAX_SAFE_JD_PAGINATE_SCAN),
        MAX_SAFE_SEARCH_TAKE_LIMIT,
    );
}

function projectResumeBaseContent(
    resume: Doc<"resumes">,
    workHistory: unknown,
): Record<string, unknown> {
    const content = isRecord(resume.content) ? resume.content : {};
    const locationHierarchy = normalizeResumeLocationHierarchy(content, resume.source);
    const name = toOptionalStringValue(content.name);
    const profileUrl = toOptionalStringValue(content.profileUrl)
        ?? toOptionalStringValue(content.profile_url)
        ?? toOptionalStringValue(content.profileURL)
        ?? toOptionalStringValue(content.url);
    const activityStatus = toOptionalStringValue(content.activityStatus);
    const age = toOptionalStringValue(content.age);
    const experience = toOptionalStringValue(content.experience);
    const education = toOptionalStringValue(content.education);
    const location = toOptionalStringValue(content.location);
    const selfIntro = toOptionalStringValue(content.selfIntro);
    const jobIntention = toOptionalStringValue(content.jobIntention);
    const expectedSalary = toOptionalStringValue(content.expectedSalary);
    const extractedAt = toOptionalStringValue(content.extractedAt);
    const resumeId = toOptionalStringValue(content.resumeId);
    const perUserId = toOptionalStringValue(content.perUserId);
    const profileId = toOptionalStringValue(content.profileId);
    const profileType = toOptionalStringValue(content.profileType);

    return {
        ...(name ? { name } : {}),
        ...(profileUrl ? { profileUrl } : {}),
        ...(activityStatus ? { activityStatus } : {}),
        ...(age ? { age } : {}),
        ...(experience ? { experience } : {}),
        ...(education ? { education } : {}),
        ...(location ? { location } : {}),
        ...(locationHierarchy ? { locationHierarchy } : {}),
        ...(selfIntro ? { selfIntro } : {}),
        ...(jobIntention ? { jobIntention } : {}),
        ...(expectedSalary ? { expectedSalary } : {}),
        ...(Array.isArray(workHistory) && workHistory.length > 0 ? { workHistory } : {}),
        ...(extractedAt ? { extractedAt } : {}),
        ...(resumeId ? { resumeId } : {}),
        ...(perUserId ? { perUserId } : {}),
        ...(profileId ? { profileId } : {}),
        ...(profileType ? { profileType } : {}),
        externalId: resume.externalId,
    };
}

function projectResumeListWorkHistory(workHistory: unknown): Array<Record<string, string>> {
    return selectLatestWorkHistory(workHistory).map((entry) => {
        const projected = {
            ...(entry.companyName ? { companyName: entry.companyName } : {}),
            ...(entry.jobTitle ? { jobTitle: entry.jobTitle } : {}),
            ...(entry.startDate ? { startDate: entry.startDate } : {}),
            ...(entry.endDate ? { endDate: entry.endDate } : {}),
        };

        if (Object.keys(projected).length > 0) {
            return projected;
        }

        return entry.raw ? { raw: entry.raw.slice(0, 160) } : {};
    });
}

function projectResumeListContent(resume: Doc<"resumes">): Record<string, unknown> {
    const content = isRecord(resume.content) ? resume.content : {};
    return projectResumeBaseContent(resume, projectResumeListWorkHistory(content.workHistory));
}

function projectResumeDetailContent(resume: Doc<"resumes">): Record<string, unknown> {
    const content = isRecord(resume.content) ? resume.content : {};
    const workHistory = selectLatestWorkHistory(content.workHistory);
    return projectResumeBaseContent(resume, workHistory);
}

function projectResumeListIngestData(
    ingestData: Doc<"resumes">["ingestData"],
): ResumeListProjectedDoc["ingestData"] {
    if (!ingestData) {
        return undefined;
    }

    return {
        industryTags: ingestData.industryTags,
        ...(ingestData.brandHits
            ? {
                brandHits: ingestData.brandHits.map((hit) => ({
                    brand: hit.brand,
                    role: hit.role,
                    source: hit.source,
                    context: hit.context,
                })),
            }
            : {}),
        ...(ingestData.companyHits ? { companyHits: ingestData.companyHits } : {}),
        ...(ingestData.industryDbV2Raw === undefined ? {} : { industryDbV2Raw: ingestData.industryDbV2Raw }),
        ...(ingestData.roleSignals
            ? {
                roleSignals: ingestData.roleSignals.map((signal) => ({
                    type: signal.type,
                    matchedSignals: signal.matchedSignals,
                    signalCount: signal.signalCount,
                    occurrences: signal.occurrences,
                    years: signal.years,
                    ...(signal.industryVerifiedYears === undefined ? {} : { industryVerifiedYears: signal.industryVerifiedYears }),
                    ...(signal.roleRelevantYears === undefined ? {} : { roleRelevantYears: signal.roleRelevantYears }),
                    ...(signal.industryVerifiedRelevantYears === undefined ? {} : { industryVerifiedRelevantYears: signal.industryVerifiedRelevantYears }),
                    ...(signal.matchedWorkEntries
                        ? {
                            matchedWorkEntries: signal.matchedWorkEntries.map((entry) => ({
                                ...(entry.companyName ? { companyName: entry.companyName } : {}),
                                ...(entry.jobTitle ? { jobTitle: entry.jobTitle } : {}),
                                years: entry.years,
                                industryVerified: entry.industryVerified,
                                matchedSignals: entry.matchedSignals,
                                ...(typeof entry.directRoleMatch === "boolean"
                                    ? { directRoleMatch: entry.directRoleMatch }
                                    : {}),
                            })),
                        }
                        : {}),
                    verifyIn: signal.verifyIn,
                })),
            }
            : {}),
        ...(ingestData.verifiedRoleYears ? { verifiedRoleYears: ingestData.verifiedRoleYears } : {}),
        ruleScores: ingestData.ruleScores,
        experienceLevel: ingestData.experienceLevel,
        computedAt: ingestData.computedAt,
        skillsVersion: ingestData.skillsVersion,
    };
}

function projectResumeListDoc(resume: Doc<"resumes">): ResumeListProjectedDoc {
    return {
        _id: resume._id,
        externalId: resume.externalId,
        ...(resume.identityKey ? { identityKey: resume.identityKey } : {}),
        ...(resume.age === undefined ? {} : { age: resume.age }),
        content: projectResumeListContent(resume),
        crawledAt: resume.crawledAt,
        source: resume.source,
        tags: resume.tags,
        ...(resume.analysis ? { analysis: resume.analysis } : {}),
        ...(resume.analyses ? { analyses: resume.analyses } : {}),
        ...(resume.primaryRuleScore === undefined ? {} : { primaryRuleScore: resume.primaryRuleScore }),
        ...(resume.isArchived === true ? { isArchived: true, archivedAt: resume.archivedAt } : {}),
        ...(resume.ingestData ? { ingestData: projectResumeListIngestData(resume.ingestData) } : {}),
    };
}

function projectResumeDetailDoc(resume: Doc<"resumes">): ResumeListProjectedDoc {
    return {
        _id: resume._id,
        externalId: resume.externalId,
        ...(resume.identityKey ? { identityKey: resume.identityKey } : {}),
        ...(resume.age === undefined ? {} : { age: resume.age }),
        content: projectResumeDetailContent(resume),
        crawledAt: resume.crawledAt,
        source: resume.source,
        tags: resume.tags,
        ...(resume.analysis ? { analysis: resume.analysis } : {}),
        ...(resume.analyses ? { analyses: resume.analyses } : {}),
        ...(resume.primaryRuleScore === undefined ? {} : { primaryRuleScore: resume.primaryRuleScore }),
        ...(resume.isArchived === true ? { isArchived: true, archivedAt: resume.archivedAt } : {}),
        ...(resume.ingestData ? { ingestData: projectResumeListIngestData(resume.ingestData) } : {}),
    };
}

function normalizeResumeListFilters(filters: ResumeListFilterArgs | undefined): ResumeListFilterArgs | undefined {
    if (!filters) {
        return undefined;
    }

    const education = filters.education?.map((value) => value.trim().toLowerCase()).filter((value) => value.length > 0);
    const skills = filters.skills?.map((value) => value.trim().toLowerCase()).filter((value) => value.length > 0);
    const requiredKeywords = normalizeKeywordPhrases(filters.requiredKeywords ?? [])
        .map((value) => value.toLowerCase())
        .filter((value) => value.length > 0);
    const locations = filters.locations?.map((value) => value.trim()).filter((value) => value.length > 0);
    const sources = filters.sources?.map((value) => value.trim().toLowerCase()).filter((value) => value.length > 0);
    const roleFilterType = toOptionalStringValue(filters.roleFilterType)?.toLowerCase();
    const minAge = typeof filters.minAge === "number" && Number.isFinite(filters.minAge) && filters.minAge > 0
        ? Math.trunc(filters.minAge)
        : undefined;
    const maxAge = typeof filters.maxAge === "number" && Number.isFinite(filters.maxAge) && filters.maxAge > 0
        ? Math.trunc(filters.maxAge)
        : undefined;

    const normalized: ResumeListFilterArgs = {
        ...((filters.minExperience ?? 0) > 0 ? { minExperience: filters.minExperience } : {}),
        ...(filters.maxExperience === undefined ? {} : { maxExperience: filters.maxExperience }),
        ...((filters.minRoleYears ?? 0) > 0 ? { minRoleYears: filters.minRoleYears } : {}),
        ...(roleFilterType ? { roleFilterType } : {}),
        ...(minAge === undefined ? {} : { minAge }),
        ...(maxAge === undefined ? {} : { maxAge }),
        ...(education && education.length > 0 ? { education } : {}),
        ...(skills && skills.length > 0 ? { skills } : {}),
        ...(requiredKeywords.length > 0 ? { requiredKeywords } : {}),
        ...(locations && locations.length > 0 ? { locations } : {}),
        ...(filters.minSalary === undefined ? {} : { minSalary: filters.minSalary }),
        ...(filters.maxSalary === undefined ? {} : { maxSalary: filters.maxSalary }),
        ...(filters.showArchived ? { showArchived: true } : {}),
        ...(sources && sources.length > 0 ? { sources } : {}),
    };

    return Object.keys(normalized).length > 0 ? normalized : undefined;
}

function parseExperienceYears(value: string): number | null {
    if (!value) {
        return null;
    }
    const normalized = value.trim();
    if (!normalized) {
        return null;
    }
    if (/应届|无经验/.test(normalized)) {
        return 0;
    }
    const match = normalized.match(/(\d+)(?:\s*[-~到]\s*(\d+))?/);
    if (!match) {
        return null;
    }
    const min = Number(match[1]);
    const max = match[2] ? Number(match[2]) : min;
    return Number.isNaN(max) ? null : max;
}

function normalizeEducationLevel(value: string): string | null {
    if (!value) {
        return null;
    }
    const normalized = value.trim();
    if (!normalized) {
        return null;
    }
    if (/博士/.test(normalized)) return "phd";
    if (/硕士|研究生/.test(normalized)) return "master";
    if (/本科/.test(normalized)) return "bachelor";
    if (/大专|专科/.test(normalized)) return "associate";
    if (/中专|高中|中技/.test(normalized)) return "high_school";
    return null;
}

function parseSalaryRange(value: string): { min?: number; max?: number } | null {
    if (!value) {
        return null;
    }
    const normalized = value.replace(/\s/g, "");
    if (!normalized || /面议/.test(normalized)) {
        return null;
    }
    const match = normalized.match(/(\d+(?:\.\d+)?)(?:-(\d+(?:\.\d+)?))?/);
    if (!match) {
        return null;
    }
    const min = Number(match[1]);
    const max = match[2] ? Number(match[2]) : undefined;
    if (Number.isNaN(min)) {
        return null;
    }
    return { min, max };
}

function buildResumeFilterSearchText(content: Record<string, unknown>, source?: string): string {
    const locationText = formatLocationHierarchySearchText(normalizeResumeLocationHierarchy(content, source)) || toStringValue(content.location);
    const latestWorkHistory = selectLatestWorkHistory(content.workHistory);
    const parts = [
        toStringValue(content.name),
        toStringValue(content.education),
        locationText,
        toStringValue(content.expectedSalary),
        ...latestWorkHistory.map((entry) => buildWorkHistoryEntryText(entry)),
    ];
    return parts.join(" ").toLowerCase();
}

function matchesAllRequiredKeywords(text: string, requiredKeywords: string[] | undefined): boolean {
    const normalizedKeywords = normalizeKeywordPhrases(requiredKeywords ?? [])
        .map((keyword) => keyword.toLowerCase());
    if (normalizedKeywords.length === 0) {
        return true;
    }

    const haystack = text.trim().toLowerCase();
    if (!haystack) {
        return false;
    }

    return normalizedKeywords.every((keyword) => haystack.includes(keyword));
}

/**
 * Resolve the verified role-years value used by the `minRoleYears` filter.
 *
 * Preference order:
 *   1. Precomputed `ingestData.verifiedRoleYears[roleType]` (populated at
 *      ingest time and by the paginated backfill migration).
 *   2. Live compute via `getVerifiedRoleSignalYears` — same semantics as the
 *      stored projection. Guards the transition window before backfill
 *      completes, and old resumes whose `ingestData` has not been rewritten.
 *
 * Never consults unverified `roleRelevantYears` or raw `years`. See plan:
 * docs/superpowers/plans/2026-04-24-direct-role-years-precomputed-field-plan.md
 */
function hasMatchingRoleSignal(resume: Doc<"resumes">, roleType: string | undefined): boolean {
    const key = toOptionalStringValue(roleType)?.toLowerCase() ?? "";
    if (!key) {
        return true;
    }

    // The stored verifiedRoleYears field is the source of truth for role years;
    // if it has an entry for the given role type, the resume matches that role.
    const verifiedRoleYears = resume.ingestData?.verifiedRoleYears;
    if (isRecord(verifiedRoleYears) && typeof verifiedRoleYears[key] === "number") {
        return true;
    }

    const roleSignals = resume.ingestData?.roleSignals;
    if (!Array.isArray(roleSignals) || roleSignals.length === 0) {
        return false;
    }

    return roleSignals.some((signal) => signal.type?.trim().toLowerCase() === key);
}

function getResumeRoleYears(resume: Doc<"resumes">, roleType: string | undefined): number {
    const key = toOptionalStringValue(roleType)?.toLowerCase() ?? "";
    if (!key) {
        return 0;
    }

    const stored = resume.ingestData?.verifiedRoleYears?.[key];
    if (typeof stored === "number" && Number.isFinite(stored)) {
        return stored;
    }

    const roleSignals = resume.ingestData?.roleSignals;
    if (!Array.isArray(roleSignals) || roleSignals.length === 0) {
        return 0;
    }

    return getVerifiedRoleSignalYears(roleSignals, key);
}

function resolveResumeAge(resume: Doc<"resumes">, content: Record<string, unknown>): number | null {
    if (typeof resume.age === "number" && Number.isFinite(resume.age) && resume.age > 0) {
        return Math.trunc(resume.age);
    }

    return parseAgeFromContent(content);
}

function matchesResumeListFilters(resume: Doc<"resumes">, filters: ResumeListFilterArgs | undefined): boolean {
    if (!filters?.showArchived && resume.isArchived === true) {
        return false;
    }
    if (!filters) {
        return true;
    }

    const content = isRecord(resume.content) ? resume.content : {};

    const effectiveMinExperience = (filters.minExperience ?? 0) > 0 ? filters.minExperience : undefined;
    if (effectiveMinExperience !== undefined || filters.maxExperience !== undefined) {
        const experience = parseExperienceYears(toStringValue(content.experience));
        if (experience === null) {
            return false;
        }
        if (effectiveMinExperience !== undefined && experience < effectiveMinExperience) {
            return false;
        }
        if (filters.maxExperience !== undefined && experience > filters.maxExperience) {
            return false;
        }
    }

    if (filters.roleFilterType) {
        if (!hasMatchingRoleSignal(resume, filters.roleFilterType)) {
            return false;
        }
    }

    if ((filters.minRoleYears ?? 0) > 0) {
        const roleYears = getResumeRoleYears(resume, filters.roleFilterType);
        if (roleYears < filters.minRoleYears!) {
            return false;
        }
    }

    if (filters.minAge !== undefined || filters.maxAge !== undefined) {
        const age = resolveResumeAge(resume, content);
        if (age !== null) {
            if (filters.minAge !== undefined && age < filters.minAge) {
                return false;
            }
            if (filters.maxAge !== undefined && age > filters.maxAge) {
                return false;
            }
        }
    }

    if (filters.education?.length) {
        const level = normalizeEducationLevel(toStringValue(content.education));
        if (!level || !filters.education.includes(level)) {
            return false;
        }
    }

    if (filters.locations?.length) {
        const location = formatLocationHierarchySearchText(normalizeResumeLocationHierarchy(content, resume.source)) || toStringValue(content.location);
        const hasLocation = filters.locations.some((target) => isLocationMatch(location, target));
        if (!hasLocation) {
            return false;
        }
    }

    if (filters.skills?.length) {
        const haystack = buildResumeFilterSearchText(content, resume.source);
        const hasSkill = filters.skills.some((skill) => haystack.includes(skill));
        if (!hasSkill) {
            return false;
        }
    }

    if (filters.requiredKeywords?.length) {
        const haystack = buildResumeFilterSearchText(content, resume.source);
        if (!matchesAllRequiredKeywords(haystack, filters.requiredKeywords)) {
            return false;
        }
    }

    if (filters.minSalary !== undefined || filters.maxSalary !== undefined) {
        const salary = parseSalaryRange(toStringValue(content.expectedSalary));
        if (!salary) {
            return false;
        }
        if (filters.minSalary !== undefined) {
            const maxSalary = salary.max ?? salary.min;
            if (maxSalary !== undefined && maxSalary < filters.minSalary) {
                return false;
            }
        }
        if (filters.maxSalary !== undefined) {
            const minSalary = salary.min ?? salary.max;
            if (minSalary !== undefined && minSalary > filters.maxSalary) {
                return false;
            }
        }
    }

    if (filters.sources?.length) {
        const resumeSourceKey = resume.sourceKey
            ?? resolveResumeAnalysisSourceKey({ source: resume.source });
        if (!resumeSourceKey || !filters.sources.includes(resumeSourceKey)) {
            return false;
        }
    }

    return true;
}

function resolveResumeListSortOrder(sortOrder: ResumeListSortOrder | undefined): ResumeListSortOrder {
    if (sortOrder === "asc" || sortOrder === "desc") {
        return sortOrder;
    }
    return "asc";
}

function compareResumeListSort(
    left: Doc<"resumes">,
    right: Doc<"resumes">,
    sortBy: ResumeListSortBy,
    sortOrder: ResumeListSortOrder
): number {
    const direction = sortOrder === "desc" ? -1 : 1;
    const leftContent = isRecord(left.content) ? left.content : {};
    const rightContent = isRecord(right.content) ? right.content : {};

    if (sortBy === "experience") {
        const leftExperience = parseExperienceYears(toStringValue(leftContent.experience)) ?? -1;
        const rightExperience = parseExperienceYears(toStringValue(rightContent.experience)) ?? -1;
        const diff = (leftExperience - rightExperience) * direction;
        if (diff !== 0) {
            return diff;
        }
    } else if (sortBy === "extractedAt") {
        const leftTime = Date.parse(toStringValue(leftContent.extractedAt)) || 0;
        const rightTime = Date.parse(toStringValue(rightContent.extractedAt)) || 0;
        const diff = (leftTime - rightTime) * direction;
        if (diff !== 0) {
            return diff;
        }
    } else {
        const leftName = toStringValue(leftContent.name).toLowerCase();
        const rightName = toStringValue(rightContent.name).toLowerCase();
        const diff = leftName.localeCompare(rightName) * direction;
        if (diff !== 0) {
            return diff;
        }
    }

    return 0;
}

function sortResumeDocs(
    resumes: Doc<"resumes">[],
    options: {
        jobDescriptionId?: string;
        sortBy?: ResumeListSortBy;
        sortOrder?: ResumeListSortOrder;
    }
): Doc<"resumes">[] {
    if (options.sortBy) {
        const { sortBy } = options;
        const resolvedSortOrder = resolveResumeListSortOrder(options.sortOrder);
        return [...resumes].sort((left, right) => compareResumeListSort(left, right, sortBy, resolvedSortOrder));
    }

    return sortByIngestRuleScore(resumes, options.jobDescriptionId);
}

function resolveListWithIngestPageWindow(requestedLimit: number | undefined, requestedOffset: number | undefined): {
    offset: number;
    pageLimit: number;
    scanLimit: number;
    overfetchLimit: number;
} {
    const offset = Math.max(Math.trunc(requestedOffset ?? 0), 0);
    const pageLimit = Math.min(Math.max(requestedLimit || DEFAULT_RESUME_LIMIT, 1), MAX_SAFE_LIST_WITH_INGEST_LIMIT);
    const { limit: scanLimit, overfetchLimit } = resolveListWithIngestWindow(offset + pageLimit);
    return {
        offset,
        pageLimit,
        scanLimit,
        overfetchLimit,
    };
}

function resolvePaginatedResumeOffsetCursor(cursor: string | null | undefined): number {
    if (!cursor) {
        return 0;
    }

    const parsed = Number.parseInt(cursor, 10);
    if (!Number.isFinite(parsed) || parsed <= 0) {
        return 0;
    }

    return parsed;
}

function resolvePaginatedResumePageLimit(numItems: number | undefined): number {
    if (typeof numItems !== "number" || !Number.isFinite(numItems)) {
        return DEFAULT_RESUME_LIMIT;
    }

    return Math.min(Math.max(Math.trunc(numItems), 1), MAX_SAFE_LIST_WITH_INGEST_LIMIT);
}

function buildPaginatedOffsetResult<T>(page: T[], total: number, offset: number): {
    page: T[];
    continueCursor: string;
    isDone: boolean;
} {
    const nextOffset = offset + page.length;
    const isDone = nextOffset >= total;
    return {
        page,
        continueCursor: isDone ? "" : String(nextOffset),
        isDone,
    };
}

export function resolveResumeScanBatchSize(requestedLimit: number | undefined): number {
    const normalizedLimit = typeof requestedLimit === "number" && Number.isFinite(requestedLimit)
        ? Math.trunc(requestedLimit)
        : DEFAULT_RESUME_SCAN_BATCH_SIZE;
    return Math.min(Math.max(normalizedLimit, 1), MAX_RESUME_SCAN_BATCH_SIZE);
}

function resolveResumeBackupPageSize(requestedLimit: number | undefined): number {
    const normalizedLimit = typeof requestedLimit === "number" && Number.isFinite(requestedLimit)
        ? Math.trunc(requestedLimit)
        : DEFAULT_RESUME_BACKUP_PAGE_SIZE;
    return Math.min(Math.max(normalizedLimit, 1), MAX_RESUME_BACKUP_PAGE_SIZE);
}

function projectResumeBackupRow(resume: Doc<"resumes">): ResumeBackupRow {
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

function normalizeResumeBackupFilterValues(values: string[] | undefined): string[] | undefined {
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

function normalizeResumeBackupSourceHosts(values: string[] | undefined): string[] | undefined {
    const normalized = normalizeResumeBackupFilterValues(values);
    return normalized?.map((value) => value.toLowerCase());
}

function compareResumeBackupRows(left: ResumeBackupRow, right: ResumeBackupRow): number {
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

function applyResumeBackupFilters(resumes: Doc<"resumes">[], filterSets: ResumeBackupFilterSets): ResumeBackupRow[] {
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

function normalizeResumeBackupFetchLimit(limit: number | undefined, requestedResumeIds: string[] | undefined): number | undefined {
    if (requestedResumeIds && requestedResumeIds.length > 0) {
        return undefined;
    }
    return limit;
}

function normalizeResumeBackupRequestedLimit(limit: number | undefined): number | undefined {
    if (typeof limit !== "number" || !Number.isFinite(limit)) {
        return undefined;
    }
    return Math.max(1, Math.trunc(limit));
}

function normalizeResumeBackupArgs(args: ResumeBackupFilterArgs): ResumeBackupFilterArgs {
    return {
        resumeIds: normalizeResumeBackupFilterValues(args.resumeIds),
        sourceHosts: normalizeResumeBackupSourceHosts(args.sourceHosts),
        limit: normalizeResumeBackupRequestedLimit(args.limit),
    };
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

async function runListWithIngestDataPageQuery(
    ctx: QueryCtx,
    args: ResumeListPageArgs
): Promise<{
    total: number;
    results: Doc<"resumes">[];
}> {
    const { offset, pageLimit, scanLimit, overfetchLimit } = resolveListWithIngestPageWindow(args.limit, args.offset);
    const jobDescriptionId = args.jobDescriptionId?.trim() || undefined;
    const filters = normalizeResumeListFilters(args);
    const candidates = await ctx.db
        .query("resumes")
        .withIndex("by_primaryRuleScore")
        .order("desc")
        .filter((q) => q.neq(q.field("isArchived"), true))
        .take(overfetchLimit);
    const sorted = sortResumeDocs(candidates, {
        jobDescriptionId,
        sortBy: args.sortBy,
        sortOrder: args.sortOrder,
    })
        .filter((resume) => matchesResumeListFilters(resume, filters))
        .slice(0, scanLimit);

    return {
        total: sorted.length,
        results: sorted.slice(offset, offset + pageLimit),
    };
}

async function runSearchWithTagExpansionPageQuery(
    ctx: QueryCtx,
    args: SearchWithTagExpansionPageArgs
): Promise<{
    expansion: {
        original: string;
        expanded: string[];
        groups: TagExpansionKeywordGroup[];
        mode: "AND" | "OR";
    };
    total: number;
    results: Array<{ resume: Doc<"resumes">; provenance: SearchProvenance[] }>;
}> {
    const { offset, pageLimit } = resolveListWithIngestPageWindow(args.limit, args.offset);
    const jobDescriptionId = args.jobDescriptionId?.trim() || undefined;
    const filters = normalizeResumeListFilters(args);
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
            total: 0,
            results: [],
        };
    }

    const sourceMapping = Object.fromEntries(
        (args.sourceMappings ?? []).map((entry) => [entry.term, entry.expandedFrom])
    );
    const provenanceByResumeId = new Map<string, SearchProvenance[]>();
    const searchQuery = buildTagExpansionSearchQuery(keywordGroups, mode);
    const takeLimit = resolveSearchWithTagExpansionTakeLimit({
        limit: args.limit,
        offset: args.offset,
        hasFilters: filters !== undefined,
        jobDescriptionId,
    });

    const matches = searchQuery
        ? await ctx.db
            .query("resumes")
            .withSearchIndex("search_body", (q) => q.search("searchText", searchQuery))
            .filter((q) => q.neq(q.field("isArchived"), true))
            .take(takeLimit)
        : [];

    const filteredDocs = matches.filter((doc) => {
        const provenance = resolveSearchWithTagExpansionMatch(
            doc,
            keywordGroups,
            mode,
            sourceMapping,
        );
        if (!provenance) {
            return false;
        }
        provenanceByResumeId.set(String(doc._id), provenance);
        return true;
    });

    const merged = mergeResumeDocs(filteredDocs, provenanceByResumeId, jobDescriptionId, takeLimit)
        .filter((entry) => matchesResumeListFilters(entry.resume, filters));
    let sorted = merged;
    if (args.sortBy) {
        const sortBy = args.sortBy;
        sorted = [...merged].sort((left, right) => compareResumeListSort(
            left.resume,
            right.resume,
            sortBy,
            resolveResumeListSortOrder(args.sortOrder)
        ));
    }

    return {
        expansion: {
            original: args.query,
            expanded: expandedTerms,
            groups: keywordGroups,
            mode,
        },
        total: sorted.length,
        results: sorted.slice(offset, offset + pageLimit),
    };
}

function resolveSearchWithTagExpansionMatch(
    doc: Doc<"resumes">,
    keywordGroups: TagExpansionKeywordGroup[],
    mode: "AND" | "OR",
    sourceMapping: Record<string, string>,
): SearchProvenance[] | null {
    const normalizedSearchText = (doc.searchText || "").toLowerCase();
    const matched = matchesTagExpansionSearchText(normalizedSearchText, keywordGroups, mode);

    if (!matched) {
        return null;
    }

    const provenance = collectSearchTextProvenance(normalizedSearchText, keywordGroups, sourceMapping);
    return provenance.length > 0 ? provenance : null;
}

async function runSearchWithTagExpansionScanPageQuery(
    ctx: QueryCtx,
    args: SearchWithTagExpansionScanPageArgs
): Promise<{
    expansion: {
        original: string;
        expanded: string[];
        groups: TagExpansionKeywordGroup[];
        mode: "AND" | "OR";
    };
    page: Array<{ resume: ResumeListProjectedDoc; provenance: SearchProvenance[] }>;
    continueCursor: string;
    isDone: boolean;
}> {
    const filters = normalizeResumeListFilters(args);
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
            page: [],
            continueCursor: "",
            isDone: true,
        };
    }

    const sourceMapping = Object.fromEntries(
        (args.sourceMappings ?? []).map((entry) => [entry.term, entry.expandedFrom])
    );
    const searchQuery = buildTagExpansionSearchQuery(keywordGroups, mode);
    const requestedPageSize = Math.max(Math.trunc(args.paginationOpts.numItems), 1);
    const hasActiveFilters = filters !== undefined;
    const pageSize = hasActiveFilters
        ? Math.min(requestedPageSize * FILTERED_PAGINATE_OVERFETCH_MULTIPLIER, MAX_SAFE_SEARCH_PAGINATE_SCAN)
        : Math.min(requestedPageSize, MAX_SAFE_SEARCH_PAGINATE_SCAN_UNFILTERED);

    const searchPage = searchQuery
        ? await ctx.db
            .query("resumes")
            .withSearchIndex("search_body", (q) => q.search("searchText", searchQuery))
            .filter((q) => q.neq(q.field("isArchived"), true))
            .paginate({
                ...args.paginationOpts,
                numItems: pageSize,
            })
        : {
            page: [] as Doc<"resumes">[],
            continueCursor: "",
            isDone: true,
        };

    return {
        expansion: {
            original: args.query,
            expanded: expandedTerms,
            groups: keywordGroups,
            mode,
        },
        page: searchPage.page.flatMap((doc) => {
            const provenance = resolveSearchWithTagExpansionMatch(
                doc,
                keywordGroups,
                mode,
                sourceMapping,
            );
            if (!provenance || !matchesResumeListFilters(doc, filters)) {
                return [];
            }

            return [{
                resume: projectResumeListDoc(doc),
                provenance,
            }];
        }),
        continueCursor: searchPage.continueCursor,
        isDone: searchPage.isDone,
    };
}

export const count = action({
    args: {},
    handler: async (ctx) => {
        let total = 0;
        let cursor: string | undefined;

        while (true) {
            const page = await ctx.runQuery(api.resumes.listWorkflowDatasetPage, {
                limit: MAX_RESUME_SCAN_BATCH_SIZE,
                ...(cursor ? { cursor } : {}),
            });

            total += page.page.length;
            if (page.isDone) {
                return total;
            }

            cursor = page.continueCursor ?? undefined;
            if (!cursor) {
                throw new Error("listWorkflowDatasetPage returned an unfinished page without a continueCursor");
            }
        }
    },
});

export const fieldCoverage = query({
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
                numItems: args.batchSize ?? 200,
            });

        let missingSearchText = 0;
        let missingVerifiedRoleYears = 0;
        let hasRoleSignals = 0;
        let hasVerifiedRoleYears = 0;

        for (const resume of resumes.page) {
            if (!resume.searchText) {
                missingSearchText += 1;
            }
            if (resume.ingestData?.roleSignals && resume.ingestData.roleSignals.length > 0) {
                hasRoleSignals += 1;
                const computed = computeVerifiedRoleYears(resume.ingestData.roleSignals);
                const existing = resume.ingestData.verifiedRoleYears;
                if (!shallowEqualNumberRecord(existing, computed)) {
                    missingVerifiedRoleYears += 1;
                }
                if (existing && Object.keys(existing).length > 0) {
                    hasVerifiedRoleYears += 1;
                }
            }
        }

        return {
            scanned: resumes.page.length,
            missingSearchText,
            missingVerifiedRoleYears,
            hasRoleSignals,
            hasVerifiedRoleYears,
            hasMore: !resumes.isDone,
            cursor: resumes.isDone ? null : resumes.continueCursor,
        };
    },
});

function shallowEqualNumberRecord(
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

export const list = query({
    args: { limit: v.optional(v.number()) },
    handler: async (ctx, args) => {
        const limit = args.limit || DEFAULT_RESUME_LIMIT;
        return await ctx.db.query("resumes").order("desc").filter((q) => q.neq(q.field("isArchived"), true)).take(limit);
    },
});

export const listForBackup = query({
    args: {
        paginationOpts: paginationOptsValidator,
        resumeIds: v.optional(v.array(v.string())),
        sourceHosts: v.optional(v.array(v.string())),
        limit: v.optional(v.number()),
    },
    handler: async (ctx, args) => {
        const normalizedArgs = normalizeResumeBackupArgs(args);
        const fetchLimit = normalizeResumeBackupFetchLimit(normalizedArgs.limit, normalizedArgs.resumeIds);
        const filterSets = createResumeBackupFilterSets(normalizedArgs);
        const pageSize = resolveResumeBackupPageSize(fetchLimit);
        const page = await ctx.db
            .query("resumes")
            .withIndex("by_crawledAt")
            .order("desc")
            .paginate({
                ...args.paginationOpts,
                numItems: pageSize,
            });

        const filtered = applyResumeBackupFilters(page.page, filterSets).sort(compareResumeBackupRows);

        return {
            page: filtered,
            continueCursor: page.continueCursor,
            isDone: page.isDone,
        };
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
            .filter((q) => q.neq(q.field("isArchived"), true))
            .take(overfetchLimit);
        return sortByIngestRuleScore(candidates, jobDescriptionId)
            .slice(0, limit)
            .map(projectResumeListDoc);
    },
});

export const getSummaryWindow = query({
    args: {
        fromTimestamp: v.number(),
        toTimestamp: v.number(),
    },
    handler: async (ctx, args) => {
        const rows = await ctx.db
            .query("resumes")
            .withIndex("by_crawledAt", (q) =>
                q.gte("crawledAt", args.fromTimestamp).lt("crawledAt", args.toTimestamp)
            )
            .filter((q) => q.neq(q.field("isArchived"), true))
            .collect();

        const bySource = new Map<string, number>();
        for (const row of rows) {
            const sourceKey = row.source.trim() || "unknown";
            bySource.set(sourceKey, (bySource.get(sourceKey) ?? 0) + 1);
        }

        return {
            total: rows.length,
            bySource: Array.from(bySource.entries())
                .map(([key, count]) => ({ key, count }))
                .sort((left, right) => {
                    if (right.count !== left.count) {
                        return right.count - left.count;
                    }
                    return left.key.localeCompare(right.key);
                }),
        };
    },
});

export const listWithIngestDataPage = query({
    args: {
        limit: v.optional(v.number()),
        offset: v.optional(v.number()),
        jobDescriptionId: v.optional(v.string()),
        sortBy: v.optional(v.union(v.literal("name"), v.literal("experience"), v.literal("extractedAt"))),
        sortOrder: v.optional(v.union(v.literal("asc"), v.literal("desc"))),
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
    },
    handler: async (ctx, args) => {
        const result = await runListWithIngestDataPageQuery(ctx, args);
        return {
            total: result.total,
            results: result.results.map(projectResumeListDoc),
        };
    },
});

export const listWithIngestDataPaginated = query({
    args: {
        paginationOpts: paginationOptsValidator,
        jobDescriptionId: v.optional(v.string()),
        sortBy: v.optional(v.union(v.literal("name"), v.literal("experience"), v.literal("extractedAt"))),
        sortOrder: v.optional(v.union(v.literal("asc"), v.literal("desc"))),
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
        sources: v.optional(v.array(v.string())),
    },
    handler: async (ctx, args) => {
        const filters = normalizeResumeListFilters(args);
        const jobDescriptionId = args.jobDescriptionId?.trim() || undefined;
        if (!args.sortBy) {
            const requestedPageSize = resolvePaginatedResumePageLimit(args.paginationOpts.numItems);
            const numItems = jobDescriptionId
                ? Math.min(
                    Math.max(
                        requestedPageSize,
                        filters ? Math.ceil(requestedPageSize * 1.5) : requestedPageSize
                    ),
                    MAX_SAFE_JD_PAGINATE_SCAN
                )
                : filters
                    ? Math.min(requestedPageSize * FILTERED_PAGINATE_OVERFETCH_MULTIPLIER, MAX_SAFE_LIST_WITH_INGEST_LIMIT)
                    : requestedPageSize;
            const page = await ctx.db
                .query("resumes")
                .withIndex("by_primaryRuleScore")
                .order("desc")
                .filter((q) => q.neq(q.field("isArchived"), true))
                .paginate({
                    ...args.paginationOpts,
                    numItems,
                });

            const filtered = filters
                ? page.page.filter((resume) => matchesResumeListFilters(resume, filters))
                : page.page;
            const ranked = jobDescriptionId
                ? sortByIngestRuleScore(filtered, jobDescriptionId)
                : filtered;

            return {
                page: ranked.map(projectResumeListDoc),
                continueCursor: page.continueCursor,
                isDone: page.isDone,
            };
        }

        const offset = resolvePaginatedResumeOffsetCursor(args.paginationOpts.cursor);
        const limit = resolvePaginatedResumePageLimit(args.paginationOpts.numItems);
        const page = await runListWithIngestDataPageQuery(ctx, {
            ...args,
            limit,
            offset,
        });

        return buildPaginatedOffsetResult(page.results.map(projectResumeListDoc), page.total, offset);
    },
});

function buildDiagnosticsBaseQuery(ctx: QueryCtx, archived: boolean) {
    return ctx.db
        .query("resumes")
        .withIndex("by_primaryRuleScore")
        .order("desc")
        .filter((q) => archived ? q.eq(q.field("isArchived"), true) : q.neq(q.field("isArchived"), true));
}

async function runDiagnosticsPageQuery(
    ctx: QueryCtx,
    args: {
        archived: boolean;
        paginationOpts: {
            cursor: string | null;
            numItems: number;
        };
        sourceKeys?: string[];
    }
): Promise<{
    page: IngestDiagnosticsRow[];
    continueCursor: string;
    isDone: boolean;
}> {
    const requestedPageSize = Math.min(args.paginationOpts.numItems, MAX_INGEST_DIAGNOSTICS_PAGE_SIZE);
    const normalizedSourceKeys = normalizeDiagnosticsSourceFilterValues(args.sourceKeys);
    if (!normalizedSourceKeys || normalizedSourceKeys.length === 0) {
        const page = await buildDiagnosticsBaseQuery(ctx, args.archived).paginate({
            ...args.paginationOpts,
            numItems: requestedPageSize,
        });

        return {
            page: page.page.map(projectIngestDiagnosticsRow),
            continueCursor: page.continueCursor,
            isDone: page.isDone,
        };
    }

    // Convex allows only a single .paginate() per query invocation.
    // Do one oversized page, filter in-memory, and let the API caller
    // continue with the returned cursor for more results.
    const sourceKeySet = new Set(normalizedSourceKeys);
    const scanBatchSize = Math.min(
        requestedPageSize * DIAGNOSTICS_SOURCE_FILTER_BATCH_MULTIPLIER,
        MAX_INGEST_DIAGNOSTICS_PAGE_SIZE * DIAGNOSTICS_SOURCE_FILTER_BATCH_MULTIPLIER,
    );

    const page = await buildDiagnosticsBaseQuery(ctx, args.archived).paginate({
        cursor: args.paginationOpts.cursor,
        numItems: scanBatchSize,
    });

    const matched = page.page
        .filter((resume) => matchesDiagnosticsSourceKeys(resume, sourceKeySet))
        .slice(0, requestedPageSize)
        .map(projectIngestDiagnosticsRow);

    return {
        page: matched,
        continueCursor: page.continueCursor,
        isDone: page.isDone,
    };
}

export const listIngestDiagnostics = query({
    args: {
        paginationOpts: paginationOptsValidator,
        sourceKeys: v.optional(v.array(v.string())),
    },
    handler: async (ctx, args) => {
        return runDiagnosticsPageQuery(ctx, {
            archived: false,
            paginationOpts: args.paginationOpts,
            sourceKeys: args.sourceKeys,
        });
    },
});

export const listArchivedDiagnostics = query({
    args: {
        paginationOpts: paginationOptsValidator,
        sourceKeys: v.optional(v.array(v.string())),
    },
    handler: async (ctx, args) => {
        return runDiagnosticsPageQuery(ctx, {
            archived: true,
            paginationOpts: args.paginationOpts,
            sourceKeys: args.sourceKeys,
        });
    },
});

export const listDiagnosticsSourceFacets = action({
    args: {
        archived: v.optional(v.boolean()),
    },
    handler: async (ctx, args) => {
        const archived = args.archived === true;

        async function countForKey(sourceKey: string): Promise<[string, number]> {
            let cursor: string | null = null;
            let count = 0;
            let isDone = false;
            while (!isDone) {
                const result: { count: number; cursor: string | null; isDone: boolean } = await ctx.runQuery(
                    internal.resumes.countSourceKeyPage,
                    { sourceKey, archived, cursor: cursor ?? undefined },
                );
                count += result.count;
                cursor = result.cursor;
                isDone = result.isDone;
            }
            return [sourceKey, count];
        }

        const entries = await Promise.all(KNOWN_DIAGNOSTICS_SOURCE_KEYS.map(countForKey));
        const counts = new Map<string, number>();
        for (const [key, count] of entries) {
            if (count > 0) {
                counts.set(key, count);
            }
        }

        return buildDiagnosticsSourceFacetRows(counts);
    },
});

export const countSourceKeyPage = internalQuery({
    args: {
        sourceKey: v.string(),
        archived: v.boolean(),
        cursor: v.optional(v.string()),
    },
    handler: async (ctx, args) => {
        const page = await ctx.db
            .query("resumes")
            .withIndex("by_sourceKey", (q) => q.eq("sourceKey", args.sourceKey))
            .paginate({ cursor: args.cursor ?? null, numItems: 50 });
        let count = 0;
        for (const r of page.page) {
            if (args.archived ? r.isArchived === true : r.isArchived !== true) {
                count += 1;
            }
        }
        return {
            count,
            cursor: page.continueCursor,
            isDone: page.isDone,
        };
    },
});

export const listWorkflowDatasetPage = query({
    args: {
        cursor: v.optional(v.string()),
        limit: v.optional(v.number()),
    },
    handler: async (ctx, args) => {
        const page = await ctx.db
            .query("resumes")
            .order("desc")
            .filter((q) => q.neq(q.field("isArchived"), true))
            .paginate({
                cursor: args.cursor ?? null,
                numItems: resolveResumeScanBatchSize(args.limit),
            });

        return {
            continueCursor: page.continueCursor,
            isDone: page.isDone,
            page: page.page.map((resume): ResumeWorkflowDatasetRow => {
                const content = isRecord(resume.content) ? resume.content : {};
                const profileType = toOptionalStringValue(content.profileType);
                return {
                    source: resume.source,
                    ...(profileType ? { content: { profileType } } : {}),
                };
            }),
        };
    },
});

export const listFieldCoverageDatasetPage = query({
    args: {
        cursor: v.optional(v.string()),
        limit: v.optional(v.number()),
    },
    handler: async (ctx, args) => {
        const page = await ctx.db
            .query("resumes")
            .order("desc")
            .filter((q) => q.neq(q.field("isArchived"), true))
            .paginate({
                cursor: args.cursor ?? null,
                numItems: resolveResumeScanBatchSize(args.limit),
            });

        return {
            continueCursor: page.continueCursor,
            isDone: page.isDone,
            page: page.page.map((resume): ResumeFieldCoverageDatasetRow => {
                const content = isRecord(resume.content) ? resume.content : {};
                const profileType = toOptionalStringValue(content.profileType);
                const workHistory = readRecordArray(content.workHistory);
                return {
                    source: resume.source,
                    ...(profileType ? { profileType } : {}),
                    profileUrl: hasResumeFieldValue(content, ["profileUrl", "profile_url", "profileURL", "url"]),
                    resumeId: hasResumeFieldValue(content, ["resumeId"]),
                    workHistoryCount: workHistory.length,
                    workHistoryHasDescription: hasWorkHistoryDescriptionEntries(workHistory),
                    profileEducation: hasNonEmptyArray(content.profileEducation),
                    jobIntention: hasResumeFieldValue(content, ["jobIntention"]),
                    expectedSalary: hasResumeFieldValue(content, ["expectedSalary"]),
                    selfIntro: hasResumeFieldValue(content, ["selfIntro"]),
                    skills: hasNonEmptyArray(content.skills),
                };
            }),
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
            .filter((q) => q.neq(q.field("isArchived"), true))
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
            .filter((q) => q.neq(q.field("isArchived"), true))
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
        const { limit, overfetchLimit } = resolveListWithIngestWindow(args.limit);
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
        const fetchLimit = overfetchLimit;
        const searchQuery = buildTagExpansionSearchQuery(keywordGroups, mode);

        const matches = searchQuery
            ? await ctx.db
                .query("resumes")
                .withSearchIndex("search_body", (q) => q.search("searchText", searchQuery))
                .filter((q) => q.neq(q.field("isArchived"), true))
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
            results: mergeResumeDocs(filteredDocs, provenanceByResumeId, jobDescriptionId, limit)
                .map((entry) => ({
                    resume: projectResumeListDoc(entry.resume),
                    provenance: entry.provenance,
                })),
        };
    },
});

export const searchWithTagExpansionPage = query({
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
        offset: v.optional(v.number()),
        jobDescriptionId: v.optional(v.string()),
        sortBy: v.optional(v.union(v.literal("name"), v.literal("experience"), v.literal("extractedAt"))),
        sortOrder: v.optional(v.union(v.literal("asc"), v.literal("desc"))),
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
    },
    handler: async (ctx, args) => {
        const result = await runSearchWithTagExpansionPageQuery(ctx, args);
        return {
            expansion: result.expansion,
            total: result.total,
            results: result.results.map((entry) => ({
                resume: projectResumeListDoc(entry.resume),
                provenance: entry.provenance,
            })),
        };
    },
});

export const searchWithTagExpansionPaginated = query({
    args: {
        paginationOpts: paginationOptsValidator,
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
        jobDescriptionId: v.optional(v.string()),
        sortBy: v.optional(v.union(v.literal("name"), v.literal("experience"), v.literal("extractedAt"))),
        sortOrder: v.optional(v.union(v.literal("asc"), v.literal("desc"))),
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
        sources: v.optional(v.array(v.string())),
    },
    handler: async (ctx, args) => {
        if (!args.jobDescriptionId?.trim() && !args.sortBy) {
            const requestedPageSize = resolvePaginatedResumePageLimit(args.paginationOpts.numItems);
            const page = await runSearchWithTagExpansionScanPageQuery(ctx, {
                ...args,
                paginationOpts: {
                    ...args.paginationOpts,
                    numItems: requestedPageSize,
                },
            });

            return {
                page: page.page,
                continueCursor: page.continueCursor,
                isDone: page.isDone,
            };
        }

        const offset = resolvePaginatedResumeOffsetCursor(args.paginationOpts.cursor);
        const limit = resolvePaginatedResumePageLimit(args.paginationOpts.numItems);
        const page = await runSearchWithTagExpansionPageQuery(ctx, {
            ...args,
            limit,
            offset,
        });

        return buildPaginatedOffsetResult(page.results.map((entry) => ({
            resume: projectResumeListDoc(entry.resume),
            provenance: entry.provenance,
        })), page.total, offset);
    },
});

export const searchWithTagExpansionScanPage = query({
    args: {
        paginationOpts: paginationOptsValidator,
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
        sources: v.optional(v.array(v.string())),
    },
    handler: async (ctx, args) => {
        const page = await runSearchWithTagExpansionScanPageQuery(ctx, args);
        return {
            expansion: page.expansion,
            page: page.page,
            continueCursor: page.continueCursor,
            isDone: page.isDone,
        };
    },
});

export const getResume = internalQuery({
    args: { resumeId: v.id("resumes") },
    handler: async (ctx, args) => {
        return await ctx.db.get(args.resumeId);
    },
});

export const getResumeDetail = query({
    args: { resumeId: v.id("resumes") },
    handler: async (ctx, args) => {
        const resume = await ctx.db.get(args.resumeId);
        if (!resume) {
            return null;
        }

        return projectResumeDetailDoc(resume);
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
                        externalId: doc.externalId,
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
                            brandHits: doc.ingestData.brandHits,
                            companyHits: doc.ingestData.companyHits,
                            industryDbV2Raw: doc.ingestData.industryDbV2Raw,
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

// ─── AND-mode full-table-scan search ─────────────────────────────────
//
// Convex search indexes return at most 1024 results per query, ordered
// by BM25 relevance.  Resumes with long searchText (6KB+ from detailed
// AI analysis / synonym lists) score low for any single term and are
// ranked beyond the 1024-position cutoff, making them invisible to the
// search index even though their searchText contains the term.
//
// Full-table-scan approach:
//   1. Paginate ALL resumes (by _creationTime) in small batches via
//      scanResumePageByTime.  Each batch is ~50 docs ≈ 650 KB,
//      well under the 16 MiB per-query limit.
//   2. For each batch, check searchText for AND-mode keyword matches
//      (matchesTagExpansionSearchText) and resume list filters.
//      Non-matches are discarded immediately.
//   3. Collect matching docs and return the full result set.

// Lightweight scan page for AND-mode BFF full-table-scan.
// Returns only fields needed for BFF-side filtering (not full docs)
// to minimize wire transfer — most scanned docs are discarded.
// Two-phase approach: phase 1 scans with slim projection (no content)
// to find matching IDs; phase 2 fetches full docs for matches only.
export const scanResumePageByTime = query({
    args: {
        cursor: v.optional(v.string()),
        numItems: v.optional(v.number()),
    },
    handler: async (ctx, args) => {
        const numItems = Math.min(args.numItems ?? 50, 50);
        const page = await ctx.db
            .query("resumes")
            .order("desc")
            .paginate({
                cursor: args.cursor ?? null,
                numItems,
            });
        return {
            docs: page.page.map((doc) => ({
                _id: doc._id,
                _creationTime: doc._creationTime,
                searchText: doc.searchText,
                isArchived: doc.isArchived,
                source: doc.source,
                primaryRuleScore: doc.primaryRuleScore,
                age: doc.age,
                content: doc.content,
                ingestData: doc.ingestData,
            })),
            isDone: page.isDone,
            cursor: page.isDone ? null : page.continueCursor,
        };
    },
});

// Slim scan page for AND-mode phase 1 — no content/ingestData.
// BFF uses this for the initial filter pass, then fetches full
// docs for matches via scanResumePageByTime or getResumeByIds.
export const scanResumePageSlim = query({
    args: {
        cursor: v.optional(v.string()),
        numItems: v.optional(v.number()),
    },
    handler: async (ctx, args) => {
        const numItems = Math.min(args.numItems ?? 1000, 1000);
        const page = await ctx.db
            .query("resumes")
            .order("desc")
            .paginate({
                cursor: args.cursor ?? null,
                numItems,
            });
        return {
            docs: page.page.map((doc) => ({
                _id: doc._id,
                searchText: doc.searchText,
                isArchived: doc.isArchived,
                source: doc.source,
                primaryRuleScore: doc.primaryRuleScore,
                age: doc.age,
            })),
            isDone: page.isDone,
            cursor: page.isDone ? null : page.continueCursor,
        };
    },
});

// Fetch full docs by ID for AND-mode phase 2 — only the matches.
export const getResumeDocsByIds = query({
    args: {
        ids: v.array(v.id("resumes")),
    },
    handler: async (ctx, args) => {
        const docs = await Promise.all(args.ids.map((id) => ctx.db.get(id)));
        return docs.filter((doc): doc is Doc<"resumes"> => doc !== null).map((doc) => ({
            _id: doc._id,
            _creationTime: doc._creationTime,
            searchText: doc.searchText,
            isArchived: doc.isArchived,
            source: doc.source,
            primaryRuleScore: doc.primaryRuleScore,
            age: doc.age,
            content: doc.content,
            ingestData: doc.ingestData,
            analysis: doc.analysis,
            analyses: doc.analyses,
            identityKey: doc.identityKey,
            externalId: doc.externalId,
            tags: doc.tags,
            crawledAt: doc.crawledAt,
        }));
    },
});

export const collectSearchIndexDocIds = internalQuery({
    args: {
        searchQuery: v.string(),
        cursor: v.optional(v.string()),
        numItems: v.optional(v.number()),
    },
    handler: async (ctx, args) => {
        const page = await ctx.db
            .query("resumes")
            .withSearchIndex("search_body", (q) => q.search("searchText", args.searchQuery))
            .filter((q) => q.neq(q.field("isArchived"), true))
            .paginate({
                cursor: args.cursor ?? null,
                numItems: Math.min(args.numItems ?? 256, 256),
            });
        return {
            ids: page.page.map((doc) => String(doc._id)),
            isDone: page.isDone,
            cursor: page.isDone ? null : page.continueCursor,
        };
    },
});

export const searchWithTagExpansionAndMode = action({
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
    },
    handler: async (ctx, args) => {
        const keywordGroups = normalizeTagExpansionKeywordGroups(args.keywordGroups);
        const expandedTerms = collectExpandedTerms(keywordGroups);

        if (expandedTerms.length === 0 || keywordGroups.length === 0) {
            return {
                expansion: {
                    original: args.query,
                    expanded: [],
                    groups: [],
                    mode: "AND" as const,
                },
                total: 0,
                results: [],
            };
        }

        const sourceMapping = Object.fromEntries(
            (args.sourceMappings ?? []).map((entry) => [entry.term, entry.expandedFrom])
        );

        // Anchor-scan approach: Collect doc IDs matching the anchor group
        // (fewest variants) from the search index, then batch-fetch and
        // filter for all groups + resume list filters in-memory.
        //
        // NOTE: The Convex search index scans at most 1024 results per query
        // (BM25-ranked).  Resumes with long searchText that score low for
        // the anchor terms may be missed.  The BFF AND-mode path handles
        // the full-table-scan case for complete results.
        const anchorGroup = selectTagExpansionAnchorGroup(keywordGroups);
        const anchorSearchQuery = anchorGroup.variants.join(" ");
        const anchorIds: string[] = [];
        let cursor: string | undefined;

        while (true) {
            const page = await ctx.runQuery(internal.resumes.collectSearchIndexDocIds, {
                searchQuery: anchorSearchQuery,
                ...(cursor ? { cursor } : {}),
                numItems: 256,
            });
            for (const id of page.ids) {
                anchorIds.push(id);
            }
            if (page.isDone || !page.cursor) {
                break;
            }
            cursor = page.cursor;
        }

        if (anchorIds.length === 0) {
            return {
                expansion: {
                    original: args.query,
                    expanded: expandedTerms,
                    groups: keywordGroups,
                    mode: "AND" as const,
                },
                total: 0,
                results: [],
            };
        }

        // Batch-fetch full docs and filter in-memory.
        const BATCH_FETCH_SIZE = 16;
        const filters = normalizeResumeListFilters(args);
        const provenanceByResumeId = new Map<string, SearchProvenance[]>();
        const jobDescriptionId = args.jobDescriptionId?.trim() || undefined;
        const matchedDocs: Doc<"resumes">[] = [];

        for (let i = 0; i < anchorIds.length; i += BATCH_FETCH_SIZE) {
            const batchIds = anchorIds.slice(i, i + BATCH_FETCH_SIZE)
                .map((id) => id as unknown as Id<"resumes">);
            const docs = await ctx.runQuery(internal.resumes.getResumesByIds, {
                resumeIds: batchIds,
            });

            for (const doc of docs) {
                const provenance = resolveSearchWithTagExpansionMatch(
                    doc,
                    keywordGroups,
                    "AND",
                    sourceMapping,
                );
                if (!provenance) {
                    continue;
                }
                if (!matchesResumeListFilters(doc, filters)) {
                    continue;
                }
                provenanceByResumeId.set(String(doc._id), provenance);
                matchedDocs.push(doc);
            }
        }

        const merged = mergeResumeDocs(matchedDocs, provenanceByResumeId, jobDescriptionId, matchedDocs.length);

        // Sort
        let sorted = merged;
        if (args.sortBy) {
            sorted = [...merged].sort((left, right) => compareResumeListSort(
                left.resume,
                right.resume,
                args.sortBy!,
                resolveResumeListSortOrder(args.sortOrder),
            ));
        }

        return {
            expansion: {
                original: args.query,
                expanded: expandedTerms,
                groups: keywordGroups,
                mode: "AND" as const,
            },
            total: sorted.length,
            results: sorted.map((entry) => ({
                resume: projectResumeListDoc(entry.resume),
                provenance: entry.provenance,
            })),
        };
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
            promptVersion: v.optional(v.number()),
            locale: v.optional(v.string()),
            queryLocation: v.optional(v.string()),
            analyzedAt: v.optional(v.number()),
        }),
    },
    handler: async (ctx, args) => {
        const resume = await ctx.db.get(args.resumeId);
        if (!resume) throw new Error("Resume not found");

        const analyses = resume.analyses || {};
        const analysisKey = buildResumeAnalysisStorageKey(args.analysis.jobDescriptionId, {
            sourceKey: resolveResumeAnalysisSourceKey({ source: resume.source }),
            locale: args.analysis.locale,
        });

        analyses[analysisKey] = args.analysis;

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
                promptVersion: v.optional(v.number()),
                locale: v.optional(v.string()),
                queryLocation: v.optional(v.string()),
                analyzedAt: v.optional(v.number()),
            }),
        })),
    },
    handler: async (ctx, args) => {
        await Promise.all(args.updates.map(async (update) => {
            const resume = await ctx.db.get(update.resumeId);
            if (!resume) return;

            const analyses = resume.analyses || {};
            const analysisKey = buildResumeAnalysisStorageKey(update.analysis.jobDescriptionId, {
                sourceKey: resolveResumeAnalysisSourceKey({ source: resume.source }),
                locale: update.analysis.locale,
            });
            analyses[analysisKey] = update.analysis;

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
                    directRoleMatch: v.optional(v.boolean()),
                }))),
                verifyIn: v.string(),
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
            verifiedRoleYears: v.optional(v.record(v.string(), v.number())),
        }),
        companyPatternAliasTokens: v.optional(v.string()),
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
            brandHits: args.ingestData.brandHits,
            companyHits: args.ingestData.companyHits,
            companyPatternAliasTokens: args.companyPatternAliasTokens?.trim().toLowerCase(),
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
                        directRoleMatch: v.optional(v.boolean()),
                    }))),
                    verifyIn: v.string(),
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
                verifiedRoleYears: v.optional(v.record(v.string(), v.number())),
            }),
            companyPatternAliasTokens: v.optional(v.string()),
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
                brandHits: update.ingestData.brandHits,
                companyHits: update.ingestData.companyHits,
                companyPatternAliasTokens: update.companyPatternAliasTokens?.trim().toLowerCase(),
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

export const listResumeUsageBatch = internalQuery({
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
            page: page.page.map((resume): ResumeUsageScanRow => ({
                analysis: resume.analysis,
                analyses: resume.analyses,
            })),
        };
    },
});

export const clearAnalyses = mutation({
    args: {
        resumeIds: v.optional(v.array(v.id("resumes"))),
        jobDescriptionId: v.optional(v.string()),
        cursor: v.optional(v.string()),
        batchSize: v.optional(v.number()),
    },
    handler: async (ctx, args) => {
        const page = args.resumeIds
            ? undefined
            : await ctx.db
                .query("resumes")
                .order("desc")
                .paginate({
                    cursor: args.cursor ?? null,
                    numItems: resolveResumeScanBatchSize(args.batchSize),
                });
        const resumes = args.resumeIds
            ? await Promise.all(args.resumeIds.map((id) => ctx.db.get(id)))
            : page?.page ?? [];

        let cleared = 0;
        for (const resume of resumes) {
            if (!resume) continue;
            if (!resume.analysis && !resume.analyses) continue;

            if (args.jobDescriptionId && resume.analyses) {
                const analyses = { ...resume.analyses };
                const matchingKeys = Object.keys(analyses).filter((key) =>
                    isResumeAnalysisKeyForJobDescription(key, args.jobDescriptionId)
                );
                if (matchingKeys.length > 0) {
                    for (const key of matchingKeys) {
                        delete analyses[key];
                    }
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

        if (args.resumeIds) {
            return { cleared, hasMore: false, cursor: null };
        }

        return {
            cleared,
            hasMore: page ? !page.isDone : false,
            cursor: page && !page.isDone ? page.continueCursor : null,
        };
    },
});

export const deleteResumes = mutation({
    args: {
        resumeIds: v.array(v.string()),
    },
    returns: v.object({
        requested: v.number(),
        deleted: v.number(),
        missingResumeIds: v.array(v.string()),
        deletedAiTaggingResults: v.number(),
        patchedScreeningSessions: v.number(),
    }),
    handler: async (ctx, args): Promise<DeleteResumesResult> => {
        const requestedResumeIds = normalizeRequestedResumeIds(args.resumeIds);
        if (requestedResumeIds.length === 0) {
            return {
                requested: 0,
                deleted: 0,
                missingResumeIds: [],
                deletedAiTaggingResults: 0,
                patchedScreeningSessions: 0,
            };
        }

        const resolvedEntries = requestedResumeIds.map((resumeId) => ({
            requestedResumeId: resumeId,
            normalizedResumeId: ctx.db.normalizeId("resumes", resumeId),
        }));
        const missingResumeIds = resolvedEntries
            .filter((entry) => entry.normalizedResumeId === null)
            .map((entry) => entry.requestedResumeId);
        const normalizedResumeIds = resolvedEntries
            .flatMap((entry) => (entry.normalizedResumeId ? [entry.normalizedResumeId] : []));

        if (normalizedResumeIds.length === 0) {
            return {
                requested: requestedResumeIds.length,
                deleted: 0,
                missingResumeIds,
                deletedAiTaggingResults: 0,
                patchedScreeningSessions: 0,
            };
        }

        const resumes = await Promise.all(normalizedResumeIds.map((resumeId) => ctx.db.get(resumeId)));
        const existingResumes = resumes.filter((resume): resume is NonNullable<typeof resume> => resume !== null);
        const existingResumeIds = existingResumes.map((resume) => resume._id);
        const existingResumeIdStrings = new Set(existingResumeIds.map((resumeId) => String(resumeId)));
        const missingExistingResumeIds = resolvedEntries
            .filter((entry) => entry.normalizedResumeId !== null && !existingResumeIdStrings.has(String(entry.normalizedResumeId)))
            .map((entry) => entry.requestedResumeId);

        if (existingResumes.length === 0) {
            return {
                requested: requestedResumeIds.length,
                deleted: 0,
                missingResumeIds: [...missingResumeIds, ...missingExistingResumeIds],
                deletedAiTaggingResults: 0,
                patchedScreeningSessions: 0,
            };
        }

        let deletedAiTaggingResults = 0;
        for (const resumeId of existingResumeIds) {
            const taggingResults = await ctx.db
                .query("ai_tagging_results")
                .withIndex("by_resume_profile", (q) => q.eq("resumeId", resumeId))
                .collect();

            for (const taggingResult of taggingResults) {
                await ctx.db.delete(taggingResult._id);
                deletedAiTaggingResults += 1;
            }
        }

        const deletedResumeIdStrings = new Set(existingResumeIds.map((resumeId) => String(resumeId)));
        const screeningSessions = await ctx.db.query("screening_sessions").collect();
        let patchedScreeningSessions = 0;
        for (const session of screeningSessions) {
            const reviewedResumeIds = session.reviewedResumeIds.filter((resumeId) => !deletedResumeIdStrings.has(resumeId));
            if (reviewedResumeIds.length === session.reviewedResumeIds.length) {
                continue;
            }

            await ctx.db.patch(session._id, { reviewedResumeIds });
            patchedScreeningSessions += 1;
        }

        for (const resume of existingResumes) {
            await ctx.db.delete(resume._id);
        }

        return {
            requested: requestedResumeIds.length,
            deleted: existingResumes.length,
            missingResumeIds: [...missingResumeIds, ...missingExistingResumeIds],
            deletedAiTaggingResults,
            patchedScreeningSessions,
        };
    },
});

export const archiveResumes = mutation({
    args: {
        resumeIds: v.array(v.string()),
    },
    returns: v.object({
        requested: v.number(),
        archived: v.number(),
        alreadyArchived: v.number(),
        missingResumeIds: v.array(v.string()),
    }),
    handler: async (ctx, args) => {
        const requestedResumeIds = normalizeRequestedResumeIds(args.resumeIds);
        if (requestedResumeIds.length === 0) {
            return { requested: 0, archived: 0, alreadyArchived: 0, missingResumeIds: [] };
        }

        const resolvedEntries = requestedResumeIds.map((resumeId) => ({
            requestedResumeId: resumeId,
            normalizedResumeId: ctx.db.normalizeId("resumes", resumeId),
        }));
        const missingResumeIds = resolvedEntries
            .filter((entry) => entry.normalizedResumeId === null)
            .map((entry) => entry.requestedResumeId);
        const normalizedResumeIds = resolvedEntries
            .flatMap((entry) => (entry.normalizedResumeId ? [entry.normalizedResumeId] : []));

        if (normalizedResumeIds.length === 0) {
            return { requested: requestedResumeIds.length, archived: 0, alreadyArchived: 0, missingResumeIds };
        }

        const resumes = await Promise.all(normalizedResumeIds.map((resumeId) => ctx.db.get(resumeId)));
        const existingResumes = resumes.filter((resume): resume is NonNullable<typeof resume> => resume !== null);
        const existingResumeIdStrings = new Set(existingResumes.map((resume) => String(resume._id)));
        const missingExistingResumeIds = resolvedEntries
            .filter((entry) => entry.normalizedResumeId !== null && !existingResumeIdStrings.has(String(entry.normalizedResumeId)))
            .map((entry) => entry.requestedResumeId);

        let archived = 0;
        let alreadyArchived = 0;
        const now = Date.now();
        await Promise.all(existingResumes.map(async (resume) => {
            if (resume.isArchived === true) {
                alreadyArchived += 1;
                return;
            }
            await ctx.db.patch(resume._id, { isArchived: true, archivedAt: now });
            archived += 1;
        }));

        return {
            requested: requestedResumeIds.length,
            archived,
            alreadyArchived,
            missingResumeIds: [...missingResumeIds, ...missingExistingResumeIds],
        };
    },
});

export const unarchiveResumes = mutation({
    args: {
        resumeIds: v.array(v.string()),
    },
    returns: v.object({
        requested: v.number(),
        unarchived: v.number(),
        notArchived: v.number(),
        missingResumeIds: v.array(v.string()),
    }),
    handler: async (ctx, args) => {
        const requestedResumeIds = normalizeRequestedResumeIds(args.resumeIds);
        if (requestedResumeIds.length === 0) {
            return { requested: 0, unarchived: 0, notArchived: 0, missingResumeIds: [] };
        }

        const resolvedEntries = requestedResumeIds.map((resumeId) => ({
            requestedResumeId: resumeId,
            normalizedResumeId: ctx.db.normalizeId("resumes", resumeId),
        }));
        const missingResumeIds = resolvedEntries
            .filter((entry) => entry.normalizedResumeId === null)
            .map((entry) => entry.requestedResumeId);
        const normalizedResumeIds = resolvedEntries
            .flatMap((entry) => (entry.normalizedResumeId ? [entry.normalizedResumeId] : []));

        if (normalizedResumeIds.length === 0) {
            return { requested: requestedResumeIds.length, unarchived: 0, notArchived: 0, missingResumeIds };
        }

        const resumes = await Promise.all(normalizedResumeIds.map((resumeId) => ctx.db.get(resumeId)));
        const existingResumes = resumes.filter((resume): resume is NonNullable<typeof resume> => resume !== null);
        const existingResumeIdStrings = new Set(existingResumes.map((resume) => String(resume._id)));
        const missingExistingResumeIds = resolvedEntries
            .filter((entry) => entry.normalizedResumeId !== null && !existingResumeIdStrings.has(String(entry.normalizedResumeId)))
            .map((entry) => entry.requestedResumeId);

        let unarchived = 0;
        let notArchived = 0;
        await Promise.all(existingResumes.map(async (resume) => {
            if (resume.isArchived !== true) {
                notArchived += 1;
                return;
            }
            await ctx.db.patch(resume._id, { isArchived: undefined, archivedAt: undefined });
            unarchived += 1;
        }));

        return {
            requested: requestedResumeIds.length,
            unarchived,
            notArchived,
            missingResumeIds: [...missingResumeIds, ...missingExistingResumeIds],
        };
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
