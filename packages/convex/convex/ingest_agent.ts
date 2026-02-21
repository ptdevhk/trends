import { internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { internalAction } from "./_generated/server";
import { v } from "convex/values";

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

export const processNewResumes = internalAction({
  args: {
    resumeIds: v.array(v.id("resumes")),
  },
  handler: async (ctx, args) => {
    const { resumeIds } = args;

    if (resumeIds.length === 0) {
      return { processed: 0, error: null };
    }

    console.log(`[ingest_agent] Processing ${resumeIds.length} resumes...`);

    try {
      // 1. Fetch resume documents
      const resumes = await ctx.runQuery(internal.resumes.getResumesByIds, {
        resumeIds,
      });

      if (resumes.length === 0) {
        console.log("[ingest_agent] No resumes found");
        return { processed: 0, error: null };
      }

      // 2. Prepare payload for BFF
      const payload = {
        resumes: resumes.map((resume) => ({
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
          industryTags: item.industryTags,
          synonymHits: item.synonymHits,
          ruleScores: item.ruleScores,
          experienceLevel: item.experienceLevel,
          computedAt: item.computedAt,
          skillsVersion: item.skillsVersion,
        },
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
