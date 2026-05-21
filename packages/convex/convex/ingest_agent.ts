/// <reference path="./convex-env.d.ts" />
import { internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { internalAction } from "./_generated/server";
import { v } from "convex/values";
import type { ResumeScanRow } from "./resumes";

interface BrandHit {
  brand: string;
  role: string;
  source: string;
  context: string;
  companyId?: number;
}

interface IndustryDbV2RawComponents {
  companyScore: number;
  brandScore: number;
  weightedBrandUnits: number;
  uniqueCompanies: number;
  brandUnitCount: number;
}

interface RoleSignal {
  type: string;
  matchedSignals: string[];
  signalCount: number;
  occurrences: number;
  years: number;
  industryVerifiedYears?: number;
  roleRelevantYears?: number;
  industryVerifiedRelevantYears?: number;
  matchedWorkEntries?: Array<{
    companyName?: string;
    jobTitle?: string;
    years: number;
    industryVerified: boolean;
    matchedSignals: string[];
    directRoleMatch?: boolean;
  }>;
  verifyIn: string;
}

interface TaggingEnvelope {
  schemaVersion: number;
  generatedAt: number;
  entries: Array<{
    tag: string;
    source: string;
    confidence: number;
    version: number;
    provenance: {
      stage: string;
      generatedBy: string;
      evidence: string[];
    };
  }>;
}

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
      const resumes: Array<{ _id: Id<"resumes">; content: Record<string, unknown>; sourceKey?: string }> = await ctx.runQuery(internal.resumes.getResumesByIds, {
        resumeIds,
      });

      if (resumes.length === 0) {
        console.log("[ingest_agent] No resumes found");
        return { processed: 0, error: null };
      }

      // 2. Prepare payload for BFF (include sourceKey for market derivation)
      const payload = {
        resumes: resumes.map((resume: { _id: Id<"resumes">; content: Record<string, unknown>; sourceKey?: string }) => ({
          resumeId: resume._id,
          content: resume.content,
          sourceKey: resume.sourceKey,
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
      const updates = (result.results as Array<Record<string, unknown>>).map((item) => ({
        resumeId: item.resumeId as Id<"resumes">,
        ingestData: {
          market: item.market as string,
          evidenceText: (item.evidenceText as string) || "",
          industryTags: item.industryTags as string[],
          synonymHits: item.synonymHits as string[],
          brandHits: (item.brandHits as BrandHit[]) || [],
          companyHits: (item.companyHits as string[]) || [],
          industryDbV2Raw: item.industryDbV2Raw as number | undefined,
          industryDbV2RawComponents: (item.industryDbV2RawComponents as IndustryDbV2RawComponents) || undefined,
          roleSignals: (item.roleSignals as RoleSignal[]) || [],
          verifiedRoleYears: (item.verifiedRoleYears as Record<string, number>) || undefined,
          taggingEnvelope: (item.taggingEnvelope as TaggingEnvelope) || undefined,
          ruleScores: item.ruleScores as Record<string, number>,
          experienceLevel: item.experienceLevel as string,
          computedAt: item.computedAt as number,
          skillsVersion: item.skillsVersion as number,
        },
        companyPatternAliasTokens: (item.companyPatternAliasTokens as string) || "",
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
