/// <reference path="./convex-env.d.ts" />
import {
    buildBrandHitsPromptSegments,
    deriveMarketFromSourceKey,
    getResumeAiLocaleText,
    getResumeAiPromptDefinition,
    resolveResumeAnalysisSourceKey,
    sanitizeResumeRecordForSurface,
    isRecord,
    selectLatestWorkHistory,
    type ResumeFieldUsagePolicy,
    type ResumeFieldUsagePolicyOverrides,
} from "@trends/shared";
import { v } from "convex/values";
import { api, internal } from "./_generated/api";
import { action, internalMutation, type ActionCtx } from "./_generated/server";
import { resolveChatCompletionModel } from "./lib/ai_model";
import { doUpsertResumeDigest, doUpsertResumeAnalysis } from "./resumes_search.js";
import { readActiveResumeAnalysis } from "./lib/resume_analysis_read.js";
import { computeProtectedAttributeHashes } from "./audit.js";
import {
    normalizeAnalysisResult,
    parseRoleSignals,
} from "./lib/analysis_normalization.js";
import {
    isEnglishResumeAiLocale,
    formatRoleSignals,
    hydrateUserPrompt,
    buildConfirmPrompt,
} from "./lib/analysis_prompts.js";
import {
    inferSourceKey,
    resolveAIOutputLocale,
    buildSystemPrompt,
    getUserPromptTemplate,
    getAiApiKey,
    getAiApiBase,
    getAiModel,
    getAiTemperature,
    type ChatMessage,
} from "./lib/analysis_config.js";
import { matchingRulesValidator } from "./validators.js";

// Re-export for backward compatibility
export {
    toNumber,
    clamp,
    parseKeyFactors,
    parseNumericBreakdown,
    hasNonEmployerBrandHits,
    hasCompanyHits,
    getResumeIngestData,
    computeDirectIndustryDbScoreFromResume,
    recommendationFromScore,
    hasHanText,
    normalizeSummaryConsistency,
    normalizeAnalysisResult,
    parseRoleSignals,
    INDUSTRY_DB_SCORE_CAP,
    RELATED_EXP_WEIGHT,
} from "./lib/analysis_normalization.js";
export type {
    AnalysisRecommendation,
    KeyFactor,
    NormalizedMatchedWorkEntry,
    NormalizedRoleSignal,
} from "./lib/analysis_normalization.js";
export {
    isEnglishResumeAiLocale,
    hydrateUserPrompt,
    buildKeywordRequirements,
    buildKeywordMatchingRules,
    buildConfirmPrompt,
} from "./lib/analysis_prompts.js";
export {
    inferSourceKey,
    resolveAIOutputLocale,
    buildSystemPrompt,
    getUserPromptTemplate,
    getAiApiKey,
    getAiApiBase,
    getAiModel,
    getAiTemperature,
    SYSTEM_PROMPT,
    USER_PROMPT_TEMPLATE,
} from "./lib/analysis_config.js";
export type { ChatMessage } from "./lib/analysis_config.js";


// Helper to normalize resume data
export function normalizeResume(
    data: unknown,
    options?: {
        locale?: string;
        fieldUsagePolicy?: ResumeFieldUsagePolicy | ResumeFieldUsagePolicyOverrides;
    },
) {
    const localeText = getResumeAiLocaleText(options?.locale);
    const root = isRecord(data) ? data : {};
    const rawContent = isRecord(root.content) ? root.content : root;
    const content = sanitizeResumeRecordForSurface(rawContent, "analysis", options?.fieldUsagePolicy);
    const ingestData = isRecord(root.ingestData)
        ? root.ingestData
        : (isRecord(content.ingestData) ? content.ingestData : undefined);

    const latestWorkHistory = selectLatestWorkHistory(content.workHistory);

    // Extract companies from workHistory since resume content has no "companies" field
    const historyCompanies = latestWorkHistory
        .map((item) => item.companyName)
        .filter((item): item is string => typeof item === "string" && item.length > 0);
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

    const companyHits = Array.isArray(ingestData?.companyHits)
        ? ingestData.companyHits.filter(
            (item: unknown): item is string => typeof item === "string" && item.length > 0
        )
        : [];
    const brandHits = buildBrandHitsPromptSegments({
        brandHits: ingestData?.brandHits,
        brandOrigin: typeof ingestData?.brandOrigin === "string" ? ingestData.brandOrigin : undefined,
        productClass: typeof ingestData?.productClass === "string" ? ingestData.productClass : undefined,
    });
    const roleSignals = parseRoleSignals(ingestData?.roleSignals);
    const explicitMarket = typeof ingestData?.market === "string" ? ingestData.market.trim().toUpperCase() : "";
    const sourceKey = typeof root.sourceKey === "string"
        ? root.sourceKey
        : (typeof content.profileType === "string" ? content.profileType : undefined);
    const source = typeof root.source === "string"
        ? root.source
        : (typeof content.source === "string" ? content.source : undefined);
    const market = explicitMarket === "MY" || explicitMarket === "CN"
        ? explicitMarket
        : deriveMarketFromSourceKey(resolveResumeAnalysisSourceKey({ sourceKey, source }));

    return {
        name: typeof content.name === "string" ? content.name : localeText.emptyFieldLabel,
        workExperience: Number.isFinite(parsedExp) ? parsedExp : 0,
        education: typeof content.education === "string"
            ? content.education
            : (typeof content.degree === "string" ? content.degree : localeText.emptyFieldLabel),
        companies: allCompanies.length > 0 ? allCompanies.slice(0, 8).join(", ") : localeText.emptyFieldLabel,
        evidenceText: evidenceText.trim() || localeText.emptyFieldLabel,
        market,
        roleSignals,
        roleSignalsText: formatRoleSignals(roleSignals, localeText),
        brandHits,
        verifiedCompanies: companyHits,
    };
}

// Helper to compute audit fields from a resume record
function computeAuditFields(resume: Record<string, unknown>) {
    const rawRoot = isRecord(resume) ? resume : {};
    const rawContent = isRecord(rawRoot.content) ? rawRoot.content : rawRoot;
    const scrubbedContent = sanitizeResumeRecordForSurface(rawContent, "analysis");
    const auditContent = sanitizeResumeRecordForSurface(rawContent, "audit");
    const scrubbedFields = Object.keys(rawContent).filter(
        (key) => !(key in scrubbedContent) || scrubbedContent[key] === undefined
    );
    const auditAge = auditContent.age ?? rawRoot.age;
    const protectedHashes = computeProtectedAttributeHashes({
        age: typeof auditAge === "number" ? auditAge : undefined,
        gender: typeof auditContent.gender === "string" ? auditContent.gender : undefined,
        location: typeof rawRoot.source === "string" ? String(rawRoot.source) : undefined,
        source: typeof rawRoot.source === "string" ? rawRoot.source : undefined,
    });
    return { scrubbedFields, protectedHashes };
}

// Helper to call OpenAI/Compatible API
export async function callLLM(messages: ChatMessage[], apiKey: string) {
    const apiBase = getAiApiBase();
    const url = `${apiBase}/chat/completions`;
    const model = resolveChatCompletionModel(apiBase, getAiModel());

    console.debug(`Calling LLM at ${url} with model ${model}...`);

    const response = await fetch(url, {
        method: "POST",
        headers: {
            "Content-Type": "application/json",
            "Authorization": `Bearer ${apiKey}`,
        },
        body: JSON.stringify({
            model,
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

    const data = (await response.json()) as {
        choices: { message: { content: string } }[];
        usage: unknown;
    };
    let content = data.choices[0].message.content;

    // Clean markdown code blocks
    content = content.replace(/```json\n?|```/g, "").trim();

    // Attempt to fix common LLM JSON errors (e.g. unquoted keys or english word numbers)
    // This simple regex fixes "score": thirty -> "score": 30 (if mapping exists) or just "score": 0
    // But since we can't easily map all words, let's just quote the value if it looks like a word so JSON.parse passes, then downstream handles it.
    // However, correcting the Prompt is the best fix.
    // Let's try to simple-fix unquoted string values for score to make it valid JSON at least.
    // Match "score": word (no quotes)
    content = content.replace(/"(score|related_exp|experience|skills|industry_db|education|location)":\s*([a-zA-Z]+)(?=[,}])/g, '"$1": "$2"');

    try {
        const json = JSON.parse(content);
        // Force score to be a number if it's a string like "30"
        if (typeof json.score === 'string') {
            const num = parseInt(json.score);
            if (!isNaN(num)) json.score = num;
        }
        return { content: json, usage: data.usage };
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
        matchingRules: matchingRulesValidator,
        jobDescriptionId: v.optional(v.string()), // Added ID
        keywords: v.optional(v.array(v.string())),
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

        const sourceKey = inferSourceKey(resume.source);
        const locale = resolveAIOutputLocale({ sourceKey });
        const isEnglishLocale = isEnglishResumeAiLocale(locale);

        const jd = args.jobDescription || {
            title: isEnglishLocale ? "Sales Manager (General)" : "销售经理 (通用)",
            requirements: isEnglishLocale
                ? "Sales experience, strong communication, and machine-tool industry familiarity preferred."
                : "具备销售经验，沟通能力强，熟悉机床行业优先。",
        };

        const matchingRules = args.matchingRules
            ? JSON.stringify(args.matchingRules, null, 2)
            : (isEnglishLocale ? "Use the default scoring rules." : "使用默认评分标准");
        const promptVersion = getResumeAiPromptDefinition(locale).metadata.version;
        const norm = normalizeResume(resume, { locale });
        const prompt = hydrateUserPrompt(
            getUserPromptTemplate(locale),
            { title: jd.title, requirements: jd.requirements, matchingRules },
            norm,
            locale,
        );

        const messages: ChatMessage[] = [
            { role: "system", content: buildSystemPrompt(locale) },
            { role: "user", content: prompt },
        ];

        // 3. Call LLM
        let rawResult;
        try {
            rawResult = (await callLLM(messages, apiKey)).content;
        } catch (e) {
            console.error("LLM Call failed:", e);
            throw new Error("Failed to analyze resume with AI.");
        }
        const result = normalizeAnalysisResult(
            isRecord(rawResult) ? rawResult : {},
            resume,
        );

        // 4. Update Resume with result
        await ctx.runMutation(internal.resumes_mutations.updateAnalysis, {
            resumeId: args.resumeId,
            analysis: {
                score: result.score,
                breakdown: result.breakdown,
                summary: result.summary,
                highlights: result.highlights || [],
                recommendation: result.recommendation || "no_match",
                keyFactors: result.keyFactors.length > 0 ? result.keyFactors : undefined,
                jobDescriptionId: args.jobDescriptionId || "default",
                promptVersion,
                locale,
                analyzedAt: Date.now(),
            },
        });

        // 5. Audit log — EU AI Act compliance
        try {
            const { scrubbedFields, protectedHashes } = computeAuditFields(resume as Record<string, unknown>);

            const auditLogId = await ctx.runMutation(internal.audit.logAnalysisDecision, {
                resumeId: args.resumeId,
                identityKey: resume.identityKey ?? undefined,
                workspaceSlug: resume.sourceKey ?? "default",
                decisionType: "score",
                actionRef: "analyze:analyzeResume",
                inputSnapshot: {
                    jobDescriptionId: args.jobDescriptionId,
                    promptVersion: String(promptVersion),
                    scrubbedFields: scrubbedFields.length > 0 ? scrubbedFields : undefined,
                    searchKeywords: args.keywords,
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
                explanation: {
                    summary: `Scored ${result.score}/100 against "${jd.title}". ${result.summary || ""}`,
                    keyFactors: result.keyFactors.length > 0
                        ? result.keyFactors
                        : (result.highlights || []).slice(0, 4).map((h: string) => ({
                            factor: "highlight",
                            value: h,
                        })),
                },
                decidedAt: Date.now(),
                actorId: "system",
                actorRole: "system",
            });

            // Auto-set outcome to "accepted" for successful score decisions
            // (Human overrides via setAuditOutcome mutation still possible)
            await ctx.runMutation(api.audit.setAuditOutcome, {
                auditLogId,
                outcome: "accepted",
                setBy: "system:analyzeResume",
            });
        } catch (auditError) {
            // Audit logging failure must NOT block the analysis result
            console.error("Audit logging failed:", auditError);
        }

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
        matchingRules: matchingRulesValidator,
        jobDescriptionId: v.optional(v.string()),
        keywords: v.optional(v.array(v.string())),
    },
    handler: async (ctx, args) => {
        const { resumeIds, jobDescription, matchingRules, jobDescriptionId, keywords } = args;

        // Dispatch actions for each resume
        // This runs them securely in background without blocking
        await Promise.all(resumeIds.map(id => {
            // analyzeResume is an action; the generated internal API types only expose mutations/queries
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            return ctx.scheduler.runAfter(0, (internal as any).analyze.analyzeResume, {
                resumeId: id,
                jobDescription,
                matchingRules,
                jobDescriptionId,
                ...(keywords ? { keywords } : {}),
            });
        }));

        return { count: resumeIds.length, status: "scheduled" };
    }
});

/**
 * Wrapper around callLLM that records token usage for cost tracking.
 * Checks budget before calling and records usage afterward.
 * Throws if budget is exhausted.
 */
export async function callLLMWithTracking(
    ctx: ActionCtx,
    messages: ChatMessage[],
    apiKey: string,
    workspaceId: string,
): Promise<Record<string, unknown>> {
    // Check budget
    const budget = await ctx.runQuery(api.llm_cost.getBudget, { workspaceId });
    if (budget.remainingTokens <= 0) {
        throw new Error(`LLM budget exhausted for workspace ${workspaceId}: ${budget.remainingTokens} tokens remaining`);
    }

    const { content: result, usage } = await callLLM(messages, apiKey);

    // Record actual token usage from the API response
    const inputTokens = (usage as Record<string, unknown>)?.prompt_tokens as number ?? 0;
    const outputTokens = (usage as Record<string, unknown>)?.completion_tokens as number ?? 0;

    if (inputTokens > 0 || outputTokens > 0) {
        await ctx.runMutation(internal.llm_cost.recordUsage, {
            workspaceId,
            inputTokens,
            outputTokens,
        });
    }

    return result;
}

/**
 * Store a confirm analysis result in the analyses map without overwriting
 * the top-level `analysis` field (which holds the primary JD-based score).
 */
export const storeConfirmResult = internalMutation({
    args: {
        resumeId: v.id("resumes"),
        analysis: v.object({
            score: v.number(),
            summary: v.string(),
            highlights: v.array(v.string()),
            recommendation: v.string(),
            breakdown: v.optional(v.record(v.string(), v.number())),
            keyFactors: v.optional(v.array(v.object({
                factor: v.string(),
                weight: v.optional(v.number()),
                value: v.string(),
            }))),
            jobDescriptionId: v.optional(v.string()),
            promptVersion: v.number(),
            locale: v.string(),
            queryLocation: v.optional(v.string()),
            analyzedAt: v.number(),
        }),
    },
    handler: async (ctx, args) => {
        const resume = await ctx.db.get(args.resumeId);
        if (!resume) throw new Error("Resume not found");
        const confirmKey = `confirm:${args.analysis.analyzedAt}`;
        // Phase 4 Step 3a: source the cached analyses map from the active cold
        // row (legacy hot fallback); stop writing analyses onto the hot doc.
        // confirmedScore/confirmedAt are separate hot fields and stay.
        const activeAnalysis = await readActiveResumeAnalysis(ctx, resume);
        const analyses = {
            ...(activeAnalysis.analyses ?? {}),
            [confirmKey]: args.analysis,
        };
        await ctx.db.patch(args.resumeId, {
            confirmedScore: args.analysis.score,
            confirmedAt: args.analysis.analyzedAt,
        });
        // Cold row authoritative. Preserve the existing primary `analysis`
        // (the JD-based result) — do NOT overwrite it with the confirm result,
        // which carries keyFactors not allowed by resumeAnalysisValidator and
        // would clobber the primary analysis. The confirm entry lives in the
        // `analyses` map under confirmKey. Matches the pre-3a contract.
        await doUpsertResumeAnalysis(ctx, args.resumeId, activeAnalysis.analysis, analyses);

        // Phase 3: refresh digest display fields (displayConfirmedScore etc.)
        const updated = await ctx.db.get(args.resumeId);
        if (updated) {
            await doUpsertResumeDigest(ctx, updated);
        }
    },
});

/**
 * Confirm AI scores for a set of search result resumes.
 * Takes top-K resume IDs, re-scores them with a lightweight confirm prompt,
 * and stores the confirm result alongside the original analysis.
 * Cost-gated: limited by daily budget and max confirms per search session.
 */
export const confirmSearchResults = action({
    args: {
        workspaceId: v.string(),
        resumeIds: v.array(v.id("resumes")),
        query: v.string(),
    },
    handler: async (ctx: ActionCtx, args) => {
        const apiKey = getAiApiKey();
        if (!apiKey) {
            throw new Error("AI_API_KEY/OPENAI_API_KEY is not set in Convex environment variables.");
        }

        // Check confirm budget
        const budget = await ctx.runQuery(api.llm_cost.getBudget, { workspaceId: args.workspaceId }) as { remainingConfirms: number; remainingTokens: number };
        if (budget.remainingConfirms <= 0) {
            return {
                confirmed: 0,
                skipped: args.resumeIds.length,
                reason: "confirm_budget_exhausted",
                budget: { remainingConfirms: 0, remainingTokens: budget.remainingTokens },
            };
        }

        // Take top N (respect remaining budget and max confirms)
        const maxConfirms = Math.min(budget.remainingConfirms, args.resumeIds.length, 10);
        const confirmIds = args.resumeIds.slice(0, maxConfirms);

        const results: Array<{ resumeId: string; confirmedScore: number; confirmedRecommendation: string; error?: string }> = [];
        let totalConfirmed = 0;

        for (const resumeId of confirmIds) {
            try {
                const resume = await ctx.runQuery(internal.resumes.getResume, { resumeId });
                if (!resume) {
                    results.push({ resumeId, confirmedScore: 0, confirmedRecommendation: "no_match", error: "not_found" });
                    continue;
                }

                const messages: ChatMessage[] = [
                    {
                        role: "system",
                        content: "You are a resume relevance evaluator. Rate how well the resume matches the search query. Respond with JSON only.",
                    },
                    {
                        role: "user",
                        content: buildConfirmPrompt(resume, args.query),
                    },
                ];

                const rawResult = await callLLMWithTracking(ctx, messages, apiKey, args.workspaceId);
                const analysis = normalizeAnalysisResult(
                    isRecord(rawResult) ? rawResult : {},
                    resume,
                );

                // Store confirm result in analyses map without overwriting primary analysis
                await ctx.runMutation(internal.analyze.storeConfirmResult, {
                    resumeId,
                    analysis: {
                        score: analysis.score,
                        breakdown: analysis.breakdown,
                        summary: analysis.summary,
                        highlights: analysis.highlights || [],
                        recommendation: analysis.recommendation,
                        promptVersion: 1,
                        locale: "zh-Hans",
                        analyzedAt: Date.now(),
                    },
                });

                // Audit log — EU AI Act compliance for confirm decisions
                try {
                    const { scrubbedFields, protectedHashes } = computeAuditFields(resume as Record<string, unknown>);

                    const auditLogId = await ctx.runMutation(internal.audit.logAnalysisDecision, {
                        resumeId,
                        identityKey: resume.identityKey ?? undefined,
                        workspaceSlug: args.workspaceId,
                        decisionType: "confirm",
                        actionRef: "analyze:confirmSearchResults",
                        inputSnapshot: {
                            searchKeywords: [args.query],
                            scrubbedFields: scrubbedFields.length > 0 ? scrubbedFields : undefined,
                        },
                        modelMeta: {
                            model: getAiModel(),
                            provider: "openai",
                            apiBase: getAiApiBase(),
                        },
                        output: {
                            score: analysis.score,
                            recommendation: analysis.recommendation,
                        },
                        protectedAttributeHashes: protectedHashes,
                        explanation: {
                            summary: `Confirmed score ${analysis.score}/100 for query "${args.query}". ${analysis.summary || ""}`,
                            keyFactors: analysis.keyFactors.length > 0
                                ? analysis.keyFactors
                                : (analysis.highlights || []).slice(0, 4).map((h: string) => ({
                                    factor: "highlight",
                                    value: h,
                                })),
                        },
                        decidedAt: Date.now(),
                        actorId: "system",
                        actorRole: "system",
                    });

                    // Mark confirm audit outcome as accepted — human confirmed the decision
                    await ctx.runMutation(api.audit.setAuditOutcome, {
                        auditLogId,
                        outcome: "accepted",
                        setBy: "system:confirmSearchResults",
                    });
                } catch (auditError) {
                    // Audit logging failure must NOT block the confirm result
                    console.error("Audit logging failed for confirm:", auditError);
                }

                totalConfirmed++;

                results.push({
                    resumeId,
                    confirmedScore: analysis.score,
                    confirmedRecommendation: analysis.recommendation,
                });
            } catch (e) {
                console.error(`Confirm failed for resume ${resumeId}:`, e);
                results.push({
                    resumeId,
                    confirmedScore: 0,
                    confirmedRecommendation: "no_match",
                    error: String(e),
                });
            }
        }

        // Batch confirm count into single recordUsage call to avoid race conditions
        if (totalConfirmed > 0) {
            await ctx.runMutation(internal.llm_cost.recordUsage, {
                workspaceId: args.workspaceId,
                inputTokens: 0,
                outputTokens: 0,
                confirmCount: totalConfirmed,
            });
        }

        return {
            confirmed: results.filter((r) => !r.error).length,
            skipped: args.resumeIds.length - maxConfirms,
            budget: { remainingConfirms: budget.remainingConfirms - maxConfirms, remainingTokens: budget.remainingTokens },
            results,
        };
    },
});
