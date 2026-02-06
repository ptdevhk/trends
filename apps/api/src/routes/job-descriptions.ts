import { createRoute, OpenAPIHono, z } from "@hono/zod-openapi";
import { jobDescriptionService } from "../services/job-description-service.js";
import { DataNotFoundError } from "../services/errors.js";

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
  autoMatch: z.object({
    keywords: z.array(z.string()),
    locations: z.array(z.string()),
    priority: z.number(),
    filter_preset: z.string().optional(),
  }).optional(),
});

const MatchRequestSchema = z.object({
  keywords: z.array(z.string()).min(1),
  location: z.string().optional(),
});

const MatchResponseSchema = z.object({
  success: z.literal(true),
  matched: z.string().optional(),
  title: z.string().optional(),
  confidence: z.number(),
  matchedKeywords: z.array(z.string()),
  filterPreset: z.string().optional(),
  suggestedFilters: z.record(z.unknown()).optional(),
});

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
  const { keywords, location } = c.req.valid("json");
  const result = jobDescriptionService.findMatch(keywords, location);

  return c.json({
    success: true as const,
    matched: result.matched?.name,
    title: result.matched?.title,
    confidence: result.confidence,
    matchedKeywords: result.matchedKeywords,
    filterPreset: result.filterPreset,
    suggestedFilters: result.suggestedFilters as Record<string, unknown>,
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

app.openapi(getRoute, (c) => {
  const { name } = c.req.valid("param");
  try {
    const jd = jobDescriptionService.loadFile(name);
    return c.json({ success: true as const, item: jd, content: jd.content }, 200);
  } catch (error) {
    if (error instanceof DataNotFoundError) {
      return c.json({ success: false, error: error.message }, 404);
    }
    throw error;
  }
});

export default app;

