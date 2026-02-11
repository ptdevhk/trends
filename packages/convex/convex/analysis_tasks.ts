import { internal } from "./_generated/api";
import type { Doc } from "./_generated/dataModel";
import { internalAction, internalMutation, internalQuery, mutation, query } from "./_generated/server";
import { v } from "convex/values";
import { SYSTEM_PROMPT, USER_PROMPT_TEMPLATE, callLLM, getAiApiKey, normalizeResume } from "./analyze";

type AnalysisTaskStatus = "pending" | "processing" | "completed" | "failed" | "cancelled";

type AnalysisResult = {
    score: number;
    summary: string;
    highlights: string[];
    recommendation: string;
    breakdown?: Record<string, number>;
};

type Message = {
    role: "system" | "user";
    content: string;
};

function isObject(value: unknown): value is Record<string, unknown> {
    return typeof value === "object" && value !== null;
}

function toNumber(value: unknown): number | null {
    if (typeof value === "number" && Number.isFinite(value)) {
        return value;
    }
    if (typeof value === "string") {
        const parsed = Number(value);
        if (Number.isFinite(parsed)) {
            return parsed;
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

function parseLlmResult(value: unknown): AnalysisResult {
    if (!isObject(value)) {
        throw new Error("Invalid analysis result: expected object.");
    }

    const score = toNumber(value.score);
    if (score === null) {
        throw new Error("Invalid analysis result: score is missing.");
    }

    const summary = typeof value.summary === "string" ? value.summary : "";
    const recommendation = typeof value.recommendation === "string" ? value.recommendation : "potential";

    return {
        score,
        summary: summary || "No summary provided.",
        highlights: toStringArray(value.highlights),
        recommendation,
        breakdown: parseBreakdown(value.breakdown),
    };
}

function extractKeywords(input: string): string[] {
    const matched = input.toLowerCase().match(/[\u4e00-\u9fa5a-z0-9]{2,}/g) ?? [];
    return [...new Set(matched)];
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
        jobDescriptionId: string;
        jobDescriptionTitle?: string;
        jobDescriptionContent?: string;
    },
    apiKey: string
): Promise<AnalysisResult> {
    const jobTitle = config.jobDescriptionTitle || config.jobDescriptionId || "销售经理 (通用)";
    const requirements = config.jobDescriptionContent || "具备销售经验，沟通能力强，熟悉机床行业优先。";
    const matchingRules = "使用默认评分标准";
    const normalizedResume = normalizeResume(resume.content);

    const prompt = USER_PROMPT_TEMPLATE
        .replace("{jobTitle}", jobTitle)
        .replace("{requirements}", requirements)
        .replace("{matchingRules}", matchingRules)
        .replace("{candidateName}", normalizedResume.name)
        .replace("{jobIntention}", normalizedResume.jobIntention)
        .replace("{workExperience}", String(normalizedResume.workExperience))
        .replace("{education}", normalizedResume.education)
        .replace("{skills}", normalizedResume.skills)
        .replace("{companies}", normalizedResume.companies)
        .replace("{summary}", normalizedResume.summary);

    const messages: Message[] = [
        { role: "system", content: SYSTEM_PROMPT },
        { role: "user", content: prompt },
    ];

    const rawResult = await callLLM(messages, apiKey);
    return parseLlmResult(rawResult);
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
        jobDescriptionId: v.string(),
        jobDescriptionTitle: v.optional(v.string()),
        jobDescriptionContent: v.optional(v.string()),
        sample: v.optional(v.string()),
        resumeIds: v.array(v.id("resumes")),
    },
    handler: async (ctx, args) => {
        if (!args.jobDescriptionId || args.jobDescriptionId === "default") {
            throw new Error("Job Description must be selected for analysis.");
        }

        const taskId = await ctx.db.insert("analysis_tasks", {
            config: {
                jobDescriptionId: args.jobDescriptionId,
                jobDescriptionTitle: args.jobDescriptionTitle,
                jobDescriptionContent: args.jobDescriptionContent,
                sample: args.sample,
                resumeCount: args.resumeIds.length,
            },
            status: "pending",
            progress: {
                current: 0,
                total: args.resumeIds.length,
                skipped: 0,
            },
        });

        await ctx.scheduler.runAfter(0, internal.analysis_tasks.processAnalysisTask, {
            taskId,
            resumeIds: args.resumeIds,
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

        await ctx.db.patch(args.taskId, {
            progress: {
                current: args.current,
                total: task.progress.total,
                skipped: args.skipped,
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
            const keywords = extractKeywords(keywordSource);
            const { toAnalyze, toSkip } = classifyResumes(resumes, keywords);

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
                            jobDescriptionId: task.config.jobDescriptionId,
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
                for (const resume of toAnalyze) {
                    try {
                        const result = await analyzeOneResume(
                            resume,
                            {
                                jobDescriptionId: task.config.jobDescriptionId,
                                jobDescriptionTitle: task.config.jobDescriptionTitle,
                                jobDescriptionContent: task.config.jobDescriptionContent,
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
                                jobDescriptionId: task.config.jobDescriptionId,
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
                    const progressResult = await ctx.runMutation(internal.analysis_tasks.updateProgress, {
                        taskId: args.taskId,
                        current,
                        skipped: skippedCount,
                        lastStatus: `Analyzing resumes ${current}/${task.progress.total}`,
                    });

                    if (progressResult?.status === "cancelled") {
                        cancelled = true;
                        break;
                    }
                }
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
