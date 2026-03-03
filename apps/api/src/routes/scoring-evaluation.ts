import { createRoute, OpenAPIHono, z } from "@hono/zod-openapi";

import { config } from "../services/config.js";
import { ScoringAutoTuner } from "../services/scoring-auto-tuner.js";
import { SearchEventAnalyzer } from "../services/search-event-analyzer.js";
import { WeightHistoryService } from "../services/weight-history.js";
import { workspaceConfigService } from "../services/workspace-config-service.js";

const app = new OpenAPIHono();
const analyzer = new SearchEventAnalyzer(config.projectRoot);
const autoTuner = new ScoringAutoTuner(config.projectRoot);
const weightHistory = new WeightHistoryService(config.projectRoot);

const CategoryWeightsSchema = z.object({
  skillMatch: z.number().min(0),
  roleMatch: z.number().min(0),
  experienceMatch: z.number().min(0),
  educationMatch: z.number().min(0),
  locationMatch: z.number().min(0),
  industryMatch: z.number().min(0),
  brandRelevance: z.number().min(0),
});
const ErrorResponseSchema = z.object({
  success: z.literal(false),
  error: z.string(),
});

const reportRoute = createRoute({
  method: "get",
  path: "/report",
  tags: ["Scoring Evaluation"],
  summary: "Get scoring analysis report",
  request: {
    query: z.object({
      periodDays: z.coerce.number().int().min(1).max(365).optional(),
      k: z.coerce.number().int().min(1).max(100).optional(),
    }),
  },
  responses: {
    200: {
      description: "Scoring analysis report",
      content: {
        "application/json": {
          schema: z.object({
            success: z.literal(true),
            report: z.any(),
          }),
        },
      },
    },
  },
});

app.openapi(reportRoute, (c) => {
  const query = c.req.valid("query");
  const report = analyzer.analyze({
    periodDays: query.periodDays,
    k: query.k,
  });
  return c.json({ success: true as const, report }, 200);
});

const metricsRoute = createRoute({
  method: "get",
  path: "/metrics",
  tags: ["Scoring Evaluation"],
  summary: "Get ranking metrics for a job description",
  request: {
    query: z.object({
      jobDescriptionId: z.string().min(1),
      periodDays: z.coerce.number().int().min(1).max(365).optional(),
      k: z.coerce.number().int().min(1).max(100).optional(),
    }),
  },
  responses: {
    200: {
      description: "Ranking metrics",
      content: {
        "application/json": {
          schema: z.object({
            success: z.literal(true),
            metrics: z.any(),
          }),
        },
      },
    },
  },
});

app.openapi(metricsRoute, (c) => {
  const query = c.req.valid("query");
  const metrics = analyzer.computeJobMetrics({
    jobDescriptionId: query.jobDescriptionId,
    periodDays: query.periodDays,
    k: query.k,
  });
  return c.json({ success: true as const, metrics }, 200);
});

const validateWeightsRoute = createRoute({
  method: "post",
  path: "/validate-weights",
  tags: ["Scoring Evaluation"],
  summary: "Dry-run validation for proposed category weights",
  request: {
    body: {
      content: {
        "application/json": {
          schema: z.object({
            jobDescriptionId: z.string().min(1),
            periodDays: z.number().int().min(1).max(365).optional(),
            k: z.number().int().min(1).max(100).optional(),
            proposedCategoryWeights: CategoryWeightsSchema,
          }),
        },
      },
    },
  },
  responses: {
    200: {
      description: "Weight validation report",
      content: {
        "application/json": {
          schema: z.object({
            success: z.literal(true),
            validation: z.any(),
          }),
        },
      },
    },
    500: {
      description: "Validation failure",
      content: {
        "application/json": {
          schema: ErrorResponseSchema,
        },
      },
    },
  },
});

app.openapi(validateWeightsRoute, async (c) => {
  const body = c.req.valid("json");
  try {
    const validation = analyzer.validateCategoryWeights({
      jobDescriptionId: body.jobDescriptionId,
      proposedCategoryWeights: body.proposedCategoryWeights,
      periodDays: body.periodDays,
      k: body.k,
    });
    return c.json({ success: true as const, validation }, 200);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return c.json({ success: false as const, error: message }, 500);
  }
});

const runTunerRoute = createRoute({
  method: "post",
  path: "/run-tuner",
  tags: ["Scoring Evaluation"],
  summary: "Run the scoring auto-tuner once",
  request: {
    body: {
      content: {
        "application/json": {
          schema: z.object({
            dryRun: z.boolean().optional(),
            periodDays: z.number().int().min(1).max(365).optional(),
            k: z.number().int().min(1).max(100).optional(),
            jobDescriptionId: z.string().min(1).optional(),
            minLabeledActions: z.number().int().min(1).max(1000).optional(),
            ndcgImprovementThreshold: z.number().min(-1).max(1).optional(),
            reingestLimit: z.number().int().min(1).max(5000).optional(),
          }),
        },
      },
    },
  },
  responses: {
    200: {
      description: "Auto-tune result",
      content: {
        "application/json": {
          schema: z.object({
            success: z.literal(true),
            result: z.any(),
          }),
        },
      },
    },
    500: {
      description: "Auto-tune execution failure",
      content: {
        "application/json": {
          schema: ErrorResponseSchema,
        },
      },
    },
  },
});

app.openapi(runTunerRoute, async (c) => {
  const body = c.req.valid("json");
  try {
    const result = await autoTuner.run({
      ...body,
      workspaceSlug: c.var.workspaceSlug,
    });
    return c.json({ success: true as const, result }, 200);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return c.json({ success: false as const, error: message }, 500);
  }
});

const historyRoute = createRoute({
  method: "get",
  path: "/weight-history",
  tags: ["Scoring Evaluation"],
  summary: "Get auto-tune weight history",
  request: {
    query: z.object({
      limit: z.coerce.number().int().min(1).max(1000).optional(),
    }),
  },
  responses: {
    200: {
      description: "Weight history list",
      content: {
        "application/json": {
          schema: z.object({
            success: z.literal(true),
            items: z.array(z.any()),
          }),
        },
      },
    },
  },
});

app.openapi(historyRoute, (c) => {
  const query = c.req.valid("query");
  const items = weightHistory.getHistory(query.limit ?? 100);
  return c.json({ success: true as const, items }, 200);
});

const rollbackRoute = createRoute({
  method: "post",
  path: "/rollback",
  tags: ["Scoring Evaluation"],
  summary: "Rollback category weights to a history entry",
  request: {
    body: {
      content: {
        "application/json": {
          schema: z.object({
            entryTs: z.string().min(1),
          }),
        },
      },
    },
  },
  responses: {
    200: {
      description: "Rollback result",
      content: {
        "application/json": {
          schema: z.object({
            success: z.literal(true),
            restored: z.any(),
            rollbackEntry: z.any(),
            currentCategoryWeights: CategoryWeightsSchema,
          }),
        },
      },
    },
    500: {
      description: "Rollback failure",
      content: {
        "application/json": {
          schema: ErrorResponseSchema,
        },
      },
    },
  },
});

app.openapi(rollbackRoute, async (c) => {
  const body = c.req.valid("json");
  try {
    const rollback = await weightHistory.rollback(body.entryTs, c.var.workspaceSlug);
    const currentCategoryWeights = (await workspaceConfigService.getRuleWeights(c.var.workspaceSlug)).categoryWeights;
    return c.json(
      {
        success: true as const,
        restored: rollback.restored,
        rollbackEntry: rollback.rollbackEntry,
        currentCategoryWeights,
      },
      200
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return c.json({ success: false as const, error: message }, 500);
  }
});

export default app;
