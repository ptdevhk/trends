import { internalAction, internalMutation, internalQuery, mutation, query } from "./_generated/server";
import { internal } from "./_generated/api";
import { v } from "convex/values";
import type { Id } from "./_generated/dataModel";
import { SYSTEM_PROMPT, USER_PROMPT_TEMPLATE, callLLM, normalizeResume } from "./analyze";

const DEFAULT_JOB_TITLE = "销售经理 (通用)";
const DEFAULT_REQUIREMENTS = "具备销售经验，沟通能力强，熟悉机床行业优先。";
const SKIP_THRESHOLD = 10;

function extractKeywords(content: string, title?: string): string[] {
    const source = `${content} ${title ?? ""}`.toLowerCase();
    const matches = source.match(/[\u4e00-\u9fa5a-z0-9]{2,}/g);
    if (!matches) return [];
    return Array.from(new Set(matches));
}

function calcKeywordScore(content: string, keywords: string[]): number {
    if (!keywords.length) return 100;
    let matches = 0;
    for (const keyword of keywords) {
        if (content.includes(keyword)) {
            matches += 1;
        }
    }
    return Math.min(100, Math.round((matches / Math.max(keywords.length, 1)) * 100));
}

async function analyzeOneResume(
    resume: { _id: Id<"resumes">; content: unknown },
    options: { jobDescriptionTitle?: string; jobDescriptionContent?: string },
    apiKey: string
) {
    const jdTitle = options.jobDescriptionTitle || DEFAULT_JOB_TITLE;
    const jdRequirements = options.jobDescriptionContent || DEFAULT_REQUIREMENTS;

    const normalized = normalizeResume(resume.content);
    const prompt = USER_PROMPT_TEMPLATE
        .replace("{jobTitle}", jdTitle)
        .replace("{requirements}", jdRequirements)
        .replace("{matchingRules}", "使用默认评分标准")
        .replace("{candidateName}", normalized.name)
        .replace("{jobIntention}", normalized.jobIntention)
        .replace("{workExperience}", String(normalized.workExperience))
        .replace("{education}", normalized.education)
        .replace("{skills}", normalized.skills)
        .replace("{companies}", normalized.companies)
        .replace("{summary}", normalized.summary);

    const messages = [
        { role: "system", content: SYSTEM_PROMPT },
        { role: "user", content: prompt },
    ];

    return await callLLM(messages, apiKey);
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

export const getResumesForTask = internalQuery({
    args: {
        resumeIds: v.array(v.id("resumes")),
    },
    handler: async (ctx, args) => {
        const docs = await Promise.all(args.resumeIds.map((resumeId) => ctx.db.get(resumeId)));
        return docs.filter((doc): doc is NonNullable<typeof doc> => doc !== null);
    },
});

export const markProcessing = internalMutation({
    args: {
        taskId: v.id("analysis_tasks"),
    },
    handler: async (ctx, args) => {
        const task = await ctx.db.get(args.taskId);
        if (!task) {
            return { status: "failed" };
        }
        if (task.status === "cancelled") {
            return { status: "cancelled" };
        }
        await ctx.db.patch(args.taskId, {
            status: "processing",
            startedAt: Date.now(),
        });
        return { status: "processing" };
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
            return { status: "failed" };
        }

        if (task.status === "cancelled") {
            return { status: "cancelled" };
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

        if (task.status === "cancelled" && args.status !== "cancelled") {
            return;
        }

        await ctx.db.patch(args.taskId, {
            status: args.status,
            error: args.error,
            results: args.results,
            completedAt: Date.now(),
        });
    },
});

export const processAnalysisTask = internalAction({
    args: {
        taskId: v.id("analysis_tasks"),
        resumeIds: v.array(v.id("resumes")),
    },
    handler: async (ctx, args) => {
        const markResult = await ctx.runMutation(internal.analysis_tasks.markProcessing, {
            taskId: args.taskId,
        });

        if (!markResult || markResult.status === "cancelled") {
            return;
        }

        const apiKey = process.env.OPENAI_API_KEY;
        if (!apiKey) {
            await ctx.runMutation(internal.analysis_tasks.complete, {
                taskId: args.taskId,
                status: "failed",
                error: "OPENAI_API_KEY is not set in Convex environment variables.",
            });
            return;
        }

        try {
            const task = await ctx.runQuery(internal.analysis_tasks.getTask, {
                taskId: args.taskId,
            });
            if (!task) {
                return;
            }

            const resumes = await ctx.runQuery(internal.analysis_tasks.getResumesForTask, {
                resumeIds: args.resumeIds,
            });

            const keywords = extractKeywords(
                task.config.jobDescriptionContent ?? "",
                task.config.jobDescriptionTitle
            );

            const toSkip: Id<"resumes">[] = [];
            const toAnalyze: { _id: Id<"resumes">; content: unknown }[] = [];

            for (const resume of resumes) {
                const content = JSON.stringify(resume.content).toLowerCase();
                const score = calcKeywordScore(content, keywords);
                if (keywords.length > 0 && score < SKIP_THRESHOLD) {
                    toSkip.push(resume._id);
                } else {
                    toAnalyze.push({ _id: resume._id, content: resume.content });
                }
            }

            if (toSkip.length > 0) {
                await ctx.runMutation(internal.resumes.updateAnalysisBatch, {
                    updates: toSkip.map((resumeId) => ({
                        resumeId,
                        analysis: {
                            score: 10,
                            recommendation: "no_match",
                            summary: "Auto-filtered: Low keyword match with JD.",
                            highlights: [],
                            breakdown: { keyword_match: 10 },
                            jobDescriptionId: task.config.jobDescriptionId,
                        },
                    })),
                });
            }

            let analyzed = 0;
            let failed = 0;
            let highScoreCount = 0;
            let scoreSum = 0;
            let processed = toSkip.length;

            const skippedProgress = await ctx.runMutation(internal.analysis_tasks.updateProgress, {
                taskId: args.taskId,
                current: processed,
                skipped: toSkip.length,
                lastStatus: toSkip.length > 0 ? `Skipped ${toSkip.length} by keyword filter` : "Starting analysis",
            });

            if (skippedProgress?.status === "cancelled") {
                await ctx.runMutation(internal.analysis_tasks.complete, {
                    taskId: args.taskId,
                    status: "cancelled",
                    results: {
                        analyzed,
                        skipped: toSkip.length,
                        failed,
                        avgScore: 0,
                        highScoreCount,
                    },
                });
                return;
            }

            for (const resume of toAnalyze) {
                let statusText = `Analyzing ${processed + 1}/${resumes.length}`;

                try {
                    const result = await analyzeOneResume(resume, {
                        jobDescriptionTitle: task.config.jobDescriptionTitle,
                        jobDescriptionContent: task.config.jobDescriptionContent,
                    }, apiKey);

                    const score = typeof result.score === "number" ? result.score : Number(result.score) || 0;
                    if (score >= 80) {
                        highScoreCount += 1;
                    }
                    scoreSum += score;
                    analyzed += 1;

                    await ctx.runMutation(internal.resumes.updateAnalysis, {
                        resumeId: resume._id,
                        analysis: {
                            score,
                            breakdown: result.breakdown,
                            summary: typeof result.summary === "string" ? result.summary : "",
                            highlights: Array.isArray(result.highlights)
                                ? result.highlights.filter((item: unknown): item is string => typeof item === "string")
                                : [],
                            recommendation: typeof result.recommendation === "string" ? result.recommendation : "no_match",
                            jobDescriptionId: task.config.jobDescriptionId,
                        },
                    });
                } catch (error) {
                    failed += 1;
                    console.error("Failed to analyze resume", resume._id, error);
                    statusText = `Failed on resume ${processed + 1}`;
                }

                processed += 1;
                const progress = await ctx.runMutation(internal.analysis_tasks.updateProgress, {
                    taskId: args.taskId,
                    current: processed,
                    skipped: toSkip.length,
                    lastStatus: statusText,
                });

                if (progress?.status === "cancelled") {
                    break;
                }
            }

            const finalTask = await ctx.runQuery(internal.analysis_tasks.getTask, {
                taskId: args.taskId,
            });

            const avgScore = analyzed > 0 ? Number((scoreSum / analyzed).toFixed(2)) : 0;
            await ctx.runMutation(internal.analysis_tasks.complete, {
                taskId: args.taskId,
                status: finalTask?.status === "cancelled" ? "cancelled" : "completed",
                results: {
                    analyzed,
                    skipped: toSkip.length,
                    failed,
                    avgScore,
                    highScoreCount,
                },
            });
        } catch (error) {
            console.error("Analysis task failed", error);
            const message = error instanceof Error ? error.message : "Unknown error";
            await ctx.runMutation(internal.analysis_tasks.complete, {
                taskId: args.taskId,
                status: "failed",
                error: message,
            });
        }
    },
});
