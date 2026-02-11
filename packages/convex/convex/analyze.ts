import { action } from "./_generated/server";
import { internal } from "./_generated/api";
import { v } from "convex/values";

export const SYSTEM_PROMPT = `你是一个专业的HR助手，专门帮助筛选精密机械和机床行业的简历。
你必须严格按照【纯数字 JSON】格式返回结果。
1. 绝对不要包含 markdown 标记 (如 \`\`\`json ... \`\`\`)。
2. 所有评分字段（score, breakdown.*）必须是【JSON Number 类型】，绝对禁止使用字符串或中文数字（如 "30", "三十", thirty）。
3. 正确示例: "score": 85
4. 错误示例: "score": "85", "score": "eighty-five"
5. 如果无法确切评分，请基于现有信息估算一个数字。`;

export const USER_PROMPT_TEMPLATE = `请分析以下候选人与职位的匹配度：

## 职位信息
**职位名称**: {jobTitle}
**职位要求**:
{requirements}

## 评分规则 (权重与标准)
{matchingRules}

## 候选人信息
**姓名**: {candidateName}
**求职意向**: {jobIntention}
**工作经验**: {workExperience}年
**学历**: {education}
**技能**: {skills}
**曾任职公司**: {companies}
**简介**: {summary}

请以JSON格式返回分析结果，确保 score 为数字类型：
{
  "score": 30, // 必须是0-100的整数数字 (Number)，不要加引号
  "breakdown": {
    "experience": 10, // 数字
    "skills": 5, // 数字
    "industry_db": 5, // 数字
    "education": 5, // 数字
    "location": 5 // 数字
  },
  "recommendation": "strong_match" | "match" | "potential" | "no_match",
  "highlights": ["匹配亮点1", ...],
  "concerns": ["不足之处1", ...],
  "summary": "中文总结"
}`;

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

// Helper to normalize resume data
export function normalizeResume(data: any) {
    return {
        name: data.name || "未填写",
        jobIntention: data.jobIntention || data.desiredPosition || "未填写",
        workExperience: parseInt(data.workExperience) || 0,
        education: data.education || data.degree || "未填写",
        skills: Array.isArray(data.skills) ? data.skills.join(", ") : (data.skills || "未填写"),
        companies: Array.isArray(data.companies) ? data.companies.join(", ") : (data.companyName || "未填写"),
        summary: data.summary || data.selfEvaluation || "无",
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
            model: getAiModel(), // Configurable
            messages: messages,
            temperature: 0.1,
            // strict json mode is often supported but sometimes model-dependent
            // response_format: { type: "json_object" }, 
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
        console.error("Failed to parse LLM response:", content);
        throw new Error("Invalid JSON response from AI");
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
        const norm = normalizeResume(resume.content);
        let prompt = USER_PROMPT_TEMPLATE
            .replace("{jobTitle}", jd.title)
            .replace("{requirements}", jd.requirements)
            .replace("{matchingRules}", matchingRules)
            .replace("{candidateName}", norm.name)
            .replace("{jobIntention}", norm.jobIntention)
            .replace("{workExperience}", String(norm.workExperience))
            .replace("{education}", norm.education)
            .replace("{skills}", norm.skills)
            .replace("{companies}", norm.companies)
            .replace("{summary}", norm.summary);

        const messages = [
            { role: "system", content: SYSTEM_PROMPT },
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
