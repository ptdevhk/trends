import { createRoute, OpenAPIHono, z } from "@hono/zod-openapi";
import { JobDescriptionService } from "../services/job-description-service.js";
import { config } from "../services/config.js";
import { DataNotFoundError } from "../services/errors.js";

const app = new OpenAPIHono();
const jobService = new JobDescriptionService(config.projectRoot);

const JobDescriptionFileSchema = z.object({
  name: z.string(),
  filename: z.string(),
  updatedAt: z.string(),
  size: z.number().int(),
  title: z.string().optional(),
});

const JobDescriptionsResponseSchema = z.object({
  success: z.literal(true),
  items: z.array(JobDescriptionFileSchema),
});

const JobDescriptionResponseSchema = z.object({
  success: z.literal(true),
  item: JobDescriptionFileSchema,
  content: z.string(),
});

const JobDescriptionsQuerySchema = z.object({
  includeReadme: z.coerce.boolean().optional().openapi({
    param: { name: "includeReadme", in: "query" },
    example: false,
  }),
});

const JobDescriptionParamsSchema = z.object({
  name: z.string().openapi({
    param: { name: "name", in: "path" },
    example: "lathe-sales",
  }),
});

const listJobDescriptionsRoute = createRoute({
  method: "get",
  path: "/api/job-descriptions",
  tags: ["job-descriptions"],
  summary: "List job description files",
  description: "Returns Markdown job descriptions under config/job-descriptions",
  request: {
    query: JobDescriptionsQuerySchema,
  },
  responses: {
    200: {
      content: { "application/json": { schema: JobDescriptionsResponseSchema } },
      description: "List of job description files",
    },
  },
});

app.openapi(listJobDescriptionsRoute, (c) => {
  const { includeReadme } = c.req.valid("query");
  const items = jobService.listFiles(Boolean(includeReadme));
  return c.json({ success: true as const, items }, 200);
});

const getJobDescriptionRoute = createRoute({
  method: "get",
  path: "/api/job-descriptions/{name}",
  tags: ["job-descriptions"],
  summary: "Get job description content",
  description: "Returns the raw markdown content for a job description",
  request: {
    params: JobDescriptionParamsSchema,
  },
  responses: {
    200: {
      content: { "application/json": { schema: JobDescriptionResponseSchema } },
      description: "Job description content",
    },
    404: {
      description: "Job description not found",
    },
  },
});

app.openapi(getJobDescriptionRoute, (c) => {
  const { name } = c.req.valid("param");
  try {
    const { item, content } = jobService.loadFile(name);
    return c.json({ success: true as const, item, content }, 200);
  } catch (error) {
    if (error instanceof DataNotFoundError) {
      return c.json({
        success: false,
        error: error.message,
        suggestion: error.suggestion,
      }, 404);
    }
    throw error;
  }
});

export default app;
