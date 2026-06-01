import { internal } from "./_generated/api";
import type { Doc } from "./_generated/dataModel";
import { internalAction, internalMutation, internalQuery, mutation, query } from "./_generated/server";
import { v } from "convex/values";
import { api } from "./_generated/api";
import { getCurrentResumeAiPromptVersion } from "@trends/shared";
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
    parseLlmResult,
    extractKeywords,
    normalizeKeywords,
    buildKeywordAnalysisId,
    buildAnalysisDispatchJobKey,
    buildAnalysisDispatchIdempotencyKey,
} from "./lib/analysis_task_helpers.js";

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
    const locale = resolveAIOutputLocale({ sourceKey: inferSourceKey(resume.source) });
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
    const normalizedResume = normalizeResume(resume, { locale });

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
            const normalizedResult = normalizeAnalysisResult(parsedResult, resume, {
                target: {
                    keywords: normalizedKeywords,
                    jobTitle,
                    jobDescription: requirements,
                },
            });
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
        const [pending, processing, completed, failed, cancelled] = await Promise.all([
            ctx.db.query("analysis_tasks").withIndex("by_status", q => q.eq("status", "pending")).take(100),
            ctx.db.query("analysis_tasks").withIndex("by_status", q => q.eq("status", "processing")).take(100),
            ctx.db.query("analysis_tasks").withIndex("by_status", q => q.eq("status", "completed")).order("desc").take(100),
            ctx.db.query("analysis_tasks").withIndex("by_status", q => q.eq("status", "failed")).order("desc").take(100),
            ctx.db.query("analysis_tasks").withIndex("by_status", q => q.eq("status", "cancelled")).order("desc").take(100),
        ]);
        return {
            total: pending.length + processing.length + completed.length + failed.length + cancelled.length,
            pending: pending.length,
            processing: processing.length,
            completed: completed.length,
            failed: failed.length,
            cancelled: cancelled.length,
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

            const resumes = await ctx.runQuery(internal.resumes_search.getResumesByIds, {
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
                            analyzedAt: Date.now(),
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

                            await ctx.runMutation(internal.resumes_mutations.updateAnalysis, {
                                resumeId: resume._id,
                                analysis: {
                                    score: result.score,
                                    summary: result.summary,
                                    highlights: result.highlights,
                                    recommendation: result.recommendation,
                                    breakdown: result.breakdown,
                                    jobDescriptionId: analysisJobDescriptionId,
                                    promptVersion,
                                    locale: result.locale,
                                    ...(normalizedLocation ? { queryLocation: normalizedLocation } : {}),
                                    analyzedAt: Date.now(),
                                },
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
