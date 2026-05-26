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

// -- Shared schemas for scoring evaluation response types --

const ScoreDistributionBucketSchema = z.object({
  count: z.number(),
  mean: z.number(),
  median: z.number(),
  p25: z.number(),
  p75: z.number(),
  min: z.number(),
  max: z.number(),
});

const WeightAdjustmentSuggestionSchema = z.object({
  category: z.string(),
  delta: z.number(),
  confidence: z.number(),
  reason: z.string(),
});

const SynonymSuggestionSchema = z.object({
  query: z.string(),
  variant: z.string(),
  canonical: z.string(),
  confidence: z.number(),
  reason: z.string(),
});

const DomainExpansionSuggestionSchema = z.object({
  keyword: z.string(),
  count: z.number(),
  queries: z.array(z.string()),
});

const QueryMetricsSchema = z.object({
  query: z.string(),
  searchCount: z.number(),
  avgResultCount: z.number(),
  actions: z.number(),
  shortlist: z.number(),
  reject: z.number(),
  ndcgAtK: z.number(),
  shortlistAtK: z.number(),
  lastSearchAt: z.string().optional(),
  lastActionAt: z.string().optional(),
});

const AnalysisReportSchema = z.object({
  generatedAt: z.string(),
  periodDays: z.number(),
  summary: z.object({
    totalEvents: z.number(),
    searchQueries: z.number(),
    zeroResultQueries: z.number(),
    candidateActions: z.number(),
    labeledActions: z.number(),
    scoredActions: z.number(),
  }),
  queryMetrics: z.array(QueryMetricsSchema),
  rankingMetrics: z.object({
    k: z.number(),
    ndcgAtK: z.number(),
    shortlistAtK: z.number(),
    scoredCount: z.number(),
    shortlistCount: z.number(),
    rejectCount: z.number(),
    topJobDescriptionId: z.string().optional(),
  }),
  scoreDistribution: z.object({
    overall: ScoreDistributionBucketSchema,
    shortlist: ScoreDistributionBucketSchema,
    reject: ScoreDistributionBucketSchema,
    separation: z.object({
      meanGap: z.number(),
      medianGap: z.number(),
      overlapRate: z.number(),
      shortlistAboveRejectRate: z.number(),
    }),
  }),
  learningPatterns: z.object({
    shortlistPatterns: z.array(z.object({
      keywords: z.array(z.string()),
      priority: z.string(),
      count: z.number(),
    })),
    rejectPatterns: z.array(z.object({
      keyword: z.string(),
      negativeSignal: z.string(),
      count: z.number(),
    })),
  }),
  suggestions: z.object({
    weightAdjustments: z.array(WeightAdjustmentSuggestionSchema),
    synonymSuggestions: z.array(SynonymSuggestionSchema),
    domainExpansionSuggestions: z.array(DomainExpansionSuggestionSchema),
  }),
});

const JobScoringMetricsSchema = z.object({
  jobDescriptionId: z.string(),
  periodDays: z.number(),
  k: z.number(),
  rankedCount: z.number(),
  labeledCount: z.number(),
  shortlistCount: z.number(),
  rejectCount: z.number(),
  ndcgAtK: z.number(),
  shortlistAtK: z.number(),
});

const WeightValidationMetricsSchema = z.object({
  ndcgAtK: z.number(),
  shortlistAtK: z.number(),
});

const WeightValidationReportSchema = z.object({
  jobDescriptionId: z.string(),
  periodDays: z.number(),
  k: z.number(),
  sampleSize: z.number(),
  current: WeightValidationMetricsSchema,
  projected: WeightValidationMetricsSchema,
  delta: z.object({
    ndcgAtK: z.number(),
    shortlistAtK: z.number(),
  }),
});

const WeightHistoryEntrySchema = z.object({
  ts: z.string(),
  reason: z.string(),
  jobDescriptionId: z.string().optional(),
  before: CategoryWeightsSchema,
  after: CategoryWeightsSchema,
  metrics: z.object({
    currentNdcgAtK: z.number().optional(),
    projectedNdcgAtK: z.number().optional(),
    currentShortlistAtK: z.number().optional(),
    projectedShortlistAtK: z.number().optional(),
  }).optional(),
});

const ScoringAutoTuneRunResultSchema = z.object({
  status: z.enum([
    "applied", "dry_run", "cooldown", "insufficient_data",
    "no_job_description", "no_suggestions", "no_improvement",
    "hr_rating_divergence",
  ]),
  executedAt: z.string(),
  reason: z.string().optional(),
  report: AnalysisReportSchema,
  jobDescriptionId: z.string().optional(),
  proposedCategoryWeights: CategoryWeightsSchema.optional(),
  validation: WeightValidationReportSchema.optional(),
  historyEntry: WeightHistoryEntrySchema.optional(),
  synonymsApplied: z.number().optional(),
  reingestTriggered: z.boolean().optional(),
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
            report: AnalysisReportSchema,
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
            metrics: JobScoringMetricsSchema,
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
            validation: WeightValidationReportSchema,
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
            result: ScoringAutoTuneRunResultSchema,
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
            items: z.array(WeightHistoryEntrySchema),
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
            restored: WeightHistoryEntrySchema,
            rollbackEntry: WeightHistoryEntrySchema,
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
