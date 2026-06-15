import {
    type AnalysisRoleSignalLike,
    buildLatestWorkHistoryEvidence,
    formatLocationHierarchySearchText,
    getVerifiedRoleSignalYears,
    isRecord,
    matchesResumeDigestFilters,
    normalizeEducationLevel,
    normalizeResumeLocationHierarchy,
    parseRawSalaryRange,
    resolveExperienceYears,
} from "@trends/shared";
import type { Doc, Id } from "../_generated/dataModel";
import {
    resolveResumeAge,
} from "./resumes_list_projections";
import {
    appendMissingSearchTokens,
    buildIngestSearchTokens,
    buildSearchText,
    normalizeWhitespace,
    toTextFragments,
} from "../search_text.js";

export { matchesResumeDigestFilters };

const MAX_DIGEST_FRAGMENT_LENGTH = 160;
const MAX_DIGEST_SEARCH_TEXT_LENGTH = 1500;

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
    displayScore?: number;
    displayRecommendation?: string;
    displayBreakdown?: Record<string, number>;
    displaySummary?: string;
    displayConfirmedScore?: number;
    displayConfirmedAt?: number;
    updatedAt: number;
};

export function buildResumeDigest(resume: Doc<"resumes">, now: number): ResumeDigest {
    const content = isRecord(resume.content) ? resume.content : {};
    const locationHierarchy = normalizeResumeLocationHierarchy(content, resume.source);
    const locationText = formatLocationHierarchySearchText(locationHierarchy) || (typeof content.location === "string" ? content.location : undefined);
    const educationLevel = normalizeEducationLevel(typeof content.education === "string" ? content.education : undefined) ?? undefined;
    const salary = parseRawSalaryRange(
        typeof content.expectedSalary === "string" ? content.expectedSalary : undefined,
    );
    const roleYearsByType = collectRoleYearsByType(resume);
    const roleTypes = collectRoleTypes(resume, roleYearsByType);

    return {
        resumeId: resume._id,
        identityKey: resume.identityKey,
        externalId: resume.externalId,
        source: resume.source,
        sourceKey: resume.sourceKey,
        searchText: buildCompactDigestSearchText(content, resume.ingestData, {
            coldSearchText: resume.searchText,
            locationHierarchy,
            locationText,
            educationLevel,
            roleYearsByType,
        }),
        isArchived: resume.isArchived,
        archivedAt: resume.archivedAt,
        primaryRuleScore: resume.primaryRuleScore,
        crawledAt: resume.crawledAt,
        age: resolveResumeAge(resume, content) ?? undefined,
        locationText,
        educationLevel,
        salaryMin: salary?.min,
        salaryMax: salary?.max,
        experienceYears: resolveExperienceYears(typeof content.experience === "string" ? content.experience : undefined, content.workHistory) ?? undefined,
        roleTypes,
        roleYearsByType,
        displayScore: resolveDisplayScore(resume),
        displayRecommendation: resolveDisplayRecommendation(resume),
        displayBreakdown: resolveDisplayBreakdown(resume),
        displaySummary: resolveDisplaySummary(resume),
        displayConfirmedScore: resume.confirmedScore,
        displayConfirmedAt: resume.confirmedAt,
        updatedAt: now,
    };
}

type CompactDigestSearchOptions = {
    coldSearchText?: string;
    locationHierarchy: ReturnType<typeof normalizeResumeLocationHierarchy>;
    locationText?: string;
    educationLevel?: string;
    roleYearsByType: Record<string, number>;
};

function buildCompactDigestSearchText(
    content: Record<string, unknown>,
    ingestData: unknown,
    options: CompactDigestSearchOptions,
): string | undefined {
    const compactContent = dropUndefined({
        name: compactFragment(content.name),
        desiredPosition: compactFragment(
            content.desiredPosition
            ?? content.jobIntention
            ?? content.title
            ?? content.position,
        ),
        education: compactFragment(content.education ?? options.educationLevel),
        expectedSalary: compactFragment(content.expectedSalary),
        skills: compactArray(content.skills, 20),
        companies: compactArray(content.companies, 20),
        locationHierarchy: options.locationHierarchy,
        workHistory: compactWorkHistory(content.workHistory),
    });

    const base = buildSearchText(compactContent);
    const ingestTokens = collectIngestTokens(ingestData);
    const domainTokens = collectDomainPresenceTokens(options.coldSearchText);
    const roleTokens = Object.keys(options.roleYearsByType);
    const withDigestFields = appendMissingSearchTokens(base, [
        options.locationText,
        options.educationLevel,
        ...domainTokens,
        ...roleTokens,
        ...ingestTokens,
    ].filter((value): value is string => typeof value === "string" && value.length > 0));
    return limitSearchText(withDigestFields);
}

function dropUndefined(record: Record<string, unknown>): Record<string, unknown> {
    return Object.fromEntries(
        Object.entries(record).filter(([, value]) => value !== undefined),
    );
}

function compactFragment(value: unknown): string | undefined {
    const normalized = normalizeWhitespace(toTextFragments(value).join(" "));
    if (!normalized) return undefined;
    return normalized.length > MAX_DIGEST_FRAGMENT_LENGTH
        ? normalized.slice(0, MAX_DIGEST_FRAGMENT_LENGTH)
        : normalized;
}

function compactArray(value: unknown, limit: number): string[] | undefined {
    const values = Array.isArray(value)
        ? value.flatMap((item) => toTextFragments(item))
        : toTextFragments(value);
    const compacted = values
        .map((item) => compactFragment(item))
        .filter((item): item is string => typeof item === "string" && item.length > 0)
        .slice(0, limit);
    return compacted.length > 0 ? compacted : undefined;
}

function compactWorkHistory(value: unknown): string[] | undefined {
    const lines = buildLatestWorkHistoryEvidence(value, { limit: 3 }).lines
        .map((line) => compactFragment(line))
        .filter((line): line is string => typeof line === "string" && line.length > 0);
    return lines.length > 0 ? lines : undefined;
}

function collectIngestTokens(value: unknown): string[] {
    if (!isRecord(value)) return [];
    return buildIngestSearchTokens({
        industryTags: toStringArray(value.industryTags),
        synonymHits: toStringArray(value.synonymHits),
        brandHits: toBrandHits(value.brandHits),
        companyHits: toStringArray(value.companyHits),
        companyPatternAliasTokens: typeof value.companyPatternAliasTokens === "string"
            ? value.companyPatternAliasTokens
            : undefined,
    });
}

function toStringArray(value: unknown): string[] | undefined {
    if (!Array.isArray(value)) return undefined;
    const result = value.filter((item): item is string => typeof item === "string" && item.trim().length > 0);
    return result.length > 0 ? result : undefined;
}

function toBrandHits(value: unknown): Array<{ brand: string }> | undefined {
    if (!Array.isArray(value)) return undefined;
    const result = value.flatMap((item) => {
        if (isRecord(item) && typeof item.brand === "string" && item.brand.trim()) {
            return [{ brand: item.brand }];
        }
        if (typeof item === "string" && item.trim()) {
            return [{ brand: item }];
        }
        return [];
    });
    return result.length > 0 ? result : undefined;
}

function limitSearchText(value: string): string | undefined {
    const tokens = normalizeWhitespace(value).toLowerCase().split(/\s+/g).filter((token) => token.length > 0);
    const seen = new Set<string>();
    const result: string[] = [];
    let length = 0;
    for (const token of tokens) {
        if (seen.has(token)) continue;
        const nextLength = length + token.length + (result.length > 0 ? 1 : 0);
        if (nextLength > MAX_DIGEST_SEARCH_TEXT_LENGTH) break;
        seen.add(token);
        result.push(token);
        length = nextLength;
    }
    return result.length > 0 ? result.join(" ") : undefined;
}

function collectDomainPresenceTokens(value: string | undefined): string[] {
    if (!value) return [];
    const normalized = value.toLowerCase();
    const tokens: string[] = [];
    if (/\bcnc\b/.test(normalized) || normalized.includes("数控")) {
        tokens.push("cnc", "数控");
    }
    if (normalized.includes("销售") || /\bsales?\b/.test(normalized)) {
        tokens.push("销售", "sales");
    }
    if (normalized.includes("机床") || normalized.includes("machine tool")) {
        tokens.push("机床", "machine tool", "machine tools");
    }
    return tokens;
}

function collectRoleTypes(resume: Doc<"resumes">, roleYearsByType: Record<string, number>): string[] {
    const raw = resume.ingestData as Record<string, unknown> | null | undefined;
    if (!raw) return Object.keys(roleYearsByType).sort();

    const out = new Set<string>(Object.keys(roleYearsByType));
    const roleSignals = parseAnalysisRoleSignals(raw.roleSignals);
    for (const signal of roleSignals) {
        const key = signal.type.trim().toLowerCase();
        if (key) {
            out.add(key);
        }
    }
    return Array.from(out).sort();
}

function collectRoleYearsByType(resume: Doc<"resumes">): Record<string, number> {
    const raw = resume.ingestData as Record<string, unknown> | null | undefined;
    if (!raw) return {};
    const result: Record<string, number> = {};

    const verifiedRoleYears = raw.verifiedRoleYears as Record<string, unknown> | null | undefined;
    if (isRecord(verifiedRoleYears)) {
        for (const [key, value] of Object.entries(verifiedRoleYears)) {
            const normalizedKey = key.trim().toLowerCase();
            if (normalizedKey && typeof value === "number" && Number.isFinite(value) && value > 0) {
                result[normalizedKey] = Math.max(result[normalizedKey] ?? 0, value);
            }
        }
    }

    const roleSignals = parseAnalysisRoleSignals(raw.roleSignals);
    for (const signal of roleSignals) {
        const key = signal.type.trim().toLowerCase();
        if (!key) {
            continue;
        }
        const years = getVerifiedRoleSignalYears(roleSignals, key, signal.verifyIn);
        if (years > 0) {
            result[key] = Math.max(result[key] ?? 0, years);
        }
    }
    return result;
}

function parseAnalysisRoleSignals(value: unknown): AnalysisRoleSignalLike[] {
    if (!Array.isArray(value)) return [];
    return value.flatMap((item) => {
        if (!isRecord(item) || typeof item.type !== "string") return [];
        return [{
            type: item.type,
            verifyIn: typeof item.verifyIn === "string" ? item.verifyIn : undefined,
            years: toNumber(item.years),
            roleRelevantYears: toNumber(item.roleRelevantYears),
            industryVerifiedYears: toNumber(item.industryVerifiedYears),
            industryVerifiedRelevantYears: toNumber(item.industryVerifiedRelevantYears),
            matchedWorkEntries: parseMatchedWorkEntries(item.matchedWorkEntries),
        }];
    });
}

function parseMatchedWorkEntries(value: unknown): AnalysisRoleSignalLike["matchedWorkEntries"] {
    if (!Array.isArray(value)) return undefined;
    const entries = value.flatMap((item) => {
        if (!isRecord(item)) return [];
        const years = toNumber(item.years);
        if (years === undefined) return [];
        return [{
            years,
            directRoleMatch: typeof item.directRoleMatch === "boolean" ? item.directRoleMatch : undefined,
            industryVerified: typeof item.industryVerified === "boolean" ? item.industryVerified : undefined,
        }];
    });
    return entries.length > 0 ? entries : undefined;
}

function toNumber(value: unknown): number | undefined {
    return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

// ---------------------------------------------------------------------------
// Phase 3 display-field resolvers — extract scalar display data from the
// default analysis object for zero-join list/search score display.
// ---------------------------------------------------------------------------

function resolveDisplayScore(resume: Doc<"resumes">): number | undefined {
    return typeof resume.analysis?.score === "number" ? resume.analysis.score : undefined;
}

function resolveDisplayRecommendation(resume: Doc<"resumes">): string | undefined {
    const rec = resume.analysis?.recommendation;
    return typeof rec === "string" && rec.trim().length > 0 ? rec : undefined;
}

function resolveDisplayBreakdown(resume: Doc<"resumes">): Record<string, number> | undefined {
    const breakdown = resume.analysis?.breakdown;
    if (!isRecord(breakdown)) return undefined;
    const result: Record<string, number> = {};
    for (const [key, value] of Object.entries(breakdown)) {
        if (typeof value === "number" && Number.isFinite(value)) {
            result[key] = value;
        }
    }
    return Object.keys(result).length > 0 ? result : undefined;
}

function resolveDisplaySummary(resume: Doc<"resumes">): string | undefined {
    const summary = resume.analysis?.summary;
    return typeof summary === "string" && summary.trim().length > 0
        ? summary.slice(0, 500)
        : undefined;
}
