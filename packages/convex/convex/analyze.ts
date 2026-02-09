import { action } from "./_generated/server";
import { internal } from "./_generated/api";
import { v } from "convex/values";

const SYSTEM_PROMPT = `你是一个专业的HR助手，专门帮助筛选精密机械和机床行业的简历。
你需要根据职位要求对候选人进行评分和分析。

评分标准：
- 90-100分：完美匹配，技能、经验、教育背景完全符合要求
- 70-89分：良好匹配，大部分要求符合，有少量可培养的差距
- 50-69分：潜力候选人，有相关基础但需要培训
- 0-49分：不匹配，基本要求不满足

你必须严格按照JSON格式返回结果，不要包含任何其他文字。`;

const USER_PROMPT_TEMPLATE = `请分析以下候选人与职位的匹配度：

## 职位信息
**职位名称**: {jobTitle}
**职位要求**:
{requirements}

## 候选人信息
**姓名**: {candidateName}
**求职意向**: {jobIntention}
**工作经验**: {workExperience}年
**学历**: {education}
**技能**: {skills}
**曾任职公司**: {companies}
**简介**: {summary}

请以JSON格式返回分析结果，包含以下字段：
{
  "score": 0-100的整数评分,
  "recommendation": "strong_match" 或 "match" 或 "potential" 或 "no_match",
  "highlights": ["匹配亮点1", "匹配亮点2", ...],
  "concerns": ["关注点或不足1", "关注点或不足2", ...],
  "summary": "中文总结，说明匹配原因和建议"
}`;

// Helper to normalize resume data
function normalizeResume(data: any) {
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
async function callLLM(messages: any[], apiKey: string) {
    const response = await fetch("https://api.openai.com/v1/chat/completions", {
        method: "POST",
        headers: {
            "Content-Type": "application/json",
            "Authorization": `Bearer ${apiKey}`,
        },
        body: JSON.stringify({
            model: "gpt-4-turbo-preview", // Or configurable
            messages: messages,
            temperature: 0.1,
            response_format: { type: "json_object" },
        }),
    });

    if (!response.ok) {
        throw new Error(`OpenAI API error: ${response.statusText}`);
    }

    const data = await response.json();
    return JSON.parse(data.choices[0].message.content);
}

export const analyzeResume = action({
    args: {
        resumeId: v.id("resumes"),
        jobDescription: v.optional(v.object({
            title: v.string(),
            requirements: v.string(),
        })),
    },
    handler: async (ctx, args) => {
        const apiKey = process.env.OPENAI_API_KEY;
        if (!apiKey) {
            throw new Error("OPENAI_API_KEY is not set in Convex environment variables.");
        }

        // 1. Fetch resume data (need a query for this, or pass data? safer to fetch)
        // Since actions can't query directly, we need a separate internal query or trust passed data.
        // Best pattern: action calls internalQuery to get data.
        const resume = await ctx.runQuery(internal.resumes.getResume, { resumeId: args.resumeId });

        if (!resume) {
            throw new Error(`Resume not found: ${args.resumeId}`);
        }

        // Default JD if not provided (e.g. general assessment)
        const jd = args.jobDescription || {
            title: "销售经理 (通用)",
            requirements: "具备销售经验，沟通能力强，熟悉机床行业优先。",
        };

        // 2. Prepare Prompt
        const norm = normalizeResume(resume.content);
        let prompt = USER_PROMPT_TEMPLATE
            .replace("{jobTitle}", jd.title)
            .replace("{requirements}", jd.requirements)
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
                summary: result.summary,
                highlights: result.highlights || [],
                recommendation: result.recommendation || "no_match",
            },
        });

        return result;
    },
});
