/// <reference path="./convex-env.d.ts" />
import { internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { internalAction } from "./_generated/server";
import { v } from "convex/values";
import type { ResumeScanRow } from "./resumes";

/**
 * Background ingest agent (M3)
 *
 * Processes new resumes by computing industryTags, synonymHits, ruleScores, and experienceLevel
 * via BFF API, then stores results in Convex.
 */

function getBffApiUrl(): string {
  // Environment variable for BFF URL (default to localhost for dev)
  // In production, set BFF_API_URL to deployed BFF URL
  return process.env.BFF_API_URL || "http://localhost:3000";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isStaleSkillsVersion(resume: ResumeScanRow, currentVersion: number): boolean {
  const version = resume.ingestData?.skillsVersion;
  return typeof version !== "number" || version < currentVersion;
}

export const processNewResumes = internalAction({
  args: {
    resumeIds: v.array(v.id("resumes")),
  },
  handler: async (
    ctx,
    args
  ): Promise<{ processed: number; error: string | null }> => {
    const { resumeIds } = args;

    if (resumeIds.length === 0) {
      return { processed: 0, error: null };
    }

    console.log(`[ingest_agent] Processing ${resumeIds.length} resumes...`);

    try {
      // 1. Fetch resume documents
      const resumes: Array<{ _id: Id<"resumes">; content: Record<string, unknown> }> = await ctx.runQuery(internal.resumes.getResumesByIds, {
        resumeIds,
      });

      if (resumes.length === 0) {
        console.log("[ingest_agent] No resumes found");
        return { processed: 0, error: null };
      }

      // 2. Prepare payload for BFF
      const payload = {
        resumes: resumes.map((resume: { _id: Id<"resumes">; content: Record<string, unknown> }) => ({
          resumeId: resume._id,
          content: resume.content,
        })),
      };

      // 3. Call BFF ingest compute endpoint
      const bffUrl = getBffApiUrl();
      const endpoint = `${bffUrl}/api/resumes/ingest-compute`;

      console.log(`[ingest_agent] Calling BFF at ${endpoint}...`);

      const response = await fetch(endpoint, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(payload),
      });

      if (!response.ok) {
        const text = await response.text();
        const error = `BFF API error: ${response.status} ${response.statusText} - ${text}`;
        console.error(`[ingest_agent] ${error}`);
        return { processed: 0, error };
      }

      const result = await response.json();

      if (!result.success || !Array.isArray(result.results)) {
        const error = `Invalid BFF response: ${JSON.stringify(result)}`;
        console.error(`[ingest_agent] ${error}`);
        return { processed: 0, error };
      }

      // 4. Store results via mutation
      const updates = result.results.map((item: any) => ({
        resumeId: item.resumeId as Id<"resumes">,
        ingestData: {
          evidenceText: item.evidenceText || "",
          industryTags: item.industryTags,
          synonymHits: item.synonymHits,
          brandHits: item.brandHits || [],
          companyHits: item.companyHits || [],
          industryDbV2Raw: item.industryDbV2Raw,
          industryDbV2RawComponents: item.industryDbV2RawComponents || undefined,
          roleSignals: item.roleSignals || [],
          verifiedRoleYears: item.verifiedRoleYears || undefined,
          taggingEnvelope: item.taggingEnvelope || undefined,
          ruleScores: item.ruleScores,
          experienceLevel: item.experienceLevel,
          computedAt: item.computedAt,
          skillsVersion: item.skillsVersion,
        },
        companyPatternAliasTokens: item.companyPatternAliasTokens || "",
        primaryRuleScore: typeof item.primaryRuleScore === "number" ? item.primaryRuleScore : 0,
      }));

      await ctx.runMutation(internal.resumes.updateIngestDataBatch, {
        updates,
      });

      console.log(`[ingest_agent] Successfully processed ${updates.length} resumes`);

      return { processed: updates.length, error: null };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.error(`[ingest_agent] Error:`, message);
      return { processed: 0, error: message };
    }
  },
});

export const reIngestAllResumes = internalAction({
  args: {},
  handler: async (ctx): Promise<{ scheduled: number; batches: number }> => {
    const batchSize = 50;
    let cursor: string | undefined;
    let scheduled = 0;
    let batches = 0;

    while (true) {
      const batch: {
        continueCursor: string;
        isDone: boolean;
        page: ResumeScanRow[];
      } = await ctx.runQuery(internal.resumes.listResumeScanBatch, { cursor });

      const resumeIds = batch.page.map((resume) => resume._id);

      for (let index = 0; index < resumeIds.length; index += batchSize) {
        await ctx.scheduler.runAfter(0, internal.ingest_agent.processNewResumes, {
          resumeIds: resumeIds.slice(index, index + batchSize),
        });
        batches += 1;
      }

      scheduled += resumeIds.length;

      if (batch.isDone) {
        break;
      }

      cursor = batch.continueCursor;
    }

    return { scheduled, batches };
  },
});

export const reIngestStaleResumes = internalAction({
  args: {
    limit: v.optional(v.number()),
  },
  handler: async (
    ctx,
    args
  ): Promise<{ scheduled: number; batches: number; currentVersion: number; hasMore: boolean }> => {
    const limit = Math.max(1, Math.min(args.limit ?? 200, 1000));
    const bffUrl = getBffApiUrl();
    const versionResponse = await fetch(`${bffUrl}/api/resumes/skills-version`);

    if (!versionResponse.ok) {
      const text = await versionResponse.text();
      throw new Error(`Failed to get skills version: ${versionResponse.status} ${versionResponse.statusText} - ${text}`);
    }

    const versionPayload: unknown = await versionResponse.json();
    if (!isRecord(versionPayload)) {
      throw new Error("Invalid skills version response: expected object");
    }

    const currentVersion = versionPayload.version;
    if (typeof currentVersion !== "number" || !Number.isFinite(currentVersion)) {
      throw new Error("Invalid skills version response: version must be a number");
    }

    const batchSize = 50;
    let cursor: string | undefined;
    const resumeIds: Id<"resumes">[] = [];
    let hasMore = false;
    let batches = 0;

    while (resumeIds.length < limit) {
      const batch: {
        continueCursor: string;
        isDone: boolean;
        page: ResumeScanRow[];
      } = await ctx.runQuery(internal.resumes.listResumeScanBatch, { cursor });

      const staleIds = batch.page
        .filter((resume) => resume.ingestData !== undefined && isStaleSkillsVersion(resume, currentVersion))
        .map((resume) => resume._id);
      const remaining = limit - resumeIds.length;

      if (staleIds.length > remaining) {
        resumeIds.push(...staleIds.slice(0, remaining));
        hasMore = true;
        break;
      }

      resumeIds.push(...staleIds);

      if (resumeIds.length === limit) {
        hasMore = !batch.isDone;
        break;
      }

      if (batch.isDone) {
        break;
      }

      cursor = batch.continueCursor;
    }

    if (resumeIds.length === 0) {
      return {
        scheduled: 0,
        batches: 0,
        currentVersion,
        hasMore,
      };
    }

    for (let index = 0; index < resumeIds.length; index += batchSize) {
      await ctx.scheduler.runAfter(0, internal.ingest_agent.processNewResumes, {
        resumeIds: resumeIds.slice(index, index + batchSize),
      });
      batches += 1;
    }

    return {
      scheduled: resumeIds.length,
      batches,
      currentVersion,
      hasMore,
    };
  },
});
