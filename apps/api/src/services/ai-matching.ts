/**
 * AI Matching Service
 *
 * Uses LLM for resume-job description matching
 * Compatible with OpenAI API and Poe.com proxy
 */

import { aiConfig, validateAIConfig, getMaskedApiKey } from "./ai-config.js";

// Types
export interface MatchingRequest {
    resume: {
        id: string;
        name: string;
        jobIntention?: string;
        workExperience?: number;
        education?: string;
        skills?: string[];
        companies?: string[];
        summary?: string;
    };
    jobDescription: {
        title: string;
        requirements: string;
        responsibilities?: string;
        company?: string;
    };
    criteria?: {
        requiredSkills?: string[];
        preferredSkills?: string[];
        minExperience?: number;
        educationLevel?: string;
    };
}

export interface MatchingResult {
    score: number; // 0-100
    recommendation: "strong_match" | "match" | "potential" | "no_match";
    highlights: string[]; // Matching points
    concerns: string[]; // Missing or concerning points
    summary: string; // AI-generated summary in Chinese
    rawResponse?: string; // For debugging
}

export interface BatchMatchingResult {
    results: Array<{ resumeId: string; result: MatchingResult }>;
    processedCount: number;
    failedCount: number;
    processingTimeMs: number;
}

// Prompt templates
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

{additionalCriteria}

请以JSON格式返回分析结果，包含以下字段：
{
  "score": 0-100的整数评分,
  "recommendation": "strong_match" 或 "match" 或 "potential" 或 "no_match",
  "highlights": ["匹配亮点1", "匹配亮点2", ...],
  "concerns": ["关注点或不足1", "关注点或不足2", ...],
  "summary": "中文总结，说明匹配原因和建议"
}`;

/**
 * AI Matching Service class
 */
export class AIMatchingService {
    private readonly baseUrl: string;
    private readonly headers: Record<string, string>;

    constructor() {
        // Use apiBase if provided, otherwise construct from model provider
        this.baseUrl = aiConfig.apiBase || "https://api.openai.com/v1";

        this.headers = {
            "Content-Type": "application/json",
            Authorization: `Bearer ${aiConfig.apiKey}`,
        };
    }

    /**
     * Check if AI service is available
     */
    isAvailable(): { available: boolean; reason?: string } {
        const validation = validateAIConfig();
        if (!validation.valid) {
            return { available: false, reason: validation.error };
        }
        return { available: true };
    }

    /**
     * Get service info for debugging
     */
    getServiceInfo(): {
        enabled: boolean;
        model: string;
        apiBase: string;
        apiKeyMasked: string;
    } {
        return {
            enabled: aiConfig.enabled,
            model: aiConfig.model,
            apiBase: this.baseUrl,
            apiKeyMasked: getMaskedApiKey(),
        };
    }

    /**
     * Match a single resume against a job description
     */
    async matchResume(request: MatchingRequest): Promise<MatchingResult> {
        const availability = this.isAvailable();
        if (!availability.available) {
            return {
                score: 0,
                recommendation: "no_match",
                highlights: [],
                concerns: [availability.reason || "AI service unavailable"],
                summary: "AI匹配服务不可用",
            };
        }

        const userPrompt = this.buildPrompt(request);
        const messages = [
            { role: "system", content: SYSTEM_PROMPT },
            { role: "user", content: userPrompt },
        ];

        try {
            const response = await this.callLLM(messages);
            return this.parseResponse(response);
        } catch (error) {
            const errorMessage = error instanceof Error ? error.message : String(error);
            console.error("[AI Matching] Error:", errorMessage);
            return {
                score: 0,
                recommendation: "no_match",
                highlights: [],
                concerns: [`AI分析失败: ${errorMessage}`],
                summary: "AI分析过程中发生错误",
                rawResponse: errorMessage,
            };
        }
    }

    /**
     * Batch match multiple resumes
     */
    async matchBatch(
        resumes: MatchingRequest["resume"][],
        jobDescription: MatchingRequest["jobDescription"],
        criteria?: MatchingRequest["criteria"]
    ): Promise<BatchMatchingResult> {
        const startTime = Date.now();
        const results: BatchMatchingResult["results"] = [];
        let failedCount = 0;

        for (const resume of resumes) {
            try {
                const result = await this.matchResume({
                    resume,
                    jobDescription,
                    criteria,
                });
                results.push({ resumeId: resume.id, result });
            } catch {
                failedCount++;
                results.push({
                    resumeId: resume.id,
                    result: {
                        score: 0,
                        recommendation: "no_match",
                        highlights: [],
                        concerns: ["处理失败"],
                        summary: "简历处理失败",
                    },
                });
            }
        }

        return {
            results,
            processedCount: resumes.length,
            failedCount,
            processingTimeMs: Date.now() - startTime,
        };
    }

    /**
     * Build the prompt from request
     */
    private buildPrompt(request: MatchingRequest): string {
        const { resume, jobDescription, criteria } = request;

        let additionalCriteria = "";
        if (criteria) {
            const parts: string[] = [];
            if (criteria.requiredSkills?.length) {
                parts.push(`**必须技能**: ${criteria.requiredSkills.join(", ")}`);
            }
            if (criteria.preferredSkills?.length) {
                parts.push(`**优先技能**: ${criteria.preferredSkills.join(", ")}`);
            }
            if (criteria.minExperience) {
                parts.push(`**最低经验**: ${criteria.minExperience}年`);
            }
            if (criteria.educationLevel) {
                parts.push(`**学历要求**: ${criteria.educationLevel}`);
            }
            if (parts.length > 0) {
                additionalCriteria = "## 额外筛选条件\n" + parts.join("\n");
            }
        }

        return USER_PROMPT_TEMPLATE.replace("{jobTitle}", jobDescription.title)
            .replace("{requirements}", jobDescription.requirements)
            .replace("{candidateName}", resume.name)
            .replace("{jobIntention}", resume.jobIntention || "未填写")
            .replace("{workExperience}", String(resume.workExperience || 0))
            .replace("{education}", resume.education || "未填写")
            .replace("{skills}", resume.skills?.join(", ") || "未填写")
            .replace("{companies}", resume.companies?.join(", ") || "未填写")
            .replace("{summary}", resume.summary || "无")
            .replace("{additionalCriteria}", additionalCriteria);
    }

    /**
     * Call the LLM API
     */
    private async callLLM(
        messages: Array<{ role: string; content: string }>
    ): Promise<string> {
        // Extract model name (remove provider prefix for some APIs)
        const modelParts = aiConfig.model.split("/");
        const modelName = modelParts.length > 1 ? modelParts.slice(1).join("/") : aiConfig.model;

        const requestBody = {
            model: modelName,
            messages,
            temperature: aiConfig.temperature,
            max_tokens: aiConfig.maxTokens,
        };

        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), aiConfig.timeout);

        try {
            const response = await fetch(`${this.baseUrl}/chat/completions`, {
                method: "POST",
                headers: this.headers,
                body: JSON.stringify(requestBody),
                signal: controller.signal,
            });

            clearTimeout(timeoutId);

            if (!response.ok) {
                const errorText = await response.text();
                throw new Error(`API error ${response.status}: ${errorText}`);
            }

            const data = await response.json() as {
                choices?: Array<{ message?: { content?: string }; text?: string }>;
            };

            // Extract content from OpenAI-compatible response
            const content = data?.choices?.[0]?.message?.content ?? data?.choices?.[0]?.text;
            if (!content) {
                throw new Error("No content in API response");
            }

            return content;
        } catch (error) {
            clearTimeout(timeoutId);
            if (error instanceof Error && error.name === "AbortError") {
                throw new Error(`Request timeout after ${aiConfig.timeout}ms`);
            }
            throw error;
        }
    }

    /**
     * Parse the LLM response into MatchingResult
     */
    private parseResponse(response: string): MatchingResult {
        try {
            // Extract JSON from response (handle markdown code blocks)
            let jsonText = response.trim();

            // Remove markdown code blocks if present
            if (jsonText.includes("```json")) {
                const start = jsonText.indexOf("```json") + 7;
                const end = jsonText.lastIndexOf("```");
                jsonText = jsonText.slice(start, end).trim();
            } else if (jsonText.includes("```")) {
                const start = jsonText.indexOf("```") + 3;
                const end = jsonText.lastIndexOf("```");
                jsonText = jsonText.slice(start, end).trim();
            }

            // Find JSON object in text
            const jsonStart = jsonText.indexOf("{");
            const jsonEnd = jsonText.lastIndexOf("}");
            if (jsonStart !== -1 && jsonEnd !== -1 && jsonEnd > jsonStart) {
                jsonText = jsonText.slice(jsonStart, jsonEnd + 1);
            }

            const parsed = JSON.parse(jsonText);

            // Validate and normalize
            const score = Math.max(0, Math.min(100, parseInt(parsed.score, 10) || 0));
            const recommendation = this.normalizeRecommendation(parsed.recommendation, score);

            return {
                score,
                recommendation,
                highlights: Array.isArray(parsed.highlights) ? parsed.highlights : [],
                concerns: Array.isArray(parsed.concerns) ? parsed.concerns : [],
                summary: parsed.summary || "无分析结果",
                rawResponse: response,
            };
        } catch (error) {
            console.error("[AI Matching] Parse error:", error);
            return {
                score: 0,
                recommendation: "no_match",
                highlights: [],
                concerns: ["AI响应解析失败"],
                summary: "无法解析AI返回结果",
                rawResponse: response,
            };
        }
    }

    /**
     * Normalize recommendation based on score
     */
    private normalizeRecommendation(
        rec: string | undefined,
        score: number
    ): MatchingResult["recommendation"] {
        // If valid recommendation provided, use it
        const validRecs = ["strong_match", "match", "potential", "no_match"];
        if (rec && validRecs.includes(rec)) {
            return rec as MatchingResult["recommendation"];
        }

        // Otherwise derive from score
        if (score >= 90) return "strong_match";
        if (score >= 70) return "match";
        if (score >= 50) return "potential";
        return "no_match";
    }
}

// Singleton instance
export const aiMatchingService = new AIMatchingService();
