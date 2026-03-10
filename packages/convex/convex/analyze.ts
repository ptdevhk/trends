/// <reference path="./convex-env.d.ts" />
import {
    DEFAULT_RESUME_AI_PROMPT_LOCALE,
    buildResumeAiSystemPrompt,
    getResumeAiPromptDefinition,
    getResumeAiUserPromptTemplate,
    resolveResumeAiPromptLocale,
} from "@trends/shared";
import { v } from "convex/values";
import { internal } from "./_generated/api";
import { action } from "./_generated/server";

const DEFAULT_AI_OUTPUT_LOCALE = DEFAULT_RESUME_AI_PROMPT_LOCALE;

export const SYSTEM_PROMPT = getResumeAiPromptDefinition(DEFAULT_AI_OUTPUT_LOCALE).sections.systemPrompt;
export const USER_PROMPT_TEMPLATE = getResumeAiUserPromptTemplate(DEFAULT_AI_OUTPUT_LOCALE);

// For Convex deployments, set AI_OUTPUT_LOCALE via the dashboard or `convex env set`.
export function resolveAIOutputLocale(): string {
    const locale = process.env.AI_OUTPUT_LOCALE?.trim();
    return resolveResumeAiPromptLocale(locale).requestedLocale;
}

export function buildSystemPrompt(locale: string): string {
    return buildResumeAiSystemPrompt(locale);
}

export function getUserPromptTemplate(locale: string): string {
    return getResumeAiUserPromptTemplate(locale);
}

export function buildKeywordRequirements(keywords: string[]): string {
    return `候选人需具备以下关键技能/经验:\n${keywords.map((keyword) => `- ${keyword}`).join("\n")}`;
}

export function buildKeywordMatchingRules(keywords: string[]): string {
    return `根据候选人与以下关键词的匹配程度评分。关键词越相关评分越高。\n关键词: ${keywords.join(", ")}`;
}

export function getAiApiKey(): string | undefined {
    return process.env.AI_API_KEY || process.env.OPENAI_API_KEY || undefined;
}

export function getAiApiBase(): string {
    return process.env.AI_API_BASE || process.env.OPENAI_API_BASE || "https://api.openai.com/v1";
}

export function getAiModel(): string {
    return process.env.AI_MODEL || process.env.OPENAI_MODEL || "gpt-4-turbo-preview";
}

export function getAiTemperature(): number {
    const raw = process.env.AI_TEMPERATURE;
    if (raw !== undefined && raw.trim().length > 0) {
        const parsed = parseFloat(raw);
        if (Number.isFinite(parsed)) return parsed;
    }
    return 0;
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === "object" && value !== null;
}

// Helper to normalize resume data
export function normalizeResume(data: unknown) {
    // NOTE: Strict evidence lane — do not derive analysis inputs from selfIntro/jobIntention.
    const root = isRecord(data) ? data : {};
    const content = isRecord(root.content) ? root.content : root;
    const ingestData = isRecord(root.ingestData)
        ? root.ingestData
        : (isRecord(content.ingestData) ? content.ingestData : undefined);

    // Extract companies from workHistory since resume content has no "companies" field
    const historyCompanies = Array.isArray(content.workHistory)
        ? content.workHistory
            .map((item) => {
                if (typeof item === "string") {
                    return item;
                }
                if (isRecord(item) && typeof item.raw === "string") {
                    return item.raw;
                }
                return "";
            })
            .filter((item): item is string => item.length > 0)
        : [];
    const existingCompanies = Array.isArray(content.companies)
        ? content.companies.filter((item): item is string => typeof item === "string" && item.length > 0)
        : [];
    const allCompanies = [...new Set([...existingCompanies, ...historyCompanies])];

    // Parse experience: handle "11年" string format or numeric
    const rawExp = content.experience ?? content.workExperience ?? "0";
    const parsedExp = typeof rawExp === "string"
        ? parseInt(rawExp.replace(/[^0-9]/g, ""), 10)
        : (typeof rawExp === "number" ? rawExp : 0);

    const evidenceText = typeof ingestData?.evidenceText === "string"
        ? ingestData.evidenceText
        : "";

    return {
        name: typeof content.name === "string" ? content.name : "未填写",
        workExperience: Number.isFinite(parsedExp) ? parsedExp : 0,
        education: typeof content.education === "string"
            ? content.education
            : (typeof content.degree === "string" ? content.degree : "未填写"),
        companies: allCompanies.length > 0 ? allCompanies.slice(0, 8).join(", ") : "未填写",
        evidenceText: evidenceText.trim() || "未填写",
    };
}

// Helper to call OpenAI/Compatible API
export async function callLLM(messages: any[], apiKey: string) {
    const apiBase = getAiApiBase();
    const url = `${apiBase}/chat/completions`;

    console.log(`Calling LLM at ${url}...`);

    const response = await fetch(url, {
        method: "POST",
        headers: {
            "Content-Type": "application/json",
            "Authorization": `Bearer ${apiKey}`,
        },
        body: JSON.stringify({
            model: getAiModel(),
            messages: messages,
            temperature: getAiTemperature(),
            response_format: { type: "json_object" },
        }),
    });

    if (!response.ok) {
        // Handle 502/504 specially possibly?
        const text = await response.text();
        throw new Error(`OpenAI API error: ${response.status} ${response.statusText} - ${text}`);
    }

    const data = await response.json();
    let content = data.choices[0].message.content;

    // Clean markdown code blocks
    content = content.replace(/```json\n?|```/g, "").trim();

    // Attempt to fix common LLM JSON errors (e.g. unquoted keys or english word numbers)
    // This simple regex fixes "score": thirty -> "score": 30 (if mapping exists) or just "score": 0
    // But since we can't easily map all words, let's just quote the value if it looks like a word so JSON.parse passes, then downstream handles it.
    // However, correcting the Prompt is the best fix.
    // Let's try to simple-fix unquoted string values for score to make it valid JSON at least.
    // Match "score": word (no quotes)
    content = content.replace(/"(score|experience|skills|industry_db|education|location)":\s*([a-zA-Z]+)(?=[,}])/g, '"$1": "$2"');

    try {
        const json = JSON.parse(content);
        // Force score to be a number if it's a string like "30"
        if (typeof json.score === 'string') {
            const num = parseInt(json.score);
            if (!isNaN(num)) json.score = num;
        }
        return json;
    } catch (e) {
        console.error("Failed to parse LLM response (raw content):", content.slice(0, 2000));
        throw new Error(`Invalid JSON response from AI: ${content.slice(0, 200)}`);
    }
}

export const analyzeResume = action({
    args: {
        resumeId: v.id("resumes"),
        jobDescription: v.optional(v.object({
            title: v.string(),
            requirements: v.string(),
        })),
        matchingRules: v.optional(v.any()), // New unified config
        jobDescriptionId: v.optional(v.string()), // Added ID
    },
    handler: async (ctx, args) => {
        const apiKey = getAiApiKey();
        if (!apiKey) {
            throw new Error("AI_API_KEY/OPENAI_API_KEY is not set in Convex environment variables.");
        }

        const resume = await ctx.runQuery(internal.resumes.getResume, { resumeId: args.resumeId });

        if (!resume) {
            throw new Error(`Resume not found: ${args.resumeId}`);
        }

        const jd = args.jobDescription || {
            title: "销售经理 (通用)",
            requirements: "具备销售经验，沟通能力强，熟悉机床行业优先。",
        };

        const matchingRules = args.matchingRules ? JSON.stringify(args.matchingRules, null, 2) : "使用默认评分标准";

        // 2. Prepare Prompt
        const locale = resolveAIOutputLocale();
        const norm = normalizeResume(resume);
        const promptTemplate = getUserPromptTemplate(locale);
        const prompt = promptTemplate
            .replace("{jobTitle}", jd.title)
            .replace("{requirements}", jd.requirements)
            .replace("{matchingRules}", matchingRules)
            .replace("{candidateName}", norm.name)
            .replace("{workExperience}", String(norm.workExperience))
            .replace("{education}", norm.education)
            .replace("{evidenceText}", norm.evidenceText)
            .replace("{companies}", norm.companies);

        const messages = [
            { role: "system", content: buildSystemPrompt(locale) },
            { role: "user", content: prompt },
        ];

        // 3. Call LLM
        let result;
        try {
            result = await callLLM(messages, apiKey);
        } catch (e) {
            console.error("LLM Call failed:", e);
            throw new Error("Failed to analyze resume with AI.");
        }

        // 4. Update Resume with result
        await ctx.runMutation(internal.resumes.updateAnalysis, {
            resumeId: args.resumeId,
            analysis: {
                score: result.score,
                breakdown: result.breakdown,
                summary: result.summary,
                highlights: result.highlights || [],
                recommendation: result.recommendation || "no_match",
                jobDescriptionId: args.jobDescriptionId || "default",
                analyzedAt: Date.now(),
            },
        });

        return result;
    },
});

export const analyzeBatch = action({
    args: {
        resumeIds: v.array(v.id("resumes")),
        jobDescription: v.optional(v.object({
            title: v.string(),
            requirements: v.string(),
        })),
        matchingRules: v.optional(v.any()),
        jobDescriptionId: v.optional(v.string()),
    },
    handler: async (ctx, args) => {
        const { resumeIds, jobDescription, matchingRules, jobDescriptionId } = args;

        // Dispatch actions for each resume
        // This runs them securely in background without blocking
        await Promise.all(resumeIds.map(id => {
            return ctx.scheduler.runAfter(0, (internal as any).analyze.analyzeResume, {
                resumeId: id,
                jobDescription,
                matchingRules,
                jobDescriptionId
            });
        }));

        return { count: resumeIds.length, status: "scheduled" };
    }
});
