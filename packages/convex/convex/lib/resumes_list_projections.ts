/**
 * Resume list projection and filter/sort helpers extracted from resumes.ts.
 *
 * Pure functions for projecting resume doc fields for list/detail views,
 * normalizing filter arguments, matching filter criteria, and sorting.
 */
import type { Doc } from "../_generated/dataModel";
import type { QueryCtx } from "../_generated/server";
import {
    isRecord,
    normalizeResumeLocationHierarchy,
    computeExperienceFromWorkHistory,
    selectLatestWorkHistory,
    normalizeKeywordPhrases,
    formatLocationHierarchySearchText,
    buildWorkHistoryEntryText,
    resolveExperienceYears,
    normalizeEducationLevel,
    isLocationMatch,
    parseRawSalaryRange,
    resolveResumeAnalysisSourceKey,
    resolveGateRoleYears,
} from "@trends/shared";
import {
    toStringValue,
    toOptionalStringValue,
    toRuleScores,
    resolveRuleScoreLookupKeys,
} from "../resume_helpers.js";
import { parseAgeFromContent } from "./age";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type ResumeListProjectedDoc = {
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
    confirmedScore?: number;
    confirmedAt?: number;
    primaryRuleScore?: number;
    isArchived?: boolean;
    archivedAt?: number;
    ingestData?: {
        industryTags: string[];
        synonymHits: string[];
        evidenceText?: string;
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
        market?: string;
        computedAt: number;
        skillsVersion: number;
        ingestComputeEpoch?: number;
    };
};

export type ResumeListFilterArgs = {
    minRoleYears?: number;
    roleFilterType?: string;
    minAge?: number;
    maxAge?: number;
    education?: string[];
    skills?: string[];
    requiredKeywords?: string[];
    keywords?: string[];
    locations?: string[];
    minSalary?: number;
    maxSalary?: number;
    showArchived?: boolean;
    sources?: string[];
};

export type ResumeListSortBy = "name" | "experience" | "extractedAt";
export type ResumeListSortOrder = "asc" | "desc";

export type ResumeListPageArgs = ResumeListFilterArgs & {
    limit?: number;
    offset?: number;
    jobDescriptionId?: string;
    sortBy?: ResumeListSortBy;
    sortOrder?: ResumeListSortOrder;
};

export type SearchWithTagExpansionPageArgs = ResumeListPageArgs & {
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

export type SearchWithTagExpansionScanPageArgs = ResumeListFilterArgs & {
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

export type DeleteResumesResult = {
    requested: number;
    deleted: number;
    missingResumeIds: string[];
    deletedAiTaggingResults: number;
    patchedScreeningSessions: number;
};

// ---------------------------------------------------------------------------
// Content projection
// ---------------------------------------------------------------------------

export function projectResumeBaseContent(
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
    const experience = toOptionalStringValue(content.experience)
        ?? (() => {
            const years = computeExperienceFromWorkHistory(content.workHistory);
            return years !== null ? `${years} years` : undefined;
        })();
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

export function projectResumeListWorkHistory(workHistory: unknown): Array<Record<string, string>> {
    // Latest-N only. Keep description + raw so expanded Seek/MY cards can show
    // career-history detail (China cards already relied on richer raw/description).
    return selectLatestWorkHistory(workHistory).map((entry) => {
        const projected: Record<string, string> = {
            ...(entry.companyName ? { companyName: entry.companyName } : {}),
            ...(entry.jobTitle ? { jobTitle: entry.jobTitle } : {}),
            ...(entry.startDate ? { startDate: entry.startDate } : {}),
            ...(entry.endDate ? { endDate: entry.endDate } : {}),
            ...(entry.description
                ? { description: entry.description.slice(0, 2000) }
                : {}),
            ...(entry.raw ? { raw: entry.raw.slice(0, 400) } : {}),
        };

        return projected;
    }).filter((entry) => Object.keys(entry).length > 0);
}

export function projectResumeListContent(resume: Doc<"resumes">): Record<string, unknown> {
    const content = isRecord(resume.content) ? resume.content : {};
    return projectResumeBaseContent(resume, projectResumeListWorkHistory(content.workHistory));
}

export function projectResumeDetailContent(resume: Doc<"resumes">): Record<string, unknown> {
    const content = isRecord(resume.content) ? resume.content : {};
    const workHistory = selectLatestWorkHistory(content.workHistory);
    return projectResumeBaseContent(resume, workHistory);
}

export function projectResumeListIngestData(
    ingestData: Doc<"resumes">["ingestData"],
): ResumeListProjectedDoc["ingestData"] {
    if (!ingestData) {
        return undefined;
    }

    return {
        industryTags: ingestData.industryTags,
        synonymHits: ingestData.synonymHits,
        ...(ingestData.evidenceText === undefined ? {} : { evidenceText: ingestData.evidenceText }),
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
        ...(ingestData.market === undefined ? {} : { market: ingestData.market }),
        computedAt: ingestData.computedAt,
        skillsVersion: ingestData.skillsVersion,
        ...(typeof ingestData.ingestComputeEpoch === "number"
            ? { ingestComputeEpoch: ingestData.ingestComputeEpoch }
            : {}),
    };
}

export function projectResumeListDoc(resume: Doc<"resumes">): ResumeListProjectedDoc {
    return {
        _id: resume._id,
        externalId: resume.externalId,
        ...(resume.identityKey ? { identityKey: resume.identityKey } : {}),
        ...(resume.age === undefined ? {} : { age: resume.age }),
        content: projectResumeListContent(resume),
        crawledAt: resume.crawledAt,
        source: resume.source,
        tags: resume.tags,
        // Phase 3: analysis/analyses/confirmedScore stripped from list projection.
        // Score display fields now come from resume_digests (displayScore etc.).
        // Detail/expanded view fetches full analysis from resume_analyses on demand.
        ...(resume.primaryRuleScore === undefined ? {} : { primaryRuleScore: resume.primaryRuleScore }),
        ...(resume.isArchived === true ? { isArchived: true, archivedAt: resume.archivedAt } : {}),
        ...(resume.ingestData ? { ingestData: projectResumeListIngestData(resume.ingestData) } : {}),
    };
}

export async function projectResumeDetailDoc(
    ctx: QueryCtx,
    resume: Doc<"resumes">,
): Promise<ResumeListProjectedDoc> {
    const base = {
        _id: resume._id,
        externalId: resume.externalId,
        ...(resume.identityKey ? { identityKey: resume.identityKey } : {}),
        ...(resume.age === undefined ? {} : { age: resume.age }),
        content: projectResumeDetailContent(resume),
        crawledAt: resume.crawledAt,
        source: resume.source,
        tags: resume.tags,
        ...(resume.confirmedScore === undefined ? {} : { confirmedScore: resume.confirmedScore }),
        ...(resume.confirmedAt === undefined ? {} : { confirmedAt: resume.confirmedAt }),
        ...(resume.primaryRuleScore === undefined ? {} : { primaryRuleScore: resume.primaryRuleScore }),
        ...(resume.isArchived === true ? { isArchived: true, archivedAt: resume.archivedAt } : {}),
        ...(resume.ingestData ? { ingestData: projectResumeListIngestData(resume.ingestData) } : {}),
    };

    // Phase 3 completion: fetch analysis/analyses from the cold resume_analyses
    // table via by_resume index. Only active rows are visible to the detail
    // view — archived rows (flipped by clearAnalyses) are invisible but
    // retained for audit/undo.
    const coldRow = await ctx.db
        .query("resume_analyses")
        .withIndex("by_resume", (q) => q.eq("resumeId", resume._id))
        .unique();

    if (!coldRow || coldRow.status === "archived") {
        return base;
    }

    return {
        ...base,
        ...(coldRow.analysis ? { analysis: coldRow.analysis } : {}),
        ...(coldRow.analyses ? { analyses: coldRow.analyses } : {}),
    };
}

// ---------------------------------------------------------------------------
// Filter normalization
// ---------------------------------------------------------------------------

export function normalizeResumeListFilters(filters: ResumeListFilterArgs | undefined): ResumeListFilterArgs | undefined {
    if (!filters) {
        return undefined;
    }

    const education = filters.education?.map((value) => value.trim().toLowerCase()).filter((value) => value.length > 0);
    const skills = filters.skills?.map((value) => value.trim().toLowerCase()).filter((value) => value.length > 0);
    const requiredKeywords = normalizeKeywordPhrases(filters.requiredKeywords ?? [])
        .map((value) => value.toLowerCase())
        .filter((value) => value.length > 0);
    const locations = filters.locations?.map((value) => value.trim()).filter((value) => value.length > 0);
    const keywords = filters.keywords?.map((k) => k.trim()).filter(Boolean);
    const sources = filters.sources?.map((value) => value.trim().toLowerCase()).filter((value) => value.length > 0);
    const roleFilterType = toOptionalStringValue(filters.roleFilterType)?.trim().toLowerCase();
    const minAge = typeof filters.minAge === "number" && Number.isFinite(filters.minAge) && filters.minAge > 0
        ? Math.trunc(filters.minAge)
        : undefined;
    const maxAge = typeof filters.maxAge === "number" && Number.isFinite(filters.maxAge) && filters.maxAge > 0
        ? Math.trunc(filters.maxAge)
        : undefined;

    const normalized: ResumeListFilterArgs = {
        ...((filters.minRoleYears ?? 0) > 0 ? { minRoleYears: filters.minRoleYears } : {}),
        ...(roleFilterType ? { roleFilterType } : {}),
        ...(minAge === undefined ? {} : { minAge }),
        ...(maxAge === undefined ? {} : { maxAge }),
        ...(education && education.length > 0 ? { education } : {}),
        ...(skills && skills.length > 0 ? { skills } : {}),
        ...(requiredKeywords.length > 0 ? { requiredKeywords } : {}),
        ...(keywords && keywords.length > 0 ? { keywords } : {}),
        ...(locations && locations.length > 0 ? { locations } : {}),
        ...(filters.minSalary === undefined ? {} : { minSalary: filters.minSalary }),
        ...(filters.maxSalary === undefined ? {} : { maxSalary: filters.maxSalary }),
        ...(filters.showArchived ? { showArchived: true } : {}),
        ...(sources && sources.length > 0 ? { sources } : {}),
    };

    return Object.keys(normalized).length > 0 ? normalized : undefined;
}

// ---------------------------------------------------------------------------
// Filter search text
// ---------------------------------------------------------------------------

export function buildResumeFilterSearchText(content: Record<string, unknown>, source?: string): string {
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

export function matchesAllRequiredKeywords(text: string, requiredKeywords: string[] | undefined): boolean {
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

// ---------------------------------------------------------------------------
// Role signal matching
// ---------------------------------------------------------------------------

/**
 * Resolve the verified role-years value used by the `minRoleYears` filter.
 *
 * Preference order:
 *   1. Precomputed `ingestData.verifiedRoleYears[roleType]`.
 *   2. Live compute from `roleSignals` via `getVerifiedRoleSignalYears` for
 *      rows whose stored projection is missing.
 */
export function hasMatchingRoleSignal(resume: Doc<"resumes">, roleType: string | undefined): boolean {
    const key = toOptionalStringValue(roleType)?.trim().toLowerCase() ?? "";
    if (!key) {
        return true;
    }

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

/**
 * Resolve role years for the minRoleYears search gate.
 * Delegates to shared {@link resolveGateRoleYears} using verified-only years.
 */
export function getResumeRoleYears(resume: Doc<"resumes">, roleType: string | undefined): number {
    return resolveGateRoleYears(
        resume.ingestData?.roleSignals,
        roleType,
        resume.ingestData?.verifiedRoleYears,
    );
}

// ---------------------------------------------------------------------------
// Age
// ---------------------------------------------------------------------------

export function resolveResumeAge(resume: Doc<"resumes">, content: Record<string, unknown>): number | null {
    if (typeof resume.age === "number" && Number.isFinite(resume.age) && resume.age > 0) {
        return Math.trunc(resume.age);
    }

    return parseAgeFromContent(content);
}

// ---------------------------------------------------------------------------
// Full filter matching
// ---------------------------------------------------------------------------

export function matchesResumeListFilters(resume: Doc<"resumes">, filters: ResumeListFilterArgs | undefined): boolean {
    if (!filters?.showArchived && resume.isArchived === true) {
        return false;
    }
    if (!filters) {
        return true;
    }

    const content = isRecord(resume.content) ? resume.content : {};

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
        // Use full searchText (includes name, all workHistory, industryTags, synonyms, etc.)
        // rather than narrow buildResumeFilterSearchText (only latest workHistory).
        // Aligns with BFF bffMatchesResumeFilters which uses full doc.searchText.
        const haystack = resume.searchText?.toLowerCase() ?? buildResumeFilterSearchText(content, resume.source);
        const hasSkill = filters.skills.some((skill) => haystack.includes(skill.toLowerCase()));
        if (!hasSkill) {
            return false;
        }
    }

    if (filters.requiredKeywords?.length) {
        const haystack = resume.searchText?.toLowerCase() ?? buildResumeFilterSearchText(content, resume.source);
        if (!matchesAllRequiredKeywords(haystack, filters.requiredKeywords)) {
            return false;
        }
    }

    if (filters.keywords?.length) {
        const haystack = resume.searchText?.toLowerCase() ?? buildResumeFilterSearchText(content, resume.source);
        const normalized = filters.keywords.map((k) => k.toLowerCase().trim()).filter(Boolean);
        if (normalized.length > 0 && !normalized.every((k) => haystack.includes(k))) {
            return false;
        }
    }

    if (filters.minSalary !== undefined || filters.maxSalary !== undefined) {
        const salary = parseRawSalaryRange(toStringValue(content.expectedSalary));
        if (!salary) {
            // Unknown salary — skip salary filter instead of excluding.
            // Same graceful-degradation pattern as experience filter:
            // minSalary passes through (candidate might meet it),
            // maxSalary excludes (cannot guarantee the cap).
            if (filters.maxSalary !== undefined) {
                return false;
            }
        } else {
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

// ---------------------------------------------------------------------------
// Sort
// ---------------------------------------------------------------------------

export function resolveResumeListSortOrder(sortOrder: ResumeListSortOrder | undefined): ResumeListSortOrder {
    if (sortOrder === "asc" || sortOrder === "desc") {
        return sortOrder;
    }
    return "asc";
}

export function compareResumeListSort(
    left: Doc<"resumes">,
    right: Doc<"resumes">,
    sortBy: ResumeListSortBy,
    sortOrder: ResumeListSortOrder
): number {
    const direction = sortOrder === "desc" ? -1 : 1;
    const leftContent = isRecord(left.content) ? left.content : {};
    const rightContent = isRecord(right.content) ? right.content : {};

    if (sortBy === "experience") {
        const leftExperience = resolveExperienceYears(toStringValue(leftContent.experience), leftContent.workHistory) ?? -1;
        const rightExperience = resolveExperienceYears(toStringValue(rightContent.experience), rightContent.workHistory) ?? -1;
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

export function sortResumeDocs(
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

// ---------------------------------------------------------------------------
// helpers (sort by ingest rule score — used by sortResumeDocs and exported for compareResume in resumes.ts)
// ---------------------------------------------------------------------------

export function getIngestRuleScore(resume: Doc<"resumes">, jobDescriptionId: string | undefined): number {
    const ruleScores = toRuleScores(resume.ingestData?.ruleScores);
    for (const key of resolveRuleScoreLookupKeys(jobDescriptionId)) {
        const score = ruleScores[key];
        if (typeof score === "number" && Number.isFinite(score)) {
            return score;
        }
    }
    return 0;
}

export function sortByIngestRuleScore(
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
