import { internal } from "./_generated/api";
import type { Doc } from "./_generated/dataModel";
import { internalAction, internalMutation, internalQuery, mutation, query } from "./_generated/server";
import { v } from "convex/values";
import {
    buildKeywordAnalysisId as buildSharedKeywordAnalysisId,
    getCurrentResumeAiPromptVersion,
    isSalesRequiredContext,
    normalizeKeywordSalesAnalysis,
} from "@trends/shared";
import {
    buildKeywordMatchingRules,
    buildKeywordRequirements,
    buildSystemPrompt,
    callLLM,
    type ChatMessage,
    getAiApiKey,
    getUserPromptTemplate,
    hydrateUserPrompt,
    normalizeResume,
    resolveAIOutputLocale,
} from "./analyze";
import { resolveAnalysisParallelism } from "./lib/parallelism";

type AnalysisTaskStatus = "pending" | "processing" | "completed" | "failed" | "cancelled";

type AnalysisResult = {
    score: number;
    summary: string;
    highlights: string[];
    recommendation: string;
    breakdown?: Record<string, number>;
};

function isObject(value: unknown): value is Record<string, unknown> {
    return typeof value === "object" && value !== null;
}

const WORD_NUMBERS: Record<string, number> = {
    zero: 0, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7,
    eight: 8, nine: 9, ten: 10, fifteen: 15, twenty: 20, twenty5: 25,
    thirty: 30, forty: 40, fifty: 50, sixty: 60, seventy: 70, eighty: 80,
    ninety: 90, hundred: 100,
};

function toNumber(value: unknown): number | null {
    if (typeof value === "number" && Number.isFinite(value)) {
        return value;
    }
    if (typeof value === "string") {
        const parsed = Number(value);
        if (Number.isFinite(parsed)) {
            return parsed;
        }
        // Handle English word numbers (e.g. "seventy", "eighty-five")
        const lower = value.trim().toLowerCase();
        if (WORD_NUMBERS[lower] !== undefined) {
            return WORD_NUMBERS[lower];
        }
        // Handle compound like "seventy-five" or "seventy five"
        const parts = lower.split(/[-\s]+/);
        if (parts.length === 2 && WORD_NUMBERS[parts[0]] !== undefined && WORD_NUMBERS[parts[1]] !== undefined) {
            return WORD_NUMBERS[parts[0]] + WORD_NUMBERS[parts[1]];
        }
    }
    return null;
}

function toStringArray(value: unknown): string[] {
    if (!Array.isArray(value)) {
        return [];
    }
    return value.filter((item): item is string => typeof item === "string");
}

function parseBreakdown(value: unknown): Record<string, number> | undefined {
    if (!isObject(value)) {
        return undefined;
    }

    const parsed: Record<string, number> = {};
    for (const [key, rawValue] of Object.entries(value)) {
        const numericValue = toNumber(rawValue);
        if (numericValue !== null) {
            parsed[key] = numericValue;
        }
    }

    return Object.keys(parsed).length > 0 ? parsed : undefined;
}

/**
 * Try to locate the analysis payload from potentially nested LLM responses.
 * Some models wrap results like `{ "result": { "score": 85, ... } }` or
 * `{ "data": { "score": 85, ... } }`.
 */
function unwrapLlmResult(value: unknown): Record<string, unknown> | null {
    if (!isObject(value)) return null;

    // Top-level score → use as-is
    if (value.score !== undefined) return value;

    // Try common wrapper keys
    for (const key of ["result", "data", "analysis", "response", "output"]) {
        const nested = value[key];
        if (isObject(nested) && nested.score !== undefined) return nested;
    }

    // Scan one level for any object with a `score` key
    for (const nested of Object.values(value)) {
        if (isObject(nested) && nested.score !== undefined) return nested;
    }

    return null;
}

function parseLlmResult(value: unknown): AnalysisResult {
    const obj = unwrapLlmResult(value);
    if (!obj) {
        console.error("parseLlmResult: no score field found in LLM response:", JSON.stringify(value).slice(0, 1000));
        throw new Error("Invalid analysis result: score is missing.");
    }

    const score = toNumber(obj.score);
    if (score === null) {
        console.error("parseLlmResult: score is not numeric:", JSON.stringify(obj.score), "full:", JSON.stringify(value).slice(0, 500));
        throw new Error("Invalid analysis result: score is missing.");
    }

    const summary = typeof obj.summary === "string" ? obj.summary : "";
    const recommendation = typeof obj.recommendation === "string" ? obj.recommendation : "potential";

    return {
        score,
        summary: summary || "No summary provided.",
        highlights: toStringArray(obj.highlights),
        recommendation,
        breakdown: parseBreakdown(obj.breakdown),
    };
}

function extractKeywords(input: string): string[] {
    const matched = input.toLowerCase().match(/[\u4e00-\u9fa5a-z0-9]{2,}/g) ?? [];
    return [...new Set(matched)];
}

function normalizeKeywords(keywords: string[]): string[] {
    return Array.from(
        new Set(
            keywords
                .map((keyword) => keyword.trim().toLowerCase())
                .filter((keyword) => keyword.length > 0)
        )
    );
}

function stableHash(seed: string): string {
    let hash = 2166136261;
    for (const char of seed) {
        hash ^= char.codePointAt(0) ?? 0;
        hash = Math.imul(hash, 16777619);
    }
    return (hash >>> 0).toString(16);
}

function buildKeywordAnalysisId(
    keywords: string[],
    options?: {
        location?: string;
        promptVersion?: number;
    }
): string {
    return buildSharedKeywordAnalysisId(keywords, options);
}

type AnalysisDispatchKeyInput = {
    derivedJobDescriptionId?: string;
    jobDescriptionTitle?: string;
    jobDescriptionContent?: string;
    keywords?: string[];
    location?: string;
    promptVersion?: number;
    resumeIds: readonly string[];
};

function buildAnalysisDispatchJobKey(input: AnalysisDispatchKeyInput): string {
    const promptVersion = input.promptVersion ?? getCurrentResumeAiPromptVersion();
    if (input.derivedJobDescriptionId && input.derivedJobDescriptionId.trim()) {
        return `job:${input.derivedJobDescriptionId.trim().toLowerCase()}:prompt:${promptVersion}`;
    }

    const normalizedKeywords = normalizeKeywords(input.keywords ?? []);
    if (normalizedKeywords.length > 0) {
        return `keywords:${buildKeywordAnalysisId(normalizedKeywords, {
            location: input.location,
            promptVersion,
        })}`;
    }

    const title = input.jobDescriptionTitle?.trim().toLowerCase() ?? "";
    const content = input.jobDescriptionContent?.trim().toLowerCase() ?? "";
    if (!title && !content) {
        return `job:default:prompt:${promptVersion}`;
    }
    return `job-content:prompt:${promptVersion}:${stableHash(`${title}|${content}`)}`;
}

export function buildAnalysisDispatchIdempotencyKey(input: AnalysisDispatchKeyInput): string {
    const uniqueResumeIds = Array.from(new Set(input.resumeIds.map((resumeId) => String(resumeId)))).sort();
    const resumeSeed = uniqueResumeIds.join("|");
    const resumeHash = stableHash(`resume:${uniqueResumeIds.length}:${resumeSeed}`);
    const jobKey = buildAnalysisDispatchJobKey(input);
    return `${jobKey}:resumes:${resumeHash}`;
}

function classifyResumes(
    resumes: Doc<"resumes">[],
    keywords: string[]
): { toAnalyze: Doc<"resumes">[]; toSkip: Doc<"resumes">[] } {
    if (keywords.length === 0) {
        return { toAnalyze: resumes, toSkip: [] };
    }

    const toAnalyze: Doc<"resumes">[] = [];
    const toSkip: Doc<"resumes">[] = [];
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
        if (score < threshold) {
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
    },
    apiKey: string
): Promise<AnalysisResult> {
    const normalizedKeywords = normalizeKeywords(config.keywords ?? []);
    const useKeywordPath = normalizedKeywords.length > 0 && !config.jobDescriptionContent;

    const jobTitle = config.jobDescriptionTitle
        || config.jobDescriptionId
        || (useKeywordPath ? normalizedKeywords.join(", ") : "销售经理 (通用)");
    const requirements = useKeywordPath
        ? buildKeywordRequirements(normalizedKeywords)
        : (config.jobDescriptionContent || "具备销售经验，沟通能力强，熟悉机床行业优先。");
    const matchingRules = useKeywordPath
        ? buildKeywordMatchingRules(normalizedKeywords)
        : "使用默认评分标准";
    const locale = resolveAIOutputLocale();
    const normalizedResume = normalizeResume(resume);
    const salesRequired = isSalesRequiredContext(
        jobTitle,
        requirements,
        matchingRules,
        config.jobDescriptionContent,
        config.jobDescriptionTitle,
        normalizedKeywords.join(" "),
        config.location,
    );

    const prompt = hydrateUserPrompt(
        getUserPromptTemplate(locale),
        { title: jobTitle, requirements, matchingRules },
        normalizedResume,
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
            return normalizeKeywordSalesAnalysis(parsedResult, {
                salesRequired,
                roleSignals: normalizedResume.roleSignals,
            });
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
    args: {},
    handler: async (ctx) => {
        return await ctx.db
            .query("analysis_tasks")
            .order("desc")
            .take(20);
    },
});

export const getSummary = query({
    args: {},
    handler: async (ctx) => {
        const tasks = await ctx.db.query("analysis_tasks").collect();
        return {
            total: tasks.length,
            pending: tasks.filter((task) => task.status === "pending").length,
            processing: tasks.filter((task) => task.status === "processing").length,
            completed: tasks.filter((task) => task.status === "completed").length,
            failed: tasks.filter((task) => task.status === "failed").length,
            cancelled: tasks.filter((task) => task.status === "cancelled").length,
        };
    },
});

export const dispatch = mutation({
    args: {
        jobDescriptionId: v.optional(v.string()),
        jobDescriptionTitle: v.optional(v.string()),
        jobDescriptionContent: v.optional(v.string()),
        keywords: v.optional(v.array(v.string())),
        location: v.optional(v.string()),
        promptVersion: v.optional(v.number()),
        sample: v.optional(v.string()),
        resumeIds: v.array(v.id("resumes")),
    },
    handler: async (ctx, args) => {
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
        const derivedJobDescriptionId = args.jobDescriptionId
            || (normalizedKeywords.length > 0
                ? buildKeywordAnalysisId(normalizedKeywords, {
                    location: normalizedLocation,
                    promptVersion,
                })
                : undefined);
        const jobKey = buildAnalysisDispatchJobKey({
            derivedJobDescriptionId,
            jobDescriptionTitle: args.jobDescriptionTitle,
            jobDescriptionContent: args.jobDescriptionContent,
            keywords: normalizedKeywords,
            location: normalizedLocation,
            promptVersion,
            resumeIds: uniqueResumeIds.map((resumeId) => String(resumeId)),
        });
        const idempotencyKey = buildAnalysisDispatchIdempotencyKey({
            derivedJobDescriptionId,
            jobDescriptionTitle: args.jobDescriptionTitle,
            jobDescriptionContent: args.jobDescriptionContent,
            keywords: normalizedKeywords,
            location: normalizedLocation,
            promptVersion,
            resumeIds: uniqueResumeIds.map((resumeId) => String(resumeId)),
        });

        const existingProcessingTask = await ctx.db
            .query("analysis_tasks")
            .withIndex("by_idempotency_status", (q) =>
                q.eq("idempotencyKey", idempotencyKey).eq("status", "processing")
            )
            .first();
        if (existingProcessingTask) {
            return existingProcessingTask._id;
        }

        const existingPendingTask = await ctx.db
            .query("analysis_tasks")
            .withIndex("by_idempotency_status", (q) =>
                q.eq("idempotencyKey", idempotencyKey).eq("status", "pending")
            )
            .first();
        if (existingPendingTask) {
            return existingPendingTask._id;
        }

        const existingProcessingTaskByJobKey = await ctx.db
            .query("analysis_tasks")
            .withIndex("by_job_key_status", (q) =>
                q.eq("jobKey", jobKey).eq("status", "processing")
            )
            .first();
        if (existingProcessingTaskByJobKey) {
            return existingProcessingTaskByJobKey._id;
        }

        const existingPendingTaskByJobKey = await ctx.db
            .query("analysis_tasks")
            .withIndex("by_job_key_status", (q) =>
                q.eq("jobKey", jobKey).eq("status", "pending")
            )
            .first();
        if (existingPendingTaskByJobKey) {
            return existingPendingTaskByJobKey._id;
        }

        const taskId = await ctx.db.insert("analysis_tasks", {
            idempotencyKey,
            jobKey,
            config: {
                jobDescriptionId: derivedJobDescriptionId,
                jobDescriptionTitle: args.jobDescriptionTitle,
                jobDescriptionContent: args.jobDescriptionContent,
                keywords: normalizedKeywords.length > 0 ? normalizedKeywords : undefined,
                location: normalizedLocation,
                promptVersion,
                sample: args.sample,
                resumeCount: uniqueResumeIds.length,
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

        return taskId;
    },
});

export const cancel = mutation({
    args: {
        taskId: v.id("analysis_tasks"),
    },
    handler: async (ctx, args) => {
        const task = await ctx.db.get(args.taskId);
        if (!task || (task.status !== "pending" && task.status !== "processing")) {
            return;
        }

        await ctx.db.patch(args.taskId, {
            status: "cancelled",
            completedAt: Date.now(),
        });
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

            const resumes = await ctx.runQuery(internal.resumes.getResumesByIds, {
                resumeIds: args.resumeIds,
            });
            const keywordSource = `${task.config.jobDescriptionContent ?? ""} ${task.config.jobDescriptionTitle ?? ""}`;
            const keywords = task.config.keywords && task.config.keywords.length > 0
                ? normalizeKeywords(task.config.keywords)
                : extractKeywords(keywordSource);
            const normalizedLocation = task.config.location?.trim() || undefined;
            const promptVersion = task.config.promptVersion ?? getCurrentResumeAiPromptVersion();
            const { toAnalyze, toSkip } = classifyResumes(resumes, keywords);
            const analysisJobDescriptionId = task.config.jobDescriptionId
                || (keywords.length > 0
                    ? buildKeywordAnalysisId(keywords, {
                        location: normalizedLocation,
                        promptVersion,
                    })
                    : "keyword-search");

            skippedCount = toSkip.length;

            if (toSkip.length > 0) {
                await ctx.runMutation(internal.resumes.updateAnalysisBatch, {
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
                            ...(normalizedLocation ? { queryLocation: normalizedLocation } : {}),
                            analyzedAt: Date.now(),
                        },
                    })),
                });
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
                            const result = await analyzeOneResume(
                                resume,
                                {
                                    jobDescriptionId: task.config.jobDescriptionId,
                                    jobDescriptionTitle: task.config.jobDescriptionTitle,
                                    jobDescriptionContent: task.config.jobDescriptionContent,
                                    keywords: task.config.keywords,
                                    location: normalizedLocation,
                                },
                                apiKey
                            );

                            await ctx.runMutation(internal.resumes.updateAnalysis, {
                                resumeId: resume._id,
                                analysis: {
                                    score: result.score,
                                    summary: result.summary,
                                    highlights: result.highlights,
                                    recommendation: result.recommendation,
                                    breakdown: result.breakdown,
                                    jobDescriptionId: analysisJobDescriptionId,
                                    promptVersion,
                                    ...(normalizedLocation ? { queryLocation: normalizedLocation } : {}),
                                    analyzedAt: Date.now(),
                                },
                            });

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
