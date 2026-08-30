import { internal } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";
import { internalAction, internalMutation, internalQuery, mutation, query } from "./_generated/server";
import { v } from "convex/values";
import { api } from "./_generated/api";
import {
    getCurrentResumeAiPromptVersion,
    FALLBACK_INDUSTRY_KEYWORDS,
    isSystemWorkspace,
    type RelatedExpContextInput,
    type RelatedExpIngestEvidence,
} from "@trends/shared";
import {
    buildKeywordMatchingRules,
    buildKeywordRequirements,
    buildSystemPrompt,
    callLLM,
    type ChatMessage,
    getAiApiKey,
    getAiModel,
    getAiApiBase,
    getUserPromptTemplate,
    hydrateUserPrompt,
    inferSourceKey,
    normalizeAnalysisResult,
    normalizeResume,
    resolveAIOutputLocale,
} from "./analyze";
import { resolveAnalysisParallelism } from "./lib/parallelism";
import { computeProtectedAttributeHashes } from "./audit.js";
import {
    type AnalysisResult,
    isObject,
    parseLlmResult,
    extractKeywords,
    normalizeKeywords,
    buildKeywordAnalysisId,
    buildAnalysisDispatchJobKey,
    buildAnalysisDispatchIdempotencyKey,
} from "./lib/analysis_task_helpers.js";
import { relatedExpContextValidator } from "./validators.js";
import { getActiveColdAnalysisRow } from "./lib/resume_analysis_read.js";
import { belongsToWorkspace } from "./search_profiles.js";
import { DEFAULT_WORKSPACE_SLUG } from "./sessions";
import {
    createExactAnalysisIdentity,
    projectExactTaskAuditRow,
    resolveCompletedExactTaskAuditMetadata,
    resolveExactAnalysisIdentity,
    resolveExactTaskMetadata,
} from "./lib/exact_analysis_task.js";

// Backward-compatible re-exports
export type { AnalysisResult, AnalysisDispatchKeyInput } from "./lib/analysis_task_helpers.js";
export {
    isObject,
    toNumber,
    toStringArray,
    parseBreakdown,
    unwrapLlmResult,
    parseLlmResult,
    extractKeywords,
    normalizeKeywords,
    stableHash,
    buildAnalysisDispatchJobKey,
    buildAnalysisDispatchIdempotencyKey,
} from "./lib/analysis_task_helpers.js";

type AnalysisTaskStatus = "pending" | "processing" | "completed" | "failed" | "cancelled";
type AnalysisDispatchResult =
    | {
        queued: true;
        taskId: Id<"analysis_tasks">;
        dispatchedAt: number;
        reused: boolean;
        resumeIds?: Id<"resumes">[];
    }
    | { queued: false; reason: "maintenance" };

const MAX_EXACT_ANALYSIS_TARGETS = 500;
const ANALYSIS_TASK_LIST_LIMIT = 20;

function requireAnalysisWriteSecret(writeSecret: string | undefined): void {
    const expected = process.env.CONVEX_WRITE_SECRET;
    if (!expected || writeSecret !== expected) {
        throw new Error("Unauthorized Convex write");
    }
}

function requireAnalysisReadSecret(writeSecret: string | undefined): void {
    const expected = process.env.CONVEX_WRITE_SECRET;
    if (!expected || writeSecret !== expected) {
        throw new Error("Unauthorized Convex read");
    }
}

function requireNonblankWorkspaceSlug(workspaceSlug: string, message: string): string {
    const normalized = workspaceSlug.trim();
    if (!normalized) {
        throw new Error(message);
    }
    return normalized;
}

/**
 * Analysis task *records* are workspace-scoped; resume *bodies* are a global pool.
 * Eligible when:
 * - record matches the caller workspace (incl. default/dev unscoped rules), or
 * - resume is unscoped (shared corpus), or
 * - both caller and resume stamp are system teams (dev/hr operational corpus).
 * Personal-seat stamps stay isolated from each other and from system teams.
 */
function isResumeEligibleForAnalysis(
    recordWorkspaceSlug: string | undefined,
    callerWorkspaceSlug: string,
): boolean {
    if (belongsToWorkspace(recordWorkspaceSlug, callerWorkspaceSlug)) {
        return true;
    }
    const record = typeof recordWorkspaceSlug === "string" ? recordWorkspaceSlug.trim() : "";
    if (!record) {
        return true;
    }
    return isSystemWorkspace(record) && isSystemWorkspace(callerWorkspaceSlug);
}

function scopeAnalysisTaskKey(workspaceSlug: string, key: string): string {
    return `workspace:${workspaceSlug}:${key}`;
}

function projectAnalysisTaskForList(task: Doc<"analysis_tasks">) {
    const projected = { ...task };
    delete projected.targetResumeIds;
    delete projected.targetAnalysisIdentities;
    return projected;
}

function sortAnalysisTasksByRecencyDesc(tasks: Doc<"analysis_tasks">[]): Doc<"analysis_tasks">[] {
    return [...tasks].sort((left, right) => right._creationTime - left._creationTime);
}

async function queryAnalysisTasksByWorkspace(
    ctx: { db: { query: (table: "analysis_tasks") => any } },
    workspaceSlug: string | undefined,
    limit?: number,
): Promise<Doc<"analysis_tasks">[]> {
    let query = ctx.db
        .query("analysis_tasks")
        .withIndex("by_workspace", (q: any) => q.eq("workspaceSlug", workspaceSlug))
        .order("desc");
    if (limit === undefined) {
        return await query.collect();
    }
    return await query.take(limit);
}

async function loadWorkspaceAnalysisTasks(
    ctx: { db: { query: (table: "analysis_tasks") => any } },
    workspaceSlug: string,
    limit?: number,
): Promise<Doc<"analysis_tasks">[]> {
    if (workspaceSlug !== DEFAULT_WORKSPACE_SLUG) {
        return await queryAnalysisTasksByWorkspace(ctx, workspaceSlug, limit);
    }
    // Legacy unscoped records (missing workspaceSlug) are visible only to dev.
    const [explicit, legacy] = await Promise.all([
        queryAnalysisTasksByWorkspace(ctx, workspaceSlug, limit),
        queryAnalysisTasksByWorkspace(ctx, undefined, limit),
    ]);
    if (limit === undefined) {
        return [...explicit, ...legacy];
    }
    return sortAnalysisTasksByRecencyDesc([...explicit, ...legacy]).slice(0, limit);
}

export function resolveAnalysisWriteTimestamp(
    dispatchedAt: number | undefined,
    now = Date.now(),
): number {
    return dispatchedAt === undefined ? now : Math.max(now, dispatchedAt + 1);
}

export type RelatedExpNormalizeContextArg = {
    context: RelatedExpContextInput;
    ingestEvidence: RelatedExpIngestEvidence;
};

function hasRelatedExpContext(context: RelatedExpContextInput | undefined): context is RelatedExpContextInput {
    if (!context) {
        return false;
    }
    return (
        (typeof context.roleFilterType === "string" && context.roleFilterType.trim().length > 0)
        || (typeof context.minRoleYears === "number" && Number.isFinite(context.minRoleYears))
        || (typeof context.market === "string" && context.market.trim().length > 0)
        || (typeof context.locale === "string" && context.locale.trim().length > 0)
    );
}

function roleTypeMatches(signalType: unknown, roleFilterType: string | undefined): boolean {
    if (!roleFilterType || roleFilterType.trim().length === 0 || roleFilterType.trim().toLowerCase() === "any") {
        return true;
    }
    return typeof signalType === "string" && signalType.trim().toLowerCase() === roleFilterType.trim().toLowerCase();
}

function readFiniteNumber(value: unknown): number | undefined {
    return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function formatMatchedWorkEntry(entry: Record<string, unknown>): string | undefined {
    const jobTitle = typeof entry.jobTitle === "string" && entry.jobTitle.trim().length > 0
        ? entry.jobTitle.trim()
        : undefined;
    const companyName = typeof entry.companyName === "string" && entry.companyName.trim().length > 0
        ? entry.companyName.trim()
        : undefined;
    const years = readFiniteNumber(entry.years);

    if (!jobTitle && !companyName && years === undefined) {
        return undefined;
    }

    const titlePart = jobTitle ?? "role";
    const companyPart = companyName ? ` @ ${companyName}` : "";
    const yearsPart = years === undefined ? "" : ` (${years}y)`;
    return `${titlePart}${companyPart}${yearsPart}`;
}

const DOMAIN_IRRELEVANT_SALES_KEYWORDS = [
    "保险", "人寿", "金融", "投资", "证券", "银行", "理财",
    "房地产", "地产", "置业", "房产",
    "教育", "培训", "学校",
    "医疗", "医院", "医药",
    "insurance", "assurance", "takaful",
    "finance", "financial", "investment", "bank",
    "real estate", "property",
];

const MACHINERY_DOMAIN_KEYWORDS = FALLBACK_INDUSTRY_KEYWORDS.machinery.map((keyword) => keyword.toLowerCase());

function buildSalesEntryDomainText(
    signal: Record<string, unknown>,
    entries: Record<string, unknown>[],
): string {
    const signalMatchedSignals = Array.isArray(signal.matchedSignals)
        ? signal.matchedSignals.filter((value): value is string => typeof value === "string" && value.trim().length > 0)
        : [];
    const entryParts = entries.flatMap((entry) => {
        const parts: string[] = [];
        if (typeof entry.companyName === "string" && entry.companyName.trim().length > 0) {
            parts.push(entry.companyName.trim());
        }
        if (typeof entry.jobTitle === "string" && entry.jobTitle.trim().length > 0) {
            parts.push(entry.jobTitle.trim());
        }
        if (Array.isArray(entry.matchedSignals)) {
            parts.push(...entry.matchedSignals.filter((value): value is string => typeof value === "string" && value.trim().length > 0));
        }
        return parts;
    });

    return [...signalMatchedSignals, ...entryParts].join(" ").toLowerCase();
}

function isDomainIrrelevantSalesEntry(entry: Record<string, unknown>): boolean {
    const companyName = typeof entry.companyName === "string" ? entry.companyName.trim() : "";
    const jobTitle = typeof entry.jobTitle === "string" ? entry.jobTitle.trim() : "";
    const matchedSignals = Array.isArray(entry.matchedSignals)
        ? entry.matchedSignals.filter((value): value is string => typeof value === "string" && value.trim().length > 0).join(" ")
        : "";
    const text = `${companyName} ${jobTitle} ${matchedSignals}`.toLowerCase();

    return DOMAIN_IRRELEVANT_SALES_KEYWORDS.some((keyword) => text.includes(keyword));
}

function hasMachineryDomainText(text: string): boolean {
    return MACHINERY_DOMAIN_KEYWORDS.some((keyword) => text.includes(keyword));
}

export function buildRelatedExpCtxArg(
    resume: unknown,
    relatedExpContext: RelatedExpContextInput | undefined,
): RelatedExpNormalizeContextArg | undefined {
    if (!hasRelatedExpContext(relatedExpContext)) {
        return undefined;
    }

    const roleSignals = isObject(resume)
        && isObject(resume.ingestData)
        && Array.isArray(resume.ingestData.roleSignals)
        ? resume.ingestData.roleSignals
        : [];
    const matchingSignals = roleSignals
        .filter(isObject)
        .filter((signal) => roleTypeMatches(signal.type, relatedExpContext.roleFilterType));

    let directRoleMatch = false;
    let industryVerifiedRelevantYears = 0;
    const matchedWorkEntries: string[] = [];
    const salesRoleContext = relatedExpContext.roleFilterType?.trim().toLowerCase() === "sales";
    const myMarketContext = relatedExpContext.market?.trim().toUpperCase() === "MY";
    let domainRelevantUnverified = false;

    for (const signal of matchingSignals) {
        const signalYears = readFiniteNumber(signal.industryVerifiedRelevantYears);
        if (signalYears !== undefined) {
            industryVerifiedRelevantYears = Math.max(industryVerifiedRelevantYears, Math.max(0, signalYears));
        }

        if (!Array.isArray(signal.matchedWorkEntries)) {
            continue;
        }

        const rawEntries = signal.matchedWorkEntries.filter(isObject);
        for (const rawEntry of signal.matchedWorkEntries) {
            if (!isObject(rawEntry)) {
                continue;
            }
            directRoleMatch = directRoleMatch || rawEntry.directRoleMatch === true;
            const formatted = formatMatchedWorkEntry(rawEntry);
            if (formatted) {
                matchedWorkEntries.push(formatted);
            }
        }

        if (!salesRoleContext || !myMarketContext || industryVerifiedRelevantYears > 0) {
            continue;
        }

        const hasDirectSalesEntry = rawEntries.some((entry) => entry.directRoleMatch === true);
        const hasDomainIrrelevantEntry = rawEntries.some((entry) => isDomainIrrelevantSalesEntry(entry));
        const salesEntryText = buildSalesEntryDomainText(signal, rawEntries);
        const hasMachineryEvidence = hasMachineryDomainText(salesEntryText);

        domainRelevantUnverified = domainRelevantUnverified || (
            hasDirectSalesEntry
            && hasMachineryEvidence
            && !hasDomainIrrelevantEntry
        );
    }

    return {
        context: relatedExpContext,
        ingestEvidence: {
            directRoleMatch,
            industryVerifiedRelevantYears,
            matchedWorkEntries,
            ...(salesRoleContext && myMarketContext ? { domainRelevantUnverified } : {}),
        },
    };
}

function hasRelatedExpContextEvidence(
    resume: Record<string, unknown>,
    relatedExpContext: RelatedExpContextInput,
): boolean {
    const relatedExpArg = buildRelatedExpCtxArg(resume, relatedExpContext);
    if (!relatedExpArg) {
        return false;
    }

    const evidence = relatedExpArg.ingestEvidence;
    const directRoleMatch = evidence.directRoleMatch === true;
    const industryVerifiedRelevantYears = evidence.industryVerifiedRelevantYears ?? 0;
    const matchedWorkEntries = evidence.matchedWorkEntries ?? [];

    return directRoleMatch
        || industryVerifiedRelevantYears > 0
        || matchedWorkEntries.length > 0;
}

export function classifyResumes<T extends Record<string, unknown>>(
    resumes: T[],
    keywords: string[],
    relatedExpContext?: RelatedExpContextInput,
    dispatchMode?: "search" | "exact",
): { toAnalyze: T[]; toSkip: T[] } {
    if (dispatchMode === "exact") {
        return { toAnalyze: resumes, toSkip: [] };
    }
    if (keywords.length === 0) {
        return { toAnalyze: resumes, toSkip: [] };
    }

    const toAnalyze: T[] = [];
    const toSkip: T[] = [];
    const threshold = 10;

    for (const resume of resumes) {
        const serialized = JSON.stringify(resume).toLowerCase();
        let matches = 0;
        for (const keyword of keywords) {
            if (serialized.includes(keyword)) {
                matches += 1;
            }
        }

        const score = Math.min(100, Math.round((matches / Math.max(keywords.length, 1)) * 100));
        if (score < threshold && !(relatedExpContext && hasRelatedExpContextEvidence(resume, relatedExpContext))) {
            toSkip.push(resume);
            continue;
        }
        toAnalyze.push(resume);
    }

    return { toAnalyze, toSkip };
}

async function analyzeOneResume(
    resume: Doc<"resumes">,
    config: {
        jobDescriptionId?: string;
        jobDescriptionTitle?: string;
        jobDescriptionContent?: string;
        keywords?: string[];
        location?: string;
        relatedExpContext?: RelatedExpContextInput;
        workHistoryLimit: number;
    },
    apiKey: string,
    localeOverride?: string,
): Promise<AnalysisResult> {
    const normalizedKeywords = normalizeKeywords(config.keywords ?? []);
    const useKeywordPath = normalizedKeywords.length > 0 && !config.jobDescriptionContent;
    const locale = localeOverride ?? resolveAIOutputLocale({ sourceKey: inferSourceKey(resume.source) });
    const isEnglishLocale = locale === "en";

    const jobTitle = config.jobDescriptionTitle
        || config.jobDescriptionId
        || (useKeywordPath ? normalizedKeywords.join(", ") : (isEnglishLocale ? "Sales Manager (Generic)" : "销售经理 (通用)"));
    const requirements = useKeywordPath
        ? buildKeywordRequirements(normalizedKeywords, locale)
        : (config.jobDescriptionContent || (isEnglishLocale
            ? "Sales experience, strong communication, and machine-tool industry familiarity preferred."
            : "具备销售经验，沟通能力强，熟悉机床行业优先。"));
    const matchingRules = useKeywordPath
        ? buildKeywordMatchingRules(normalizedKeywords, locale)
        : (isEnglishLocale ? "Use the default scoring rules." : "使用默认评分标准");
    const normalizedResume = normalizeResume(resume, {
        locale,
        workHistoryLimit: config.workHistoryLimit,
    });
    const relatedExpContext = hasRelatedExpContext(config.relatedExpContext)
        ? {
            ...config.relatedExpContext,
            locale: config.relatedExpContext.locale ?? locale,
        }
        : undefined;

    const prompt = hydrateUserPrompt(
        getUserPromptTemplate(locale),
        { title: jobTitle, requirements, matchingRules },
        normalizedResume,
        locale,
    );

    const messages: ChatMessage[] = [
        { role: "system", content: buildSystemPrompt(locale) },
        { role: "user", content: prompt },
    ];

    const maxAttempts = 2;
    let lastError: unknown;
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
        try {
            const rawResult = await callLLM(messages, apiKey);
            const parsedResult = parseLlmResult(rawResult);
            const normalizedResult = normalizeAnalysisResult(
                parsedResult,
                resume,
                buildRelatedExpCtxArg(resume, relatedExpContext),
            );
            return {
                ...normalizedResult,
                locale,
            };
        } catch (error) {
            lastError = error;
            if (attempt < maxAttempts) {
                console.warn(`analyzeOneResume attempt ${attempt} failed, retrying:`, error instanceof Error ? error.message : error);
            }
        }
    }
    throw lastError;
}

export const list = query({
    args: {
        workspaceSlug: v.string(),
        writeSecret: v.optional(v.string()),
    },
    handler: async (ctx, args) => {
        requireAnalysisReadSecret(args.writeSecret);
        const workspaceSlug = requireNonblankWorkspaceSlug(
            args.workspaceSlug,
            "Analysis task list requires a workspaceSlug",
        );

        const tasks = await loadWorkspaceAnalysisTasks(ctx, workspaceSlug, ANALYSIS_TASK_LIST_LIMIT);
        return tasks.map(projectAnalysisTaskForList);
    },
});

/**
 * Count analysis_tasks currently in "processing" status.
 * Used by the restore quiesce helper to detect drain completion.
 */
export const countProcessing = query({
    args: {
        writeSecret: v.optional(v.string()),
    },
    handler: async (ctx, args) => {
        requireAnalysisReadSecret(args.writeSecret);
        const processing = await ctx.db
            .query("analysis_tasks")
            .withIndex("by_status", (q) => q.eq("status", "processing"))
            .collect();
        return processing.length;
    },
});

export const getSummary = query({
    args: {
        workspaceSlug: v.string(),
        writeSecret: v.optional(v.string()),
    },
    handler: async (ctx, args) => {
        requireAnalysisReadSecret(args.writeSecret);
        const workspaceSlug = requireNonblankWorkspaceSlug(
            args.workspaceSlug,
            "Analysis task summary requires a workspaceSlug",
        );

        const counts = {
            total: 0,
            pending: 0,
            processing: 0,
            completed: 0,
            failed: 0,
            cancelled: 0,
        };
        const tasks = await loadWorkspaceAnalysisTasks(ctx, workspaceSlug);
        for (const task of tasks) {
            counts.total += 1;
            counts[task.status] += 1;
        }
        return counts;
    },
});

export const dispatch = mutation({
    args: {
        workspaceSlug: v.string(),
        writeSecret: v.optional(v.string()),
        jobDescriptionId: v.optional(v.string()),
        jobDescriptionTitle: v.optional(v.string()),
        jobDescriptionContent: v.optional(v.string()),
        keywords: v.optional(v.array(v.string())),
        location: v.optional(v.string()),
        promptVersion: v.optional(v.number()),
        sample: v.optional(v.string()),
        resumeIds: v.array(v.id("resumes")),
        /** P1: context for evidence ceiling evaluator — optional for backward compat */
        relatedExpContext: v.optional(relatedExpContextValidator),
    },
    handler: async (ctx, args): Promise<AnalysisDispatchResult> => {
        requireAnalysisWriteSecret(args.writeSecret);
        const workspaceSlug = requireNonblankWorkspaceSlug(
            args.workspaceSlug,
            "Analysis dispatch requires a workspaceSlug",
        );
        // Refuse to queue new tasks during maintenance mode (restore quiesce)
        if (await ctx.runQuery(internal.system_settings.isMaintenanceModeInternal, {})) {
            return { queued: false, reason: "maintenance" };
        }

        const normalizedKeywords = normalizeKeywords(args.keywords ?? []);
        const normalizedLocation = args.location?.trim() || undefined;
        const promptVersion = args.promptVersion ?? getCurrentResumeAiPromptVersion();
        if (!args.jobDescriptionContent && normalizedKeywords.length === 0) {
            throw new Error("Either jobDescriptionContent or keywords is required for analysis.");
        }
        const uniqueResumeIdMap = new Map<string, (typeof args.resumeIds)[number]>();
        for (const resumeId of args.resumeIds) {
            uniqueResumeIdMap.set(String(resumeId), resumeId);
        }
        const uniqueResumeIds = Array.from(uniqueResumeIdMap.values());
        const resumes = await Promise.all(uniqueResumeIds.map((resumeId) => ctx.db.get(resumeId)));
        for (let index = 0; index < uniqueResumeIds.length; index += 1) {
            const resumeId = uniqueResumeIds[index];
            const resume = resumes[index];
            if (!resume) {
                throw new Error(`Analysis resume ${String(resumeId)} no longer exists`);
            }
            if (!isResumeEligibleForAnalysis(resume.workspaceSlug, workspaceSlug)) {
                throw new Error(
                    `Analysis resume ${String(resumeId)} belongs to workspace ${resume.workspaceSlug ?? "dev"}, not ${workspaceSlug}`,
                );
            }
        }
        const derivedJobDescriptionId = args.jobDescriptionId
            || (normalizedKeywords.length > 0
                ? buildKeywordAnalysisId(normalizedKeywords, {
                    location: normalizedLocation,
                    promptVersion,
                })
                : undefined);
        const jobKey = scopeAnalysisTaskKey(workspaceSlug, buildAnalysisDispatchJobKey({
            derivedJobDescriptionId,
            jobDescriptionTitle: args.jobDescriptionTitle,
            jobDescriptionContent: args.jobDescriptionContent,
            keywords: normalizedKeywords,
            location: normalizedLocation,
            promptVersion,
            relatedExpContext: args.relatedExpContext,
            resumeIds: uniqueResumeIds.map((resumeId) => String(resumeId)),
        }));
        const idempotencyKey = scopeAnalysisTaskKey(workspaceSlug, buildAnalysisDispatchIdempotencyKey({
            derivedJobDescriptionId,
            jobDescriptionTitle: args.jobDescriptionTitle,
            jobDescriptionContent: args.jobDescriptionContent,
            keywords: normalizedKeywords,
            location: normalizedLocation,
            promptVersion,
            relatedExpContext: args.relatedExpContext,
            resumeIds: uniqueResumeIds.map((resumeId) => String(resumeId)),
        }));

        const existingProcessingTask = await ctx.db
            .query("analysis_tasks")
            .withIndex("by_idempotency_status", (q) =>
                q.eq("idempotencyKey", idempotencyKey).eq("status", "processing")
            )
            .first();
        if (existingProcessingTask) {
            return {
                queued: true,
                taskId: existingProcessingTask._id,
                dispatchedAt: existingProcessingTask.dispatchedAt ?? existingProcessingTask._creationTime,
                reused: true,
            };
        }

        const existingPendingTask = await ctx.db
            .query("analysis_tasks")
            .withIndex("by_idempotency_status", (q) =>
                q.eq("idempotencyKey", idempotencyKey).eq("status", "pending")
            )
            .first();
        if (existingPendingTask) {
            return {
                queued: true,
                taskId: existingPendingTask._id,
                dispatchedAt: existingPendingTask.dispatchedAt ?? existingPendingTask._creationTime,
                reused: true,
            };
        }

        const existingProcessingTaskByJobKey = await ctx.db
            .query("analysis_tasks")
            .withIndex("by_job_key_status", (q) =>
                q.eq("jobKey", jobKey).eq("status", "processing")
            )
            .first();
        if (existingProcessingTaskByJobKey) {
            return {
                queued: true,
                taskId: existingProcessingTaskByJobKey._id,
                dispatchedAt: existingProcessingTaskByJobKey.dispatchedAt ?? existingProcessingTaskByJobKey._creationTime,
                reused: true,
            };
        }

        const existingPendingTaskByJobKey = await ctx.db
            .query("analysis_tasks")
            .withIndex("by_job_key_status", (q) =>
                q.eq("jobKey", jobKey).eq("status", "pending")
            )
            .first();
        if (existingPendingTaskByJobKey) {
            return {
                queued: true,
                taskId: existingPendingTaskByJobKey._id,
                dispatchedAt: existingPendingTaskByJobKey.dispatchedAt ?? existingPendingTaskByJobKey._creationTime,
                reused: true,
            };
        }

        const dispatchedAt = Date.now();
        const taskId = await ctx.db.insert("analysis_tasks", {
            idempotencyKey,
            jobKey,
            dispatchMode: "search",
            workspaceSlug,
            dispatchedAt,
            config: {
                jobDescriptionId: derivedJobDescriptionId,
                jobDescriptionTitle: args.jobDescriptionTitle,
                jobDescriptionContent: args.jobDescriptionContent,
                keywords: normalizedKeywords.length > 0 ? normalizedKeywords : undefined,
                location: normalizedLocation,
                promptVersion,
                sample: args.sample,
                resumeCount: uniqueResumeIds.length,
                ...(args.relatedExpContext ? { relatedExpContext: args.relatedExpContext } : {}),
            },
            status: "pending",
            progress: {
                current: 0,
                total: uniqueResumeIds.length,
                skipped: 0,
            },
        });

        await ctx.scheduler.runAfter(0, internal.analysis_tasks.processAnalysisTask, {
            taskId,
            resumeIds: uniqueResumeIds,
        });

        return { queued: true, taskId, dispatchedAt, reused: false };
    },
});

export const dispatchExact = mutation({
    args: {
        workspaceSlug: v.string(),
        writeSecret: v.optional(v.string()),
        jobDescriptionId: v.optional(v.string()),
        jobDescriptionTitle: v.optional(v.string()),
        jobDescriptionContent: v.optional(v.string()),
        keywords: v.optional(v.array(v.string())),
        location: v.optional(v.string()),
        promptVersion: v.optional(v.number()),
        resumeIds: v.array(v.id("resumes")),
        relatedExpContext: v.optional(relatedExpContextValidator),
    },
    handler: async (ctx, args): Promise<AnalysisDispatchResult> => {
        requireAnalysisWriteSecret(args.writeSecret);
        const workspaceSlug = requireNonblankWorkspaceSlug(
            args.workspaceSlug,
            "Exact analysis requires a workspaceSlug",
        );
        if (args.resumeIds.length === 0) {
            throw new Error("Exact analysis requires at least one resume ID");
        }
        if (args.resumeIds.length > MAX_EXACT_ANALYSIS_TARGETS) {
            throw new Error(`Exact analysis supports at most ${MAX_EXACT_ANALYSIS_TARGETS} resume IDs`);
        }

        const uniqueResumeIdMap = new Map<string, (typeof args.resumeIds)[number]>();
        for (const resumeId of args.resumeIds) {
            const key = String(resumeId);
            if (!uniqueResumeIdMap.has(key)) {
                uniqueResumeIdMap.set(key, resumeId);
            }
        }
        const uniqueResumeIds = Array.from(uniqueResumeIdMap.values());
        const resumes = await Promise.all(uniqueResumeIds.map((resumeId) => ctx.db.get(resumeId)));
        for (let index = 0; index < uniqueResumeIds.length; index += 1) {
            const resumeId = uniqueResumeIds[index];
            const resume = resumes[index];
            if (!resume) {
                throw new Error(`Exact analysis resume ${String(resumeId)} no longer exists`);
            }
            if (resume.isArchived === true) {
                throw new Error(`Exact analysis resume ${String(resumeId)} is archived`);
            }
            if (!isResumeEligibleForAnalysis(resume.workspaceSlug, workspaceSlug)) {
                throw new Error(
                    `Exact analysis resume ${String(resumeId)} belongs to workspace ${resume.workspaceSlug ?? "dev"}, not ${workspaceSlug}`,
                );
            }
        }

        const normalizedKeywords = normalizeKeywords(args.keywords ?? []);
        const normalizedLocation = args.location?.trim() || undefined;
        const promptVersion = args.promptVersion ?? getCurrentResumeAiPromptVersion();
        if (!args.jobDescriptionContent && normalizedKeywords.length === 0) {
            throw new Error("Either jobDescriptionContent or keywords is required for analysis.");
        }
        const derivedJobDescriptionId = args.jobDescriptionId
            || (normalizedKeywords.length > 0
                ? buildKeywordAnalysisId(normalizedKeywords, {
                    location: normalizedLocation,
                    promptVersion,
                })
                : undefined);
        if (!derivedJobDescriptionId) {
            throw new Error("Exact analysis could not derive an analysis ID");
        }
        const dispatchKeyInput = {
            derivedJobDescriptionId,
            jobDescriptionTitle: args.jobDescriptionTitle,
            jobDescriptionContent: args.jobDescriptionContent,
            keywords: normalizedKeywords,
            location: normalizedLocation,
            promptVersion,
            relatedExpContext: args.relatedExpContext,
            resumeIds: uniqueResumeIds.map(String),
        };
        const jobKey = `exact:${buildAnalysisDispatchJobKey(dispatchKeyInput)}`;
        const idempotencyKey = `exact:${buildAnalysisDispatchIdempotencyKey(dispatchKeyInput)}`;

        if (await ctx.runQuery(internal.system_settings.isMaintenanceModeInternal, {})) {
            return { queued: false, reason: "maintenance" };
        }

        for (const status of ["processing", "pending"] as const) {
            const existingTask = await ctx.db
                .query("analysis_tasks")
                .withIndex("by_idempotency_status", (q) =>
                    q.eq("idempotencyKey", idempotencyKey).eq("status", status)
                )
                .first();
            if (existingTask) {
                const existingMetadata = resolveExactTaskMetadata(existingTask, workspaceSlug);
                return {
                    queued: true,
                    taskId: existingTask._id,
                    dispatchedAt: existingTask.dispatchedAt ?? existingTask._creationTime,
                    reused: true,
                    resumeIds: existingMetadata.targetResumeIds,
                };
            }
        }

        const targetAnalysisIdentities = resumes.map((resume, index) => {
            if (!resume) {
                throw new Error(`Exact analysis resume ${String(uniqueResumeIds[index])} no longer exists`);
            }
            return createExactAnalysisIdentity(derivedJobDescriptionId, resume);
        });

        const dispatchedAt = Date.now();
        const taskId = await ctx.db.insert("analysis_tasks", {
            idempotencyKey,
            jobKey,
            dispatchMode: "exact",
            workspaceSlug,
            targetResumeIds: uniqueResumeIds,
            targetAnalysisIdentities,
            dispatchedAt,
            config: {
                jobDescriptionId: derivedJobDescriptionId,
                jobDescriptionTitle: args.jobDescriptionTitle,
                jobDescriptionContent: args.jobDescriptionContent,
                keywords: normalizedKeywords.length > 0 ? normalizedKeywords : undefined,
                location: normalizedLocation,
                promptVersion,
                resumeCount: uniqueResumeIds.length,
                ...(args.relatedExpContext ? { relatedExpContext: args.relatedExpContext } : {}),
            },
            status: "pending",
            progress: {
                current: 0,
                total: uniqueResumeIds.length,
                skipped: 0,
            },
        });

        await ctx.scheduler.runAfter(0, internal.analysis_tasks.processAnalysisTask, {
            taskId,
            resumeIds: uniqueResumeIds,
        });

        return {
            queued: true,
            taskId,
            dispatchedAt,
            reused: false,
            resumeIds: uniqueResumeIds,
        };
    },
});

export const cancel = mutation({
    args: {
        taskId: v.id("analysis_tasks"),
        workspaceSlug: v.string(),
        writeSecret: v.optional(v.string()),
    },
    handler: async (ctx, args) => {
        requireAnalysisWriteSecret(args.writeSecret);
        const workspaceSlug = requireNonblankWorkspaceSlug(
            args.workspaceSlug,
            "Analysis task cancellation requires a workspaceSlug",
        );
        const task = await ctx.db.get(args.taskId);
        if (!task
            || !belongsToWorkspace(task.workspaceSlug, workspaceSlug)
            || (task.status !== "pending" && task.status !== "processing")) {
            return null;
        }

        await ctx.db.patch(args.taskId, {
            status: "cancelled",
            completedAt: Date.now(),
        });
        return null;
    },
});

export const getTask = internalQuery({
    args: {
        taskId: v.id("analysis_tasks"),
    },
    handler: async (ctx, args) => {
        return await ctx.db.get(args.taskId);
    },
});

type ExactAnalysisTargetState = "ready" | "pending" | "invalid";

type ExactAnalysisTargetStatus = {
    currentResumeId: string;
    state: ExactAnalysisTargetState;
    expectedAnalysisKey: string;
    expectedJobDescriptionId: string;
    expectedPromptVersion: number;
    actualJobDescriptionId?: string;
    actualPromptVersion?: number;
    analyzedAt?: number;
    reasons: string[];
};

export const getExactStatus = query({
    args: {
        taskId: v.id("analysis_tasks"),
        workspaceSlug: v.string(),
        writeSecret: v.optional(v.string()),
    },
    handler: async (ctx, args): Promise<{
        task: Doc<"analysis_tasks">;
        verification: {
            allReady: boolean;
            ready: number;
            pending: number;
            invalid: number;
            checkedAt: number;
            dispatchedAt: number;
            targets: ExactAnalysisTargetStatus[];
        };
    } | null> => {
        requireAnalysisReadSecret(args.writeSecret);
        const workspaceSlug = requireNonblankWorkspaceSlug(
            args.workspaceSlug,
            "Exact analysis status requires a workspaceSlug",
        );
        const task = await ctx.db.get(args.taskId);
        if (!task) {
            return null;
        }
        const metadata = resolveExactTaskMetadata(task, workspaceSlug);
        const {
            targetResumeIds,
            expectedJobDescriptionId,
            expectedPromptVersion,
            dispatchedAt,
        } = metadata;

        const targets: ExactAnalysisTargetStatus[] = [];
        let ready = 0;
        let pending = 0;
        let invalid = 0;

        for (const resumeId of targetResumeIds) {
            const resume = await ctx.db.get(resumeId);
            const { expectedAnalysisKey } = resolveExactAnalysisIdentity(metadata, resumeId);
            const base = {
                currentResumeId: String(resumeId),
                expectedAnalysisKey,
                expectedJobDescriptionId,
                expectedPromptVersion,
            };
            if (task.status === "pending" || task.status === "processing") {
                pending += 1;
                targets.push({
                    ...base,
                    state: "pending",
                    reasons: [`task_${task.status}`],
                });
                continue;
            }
            if (task.status === "failed" || task.status === "cancelled") {
                invalid += 1;
                targets.push({
                    ...base,
                    state: "invalid",
                    reasons: [`task_${task.status}`],
                });
                continue;
            }
            if (!resume) {
                invalid += 1;
                targets.push({ ...base, state: "invalid", reasons: ["resume_missing"] });
                continue;
            }
            if (resume.isArchived === true) {
                invalid += 1;
                targets.push({ ...base, state: "invalid", reasons: ["resume_archived"] });
                continue;
            }
            if (!isResumeEligibleForAnalysis(resume.workspaceSlug, workspaceSlug)) {
                invalid += 1;
                targets.push({ ...base, state: "invalid", reasons: ["workspace_mismatch"] });
                continue;
            }

            const coldRow = await getActiveColdAnalysisRow(ctx, resumeId);
            if (!coldRow) {
                invalid += 1;
                targets.push({ ...base, state: "invalid", reasons: ["analysis_cold_row_missing"] });
                continue;
            }
            const analyses = coldRow.analyses;
            if (!analyses || Object.keys(analyses).length === 0) {
                invalid += 1;
                targets.push({ ...base, state: "invalid", reasons: ["analysis_missing"] });
                continue;
            }
            const analysis = analyses[expectedAnalysisKey];
            if (!analysis) {
                invalid += 1;
                targets.push({ ...base, state: "invalid", reasons: ["analysis_key_mismatch"] });
                continue;
            }

            const reasons: string[] = [];
            if (analysis.jobDescriptionId !== expectedJobDescriptionId) {
                reasons.push("analysis_job_description_mismatch");
            }
            if (analysis.promptVersion !== expectedPromptVersion) {
                reasons.push("analysis_prompt_version_mismatch");
            }
            if (analysis.analyzedAt === undefined) {
                reasons.push("analysis_timestamp_missing");
            } else if (analysis.analyzedAt <= dispatchedAt) {
                reasons.push("analysis_not_newer_than_dispatch");
            }

            const actual = {
                ...(analysis.jobDescriptionId ? { actualJobDescriptionId: analysis.jobDescriptionId } : {}),
                ...(analysis.promptVersion !== undefined ? { actualPromptVersion: analysis.promptVersion } : {}),
                ...(analysis.analyzedAt !== undefined ? { analyzedAt: analysis.analyzedAt } : {}),
            };
            if (reasons.length > 0) {
                invalid += 1;
                targets.push({ ...base, ...actual, state: "invalid", reasons });
                continue;
            }

            ready += 1;
            targets.push({ ...base, ...actual, state: "ready", reasons: [] });
        }

        return {
            task,
            verification: {
                allReady: task.status === "completed"
                    && ready === targets.length
                    && pending === 0
                    && invalid === 0,
                ready,
                pending,
                invalid,
                checkedAt: Date.now(),
                dispatchedAt,
                targets,
            },
        };
    },
});

const MAX_EXACT_AUDIT_EXPORT_PAGE_SIZE = 200;

export const getExactAuditExportPage = query({
    args: {
        taskId: v.id("analysis_tasks"),
        workspaceSlug: v.string(),
        writeSecret: v.optional(v.string()),
        cursor: v.optional(v.string()),
        limit: v.number(),
    },
    handler: async (ctx, args) => {
        requireAnalysisReadSecret(args.writeSecret);
        const workspaceSlug = requireNonblankWorkspaceSlug(
            args.workspaceSlug,
            "Exact task audit export requires a workspaceSlug",
        );
        if (args.cursor !== undefined
            && (args.cursor.trim().length === 0 || args.cursor.length > 4_096)) {
            throw new Error("Exact task audit export cursor is invalid");
        }
        if (!Number.isInteger(args.limit)
            || args.limit < 1
            || args.limit > MAX_EXACT_AUDIT_EXPORT_PAGE_SIZE) {
            throw new Error(
                `Exact task audit export limit must be an integer between 1 and ${MAX_EXACT_AUDIT_EXPORT_PAGE_SIZE}`,
            );
        }

        const task = await ctx.db.get(args.taskId);
        if (!task) {
            return null;
        }
        const metadata = resolveCompletedExactTaskAuditMetadata(task, workspaceSlug);
        const paginated = await ctx.db
            .query("resumes")
            .paginate({
                cursor: args.cursor ?? null,
                numItems: args.limit,
            });
        const activeWorkspaceResumes = paginated.page.filter((resume) => (
            resume.isArchived !== true
            && isResumeEligibleForAnalysis(resume.workspaceSlug, workspaceSlug)
        ));
        const rows = await Promise.all(activeWorkspaceResumes.map((resume) => (
            projectExactTaskAuditRow(ctx, resume, metadata)
        )));

        return {
            task: {
                taskId: metadata.taskId,
                status: metadata.status,
                dispatchMode: metadata.dispatchMode,
                workspaceSlug: metadata.workspaceSlug,
                dispatchedAt: metadata.dispatchedAt,
                completedAt: metadata.completedAt,
                expectedJobDescriptionId: metadata.expectedJobDescriptionId,
                expectedPromptVersion: metadata.expectedPromptVersion,
                targetCount: metadata.targetCount,
            },
            counts: {
                scanned: paginated.page.length,
                exported: rows.length,
                targeted: rows.filter((row) => row.exactCohortMember).length,
                ready: rows.filter((row) => row.analysisState === "ready").length,
            },
            page: rows,
            continueCursor: paginated.continueCursor,
            isDone: paginated.isDone,
        };
    },
});

export const markProcessing = internalMutation({
    args: {
        taskId: v.id("analysis_tasks"),
    },
    handler: async (ctx, args) => {
        const task = await ctx.db.get(args.taskId);
        if (!task) {
            return null;
        }

        if (task.status === "cancelled") {
            return { status: "cancelled" as const };
        }

        await ctx.db.patch(args.taskId, {
            status: "processing",
            startedAt: Date.now(),
            completedAt: undefined,
            error: undefined,
        });

        return { status: "processing" as const };
    },
});

export const updateProgress = internalMutation({
    args: {
        taskId: v.id("analysis_tasks"),
        current: v.number(),
        skipped: v.number(),
        lastStatus: v.optional(v.string()),
    },
    handler: async (ctx, args) => {
        const task = await ctx.db.get(args.taskId);
        if (!task) {
            return null;
        }

        if (task.status === "cancelled") {
            return { status: "cancelled" as const };
        }

        const nextCurrent = Math.max(task.progress.current, args.current);
        const nextSkipped = Math.max(task.progress.skipped ?? 0, args.skipped);

        await ctx.db.patch(args.taskId, {
            progress: {
                current: nextCurrent,
                total: task.progress.total,
                skipped: nextSkipped,
            },
            lastStatus: args.lastStatus,
        });

        return { status: task.status };
    },
});

export const complete = internalMutation({
    args: {
        taskId: v.id("analysis_tasks"),
        status: v.union(v.literal("completed"), v.literal("failed"), v.literal("cancelled")),
        error: v.optional(v.string()),
        results: v.optional(v.object({
            analyzed: v.number(),
            skipped: v.number(),
            failed: v.number(),
            avgScore: v.number(),
            highScoreCount: v.number(),
        })),
    },
    handler: async (ctx, args) => {
        const task = await ctx.db.get(args.taskId);
        if (!task) {
            return;
        }

        const nextStatus: AnalysisTaskStatus =
            task.status === "cancelled" && args.status !== "cancelled"
                ? "cancelled"
                : args.status;

        await ctx.db.patch(args.taskId, {
            status: nextStatus,
            error: args.error,
            results: args.results,
            completedAt: Date.now(),
            lastStatus: nextStatus === "completed" ? "Completed" : task.lastStatus,
        });
    },
});

export const processAnalysisTask = internalAction({
    args: {
        taskId: v.id("analysis_tasks"),
        resumeIds: v.array(v.id("resumes")),
    },
    handler: async (ctx, args) => {
        // Defer during maintenance mode — re-schedule for 60s later with the same args.
        // Prevents in-flight analysis jobs from mutating resumes mid-restore.
        if (await ctx.runQuery(internal.system_settings.isMaintenanceModeInternal, {})) {
            await ctx.scheduler.runAfter(60, internal.analysis_tasks.processAnalysisTask, args);
            return { status: "deferred" as const };
        }

        let analyzedCount = 0;
        let failedCount = 0;
        let highScoreCount = 0;
        let skippedCount = 0;
        let scoreSum = 0;
        let cancelled = false;

        try {
            const apiKey = getAiApiKey();
            if (!apiKey) {
                throw new Error("AI_API_KEY/OPENAI_API_KEY is not set in Convex environment variables.");
            }

            const markResult = await ctx.runMutation(internal.analysis_tasks.markProcessing, {
                taskId: args.taskId,
            });

            if (!markResult) {
                throw new Error(`Analysis task not found: ${String(args.taskId)}`);
            }

            if (markResult.status === "cancelled") {
                await ctx.runMutation(internal.analysis_tasks.complete, {
                    taskId: args.taskId,
                    status: "cancelled",
                    results: {
                        analyzed: 0,
                        skipped: 0,
                        failed: 0,
                        avgScore: 0,
                        highScoreCount: 0,
                    },
                });
                return { status: "cancelled" as const };
            }

            const task = await ctx.runQuery(internal.analysis_tasks.getTask, {
                taskId: args.taskId,
            });
            if (!task) {
                throw new Error(`Analysis task not found: ${String(args.taskId)}`);
            }
            const workHistoryLimit = await ctx.runQuery(
                internal.system_settings.getResumeWorkHistoryLimitInternal,
                {},
            );

            const exactTaskMetadata = task.dispatchMode === "exact"
                ? resolveExactTaskMetadata(task, task.workspaceSlug ?? "")
                : undefined;

            const resumes = await ctx.runQuery(internal.resumes_search.getResumesByIds, {
                resumeIds: args.resumeIds,
            });
            const keywordSource = `${task.config.jobDescriptionContent ?? ""} ${task.config.jobDescriptionTitle ?? ""}`;
            const keywords = task.config.keywords && task.config.keywords.length > 0
                ? normalizeKeywords(task.config.keywords)
                : extractKeywords(keywordSource);
            const normalizedLocation = task.config.location?.trim() || undefined;
            const promptVersion = exactTaskMetadata?.expectedPromptVersion
                ?? task.config.promptVersion
                ?? getCurrentResumeAiPromptVersion();
            const { toAnalyze, toSkip } = classifyResumes(
                resumes,
                keywords,
                task.config.relatedExpContext,
                task.dispatchMode,
            );
            const computedAnalysisJobDescriptionId = task.config.jobDescriptionId
                || (keywords.length > 0
                    ? buildKeywordAnalysisId(keywords, {
                        location: normalizedLocation,
                        promptVersion,
                    })
                    : "keyword-search");
            const analysisJobDescriptionId = exactTaskMetadata?.expectedJobDescriptionId
                ?? computedAnalysisJobDescriptionId;

            skippedCount = toSkip.length;

            if (toSkip.length > 0) {
                await ctx.runMutation(internal.resumes_mutations.updateAnalysisBatch, {
                    updates: toSkip.map((resume) => ({
                        resumeId: resume._id,
                        analysis: {
                            score: 10,
                            summary: "Auto-filtered: Low keyword match with JD.",
                            highlights: [],
                            recommendation: "no_match",
                            breakdown: {
                                keyword_match: 10,
                            },
                            jobDescriptionId: analysisJobDescriptionId,
                            promptVersion,
                            locale: resolveAIOutputLocale({ sourceKey: inferSourceKey(resume.source) }),
                            ...(normalizedLocation ? { queryLocation: normalizedLocation } : {}),
                            analyzedAt: resolveAnalysisWriteTimestamp(
                                task.dispatchMode === "exact" ? task.dispatchedAt : undefined,
                            ),
                        },
                    })),
                });

                // Audit log — EU AI Act compliance for auto-filter decisions
                for (const resume of toSkip) {
                    try {
                        const protectedHashes = computeProtectedAttributeHashes({
                            age: typeof resume.age === "number" ? resume.age : undefined,
                            source: typeof resume.source === "string" ? resume.source : undefined,
                        });
                        const auditLogId = await ctx.runMutation(internal.audit.logAnalysisDecision, {
                            resumeId: resume._id,
                            identityKey: resume.identityKey ?? undefined,
                            workspaceSlug: resume.sourceKey ?? "default",
                            decisionType: "filter",
                            actionRef: "analysis_tasks:processAnalysisTask:filter",
                            inputSnapshot: {
                                jobDescriptionId: analysisJobDescriptionId,
                                promptVersion: String(promptVersion),
                                searchKeywords: keywords,
                                searchLocation: normalizedLocation,
                            },
                            modelMeta: {
                                model: "rule-based",
                                provider: "internal",
                            },
                            output: {
                                score: 10,
                                recommendation: "no_match",
                            },
                            protectedAttributeHashes: protectedHashes,
                            decidedAt: Date.now(),
                        });
                        await ctx.runMutation(api.audit.setAuditOutcome, {
                            auditLogId,
                            outcome: "accepted",
                            setBy: "system:analysis_tasks:filter",
                        });
                    } catch (auditError) {
                        console.error(`[audit] Failed to log filter decision for resume ${String(resume._id)}:`, auditError);
                    }
                }
            }

            let current = skippedCount;
            const afterSkip = await ctx.runMutation(internal.analysis_tasks.updateProgress, {
                taskId: args.taskId,
                current,
                skipped: skippedCount,
                lastStatus: toAnalyze.length > 0
                    ? `Analyzing resumes ${current}/${task.progress.total}`
                    : `Processed ${current}/${task.progress.total}`,
            });

            if (afterSkip?.status === "cancelled") {
                cancelled = true;
            }

            if (!cancelled) {
                const parallelism = resolveAnalysisParallelism(toAnalyze.length);
                let nextIndex = 0;

                const worker = async (): Promise<void> => {
                    while (!cancelled) {
                        const currentIndex = nextIndex;
                        nextIndex += 1;
                        if (currentIndex >= toAnalyze.length) {
                            return;
                        }

                        const resume = toAnalyze[currentIndex];
                        try {
                            const exactIdentity = exactTaskMetadata
                                ? resolveExactAnalysisIdentity(exactTaskMetadata, resume._id)
                                : undefined;
                            const result = await analyzeOneResume(
                                resume,
                                {
                                    jobDescriptionId: task.config.jobDescriptionId,
                                    jobDescriptionTitle: task.config.jobDescriptionTitle,
                                    jobDescriptionContent: task.config.jobDescriptionContent,
                                    keywords: task.config.keywords,
                                    location: normalizedLocation,
                                    relatedExpContext: task.config.relatedExpContext,
                                    workHistoryLimit,
                                },
                                apiKey,
                                exactIdentity?.locale,
                            );

                            await ctx.runMutation(internal.resumes_mutations.updateAnalysis, {
                                resumeId: resume._id,
                                analysis: {
                                    score: result.score,
                                    summary: result.summary,
                                    highlights: result.highlights,
                                    concerns: result.concerns.length > 0 ? result.concerns : undefined,
                                    recommendation: result.recommendation,
                                    breakdown: result.breakdown,
                                    keyFactors: result.keyFactors.length > 0 ? result.keyFactors : undefined,
                                    jobDescriptionId: analysisJobDescriptionId,
                                    promptVersion,
                                    locale: exactIdentity?.locale ?? result.locale,
                                    ...(normalizedLocation ? { queryLocation: normalizedLocation } : {}),
                                    analyzedAt: resolveAnalysisWriteTimestamp(
                                        task.dispatchMode === "exact" ? task.dispatchedAt : undefined,
                                    ),
                                    ...(result.screeningChecklist ? { screeningChecklist: result.screeningChecklist } : {}),
                                    ...(result.relatedExpEvidence ? { relatedExpEvidence: result.relatedExpEvidence } : {}),
                                },
                                ...(exactIdentity ? {
                                    analysisKeySourceKeyOverride: exactIdentity.sourceKey,
                                } : {}),
                            });

                            // Audit log — EU AI Act compliance for score decisions
                            try {
                                const protectedHashes = computeProtectedAttributeHashes({
                                    age: typeof resume.age === "number" ? resume.age : undefined,
                                    source: typeof resume.source === "string" ? resume.source : undefined,
                                });
                                const auditLogId = await ctx.runMutation(internal.audit.logAnalysisDecision, {
                                    resumeId: resume._id,
                                    identityKey: resume.identityKey ?? undefined,
                                    workspaceSlug: resume.sourceKey ?? "default",
                                    decisionType: "score",
                                    actionRef: "analysis_tasks:processAnalysisTask:score",
                                    inputSnapshot: {
                                        jobDescriptionId: analysisJobDescriptionId,
                                        promptVersion: String(promptVersion),
                                        searchKeywords: keywords,
                                        searchLocation: normalizedLocation,
                                    },
                                    modelMeta: {
                                        model: getAiModel(),
                                        provider: "openai",
                                        apiBase: getAiApiBase(),
                                    },
                                    output: {
                                        score: result.score,
                                        recommendation: result.recommendation,
                                    },
                                    protectedAttributeHashes: protectedHashes,
                                    decidedAt: Date.now(),
                                });
                                await ctx.runMutation(api.audit.setAuditOutcome, {
                                    auditLogId,
                                    outcome: "accepted",
                                    setBy: "system:analysis_tasks:score",
                                });
                            } catch (auditError) {
                                console.error(`[audit] Failed to log score decision for resume ${String(resume._id)}:`, auditError);
                            }

                            analyzedCount += 1;
                            scoreSum += result.score;
                            if (result.score >= 80) {
                                highScoreCount += 1;
                            }
                        } catch (error) {
                            failedCount += 1;
                            console.error(`Failed to analyze resume ${String(resume._id)}:`, error);
                        }

                        current += 1;
                        const progressValue = current;
                        const progressResult = await ctx.runMutation(internal.analysis_tasks.updateProgress, {
                            taskId: args.taskId,
                            current: progressValue,
                            skipped: skippedCount,
                            lastStatus: `Analyzing resumes ${progressValue}/${task.progress.total}`,
                        });

                        if (progressResult?.status === "cancelled") {
                            cancelled = true;
                            return;
                        }
                    }
                };

                const workers = Array.from({ length: parallelism }, () => worker());
                await Promise.all(workers);
            }

            const avgScore = analyzedCount > 0
                ? Number((scoreSum / analyzedCount).toFixed(2))
                : 0;

            await ctx.runMutation(internal.analysis_tasks.complete, {
                taskId: args.taskId,
                status: cancelled ? "cancelled" : "completed",
                results: {
                    analyzed: analyzedCount,
                    skipped: skippedCount,
                    failed: failedCount,
                    avgScore,
                    highScoreCount,
                },
            });

            return { status: cancelled ? "cancelled" as const : "completed" as const };
        } catch (error) {
            console.error(`Analysis task failed ${String(args.taskId)}:`, error);
            const message = error instanceof Error ? error.message : "Unknown error";
            const avgScore = analyzedCount > 0 ? Number((scoreSum / analyzedCount).toFixed(2)) : 0;

            await ctx.runMutation(internal.analysis_tasks.complete, {
                taskId: args.taskId,
                status: cancelled ? "cancelled" : "failed",
                error: message,
                results: {
                    analyzed: analyzedCount,
                    skipped: skippedCount,
                    failed: failedCount,
                    avgScore,
                    highScoreCount,
                },
            });

            return { status: "failed" as const, error: message };
        }
    },
});

/**
 * Sweep tasks stuck in "processing" for >24 hours back to "failed".
 * Called by the daily cron job to prevent silent pipeline stalls.
 */
export const sweepStuckTasks = internalMutation({
    args: {},
    handler: async (ctx) => {
        // Skip during maintenance mode (restore quiesce)
        if (await ctx.runQuery(internal.system_settings.isMaintenanceModeInternal, {})) {
            console.log("[Cron] Skipping — maintenance mode active");
            return { swept: 0 };
        }

        const cutoff = Date.now() - 24 * 60 * 60 * 1000;
        const stuck = await ctx.db
            .query("analysis_tasks")
            .withIndex("by_status", (q) => q.eq("status", "processing"))
            .filter((q) => q.lt(q.field("startedAt"), cutoff))
            .take(100);

        for (const task of stuck) {
            await ctx.db.patch(task._id, {
                status: "failed",
                error: "Swept: stuck in processing for >24h",
                completedAt: Date.now(),
            });
        }

        return { swept: stuck.length };
    },
});
