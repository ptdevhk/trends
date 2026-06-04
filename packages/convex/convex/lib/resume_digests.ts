import {
    formatLocationHierarchySearchText,
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
    const salary = parseRawSalaryRange(
        typeof content.expectedSalary === "string" ? content.expectedSalary : undefined,
    );
    const roleYearsByType = collectRoleYearsByType(resume);

    return {
        resumeId: resume._id,
        identityKey: resume.identityKey,
        externalId: resume.externalId,
        source: resume.source,
        sourceKey: resume.sourceKey,
        searchText: resume.searchText,
        isArchived: resume.isArchived,
        archivedAt: resume.archivedAt,
        primaryRuleScore: resume.primaryRuleScore,
        crawledAt: resume.crawledAt,
        age: resolveResumeAge(resume, content) ?? undefined,
        locationText: formatLocationHierarchySearchText(locationHierarchy) || (typeof content.location === "string" ? content.location : undefined),
        educationLevel: normalizeEducationLevel(typeof content.education === "string" ? content.education : undefined) ?? undefined,
        salaryMin: salary?.min,
        salaryMax: salary?.max,
        experienceYears: resolveExperienceYears(typeof content.experience === "string" ? content.experience : undefined, content.workHistory) ?? undefined,
        roleTypes: Object.keys(roleYearsByType),
        roleYearsByType,
        updatedAt: now,
    };
}

function collectRoleYearsByType(resume: Doc<"resumes">): Record<string, number> {
    const raw = resume.ingestData as Record<string, unknown> | null | undefined;
    if (!raw) return {};
    const verifiedRoleYears = raw.verifiedRoleYears as Record<string, unknown> | null | undefined;
    if (!isRecord(verifiedRoleYears)) return {};
    const result: Record<string, number> = {};
    for (const [key, value] of Object.entries(verifiedRoleYears)) {
        if (typeof value === "number" && Number.isFinite(value) && value > 0) {
            result[key.toLowerCase()] = Math.max(result[key.toLowerCase()] ?? 0, value);
        }
    }
    return result;
}
