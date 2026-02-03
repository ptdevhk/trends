import { createRoute, OpenAPIHono } from "@hono/zod-openapi";
import {
  ResumesQuerySchema,
  ResumesResponseSchema,
  ResumeSamplesResponseSchema,
} from "../schemas/index.js";
import { config } from "../services/config.js";
import { ResumeService } from "../services/resume-service.js";
import { DataNotFoundError } from "../services/errors.js";

const app = new OpenAPIHono();
const resumeService = new ResumeService(config.projectRoot);

const listSamplesRoute = createRoute({
  method: "get",
  path: "/api/resumes/samples",
  tags: ["resumes"],
  summary: "List resume sample files",
  description: "Returns available resume sample JSON files stored under output/resumes/samples",
  responses: {
    200: {
      content: {
        "application/json": {
          schema: ResumeSamplesResponseSchema,
        },
      },
      description: "Successful response",
    },
  },
});

app.openapi(listSamplesRoute, (c) => {
  const samples = resumeService.listSampleFiles();
  return c.json({
    success: true as const,
    samples,
  }, 200);
});

const getResumesRoute = createRoute({
  method: "get",
  path: "/api/resumes",
  tags: ["resumes"],
  summary: "List resumes from a sample file",
  description: "Returns resume items from the latest or specified sample JSON",
  request: {
    query: ResumesQuerySchema,
  },
  responses: {
    200: {
      content: {
        "application/json": {
          schema: ResumesResponseSchema,
        },
      },
      description: "Successful response",
    },
  },
});

app.openapi(getResumesRoute, (c) => {
  const { sample, q, limit } = c.req.valid("query");
  const sampleName = sample?.trim() || undefined;
  const keyword = q?.trim() || undefined;

  try {
    const { items, sample: sampleInfo } = resumeService.loadSample(sampleName);
    const filtered = resumeService.searchResumes(items, keyword);
    const limited = typeof limit === "number" ? filtered.slice(0, limit) : filtered;

    return c.json({
      success: true as const,
      sample: sampleInfo,
      summary: {
        total: filtered.length,
        returned: limited.length,
        query: keyword,
      },
      data: limited,
    }, 200);
  } catch (error) {
    if (error instanceof DataNotFoundError) {
      return c.json({
        success: true as const,
        summary: {
          total: 0,
          returned: 0,
          query: keyword,
        },
        data: [],
      }, 200);
    }
    throw error;
  }
});

export default app;
