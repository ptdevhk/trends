import { createRoute, OpenAPIHono, z } from "@hono/zod-openapi";
import { resolveConvexUrl } from "../services/resume-import-service.js";
import { aiSummaryService } from "../services/ai-summary-service.js";
import { isRecord } from "@trends/shared";

const AI_SUMMARY_TTL_MS = 60 * 60 * 1000;
const AI_SUMMARY_STALE_AFTER_MS = 50 * 60 * 1000;

const app = new OpenAPIHono();

const SummaryCandidateSchema = z.object({
  id: z.string(),
  keywords: z.array(z.string()).optional(),
  location: z.string().optional(),
  name: z.string(),
  score: z.number().optional(),
  snippet: z.string(),
  title: z.string().optional(),
});

const SearchSummaryRequestSchema = z.object({
  urlHash: z.string().min(1),
  query: z.string().min(1),
  location: z.string().optional(),
  jobDescriptionId: z.string().optional(),
  facets: z.object({
    selectedTags: z.array(z.string()).optional(),
    selectedCompanies: z.array(z.string()).optional(),
    selectedExperienceLevel: z.string().optional(),
  }).optional(),
  resultCount: z.number().int().min(0),
  resultSetHash: z.string().min(1),
  results: z.array(SummaryCandidateSchema).min(1).max(20),
  forceRefresh: z.boolean().optional(),
});

const SearchSummaryResponseSchema = z.object({
  success: z.literal(true),
  summary: z.string(),
  model: z.string(),
  generatedAt: z.number(),
  shouldRefresh: z.boolean().optional(),
});

const SearchSummaryErrorResponseSchema = z.object({
  success: z.literal(false),
  error: z.string(),
});


async function callConvex(
  type: "query" | "mutation",
  pathName: string,
  args: Record<string, unknown>,
): Promise<unknown> {
  const convexUrl = resolveConvexUrl().replace(/\/$/, "");
  const response = await fetch(`${convexUrl}/api/${type}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json",
    },
    body: JSON.stringify({ path: pathName, args }),
  });

  if (!response.ok) {
    throw new Error(`Convex ${type} failed (${response.status}): ${await response.text()}`);
  }

  const payload = await response.json() as unknown;
  if (!isRecord(payload) || payload.status !== "success") {
    throw new Error(`Convex ${type} failed for ${pathName}`);
  }

  return payload.value;
}

const searchSummaryRoute = createRoute({
  method: "post",
  path: "/api/resumes/search-summary",
  tags: ["resumes"],
  summary: "Generate or return a cached AI summary for the current resume search result set",
  request: {
    body: {
      content: {
        "application/json": {
          schema: SearchSummaryRequestSchema,
        },
      },
    },
  },
  responses: {
    200: {
      description: "AI summary response",
      content: {
        "application/json": {
          schema: SearchSummaryResponseSchema,
        },
      },
    },
    500: {
      description: "AI summary generation failed",
      content: {
        "application/json": {
          schema: SearchSummaryErrorResponseSchema,
        },
      },
    },
  },
});

app.openapi(searchSummaryRoute, async (c) => {
  const body = c.req.valid("json");
  const workspaceSlug = c.var.workspaceSlug;
  const now = Date.now();
  const cached = await callConvex("query", "ai_summary_cache:get", {
    workspaceSlug,
    urlHash: body.urlHash,
  }) as {
    summary?: string;
    model?: string;
    generatedAt?: number;
    expiresAt?: number;
    resultSetHash?: string;
  } | null;

  if (
    !body.forceRefresh
    && cached
    && cached.summary
    && cached.model
    && typeof cached.generatedAt === "number"
    && typeof cached.expiresAt === "number"
    && cached.expiresAt > now
    && cached.resultSetHash === body.resultSetHash
  ) {
    return c.json({
      success: true as const,
      summary: cached.summary,
      model: cached.model,
      generatedAt: cached.generatedAt,
      shouldRefresh: cached.generatedAt <= (now - AI_SUMMARY_STALE_AFTER_MS),
    }, 200);
  }

  try {
    const generated = await aiSummaryService.generateSummary({
      workspaceSlug,
      query: body.query,
      location: body.location,
      jobDescriptionId: body.jobDescriptionId,
      facets: body.facets,
      results: body.results,
    });

    await callConvex("mutation", "ai_summary_cache:upsert", {
      urlHash: body.urlHash,
      workspaceSlug,
      query: body.query,
      facets: body.facets ? JSON.stringify(body.facets) : undefined,
      resultCount: body.resultCount,
      resultSetHash: body.resultSetHash,
      summary: generated.summary,
      model: generated.model,
      generatedAt: now,
      expiresAt: now + AI_SUMMARY_TTL_MS,
    });

    return c.json({
      success: true as const,
      summary: generated.summary,
      model: generated.model,
      generatedAt: now,
    }, 200);
  } catch (error) {
    console.error("Failed to generate AI search summary", error);
    if (
      cached
      && typeof cached.summary === "string"
      && typeof cached.model === "string"
      && typeof cached.generatedAt === "number"
    ) {
      return c.json({
        success: true as const,
        summary: cached.summary,
        model: cached.model,
        generatedAt: cached.generatedAt,
      }, 200);
    }

    return c.json({
      success: false as const,
      error: "Failed to generate AI search summary",
    }, 500);
  }
});

export default app;
