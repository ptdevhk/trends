/// <reference path="./convex-env.d.ts" />
import { buildWorkHistoryEvidence } from "@trends/shared";
import { internal } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";
import { internalAction, internalMutation, internalQuery, mutation, query } from "./_generated/server";
import { v } from "convex/values";

import { resolveAiTaggingParallelism } from "./lib/parallelism";

type RoleFit = "sales_verified" | "sales_unverified" | "operator_only";
type Recommendation = "strong_match" | "match" | "potential" | "no_match";
type ChatMessage = {
  role: "system" | "user";
  content: string;
};

type TaggingResult = {
  roleFit: RoleFit;
  recommendation: Recommendation;
  confidence: number;
  tags: string[];
  evidenceLines: string[];
};

type RoleSignalSnapshot = {
  type: string;
  matchedSignals: string[];
  signalCount: number;
  occurrences: number;
  years: number;
  verifyIn: string;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}


export function stableHash(seed: string): string {
  let hash = 2166136261;
  for (const char of seed) {
    hash ^= char.codePointAt(0) ?? 0;
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(16);
}

function normalizeToken(value: string): string | null {
  const trimmed = value.trim();
  return trimmed ? trimmed : null;
}

function toOptionalPositiveInt(value: unknown): number | undefined {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return undefined;
  }
  const parsed = Math.floor(value);
  return parsed > 0 ? parsed : undefined;
}

function toStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value
    .map((item) => (typeof item === "string" ? item.trim() : ""))
    .filter((item) => item.length > 0);
}

function readStoredEvidenceText(value: unknown): { lines: string[]; text: string } | null {
  if (typeof value !== "string") {
    return null;
  }
  const text = value.trim();
  return {
    lines: text ? text.split("\n").filter((line) => line.length > 0) : [],
    text,
  };
}

export function resolveAiTaggingEvidence(resume: Pick<Doc<"resumes">, "content" | "ingestData">): { lines: string[]; text: string } | null {
  return readStoredEvidenceText(resume.ingestData?.evidenceText);
}

export function buildEvidenceTextFromWorkHistory(content: unknown): { lines: string[]; text: string } {
  return buildWorkHistoryEvidence(content);
}

export function buildAiTaggingIdentity(input: {
  profileKey: string;
  evidenceText: string;
  promptVersion: string;
  model: string;
}): { evidenceHash: string; idempotencyKey: string } {
  const profileKey = input.profileKey.trim();
  const promptVersion = input.promptVersion.trim();
  const model = input.model.trim();
  const evidenceHash = stableHash(input.evidenceText);
  const idempotencyKey = `${profileKey}:${evidenceHash}:${promptVersion}:${model}`;
  return { evidenceHash, idempotencyKey };
}

function toRuleScores(value: unknown): Record<string, number> {
  if (!isRecord(value)) {
    return {};
  }

  const scores: Record<string, number> = {};
  for (const [key, rawScore] of Object.entries(value)) {
    if (typeof rawScore === "number" && Number.isFinite(rawScore)) {
      scores[key] = rawScore;
    }
  }
  return scores;
}

function readBaselineRuleScore(resume: Doc<"resumes">, jobDescriptionId: string | undefined): number {
  const jdId = jobDescriptionId?.trim() || undefined;
  if (jdId) {
    const ruleScore = toRuleScores(resume.ingestData?.ruleScores)[jdId];
    if (typeof ruleScore === "number" && Number.isFinite(ruleScore)) {
      return ruleScore;
    }
  }

  if (typeof resume.primaryRuleScore === "number" && Number.isFinite(resume.primaryRuleScore)) {
    return resume.primaryRuleScore;
  }
  return 0;
}

function readRoleSignalsSnapshot(value: unknown): RoleSignalSnapshot[] | undefined {
  if (!Array.isArray(value) || value.length === 0) {
    return undefined;
  }

  const snapshots: RoleSignalSnapshot[] = [];
  for (const entry of value) {
    if (!isRecord(entry)) {
      continue;
    }

    const type = typeof entry.type === "string" ? entry.type : null;
    const matchedSignals = Array.isArray(entry.matchedSignals)
      ? entry.matchedSignals.filter((item): item is string => typeof item === "string")
      : null;
    const signalCount = typeof entry.signalCount === "number" && Number.isFinite(entry.signalCount) ? entry.signalCount : null;
    const occurrences = typeof entry.occurrences === "number" && Number.isFinite(entry.occurrences) ? entry.occurrences : null;
    const years = typeof entry.years === "number" && Number.isFinite(entry.years) ? entry.years : null;
    const verifyIn = typeof entry.verifyIn === "string" ? entry.verifyIn : null;

    if (!type || !matchedSignals || signalCount === null || occurrences === null || years === null || !verifyIn) {
      continue;
    }

    snapshots.push({
      type,
      matchedSignals,
      signalCount,
      occurrences,
      years,
      verifyIn,
    });
  }

  return snapshots.length > 0 ? snapshots : undefined;
}

function resolveAiApiKey(): string | undefined {
  return process.env.AI_API_KEY || process.env.OPENAI_API_KEY || undefined;
}

function resolveAiApiBase(): string {
  return process.env.AI_API_BASE || process.env.OPENAI_API_BASE || "https://api.openai.com/v1";
}

function resolveAiTaggingModel(override: string | undefined): string {
  const trimmedOverride = override?.trim();
  if (trimmedOverride) {
    return trimmedOverride;
  }
  const env = process.env.AI_TAGGING_MODEL || process.env.AI_MODEL || process.env.OPENAI_MODEL;
  if (env && env.trim().length > 0) {
    return env.trim();
  }
  return "gpt-4-turbo-preview";
}

function resolveAiTaggingTemperature(): number {
  const raw = process.env.AI_TAGGING_TEMPERATURE ?? process.env.AI_TEMPERATURE;
  if (raw !== undefined && raw.trim().length > 0) {
    const parsed = Number.parseFloat(raw);
    if (Number.isFinite(parsed)) {
      return parsed;
    }
  }
  return 0;
}

function buildSystemPrompt(): string {
  return [
    "你是一个严谨的简历标签助手。",
    "你只能依据用户提供的【工作经历】证据做判断，不能引入未提供的字段（如求职意向、自我介绍、地点、年龄）。",
    "你必须严格输出【纯 JSON】对象，不要包含 markdown 或额外解释文本。",
    "输出结构：",
    "{",
    '  \"roleFit\": \"sales_verified\" | \"sales_unverified\" | \"operator_only\",',
    '  \"recommendation\": \"strong_match\" | \"match\" | \"potential\" | \"no_match\",',
    "  \"confidence\": 0,",
    "  \"tags\": [\"...\"],",
    "  \"evidenceLines\": [\"...\"]",
    "}",
    "约束：evidenceLines 必须从输入的工作经历列表中逐字选择（可为空数组）。",
  ].join("\n");
}

function buildUserPrompt(profileKey: string, evidenceLines: string[]): string {
  const normalizedProfileKey = profileKey.trim();
  const header = normalizedProfileKey ? `Profile: ${normalizedProfileKey}` : "Profile: (unknown)";

  const numbered = evidenceLines.length > 0
    ? evidenceLines.map((line, index) => `${index + 1}. ${line}`).join("\n")
    : "(empty)";

  return [
    header,
    "",
    "Work history lines:",
    numbered,
    "",
    "Return JSON only.",
  ].join("\n");
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

function parseRoleFit(value: unknown): RoleFit | null {
  if (typeof value !== "string") {
    return null;
  }
  const normalized = value.trim();
  if (normalized === "sales_verified" || normalized === "sales_unverified" || normalized === "operator_only") {
    return normalized;
  }
  return null;
}

function parseRecommendation(value: unknown): Recommendation | null {
  if (typeof value !== "string") {
    return null;
  }
  const normalized = value.trim();
  if (normalized === "strong_match" || normalized === "match" || normalized === "potential" || normalized === "no_match") {
    return normalized;
  }
  return null;
}

function parseTaggingResult(value: unknown, allowedEvidenceLines: string[]): TaggingResult {
  if (!isRecord(value)) {
    throw new Error("Invalid tagging result: expected object.");
  }

  const roleFit = parseRoleFit(value.roleFit);
  const recommendation = parseRecommendation(value.recommendation);
  const confidenceRaw = toNumber(value.confidence);
  const tags = toStringArray(value.tags);
  const evidenceLines = toStringArray(value.evidenceLines);

  if (!roleFit) {
    throw new Error("Invalid tagging result: roleFit is missing or invalid.");
  }
  if (!recommendation) {
    throw new Error("Invalid tagging result: recommendation is missing or invalid.");
  }

  const confidence = confidenceRaw === null ? 0 : Math.max(0, Math.min(100, Math.round(confidenceRaw)));
  const allowedSet = new Set(allowedEvidenceLines);
  const filteredEvidence = evidenceLines.filter((line) => allowedSet.has(line));

  return {
    roleFit,
    recommendation,
    confidence,
    tags,
    evidenceLines: filteredEvidence,
  };
}

async function callTaggingLlm(input: {
  messages: ChatMessage[];
  model: string;
}): Promise<{ value: unknown; tokensIn?: number; tokensOut?: number }> {
  const apiKey = resolveAiApiKey();
  if (!apiKey) {
    throw new Error("AI_API_KEY/OPENAI_API_KEY is not set in Convex environment variables.");
  }

  const response = await fetch(`${resolveAiApiBase()}/chat/completions`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: input.model,
      messages: input.messages,
      temperature: resolveAiTaggingTemperature(),
      response_format: { type: "json_object" },
    }),
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`AI API error: ${response.status} ${response.statusText} - ${text}`);
  }

  const payload: unknown = await response.json();
  if (!isRecord(payload)) {
    throw new Error("AI API returned invalid payload.");
  }

  const choices = payload.choices;
  if (!Array.isArray(choices) || choices.length === 0 || !isRecord(choices[0])) {
    throw new Error("AI API returned no choices.");
  }

  const message = isRecord(choices[0].message) ? choices[0].message : null;
  const content = message && typeof message.content === "string" ? message.content : "";
  const cleaned = content.replace(/```json\n?|```/g, "").trim();

  let parsed: unknown;
  try {
    parsed = JSON.parse(cleaned);
  } catch {
    throw new Error(`Invalid JSON response from AI: ${cleaned.slice(0, 200)}`);
  }

  const usage = isRecord(payload.usage) ? payload.usage : null;
  const tokensIn = usage && typeof usage.prompt_tokens === "number" ? usage.prompt_tokens : undefined;
  const tokensOut = usage && typeof usage.completion_tokens === "number" ? usage.completion_tokens : undefined;

  return { value: parsed, tokensIn, tokensOut };
}

export const enqueueBatch = mutation({
  args: {
    workspaceSlug: v.string(),
    profileKey: v.string(),
    resumeIds: v.array(v.id("resumes")),
    jobDescriptionId: v.optional(v.string()),
    promptVersion: v.optional(v.string()),
    model: v.optional(v.string()),
    retryFailed: v.optional(v.boolean()),
  },
  handler: async (ctx, args) => {
    const workspaceSlug = args.workspaceSlug.trim();
    const profileKey = args.profileKey.trim();
    if (!workspaceSlug) {
      throw new Error("workspaceSlug is required.");
    }
    if (!profileKey) {
      throw new Error("profileKey is required.");
    }

    const promptVersion = normalizeToken(args.promptVersion ?? "") ?? "v1";
    const model = resolveAiTaggingModel(args.model);
    const retryFailed = args.retryFailed ?? true;
    const jobDescriptionId = normalizeToken(args.jobDescriptionId ?? "") ?? undefined;

    let created = 0;
    let reused = 0;
    let retried = 0;

    const uniqueResumeIdMap = new Map<string, Id<"resumes">>();
    for (const resumeId of args.resumeIds) {
      uniqueResumeIdMap.set(String(resumeId), resumeId);
    }
    const uniqueIds = Array.from(uniqueResumeIdMap.values());

    for (const resumeId of uniqueIds) {
      const resume = await ctx.db.get(resumeId);
      if (!resume) {
        continue;
      }

      const evidence = resolveAiTaggingEvidence(resume);
      if (!evidence) {
        continue;
      }

      const identity = buildAiTaggingIdentity({
        profileKey,
        evidenceText: evidence.text,
        promptVersion,
        model,
      });
      const evidenceHash = identity.evidenceHash;
      const idempotencyKey = identity.idempotencyKey;

      const existing = await ctx.db
        .query("ai_tagging_results")
        .withIndex("by_workspace_idempotency", (q) =>
          q.eq("workspaceSlug", workspaceSlug).eq("idempotencyKey", idempotencyKey)
        )
        .first();

      if (existing) {
        if (existing.status === "failed" && retryFailed) {
          await ctx.db.patch(existing._id, {
            status: "pending",
            error: undefined,
            completedAt: undefined,
          });
          retried += 1;
        } else {
          reused += 1;
        }
        continue;
      }

      const baselineComputedAt = toOptionalPositiveInt(resume.ingestData?.computedAt)
        ?? toOptionalPositiveInt(resume.crawledAt)
        ?? Date.now();
      const baseline = {
        jobDescriptionId,
        ruleScore: readBaselineRuleScore(resume, jobDescriptionId),
        roleSignals: readRoleSignalsSnapshot(resume.ingestData?.roleSignals),
        skillsVersion: toOptionalPositiveInt(resume.ingestData?.skillsVersion),
        computedAt: baselineComputedAt,
      };

      const now = Date.now();
      if (evidence.lines.length === 0) {
        await ctx.db.insert("ai_tagging_results", {
          resumeId: resume._id,
          identityKey: resume.identityKey,
          workspaceSlug,
          profileKey,
          evidenceHash,
          promptVersion,
          model,
          idempotencyKey,
          status: "failed",
          baseline,
          metrics: { attempts: 0 },
          error: "Missing workHistory evidence (strict mode requires work history lines).",
          createdAt: now,
          completedAt: now,
        });
        created += 1;
        continue;
      }

      await ctx.db.insert("ai_tagging_results", {
        resumeId: resume._id,
        identityKey: resume.identityKey,
        workspaceSlug,
        profileKey,
        evidenceHash,
        promptVersion,
        model,
        idempotencyKey,
        status: "pending",
        baseline,
        metrics: { attempts: 0 },
        createdAt: now,
      });
      created += 1;
    }

    if (created > 0 || retried > 0) {
      await ctx.scheduler.runAfter(0, internal.ai_tagging_results.drainQueue, {
        workspaceSlug,
        profileKey,
      });
    }

    return { created, reused, retried };
  },
});

export const getSummary = query({
  args: {
    workspaceSlug: v.string(),
    profileKey: v.string(),
  },
  handler: async (ctx, args) => {
    const workspaceSlug = args.workspaceSlug.trim();
    const profileKey = args.profileKey.trim();
    if (!workspaceSlug || !profileKey) {
      return { pending: 0, processing: 0, completed: 0, failed: 0, total: 0 };
    }

    const rows = await ctx.db
      .query("ai_tagging_results")
      .withIndex("by_workspace_profile", (q) =>
        q.eq("workspaceSlug", workspaceSlug).eq("profileKey", profileKey)
      )
      .collect();

    let pending = 0;
    let processing = 0;
    let completed = 0;
    let failed = 0;
    for (const row of rows) {
      if (row.status === "pending") pending += 1;
      else if (row.status === "processing") processing += 1;
      else if (row.status === "completed") completed += 1;
      else if (row.status === "failed") failed += 1;
    }
    return { pending, processing, completed, failed, total: rows.length };
  },
});

export const listForCompare = query({
  args: {
    workspaceSlug: v.string(),
    profileKey: v.string(),
    status: v.optional(v.union(
      v.literal("pending"),
      v.literal("processing"),
      v.literal("completed"),
      v.literal("failed")
    )),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const workspaceSlug = args.workspaceSlug.trim();
    const profileKey = args.profileKey.trim();
    const limit = Math.max(1, Math.min(args.limit ?? 50, 200));

    if (!workspaceSlug || !profileKey) {
      return [];
    }

    const status = args.status;
    const rows = status
      ? await ctx.db
        .query("ai_tagging_results")
        .withIndex("by_workspace_profile_status", (q) =>
          q.eq("workspaceSlug", workspaceSlug).eq("profileKey", profileKey).eq("status", status)
        )
        .order("desc")
        .take(limit)
      : await ctx.db
        .query("ai_tagging_results")
        .withIndex("by_workspace_profile", (q) =>
          q.eq("workspaceSlug", workspaceSlug).eq("profileKey", profileKey)
        )
        .order("desc")
        .take(limit);

    const resumes = await Promise.all(rows.map((row) => ctx.db.get(row.resumeId)));
    return rows.map((row, index) => ({
      ai: row,
      resume: resumes[index],
    }));
  },
});

export const listPending = internalQuery({
  args: {
    workspaceSlug: v.string(),
    profileKey: v.string(),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const workspaceSlug = args.workspaceSlug.trim();
    const profileKey = args.profileKey.trim();
    const limit = Math.max(1, Math.min(args.limit ?? 100, 500));
    if (!workspaceSlug || !profileKey) {
      return [];
    }

    return await ctx.db
      .query("ai_tagging_results")
      .withIndex("by_workspace_profile_status", (q) =>
        q.eq("workspaceSlug", workspaceSlug).eq("profileKey", profileKey).eq("status", "pending")
      )
      .order("desc")
      .take(limit);
  },
});

export const claimPending = internalMutation({
  args: {
    id: v.id("ai_tagging_results"),
  },
  handler: async (ctx, args) => {
    const row = await ctx.db.get(args.id);
    if (!row || row.status !== "pending") {
      return null;
    }

    const nextAttempts = Math.max(0, Math.floor(row.metrics?.attempts ?? 0)) + 1;
    await ctx.db.patch(args.id, {
      status: "processing",
      error: undefined,
      completedAt: undefined,
      metrics: {
        ...(row.metrics ?? {}),
        attempts: nextAttempts,
      },
    });

    return row;
  },
});

export const markCompleted = internalMutation({
  args: {
    id: v.id("ai_tagging_results"),
    result: v.object({
      roleFit: v.string(),
      recommendation: v.string(),
      confidence: v.number(),
      tags: v.array(v.string()),
      evidenceLines: v.array(v.string()),
    }),
    metrics: v.optional(v.object({
      latencyMs: v.optional(v.number()),
      tokensIn: v.optional(v.number()),
      tokensOut: v.optional(v.number()),
    })),
  },
  handler: async (ctx, args) => {
    const row = await ctx.db.get(args.id);
    if (!row || row.status === "completed") {
      return;
    }

    await ctx.db.patch(args.id, {
      status: "completed",
      result: args.result,
      metrics: args.metrics ? { ...(row.metrics ?? {}), ...args.metrics } : row.metrics,
      error: undefined,
      completedAt: Date.now(),
    });
  },
});

export const markFailed = internalMutation({
  args: {
    id: v.id("ai_tagging_results"),
    error: v.string(),
    metrics: v.optional(v.object({
      latencyMs: v.optional(v.number()),
      tokensIn: v.optional(v.number()),
      tokensOut: v.optional(v.number()),
    })),
  },
  handler: async (ctx, args) => {
    const row = await ctx.db.get(args.id);
    if (!row || row.status === "completed") {
      return;
    }

    await ctx.db.patch(args.id, {
      status: "failed",
      error: args.error,
      metrics: args.metrics ? { ...(row.metrics ?? {}), ...args.metrics } : row.metrics,
      completedAt: Date.now(),
    });
  },
});

export const drainQueue = internalAction({
  args: {
    workspaceSlug: v.string(),
    profileKey: v.string(),
  },
  handler: async (ctx, args) => {
    const workspaceSlug = args.workspaceSlug.trim();
    const profileKey = args.profileKey.trim();
    if (!workspaceSlug || !profileKey) {
      return { processed: 0 };
    }

    const candidates = await ctx.runQuery(internal.ai_tagging_results.listPending, {
      workspaceSlug,
      profileKey,
      limit: 100,
    });

    if (candidates.length === 0) {
      return { processed: 0 };
    }

    const parallelism = resolveAiTaggingParallelism(candidates.length);
    const batch = candidates.slice(0, parallelism);

    const claimedRows: Array<Doc<"ai_tagging_results">> = [];
    for (const candidate of batch) {
      const claimed = await ctx.runMutation(internal.ai_tagging_results.claimPending, { id: candidate._id });
      if (claimed) {
        claimedRows.push(claimed);
      }
    }

    if (claimedRows.length === 0) {
      const hasMore = await ctx.runQuery(internal.ai_tagging_results.listPending, {
        workspaceSlug,
        profileKey,
        limit: 1,
      });
      if (hasMore.length > 0) {
        await ctx.scheduler.runAfter(0, internal.ai_tagging_results.drainQueue, { workspaceSlug, profileKey });
      }
      return { processed: 0 };
    }

    await Promise.all(claimedRows.map(async (row) => {
      const start = Date.now();
      try {
        const resume = await ctx.runQuery(internal.resumes.getResume, { resumeId: row.resumeId });
        if (!resume) {
          await ctx.runMutation(internal.ai_tagging_results.markFailed, {
            id: row._id,
            error: `Resume not found: ${String(row.resumeId)}`,
            metrics: { latencyMs: Date.now() - start },
          });
          return;
        }

        const evidence = resolveAiTaggingEvidence(resume);
        if (!evidence || evidence.lines.length === 0) {
          await ctx.runMutation(internal.ai_tagging_results.markFailed, {
            id: row._id,
            error: "Missing ingestData.evidenceText (run backfillEvidenceText before strict AI tagging).",
            metrics: { latencyMs: Date.now() - start },
          });
          return;
        }

        const { value, tokensIn, tokensOut } = await callTaggingLlm({
          messages: [
            { role: "system", content: buildSystemPrompt() },
            { role: "user", content: buildUserPrompt(row.profileKey, evidence.lines) },
          ],
          model: row.model,
        });

        const parsed = parseTaggingResult(value, evidence.lines);

        await ctx.runMutation(internal.ai_tagging_results.markCompleted, {
          id: row._id,
          result: parsed,
          metrics: {
            latencyMs: Date.now() - start,
            tokensIn,
            tokensOut,
          },
        });
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        await ctx.runMutation(internal.ai_tagging_results.markFailed, {
          id: row._id,
          error: message,
          metrics: { latencyMs: Date.now() - start },
        });
      }
    }));

    const hasMore = await ctx.runQuery(internal.ai_tagging_results.listPending, {
      workspaceSlug,
      profileKey,
      limit: 1,
    });

    if (hasMore.length > 0) {
      await ctx.scheduler.runAfter(0, internal.ai_tagging_results.drainQueue, { workspaceSlug, profileKey });
    }

    return { processed: claimedRows.length };
  },
});
