import { createRoute, OpenAPIHono, z } from "@hono/zod-openapi";
import { jobDescriptionService } from "../services/job-description-service.js";
import { jdKeywordExtractionService } from "../services/jd-keyword-extraction-service.js";
import { DataNotFoundError } from "../services/errors.js";
import { isRecord } from "@trends/shared";
import { logger } from "../services/logger.js";
import { callConvexQuery, callConvexMutation } from "../services/convex-utils.js";
import { readString } from "../services/workspace-config-service.js";
import { getWorkspaceUserAccessError } from "../middleware/auth.js";

const app = new OpenAPIHono();

// Schemas
const JobDescriptionFileSchema = z.object({
  id: z.string(),
  name: z.string(),
  filename: z.string(),
  updatedAt: z.string(),
  size: z.number().int(),
  title: z.string().optional(),
  titleEn: z.string().optional(),
  status: z.string().optional(),
  location: z.string().optional(),
  filterPreset: z.string().optional(),
  suggestedFilters: z.object({
    minExperience: z.number().optional(),
    maxExperience: z.number().optional(),
    minAge: z.number().optional(),
    maxAge: z.number().optional(),
    education: z.array(z.string()).optional(),
  }).optional(),
  autoMatch: z.object({
    keywords: z.array(z.string()),
  }).optional(),
});

const MatchRequestSchema = z.object({
  keywords: z.array(z.string()).min(1),
});

const CreateRequestSchema = z.object({
  name: z.string().trim().min(1),
  content: z.string().trim().min(1),
  overwrite: z.boolean().optional(),
});

const ExtractKeywordsRequestSchema = z.object({
  text: z.string().trim().min(20).max(20000),
});

const MatchResponseSchema = z.object({
  success: z.literal(true),
  matched: z.string().optional(),
  title: z.string().optional(),
  confidence: z.number(),
  matchedKeywords: z.array(z.string()),
  filterPreset: z.string().optional(),
  suggestedFilters: z.record(z.string(), z.unknown()).optional(),
});

const ExtractKeywordsResponseSchema = z.object({
  success: z.literal(true),
  keywords: z.array(z.string()),
  model: z.string(),
});

const ErrorResponseSchema = z.object({
  success: z.literal(false),
  error: z.string(),
});

type ConvexJobDescriptionRecord = {
  _id?: unknown;
  title?: unknown;
  slug?: unknown;
  content?: unknown;
  type?: unknown;
  enabled?: unknown;
  lastModified?: unknown;
  location?: unknown;
  customKeywords?: unknown;
  minExperience?: unknown;
  maxExperience?: unknown;
  minAge?: unknown;
  maxAge?: unknown;
};


async function listConvexJobDescriptions(workspaceSlug: string): Promise<ConvexJobDescriptionRecord[]> {
  const value = await callConvexQuery( "job_descriptions:list", { workspaceSlug });
  if (!Array.isArray(value)) {
    return [];
  }
  return value.filter((item): item is ConvexJobDescriptionRecord => isRecord(item));
}

function toJobDescriptionFile(item: ConvexJobDescriptionRecord): {
  id: string;
  name: string;
  filename: string;
  updatedAt: string;
  size: number;
  title?: string;
  status?: string;
  location?: string;
  suggestedFilters?: {
    minExperience?: number;
    maxExperience?: number;
    minAge?: number;
    maxAge?: number;
  };
  autoMatch?: {
    keywords: string[];
  };
} | null {
  const id = readString(item._id ? String(item._id) : item._id) ?? readString(item.slug);
  const content = typeof item.content === "string" ? item.content : "";
  if (!id) {
    return null;
  }

  const title = readString(item.title) ?? undefined;
  const name = readString(item.slug) ?? id;
  const lastModified = typeof item.lastModified === "number" ? item.lastModified : Date.now();
  const enabled = item.enabled === false ? "inactive" : "active";
  const customKeywords = Array.isArray(item.customKeywords)
    ? item.customKeywords.filter((keyword): keyword is string => typeof keyword === "string" && keyword.trim().length > 0)
    : [];
  const minExperience = typeof item.minExperience === "number" ? item.minExperience : undefined;
  const maxExperience = typeof item.maxExperience === "number" ? item.maxExperience : undefined;
  const minAge = typeof item.minAge === "number" ? item.minAge : undefined;
  const maxAge = typeof item.maxAge === "number" ? item.maxAge : undefined;
  const suggestedFilters = (
    minExperience !== undefined
    || maxExperience !== undefined
    || minAge !== undefined
    || maxAge !== undefined
  )
    ? { minExperience, maxExperience, minAge, maxAge }
    : undefined;

  return {
    id,
    name,
    filename: `${name}.md`,
    updatedAt: new Date(lastModified).toISOString(),
    size: content.length,
    title,
    status: enabled,
    location: readString(item.location) ?? undefined,
    suggestedFilters,
    autoMatch: customKeywords.length > 0 ? { keywords: customKeywords } : undefined,
  };
}

// ============================================================
// GET /api/job-descriptions
// ============================================================
const listRoute = createRoute({
  method: "get",
  path: "/api/job-descriptions",
  tags: ["job-descriptions"],
  summary: "List job description files",
  description: "Returns Markdown job descriptions with auto_match config",
  request: {
    query: z.object({
      includeReadme: z.coerce.boolean().optional().openapi({
        param: { name: "includeReadme", in: "query" },
      }),
    }),
  },
  responses: {
    200: {
      content: {
        "application/json": {
          schema: z.object({
            success: z.literal(true),
            items: z.array(JobDescriptionFileSchema),
          })
        }
      },
      description: "List of job descriptions",
    },
  },
});

app.openapi(listRoute, (c) => {
  const { includeReadme } = c.req.valid("query");
  const items = jobDescriptionService.listFiles(Boolean(includeReadme));
  return c.json({ success: true as const, items }, 200);
});

const createRouteDef = createRoute({
  method: "post",
  path: "/api/job-descriptions",
  tags: ["job-descriptions"],
  summary: "Create a job description file",
  request: {
    body: {
      content: { "application/json": { schema: CreateRequestSchema } },
    },
  },
  responses: {
    201: {
      content: {
        "application/json": {
          schema: z.object({
            success: z.literal(true),
            item: JobDescriptionFileSchema,
            content: z.string(),
          }),
        },
      },
      description: "Created",
    },
    409: { description: "Already exists" },
  },
});

app.openapi(createRouteDef, async (c) => {
  // Member desk (locked B): personal-seat `user` and HR users may create JDs.
  const memberError = getWorkspaceUserAccessError(c);
  if (memberError) {
    return c.json(memberError.body, memberError.status);
  }
  const { name, content, overwrite } = c.req.valid("json");
  try {
    if (overwrite) {
      return c.json({ success: false, error: "Overwrite is not supported for read-only system files" }, 400);
    }

    const createdId = await callConvexMutation( "job_descriptions:create", {
      title: name,
      content,
      type: "custom",
      workspaceSlug: c.var.workspaceSlug,
    });

    const items = await listConvexJobDescriptions(c.var.workspaceSlug);
    const created = items.find((item) => String(item._id ?? "") === String(createdId));
    if (!created) {
      return c.json({ success: false, error: "Created job description could not be loaded" }, 500);
    }

    const mapped = toJobDescriptionFile(created);
    if (!mapped) {
      return c.json({ success: false, error: "Created job description payload is invalid" }, 500);
    }

    return c.json({ success: true as const, item: mapped, content }, 201);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (message.includes("already exists")) {
      return c.json({ success: false, error: message }, 409);
    }
    return c.json({ success: false, error: message }, 400);
  }
});

// ============================================================
// GET /api/job-descriptions/stats
// ============================================================
const statsRoute = createRoute({
  method: "get",
  path: "/api/job-descriptions/stats",
  tags: ["job-descriptions"],
  summary: "Job description statistics",
  responses: {
    200: {
      content: {
        "application/json": {
          schema: z.object({
            success: z.literal(true),
            stats: z.object({
              total: z.number(),
              active: z.number(),
              withAutoMatch: z.number(),
            }),
          })
        }
      },
      description: "Statistics",
    },
  },
});

app.openapi(statsRoute, (c) => {
  const stats = jobDescriptionService.getStats();
  return c.json({ success: true as const, stats }, 200);
});

// ============================================================
// POST /api/job-descriptions/extract-keywords
// ============================================================
const extractKeywordsRoute = createRoute({
  method: "post",
  path: "/api/job-descriptions/extract-keywords",
  tags: ["job-descriptions"],
  summary: "Extract search keywords from pasted job description text",
  request: {
    body: {
      content: { "application/json": { schema: ExtractKeywordsRequestSchema } },
    },
  },
  responses: {
    200: {
      content: { "application/json": { schema: ExtractKeywordsResponseSchema } },
      description: "Extracted keywords",
    },
    500: {
      content: { "application/json": { schema: ErrorResponseSchema } },
      description: "Keyword extraction failed",
    },
  },
});

app.openapi(extractKeywordsRoute, async (c) => {
  const { text } = c.req.valid("json");
  try {
    const extracted = await jdKeywordExtractionService.extractKeywords({ text });

    return c.json({
      success: true as const,
      keywords: extracted.keywords,
      model: extracted.model,
    }, 200);
  } catch (error) {
    logger.error("Failed to extract job description keywords", error, { route: "job_descriptions" });
    return c.json({
      success: false as const,
      error: "Failed to extract keywords from the job description",
    }, 500);
  }
});

// ============================================================
// POST /api/job-descriptions/match
// ============================================================
const matchRoute = createRoute({
  method: "post",
  path: "/api/job-descriptions/match",
  tags: ["job-descriptions"],
  summary: "Auto-match JD from keywords",
  description: "Find the best matching job description based on input keywords",
  request: {
    body: {
      content: { "application/json": { schema: MatchRequestSchema } },
    },
  },
  responses: {
    200: {
      content: { "application/json": { schema: MatchResponseSchema } },
      description: "Match result",
    },
  },
});

app.openapi(matchRoute, async (c) => {
  const { keywords } = c.req.valid("json");
  const result = jobDescriptionService.findMatch(keywords);

  return c.json({
    success: true as const,
    matched: result.matched?.name,
    title: result.matched?.title,
    confidence: result.confidence,
    matchedKeywords: result.matchedKeywords,
    filterPreset: result.filterPreset,
    suggestedFilters: result.suggestedFilters as Record<string, unknown> | undefined,
  }, 200);
});

// ============================================================
// GET /api/job-descriptions/{name}
// ============================================================
const getRoute = createRoute({
  method: "get",
  path: "/api/job-descriptions/{name}",
  tags: ["job-descriptions"],
  summary: "Get job description content",
  request: {
    params: z.object({
      name: z.string().openapi({ param: { name: "name", in: "path" } }),
    }),
  },
  responses: {
    200: {
      content: {
        "application/json": {
          schema: z.object({
            success: z.literal(true),
            item: JobDescriptionFileSchema,
            content: z.string(),
          })
        }
      },
      description: "Job description content",
    },
    404: { description: "Not found" },
  },
});

app.openapi(getRoute, async (c) => {
  const { name } = c.req.valid("param");
  try {
    const jd = jobDescriptionService.loadFile(name);
    return c.json({ success: true as const, item: jd, content: jd.content }, 200);
  } catch (error) {
    if (!(error instanceof DataNotFoundError)) {
      throw error;
    }

    const convexItems = await listConvexJobDescriptions(c.var.workspaceSlug);
    const convexMatch = convexItems.find((item) => {
      const itemId = String(item._id ?? "");
      const slug = readString(item.slug);
      return itemId === name || slug === name;
    });

    if (!convexMatch || typeof convexMatch.content !== "string") {
      return c.json({ success: false, error: error.message }, 404);
    }

    const mapped = toJobDescriptionFile(convexMatch);
    if (!mapped) {
      return c.json({ success: false, error: `Job description not found: ${name}` }, 404);
    }

    return c.json(
      {
        success: true as const,
        item: mapped,
        content: convexMatch.content,
      },
      200
    );
  }
});

export default app;
