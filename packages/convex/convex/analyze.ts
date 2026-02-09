import { action } from "./_generated/server";
import { internal } from "./_generated/api";
import { v } from "convex/values";

const SYSTEM_PROMPT = `你是一个专业的HR助手，专门帮助筛选精密机械和机床行业的简历。
你必须严格按照JSON格式返回结果。
1. 不要包含 markdown 代码块标记 (如 \`\`\`json ... \`\`\`)。
2. 所有评分字段（score, breakdown.*）必须是数字（Number），绝对不要使用中文数字或字符串。
3. 如果无法确切评分，请基于现有信息估算。
4. 返回纯文本 JSON，不要有任何前缀或后缀。`;

const USER_PROMPT_TEMPLATE = `请分析以下候选人与职位的匹配度：

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

请以JSON格式返回分析结果，包含以下字段：
{
  "score": (0-100的整数数字),
  "breakdown": {
    "experience": (数字评分),
    "skills": (数字评分),
    "industry_db": (数字评分),
    "education": (数字评分),
    "location": (数字评分)
  },
  "recommendation": "strong_match" | "match" | "potential" | "no_match",
  "highlights": ["匹配亮点1", ...],
  "concerns": ["不足之处1", ...],
  "summary": "中文总结"
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
    const apiBase = process.env.OPENAI_API_BASE || "https://api.openai.com/v1";
    const url = `${apiBase}/chat/completions`;

    console.log(`Calling LLM at ${url}...`);

    const response = await fetch(url, {
        method: "POST",
        headers: {
            "Content-Type": "application/json",
            "Authorization": `Bearer ${apiKey}`,
        },
        body: JSON.stringify({
            model: process.env.OPENAI_MODEL || "gpt-4-turbo-preview", // Configurable
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
    },
    handler: async (ctx, args) => {
        const apiKey = process.env.OPENAI_API_KEY;
        if (!apiKey) {
            throw new Error("OPENAI_API_KEY is not set in Convex environment variables.");
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
    },
    handler: async (ctx, args) => {
        const { resumeIds, jobDescription, matchingRules } = args;

        // Dispatch actions for each resume
        // This runs them securely in background without blocking
        await Promise.all(resumeIds.map(id => {
            return ctx.scheduler.runAfter(0, (internal as any).analyze.analyzeResume, {
                resumeId: id,
                jobDescription,
                matchingRules
            });
        }));

        return { count: resumeIds.length, status: "scheduled" };
    }
});
