import {
    buildResumeAnalysisStorageKey,
    computeRelatedExpContribution,
    resolveResumeAnalysisSourceKey,
} from "@trends/shared";

import type { Doc, Id } from "../_generated/dataModel.js";
import type { QueryCtx } from "../_generated/server.js";
import { inferSourceKey, resolveAIOutputLocale } from "../analyze.js";
import { getActiveColdAnalysisRow } from "./resume_analysis_read.js";
import {
    collectResumeIdentityAliases,
    deriveResumeIdentityKey,
} from "./resume_identity.js";

export type ExactTaskMetadata = {
    targetResumeIds: Id<"resumes">[];
    targetAnalysisIdentities: ExactAnalysisIdentity[];
    targetAnalysisIdentityByResumeId: ReadonlyMap<string, ExactAnalysisIdentity>;
    expectedJobDescriptionId: string;
    expectedPromptVersion: number;
    dispatchedAt: number;
};

export type CompletedExactTaskAuditMetadata = ExactTaskMetadata & {
    taskId: string;
    status: "completed";
    dispatchMode: "exact";
    workspaceSlug: string;
    completedAt: number;
    targetCount: number;
};

export type ExactAnalysisIdentity = {
    resumeId: Id<"resumes">;
    sourceKey: string;
    locale: string;
    expectedAnalysisKey: string;
};

export type ExactTaskAuditAnalysisState =
    | "ready"
    | "not_targeted"
    | "cold_row_missing"
    | "analysis_map_missing"
    | "analysis_key_missing"
    | "job_description_mismatch"
    | "prompt_version_mismatch"
    | "timestamp_missing"
    | "not_newer_than_dispatch";

export type ExactTaskAuditRow = {
    currentResumeId: string;
    canonicalIdentityKey: string;
    externalId: string;
    profileResumeId?: string;
    profileUrl?: string;
    source: string;
    sourceKey: string;
    workspaceSlug: string;
    name?: string;
    age?: string | number;
    location?: string;
    taskId: string;
    taskStatus: "completed";
    taskWorkspaceSlug: string;
    taskDispatchedAt: number;
    taskCompletedAt: number;
    expectedJobDescriptionId: string;
    expectedPromptVersion: number;
    expectedAnalysisKey: string;
    exactCohortMember: boolean;
    analysisState: ExactTaskAuditAnalysisState;
    analysisReasons: ExactTaskAuditAnalysisState[];
    currentAnalysisKey?: string;
    currentJobDescriptionId?: string;
    currentPromptVersion?: number;
    currentLocale?: string;
    currentQueryLocation?: string;
    currentAnalyzedAt?: number;
    finalAiScore?: number;
    currentRecommendation?: string;
    currentBreakdown?: Record<string, number>;
    relatedExpAuditFactor?: number;
    relatedExpContribution?: number;
    industryDbContribution?: number;
    currentAISummary?: string;
    currentHighlights?: string[];
    currentConcerns?: string[];
    currentKeyFactors?: Array<{
        factor: string;
        weight?: number;
        value: string;
    }>;
    evidenceBandMax?: number;
    relatedExpCoverage?: string;
    missingReasons?: string[];
    effectiveRelatedExp?: number;
    llmRelatedExp?: number;
    recommendationMax?: number;
    relatedExpContextHash?: string;
    relatedExpRubricVersion?: string;
    brandHits?: NonNullable<Doc<"resumes">["ingestData"]>["brandHits"];
    brandOrigin?: NonNullable<Doc<"resumes">["ingestData"]>["brandOrigin"];
    productClass?: NonNullable<Doc<"resumes">["ingestData"]>["productClass"];
    companyHits?: string[];
    roleSignals?: NonNullable<Doc<"resumes">["ingestData"]>["roleSignals"];
    matchedWorkEntries?: Array<{
        companyName?: string;
        jobTitle?: string;
        years: number;
        industryVerified: boolean;
        matchedSignals: string[];
        directRoleMatch?: boolean;
    }>;
    evidenceText?: string;
    market?: string;
    ruleScores?: Record<string, number>;
    ruleScore?: number;
};

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readString(record: Record<string, unknown>, keys: string[]): string | undefined {
    for (const key of keys) {
        const value = record[key];
        if (typeof value === "string" && value.trim().length > 0) {
            return value.trim();
        }
    }
    return undefined;
}

function readAge(content: Record<string, unknown>, fallback: number | undefined): string | number | undefined {
    const value = content.age;
    if (typeof value === "string" && value.trim().length > 0) {
        return value.trim();
    }
    if (typeof value === "number" && Number.isFinite(value)) {
        return value;
    }
    return fallback;
}

export function resolveExactTaskMetadata(
    task: Doc<"analysis_tasks">,
    workspaceSlug: string,
): ExactTaskMetadata {
    if (task.dispatchMode !== "exact") {
        throw new Error(`Analysis task ${String(task._id)} is not an exact dispatch`);
    }
    if (!task.workspaceSlug?.trim() || task.workspaceSlug !== workspaceSlug) {
        throw new Error(
            `Analysis task workspace ${task.workspaceSlug ?? "unknown"} does not match ${workspaceSlug}`,
        );
    }

    const targetResumeIds = task.targetResumeIds;
    const targetAnalysisIdentities = task.targetAnalysisIdentities;
    const expectedJobDescriptionId = task.config.jobDescriptionId?.trim();
    const expectedPromptVersion = task.config.promptVersion;
    const dispatchedAt = task.dispatchedAt;
    if (!targetResumeIds?.length
        || !expectedJobDescriptionId
        || expectedPromptVersion === undefined
        || dispatchedAt === undefined) {
        throw new Error(`Exact analysis task ${String(task._id)} is missing verification metadata`);
    }

    if (!targetAnalysisIdentities?.length) {
        throw new Error(`Exact analysis task ${String(task._id)} is missing immutable target analysis identities`);
    }
    if (new Set(targetResumeIds.map(String)).size !== targetResumeIds.length) {
        throw new Error(`Exact analysis task ${String(task._id)} has duplicate target resume IDs`);
    }
    if (targetAnalysisIdentities.length !== targetResumeIds.length) {
        throw new Error(`Exact analysis task ${String(task._id)} has incomplete immutable target analysis identities`);
    }

    const targetAnalysisIdentityByResumeId = new Map<string, ExactAnalysisIdentity>();
    for (let index = 0; index < targetResumeIds.length; index += 1) {
        const targetResumeId = targetResumeIds[index];
        const identity = targetAnalysisIdentities[index];
        const identityResumeId = identity?.resumeId;
        const sourceKey = identity?.sourceKey?.trim();
        const locale = identity?.locale?.trim();
        const expectedAnalysisKey = identity?.expectedAnalysisKey?.trim();
        if (!identityResumeId || !sourceKey || !locale || !expectedAnalysisKey) {
            throw new Error(`Exact analysis task ${String(task._id)} has malformed immutable target analysis identities`);
        }
        if (String(identityResumeId) !== String(targetResumeId)) {
            const targetIds = new Set(targetResumeIds.map(String));
            if (!targetIds.has(String(identityResumeId))) {
                throw new Error(`Exact analysis task ${String(task._id)} has a foreign immutable target analysis identity`);
            }
            throw new Error(`Exact analysis task ${String(task._id)} has unordered immutable target analysis identities`);
        }
        if (targetAnalysisIdentityByResumeId.has(String(identityResumeId))) {
            throw new Error(`Exact analysis task ${String(task._id)} has duplicate immutable target analysis identities`);
        }
        if (buildResumeAnalysisStorageKey(expectedJobDescriptionId, { sourceKey, locale }) !== expectedAnalysisKey) {
            throw new Error(`Exact analysis task ${String(task._id)} has an inconsistent immutable target analysis identity key`);
        }
        targetAnalysisIdentityByResumeId.set(String(identityResumeId), {
            resumeId: identityResumeId,
            sourceKey,
            locale,
            expectedAnalysisKey,
        });
    }

    return {
        targetResumeIds,
        targetAnalysisIdentities: Array.from(targetAnalysisIdentityByResumeId.values()),
        targetAnalysisIdentityByResumeId,
        expectedJobDescriptionId,
        expectedPromptVersion,
        dispatchedAt,
    };
}

export function resolveCompletedExactTaskAuditMetadata(
    task: Doc<"analysis_tasks">,
    workspaceSlug: string,
): CompletedExactTaskAuditMetadata {
    const metadata = resolveExactTaskMetadata(task, workspaceSlug);
    if (task.status !== "completed") {
        throw new Error(`Exact analysis task ${String(task._id)} must be completed for audit export`);
    }
    if (task.completedAt === undefined || !Number.isFinite(task.completedAt)) {
        throw new Error(`Exact analysis task ${String(task._id)} is missing completion metadata`);
    }
    if (!Number.isFinite(metadata.dispatchedAt)
        || !Number.isInteger(metadata.expectedPromptVersion)) {
        throw new Error(`Exact analysis task ${String(task._id)} has invalid verification metadata`);
    }
    const uniqueTargetCount = new Set(metadata.targetResumeIds.map(String)).size;
    if (uniqueTargetCount !== metadata.targetResumeIds.length
        || task.config.resumeCount !== metadata.targetResumeIds.length) {
        throw new Error(`Exact analysis task ${String(task._id)} has inconsistent target count metadata`);
    }

    return {
        ...metadata,
        taskId: String(task._id),
        status: "completed",
        dispatchMode: "exact",
        workspaceSlug,
        completedAt: task.completedAt,
        targetCount: metadata.targetResumeIds.length,
    };
}

export function createExactAnalysisIdentity(
    expectedJobDescriptionId: string,
    resume: Pick<Doc<"resumes">, "_id" | "source">,
): ExactAnalysisIdentity {
    const sourceKey = resolveResumeAnalysisSourceKey({ source: resume.source }) ?? "unknown";
    const locale = resolveAIOutputLocale({ sourceKey: inferSourceKey(resume.source) }).trim();
    if (!locale) {
        throw new Error(`Exact analysis resume ${String(resume._id)} has no dispatch-time analysis locale`);
    }
    return {
        resumeId: resume._id,
        sourceKey,
        locale,
        expectedAnalysisKey: buildResumeAnalysisStorageKey(expectedJobDescriptionId, {
            sourceKey,
            locale,
        }),
    };
}

export function resolveExactAnalysisIdentity(
    metadata: ExactTaskMetadata,
    resumeId: Id<"resumes">,
): ExactAnalysisIdentity {
    const identity = metadata.targetAnalysisIdentityByResumeId.get(String(resumeId));
    if (!identity) {
        throw new Error(`Exact analysis task target ${String(resumeId)} is missing an immutable analysis identity`);
    }
    return identity;
}

function actualAnalysisProvenance(
    expectedAnalysisKey: string,
    analysis: NonNullable<Doc<"resume_analyses">["analyses"]>[string],
) {
    return {
        currentAnalysisKey: expectedAnalysisKey,
        ...(analysis.jobDescriptionId ? { currentJobDescriptionId: analysis.jobDescriptionId } : {}),
        ...(analysis.promptVersion !== undefined ? { currentPromptVersion: analysis.promptVersion } : {}),
        ...(analysis.locale ? { currentLocale: analysis.locale } : {}),
        ...(analysis.queryLocation ? { currentQueryLocation: analysis.queryLocation } : {}),
        ...(analysis.analyzedAt !== undefined ? { currentAnalyzedAt: analysis.analyzedAt } : {}),
    };
}

function readyAnalysisEvidence(
    analysis: NonNullable<Doc<"resume_analyses">["analyses"]>[string],
) {
    const breakdown = analysis.breakdown;
    const relatedExpAuditFactor = breakdown?.related_exp;
    const industryDbContribution = breakdown?.industry_db;
    const relatedExpEvidence = analysis.relatedExpEvidence;
    return {
        finalAiScore: analysis.score,
        ...(analysis.recommendation ? { currentRecommendation: analysis.recommendation } : {}),
        ...(breakdown ? { currentBreakdown: breakdown } : {}),
        ...(relatedExpAuditFactor !== undefined ? {
            relatedExpAuditFactor,
            relatedExpContribution: computeRelatedExpContribution(relatedExpAuditFactor),
        } : {}),
        ...(industryDbContribution !== undefined ? { industryDbContribution } : {}),
        ...(analysis.summary ? { currentAISummary: analysis.summary } : {}),
        ...(analysis.highlights ? { currentHighlights: analysis.highlights } : {}),
        ...(analysis.concerns ? { currentConcerns: analysis.concerns } : {}),
        ...(analysis.keyFactors ? { currentKeyFactors: analysis.keyFactors } : {}),
        ...(relatedExpEvidence ? {
            evidenceBandMax: relatedExpEvidence.evidenceBandMax,
            relatedExpCoverage: relatedExpEvidence.coverage,
            missingReasons: relatedExpEvidence.missingReasons,
            effectiveRelatedExp: relatedExpEvidence.effectiveRaw,
            llmRelatedExp: relatedExpEvidence.llmRaw,
            recommendationMax: relatedExpEvidence.recommendationMax,
            relatedExpContextHash: relatedExpEvidence.contextHash,
            relatedExpRubricVersion: relatedExpEvidence.rubricVersion,
        } : {}),
    };
}

function classifyExactAnalysis(
    analysis: NonNullable<Doc<"resume_analyses">["analyses"]>[string],
    metadata: CompletedExactTaskAuditMetadata,
): { state: ExactTaskAuditAnalysisState; reasons: ExactTaskAuditAnalysisState[] } {
    const reasons: ExactTaskAuditAnalysisState[] = [];
    if (analysis.jobDescriptionId !== metadata.expectedJobDescriptionId) {
        reasons.push("job_description_mismatch");
    }
    if (analysis.promptVersion !== metadata.expectedPromptVersion) {
        reasons.push("prompt_version_mismatch");
    }
    if (analysis.analyzedAt === undefined) {
        reasons.push("timestamp_missing");
    } else if (analysis.analyzedAt <= metadata.dispatchedAt) {
        reasons.push("not_newer_than_dispatch");
    }
    return reasons.length > 0
        ? { state: reasons[0], reasons }
        : { state: "ready", reasons: [] };
}

export async function projectExactTaskAuditRow(
    ctx: QueryCtx,
    resume: Doc<"resumes">,
    metadata: CompletedExactTaskAuditMetadata,
): Promise<ExactTaskAuditRow> {
    const content = isRecord(resume.content) ? resume.content : {};
    const aliases = collectResumeIdentityAliases({
        source: resume.source,
        externalId: resume.externalId,
        content: resume.content,
    });
    const identity = metadata.targetAnalysisIdentityByResumeId.get(String(resume._id));
    const exactCohortMember = identity !== undefined;
    const ingestData = resume.ingestData;
    const roleSignals = ingestData?.roleSignals;
    const matchedWorkEntries = roleSignals?.flatMap((signal) => signal.matchedWorkEntries ?? []);
    const base = {
        currentResumeId: String(resume._id),
        canonicalIdentityKey: resume.identityKey?.trim() || deriveResumeIdentityKey({
            source: resume.source,
            externalId: resume.externalId,
            content: resume.content,
        }),
        externalId: resume.externalId,
        ...(aliases.profileResumeId ? { profileResumeId: aliases.profileResumeId } : {}),
        ...(aliases.profileUrl ? { profileUrl: aliases.profileUrl } : {}),
        source: resume.source,
        sourceKey: identity?.sourceKey ?? resume.sourceKey?.trim() ?? "unknown",
        workspaceSlug: metadata.workspaceSlug,
        ...(readString(content, ["name"]) ? { name: readString(content, ["name"]) } : {}),
        ...(readAge(content, resume.age) !== undefined ? { age: readAge(content, resume.age) } : {}),
        ...(readString(content, ["location"]) ? { location: readString(content, ["location"]) } : {}),
        taskId: metadata.taskId,
        taskStatus: metadata.status,
        taskWorkspaceSlug: metadata.workspaceSlug,
        taskDispatchedAt: metadata.dispatchedAt,
        taskCompletedAt: metadata.completedAt,
        expectedJobDescriptionId: metadata.expectedJobDescriptionId,
        expectedPromptVersion: metadata.expectedPromptVersion,
        // Non-target rows do not have a task-owned analysis identity. The
        // explicit sentinel preserves the public row shape without deriving a
        // live locale/key for data that was never part of the exact cohort.
        expectedAnalysisKey: identity?.expectedAnalysisKey ?? "not-targeted",
        exactCohortMember,
        ...(ingestData?.brandHits ? { brandHits: ingestData.brandHits } : {}),
        ...(ingestData?.brandOrigin ? { brandOrigin: ingestData.brandOrigin } : {}),
        ...(ingestData?.productClass ? { productClass: ingestData.productClass } : {}),
        ...(ingestData?.companyHits ? { companyHits: ingestData.companyHits } : {}),
        ...(roleSignals ? { roleSignals } : {}),
        ...(matchedWorkEntries?.length ? { matchedWorkEntries } : {}),
        ...(ingestData?.evidenceText ? { evidenceText: ingestData.evidenceText } : {}),
        ...(ingestData?.market ? { market: ingestData.market } : {}),
        ...(ingestData?.ruleScores ? { ruleScores: ingestData.ruleScores } : {}),
        ...(resume.primaryRuleScore !== undefined ? { ruleScore: resume.primaryRuleScore } : {}),
    };

    if (!exactCohortMember) {
        return {
            ...base,
            analysisState: "not_targeted",
            analysisReasons: ["not_targeted"],
        };
    }

    const exactIdentity = resolveExactAnalysisIdentity(metadata, resume._id);

    const coldRow = await getActiveColdAnalysisRow(ctx, resume._id);
    if (!coldRow) {
        return {
            ...base,
            analysisState: "cold_row_missing",
            analysisReasons: ["cold_row_missing"],
        };
    }
    if (!coldRow.analyses) {
        return {
            ...base,
            analysisState: "analysis_map_missing",
            analysisReasons: ["analysis_map_missing"],
        };
    }
    const analysis = coldRow.analyses[exactIdentity.expectedAnalysisKey];
    if (!analysis) {
        return {
            ...base,
            analysisState: "analysis_key_missing",
            analysisReasons: ["analysis_key_missing"],
        };
    }

    const classified = classifyExactAnalysis(analysis, metadata);
    return {
        ...base,
        analysisState: classified.state,
        analysisReasons: classified.reasons,
        ...actualAnalysisProvenance(exactIdentity.expectedAnalysisKey, analysis),
        ...(classified.state === "ready" ? readyAnalysisEvidence(analysis) : {}),
    };
}
