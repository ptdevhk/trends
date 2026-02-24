import { createRoute, OpenAPIHono, z } from "@hono/zod-openapi";

import { config } from "../services/config.js";
import { SearchEventLogger } from "../services/search-event-logger.js";
import { SkillsKnowledgeService } from "../services/skills-knowledge.js";

const app = new OpenAPIHono();
const searchEventLogger = new SearchEventLogger(config.projectRoot);
const skillsKnowledgeService = new SkillsKnowledgeService(config.projectRoot);

const ZeroResultItemSchema = z.object({
  query: z.string(),
  count: z.number().int(),
  lastSeen: z.string(),
});

const SearchSummarySchema = z.object({
  totalSearches: z.number().int(),
  zeroResultSearches: z.number().int(),
  zeroResultRate: z.number(),
  topQueries: z.array(
    z.object({
      query: z.string(),
      count: z.number().int(),
    })
  ),
  actionDistribution: z.record(z.number().int()),
  dailyTrend: z.array(
    z.object({
      date: z.string(),
      searches: z.number().int(),
      zeroResults: z.number().int(),
      shortlist: z.number().int(),
      reject: z.number().int(),
    })
  ),
});

const SynonymSuggestionSchema = z.object({
  query: z.string(),
  variant: z.string(),
  canonical: z.string(),
  confidence: z.number(),
  reason: z.string(),
});

const zeroResultsRoute = createRoute({
  method: "get",
  path: "/zero-results",
  tags: ["Search Analytics"],
  summary: "Get zero-result queries grouped by frequency",
  request: {
    query: z.object({
      limit: z.coerce.number().int().min(1).max(200).optional(),
    }),
  },
  responses: {
    200: {
      description: "Zero-result query summary",
      content: {
        "application/json": {
          schema: z.object({
            success: z.literal(true),
            items: z.array(ZeroResultItemSchema),
          }),
        },
      },
    },
  },
});

app.openapi(zeroResultsRoute, (c) => {
  const { limit } = c.req.valid("query");
  const items = searchEventLogger.getZeroResultSummary(limit);
  return c.json({ success: true as const, items }, 200);
});

const summaryRoute = createRoute({
  method: "get",
  path: "/summary",
  tags: ["Search Analytics"],
  summary: "Get aggregated search analytics summary",
  request: {
    query: z.object({
      topQueries: z.coerce.number().int().min(1).max(50).optional(),
      daily: z.coerce.number().int().min(1).max(90).optional(),
    }),
  },
  responses: {
    200: {
      description: "Search analytics summary",
      content: {
        "application/json": {
          schema: z.object({
            success: z.literal(true),
            summary: SearchSummarySchema,
          }),
        },
      },
    },
  },
});

app.openapi(summaryRoute, (c) => {
  const { topQueries, daily } = c.req.valid("query");
  const summary = searchEventLogger.getSummary({
    topQueryLimit: topQueries,
    dailyLimit: daily,
  });
  return c.json({ success: true as const, summary }, 200);
});

const synonymSuggestionsRoute = createRoute({
  method: "get",
  path: "/synonym-suggestions",
  tags: ["Search Analytics"],
  summary: "Generate synonym suggestions from zero-result queries",
  request: {
    query: z.object({
      limit: z.coerce.number().int().min(1).max(200).optional(),
    }),
  },
  responses: {
    200: {
      description: "Synonym suggestions",
      content: {
        "application/json": {
          schema: z.object({
            success: z.literal(true),
            suggestions: z.array(SynonymSuggestionSchema),
          }),
        },
      },
    },
  },
});

app.openapi(synonymSuggestionsRoute, (c) => {
  const { limit } = c.req.valid("query");
  const zeroResultQueries = searchEventLogger.getZeroResultQueries(limit ?? 200);
  const suggestions = skillsKnowledgeService.generateSynonymSuggestions(zeroResultQueries);
  return c.json({ success: true as const, suggestions }, 200);
});

export default app;
