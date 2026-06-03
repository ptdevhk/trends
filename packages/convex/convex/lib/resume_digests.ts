import {
    computeVerifiedRoleYears,
    formatLocationHierarchySearchText,
    isRecord,
    matchesResumeDigestFilters,
    normalizeEducationLevel,
    normalizeResumeLocationHierarchy,
    parseSalaryRange,
    resolveExperienceYears,
    type AnalysisMatchedWorkEntryLike,
    type AnalysisRoleSignalLike,
} from "@trends/shared";
import type { Doc, Id } from "../_generated/dataModel";
import {
    resolveResumeAge,
} from "./resumes_list_projections";
import { appendMissingSearchTokens, buildSearchText, mergeSearchTextWithIngestData } from "../search_text";

export { matchesResumeDigestFilters };

export type ResumeDigest = {
    resumeId: Id<"resumes">;
    identityKey?: string;
    externalId?: string;
    source?: string;
    sourceKey?: string;
    searchText?: string;
    isArchived?: boolean;
    archivedAt?: number;
    primaryRuleScore?: number;
    crawledAt?: number;
    age?: number;
    locationText?: string;
    educationLevel?: string;
    salaryMin?: number;
    salaryMax?: number;
    experienceYears?: number;
    roleTypes?: string[];
    roleYearsByType?: Record<string, number>;
    updatedAt: number;
};

export function buildResumeDigest(resume: Doc<"resumes">, now: number): ResumeDigest {
    const content = isRecord(resume.content) ? resume.content : {};
    const locationHierarchy = normalizeResumeLocationHierarchy(content, resume.source);
    const salary = parseSalaryRange(typeof content.expectedSalary === "string" ? content.expectedSalary : undefined);
    const roleSignals = collectRoleSignals(resume.ingestData);
    const roleYearsByType = collectRoleYearsByType(resume, roleSignals);
    const roleTypes = collectRoleTypes(roleYearsByType, roleSignals);
    const locationText = formatLocationHierarchySearchText(locationHierarchy) || (typeof content.location === "string" ? content.location : undefined);

    return {
        resumeId: resume._id,
        identityKey: resume.identityKey,
        externalId: resume.externalId,
        source: resume.source,
        sourceKey: resume.sourceKey,
        searchText: buildDigestSearchText(content, locationHierarchy, locationText, roleTypes, resume.ingestData, resume.searchText),
        isArchived: resume.isArchived,
        archivedAt: resume.archivedAt,
        primaryRuleScore: resume.primaryRuleScore,
        crawledAt: resume.crawledAt,
        age: resolveResumeAge(resume, content) ?? undefined,
        locationText,
        educationLevel: normalizeEducationLevel(typeof content.education === "string" ? content.education : undefined) ?? undefined,
        salaryMin: salary?.min,
        salaryMax: salary?.max,
        experienceYears: resolveExperienceYears(typeof content.experience === "string" ? content.experience : undefined, content.workHistory) ?? undefined,
        roleTypes,
        roleYearsByType,
        updatedAt: now,
    };
}

const MAX_COMPACT_STRING_CHARS = 240;
const MAX_COMPACT_ARRAY_ITEMS = 24;
const MAX_COMPACT_OBJECT_KEYS = 12;
const MAX_COMPACT_WORK_HISTORY_ITEMS = 3;

function buildDigestSearchText(
    content: Record<string, unknown>,
    locationHierarchy: unknown,
    locationText: string | undefined,
    roleTypes: string[],
    ingestData: unknown,
    legacySearchText: string | undefined,
): string {
    const compactContent: Record<string, unknown> = {};
    assignFirstCompactValue(compactContent, "name", content, ["name"]);
    assignFirstCompactValue(compactContent, "desiredPosition", content, ["desiredPosition", "jobIntention", "position", "title"]);
    assignFirstCompactValue(compactContent, "education", content, ["education"]);
    assignFirstCompactValue(compactContent, "expectedSalary", content, ["expectedSalary"]);
    assignFirstCompactValue(compactContent, "skills", content, ["skills"]);
    assignFirstCompactValue(compactContent, "companies", content, ["companies", "company", "companyName"]);

    const workHistory = compactWorkHistory(content.workHistory);
    if (workHistory) {
        compactContent.workHistory = workHistory;
    }
    if (locationHierarchy) {
        compactContent.locationHierarchy = locationHierarchy;
    }

    const summary = compactSearchValue(content.summary);
    const summaryParts = [summary, locationText, ...roleTypes].filter((value): value is string => typeof value === "string" && value.length > 0);
    if (summaryParts.length > 0) {
        compactContent.summary = summaryParts.join(" ");
    }

    const baseSearchText = buildSearchText(compactContent);
    const searchText = mergeSearchTextWithIngestData(baseSearchText, collectIngestSearchTextOptions(ingestData));
    return appendMissingSearchTokens(searchText, collectLegacyDomainTokens(legacySearchText));
}

function assignFirstCompactValue(
    target: Record<string, unknown>,
    targetKey: string,
    source: Record<string, unknown>,
    sourceKeys: string[],
): void {
    for (const sourceKey of sourceKeys) {
        const value = compactSearchValue(source[sourceKey]);
        if (value !== undefined) {
            target[targetKey] = value;
            return;
        }
    }
}

function compactSearchValue(value: unknown, depth = 0): unknown {
    if (value === null || value === undefined) {
        return undefined;
    }
    if (typeof value === "string") {
        const normalized = value.replace(/\s+/g, " ").trim();
        return normalized ? normalized.slice(0, MAX_COMPACT_STRING_CHARS) : undefined;
    }
    if (typeof value === "number" && Number.isFinite(value)) {
        return value;
    }
    if (typeof value === "boolean") {
        return value;
    }
    if (Array.isArray(value)) {
        const items = value
            .slice(0, MAX_COMPACT_ARRAY_ITEMS)
            .map((item) => compactSearchValue(item, depth + 1))
            .filter((item) => item !== undefined);
        return items.length > 0 ? items : undefined;
    }
    if (isRecord(value) && depth < 2) {
        const result: Record<string, unknown> = {};
        for (const [key, entry] of Object.entries(value).slice(0, MAX_COMPACT_OBJECT_KEYS)) {
            const compact = compactSearchValue(entry, depth + 1);
            if (compact !== undefined) {
                result[key] = compact;
            }
        }
        return Object.keys(result).length > 0 ? result : undefined;
    }
    return undefined;
}

function compactWorkHistory(value: unknown): Array<Record<string, unknown>> | undefined {
    if (!Array.isArray(value)) {
        return undefined;
    }
    const rows: Array<Record<string, unknown>> = [];
    for (const item of value.slice(0, MAX_COMPACT_WORK_HISTORY_ITEMS)) {
        if (!isRecord(item)) continue;
        const row: Record<string, unknown> = {};
        for (const key of ["jobTitle", "title", "position", "companyName", "company", "raw", "description"]) {
            const compact = compactSearchValue(item[key]);
            if (compact !== undefined) {
                row[key] = compact;
            }
        }
        if (Object.keys(row).length > 0) {
            rows.push(row);
        }
    }
    return rows.length > 0 ? rows : undefined;
}

function collectStringArray(value: unknown): string[] | undefined {
    if (!Array.isArray(value)) {
        return undefined;
    }
    const result = value
        .flatMap((item) => (typeof item === "string" ? [item] : []))
        .slice(0, MAX_COMPACT_ARRAY_ITEMS);
    return result.length > 0 ? result : undefined;
}

function collectBrandHits(value: unknown): Array<{ brand: string }> | undefined {
    if (!Array.isArray(value)) {
        return undefined;
    }
    const result = value.flatMap((item) => {
        if (!isRecord(item) || typeof item.brand !== "string") {
            return [];
        }
        return [{ brand: item.brand }];
    }).slice(0, MAX_COMPACT_ARRAY_ITEMS);
    return result.length > 0 ? result : undefined;
}

function collectIngestSearchTextOptions(ingestData: unknown): {
    industryTags?: string[];
    synonymHits?: string[];
    brandHits?: Array<{ brand: string }>;
    companyHits?: string[];
    companyPatternAliasTokens?: string;
} {
    const raw = isRecord(ingestData) ? ingestData : {};
    const companyPatternAliasTokens = typeof raw.companyPatternAliasTokens === "string"
        ? raw.companyPatternAliasTokens.slice(0, MAX_COMPACT_STRING_CHARS)
        : undefined;
    return {
        industryTags: collectStringArray(raw.industryTags),
        synonymHits: collectStringArray(raw.synonymHits),
        brandHits: collectBrandHits(raw.brandHits),
        companyHits: collectStringArray(raw.companyHits),
        companyPatternAliasTokens,
    };
}

const LEGACY_DOMAIN_TOKEN_GROUPS: ReadonlyArray<{
    patterns: readonly RegExp[];
    tokens: readonly string[];
}> = [
    { patterns: [/\bcnc\b/i, /数控/], tokens: ["cnc", "数控"] },
    { patterns: [/机床/], tokens: ["机床", "machine tool", "machine tools"] },
];

function collectLegacyDomainTokens(searchText: string | undefined): string[] {
    if (!searchText) {
        return [];
    }
    const result: string[] = [];
    for (const group of LEGACY_DOMAIN_TOKEN_GROUPS) {
        if (group.patterns.some((pattern) => pattern.test(searchText))) {
            result.push(...group.tokens);
        }
    }
    return result;
}

function collectRoleYearsByType(
    resume: Doc<"resumes">,
    roleSignals: AnalysisRoleSignalLike[] | undefined,
): Record<string, number> {
    const raw = resume.ingestData as Record<string, unknown> | null | undefined;
    const result: Record<string, number> = {};

    const verifiedRoleYears = raw?.verifiedRoleYears;
    if (isRecord(verifiedRoleYears)) {
        mergeRoleYears(result, verifiedRoleYears);
    }

    mergeRoleYears(result, computeVerifiedRoleYears(roleSignals));
    return result;
}

function mergeRoleYears(target: Record<string, number>, values: Record<string, unknown>): void {
    for (const [key, value] of Object.entries(values)) {
        if (typeof value === "number" && Number.isFinite(value) && value > 0) {
            const normalizedKey = key.trim().toLowerCase();
            if (normalizedKey) {
                target[normalizedKey] = Math.max(target[normalizedKey] ?? 0, value);
            }
        }
    }
}

function collectRoleTypes(
    roleYearsByType: Record<string, number>,
    roleSignals: AnalysisRoleSignalLike[] | undefined,
): string[] {
    const result = new Set(Object.keys(roleYearsByType));
    for (const signal of roleSignals ?? []) {
        const key = signal.type.trim().toLowerCase();
        if (key) {
            result.add(key);
        }
    }
    return [...result];
}

function collectRoleSignals(value: unknown): AnalysisRoleSignalLike[] | undefined {
    if (!isRecord(value) || !Array.isArray(value.roleSignals)) {
        return undefined;
    }
    const signals = value.roleSignals.flatMap((entry) => {
        if (!isRecord(entry) || typeof entry.type !== "string") {
            return [];
        }
        const signal: AnalysisRoleSignalLike = { type: entry.type };
        const verifyIn = typeof entry.verifyIn === "string" ? entry.verifyIn : undefined;
        const years = toFiniteNumber(entry.years);
        const roleRelevantYears = toFiniteNumber(entry.roleRelevantYears);
        const industryVerifiedYears = toFiniteNumber(entry.industryVerifiedYears);
        const industryVerifiedRelevantYears = toFiniteNumber(entry.industryVerifiedRelevantYears);
        const matchedWorkEntries = collectMatchedWorkEntries(entry.matchedWorkEntries);
        if (verifyIn !== undefined) signal.verifyIn = verifyIn;
        if (years !== undefined) signal.years = years;
        if (roleRelevantYears !== undefined) signal.roleRelevantYears = roleRelevantYears;
        if (industryVerifiedYears !== undefined) signal.industryVerifiedYears = industryVerifiedYears;
        if (industryVerifiedRelevantYears !== undefined) signal.industryVerifiedRelevantYears = industryVerifiedRelevantYears;
        if (matchedWorkEntries !== undefined) signal.matchedWorkEntries = matchedWorkEntries;
        return [signal];
    });
    return signals.length > 0 ? signals : undefined;
}

function collectMatchedWorkEntries(value: unknown): AnalysisMatchedWorkEntryLike[] | undefined {
    if (!Array.isArray(value)) {
        return undefined;
    }
    const entries = value.flatMap((entry) => {
        if (!isRecord(entry)) {
            return [];
        }
        const matched: AnalysisMatchedWorkEntryLike = {};
        const years = toFiniteNumber(entry.years);
        if (years !== undefined) matched.years = years;
        if (typeof entry.directRoleMatch === "boolean") matched.directRoleMatch = entry.directRoleMatch;
        if (typeof entry.industryVerified === "boolean") matched.industryVerified = entry.industryVerified;
        return [matched];
    });
    return entries.length > 0 ? entries : undefined;
}

function toFiniteNumber(value: unknown): number | undefined {
    return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}
