import { api, internal } from "./_generated/api";
import { action, mutation } from "./_generated/server";
import type { MutationCtx } from "./_generated/server";
import type { Doc, Id } from "./_generated/dataModel";
import { v } from "convex/values";
import {
    buildLatestWorkHistoryEvidence,
    buildSeekNameSearchUrl,
    computeTemplateHash,
    computeVerifiedRoleYears,
    formatLocationHierarchyLabel,
    getWorkspaceSearchProfileTemplates,
    inferSeekMarket,
    normalizeJob5156ProfileUrlForDisplay,
    normalizeResumeLocationHierarchy,
    normalizeWorkHistoryEntry,
    isLikelyManual51jobCompanyName,
    isLikelyManual51jobJobTitle,
    parse51jobManualResume,
    shouldPreferManual51jobOptionalField,
    splitManual51jobLines,
    isRecord,
} from "@trends/shared";

import { buildSearchText, mergeSearchTextWithIngestData } from "./search_text";
import { deriveResumeIdentityKey } from "./lib/resume_identity";
import { parseAgeFromContent } from "./lib/age";
import { DEFAULT_WORKSPACE_SLUG } from "./sessions";
import { resolveResumeScanBatchSize, resolveDiagnosticsSourceKeyForResume } from "./resumes";
import { doUpsertResumeAnalysis } from "./resumes_search";

const JOB5156_HOST = "hr.job5156.com";
const MANUAL_51JOB_SOURCE = "51job-manual";
const PROFILE_URL_CONTENT_KEYS = ["profileUrl", "profile_url", "profileURL", "url"];


export function rewriteJob5156ProfileUrlsInContent(content: unknown): {
    content: Record<string, unknown> | null;
    updatedFields: string[];
} {
    if (!isRecord(content)) {
        return {
            content: null,
            updatedFields: [],
        };
    }

    let nextContent: Record<string, unknown> | null = null;
    const updatedFields: string[] = [];

    for (const key of PROFILE_URL_CONTENT_KEYS) {
        const rawValue = content[key];
        if (typeof rawValue !== "string") {
            continue;
        }

        const normalized = normalizeJob5156ProfileUrlForDisplay(rawValue);
        if (!normalized || normalized === rawValue.trim()) {
            continue;
        }

        if (!nextContent) {
            nextContent = { ...content };
        }
        nextContent[key] = normalized;
        updatedFields.push(key);
    }

    return {
        content: nextContent,
        updatedFields,
    };
}

type RewriteJob5156LocationHierarchyResult = {
    content: Record<string, unknown> | null;
    updatedLocationHierarchy: boolean;
    updatedLocation: boolean;
};

export function rewriteJob5156LocationHierarchyInContent(content: unknown): RewriteJob5156LocationHierarchyResult {
    if (!isRecord(content)) {
        return {
            content: null,
            updatedLocationHierarchy: false,
            updatedLocation: false,
        };
    }

    const source = typeof content.source === "string" ? content.source.toLowerCase() : "";
    const profileUrl = typeof content.profileUrl === "string" ? content.profileUrl.toLowerCase() : "";
    const isJob5156 = source === JOB5156_HOST || profileUrl.includes(JOB5156_HOST);
    if (!isJob5156) {
        return {
            content: null,
            updatedLocationHierarchy: false,
            updatedLocation: false,
        };
    }

    const locationHierarchy = normalizeResumeLocationHierarchy(content, source);
    const rawLocation = typeof content.location === "string" ? content.location.trim() : "";
    const nextLocation = rawLocation || (locationHierarchy ? formatLocationHierarchyLabel(locationHierarchy) : "");

    let nextContent: Record<string, unknown> | null = null;
    let updatedLocationHierarchy = false;
    let updatedLocation = false;

    if (locationHierarchy && !content.locationHierarchy) {
        nextContent = { ...(nextContent ?? content), locationHierarchy };
        updatedLocationHierarchy = true;
    }

    if (nextLocation && nextLocation !== rawLocation) {
        nextContent = { ...(nextContent ?? content), location: nextLocation };
        updatedLocation = true;
    }

    return {
        content: nextContent,
        updatedLocationHierarchy,
        updatedLocation,
    };
}

export function toRuleScores(value: unknown): Record<string, number> {
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

export function isManual51jobResumeContent(content: unknown, source: unknown): content is Record<string, unknown> {
    if (!isRecord(content)) {
        return false;
    }

    const normalizedSource = typeof source === "string" ? source.trim().toLowerCase() : "";
    if (normalizedSource === MANUAL_51JOB_SOURCE) {
        return true;
    }

    const profileType = typeof content.profileType === "string" ? content.profileType.trim().toLowerCase() : "";
    return profileType === MANUAL_51JOB_SOURCE;
}

export function isImplausibleManual51jobCompanyName(value: string): boolean {
    return !isLikelyManual51jobCompanyName(value);
}

export function isImplausibleManual51jobJobTitle(value: string): boolean {
    return !isLikelyManual51jobJobTitle(value);
}

export function hasMisplacedManual51jobCompanyLine(raw: string, companyName: string): boolean {
    const lines = splitManual51jobLines(raw).filter(Boolean);
    if (lines.length < 2) {
        return false;
    }

    const headerLine = lines[0] ?? "";
    const hasAllowedCompanyLabelContext = /(?:^|\n)(?:主要客户|客户|所属公司)[:：]?/u.test(raw);
    if (hasAllowedCompanyLabelContext) {
        return false;
    }

    if (!headerLine.includes(companyName) && lines.slice(1).some((line) => line === companyName || line.startsWith(`${companyName} `))) {
        return true;
    }

    return lines.slice(1).some((line) => line !== companyName && isLikelyManual51jobCompanyName(line));
}

export function isManual51jobWorkHistoryEntryMalformed(entry: unknown): boolean {
    const normalized = normalizeWorkHistoryEntry(entry);
    if (!normalized) {
        return true;
    }

    const originalRaw = isRecord(entry) && typeof entry.raw === "string"
        ? entry.raw
        : normalized.raw;
    const hasCompany = Boolean(normalized.companyName);
    const hasOtherFields = Boolean(normalized.jobTitle || normalized.description || normalized.startDate || normalized.endDate);

    if (!hasCompany && !hasOtherFields) {
        return true;
    }

    if (!normalized.companyName) {
        return false;
    }

    const hasStandaloneCustomerLabel = /(?:^|\s)(?:主要客户|客户)[:：]/u.test(originalRaw);
    if (hasStandaloneCustomerLabel) {
        if (!/(?:主要客户|客户)/u.test(normalized.description || "")) {
            return true;
        }
        if (normalized.companyName && originalRaw.includes(normalized.companyName)) {
            const customerLabelIndex = originalRaw.search(/(?:^|\s)(?:主要客户|客户)[:：]/u);
            const companyIndex = originalRaw.indexOf(normalized.companyName);
            if (customerLabelIndex >= 0 && companyIndex > customerLabelIndex) {
                return true;
            }
        }
    }

    if (hasMisplacedManual51jobCompanyLine(originalRaw, normalized.companyName)) {
        return true;
    }

    if (isImplausibleManual51jobCompanyName(normalized.companyName)) {
        return true;
    }

    if (normalized.jobTitle && isImplausibleManual51jobJobTitle(normalized.jobTitle)) {
        return true;
    }

    return false;
}

export function hasStructuredWorkHistory(content: Record<string, unknown>): boolean {
    if (!Array.isArray(content.workHistory)) {
        return false;
    }

    return content.workHistory.some((entry) => {
        const normalized = normalizeWorkHistoryEntry(entry);
        return Boolean(normalized && normalized.companyName && (normalized.jobTitle || normalized.description || normalized.startDate || normalized.endDate));
    });
}

export function workHistoryMatches(existing: unknown, next: unknown): boolean {
    if (!Array.isArray(existing) || !Array.isArray(next)) {
        return false;
    }
    if (existing.length !== next.length) {
        return false;
    }

    return existing.every((entry, index) => {
        const left = normalizeWorkHistoryEntry(entry);
        const right = normalizeWorkHistoryEntry(next[index]);
        if (!left || !right) {
            return left === right;
        }
        return left.raw === right.raw
            && left.companyName === right.companyName
            && left.jobTitle === right.jobTitle
            && left.description === right.description
            && left.startDate === right.startDate
            && left.endDate === right.endDate;
    });
}

export function locationHierarchySpecificity(value: {
    province?: string;
    city?: string;
    district?: string;
} | undefined): number {
    return [value?.province, value?.city, value?.district].filter(Boolean).length;
}

export function shouldReplaceManual51jobName(existing: unknown, parsedName: string | undefined): boolean {
    const nextName = typeof parsedName === "string" ? parsedName.trim() : "";
    if (!nextName) {
        return false;
    }

    const currentName = typeof existing === "string" ? existing.trim() : "";
    if (!currentName) {
        return true;
    }
    if (currentName === nextName) {
        return false;
    }
    if (/[_(（）)]/.test(currentName)) {
        return true;
    }
    if (currentName.includes(nextName) && currentName.length > nextName.length) {
        return true;
    }

    return false;
}

export function shouldPreferManual51jobLocation(existing: unknown, parsedLocation: string | undefined): boolean {
    const nextLocation = typeof parsedLocation === "string" ? parsedLocation.trim() : "";
    if (!nextLocation) {
        return false;
    }

    const currentLocation = typeof existing === "string" ? existing.trim() : "";
    if (!currentLocation) {
        return true;
    }
    if (currentLocation === nextLocation) {
        return false;
    }

    const currentHierarchy = normalizeResumeLocationHierarchy({ location: currentLocation });
    const nextHierarchy = normalizeResumeLocationHierarchy({ location: nextLocation });
    if (!nextHierarchy) {
        return false;
    }
    if (!currentHierarchy) {
        return true;
    }

    return locationHierarchySpecificity(nextHierarchy) > locationHierarchySpecificity(currentHierarchy);
}

export function rewrite51jobManualContent(content: unknown, source: string): {
    content: Record<string, unknown> | null;
    contentChanged: boolean;
    evidenceText: string;
} {
    if (!isManual51jobResumeContent(content, source)) {
        return {
            content: null,
            contentChanged: false,
            evidenceText: "",
        };
    }

    const rawText = typeof content.resumeSnippet === "string"
        ? content.resumeSnippet.trim()
        : isRecord(content.resumeSnippet) && typeof content.resumeSnippet.text === "string"
            ? content.resumeSnippet.text.trim()
            : typeof content.selfIntro === "string"
                ? content.selfIntro.trim()
                : "";
    if (!rawText) {
        return {
            content: null,
            contentChanged: false,
            evidenceText: "",
        };
    }

    const parsed = parse51jobManualResume({
        text: rawText,
        fallbackName: typeof content.name === "string" ? content.name.trim() : undefined,
        fallbackProfileId: typeof content.profileId === "string" ? content.profileId.trim() : undefined,
    });
    const nextContent: Record<string, unknown> = { ...content };
    let changed = false;

    const existingWorkHistory = Array.isArray(nextContent.workHistory) ? nextContent.workHistory : [];
    const allExistingWorkHistoryMalformed = existingWorkHistory.length > 0
        && existingWorkHistory.every((entry) => isManual51jobWorkHistoryEntryMalformed(entry));
    const shouldRepairWorkHistory = !hasStructuredWorkHistory(nextContent)
        || existingWorkHistory.some((entry) => isManual51jobWorkHistoryEntryMalformed(entry));

    if (shouldRepairWorkHistory && (parsed.workHistory.length > 0 || allExistingWorkHistoryMalformed) && !workHistoryMatches(existingWorkHistory, parsed.workHistory)) {
        nextContent.workHistory = parsed.workHistory;
        changed = true;
    }

    if (!Array.isArray(nextContent.profileEducation) && parsed.profileEducation && parsed.profileEducation.length > 0) {
        nextContent.profileEducation = parsed.profileEducation;
        changed = true;
    }

    if (shouldReplaceManual51jobName(nextContent.name, parsed.name)) {
        nextContent.name = parsed.name;
        changed = true;
    }

    if (shouldPreferManual51jobLocation(nextContent.location, parsed.location)) {
        nextContent.location = parsed.location;
        changed = true;
    }

    const optionalFields: Array<"jobIntention" | "expectedSalary" | "experience" | "education"> = ["jobIntention", "expectedSalary", "experience", "education"];
    for (const field of optionalFields) {
        const existing = nextContent[field];
        const parsedValue = parsed[field];
        if (shouldPreferManual51jobOptionalField(field, existing, parsedValue)) {
            nextContent[field] = parsedValue;
            changed = true;
        }
    }

    const existingSelfIntro = typeof nextContent.selfIntro === "string" ? nextContent.selfIntro.trim() : "";
    if (!existingSelfIntro) {
        if (parsed.selfIntro) {
            nextContent.selfIntro = parsed.selfIntro;
            changed = true;
        }
    } else if (existingSelfIntro === rawText) {
        if (parsed.selfIntro) {
            nextContent.selfIntro = parsed.selfIntro;
        } else {
            delete nextContent.selfIntro;
        }
        changed = true;
    }

    if (
        (!isRecord(nextContent.resumeSnippet) || typeof nextContent.resumeSnippet.text !== "string" || !nextContent.resumeSnippet.text.trim())
        && parsed.resumeSnippet.text
    ) {
        nextContent.resumeSnippet = parsed.resumeSnippet;
        changed = true;
    }

    const rewrittenContent = changed ? nextContent : content;

    return {
        content: rewrittenContent,
        contentChanged: changed,
        evidenceText: buildLatestWorkHistoryEvidence(rewrittenContent).text,
    };
}

/**
 * Effective analysis view for a resume — cold-sourced when a cold row exists.
 * Used to thread Phase 4 cold-table reads through the merge/audit helpers
 * without changing their hot-field fallback (which keeps legacy callers and
 * hot-seeded tests working until Step 3 removes the hot fields).
 */
export type ResumeAnalysisView = {
    analysis?: Doc<"resumes">["analysis"];
    analyses?: Doc<"resumes">["analyses"];
};

/** Map of resume _id (string) → cold-sourced analysis view. */
export type ResumeAnalysisViewById = Map<string, ResumeAnalysisView>;

function resolveAnalysis(resume: Doc<"resumes">, viewsById?: ResumeAnalysisViewById): ResumeAnalysisView {
    const view = viewsById?.get(String(resume._id));
    if (view) {
        // A cold row exists → it is authoritative (Phase 4 source of truth).
        // An explicit undefined means "no analysis/analyses", NOT "fall back to
        // hot" — otherwise cleared cold rows would resurrect stale hot data.
        return { analysis: view.analysis, analyses: view.analyses };
    }
    return { analysis: resume.analysis, analyses: resume.analyses };
}

export function analysisRichness(resume: Doc<"resumes">, viewsById?: ResumeAnalysisViewById): number {
    const { analysis, analyses } = resolveAnalysis(resume, viewsById);
    let richness = 0;
    if (analysis !== undefined) {
        richness += 1;
    }
    if (isRecord(analyses)) {
        richness += Object.keys(analyses).length;
    }
    return richness;
}

export function resumeIdentityKey(resume: Doc<"resumes">): string {
    return resume.identityKey ?? deriveResumeIdentityKey({
        content: resume.content,
        externalId: resume.externalId,
        source: resume.source,
    });
}

export function sortForCanonical(resumes: Doc<"resumes">[], viewsById?: ResumeAnalysisViewById): Doc<"resumes">[] {
    return [...resumes].sort((left, right) => {
        if (left.crawledAt !== right.crawledAt) {
            return right.crawledAt - left.crawledAt;
        }
        const richnessDiff = analysisRichness(right, viewsById) - analysisRichness(left, viewsById);
        if (richnessDiff !== 0) {
            return richnessDiff;
        }
        return String(left._id).localeCompare(String(right._id));
    });
}

export function mergeAnalyses(resumes: Doc<"resumes">[], viewsById?: ResumeAnalysisViewById): {
    analyses: Doc<"resumes">["analyses"];
    analysis: Doc<"resumes">["analysis"];
} {
    const mergedAnalyses: NonNullable<Doc<"resumes">["analyses"]> = {};
    let primaryAnalysis: Doc<"resumes">["analysis"] = undefined;

    for (const resume of resumes) {
        const { analysis, analyses } = resolveAnalysis(resume, viewsById);
        if (primaryAnalysis === undefined && analysis !== undefined) {
            primaryAnalysis = analysis;
        }

        if (!isRecord(analyses)) {
            continue;
        }
        for (const [key, value] of Object.entries(analyses)) {
            if (!(key in mergedAnalyses)) {
                mergedAnalyses[key] = value as NonNullable<Doc<"resumes">["analyses"]>[string];
            }
        }
    }

    return {
        analyses: mergedAnalyses,
        analysis: primaryAnalysis,
    };
}

/**
 * Build a resumeId → active cold analysis-view map for a set of resumes.
 * Only resumes with an ACTIVE cold row (status !== "archived") get an entry,
 * so resumes without a cold row fall back to their hot fields via
 * {@link resolveAnalysis}. Used by the merge/audit migrations to read analyses
 * from the cold table (Phase 4 Step 2) without breaking hot-field callers.
 */
export async function fetchActiveAnalysisViews(
    ctx: MutationCtx,
    resumes: Doc<"resumes">[],
): Promise<ResumeAnalysisViewById> {
    const views: ResumeAnalysisViewById = new Map();
    await Promise.all(
        resumes.map(async (resume) => {
            const coldRow = await ctx.db
                .query("resume_analyses")
                .withIndex("by_resume", (q) => q.eq("resumeId", resume._id))
                .unique();
            if (coldRow && coldRow.status !== "archived") {
                views.set(String(resume._id), { analysis: coldRow.analysis, analyses: coldRow.analyses });
            }
        }),
    );
    return views;
}

export function groupDuplicatesByIdentity(resumes: Doc<"resumes">[]): Array<{
    identityKey: string;
    resumes: Doc<"resumes">[];
}> {
    const groups = new Map<string, Doc<"resumes">[]>();
    for (const resume of resumes) {
        const identityKey = resumeIdentityKey(resume);
        const bucket = groups.get(identityKey);
        if (bucket) {
            bucket.push(resume);
            continue;
        }
        groups.set(identityKey, [resume]);
    }

    return Array.from(groups.entries())
        .map(([identityKey, docs]) => ({ identityKey, resumes: docs }))
        .filter((group) => group.resumes.length > 1)
        .sort((left, right) => {
            if (left.resumes.length !== right.resumes.length) {
                return right.resumes.length - left.resumes.length;
            }
            return left.identityKey.localeCompare(right.identityKey);
        });
}

type BackfillIngestDataResult = {
    scheduled: number;
    batches: number;
    hasMore: boolean;
    cursor: string | null;
    scannedResumes: number;
    message: string;
};

type ReIngestStaleSkillsVersionResult = {
    scheduled: number;
    batches: number;
    currentVersion: number;
    hasMore: boolean;
};

type ReIngestAllResumesResult = {
    scheduled: number;
    batches: number;
};

type BackfillResumeDigestsResult = {
    processed: number;
    isDone: boolean;
    cursor: string | null;
};

export const backfillSearchText = mutation({
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
        let count = 0;
        for (const resume of resumes.page) {
            if (resume.searchText) continue;

            const searchText = mergeSearchTextWithIngestData(buildSearchText(resume.content), {
                industryTags: resume.ingestData?.industryTags,
                synonymHits: resume.ingestData?.synonymHits,
                brandHits: resume.ingestData?.brandHits,
                companyHits: resume.ingestData?.companyHits,
            });

            await ctx.db.patch(resume._id, { searchText });
            count++;
        }
        return {
            scannedResumes: resumes.page.length,
            updatedResumes: count,
            hasMore: !resumes.isDone,
            cursor: resumes.isDone ? null : resumes.continueCursor,
        };
    },
});

export const reindexSearchText = mutation({
    args: {
        cursor: v.optional(v.string()),
        batchSize: v.optional(v.number()),
        force: v.optional(v.boolean()),
    },
    handler: async (ctx, args) => {
        const resumes = await ctx.db
            .query("resumes")
            .order("desc")
            .paginate({
                cursor: args.cursor ?? null,
                numItems: resolveResumeScanBatchSize(args.batchSize),
            });
        let count = 0;
        const epoch = args.force ? Date.now() : undefined;
        for (const resume of resumes.page) {
            const searchText = mergeSearchTextWithIngestData(buildSearchText(resume.content), {
                industryTags: resume.ingestData?.industryTags,
                synonymHits: resume.ingestData?.synonymHits,
                brandHits: resume.ingestData?.brandHits,
                companyHits: resume.ingestData?.companyHits,
            });
            if (searchText !== resume.searchText) {
                await ctx.db.patch(resume._id, {
                    searchText,
                    ...(epoch !== undefined ? { searchRefreshEpoch: epoch } : {}),
                });
                count++;
            } else if (args.force) {
                await ctx.db.patch(resume._id, { searchText, searchRefreshEpoch: epoch });
                count++;
            }
        }
        return {
            scannedResumes: resumes.page.length,
            updatedResumes: count,
            hasMore: !resumes.isDone,
            cursor: resumes.isDone ? null : resumes.continueCursor,
        };
    },
});

export const backfillAge = mutation({
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
        let updated = 0;

        for (const resume of resumes.page) {
            const parsedAge = parseAgeFromContent(resume.content);
            if (parsedAge === null || resume.age === parsedAge) {
                continue;
            }

            await ctx.db.patch(resume._id, { age: parsedAge });
            updated += 1;
        }

        return {
            scannedResumes: resumes.page.length,
            updatedResumes: updated,
            hasMore: !resumes.isDone,
            cursor: resumes.isDone ? null : resumes.continueCursor,
        };
    },
});

export const backfillWorkspaceSlugs = mutation({
    args: {},
    handler: async (ctx) => {
        const defaultWorkspace = DEFAULT_WORKSPACE_SLUG;
        let patchedJobDescriptions = 0;
        let patchedSearchProfiles = 0;
        let patchedScreeningSessions = 0;
        let patchedSearchHistory = 0;

        const customJobDescriptions = await ctx.db
            .query("job_descriptions")
            .filter((q) => q.eq(q.field("type"), "custom"))
            .collect();

        for (const record of customJobDescriptions) {
            if (typeof record.workspaceSlug === "string" && record.workspaceSlug.trim()) {
                continue;
            }
            await ctx.db.patch(record._id, { workspaceSlug: defaultWorkspace });
            patchedJobDescriptions += 1;
        }

        const searchProfiles = await ctx.db.query("search_profiles").collect();
        for (const record of searchProfiles) {
            if (typeof record.workspaceSlug === "string" && record.workspaceSlug.trim()) {
                continue;
            }
            await ctx.db.patch(record._id, { workspaceSlug: defaultWorkspace });
            patchedSearchProfiles += 1;
        }

        const screeningSessions = await ctx.db.query("screening_sessions").collect();
        for (const record of screeningSessions) {
            if (typeof record.workspaceSlug === "string" && record.workspaceSlug.trim()) {
                continue;
            }
            await ctx.db.patch(record._id, { workspaceSlug: defaultWorkspace });
            patchedScreeningSessions += 1;
        }

        const searchHistory = await ctx.db.query("search_history").collect();
        for (const record of searchHistory) {
            if (typeof record.workspaceSlug === "string" && record.workspaceSlug.trim()) {
                continue;
            }
            await ctx.db.patch(record._id, { workspaceSlug: defaultWorkspace });
            patchedSearchHistory += 1;
        }

        return {
            defaultWorkspace,
            patchedJobDescriptions,
            patchedSearchProfiles,
            patchedScreeningSessions,
            patchedSearchHistory,
        };
    },
});

export const backfillIngestData = action({
    args: {
        limit: v.optional(v.number()),
        cursor: v.optional(v.string()),
        batchSize: v.optional(v.number()),
    },
    handler: async (ctx, args): Promise<BackfillIngestDataResult> => {
        const limit = Math.max(1, Math.min(args.limit ?? 100, 500));
        const scanLimit = Math.min(resolveResumeScanBatchSize(args.batchSize), limit);
        let cursor = args.cursor;
        let scannedResumes = 0;
        let hasMore = false;
        let nextCursor: string | null = args.cursor ?? null;
        const resumeIds: Id<"resumes">[] = [];

        while (resumeIds.length < limit) {
            const scanBatch = await ctx.runQuery(internal.resumes.listResumeScanBatch, {
                cursor,
                limit: scanLimit,
            });
            const remaining = limit - resumeIds.length;

            scannedResumes += scanBatch.page.length;
            resumeIds.push(
                ...scanBatch.page
                    .filter((resume) => resume.ingestData === undefined)
                    .slice(0, remaining)
                    .map((resume) => resume._id)
            );

            nextCursor = scanBatch.isDone ? null : scanBatch.continueCursor;
            hasMore = !scanBatch.isDone;

            if (scanBatch.isDone || resumeIds.length >= limit) {
                break;
            }

            cursor = scanBatch.continueCursor;
        }

        if (resumeIds.length === 0) {
            return {
                scheduled: 0,
                batches: 0,
                hasMore,
                cursor: nextCursor,
                scannedResumes,
                message: hasMore ? "No unprocessed resumes found in this scan window" : "No unprocessed resumes remaining",
            };
        }

        const batchSize = 50;
        let batches = 0;

        for (let index = 0; index < resumeIds.length; index += batchSize) {
            const chunk = resumeIds.slice(index, index + batchSize);
            await ctx.scheduler.runAfter(0, internal.ingest_agent.processNewResumes, {
                resumeIds: chunk,
            });
            batches += 1;
        }

        return {
            scheduled: resumeIds.length,
            batches,
            hasMore,
            cursor: nextCursor,
            scannedResumes,
            message: `Scheduled ingest backfill for ${resumeIds.length} resumes in ${batches} batch(es)`,
        };
    },
});

export const backfillPrimaryRuleScore = mutation({
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
        let updated = 0;

        for (const resume of resumes.page) {
            if (resume.primaryRuleScore !== undefined) {
                continue;
            }

            const scores = toRuleScores(resume.ingestData?.ruleScores);
            const values = Object.values(scores);
            const primaryRuleScore = values.length > 0 ? Math.max(...values) : 0;
            await ctx.db.patch(resume._id, { primaryRuleScore });
            updated += 1;
        }

        return {
            scannedResumes: resumes.page.length,
            updatedResumes: updated,
            hasMore: !resumes.isDone,
            cursor: resumes.isDone ? null : resumes.continueCursor,
        };
    },
});

export const backfillEvidenceText = mutation({
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
        let patched = 0;

        for (const resume of resumes.page) {
            if (!resume.ingestData || typeof resume.ingestData.evidenceText === "string") {
                continue;
            }

            await ctx.db.patch(resume._id, {
                ingestData: {
                    ...resume.ingestData,
                    evidenceText: buildLatestWorkHistoryEvidence(resume.content).text,
                },
            });
            patched += 1;
        }

        return {
            scannedResumes: resumes.page.length,
            patched,
            hasMore: !resumes.isDone,
            cursor: resumes.isDone ? null : resumes.continueCursor,
        };
    },
});

export function looksLikeJob5156EducationEntry(value: unknown): boolean {
    const normalized = normalizeWorkHistoryEntry(value);
    if (!normalized) {
        return false;
    }

    const raw = normalized.raw.toLowerCase();
    const companyName = (normalized.companyName || "").toLowerCase();
    return raw.includes("学院") || raw.includes("大学") || raw.includes("学历") || companyName.includes("学院") || companyName.includes("大学");
}

export function rewriteJob5156WorkHistoryContent(content: unknown): {
    content: Record<string, unknown> | null;
    movedEducationEntries: number;
} {
    if (!isRecord(content) || !Array.isArray(content.workHistory)) {
        return {
            content: null,
            movedEducationEntries: 0,
        };
    }

    const source = typeof content.source === "string" ? content.source.toLowerCase() : "";
    const profileUrl = typeof content.profileUrl === "string" ? content.profileUrl.toLowerCase() : "";
    const isJob5156 = source === JOB5156_HOST || profileUrl.includes(JOB5156_HOST);
    if (!isJob5156) {
        return {
            content: null,
            movedEducationEntries: 0,
        };
    }

    const nextWorkHistory: unknown[] = [];
    const nextProfileEducation = Array.isArray(content.profileEducation) ? [...content.profileEducation] : [];
    let movedEducationEntries = 0;

    for (const entry of content.workHistory) {
        const normalized = normalizeWorkHistoryEntry(entry);
        if (!normalized) {
            nextWorkHistory.push(entry);
            continue;
        }

        if (looksLikeJob5156EducationEntry(normalized)) {
            nextProfileEducation.push({
                institution: normalized.companyName || normalized.raw || undefined,
                qualification: normalized.jobTitle || undefined,
                endDate: normalized.endDate || normalized.startDate || undefined,
            });
            movedEducationEntries += 1;
            continue;
        }

        nextWorkHistory.push(entry);
    }

    if (movedEducationEntries === 0) {
        return {
            content: null,
            movedEducationEntries: 0,
        };
    }

    return {
        content: {
            ...content,
            workHistory: nextWorkHistory,
            profileEducation: nextProfileEducation,
        },
        movedEducationEntries,
    };
}

export const backfillJob5156ProfileUrls = mutation({
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
        let updatedResumes = 0;
        let updatedProfileFields = 0;

        for (const resume of resumes.page) {
            const rewritten = rewriteJob5156ProfileUrlsInContent(resume.content);
            if (!rewritten.content) {
                continue;
            }

            const searchText = buildSearchText(rewritten.content);
            await ctx.db.patch(resume._id, {
                content: rewritten.content as Doc<"resumes">["content"],
                searchText,
            });

            updatedResumes += 1;
            updatedProfileFields += rewritten.updatedFields.length;
        }

        return {
            scannedResumes: resumes.page.length,
            updatedResumes,
            updatedProfileFields,
            hasMore: !resumes.isDone,
            cursor: resumes.isDone ? null : resumes.continueCursor,
        };
    },
});

export const backfillJob5156WorkHistoryEducation = mutation({
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
        let updatedResumes = 0;
        let movedEducationEntries = 0;

        for (const resume of resumes.page) {
            const rewritten = rewriteJob5156WorkHistoryContent(resume.content);
            if (!rewritten.content) {
                continue;
            }

            const searchText = buildSearchText(rewritten.content);
            await ctx.db.patch(resume._id, {
                content: rewritten.content as Doc<"resumes">["content"],
                searchText,
                ingestData: resume.ingestData
                    ? {
                        ...resume.ingestData,
                        evidenceText: buildLatestWorkHistoryEvidence(rewritten.content).text,
                    }
                    : resume.ingestData,
            });
            updatedResumes += 1;
            movedEducationEntries += rewritten.movedEducationEntries;
        }

        return {
            scannedResumes: resumes.page.length,
            updatedResumes,
            movedEducationEntries,
            hasMore: !resumes.isDone,
            cursor: resumes.isDone ? null : resumes.continueCursor,
        };
    },
});

export const backfillJob5156LocationHierarchy = mutation({
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

        let updatedResumes = 0;
        let updatedLocationHierarchy = 0;
        let updatedLocation = 0;
        let updatedSearchText = 0;

        for (const resume of resumes.page) {
            const rewritten = rewriteJob5156LocationHierarchyInContent(resume.content);
            const searchText = mergeSearchTextWithIngestData(
                buildSearchText(rewritten.content ?? resume.content),
                {
                    industryTags: resume.ingestData?.industryTags,
                    synonymHits: resume.ingestData?.synonymHits,
                    brandHits: resume.ingestData?.brandHits,
                    companyHits: resume.ingestData?.companyHits,
                }
            );

            const patch: {
                content?: Doc<"resumes">["content"];
                searchText?: string;
            } = {};

            if (rewritten.content) {
                patch.content = rewritten.content as Doc<"resumes">["content"];
                if (rewritten.updatedLocationHierarchy) {
                    updatedLocationHierarchy += 1;
                }
                if (rewritten.updatedLocation) {
                    updatedLocation += 1;
                }
            }

            if (searchText !== resume.searchText) {
                patch.searchText = searchText;
                updatedSearchText += 1;
            }

            if (Object.keys(patch).length === 0) {
                continue;
            }

            await ctx.db.patch(resume._id, patch);
            updatedResumes += 1;
        }

        return {
            scannedResumes: resumes.page.length,
            updatedResumes,
            updatedLocationHierarchy,
            updatedLocation,
            updatedSearchText,
            hasMore: !resumes.isDone,
            cursor: resumes.isDone ? null : resumes.continueCursor,
        };
    },
});

export const backfillManual51jobStructuredContent = mutation({
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

        let updatedResumes = 0;
        let updatedEvidenceText = 0;
        let updatedSearchText = 0;
        const repairedResumeIds: Id<"resumes">[] = [];

        for (const resume of resumes.page) {
            const rewritten = rewrite51jobManualContent(resume.content, resume.source);
            if (!rewritten.content) {
                continue;
            }

            const searchText = mergeSearchTextWithIngestData(
                buildSearchText(rewritten.content),
                {
                    industryTags: resume.ingestData?.industryTags,
                    synonymHits: resume.ingestData?.synonymHits,
                    brandHits: resume.ingestData?.brandHits,
                    companyHits: resume.ingestData?.companyHits,
                }
            );

            const patch: {
                content?: Doc<"resumes">["content"];
                searchText?: string;
                ingestData?: Doc<"resumes">["ingestData"];
            } = {};

            if (rewritten.contentChanged) {
                patch.content = rewritten.content as Doc<"resumes">["content"];
            }

            if (searchText !== resume.searchText) {
                patch.searchText = searchText;
                updatedSearchText += 1;
            }

            if (resume.ingestData && rewritten.evidenceText !== resume.ingestData.evidenceText) {
                patch.ingestData = {
                    ...resume.ingestData,
                    evidenceText: rewritten.evidenceText,
                };
                updatedEvidenceText += 1;
            }

            if (Object.keys(patch).length === 0) {
                continue;
            }

            await ctx.db.patch(resume._id, patch);
            if (rewritten.contentChanged) {
                repairedResumeIds.push(resume._id);
            }
            updatedResumes += 1;
        }

        let scheduledReingest = 0;
        let batches = 0;
        for (let index = 0; index < repairedResumeIds.length; index += 50) {
            const chunk = repairedResumeIds.slice(index, index + 50);
            await ctx.scheduler.runAfter(0, internal.ingest_agent.processNewResumes, {
                resumeIds: chunk,
            });
            scheduledReingest += chunk.length;
            batches += 1;
        }

        return {
            scannedResumes: resumes.page.length,
            updatedResumes,
            updatedEvidenceText,
            updatedSearchText,
            scheduledReingest,
            batches,
            hasMore: !resumes.isDone,
            cursor: resumes.isDone ? null : resumes.continueCursor,
        };
    },
});

export const reIngestStaleSkillsVersion = action({
    args: {
        limit: v.optional(v.number()),
    },
    handler: async (ctx, args): Promise<ReIngestStaleSkillsVersionResult> => {
        return await ctx.runAction(internal.ingest_agent.reIngestStaleResumes, {
            limit: args.limit,
        });
    },
});

export const reIngestAllResumes = action({
    args: {},
    handler: async (ctx): Promise<ReIngestAllResumesResult> => {
        return await ctx.runAction(internal.ingest_agent.reIngestAllResumes, {});
    },
});

export const auditDuplicateResumesByIdentity = mutation({
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
        const duplicateGroups = groupDuplicatesByIdentity(resumes.page);
        // Phase 4 Step 2: read analysis richness from the cold table so canonical
        // selection stays correct after the hot fields are removed.
        const viewsById = await fetchActiveAnalysisViews(ctx, resumes.page);

        const groups = duplicateGroups.map((group) => {
            const ordered = sortForCanonical(group.resumes, viewsById);
            const canonical = ordered[0];
            const duplicates = ordered.slice(1);
            return {
                identityKey: group.identityKey,
                count: group.resumes.length,
                canonicalId: String(canonical._id),
                duplicateIds: duplicates.map((resume) => String(resume._id)),
            };
        });

        return {
            scannedResumes: resumes.page.length,
            duplicateGroupCount: groups.length,
            duplicateResumeCount: groups.reduce((sum, group) => sum + group.duplicateIds.length, 0),
            groups,
            hasMore: !resumes.isDone,
            cursor: resumes.isDone ? null : resumes.continueCursor,
        };
    },
});

export const backfillTaggingEnvelope = mutation({
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
        let updated = 0;

        for (const resume of resumes.page) {
            if (!resume.ingestData) continue;
            if (resume.ingestData.taggingEnvelope) continue;

            const tagEnvelope = (resume.ingestData as Record<string, unknown>).tagEnvelope;
            if (!Array.isArray(tagEnvelope) || tagEnvelope.length === 0) continue;

            const computedAt = resume.ingestData.computedAt ?? Date.now();
            const taggingEnvelope = {
                schemaVersion: 1,
                generatedAt: computedAt,
                entries: tagEnvelope.map((entry) => ({
                    tag: entry.tag,
                    source: entry.source,
                    confidence: entry.confidence,
                    version: entry.version,
                    provenance: {
                        stage: entry.tag.startsWith("industry:") ? "industry_taxonomy" : entry.tag.startsWith("role:") ? "role_signal_aggregation" : "unknown",
                        generatedBy: "migration_backfill",
                        evidence: entry.evidence ?? [],
                    },
                })),
            };

            await ctx.db.patch(resume._id, {
                ingestData: {
                    ...resume.ingestData,
                    taggingEnvelope,
                },
            });
            updated += 1;
        }

        return {
            scannedResumes: resumes.page.length,
            updatedResumes: updated,
            hasMore: !resumes.isDone,
            cursor: resumes.isDone ? null : resumes.continueCursor,
        };
    },
});

export const mergeDuplicateResumesByIdentity = mutation({
    args: {
        dryRun: v.boolean(),
        batchSize: v.number(),
        cursor: v.optional(v.string()),
    },
    handler: async (ctx, args) => {
        const resumes = await ctx.db
            .query("resumes")
            .order("desc")
            .paginate({
                cursor: args.cursor ?? null,
                numItems: resolveResumeScanBatchSize(args.batchSize),
            });
        const duplicateGroups = groupDuplicatesByIdentity(resumes.page);
        // Phase 4 Step 2: read analyses from the cold table so merge consolidates
        // the correct data after the hot fields are removed.
        const viewsById = await fetchActiveAnalysisViews(ctx, resumes.page);
        const effectiveBatchSize = Math.max(1, Math.trunc(args.batchSize));
        const targetGroups = duplicateGroups.slice(0, effectiveBatchSize);

        let deleted = 0;
        let patchedCanonicals = 0;

        const groups: Array<{
            identityKey: string;
            canonicalId: string;
            duplicateIds: string[];
            duplicateCount: number;
            mergedTagCount: number;
            mergedAnalysisCount: number;
        }> = [];
        for (const group of targetGroups) {
            const ordered = sortForCanonical(group.resumes, viewsById);
            const canonical = ordered[0];
            const duplicates = ordered.slice(1);

            const mergedTags = Array.from(new Set(ordered.flatMap((resume) => resume.tags)));
            const mergedAnalysis = mergeAnalyses(ordered, viewsById);

            if (!args.dryRun) {
                const patch: {
                    identityKey: string;
                    tags: string[];
                    analyses?: Doc<"resumes">["analyses"];
                    analysis?: Doc<"resumes">["analysis"];
                } = {
                    identityKey: group.identityKey,
                    tags: mergedTags,
                };

                if (mergedAnalysis.analyses && Object.keys(mergedAnalysis.analyses).length > 0) {
                    patch.analyses = mergedAnalysis.analyses;
                }
                if (mergedAnalysis.analysis !== undefined) {
                    patch.analysis = mergedAnalysis.analysis;
                }

                await ctx.db.patch(canonical._id, patch);
                // Phase 4 Step 2: sync the canonical's cold resume_analyses row
                // with the merged analyses (dual-write; hot patch above is retained
                // until Step 3 removes the hot fields). Status resets to active.
                await doUpsertResumeAnalysis(
                    ctx,
                    canonical._id,
                    mergedAnalysis.analysis,
                    mergedAnalysis.analyses && Object.keys(mergedAnalysis.analyses).length > 0
                        ? mergedAnalysis.analyses
                        : undefined,
                );
                patchedCanonicals += 1;

                for (const duplicate of duplicates) {
                    // Delete the duplicate's cold row so it does not orphan after
                    // the resume itself is deleted (its analyses were merged above).
                    const dupColdRow = await ctx.db
                        .query("resume_analyses")
                        .withIndex("by_resume", (q) => q.eq("resumeId", duplicate._id))
                        .first();
                    if (dupColdRow) {
                        await ctx.db.delete(dupColdRow._id);
                    }
                    await ctx.db.delete(duplicate._id);
                    deleted += 1;
                }
            }

            groups.push({
                identityKey: group.identityKey,
                canonicalId: String(canonical._id),
                duplicateIds: duplicates.map((resume) => String(resume._id)),
                duplicateCount: duplicates.length,
                mergedTagCount: mergedTags.length,
                mergedAnalysisCount: mergedAnalysis.analyses ? Object.keys(mergedAnalysis.analyses).length : 0,
            });
        }

        return {
            dryRun: args.dryRun,
            scannedResumes: resumes.page.length,
            duplicateGroupCount: duplicateGroups.length,
            processedGroupCount: targetGroups.length,
            patchedCanonicals,
            deleted,
            groups,
            hasMore: !resumes.isDone,
            cursor: resumes.isDone ? null : resumes.continueCursor,
        };
    },
});

export const backfillSourceKey = mutation({
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
        let updated = 0;

        for (const resume of resumes.page) {
            if (resume.sourceKey !== undefined) {
                continue;
            }

            const sourceKey = resolveDiagnosticsSourceKeyForResume(resume);
            await ctx.db.patch(resume._id, { sourceKey });
            updated += 1;
        }

        return {
            scannedResumes: resumes.page.length,
            updatedResumes: updated,
            hasMore: !resumes.isDone,
            cursor: resumes.isDone ? null : resumes.continueCursor,
        };
    },
});

/**
 * Backfill `ingestData.verifiedRoleYears` from existing `ingestData.roleSignals`.
 *
 * See plan: docs/superpowers/plans/2026-04-24-direct-role-years-precomputed-field-plan.md
 *
 * Idempotent: compares the computed map against the existing value and only
 * patches when the result differs.
 */
export const backfillVerifiedRoleYears = mutation({
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

        let updated = 0;
        for (const resume of resumes.page) {
            if (!resume.ingestData) continue;

            const computed = computeVerifiedRoleYears(resume.ingestData.roleSignals);
            const existing = resume.ingestData.verifiedRoleYears;

            if (shallowEqualNumberRecord(existing, computed)) continue;

            await ctx.db.patch(resume._id, {
                ingestData: {
                    ...resume.ingestData,
                    verifiedRoleYears: computed,
                },
            });
            updated += 1;
        }

        return {
            scannedResumes: resumes.page.length,
            updatedResumes: updated,
            hasMore: !resumes.isDone,
            cursor: resumes.isDone ? null : resumes.continueCursor,
        };
    },
});

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

export const validateDataConsistency = action({
    args: {
        batchSize: v.optional(v.number()),
        force: v.optional(v.boolean()),
    },
    handler: async (ctx, args) => {
        const batchSize = args.batchSize ?? 100;
        const force = args.force ?? false;

        // Step 1: Reindex searchText
        let reindexCursor: string | null = null;
        let reindexScanned = 0;
        let reindexUpdated = 0;
        for (let i = 0; i < 10000; i++) {
            const result: { scannedResumes: number; updatedResumes: number; hasMore: boolean; cursor: string | null } = await ctx.runMutation(api.migrations.reindexSearchText, {
                cursor: reindexCursor ?? undefined,
                batchSize,
                force: force || undefined,
            });
            reindexScanned += result.scannedResumes;
            reindexUpdated += result.updatedResumes;
            if (!result.hasMore) break;
            reindexCursor = result.cursor;
        }

        // Step 2: Backfill verifiedRoleYears
        let vryCursor: string | null = null;
        let vryScanned = 0;
        let vryUpdated = 0;
        for (let i = 0; i < 10000; i++) {
            const result: { scannedResumes: number; updatedResumes: number; hasMore: boolean; cursor: string | null } = await ctx.runMutation(api.migrations.backfillVerifiedRoleYears, {
                cursor: vryCursor ?? undefined,
                batchSize,
            });
            vryScanned += result.scannedResumes;
            vryUpdated += result.updatedResumes;
            if (!result.hasMore) break;
            vryCursor = result.cursor;
        }

        // Step 3: Rebuild resume_digests after all resume-derived fields settle.
        // The BFF AND-mode search path scans this hot table; restores from older
        // backups can have complete resumes but no digest rows.
        let digestCursor: string | null = null;
        let digestProcessed = 0;
        for (let i = 0; i < 10000; i++) {
            const result: BackfillResumeDigestsResult = await ctx.runMutation(api.resumes_search.backfillResumeDigests, {
                cursor: digestCursor ?? undefined,
                limit: batchSize,
            });
            digestProcessed += result.processed;
            if (result.isDone) break;
            digestCursor = result.cursor;
        }

        // Step 4: Backfill resume_digest_statuses overlay from candidate_status.
        // Restores from pre-Phase-2 backups have candidate_status but no overlay.
        // This step runs after Step 3 (digest rebuild) so resume_digests.by_identityKey
        // lookups resolve correctly.
        let statusCursor: string | null = null;
        let statusProcessed = 0;
        for (let i = 0; i < 10000; i++) {
            const result: { processed: number; isDone: boolean; cursor: string | null } = await ctx.runMutation(api.resumes_search.backfillResumeDigestStatuses, {
                cursor: statusCursor ?? undefined,
                limit: batchSize,
            });
            statusProcessed += result.processed;
            if (result.isDone) break;
            statusCursor = result.cursor;
        }

        // Step 5: Backfill resume_analyses cold table from resumes.analysis.
        // Moves the full analysis blob out of the hot resumes doc so list/search
        // hydration doesn't transfer 22KB of analysis data per row.
        let analysisCursor: string | null = null;
        let analysisProcessed = 0;
        for (let i = 0; i < 10000; i++) {
            const result: { processed: number; isDone: boolean; cursor: string | null } = await ctx.runMutation(api.resumes_search.backfillResumeAnalyses, {
                cursor: analysisCursor ?? undefined,
                limit: batchSize,
            });
            analysisProcessed += result.processed;
            if (result.isDone) break;
            analysisCursor = result.cursor;
        }

        return {
            reindexSearchText: { scanned: reindexScanned, updated: reindexUpdated },
            backfillVerifiedRoleYears: { scanned: vryScanned, updated: vryUpdated },
            backfillResumeDigests: { processed: digestProcessed },
            backfillResumeDigestStatuses: { processed: statusProcessed },
            backfillResumeAnalyses: { processed: analysisProcessed },
        };
    },
});

export const backfillSearchProfileTemplateHash = mutation({
    args: {
        cursor: v.optional(v.string()),
    },
    handler: async (ctx, args) => {
        const profiles = await ctx.db
            .query("search_profiles")
            .order("desc")
            .paginate({
                cursor: args.cursor ?? null,
                numItems: 100,
            });

        const templates = getWorkspaceSearchProfileTemplates("dev");
        const templateById = new Map(
            templates.map((t) => [t.profile.id, t]),
        );

        let updated = 0;
        for (const profile of profiles.page) {
            const profileData = isRecord(profile.profile) ? profile.profile : {};
            const existingHash = typeof profileData.templateHash === "string" ? profileData.templateHash : undefined;
            if (existingHash) {
                continue;
            }

            const profileId = profile.profileId ?? (typeof profileData.id === "string" ? profileData.id : "");
            const template = templateById.get(profileId);
            if (!template) {
                continue;
            }

            const seedSource = typeof profileData.seedSource === "string" ? profileData.seedSource : "";
            if (seedSource !== "config/search-profiles") {
                continue;
            }

            const currentHash = computeTemplateHash(template.profile);
            const merged = { ...profileData, templateHash: currentHash };
            await ctx.db.patch(profile._id, { profile: merged });
            updated += 1;
        }

        return {
            scanned: profiles.page.length,
            updated,
            hasMore: !profiles.isDone,
            cursor: profiles.isDone ? null : profiles.continueCursor,
        };
    },
});

/**
 * Remove stale `collectUrl` field from screening_sessions config objects.
 * The field was removed from the schema but some documents retained it,
 * blocking Convex schema validation on deploy.
 */
export const removeScreeningSessionCollectUrl = mutation({
    args: {},
    handler: async (ctx) => {
        const sessions = await ctx.db.query("screening_sessions").collect();
        let patched = 0;
        for (const session of sessions) {
            const config = session.config as Record<string, unknown>;
            if ("collectUrl" in config) {
                const { collectUrl: _, ...cleanConfig } = config;
                await ctx.db.replace(session._id, {
                    ...session,
                    _id: undefined as never,
                    _creationTime: undefined as never,
                    config: cleanConfig as typeof session.config,
                });
                patched++;
            }
        }
        return { patched, total: sessions.length };
    },
});

/**
 * Backfill `ingestData.market` on existing Seek resumes.
 * The `market` field was added for MY market scoring normalization —
 * Seek resumes need `market: "MY"` so runtime can apply the MY 40-floor / 50-hit rule.
 */
export const backfillMarketField = mutation({
    args: {
        cursor: v.optional(v.string()),
        batchSize: v.optional(v.number()),
    },
    handler: async (ctx, args) => {
        const resumes = await ctx.db
            .query("resumes")
            .withIndex("by_sourceKey", (q) => q.eq("sourceKey", "seek"))
            .order("desc")
            .paginate({
                cursor: args.cursor ?? null,
                numItems: resolveResumeScanBatchSize(args.batchSize),
            });
        let updated = 0;
        for (const resume of resumes.page) {
            if (resume.sourceKey !== "seek") continue;
            if (resume.ingestData?.market) continue;
            if (!resume.ingestData) continue; // skip resumes with no ingest data at all

            await ctx.db.patch(resume._id, {
                ingestData: {
                    ...resume.ingestData,
                    market: "MY",
                    // Legacy CN-normalized raw values should not survive onto MY rows.
                    ...(resume.ingestData.industryDbV2Raw ? { industryDbV2Raw: 0 } : {}),
                } as typeof resume.ingestData,
            });
            updated += 1;
        }

        return {
            scanned: resumes.page.length,
            updated,
            hasMore: !resumes.isDone,
            cursor: resumes.isDone ? null : resumes.continueCursor,
        };
    },
});

export const backfillSeekNameSearchUrls = mutation({
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
        let updatedResumes = 0;

        for (const resume of resumes.page) {
            const source = typeof resume.source === "string" ? resume.source : "";
            const isSeekSource = source.includes("seek");
            if (!isSeekSource) continue;

            const content = typeof resume.content === "object" && resume.content !== null ? resume.content as Record<string, unknown> : {};
            const profileUrl = typeof content.profileUrl === "string" ? content.profileUrl : "";

            // Skip if already name-search URL with roleTitles
            if (profileUrl.includes("/talentsearch/profiles/search") && profileUrl.includes("roleTitles=")) continue;

            const name = typeof content.name === "string" ? content.name.trim() : "";
            if (!name) continue;

            const market = inferSeekMarket(source);
            const jobIntention = typeof content.jobIntention === "string" ? content.jobIntention.trim() : "";
            const nameSearchUrl = buildSeekNameSearchUrl(name, market, jobIntention || undefined);
            if (!nameSearchUrl) continue;

            // Rebuild name-search URLs missing roleTitles, or convert UUID URLs
            const isNameSearchWithoutRoleTitles = profileUrl.includes("/talentsearch/profiles/search") && !profileUrl.includes("roleTitles=");
            const uuidMatch = profileUrl.match(/\/candidates\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})(?:\/|$)/i);
            if (!isNameSearchWithoutRoleTitles && !uuidMatch) continue;

            const updatedContent = { ...content, profileUrl: nameSearchUrl };
            const searchText = buildSearchText(updatedContent);
            await ctx.db.patch(resume._id, {
                content: updatedContent,
                searchText,
            });

            updatedResumes += 1;
        }

        return {
            scannedResumes: resumes.page.length,
            updatedResumes,
            hasMore: !resumes.isDone,
            cursor: resumes.isDone ? null : resumes.continueCursor,
        };
    },
});

/**
 * Backfill `resumes.analyses` to conform to the typed `analysisResultValidator`.
 *
 * The `analyses` field was originally `v.any()`. This migration normalizes each
 * entry so that every value has at minimum a `score: number` field. Entries that
 * already conform are left untouched. Non-conforming entries get `score: 0` as
 * a fallback.
 *
 * After this migration runs to completion (no more pages), the `v.any()` bridge
 * in the schema can be removed, leaving only the strict typed validator.
 */
export const backfillAnalysesValidator = mutation({
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

        let updated = 0;
        for (const resume of resumes.page) {
            if (!resume.analyses || typeof resume.analyses !== "object" || Array.isArray(resume.analyses)) {
                continue;
            }

            // Check if all entries already conform (have score:number)
            const entries = Object.entries(resume.analyses as Record<string, unknown>);
            const allConform = entries.every(([, val]) =>
                typeof val === "object" && val !== null && !Array.isArray(val) && typeof (val as Record<string, unknown>).score === "number",
            );
            if (allConform) continue;

            // Normalize non-conforming entries
            const normalized: Doc<"resumes">["analyses"] = {};
            for (const [key, val] of entries) {
                if (typeof val === "object" && val !== null && !Array.isArray(val) && typeof (val as Record<string, unknown>).score === "number") {
                    normalized[key] = val as Doc<"resumes">["analyses"] extends Record<string, infer V> | undefined ? V : never;
                } else if (typeof val === "object" && val !== null && !Array.isArray(val)) {
                    // Has structure but missing score — add score: 0
                    normalized[key] = { ...val, score: 0 } as Doc<"resumes">["analyses"] extends Record<string, infer V> | undefined ? V : never;
                } else {
                    // Completely malformed — minimal valid entry
                    normalized[key] = { score: 0 } as Doc<"resumes">["analyses"] extends Record<string, infer V> | undefined ? V : never;
                }
            }

            await ctx.db.patch(resume._id, { analyses: normalized });
            updated += 1;
        }

        return {
            scannedResumes: resumes.page.length,
            updatedResumes: updated,
            hasMore: !resumes.isDone,
            cursor: resumes.isDone ? null : resumes.continueCursor,
        };
    },
});

/**
 * Backfill actorId/actorRole on existing analysis_audit_log records.
 * Records created before the actor identity feature have no actor fields.
 * Mark them with actorId: "pre-tracking" and actorRole: "system" so that
 * every audit record has traceability (EU AI Act Art. 12).
 */
export const backfillAuditLogActorIdentity = mutation({
    args: {
        cursor: v.optional(v.string()),
    },
    handler: async (ctx, args) => {
        const logs = await ctx.db
            .query("analysis_audit_log")
            .order("desc")
            .paginate({
                cursor: args.cursor ?? null,
                numItems: 100,
            });

        let updated = 0;
        for (const log of logs.page) {
            if (log.actorId === undefined && log.actorRole === undefined) {
                await ctx.db.patch(log._id, {
                    actorId: "pre-tracking",
                    actorRole: "system",
                });
                updated += 1;
            }
        }

        return {
            scanned: logs.page.length,
            updated,
            hasMore: !logs.isDone,
            cursor: logs.isDone ? null : logs.continueCursor,
        };
    },
});

/**
 * Backfill resume_analyses.status for existing rows.
 *
 * Added by the Phase 3 completion bundle
 * (projects/trends/work/2026-06-15-resume-analyses-phase3-completion-cleanup).
 * Every existing row defaults to status: "active" so the soft-clear semantics
 * (clearAnalyses flips active → archived) start from a known state.
 *
 * Idempotent: rows already carrying status are skipped.
 */
export const backfillResumeAnalysesStatus = mutation({
    args: {
        cursor: v.optional(v.string()),
        batchSize: v.optional(v.number()),
    },
    handler: async (ctx, args) => {
        const rows = await ctx.db
            .query("resume_analyses")
            .order("desc")
            .paginate({
                cursor: args.cursor ?? null,
                numItems: resolveResumeScanBatchSize(args.batchSize),
            });

        let updated = 0;
        for (const row of rows.page) {
            if (row.status === undefined) {
                await ctx.db.patch(row._id, {
                    status: "active",
                });
                updated += 1;
            }
        }

        return {
            scanned: rows.page.length,
            updated,
            hasMore: !rows.isDone,
            cursor: rows.isDone ? null : rows.continueCursor,
        };
    },
});
